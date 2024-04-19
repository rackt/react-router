import type { StaticHandler } from "@remix-run/router";

import type {
  HandleErrorFunction,
  RenderToReadableStreamFunction,
  ReactServerBuild,
} from "./build";
import type { AppLoadContext } from "./data";
import { ServerMode } from "./mode";
import type { ServerRoute } from "./routes";
import { derive } from "./server";
import { singleFetchAction, singleFetchLoaders } from "./single-fetch";
import { getDevServerHooks } from "./dev";
import { matchServerRoutes } from "./routeMatching";

export type ReactRequestHandler = (
  request: Request,
  loadContext?: AppLoadContext
) => Promise<Response>;

export function createReactServerRequestHandler(
  _build: ReactServerBuild | (() => Promise<ReactServerBuild>),
  mode?: string,
  handleError?: HandleErrorFunction
): ReactRequestHandler {
  let build: ReactServerBuild;
  let routes: ServerRoute[];
  let serverMode: ServerMode;
  let staticHandler: StaticHandler;
  let errorHandler: HandleErrorFunction;
  let renderToReadableStream: RenderToReadableStreamFunction;

  return async (request, loadContext) => {
    build = typeof _build === "function" ? await _build() : _build;
    mode ??= build.mode;
    if (!build.entry.module.renderToReadableStream) {
      throw new Error(
        "The react server build does not have a renderToReadableStream function"
      );
    }
    renderToReadableStream = build.entry.module.renderToReadableStream;

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

    // Mark all successful responses with a header so we can identify in-flight
    // network errors that are missing this header
    let resultHeaders = new Headers(headers);
    resultHeaders.set("X-Remix-Response", "yes");
    resultHeaders.set("Content-Type", "text/x-component");

    // Note: Deferred data is already just Promises, so we don't have to mess
    // `activeDeferreds` or anything :)
    // TODO: Pass a signal
    return new Response(renderToReadableStream(result), {
      status: status || 200,
      headers: resultHeaders,
    });
  };
}
