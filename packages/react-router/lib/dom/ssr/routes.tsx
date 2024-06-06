import * as React from "react";
import type {
  ActionFunctionArgs,
  HydrationState,
  LoaderFunctionArgs,
  ShouldRevalidateFunction,
} from "../../router";
import { UNSAFE_ErrorResponseImpl as ErrorResponse } from "../../router";

import type { RouteModule, RouteModules } from "./routeModules";
import { loadRouteModule } from "./routeModules";
import type { FutureConfig } from "./entry";
import { prefetchStyleLinks } from "./links";
import { RemixRootDefaultErrorBoundary } from "./errorBoundaries";
import { RemixRootDefaultHydrateFallback } from "./fallback";
import invariant from "./invariant";
import { useRouteError } from "../../hooks";
import type { DataRouteObject } from "../../context";

export interface RouteManifest<Route> {
  [routeId: string]: Route;
}

// NOTE: make sure to change the Route in server-runtime if you change this
interface Route {
  index?: boolean;
  caseSensitive?: boolean;
  id: string;
  parentId?: string;
  path?: string;
}

// NOTE: make sure to change the EntryRoute in server-runtime if you change this
export interface EntryRoute extends Route {
  hasAction: boolean;
  hasLoader: boolean;
  hasClientAction: boolean;
  hasClientLoader: boolean;
  hasErrorBoundary: boolean;
  imports?: string[];
  css?: string[];
  module: string;
  parentId?: string;
}

// Create a map of routes by parentId to use recursively instead of
// repeatedly filtering the manifest.
function groupRoutesByParentId(manifest: RouteManifest<EntryRoute>) {
  let routes: Record<string, Omit<EntryRoute, "children">[]> = {};

  Object.values(manifest).forEach((route) => {
    let parentId = route.parentId || "";
    if (!routes[parentId]) {
      routes[parentId] = [];
    }
    routes[parentId].push(route);
  });

  return routes;
}

function getRouteComponents(
  route: EntryRoute,
  routeModule: RouteModule,
  isSpaMode: boolean
) {
  let Component = getRouteModuleComponent(routeModule);
  // HydrateFallback can only exist on the root route in SPA Mode
  let HydrateFallback =
    routeModule.HydrateFallback && (!isSpaMode || route.id === "root")
      ? routeModule.HydrateFallback
      : route.id === "root"
      ? RemixRootDefaultHydrateFallback
      : undefined;
  let ErrorBoundary = routeModule.ErrorBoundary
    ? routeModule.ErrorBoundary
    : route.id === "root"
    ? () => <RemixRootDefaultErrorBoundary error={useRouteError()} />
    : undefined;

  if (route.id === "root" && routeModule.Layout) {
    return {
      ...(Component
        ? {
            element: (
              <routeModule.Layout>
                <Component />
              </routeModule.Layout>
            ),
          }
        : { Component }),
      ...(ErrorBoundary
        ? {
            errorElement: (
              <routeModule.Layout>
                <ErrorBoundary />
              </routeModule.Layout>
            ),
          }
        : { ErrorBoundary }),
      ...(HydrateFallback
        ? {
            hydrateFallbackElement: (
              <routeModule.Layout>
                <HydrateFallback />
              </routeModule.Layout>
            ),
          }
        : { HydrateFallback }),
    };
  }

  return { Component, ErrorBoundary, HydrateFallback };
}

export function createServerRoutes(
  manifest: RouteManifest<EntryRoute>,
  routeModules: RouteModules,
  future: FutureConfig,
  isSpaMode: boolean,
  parentId: string = "",
  routesByParentId: Record<
    string,
    Omit<EntryRoute, "children">[]
  > = groupRoutesByParentId(manifest),
  spaModeLazyPromise = Promise.resolve({ Component: () => null })
): DataRouteObject[] {
  return (routesByParentId[parentId] || []).map((route) => {
    let routeModule = routeModules[route.id];
    invariant(
      routeModule,
      "No `routeModule` available to create server routes"
    );

    let dataRoute: DataRouteObject = {
      ...getRouteComponents(route, routeModule, isSpaMode),
      caseSensitive: route.caseSensitive,
      id: route.id,
      index: route.index,
      path: route.path,
      handle: routeModule.handle,
      // For SPA Mode, all routes are lazy except root.  However we tell the
      // router root is also lazy here too since we don't need a full
      // implementation - we just need a `lazy` prop to tell the RR rendering
      // where to stop which is always at the root route in SPA mode
      lazy: isSpaMode ? () => spaModeLazyPromise : undefined,
      // For partial hydration rendering, we need to indicate when the route
      // has a loader/clientLoader, but it won't ever be called during the static
      // render, so just give it a no-op function so we can render down to the
      // proper fallback
      loader: route.hasLoader || route.hasClientLoader ? true : undefined,
      // We don't need action/shouldRevalidate on these routes since they're
      // for a static render
    };

    let children = createServerRoutes(
      manifest,
      routeModules,
      future,
      isSpaMode,
      route.id,
      routesByParentId,
      spaModeLazyPromise
    );
    if (children.length > 0) dataRoute.children = children;
    return dataRoute;
  });
}

export function createClientRoutesWithHMRRevalidationOptOut(
  needsRevalidation: Set<string>,
  manifest: RouteManifest<EntryRoute>,
  routeModulesCache: RouteModules,
  initialState: HydrationState,
  future: FutureConfig,
  isSpaMode: boolean
) {
  return createClientRoutes(
    manifest,
    routeModulesCache,
    initialState,
    future,
    isSpaMode,
    "",
    groupRoutesByParentId(manifest),
    needsRevalidation
  );
}

function preventInvalidServerHandlerCall(
  type: "action" | "loader",
  route: Omit<EntryRoute, "children">,
  isSpaMode: boolean
) {
  if (isSpaMode) {
    let fn = type === "action" ? "serverAction()" : "serverLoader()";
    let msg = `You cannot call ${fn} in SPA Mode (routeId: "${route.id}")`;
    console.error(msg);
    throw new ErrorResponse(400, "Bad Request", new Error(msg), true);
  }

  let fn = type === "action" ? "serverAction()" : "serverLoader()";
  let msg =
    `You are trying to call ${fn} on a route that does not have a server ` +
    `${type} (routeId: "${route.id}")`;
  if (
    (type === "loader" && !route.hasLoader) ||
    (type === "action" && !route.hasAction)
  ) {
    console.error(msg);
    throw new ErrorResponse(400, "Bad Request", new Error(msg), true);
  }
}

function noActionDefinedError(
  type: "action" | "clientAction",
  routeId: string
) {
  let article = type === "clientAction" ? "a" : "an";
  let msg =
    `Route "${routeId}" does not have ${article} ${type}, but you are trying to ` +
    `submit to it. To fix this, please add ${article} \`${type}\` function to the route`;
  console.error(msg);
  throw new ErrorResponse(405, "Method Not Allowed", new Error(msg), true);
}

export function createClientRoutes(
  manifest: RouteManifest<EntryRoute>,
  routeModulesCache: RouteModules,
  initialState: HydrationState,
  future: FutureConfig,
  isSpaMode: boolean,
  parentId: string = "",
  routesByParentId: Record<
    string,
    Omit<EntryRoute, "children">[]
  > = groupRoutesByParentId(manifest),
  needsRevalidation?: Set<string>
): DataRouteObject[] {
  return (routesByParentId[parentId] || []).map((route) => {
    let routeModule = routeModulesCache[route.id];

    function fetchServerHandler(singleFetch: unknown) {
      invariant(
        typeof singleFetch === "function",
        "No single fetch function available for route handler"
      );
      return singleFetch();
    }

    function fetchServerLoader(singleFetch: unknown) {
      if (!route.hasLoader) return Promise.resolve(null);
      return fetchServerHandler(singleFetch);
    }

    function fetchServerAction(singleFetch: unknown) {
      if (!route.hasAction) {
        throw noActionDefinedError("action", route.id);
      }
      return fetchServerHandler(singleFetch);
    }

    async function prefetchStylesAndCallHandler(
      handler: () => Promise<unknown>
    ) {
      // Only prefetch links if we exist in the routeModulesCache (critical modules
      // and navigating back to pages previously loaded via route.lazy).  Initial
      // execution of route.lazy (when the module is not in the cache) will handle
      // prefetching style links via loadRouteModuleWithBlockingLinks.
      let cachedModule = routeModulesCache[route.id];
      let linkPrefetchPromise = cachedModule
        ? prefetchStyleLinks(route, cachedModule)
        : Promise.resolve();
      try {
        return handler();
      } finally {
        await linkPrefetchPromise;
      }
    }

    let dataRoute: DataRouteObject = {
      id: route.id,
      index: route.index,
      path: route.path,
    };

    if (routeModule) {
      // Use critical path modules directly
      Object.assign(dataRoute, {
        ...dataRoute,
        ...getRouteComponents(route, routeModule, isSpaMode),
        handle: routeModule.handle,
        shouldRevalidate: needsRevalidation
          ? wrapShouldRevalidateForHdr(
              route.id,
              routeModule.shouldRevalidate,
              needsRevalidation
            )
          : routeModule.shouldRevalidate,
      });

      let initialData = initialState?.loaderData?.[route.id];
      let initialError = initialState?.errors?.[route.id];
      let isHydrationRequest =
        needsRevalidation == null &&
        (routeModule.clientLoader?.hydrate === true || !route.hasLoader);

      dataRoute.loader = async (
        { request, params }: LoaderFunctionArgs,
        singleFetch?: unknown
      ) => {
        try {
          let result = await prefetchStylesAndCallHandler(async () => {
            invariant(
              routeModule,
              "No `routeModule` available for critical-route loader"
            );
            if (!routeModule.clientLoader) {
              if (isSpaMode) return null;
              // Call the server when no client loader exists
              return fetchServerLoader(singleFetch);
            }

            return routeModule.clientLoader({
              request,
              params,
              async serverLoader() {
                preventInvalidServerHandlerCall("loader", route, isSpaMode);

                // On the first call, resolve with the server result
                if (isHydrationRequest) {
                  if (initialError !== undefined) {
                    throw initialError;
                  }
                  return initialData;
                }

                // Call the server loader for client-side navigations
                return fetchServerLoader(singleFetch);
              },
            });
          });
          return result;
        } finally {
          // Whether or not the user calls `serverLoader`, we only let this
          // stick around as true for one loader call
          isHydrationRequest = false;
        }
      };

      // Let React Router know whether to run this on hydration
      dataRoute.loader.hydrate = shouldHydrateRouteLoader(
        route,
        routeModule,
        isSpaMode
      );

      dataRoute.action = (
        { request, params }: ActionFunctionArgs,
        singleFetch?: unknown
      ) => {
        return prefetchStylesAndCallHandler(async () => {
          invariant(
            routeModule,
            "No `routeModule` available for critical-route action"
          );
          if (!routeModule.clientAction) {
            if (isSpaMode) {
              throw noActionDefinedError("clientAction", route.id);
            }
            return fetchServerAction(singleFetch);
          }

          return routeModule.clientAction({
            request,
            params,
            async serverAction() {
              preventInvalidServerHandlerCall("action", route, isSpaMode);
              return fetchServerAction(singleFetch);
            },
          });
        });
      };
    } else {
      // If the lazy route does not have a client loader/action we want to call
      // the server loader/action in parallel with the module load so we add
      // loader/action as static props on the route
      if (!route.hasClientLoader) {
        dataRoute.loader = (
          { request }: LoaderFunctionArgs,
          singleFetch?: unknown
        ) =>
          prefetchStylesAndCallHandler(() => {
            if (isSpaMode) return Promise.resolve(null);
            return fetchServerLoader(singleFetch);
          });
      }
      if (!route.hasClientAction) {
        dataRoute.action = (
          { request }: ActionFunctionArgs,
          singleFetch?: unknown
        ) =>
          prefetchStylesAndCallHandler(() => {
            if (isSpaMode) {
              throw noActionDefinedError("clientAction", route.id);
            }
            return fetchServerAction(singleFetch);
          });
      }

      // Load all other modules via route.lazy()
      dataRoute.lazy = async () => {
        let mod = await loadRouteModuleWithBlockingLinks(
          route,
          routeModulesCache
        );

        let lazyRoute: Partial<DataRouteObject> = { ...mod };
        if (mod.clientLoader) {
          let clientLoader = mod.clientLoader;
          lazyRoute.loader = (
            args: LoaderFunctionArgs,
            singleFetch?: unknown
          ) =>
            clientLoader({
              ...args,
              async serverLoader() {
                preventInvalidServerHandlerCall("loader", route, isSpaMode);
                return fetchServerLoader(singleFetch);
              },
            });
        }

        if (mod.clientAction) {
          let clientAction = mod.clientAction;
          lazyRoute.action = (
            args: ActionFunctionArgs,
            singleFetch?: unknown
          ) =>
            clientAction({
              ...args,
              async serverAction() {
                preventInvalidServerHandlerCall("action", route, isSpaMode);
                return fetchServerAction(singleFetch);
              },
            });
        }

        if (needsRevalidation) {
          lazyRoute.shouldRevalidate = wrapShouldRevalidateForHdr(
            route.id,
            mod.shouldRevalidate,
            needsRevalidation
          );
        }

        return {
          ...(lazyRoute.loader ? { loader: lazyRoute.loader } : {}),
          ...(lazyRoute.action ? { action: lazyRoute.action } : {}),
          hasErrorBoundary: lazyRoute.hasErrorBoundary,
          shouldRevalidate: lazyRoute.shouldRevalidate,
          handle: lazyRoute.handle,
          // No need to wrap these in layout since the root route is never
          // loaded via route.lazy()
          Component: lazyRoute.Component,
          ErrorBoundary: lazyRoute.ErrorBoundary,
        };
      };
    }

    let children = createClientRoutes(
      manifest,
      routeModulesCache,
      initialState,
      future,
      isSpaMode,
      route.id,
      routesByParentId,
      needsRevalidation
    );
    if (children.length > 0) dataRoute.children = children;
    return dataRoute;
  });
}

// When an HMR / HDR update happens we opt out of all user-defined
// revalidation logic and force a revalidation on the first call
function wrapShouldRevalidateForHdr(
  routeId: string,
  routeShouldRevalidate: ShouldRevalidateFunction | undefined,
  needsRevalidation: Set<string>
): ShouldRevalidateFunction {
  let handledRevalidation = false;
  return (arg) => {
    if (!handledRevalidation) {
      handledRevalidation = true;
      return needsRevalidation.has(routeId);
    }

    return routeShouldRevalidate
      ? routeShouldRevalidate(arg)
      : arg.defaultShouldRevalidate;
  };
}

async function loadRouteModuleWithBlockingLinks(
  route: EntryRoute,
  routeModules: RouteModules
) {
  let routeModule = await loadRouteModule(route, routeModules);
  await prefetchStyleLinks(route, routeModule);

  // Include all `browserSafeRouteExports` fields, except `HydrateFallback`
  // since those aren't used on lazily loaded routes
  return {
    Component: getRouteModuleComponent(routeModule),
    ErrorBoundary: routeModule.ErrorBoundary,
    clientAction: routeModule.clientAction,
    clientLoader: routeModule.clientLoader,
    handle: routeModule.handle,
    links: routeModule.links,
    meta: routeModule.meta,
    shouldRevalidate: routeModule.shouldRevalidate,
  };
}

// Our compiler generates the default export as `{}` when no default is provided,
// which can lead us to trying to use that as a Component in RR and calling
// createElement on it.  Patching here as a quick fix and hoping it's no longer
// an issue in Vite.
function getRouteModuleComponent(routeModule: RouteModule) {
  if (routeModule.default == null) return undefined;
  let isEmptyObject =
    typeof routeModule.default === "object" &&
    Object.keys(routeModule.default).length === 0;
  if (!isEmptyObject) {
    return routeModule.default;
  }
}

export function shouldHydrateRouteLoader(
  route: EntryRoute,
  routeModule: RouteModule,
  isSpaMode: boolean
) {
  return (
    (isSpaMode && route.id !== "root") ||
    (routeModule.clientLoader != null &&
      (routeModule.clientLoader.hydrate === true || route.hasLoader !== true))
  );
}
