import { encode } from "turbo-stream";

import type { StaticHandler } from "../router/router";
import { isRedirectStatusCode, isResponse } from "../router/router";
import type {
  DataStrategyFunctionArgs,
  DataStrategyFunction,
} from "../router/utils";
import {
  isRouteErrorResponse,
  ErrorResponseImpl,
  data as routerData,
  stripBasename,
} from "../router/utils";
import type {
  SingleFetchRedirectResult,
  SingleFetchResult,
  SingleFetchResults,
} from "../dom/ssr/single-fetch";
import { SingleFetchRedirectSymbol } from "../dom/ssr/single-fetch";
import type { AppLoadContext } from "./data";
import { sanitizeError, sanitizeErrors } from "./errors";
import { ServerMode } from "./mode";
import { getDocumentHeaders } from "./headers";
import type { ServerBuild } from "./build";

import { encode as encodeV2 } from "../../vendor/turbo-stream-v2/turbo-stream";

export type { SingleFetchResult, SingleFetchResults };
export { SingleFetchRedirectSymbol };

// We can't use a 3xx status or else the `fetch()` would follow the redirect.
// We need to communicate the redirect back as data so we can act on it in the
// client side router.  We use a 202 to avoid any automatic caching we might
// get from a 200 since a "temporary" redirect should not be cached.  This lets
// the user control cache behavior via Cache-Control
export const SINGLE_FETCH_REDIRECT_STATUS = 202;

export function getSingleFetchDataStrategy({
  isActionDataRequest,
  loadRouteIds,
}: {
  isActionDataRequest?: boolean;
  loadRouteIds?: string[];
} = {}): DataStrategyFunction {
  return async ({ request, matches }: DataStrategyFunctionArgs) => {
    // Don't call loaders on action data requests
    if (isActionDataRequest && request.method === "GET") {
      return {};
    }

    // Only run opt-in loaders when fine-grained revalidation is enabled
    let matchesToLoad = loadRouteIds
      ? matches.filter((m) => loadRouteIds.includes(m.route.id))
      : matches;

    let results = await Promise.all(
      matchesToLoad.map((match) => match.resolve())
    );
    return results.reduce(
      (acc, result, i) =>
        Object.assign(acc, { [matchesToLoad[i].route.id]: result }),
      {}
    );
  };
}

export async function singleFetchAction(
  build: ServerBuild,
  serverMode: ServerMode,
  staticHandler: StaticHandler,
  request: Request,
  handlerUrl: URL,
  loadContext: AppLoadContext,
  handleError: (err: unknown) => void
): Promise<{ result: SingleFetchResult; headers: Headers; status: number }> {
  try {
    let handlerRequest = new Request(handlerUrl, {
      method: request.method,
      body: request.body,
      headers: request.headers,
      signal: request.signal,
      ...(request.body ? { duplex: "half" } : undefined),
    });

    let result = await staticHandler.query(handlerRequest, {
      requestContext: loadContext,
      skipLoaderErrorBubbling: true,
      dataStrategy: getSingleFetchDataStrategy({
        isActionDataRequest: true,
      }),
    });

    // Unlike `handleDataRequest`, when singleFetch is enabled, query does
    // let non-Response return values through
    if (isResponse(result)) {
      return {
        result: getSingleFetchRedirect(
          result.status,
          result.headers,
          build.basename
        ),
        headers: result.headers,
        status: SINGLE_FETCH_REDIRECT_STATUS,
      };
    }

    let context = result;
    let headers = getDocumentHeaders(build, context);

    if (isRedirectStatusCode(context.statusCode) && headers.has("Location")) {
      return {
        result: getSingleFetchRedirect(
          context.statusCode,
          headers,
          build.basename
        ),
        headers,
        status: SINGLE_FETCH_REDIRECT_STATUS,
      };
    }

    // Sanitize errors outside of development environments
    if (context.errors) {
      Object.values(context.errors).forEach((err) => {
        // @ts-expect-error This is "private" from users but intended for internal use
        if (!isRouteErrorResponse(err) || err.error) {
          handleError(err);
        }
      });
      context.errors = sanitizeErrors(context.errors, serverMode);
    }

    let singleFetchResult: SingleFetchResult;
    if (context.errors) {
      singleFetchResult = { error: Object.values(context.errors)[0] };
    } else {
      singleFetchResult = { data: Object.values(context.actionData || {})[0] };
    }

    return {
      result: singleFetchResult,
      headers,
      status: context.statusCode,
    };
  } catch (error) {
    handleError(error);
    // These should only be internal remix errors, no need to deal with responseStubs
    return {
      result: { error },
      headers: new Headers(),
      status: 500,
    };
  }
}

export async function singleFetchLoaders(
  build: ServerBuild,
  serverMode: ServerMode,
  staticHandler: StaticHandler,
  request: Request,
  handlerUrl: URL,
  loadContext: AppLoadContext,
  handleError: (err: unknown) => void
): Promise<{ result: SingleFetchResults; headers: Headers; status: number }> {
  try {
    let handlerRequest = new Request(handlerUrl, {
      headers: request.headers,
      signal: request.signal,
    });
    let loadRouteIds =
      new URL(request.url).searchParams.get("_routes")?.split(",") || undefined;

    let result = await staticHandler.query(handlerRequest, {
      requestContext: loadContext,
      skipLoaderErrorBubbling: true,
      dataStrategy: getSingleFetchDataStrategy({
        loadRouteIds,
      }),
    });

    if (isResponse(result)) {
      return {
        result: {
          [SingleFetchRedirectSymbol]: getSingleFetchRedirect(
            result.status,
            result.headers,
            build.basename
          ),
        },
        headers: result.headers,
        status: SINGLE_FETCH_REDIRECT_STATUS,
      };
    }

    let context = result;
    let headers = getDocumentHeaders(build, context);

    if (isRedirectStatusCode(context.statusCode) && headers.has("Location")) {
      return {
        result: {
          [SingleFetchRedirectSymbol]: getSingleFetchRedirect(
            context.statusCode,
            headers,
            build.basename
          ),
        },
        headers,
        status: SINGLE_FETCH_REDIRECT_STATUS,
      };
    }

    // Sanitize errors outside of development environments
    if (context.errors) {
      Object.values(context.errors).forEach((err) => {
        // @ts-expect-error This is "private" from users but intended for internal use
        if (!isRouteErrorResponse(err) || err.error) {
          handleError(err);
        }
      });
      context.errors = sanitizeErrors(context.errors, serverMode);
    }

    // Aggregate results based on the matches we intended to load since we get
    // `null` values back in `context.loaderData` for routes we didn't load
    let results: SingleFetchResults = {};
    let loadedMatches = loadRouteIds
      ? context.matches.filter(
          (m) => m.route.loader && loadRouteIds!.includes(m.route.id)
        )
      : context.matches;

    loadedMatches.forEach((m) => {
      let { id } = m.route;
      if (context.errors && context.errors.hasOwnProperty(id)) {
        results[id] = { error: context.errors[id] };
      } else if (context.loaderData.hasOwnProperty(id)) {
        results[id] = { data: context.loaderData[id] };
      }
    });

    return {
      result: results,
      headers,
      status: context.statusCode,
    };
  } catch (error: unknown) {
    handleError(error);
    // These should only be internal remix errors, no need to deal with responseStubs
    return {
      result: { root: { error } },
      headers: new Headers(),
      status: 500,
    };
  }
}

export function getSingleFetchRedirect(
  status: number,
  headers: Headers,
  basename: string | undefined
): SingleFetchRedirectResult {
  let redirect = headers.get("Location")!;

  if (basename) {
    redirect = stripBasename(redirect, basename) || redirect;
  }

  return {
    redirect,
    status,
    revalidate:
      // Technically X-Remix-Revalidate isn't needed here - that was an implementation
      // detail of ?_data requests as our way to tell the front end to revalidate when
      // we didn't have a response body to include that information in.
      // With single fetch, we tell the front end via this revalidate boolean field.
      // However, we're respecting it for now because it may be something folks have
      // used in their own responses
      // TODO(v3): Consider removing or making this official public API
      headers.has("X-Remix-Revalidate") || headers.has("Set-Cookie"),
    reload: headers.has("X-Remix-Reload-Document"),
    replace: headers.has("X-Remix-Replace"),
  };
}

export type Serializable =
  | undefined
  | null
  | boolean
  | string
  | symbol
  | number
  | Array<Serializable>
  | { [key: PropertyKey]: Serializable }
  | bigint
  | Date
  | URL
  | RegExp
  | Error
  | Map<Serializable, Serializable>
  | Set<Serializable>
  | Promise<Serializable>;

export function data(value: Serializable, init?: number | ResponseInit) {
  return routerData(value, init);
}

// Note: If you change this function please change the corresponding
// decodeViaTurboStream function in server-runtime
export function encodeViaTurboStream(
  data: any,
  requestSignal: AbortSignal,
  streamTimeout: number | undefined,
  serverMode: ServerMode,
  turboV3: boolean
) {
  let controller = new AbortController();
  // How long are we willing to wait for all of the promises in `data` to resolve
  // before timing out?  We default this to 50ms shorter than the default value
  // of 5000ms we had in `ABORT_DELAY` in Remix v2 that folks may still be using
  // in RR v7 so that once we reject we have time to flush the rejections down
  // through React's rendering stream before we call `abort()` on that.  If the
  // user provides their own it's up to them to decouple the aborting of the
  // stream from the aborting of React's `renderToPipeableStream`
  let timeoutId = setTimeout(
    () => controller.abort(new Error("Server Timeout")),
    typeof streamTimeout === "number" ? streamTimeout : 4950
  );
  requestSignal.addEventListener("abort", () => clearTimeout(timeoutId));

  if (turboV3) {
    return encode(data, {
      signal: controller.signal,
      redactErrors:
        serverMode === ServerMode.Development
          ? false
          : "Unexpected Server Error",
      plugins: [
        (value) => {
          if (value instanceof ErrorResponseImpl) {
            let { data, status, statusText } = value;
            return ["ErrorResponse", data, status, statusText];
          }

          if (SingleFetchRedirectSymbol in (value as any)) {
            return [
              "SingleFetchRedirect",
              (value as any)[SingleFetchRedirectSymbol],
            ];
          }
        },
      ],
    }).pipeThrough(new TextEncoderStream());
  }

  return encodeV2(data, {
    signal: controller.signal,
    plugins: [
      (value) => {
        // Even though we sanitized errors on context.errors prior to responding,
        // we still need to handle this for any deferred data that rejects with an
        // Error - as those will not be sanitized yet
        if (value instanceof Error) {
          let { name, message, stack } =
            serverMode === ServerMode.Production
              ? sanitizeError(value, serverMode)
              : value;
          return ["SanitizedError", name, message, stack];
        }

        if (value instanceof ErrorResponseImpl) {
          let { data, status, statusText } = value;
          return ["ErrorResponse", data, status, statusText];
        }

        if (
          value &&
          typeof value === "object" &&
          SingleFetchRedirectSymbol in value
        ) {
          return ["SingleFetchRedirect", value[SingleFetchRedirectSymbol]];
        }
      },
    ],
    postPlugins: [
      (value) => {
        if (!value) return;
        if (typeof value !== "object") return;

        return [
          "SingleFetchClassInstance",
          Object.fromEntries(Object.entries(value)),
        ];
      },
      () => ["SingleFetchFallback"],
    ],
  });
}
