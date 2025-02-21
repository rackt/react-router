import * as path from "node:path";
import { matchRoutes } from "react-router";
import type { ModuleNode, ViteDevServer } from "vite";

import type { ResolvedReactRouterConfig } from "../config/config";
import type { RouteManifest, RouteManifestEntry } from "../config/routes";
import type { LoadCssContents } from "./plugin";
import { resolveFileUrl } from "./resolve-file-url";

// Style collection logic adapted from solid-start: https://github.com/solidjs/solid-start

// Vite doesn't expose these so we just copy the list for now
// https://github.com/vitejs/vite/blob/d6bde8b03d433778aaed62afc2be0630c8131908/packages/vite/src/node/constants.ts#L49C23-L50
const cssFileRegExp =
  /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
// https://github.com/vitejs/vite/blob/d6bde8b03d433778aaed62afc2be0630c8131908/packages/vite/src/node/plugins/css.ts#L160
const cssModulesRegExp = new RegExp(`\\.module${cssFileRegExp.source}`);

const isCssFile = (file: string) => cssFileRegExp.test(file);
export const isCssModulesFile = (file: string) => cssModulesRegExp.test(file);

// https://vitejs.dev/guide/features#disabling-css-injection-into-the-page
// https://github.com/vitejs/vite/blob/561b940f6f963fbb78058a6e23b4adad53a2edb9/packages/vite/src/node/plugins/css.ts#L194
// https://vitejs.dev/guide/features#static-assets
// https://github.com/vitejs/vite/blob/561b940f6f963fbb78058a6e23b4adad53a2edb9/packages/vite/src/node/utils.ts#L309-L310
const cssUrlParamsWithoutSideEffects = ["url", "inline", "raw", "inline-css"];
export const isCssUrlWithoutSideEffects = (url: string) => {
  let queryString = url.split("?")[1];

  if (!queryString) {
    return false;
  }

  let params = new URLSearchParams(queryString);
  for (let paramWithoutSideEffects of cssUrlParamsWithoutSideEffects) {
    if (
      // Parameter is blank and not explicitly set, i.e. "?url", not "?url="
      params.get(paramWithoutSideEffects) === "" &&
      !url.includes(`?${paramWithoutSideEffects}=`) &&
      !url.includes(`&${paramWithoutSideEffects}=`)
    ) {
      return true;
    }
  }

  return false;
};

const getStylesForFiles = async ({
  viteDevServer,
  rootDirectory,
  loadCssContents,
  files,
}: {
  viteDevServer: ViteDevServer;
  rootDirectory: string;
  loadCssContents: LoadCssContents;
  files: string[];
}): Promise<string | undefined> => {
  let styles: Record<string, string> = {};
  let deps = new Set<ModuleNode>();

  try {
    for (let file of files) {
      let normalizedPath = path
        .resolve(rootDirectory, file)
        .replace(/\\/g, "/");
      let node = await viteDevServer.moduleGraph.getModuleById(normalizedPath);

      // If the module is only present in the client module graph, the module
      // won't have been found on the first request to the server. If so, we
      // request the module so it's in the module graph, then try again.
      if (!node) {
        try {
          await viteDevServer.transformRequest(
            resolveFileUrl({ rootDirectory }, normalizedPath)
          );
        } catch (err) {
          console.error(err);
        }
        node = await viteDevServer.moduleGraph.getModuleById(normalizedPath);
      }

      if (!node) {
        console.log(`Could not resolve module for file: ${file}`);
        continue;
      }

      await findDeps(viteDevServer, node, deps);
    }
  } catch (err) {
    console.error(err);
  }

  for (let dep of deps) {
    if (
      dep.file &&
      isCssFile(dep.file) &&
      !isCssUrlWithoutSideEffects(dep.url) // Ignore styles that resolved as URLs, inline or raw. These shouldn't get injected.
    ) {
      try {
        styles[dep.url] = await loadCssContents(viteDevServer, dep);
      } catch {
        console.warn(`Failed to load CSS for ${dep.file}`);
        // this can happen with dynamically imported modules, I think
        // because the Vite module graph doesn't distinguish between
        // static and dynamic imports? TODO investigate, submit fix
      }
    }
  }

  return (
    Object.entries(styles)
      .map(([fileName, css], i) => [
        `\n/* ${fileName
          // Escape comment syntax in file paths
          .replace(/\/\*/g, "/\\*")
          .replace(/\*\//g, "*\\/")} */`,
        css,
      ])
      .flat()
      .join("\n") || undefined
  );
};

const findDeps = async (
  vite: ViteDevServer,
  node: ModuleNode,
  deps: Set<ModuleNode>
) => {
  // since `ssrTransformResult.deps` contains URLs instead of `ModuleNode`s, this process is asynchronous.
  // instead of using `await`, we resolve all branches in parallel.
  let branches: Promise<void>[] = [];

  async function addFromNode(node: ModuleNode) {
    if (!deps.has(node)) {
      deps.add(node);
      await findDeps(vite, node, deps);
    }
  }

  async function addFromUrl(url: string) {
    let node = await vite.moduleGraph.getModuleByUrl(url);

    if (node) {
      await addFromNode(node);
    }
  }

  if (node.ssrTransformResult) {
    if (node.ssrTransformResult.deps) {
      node.ssrTransformResult.deps.forEach((url) =>
        branches.push(addFromUrl(url))
      );
    }
  } else {
    node.importedModules.forEach((node) => branches.push(addFromNode(node)));
  }

  await Promise.all(branches);
};

const groupRoutesByParentId = (manifest: RouteManifest) => {
  let routes: Record<string, Array<RouteManifestEntry>> = {};

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
};

type RouteManifestEntryWithChildren = Omit<RouteManifestEntry, "index"> &
  (
    | { index?: false | undefined; children: RouteManifestEntryWithChildren[] }
    | { index: true; children?: never }
  );

const createRoutesWithChildren = (
  manifest: RouteManifest,
  parentId: string = "",
  routesByParentId = groupRoutesByParentId(manifest)
): RouteManifestEntryWithChildren[] => {
  return (routesByParentId[parentId] || []).map((route) => ({
    ...route,
    ...(route.index
      ? {
          index: true,
        }
      : {
          index: false,
          children: createRoutesWithChildren(
            manifest,
            route.id,
            routesByParentId
          ),
        }),
  }));
};

export const getStylesForPathname = async ({
  viteDevServer,
  rootDirectory,
  reactRouterConfig,
  entryClientFilePath,
  loadCssContents,
  pathname,
}: {
  viteDevServer: ViteDevServer;
  rootDirectory: string;
  reactRouterConfig: Pick<
    ResolvedReactRouterConfig,
    "appDirectory" | "routes" | "basename"
  >;
  entryClientFilePath: string;
  loadCssContents: LoadCssContents;
  pathname: string | undefined;
}): Promise<string | undefined> => {
  if (pathname === undefined || pathname.includes("?_data=")) {
    return undefined;
  }

  let routesWithChildren = createRoutesWithChildren(reactRouterConfig.routes);
  let appPath = path.relative(process.cwd(), reactRouterConfig.appDirectory);
  let documentRouteFiles =
    matchRoutes(routesWithChildren, pathname, reactRouterConfig.basename)?.map(
      (match) =>
        path.resolve(appPath, reactRouterConfig.routes[match.route.id].file)
    ) ?? [];

  let styles = await getStylesForFiles({
    viteDevServer,
    rootDirectory,
    loadCssContents,
    files: [
      // Always include the client entry file when crawling the module graph for CSS
      path.relative(rootDirectory, entryClientFilePath),
      // Then include any styles from the matched routes
      ...documentRouteFiles,
    ],
  });

  return styles;
};
