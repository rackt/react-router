import type { StaticHandler } from "react-router";

import type { HandleErrorFunction, ReactServerBuild } from "./build";
import type { AppLoadContext } from "./data";
import { ServerMode } from "./mode";
import type { ServerRoute } from "./routes";
import { derive } from "./server";
import {
  singleFetchAction,
  singleFetchLoaders,
  getSingleFetchRedirect,
} from "./single-fetch";
import { getDevServerHooks } from "./dev";
import { matchServerRoutes } from "./routeMatching";

export type ReactRequestHandler = (
  request: Request,
  loadContext?: AppLoadContext
) => Promise<Response>;

export function createReactServerRequestHandler(
  _build: ReactServerBuild | (() => Promise<ReactServerBuild>),
  mode?: string
): ReactRequestHandler {
  let build: ReactServerBuild;
  let routes: ServerRoute[];
  let serverMode: ServerMode;
  let staticHandler: StaticHandler;
  let errorHandler: HandleErrorFunction;

  return async (request, loadContext) => {
    build = build ?? (typeof _build === "function" ? await _build() : _build);
    if (!build.entry.module.renderToReadableStream) {
      throw new Error(
        "The react server build does not have a renderToReadableStream function"
      );
    }
    let renderToReadableStream = build.entry.module.renderToReadableStream;
    let decodeAction = build.entry.module.decodeAction;
    let decodeFormState = build.entry.module.decodeFormState;
    let decodeReply = build.entry.module.decodeReply;

    if (typeof build === "function") {
      // TODO: TYPE THIS RIGHT
      let derived = derive(build as any, mode);
      routes = derived.routes;
      serverMode = derived.serverMode;
      staticHandler = derived.staticHandler;
      errorHandler = derived.errorHandler;
    } else if (!routes || !serverMode || !staticHandler || !errorHandler) {
      // TODO: TYPE THIS RIGHT
      let derived = derive(build as any, mode);
      routes = derived.routes;
      serverMode = derived.serverMode;
      staticHandler = derived.staticHandler;
      errorHandler = derived.errorHandler;
    }

    let handlerUrl = new URL(request.url);
    handlerUrl.pathname = handlerUrl.pathname
      .replace(/\.data$/, "")
      .replace(/^\/_root$/, "/");
    let matches = matchServerRoutes(
      routes,
      handlerUrl.pathname,
      build.basename
    );
    let params = matches && matches.length > 0 ? matches[0].params : {};
    let handleError = (error: unknown) => {
      if (mode === ServerMode.Development) {
        getDevServerHooks()?.processRequestError?.(error);
      }

      errorHandler(error, {
        context: loadContext || {},
        params,
        request,
      });
    };

    let resultStatus = 200;
    if (request.method === "POST") {
      let actionId = request.headers.get("rsc-action");
      if (actionId) {
        let [modId, ...actionNameParts] = actionId.split("#");
        let actionName = actionNameParts.join("#");
        const [action, args] = await Promise.all([
          build.serverReferences[modId]().then(
            (mod) => mod[actionName] as (...args: unknown[]) => Promise<unknown>
          ),
          decodeReply(await request.formData()),
        ]);

        try {
          const returnValue = action.apply(null, args);
          await returnValue;
          return new Response(renderToReadableStream({ returnValue }), {
            status: 200,
            headers: {
              "Content-Type": "text/x-component",
            },
          });
        } catch (reason) {
          if (reason instanceof Response) {
            return new Response(
              renderToReadableStream(
                getSingleFetchRedirect(reason.status, reason.headers)
              ),
              {
                status: 202,
                headers: {
                  "Content-Type": "text/x-component",
                },
              }
            );
          }

          handleError(reason);
          return new Response(renderToReadableStream(Promise.reject(reason)), {
            status: 500,
            headers: {
              "Content-Type": "text/x-component",
            },
          });
        }
      } else {
        const formData = await request.formData();
        const action = await decodeAction(formData);
        if (action) {
          try {
            await action();
          } catch (reason) {
            if (reason instanceof Response) {
              return new Response(
                renderToReadableStream(
                  getSingleFetchRedirect(reason.status, reason.headers)
                ),
                {
                  status: 202,
                  headers: {
                    "Content-Type": "text/x-component",
                  },
                }
              );
            }

            handleError(reason);
            resultStatus = 500;
          }
        }
        request = new Request(request.url, {
          method: "GET",
          headers: request.headers,
          signal: request.signal,
        });
      }
    }

    let { result, headers, status } =
      request.method !== "GET" && request.method !== "HEAD"
        ? await singleFetchAction(
            serverMode,
            staticHandler,
            request,
            handlerUrl,
            loadContext || {},
            handleError
          )
        : await singleFetchLoaders(
            serverMode,
            staticHandler,
            request,
            handlerUrl,
            loadContext || {},
            handleError
          );
    resultStatus = resultStatus > status ? resultStatus : status;

    // Mark all successful responses with a header so we can identify in-flight
    // network errors that are missing this header
    let resultHeaders = new Headers(headers);
    resultHeaders.set("X-Remix-Response", "yes");
    resultHeaders.set("Content-Type", "text/x-component");

    // Note: Deferred data is already just Promises, so we don't have to mess
    // `activeDeferreds` or anything :)
    // TODO: Pass a signal
    return new Response(renderToReadableStream(result), {
      status: resultStatus,
      headers: resultHeaders,
    });
  };
}
