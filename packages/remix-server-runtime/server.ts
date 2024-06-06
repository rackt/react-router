import type { ErrorResponse, StaticHandler } from "react-router";
import {
  UNSAFE_DEFERRED_SYMBOL as DEFERRED_SYMBOL,
  getStaticContextFromError,
  isRouteErrorResponse,
  createStaticHandler,
  json as routerJson,
  stripBasename,
  UNSAFE_ErrorResponseImpl as ErrorResponseImpl,
} from "react-router";

import type { AppLoadContext } from "./data";
import type { HandleErrorFunction, ServerBuild } from "./build";
import type { EntryContext } from "./entry";
import { createEntryRouteModules } from "./entry";
import { sanitizeErrors, serializeError, serializeErrors } from "./errors";
import invariant from "./invariant";
import { ServerMode, isServerMode } from "./mode";
import { matchServerRoutes } from "./routeMatching";
import type { ServerRoute } from "./routes";
import { createStaticHandlerDataRoutes, createRoutes } from "./routes";
import {
  isRedirectResponse,
  isRedirectStatusCode,
  isResponse,
} from "./responses";
import { createServerHandoffString } from "./serverHandoff";
import { getDevServerHooks } from "./dev";
import type { SingleFetchResult, SingleFetchResults } from "./single-fetch";
import {
  encodeViaTurboStream,
  getResponseStubs,
  getSingleFetchDataStrategy,
  getSingleFetchRedirect,
  getSingleFetchResourceRouteDataStrategy,
  isResponseStub,
  mergeResponseStubs,
  singleFetchAction,
  singleFetchLoaders,
  SingleFetchRedirectSymbol,
  ResponseStubOperationsSymbol,
} from "./single-fetch";
import type { CallReactServer } from "./single-fetch-rsc";
import { getServerComponentsDataStrategy } from "./single-fetch-rsc";

export type RequestHandler = (
  request: Request,
  loadContext?: AppLoadContext
) => Promise<Response>;

export type CreateRequestHandlerFunction = (
  build: ServerBuild | (() => ServerBuild | Promise<ServerBuild>),
  mode?: string,
  callReactServer?: CallReactServer
) => RequestHandler;

export function derive(build: ServerBuild, mode?: string) {
  let routes = createRoutes(build.routes);
  let dataRoutes = createStaticHandlerDataRoutes(build.routes, build.future);
  let serverMode = isServerMode(mode) ? mode : ServerMode.Production;
  let staticHandler = createStaticHandler(dataRoutes, {
    basename: build.basename,
    future: {
      v7_relativeSplatPath: build.future?.v3_relativeSplatPath === true,
      v7_throwAbortReason: build.future?.v3_throwAbortReason === true,
    },
  });

  let errorHandler =
    build.entry.module.handleError ||
    ((error, { request }) => {
      if (serverMode !== ServerMode.Test && !request.signal.aborted) {
        console.error(
          // @ts-expect-error This is "private" from users but intended for internal use
          isRouteErrorResponse(error) && error.error ? error.error : error
        );
      }
    });
  return {
    routes,
    dataRoutes,
    serverMode,
    staticHandler,
    errorHandler,
  };
}

export const createRequestHandler: CreateRequestHandlerFunction = (
  build,
  mode,
  callReactServer
) => {
  let _build: ServerBuild;
  let routes: ServerRoute[];
  let serverMode: ServerMode;
  let staticHandler: StaticHandler;
  let errorHandler: HandleErrorFunction;

  return async function requestHandler(request, loadContext = {}) {
    _build = typeof build === "function" ? await build() : build;
    if (typeof build === "function") {
      let derived = derive(_build, mode);
      routes = derived.routes;
      serverMode = derived.serverMode;
      staticHandler = derived.staticHandler;
      errorHandler = derived.errorHandler;
    } else if (!routes || !serverMode || !staticHandler || !errorHandler) {
      let derived = derive(_build, mode);
      routes = derived.routes;
      serverMode = derived.serverMode;
      staticHandler = derived.staticHandler;
      errorHandler = derived.errorHandler;
    }

    if (_build.future.unstable_serverComponents && !callReactServer) {
      throw new Error(
        "You must provide a `callReactServer` function when using server components."
      );
    }

    let url = new URL(request.url);

    let matches = matchServerRoutes(routes, url.pathname, _build.basename);
    let params = matches && matches.length > 0 ? matches[0].params : {};
    let handleError = (error: unknown) => {
      if (mode === ServerMode.Development) {
        getDevServerHooks()?.processRequestError?.(error);
      }

      errorHandler(error, {
        context: loadContext,
        params,
        request,
      });
    };

    let response: Response;

    let actionId = request.headers.get("rsc-action");
    if (
      _build.future.unstable_serverComponents &&
      request.method === "POST" &&
      actionId
    ) {
      if (!callReactServer) {
        throw new Error(
          "callReactServer is required for server component builds"
        );
      }
      return callReactServer(request.url, {
        headers: request.headers,
        method: request.method,
        signal: request.signal,
        body: request.body,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
    }

    if (url.pathname.endsWith(".data")) {
      let handlerUrl = new URL(request.url);
      handlerUrl.pathname = handlerUrl.pathname
        .replace(/\.data$/, "")
        .replace(/^\/_root$/, "/");

      let singleFetchMatches = matchServerRoutes(
        routes,
        handlerUrl.pathname,
        _build.basename
      );

      if (_build.future.unstable_serverComponents) {
        invariant(callReactServer, "callReactServer is required");
        let init: RequestInit & { duplex?: "half" } = {
          headers: request.headers,
          method: request.method,
        };
        if (
          request.method !== "GET" &&
          request.method !== "HEAD" &&
          request.body
        ) {
          init.body = request.body;
          init.duplex = "half";
        }
        return callReactServer(request.url, init);
      } else {
        response = await handleSingleFetchRequest(
          serverMode,
          _build,
          staticHandler,
          request,
          handlerUrl,
          loadContext,
          handleError
        );
      }

      if (_build.entry.module.handleDataRequest) {
        response = await _build.entry.module.handleDataRequest(response, {
          context: loadContext,
          params: singleFetchMatches ? singleFetchMatches[0].params : {},
          request,
        });

        if (isRedirectResponse(response)) {
          let result: SingleFetchResult | SingleFetchResults =
            getSingleFetchRedirect(response.status, response.headers);

          if (request.method === "GET") {
            result = {
              [SingleFetchRedirectSymbol]: result,
            };
          }
          let headers = new Headers(response.headers);
          headers.set("Content-Type", "text/x-turbo");

          return new Response(
            encodeViaTurboStream(
              result,
              request.signal,
              _build.entry.module.streamTimeout,
              serverMode
            ),
            {
              status: 200,
              headers,
            }
          );
        }
      }
    } else if (
      matches &&
      matches[matches.length - 1].route.module.default == null &&
      matches[matches.length - 1].route.module.ErrorBoundary == null
    ) {
      response = await handleResourceRequest(
        serverMode,
        _build,
        staticHandler,
        matches.slice(-1)[0].route.id,
        request,
        loadContext,
        handleError
      );
    } else {
      let criticalCss =
        mode === ServerMode.Development
          ? await getDevServerHooks()?.getCriticalCss?.(_build, url.pathname)
          : undefined;

      response = await handleDocumentRequest(
        serverMode,
        _build,
        staticHandler,
        request,
        loadContext,
        handleError,
        criticalCss,
        callReactServer
      );
    }

    if (request.method === "HEAD") {
      return new Response(null, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    }

    return response;
  };
};

async function handleSingleFetchRequest(
  serverMode: ServerMode,
  build: ServerBuild,
  staticHandler: StaticHandler,
  request: Request,
  handlerUrl: URL,
  loadContext: AppLoadContext,
  handleError: (err: unknown) => void
): Promise<Response> {
  let { result, headers, status } =
    request.method !== "GET" && request.method !== "HEAD"
      ? await singleFetchAction(
          serverMode,
          staticHandler,
          request,
          handlerUrl,
          loadContext,
          handleError
        )
      : await singleFetchLoaders(
          serverMode,
          staticHandler,
          request,
          handlerUrl,
          loadContext,
          handleError
        );

  // Mark all successful responses with a header so we can identify in-flight
  // network errors that are missing this header
  let resultHeaders = new Headers(headers);
  resultHeaders.set("X-Remix-Response", "yes");
  resultHeaders.set("Content-Type", "text/x-turbo");

  // Note: Deferred data is already just Promises, so we don't have to mess
  // `activeDeferreds` or anything :)
  return new Response(
    encodeViaTurboStream(
      result,
      request.signal,
      build.entry.module.streamTimeout,
      serverMode
    ),
    {
      status: status || 200,
      headers: resultHeaders,
    }
  );
}

async function handleDocumentRequest(
  serverMode: ServerMode,
  build: ServerBuild,
  staticHandler: StaticHandler,
  request: Request,
  loadContext: AppLoadContext,
  handleError: (err: unknown) => void,
  criticalCss?: string,
  callReactServer?: CallReactServer
) {
  let context;
  let responseStubs = getResponseStubs();

  let rscLoaderStream = undefined as
    | ReadableStream<Uint8Array>
    | null
    | undefined;
  let rscActionId: string | null = null;
  let rscActionStream = undefined as
    | ReadableStream<Uint8Array>
    | null
    | undefined;
  const serverComponents = build.future.unstable_serverComponents;
  if (serverComponents && !callReactServer) {
    throw new Error(
      "callReactServer is required for this server component builds"
    );
  }

  try {
    context = await staticHandler.query(request, {
      requestContext: loadContext,
      unstable_dataStrategy: serverComponents
        ? getServerComponentsDataStrategy(
            responseStubs,
            build.entry.module.createFromReadableStream!,
            callReactServer!,
            (resultStream) => {
              // TODO: This is never called if there are no loaders is any of the matches
              rscLoaderStream = resultStream;
            },
            (actionId, resultStream) => {
              rscActionId = actionId;
              rscActionStream = resultStream;
            }
          )
        : getSingleFetchDataStrategy(responseStubs),
    });
  } catch (error: unknown) {
    handleError(error);
    return new Response(null, { status: 500 });
  }

  if (isResponse(context)) {
    return context;
  }

  let merged = mergeResponseStubs(context, responseStubs);
  let statusCode = merged.statusCode;
  let headers = merged.headers;

  if (isRedirectStatusCode(statusCode) && headers.has("Location")) {
    return new Response(null, {
      status: statusCode,
      headers,
    });
  }

  // Sanitize errors outside of development environments
  if (context.errors) {
    Object.values(context.errors).forEach((err) => {
      // @ts-expect-error This is "private" from users but intended for internal use
      if ((!isRouteErrorResponse(err) || err.error) && !isResponseStub(err)) {
        handleError(err);
      }
    });
    context.errors = sanitizeErrors(context.errors, serverMode);
  }

  // Server UI state to send to the client.
  // - When single fetch is enabled, this is streamed down via `serverHandoffStream`
  // - Otherwise it's stringified into `serverHandoffString`
  let state = {
    loaderData: context.loaderData,
    actionData: context.actionData,
    errors: serializeErrors(context.errors, serverMode),
  };
  let streamHandoff: Pick<
    EntryContext,
    | "serverHandoffStream"
    | "serverHandoffActionId"
    | "serverHandoffStreamAction"
    | "renderMeta"
  > | null = null;
  if (build.future.unstable_serverComponents) {
    if (!rscLoaderStream) {
      throw new Error("No RSC stream");
    }
    streamHandoff = {
      serverHandoffStream: rscLoaderStream,
      serverHandoffActionId: rscActionId ?? undefined,
      serverHandoffStreamAction: rscActionStream ?? undefined,
      renderMeta: {},
    };
  } else {
    streamHandoff = {
      serverHandoffStream: encodeViaTurboStream(
        state,
        request.signal,
        build.entry.module.streamTimeout,
        serverMode
      ),
      renderMeta: {},
    };
  }

  let entryContext: EntryContext = {
    manifest: build.assets,
    routeModules: createEntryRouteModules(build.routes),
    staticHandlerContext: context,
    criticalCss,
    serverHandoffString: createServerHandoffString({
      url: context.location.pathname,
      basename: build.basename,
      criticalCss,
      future: build.future,
      isSpaMode: build.isSpaMode,
    }),
    serverHandoffActionId: streamHandoff?.serverHandoffActionId,
    serverHandoffStream: encodeViaTurboStream(
      state,
      request.signal,
      build.entry.module.streamTimeout,
      serverMode
    ),
    renderMeta: {},
    future: build.future,
    isSpaMode: build.isSpaMode,
    serializeError: (err) => serializeError(err, serverMode),
    ...streamHandoff,
  };

  let handleDocumentRequestFunction = build.entry.module.default;
  try {
    return await handleDocumentRequestFunction(
      request,
      statusCode,
      headers,
      entryContext,
      loadContext
    );
  } catch (error: unknown) {
    handleError(error);

    let errorForSecondRender = error;

    // If they threw a response, unwrap it into an ErrorResponse like we would
    // have for a loader/action
    if (isResponse(error)) {
      try {
        let data = await unwrapResponse(error);
        errorForSecondRender = new ErrorResponseImpl(
          error.status,
          error.statusText,
          data
        );
      } catch (e) {
        // If we can't unwrap the response - just leave it as-is
      }
    }

    // Get a new StaticHandlerContext that contains the error at the right boundary
    context = getStaticContextFromError(
      staticHandler.dataRoutes,
      context,
      errorForSecondRender
    );

    // Sanitize errors outside of development environments
    if (context.errors) {
      context.errors = sanitizeErrors(context.errors, serverMode);
    }

    // Get a new entryContext for the second render pass
    // Server UI state to send to the client.
    // - When single fetch is enabled, this is streamed down via `serverHandoffStream`
    // - Otherwise it's stringified into `serverHandoffString`
    let state = {
      loaderData: context.loaderData,
      actionData: context.actionData,
      errors: serializeErrors(context.errors, serverMode),
    };
    entryContext = {
      ...entryContext,
      staticHandlerContext: context,
      serverHandoffString: createServerHandoffString({
        url: context.location.pathname,
        basename: build.basename,
        future: build.future,
        isSpaMode: build.isSpaMode,
      }),
      serverHandoffStream: encodeViaTurboStream(
        state,
        request.signal,
        build.entry.module.streamTimeout,
        serverMode
      ),
      renderMeta: {},
    };

    try {
      return await handleDocumentRequestFunction(
        request,
        context.statusCode,
        headers,
        entryContext,
        loadContext
      );
    } catch (error: any) {
      handleError(error);
      return returnLastResortErrorResponse(error, serverMode);
    }
  }
}

async function handleResourceRequest(
  serverMode: ServerMode,
  build: ServerBuild,
  staticHandler: StaticHandler,
  routeId: string,
  request: Request,
  loadContext: AppLoadContext,
  handleError: (err: unknown) => void
) {
  try {
    let responseStubs = getResponseStubs();
    // Note we keep the routeId here to align with the Remix handling of
    // resource routes which doesn't take ?index into account and just takes
    // the leaf match
    let response = await staticHandler.queryRoute(request, {
      routeId,
      requestContext: loadContext,
      unstable_dataStrategy: getSingleFetchResourceRouteDataStrategy({
        responseStubs,
      }),
    });

    if (typeof response === "object") {
      invariant(
        !(DEFERRED_SYMBOL in response),
        `You cannot return a \`defer()\` response from a Resource Route.  Did you ` +
          `forget to export a default UI component from the "${routeId}" route?`
      );
    }

    invariant(
      isResponse(response),
      "Expected a Response to be returned from resource route handler"
    );

    let stub = responseStubs[routeId];
    // Use the response status and merge any response stub headers onto it
    let ops = stub[ResponseStubOperationsSymbol];
    for (let [op, ...args] of ops) {
      // @ts-expect-error
      response.headers[op](...args);
    }

    return response;
  } catch (error: unknown) {
    if (isResponse(error)) {
      // Note: Not functionally required but ensures that our response headers
      // match identically to what Remix returns
      error.headers.set("X-Remix-Catch", "yes");
      return error;
    }

    if (isRouteErrorResponse(error)) {
      if (error) {
        handleError(error);
      }
      return errorResponseToJson(error, serverMode);
    }

    handleError(error);
    return returnLastResortErrorResponse(error, serverMode);
  }
}

function errorResponseToJson(
  errorResponse: ErrorResponse,
  serverMode: ServerMode
): Response {
  return routerJson(
    serializeError(
      // @ts-expect-error This is "private" from users but intended for internal use
      errorResponse.error || new Error("Unexpected Server Error"),
      serverMode
    ),
    {
      status: errorResponse.status,
      statusText: errorResponse.statusText,
      headers: {
        "X-Remix-Error": "yes",
      },
    }
  );
}

function returnLastResortErrorResponse(error: any, serverMode?: ServerMode) {
  let message = "Unexpected Server Error";

  if (serverMode !== ServerMode.Production) {
    message += `\n\n${String(error)}`;
  }

  // Good grief folks, get your act together 😂!
  return new Response(message, {
    status: 500,
    headers: {
      "Content-Type": "text/plain",
    },
  });
}

function unwrapResponse(response: Response) {
  let contentType = response.headers.get("Content-Type");
  // Check between word boundaries instead of startsWith() due to the last
  // paragraph of https://httpwg.org/specs/rfc9110.html#field.content-type
  return contentType && /\bapplication\/json\b/.test(contentType)
    ? response.body == null
      ? null
      : response.json()
    : response.text();
}

function createRemixRedirectResponse(
  response: Response,
  basename: string | undefined
) {
  // We don't have any way to prevent a fetch request from following
  // redirects. So we use the `X-Remix-Redirect` header to indicate the
  // next URL, and then "follow" the redirect manually on the client.
  let headers = new Headers(response.headers);
  let redirectUrl = headers.get("Location")!;
  headers.set(
    "X-Remix-Redirect",
    basename ? stripBasename(redirectUrl, basename) || redirectUrl : redirectUrl
  );
  headers.set("X-Remix-Status", String(response.status));
  headers.delete("Location");
  if (response.headers.get("Set-Cookie") !== null) {
    headers.set("X-Remix-Revalidate", "yes");
  }

  return new Response(null, {
    status: 204,
    headers,
  });
}
