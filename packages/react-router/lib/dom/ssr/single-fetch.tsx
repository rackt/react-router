import * as React from "react";
import type {
  unstable_DataStrategyFunction as DataStrategyFunction,
  unstable_HandlerResult as HandlerResult,
} from "../../router";
import {
  UNSAFE_ErrorResponseImpl as ErrorResponseImpl,
  redirect,
} from "../../router";
import { decode } from "turbo-stream";

import { createRequestInit } from "./data";
import type { AssetsManifest, EntryContext } from "./entry";
import { escapeHtml } from "./markup";
import type { RouteModules } from "./routeModules";
import invariant from "./invariant";
import type { DataStrategyFunctionArgs } from "../../router/utils";
import type { DataRouteObject } from "../../context";

export const SingleFetchRedirectSymbol = Symbol("SingleFetchRedirect");

export type SingleFetchRedirectResult = {
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

interface StreamTransferProps {
  context: EntryContext;
  identifier: number;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  textDecoder: TextDecoder;
  isAction: boolean;
  nonce?: string;
}

// StreamTransfer recursively renders down chunks of the `serverHandoffStream`
// into the client-side `streamController`
export function StreamTransfer({
  context,
  identifier,
  reader,
  textDecoder,
  isAction,
  nonce,
}: StreamTransferProps) {
  // If the user didn't render the <Scripts> component then we don't have to
  // bother streaming anything in
  if (!context.renderMeta || !context.renderMeta.didRenderScripts) {
    return null;
  }

  if (!context.renderMeta.streamCache) {
    context.renderMeta.streamCache = {};
  }
  let streamCache = isAction
    ? context.renderMeta.streamCacheAction
    : context.renderMeta.streamCache;
  if (!streamCache) {
    if (isAction) {
      context.renderMeta.streamCacheAction = {};
      streamCache = context.renderMeta.streamCacheAction;
    } else {
      context.renderMeta.streamCache = {};
      streamCache = context.renderMeta.streamCache;
    }
  }

  let promise = streamCache[identifier];
  if (!promise) {
    promise = streamCache[identifier] = reader
      .read()
      .then((result) => {
        streamCache[identifier].result = {
          done: result.done,
          value: textDecoder.decode(result.value, { stream: true }),
        };
      })
      .catch((e) => {
        streamCache[identifier].error = e;
      });
  }

  if (promise.error) {
    throw promise.error;
  }
  if (promise.result === undefined) {
    throw promise;
  }

  let { done, value } = promise.result;
  let scriptTag = value ? (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: `window.__remixContext.streamController${
          isAction ? "Action" : ""
        }.enqueue(${escapeHtml(JSON.stringify(value))});`,
      }}
    />
  ) : null;

  if (done) {
    return (
      <>
        {scriptTag}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `window.__remixContext.streamController${
              isAction ? "Action" : ""
            }.close();`,
          }}
        />
      </>
    );
  } else {
    return (
      <>
        {scriptTag}
        <React.Suspense>
          <StreamTransfer
            context={context}
            identifier={identifier + 1}
            reader={reader}
            textDecoder={textDecoder}
            isAction={isAction}
            nonce={nonce}
          />
        </React.Suspense>
      </>
    );
  }
}

export function getSingleFetchDataStrategy(
  manifest: AssetsManifest,
  routeModules: RouteModules
): DataStrategyFunction {
  return async ({ request, matches }) =>
    request.method !== "GET"
      ? singleFetchActionStrategy(request, matches)
      : singleFetchLoaderStrategy(manifest, routeModules, request, matches);
}

// Actions are simple since they're singular calls to the server
function singleFetchActionStrategy(
  request: Request,
  matches: DataStrategyFunctionArgs["matches"]
) {
  return Promise.all(
    matches.map(async (m) => {
      let actionStatus: number | undefined;
      let result = await m.resolve(async (handler): Promise<HandlerResult> => {
        let result = await handler(async () => {
          let url = singleFetchUrl(request.url);
          let init = await createRequestInit(request);
          let { data, status } = await fetchAndDecode(url, init);
          actionStatus = status;
          return unwrapSingleFetchResult(data as SingleFetchResult, m.route.id);
        });
        return {
          type: "data",
          result,
          status: actionStatus,
        };
      });
      return {
        ...result,
        // Proxy along the action HTTP response status for thrown errors
        status: actionStatus,
      };
    })
  );
}

// Loaders are trickier since we only want to hit the server once, so we
// create a singular promise for all server-loader routes to latch onto.
function singleFetchLoaderStrategy(
  manifest: AssetsManifest,
  routeModules: RouteModules,
  request: Request,
  matches: DataStrategyFunctionArgs["matches"]
) {
  let singleFetchPromise: Promise<SingleFetchResults> | undefined;
  return Promise.all(
    matches.map(async (m) =>
      m.resolve(async (handler): Promise<HandlerResult> => {
        let result: unknown;
        let url = stripIndexParam(singleFetchUrl(request.url));

        // When a route has a client loader, it calls it's singular server loader
        if (manifest.routes[m.route.id].hasClientLoader) {
          result = await handler(async () => {
            url.searchParams.set("_routes", m.route.id);
            let { data } = await fetchAndDecode(url);
            return unwrapSingleFetchResults(
              data as SingleFetchResults,
              m.route.id
            );
          });
        } else {
          result = await handler(async () => {
            // Otherwise we let multiple routes hook onto the same promise
            if (!singleFetchPromise) {
              url = addRevalidationParam(
                manifest,
                routeModules,
                matches.map((m) => m.route),
                matches.filter((m) => m.shouldLoad).map((m) => m.route),
                url
              );
              singleFetchPromise = fetchAndDecode(url).then(
                ({ data }) => data as SingleFetchResults
              );
            }
            let results = await singleFetchPromise;
            return unwrapSingleFetchResults(results, m.route.id);
          });
        }

        return {
          type: "data",
          result,
        };
      })
    )
  );
}

function stripIndexParam(url: URL) {
  let indexValues = url.searchParams.getAll("index");
  url.searchParams.delete("index");
  let indexValuesToKeep = [];
  for (let indexValue of indexValues) {
    if (indexValue) {
      indexValuesToKeep.push(indexValue);
    }
  }
  for (let toKeep of indexValuesToKeep) {
    url.searchParams.append("index", toKeep);
  }

  return url;
}

// Determine which routes we want to load so we can add a `?_routes` search param
// for fine-grained revalidation if necessary. There's some nuance to this decision:
//
//  - The presence of `shouldRevalidate` and `clientLoader` functions are the only
//    way to trigger fine-grained single fetch loader calls.  without either of
//    these on the route matches we just always ask for the full `.data` request.
//  - If any routes have a `shouldRevalidate` or `clientLoader` then we do a
//    comparison of the routes we matched and the routes we're aiming to load
//  - If they don't match up, then we add the `_routes` param or fine-grained
//    loading
//  - This is used by the single fetch implementation above and by the
//    `<PrefetchPageLinksImpl>` component so we can prefetch routes using the
//    same logic
export function addRevalidationParam(
  manifest: AssetsManifest,
  routeModules: RouteModules,
  matchedRoutes: DataRouteObject[],
  loadRoutes: DataRouteObject[],
  url: URL
) {
  let genRouteIds = (arr: string[]) =>
    arr.filter((id) => manifest.routes[id].hasLoader).join(",");

  // Look at the `routeModules` for `shouldRevalidate` here instead of the manifest
  // since HDR adds a wrapper for `shouldRevalidate` even if the route didn't have one
  // initially.
  // TODO: We probably can get rid of that wrapper once we're strictly on on
  // single-fetch in v3 and just leverage a needsRevalidation data structure here
  // to determine what to fetch
  let needsParam = matchedRoutes.some(
    (r) =>
      routeModules[r.id]?.shouldRevalidate ||
      manifest.routes[r.id]?.hasClientLoader
  );
  if (!needsParam) {
    return url;
  }

  let matchedIds = genRouteIds(matchedRoutes.map((r) => r.id));
  let loadIds = genRouteIds(
    loadRoutes
      .filter((r) => !manifest.routes[r.id]?.hasClientLoader)
      .map((r) => r.id)
  );
  if (matchedIds !== loadIds) {
    url.searchParams.set("_routes", loadIds);
  }
  return url;
}

export function singleFetchUrl(reqUrl: URL | string) {
  let url =
    typeof reqUrl === "string"
      ? new URL(
          reqUrl,
          // This can be called during the SSR flow via PrefetchPageLinksImpl so
          // don't assume window is available
          typeof window === "undefined"
            ? "server://singlefetch/"
            : window.location.origin
        )
      : reqUrl;
  url.pathname = `${url.pathname === "/" ? "_root" : url.pathname}.data`;
  return url;
}

async function fetchAndDecode(url: URL, init?: RequestInit) {
  let res = await fetch(url, init);
  invariant(res.body, "No response body to decode");

  if (res.headers.get("Content-Type")?.includes("text/x-component")) {
    invariant(res.body, "No response body to decode");
    // @ts-expect-error - TODO: Figure out where this comes from
    let decoded = await window.createFromReadableStream(res.body);
    return { status: res.status, data: decoded };
  }

  try {
    let decoded = await decodeViaTurboStream(res.body, window);
    return { status: res.status, data: decoded.value };
  } catch (e) {
    // Can't clone after consuming the body via turbo-stream so we can't
    // include the body here.  In an ideal world we'd look for a turbo-stream
    // content type here, or even X-Remix-Response but then folks can't
    // statically deploy their prerendered .data files to a CDN unless they can
    // tell that CDN to add special headers to those certain files - which is a
    // bit restrictive.
    throw new Error("Unable to decode turbo-stream response");
  }
}

// Note: If you change this function please change the corresponding
// encodeViaTurboStream function in server-runtime
export function decodeViaTurboStream(
  body: ReadableStream<Uint8Array>,
  global: Window | typeof globalThis
) {
  return decode(body, {
    plugins: [
      (type: string, ...rest: unknown[]) => {
        // Decode Errors back into Error instances using the right type and with
        // the right (potentially undefined) stacktrace
        if (type === "SanitizedError") {
          let [name, message, stack] = rest as [
            string,
            string,
            string | undefined
          ];
          let Constructor = Error;
          // @ts-expect-error
          if (name && name in global && typeof global[name] === "function") {
            // @ts-expect-error
            Constructor = global[name];
          }
          let error = new Constructor(message);
          error.stack = stack;
          return { value: error };
        }

        if (type === "ErrorResponse") {
          let [data, status, statusText] = rest as [
            unknown,
            number,
            string | undefined
          ];
          return {
            value: new ErrorResponseImpl(status, statusText, data),
          };
        }

        if (type === "SingleFetchRedirect") {
          return { value: { [SingleFetchRedirectSymbol]: rest[0] } };
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
