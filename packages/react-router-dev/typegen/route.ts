import type { RouteManifest, RouteManifestEntry } from "../config/routes";

export function lineage(
  routes: RouteManifest,
  route: RouteManifestEntry
): RouteManifestEntry[] {
  const result: RouteManifestEntry[] = [];
  while (route) {
    result.push(route);
    if (!route.parentId) break;
    route = routes[route.parentId];
  }
  result.reverse();
  return result;
}

export function fullpath(lineage: RouteManifestEntry[]) {
  if (lineage.length === 1 && lineage[0].id === "root") return "/";
  return (
    "/" +
    lineage
      .map((route) => route.path?.replace(/^\//, "")?.replace(/\/$/, ""))
      .filter((path) => path !== undefined && path !== "")
      .join("/")
  );
}
