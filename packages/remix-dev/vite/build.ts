import type * as Vite from "vite";
import path from "node:path";
import fse from "fs-extra";
import colors from "picocolors";

import {
  type ReactRouterPluginContext,
  type BuildManifest,
  type ServerBundleBuildConfig,
  type ServerBundlesBuildManifest,
  resolveViteConfig,
  extractPluginContext,
  configRouteToBranchRoute,
  getServerBuildDirectory,
} from "./plugin";
import type { ConfigRoute, RouteManifest } from "../config/routes";
import invariant from "../invariant";
import { preloadViteEsm } from "./import-vite-esm-sync";

function getAddressableRoutes(routes: RouteManifest): ConfigRoute[] {
  let nonAddressableIds = new Set<string>();

  for (let id in routes) {
    let route = routes[id];

    // We omit the parent route of index routes since the index route takes ownership of its parent's path
    if (route.index) {
      invariant(
        route.parentId,
        `Expected index route "${route.id}" to have "parentId" set`
      );
      nonAddressableIds.add(route.parentId);
    }

    // We omit pathless routes since they can only be addressed via descendant routes
    if (typeof route.path !== "string" && !route.index) {
      nonAddressableIds.add(id);
    }
  }

  return Object.values(routes).filter(
    (route) => !nonAddressableIds.has(route.id)
  );
}

function getRouteBranch(routes: RouteManifest, routeId: string) {
  let branch: ConfigRoute[] = [];
  let currentRouteId: string | undefined = routeId;

  while (currentRouteId) {
    let route: ConfigRoute = routes[currentRouteId];
    invariant(route, `Missing route for ${currentRouteId}`);
    branch.push(route);
    currentRouteId = route.parentId;
  }

  return branch.reverse();
}

type ReactRouterClientBuildArgs = {
  ssr: false;
  serverBundleBuildConfig?: never;
};

type ReactRouterServerBuildArgs = {
  ssr: true;
  serverBundleBuildConfig?: ServerBundleBuildConfig;
};

type ReactRouterBuildArgs =
  | ReactRouterClientBuildArgs
  | ReactRouterServerBuildArgs;

async function getServerBuilds(ctx: ReactRouterPluginContext): Promise<{
  serverBuilds: ReactRouterServerBuildArgs[];
  buildManifest: BuildManifest;
}> {
  let { rootDirectory } = ctx;
  const { routes, serverBuildFile, serverBundles, appDirectory } =
    ctx.reactRouterConfig;
  let serverBuildDirectory = getServerBuildDirectory(ctx);
  if (!serverBundles) {
    return {
      serverBuilds: [{ ssr: true }],
      buildManifest: { routes },
    };
  }

  let { normalizePath } = await import("vite");

  let resolvedAppDirectory = path.resolve(rootDirectory, appDirectory);
  let rootRelativeRoutes = Object.fromEntries(
    Object.entries(routes).map(([id, route]) => {
      let filePath = path.join(resolvedAppDirectory, route.file);
      let rootRelativeFilePath = normalizePath(
        path.relative(rootDirectory, filePath)
      );
      return [id, { ...route, file: rootRelativeFilePath }];
    })
  );

  let buildManifest: ServerBundlesBuildManifest = {
    serverBundles: {},
    routeIdToServerBundleId: {},
    routes: rootRelativeRoutes,
  };

  let serverBundleBuildConfigById = new Map<string, ServerBundleBuildConfig>();

  await Promise.all(
    getAddressableRoutes(routes).map(async (route) => {
      let branch = getRouteBranch(routes, route.id);
      let serverBundleId = await serverBundles({
        branch: branch.map((route) =>
          configRouteToBranchRoute({
            ...route,
            // Ensure absolute paths are passed to the serverBundles function
            file: path.join(resolvedAppDirectory, route.file),
          })
        ),
      });
      if (typeof serverBundleId !== "string") {
        throw new Error(`The "serverBundles" function must return a string`);
      }
      if (!/^[a-zA-Z0-9-_]+$/.test(serverBundleId)) {
        throw new Error(
          `The "serverBundles" function must only return strings containing alphanumeric characters, hyphens and underscores.`
        );
      }
      buildManifest.routeIdToServerBundleId[route.id] = serverBundleId;

      let relativeServerBundleDirectory = path.relative(
        rootDirectory,
        path.join(serverBuildDirectory, serverBundleId)
      );
      let serverBuildConfig = serverBundleBuildConfigById.get(serverBundleId);
      if (!serverBuildConfig) {
        buildManifest.serverBundles[serverBundleId] = {
          id: serverBundleId,
          file: normalizePath(
            path.join(relativeServerBundleDirectory, serverBuildFile)
          ),
        };
        serverBuildConfig = {
          routes: {},
          serverBundleId,
        };
        serverBundleBuildConfigById.set(serverBundleId, serverBuildConfig);
      }
      for (let route of branch) {
        serverBuildConfig.routes[route.id] = route;
      }
    })
  );

  let serverBuilds = Array.from(serverBundleBuildConfigById.values()).map(
    (serverBundleBuildConfig): ReactRouterServerBuildArgs => {
      let serverBuild: ReactRouterServerBuildArgs = {
        ssr: true,
        serverBundleBuildConfig,
      };
      return serverBuild;
    }
  );

  return {
    serverBuilds,
    buildManifest,
  };
}

async function cleanBuildDirectory(
  viteConfig: Vite.ResolvedConfig,
  ctx: ReactRouterPluginContext
) {
  let buildDirectory = ctx.reactRouterConfig.buildDirectory;
  let isWithinRoot = () => {
    let relativePath = path.relative(ctx.rootDirectory, buildDirectory);
    return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
  };

  if (viteConfig.build.emptyOutDir ?? isWithinRoot()) {
    await fse.remove(buildDirectory);
  }
}

function getViteManifestPaths(
  ctx: ReactRouterPluginContext,
  serverBuilds: Array<ReactRouterServerBuildArgs>
) {
  let buildRelative = (pathname: string) =>
    path.resolve(ctx.reactRouterConfig.buildDirectory, pathname);

  let viteManifestPaths: Array<{ srcPath: string; destPath: string }> = [
    {
      srcPath: "client/.vite/manifest.json",
      destPath: ".vite/client-manifest.json",
    },
    ...serverBuilds.map(({ serverBundleBuildConfig }) => {
      let serverBundleId = serverBundleBuildConfig?.serverBundleId;
      let serverBundlePath = serverBundleId ? serverBundleId + "/" : "";
      let serverBundleSuffix = serverBundleId ? serverBundleId + "-" : "";
      return {
        srcPath: `server/${serverBundlePath}.vite/manifest.json`,
        destPath: `.vite/server-${serverBundleSuffix}manifest.json`,
      };
    }),
  ].map(({ srcPath, destPath }) => ({
    srcPath: buildRelative(srcPath),
    destPath: buildRelative(destPath),
  }));

  return viteManifestPaths;
}

export interface ViteBuildOptions {
  assetsInlineLimit?: number;
  clearScreen?: boolean;
  config?: string;
  emptyOutDir?: boolean;
  force?: boolean;
  logLevel?: Vite.LogLevel;
  minify?: Vite.BuildOptions["minify"];
  mode?: string;
  profile?: boolean;
  sourcemapClient?: boolean | "inline" | "hidden";
  sourcemapServer?: boolean | "inline" | "hidden";
}

export async function build(
  root: string,
  {
    assetsInlineLimit,
    clearScreen,
    config: configFile,
    emptyOutDir,
    force,
    logLevel,
    minify,
    mode,
    sourcemapClient,
    sourcemapServer,
  }: ViteBuildOptions
) {
  // Ensure Vite's ESM build is preloaded at the start of the process
  // so it can be accessed synchronously via `importViteEsmSync`
  await preloadViteEsm();

  let viteConfig = await resolveViteConfig({ configFile, mode, root });

  const ctx = await extractPluginContext(viteConfig);

  if (!ctx) {
    console.error(
      colors.red("React Router Vite plugin not found in Vite config")
    );
    process.exit(1);
  }

  let { reactRouterConfig } = ctx;

  let vite = await import("vite");

  async function viteBuild({
    ssr,
    serverBundleBuildConfig,
  }: ReactRouterBuildArgs) {
    await vite.build({
      root,
      mode,
      configFile,
      build: {
        assetsInlineLimit,
        emptyOutDir,
        minify,
        ssr,
        sourcemap: ssr ? sourcemapServer : sourcemapClient,
      },
      optimizeDeps: { force },
      clearScreen,
      logLevel,
      ...(serverBundleBuildConfig
        ? { __reactRouterServerBundleBuildConfig: serverBundleBuildConfig }
        : {}),
    });
  }

  await cleanBuildDirectory(viteConfig, ctx);

  // Run the Vite client build first
  await viteBuild({ ssr: false });

  // Then run Vite SSR builds in parallel
  let { serverBuilds, buildManifest } = await getServerBuilds(ctx);
  await Promise.all(serverBuilds.map(viteBuild));

  let viteManifestPaths = getViteManifestPaths(ctx, serverBuilds);
  await Promise.all(
    viteManifestPaths.map(async ({ srcPath, destPath }) => {
      let manifestExists = await fse.pathExists(srcPath);
      if (!manifestExists) return;

      // Move/delete original Vite manifest file
      if (ctx.viteManifestEnabled) {
        await fse.ensureDir(path.dirname(destPath));
        await fse.move(srcPath, destPath);
      } else {
        await fse.remove(srcPath);
      }

      // Remove .vite dir if it's now empty
      let viteDir = path.dirname(srcPath);
      let viteDirFiles = await fse.readdir(viteDir);
      if (viteDirFiles.length === 0) {
        await fse.remove(viteDir);
      }
    })
  );

  // Then run Vite React Server builds in parallel
  if (reactRouterConfig.future.unstable_serverComponents) {
    process.env.REACT_SERVER = "1";
    let {} = await getServerBuilds(ctx);
    await Promise.all(serverBuilds.map(viteBuild));

    let _viteManifestPaths = getViteManifestPaths(ctx, serverBuilds);
    await Promise.all(
      viteManifestPaths.map(async ({ srcPath, destPath }) => {
        let manifestExists = await fse.pathExists(srcPath);
        if (!manifestExists) return;

        // Move/delete original Vite manifest file
        if (ctx.viteManifestEnabled) {
          await fse.ensureDir(path.dirname(destPath));
          await fse.move(srcPath, destPath);
        } else {
          await fse.remove(srcPath);
        }

        // Remove .vite dir if it's now empty
        let viteDir = path.dirname(srcPath);
        let viteDirFiles = await fse.readdir(viteDir);
        if (viteDirFiles.length === 0) {
          await fse.remove(viteDir);
        }
      })
    );
  }

  if (ctx.reactRouterConfig.manifest) {
    await fse.ensureDir(
      path.join(ctx.reactRouterConfig.buildDirectory, ".react-router")
    );
    await fse.writeFile(
      path.join(
        ctx.reactRouterConfig.buildDirectory,
        ".react-router",
        "manifest.json"
      ),
      JSON.stringify(buildManifest, null, 2),
      "utf-8"
    );
  }

  await reactRouterConfig.buildEnd?.({
    buildManifest,
    reactRouterConfig,
    viteConfig,
  });
}
