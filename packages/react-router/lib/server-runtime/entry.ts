import type { RouteModules } from "../dom/ssr/routeModules";
import type { ServerRouteManifest } from "./routes";

export function createEntryRouteModules(
  manifest: ServerRouteManifest
): RouteModules {
  return Object.keys(manifest).reduce((memo, routeId) => {
    let route = manifest[routeId];
    if (route) {
      memo[routeId] = route.module;
    }
    return memo;
  }, {} as RouteModules);
}
