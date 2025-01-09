import * as path from "node:path";
import type { ServerBuild } from "react-router";
import type * as rr from "react-router";
import type { ModuleNode, ViteDevServer } from "vite";

import type { ResolvedReactRouterConfig } from "../config/config";
import { resolveFileUrl } from "./resolve-file-url";
import { getVite } from "./vite";

type ServerRouteManifest = ServerBuild["routes"];
type ServerRoute = ServerRouteManifest[string];

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

const injectQuery = (url: string, query: string) =>
  url.includes("?") ? url.replace("?", `?${query}&`) : `${url}?${query}`;

const getStylesForFiles = async ({
  viteDevServer,
  rootDirectory,
  cssModulesManifest,
  files,
}: {
  viteDevServer: ViteDevServer;
  rootDirectory: string;
  cssModulesManifest: Record<string, string>;
  files: string[];
}): Promise<string | undefined> => {
  let vite = getVite();
  let viteMajor = parseInt(vite.version.split(".")[0], 10);

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
        let css = isCssModulesFile(dep.file)
          ? cssModulesManifest[dep.file]
          : (
              await viteDevServer.ssrLoadModule(
                // We need the ?inline query in Vite v6 when loading CSS in SSR
                // since it does not expose the default export for CSS in a
                // server environment. This is to align with non-SSR
                // environments. For backwards compatibility with v5 we keep
                // using the URL without ?inline query because the HMR code was
                // relying on the implicit SSR-client module graph relationship.
                viteMajor >= 6 ? injectQuery(dep.url, "inline") : dep.url
              )
            ).default;

        if (css === undefined) {
          throw new Error();
        }

        styles[dep.url] = css;
      } catch {
        console.warn(`Could not load ${dep.file}`);
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

const groupRoutesByParentId = (manifest: ServerRouteManifest) => {
  let routes: Record<string, NonNullable<ServerRoute>[]> = {};

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

// Create a map of routes by parentId to use recursively instead of
// repeatedly filtering the manifest.
const createRoutes = (
  manifest: ServerRouteManifest,
  parentId: string = "",
  routesByParentId = groupRoutesByParentId(manifest)
): NonNullable<ServerRoute>[] => {
  return (routesByParentId[parentId] || []).map((route) => ({
    ...route,
    children: createRoutes(manifest, route.id, routesByParentId),
  }));
};

export const getStylesForUrl = async ({
  viteDevServer,
  rootDirectory,
  reactRouterConfig,
  entryClientFilePath,
  cssModulesManifest,
  build,
  url,
  matchRoutes,
}: {
  viteDevServer: ViteDevServer;
  rootDirectory: string;
  reactRouterConfig: Pick<ResolvedReactRouterConfig, "appDirectory" | "routes">;
  entryClientFilePath: string;
  cssModulesManifest: Record<string, string>;
  build: ServerBuild;
  url: string | undefined;
  matchRoutes: typeof rr.matchRoutes;
}): Promise<string | undefined> => {
  if (url === undefined || url.includes("?_data=")) {
    return undefined;
  }

  let routes = createRoutes(build.routes);
  let appPath = path.relative(process.cwd(), reactRouterConfig.appDirectory);
  let documentRouteFiles =
    matchRoutes(routes, url, build.basename)?.map((match) =>
      path.resolve(appPath, reactRouterConfig.routes[match.route.id].file)
    ) ?? [];

  let styles = await getStylesForFiles({
    viteDevServer,
    rootDirectory,
    cssModulesManifest,
    files: [
      // Always include the client entry file when crawling the module graph for CSS
      path.relative(rootDirectory, entryClientFilePath),
      // Then include any styles from the matched routes
      ...documentRouteFiles,
    ],
  });

  return styles;
};
