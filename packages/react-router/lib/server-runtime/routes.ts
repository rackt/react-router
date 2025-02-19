import type {
  AgnosticDataRouteObject,
  LoaderFunctionArgs as RRLoaderFunctionArgs,
  ActionFunctionArgs as RRActionFunctionArgs,
  RouteManifest,
} from "../router/utils";
import { callRouteHandler } from "./data";
import type { FutureConfig } from "../dom/ssr/entry";
import type { Route } from "../dom/ssr/routes";
import type {
  SingleFetchResult,
  SingleFetchResults,
} from "../dom/ssr/single-fetch";
import { decodeViaTurboStream } from "../dom/ssr/single-fetch";
import invariant from "./invariant";
import type { ServerRouteModule } from "../dom/ssr/routeModules";

export type ServerRouteManifest = RouteManifest<Omit<ServerRoute, "children">>;

export interface ServerRoute extends Route {
  children: ServerRoute[];
  module: ServerRouteModule;
}

function groupRoutesByParentId(manifest: ServerRouteManifest) {
  let routes: Record<string, Omit<ServerRoute, "children">[]> = {};

  Object.values(manifest).forEach((route) => {
    if (route) {
      let parentId = route.parentId || "";
      if (!routes[parentId]) {
        routes[parentId] = [];
      }
      routes[parentId].push(route);
    }
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
      // Need to use RR's version in the param typed here to permit the optional
      // context even though we know it'll always be provided in remix
      loader: route.module.loader
        ? async (args: RRLoaderFunctionArgs) => {
            // If we're prerendering, use the data passed in from prerendering
            // the .data route so we dom't call loaders twice
            if (args.request.headers.has("X-React-Router-Prerender-Data")) {
              const preRenderedData = args.request.headers.get(
                "X-React-Router-Prerender-Data"
              );
              let encoded = preRenderedData
                ? decodeURI(preRenderedData)
                : preRenderedData;
              invariant(encoded, "Missing prerendered data for route");
              let uint8array = new TextEncoder().encode(encoded);
              let stream = new ReadableStream({
                start(controller) {
                  controller.enqueue(uint8array);
                  controller.close();
                },
              });
              let decoded: any = await decodeViaTurboStream(
                stream,
                global,
                future.turboV3 ?? false
              );
              let data = decoded as SingleFetchResults;
              invariant(
                data && route.id in data,
                "Unable to decode prerendered data"
              );
              let result = data[route.id] as SingleFetchResult;
              invariant("data" in result, "Unable to process prerendered data");
              return result.data;
            }
            let val = await callRouteHandler(route.module.loader!, args);
            return val;
          }
        : undefined,
      action: route.module.action
        ? (args: RRActionFunctionArgs) =>
            callRouteHandler(route.module.action!, args)
        : undefined,
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
