import type {
  AgnosticDataRouteObject,
  LoaderFunctionArgs as RRLoaderFunctionArgs,
  ActionFunctionArgs as RRActionFunctionArgs,
} from "react-router";

import { callRouteAction, callRouteLoader } from "./data";
import type { FutureConfig } from "./entry";
import type { ServerRouteModule } from "./routeModules";
import type { DataStrategyCtx } from "./single-fetch";

export interface RouteManifest<Route> {
  [routeId: string]: Route;
}

export type ServerRouteManifest = RouteManifest<Omit<ServerRoute, "children">>;

// NOTE: make sure to change the Route in remix-react/remix-dev if you change this
export interface Route {
  index?: boolean;
  caseSensitive?: boolean;
  id: string;
  parentId?: string;
  path?: string;
}

// NOTE: make sure to change the EntryRoute in remix-react/remix-dev if you change this
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

export interface ServerRoute extends Route {
  children: ServerRoute[];
  module: ServerRouteModule;
}

function groupRoutesByParentId(manifest: ServerRouteManifest) {
  let routes: Record<string, Omit<ServerRoute, "children">[]> = {};

  Object.values(manifest).forEach((route) => {
    let parentId = route.parentId || "";
    if (!routes[parentId]) {
      routes[parentId] = [];
    }
    routes[parentId].push(route);
  });

  return routes;
}

// Create a map of routes by parentId to use recursively instead of
// repeatedly filtering the manifest.
export function createRoutes(
  manifest: ServerRouteManifest,
  parentId: string = "",
  routesByParentId: Record<
    string,
    Omit<ServerRoute, "children">[]
  > = groupRoutesByParentId(manifest)
): ServerRoute[] {
  return (routesByParentId[parentId] || []).map((route) => ({
    ...route,
    children: createRoutes(manifest, route.id, routesByParentId),
  }));
}

// Convert the Remix ServerManifest into DataRouteObject's for use with
// createStaticHandler
export function createStaticHandlerDataRoutes(
  manifest: ServerRouteManifest,
  future: FutureConfig,
  parentId: string = "",
  routesByParentId: Record<
    string,
    Omit<ServerRoute, "children">[]
  > = groupRoutesByParentId(manifest)
): AgnosticDataRouteObject[] {
  return (routesByParentId[parentId] || []).map((route) => {
    let commonRoute = {
      // Always include root due to default boundaries
      hasErrorBoundary:
        route.id === "root" || route.module.ErrorBoundary != null,
      id: route.id,
      path: route.path,
      loader:
        typeof route.module.loader === "function"
          ? // Need to use RR's version here to permit the optional context even
            // though we know it'll always be provided in remix
            (args: RRLoaderFunctionArgs, dataStrategyCtx?: unknown) =>
              callRouteLoader({
                request: args.request,
                params: args.params,
                loadContext: args.context,
                loader: route.module.loader!,
                routeId: route.id,
                response: (dataStrategyCtx as DataStrategyCtx).response,
              })
          : route.module.loader,
      action:
        typeof route.module.action === "function"
          ? (args: RRActionFunctionArgs, dataStrategyCtx?: unknown) =>
              callRouteAction({
                request: args.request,
                params: args.params,
                loadContext: args.context,
                action: route.module.action!,
                routeId: route.id,
                response: (dataStrategyCtx as DataStrategyCtx).response,
              })
          : route.module.action,
      handle: route.module.handle,
    };

    return route.index
      ? {
          index: true,
          ...commonRoute,
        }
      : {
          caseSensitive: route.caseSensitive,
          children: createStaticHandlerDataRoutes(
            manifest,
            future,
            route.id,
            routesByParentId
          ),
          ...commonRoute,
        };
  });
}
