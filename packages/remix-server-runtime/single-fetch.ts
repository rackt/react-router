import type {
  StaticHandler,
  unstable_DataStrategyFunction as DataStrategyFunction,
  unstable_DataStrategyFunctionArgs as DataStrategyFunctionArgs,
  unstable_HandlerResult as HandlerResult,
  StaticHandlerContext,
} from "@remix-run/router";
import {
  isRouteErrorResponse,
  UNSAFE_ErrorResponseImpl as ErrorResponseImpl,
  redirect,
} from "@remix-run/router";
import { encode } from "turbo-stream";

import type { CreateFromReadableStreamFunction } from "./build";
import type { AppLoadContext } from "./data";
import { sanitizeError, sanitizeErrors } from "./errors";
import { ServerMode } from "./mode";
import type { ResponseStub, ResponseStubOperation } from "./routeModules";
import { ResponseStubOperationsSymbol } from "./routeModules";
import { isDeferredData, isRedirectStatusCode, isResponse } from "./responses";

export type CallReactServer = (
  url: string,
  init: RequestInit
) => Promise<Response>;

export const SingleFetchRedirectSymbol = Symbol("SingleFetchRedirect");
const ResponseStubActionSymbol = Symbol("ResponseStubAction");

type SingleFetchRedirectResult = {
  redirect: string;
  status: number;
  revalidate: boolean;
  reload: boolean;
};
export type SingleFetchResult =
  | { data: unknown }
  | { error: unknown }
  | SingleFetchRedirectResult;

export type SingleFetchResults = {
  [key: string]: SingleFetchResult;
  [SingleFetchRedirectSymbol]?: SingleFetchRedirectResult;
};

export function getServerComponentsDataStrategy(
  responseStubs: ReturnType<typeof getResponseStubs>,
  createFromReadableStream: CreateFromReadableStreamFunction,
  callReactServer: CallReactServer,
  // TODO: This make me want to puke
  onBody: (body: ReadableStream<Uint8Array> | null) => void,
  onActionBody: (
    routeId: string,
    body: ReadableStream<Uint8Array> | null
  ) => void
): DataStrategyFunction {
  return async ({ request, matches }) => {
    let headers = new Headers(request.headers);
    headers.append("Remix-Route-IDs", matches.map((m) => m.route.id).join(","));

    let requestInit: RequestInit & { duplex?: "half" } = {
      headers,
      method: request.method,
      signal: request.signal,
    };

    let isActionRequest = request.method !== "GET" && request.method !== "HEAD";
    if (isActionRequest && request.body) {
      requestInit.body = request.body;
      requestInit.duplex = "half";
    }

    let bodyB: ReadableStream<Uint8Array> | null = null;
    const payloadPromise = callReactServer(request.url, requestInit).then(
      async (response) => {
        if (!response.body) {
          throw new Error("Response body is missing");
        }
        const [bodyA, _bodyB] = response.body.tee();
        if (!isActionRequest) {
          onBody(_bodyB);
        } else {
          bodyB = _bodyB;
        }
        const payload = (await createFromReadableStream(
          bodyA
        )) as SingleFetchResults;
        return [response.status, response.headers, payload] as const;
      }
    );

    console.log(request.method, await payloadPromise);

    return Promise.all(
      matches.map(async (m) =>
        m.resolve(async (): Promise<HandlerResult> => {
          const [status, headers, results] = await payloadPromise;
          // TODO: merge status and headers?
          responseStubs[m.route.id].status = status;

          if (isActionRequest) {
            onActionBody(m.route.id, bodyB);
            return { type: "data", result: results.data };
          }

          let result = unwrapSingleFetchResults(results, m.route.id);
          return { type: "data", result };
        })
      )
    );
  };
}

export function getSingleFetchDataStrategy(
  responseStubs: ReturnType<typeof getResponseStubs>
) {
  return async ({ request, matches }: DataStrategyFunctionArgs) => {
    let results = await Promise.all(
      matches.map(async (match) => {
        let responseStub: ResponseStub | undefined;
        if (request.method !== "GET") {
          responseStub = responseStubs[ResponseStubActionSymbol];
        } else {
          responseStub = responseStubs[match.route.id];
        }

        let result = await match.resolve(async (handler) => {
          let data = await handler({ response: responseStub });
          return { type: "data", result: data };
        });

        // Transfer raw Response status/headers to responseStubs
        if (isResponse(result.result)) {
          proxyResponseToResponseStub(
            result.result.status,
            result.result.headers,
            responseStub
          );
        } else if (isDeferredData(result.result) && result.result.init) {
          proxyResponseToResponseStub(
            result.result.init.status,
            new Headers(result.result.init.headers),
            responseStub
          );
        }

        return result;
      })
    );
    return results;
  };
}

export async function singleFetchAction(
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

    let responseStubs = getResponseStubs();
    let result = await staticHandler.query(handlerRequest, {
      requestContext: loadContext,
      skipLoaderErrorBubbling: true,
      skipLoaders: true,
      unstable_dataStrategy: getSingleFetchDataStrategy(responseStubs),
    });

    // Unlike `handleDataRequest`, when singleFetch is enabled, queryRoute does
    // let non-Response return values through
    if (isResponse(result)) {
      return {
        result: getSingleFetchRedirect(result.status, result.headers),
        headers: result.headers,
        status: 200,
      };
    }

    let context = result;

    let singleFetchResult: SingleFetchResult;
    let { statusCode, headers } = mergeResponseStubs(context, responseStubs);

    if (isRedirectStatusCode(statusCode) && headers.has("Location")) {
      return {
        result: getSingleFetchRedirect(statusCode, headers),
        headers,
        status: 200, // Don't want the `fetch` call to follow the redirect
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

    if (context.errors) {
      let error = Object.values(context.errors)[0];
      singleFetchResult = { error: isResponseStub(error) ? null : error };
    } else {
      singleFetchResult = { data: Object.values(context.actionData || {})[0] };
    }

    return {
      result: singleFetchResult,
      headers,
      status: statusCode,
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

    let responseStubs = getResponseStubs();
    let result = await staticHandler.query(handlerRequest, {
      requestContext: loadContext,
      loadRouteIds,
      skipLoaderErrorBubbling: true,
      unstable_dataStrategy: getSingleFetchDataStrategy(responseStubs),
    });

    if (isResponse(result)) {
      return {
        result: {
          [SingleFetchRedirectSymbol]: getSingleFetchRedirect(
            result.status,
            result.headers
          ),
        },
        headers: result.headers,
        status: 200, // Don't want the `fetch` call to follow the redirect
      };
    }

    let context = result;

    let { statusCode, headers } = mergeResponseStubs(context, responseStubs);

    if (isRedirectStatusCode(statusCode) && headers.has("Location")) {
      return {
        result: {
          [SingleFetchRedirectSymbol]: getSingleFetchRedirect(
            statusCode,
            headers
          ),
        },
        headers,
        status: 200, // Don't want the `fetch` call to follow the redirect
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
      let data = context.loaderData?.[m.route.id];
      let error = context.errors?.[m.route.id];
      if (error !== undefined) {
        if (isResponseStub(error)) {
          results[m.route.id] = { error: null };
        } else {
          results[m.route.id] = { error };
        }
      } else if (data !== undefined) {
        results[m.route.id] = { data };
      }
    });

    return {
      result: results,
      headers,
      status: statusCode,
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

export function isResponseStub(value: any): value is ResponseStub {
  return (
    value && typeof value === "object" && ResponseStubOperationsSymbol in value
  );
}

function getResponseStub(status?: number) {
  let headers = new Headers();
  let operations: ResponseStubOperation[] = [];
  let headersProxy = new Proxy(headers, {
    get(target, prop, receiver) {
      if (prop === "set" || prop === "append" || prop === "delete") {
        return (name: string, value: string) => {
          operations.push([prop, name, value]);
          Reflect.apply(target[prop], target, [name, value]);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return {
    status,
    headers: headersProxy,
    [ResponseStubOperationsSymbol]: operations,
  };
}

export function getResponseStubs() {
  return new Proxy({} as Record<string | symbol, ResponseStub>, {
    get(responseStubCache, prop) {
      let cached = responseStubCache[prop];
      if (!cached) {
        responseStubCache[prop] = cached = getResponseStub();
      }
      return cached;
    },
  });
}

function proxyResponseToResponseStub(
  status: number | undefined,
  headers: Headers,
  responseStub: ResponseStub
) {
  if (status != null && responseStub.status == null) {
    responseStub.status = status;
  }
  for (let [k, v] of headers) {
    if (k.toLowerCase() !== "set-cookie") {
      responseStub.headers.set(k, v);
    }
  }

  // Unsure why this is complaining?  It's fine in VSCode but fails with tsc...
  // @ts-ignore - ignoring instead of expecting because otherwise build fails locally
  for (let v of headers.getSetCookie()) {
    responseStub.headers.append("Set-Cookie", v);
  }
}

export function mergeResponseStubs(
  context: StaticHandlerContext,
  responseStubs: ReturnType<typeof getResponseStubs>
) {
  let statusCode: number | undefined = undefined;
  let headers = new Headers();

  // Action followed by top-down loaders
  let actionStub = responseStubs[ResponseStubActionSymbol];
  let stubs = [
    actionStub,
    ...context.matches.map((m) => responseStubs[m.route.id]),
  ];

  for (let stub of stubs) {
    // Take the highest error/redirect, or the lowest success value - preferring
    // action 200's over loader 200s
    if (
      // first status found on the way down
      (statusCode === undefined && stub.status) ||
      // deeper 2xx status found while not overriding the action status
      (statusCode !== undefined &&
        statusCode < 300 &&
        stub.status &&
        statusCode !== actionStub?.status)
    ) {
      statusCode = stub.status;
    }

    // Replay headers operations in order
    let ops = stub[ResponseStubOperationsSymbol];
    for (let [op, ...args] of ops) {
      // @ts-expect-error
      headers[op](...args);
    }
  }

  // If no response stubs set it, use whatever we got back from the router
  // context which handles internal ErrorResponse cases like 404/405's where
  // we may never run a loader/action
  if (statusCode === undefined) {
    statusCode = context.statusCode;
  }
  if (statusCode === undefined) {
    statusCode = 200;
  }

  return { statusCode, headers };
}

export function getSingleFetchRedirect(
  status: number,
  headers: Headers
): SingleFetchRedirectResult {
  return {
    redirect: headers.get("Location")!,
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
  };
}

// Note: If you change this function please change the corresponding
// decodeViaTurboStream function in server-runtime
export function encodeViaTurboStream(
  data: any,
  requestSignal: AbortSignal,
  streamTimeout: number | undefined,
  serverMode: ServerMode
) {
  let controller = new AbortController();
  // How long are we willing to wait for all of the promises in `data` to resolve
  // before timing out?  We default this to 50ms shorter than the default value for
  // `ABORT_DELAY` in our built-in `entry.server.tsx` so that once we reject we
  // have time to flush the rejections down through React's rendering stream before `
  // we call abort() on that.  If the user provides their own it's up to them to
  // decouple the aborting of the stream from the aborting of React's renderToPipeableStream
  let timeoutId = setTimeout(
    () => controller.abort(new Error("Server Timeout")),
    typeof streamTimeout === "number" ? streamTimeout : 4950
  );
  requestSignal.addEventListener("abort", () => clearTimeout(timeoutId));

  return encode(data, {
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
  });
}

function unwrapSingleFetchResults(
  results: SingleFetchResults,
  routeId: string
) {
  let redirect = results[SingleFetchRedirectSymbol];
  if (redirect) {
    return unwrapSingleFetchResult(redirect, routeId);
  }

  return results[routeId] !== undefined
    ? unwrapSingleFetchResult(results[routeId], routeId)
    : null;
}

function unwrapSingleFetchResult(result: SingleFetchResult, routeId: string) {
  if ("error" in result) {
    throw result.error;
  } else if ("redirect" in result) {
    let headers: Record<string, string> = {};
    if (result.revalidate) {
      headers["X-Remix-Revalidate"] = "yes";
    }
    if (result.reload) {
      headers["X-Remix-Reload-Document"] = "yes";
    }
    return redirect(result.redirect, { status: result.status, headers });
  } else if ("data" in result) {
    return result.data;
  } else {
    throw new Error(`No response found for routeId "${routeId}"`);
  }
}
