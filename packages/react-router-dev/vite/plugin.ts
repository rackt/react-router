// We can only import types from Vite at the top level since we're in a CJS
// context but want to use Vite's ESM build to avoid deprecation warnings
import type * as Vite from "vite";
import { type BinaryLike, createHash } from "node:crypto";
import * as path from "node:path";
import * as url from "node:url";
import * as fse from "fs-extra";
import * as babel from "@babel/core";
import {
  unstable_setDevServerHooks as setDevServerHooks,
  createRequestHandler,
  matchRoutes,
} from "react-router";
import type {
  RequestHandler,
  ServerBuild,
  DataRouteObject,
} from "react-router";
import {
  init as initEsModuleLexer,
  parse as esModuleLexer,
} from "es-module-lexer";
import pick from "lodash/pick";
import jsesc from "jsesc";
import colors from "picocolors";
import kebabCase from "lodash/kebabCase";

import * as Typegen from "../typegen";
import type { RouteManifestEntry, RouteManifest } from "../config/routes";
import type {
  ManifestRoute,
  Manifest as ReactRouterManifest,
} from "../manifest";
import invariant from "../invariant";
import type { Cache } from "./cache";
import { generate, parse } from "./babel";
import type { NodeRequestHandler } from "./node-adapter";
import { fromNodeRequest, toNodeRequest } from "./node-adapter";
import { getStylesForUrl, isCssModulesFile } from "./styles";
import * as VirtualModule from "./virtual-module";
import { resolveFileUrl } from "./resolve-file-url";
import { combineURLs } from "./combine-urls";
import { removeExports } from "./remove-exports";
import {
  type RouteChunkName,
  type RouteChunkExportName,
  routeChunkNames,
  routeChunkExportNames,
  detectRouteChunks,
  getRouteChunkCode,
  isRouteChunkModuleId,
  getRouteChunkModuleId,
  getRouteChunkNameFromModuleId,
} from "./route-chunks";
import { preloadVite, getVite } from "./vite";
import {
  type ResolvedReactRouterConfig,
  type BuildManifest,
  type ConfigLoader,
  createConfigLoader,
  resolveEntryFiles,
  ssrExternals,
  configRouteToBranchRoute,
} from "../config/config";
import * as WithProps from "./with-props";

export async function resolveViteConfig({
  configFile,
  mode,
  root,
  plugins,
}: {
  configFile?: string;
  mode?: string;
  plugins?: Vite.Plugin[];
  root: string;
}) {
  let vite = getVite();

  let viteConfig = await vite.resolveConfig(
    { mode, configFile, root, plugins },
    "build", // command
    "production", // default mode
    "production" // default NODE_ENV
  );

  if (typeof viteConfig.build.manifest === "string") {
    throw new Error("Custom Vite manifest paths are not supported");
  }

  return viteConfig;
}

export async function extractPluginContext(viteConfig: Vite.ResolvedConfig) {
  return viteConfig["__reactRouterPluginContext" as keyof typeof viteConfig] as
    | ReactRouterPluginContext
    | undefined;
}

const SERVER_ONLY_ROUTE_EXPORTS = ["loader", "action", "headers"];
const CLIENT_ROUTE_EXPORTS = [
  "clientAction",
  "clientLoader",
  "default",
  "ErrorBoundary",
  "handle",
  "HydrateFallback",
  "Layout",
  "links",
  "meta",
  "shouldRevalidate",
];

/** This is used to manage a build optimization to remove unused route exports
from the client build output. This is important in cases where custom route
exports are only ever used on the server. Without this optimization we can't
tree-shake any unused custom exports because routes are entry points. */
const BUILD_CLIENT_ROUTE_QUERY_STRING = "?__react-router-build-client-route";

export type EnvironmentName = "client" | SsrEnvironmentName;

const SSR_BUNDLE_PREFIX = "ssrBundle_";
type SsrEnvironmentName = "ssr" | `${typeof SSR_BUNDLE_PREFIX}${string}`;

type EnvironmentOptions = Pick<Vite.EnvironmentOptions, "build" | "resolve">;

type EnvironmentOptionsResolver = (options: {
  viteUserConfig: Vite.UserConfig;
}) => EnvironmentOptions;

type EnvironmentOptionsResolvers = Partial<
  Record<EnvironmentName, EnvironmentOptionsResolver>
>;

export type EnvironmentBuildContext = {
  name: EnvironmentName;
  resolveOptions: EnvironmentOptionsResolver;
};

function isSeverBundleEnvironmentName(
  name: string
): name is SsrEnvironmentName {
  return name.startsWith(SSR_BUNDLE_PREFIX);
}

function getServerEnvironmentEntries<T>(
  record: Record<string, T>,
  buildManifest: BuildManifest
): [SsrEnvironmentName, T][] {
  return Object.entries(record).filter(([name]) =>
    buildManifest.serverBundles
      ? isSeverBundleEnvironmentName(name)
      : name === "ssr"
  ) as [SsrEnvironmentName, T][];
}

export function getServerEnvironmentKeys(
  record: Record<string, unknown>,
  buildManifest: BuildManifest
): SsrEnvironmentName[] {
  return getServerEnvironmentEntries(record, buildManifest).map(([key]) => key);
}

export function getServerEnvironmentValues<T>(
  record: Record<string, T>,
  buildManifest: BuildManifest
): T[] {
  return getServerEnvironmentEntries(record, buildManifest).map(
    ([, value]) => value
  );
}

const isRouteEntryModuleId = (id: string): boolean => {
  return id.endsWith(BUILD_CLIENT_ROUTE_QUERY_STRING);
};

const isRouteVirtualModule = (id: string): boolean => {
  return isRouteEntryModuleId(id) || isRouteChunkModuleId(id);
};

export type ServerBundleBuildConfig = {
  routes: RouteManifest;
  serverBundleId: string;
};

type ResolvedEnvironmentBuildContext = {
  name: EnvironmentName;
  options: EnvironmentOptions;
};

type ReactRouterPluginContext = {
  environmentBuildContext: ResolvedEnvironmentBuildContext | null;
  rootDirectory: string;
  entryClientFilePath: string;
  entryServerFilePath: string;
  publicPath: string;
  reactRouterConfig: ResolvedReactRouterConfig;
  viteManifestEnabled: boolean;
};

let virtualHmrRuntime = VirtualModule.create("hmr-runtime");
let virtualInjectHmrRuntime = VirtualModule.create("inject-hmr-runtime");

const normalizeRelativeFilePath = (
  file: string,
  reactRouterConfig: ResolvedReactRouterConfig
) => {
  let vite = getVite();
  let fullPath = path.resolve(reactRouterConfig.appDirectory, file);
  let relativePath = path.relative(reactRouterConfig.appDirectory, fullPath);

  return vite.normalizePath(relativePath).split("?")[0];
};

const resolveRelativeRouteFilePath = (
  route: RouteManifestEntry,
  reactRouterConfig: ResolvedReactRouterConfig
) => {
  let vite = getVite();
  let file = route.file;
  let fullPath = path.resolve(reactRouterConfig.appDirectory, file);

  return vite.normalizePath(fullPath);
};

let virtual = {
  serverBuild: VirtualModule.create("server-build"),
  serverManifest: VirtualModule.create("server-manifest"),
  browserManifest: VirtualModule.create("browser-manifest"),
};

let invalidateVirtualModules = (viteDevServer: Vite.ViteDevServer) => {
  Object.values(virtual).forEach((vmod) => {
    let mod = viteDevServer.moduleGraph.getModuleById(vmod.resolvedId);
    if (mod) {
      viteDevServer.moduleGraph.invalidateModule(mod);
    }
  });
};

const getHash = (source: BinaryLike, maxLength?: number): string => {
  let hash = createHash("sha256").update(source).digest("hex");
  return typeof maxLength === "number" ? hash.slice(0, maxLength) : hash;
};

const resolveChunk = (
  ctx: ReactRouterPluginContext,
  viteManifest: Vite.Manifest,
  absoluteFilePath: string
) => {
  let vite = getVite();
  let rootRelativeFilePath = vite.normalizePath(
    path.relative(ctx.rootDirectory, absoluteFilePath)
  );
  let entryChunk = viteManifest[rootRelativeFilePath];

  if (!entryChunk) {
    return undefined;
  }

  return entryChunk;
};

const getPublicModulePathForEntry = (
  ctx: ReactRouterPluginContext,
  viteManifest: Vite.Manifest,
  entryFilePath: string
): string | undefined => {
  let entryChunk = resolveChunk(ctx, viteManifest, entryFilePath);
  return entryChunk ? `${ctx.publicPath}${entryChunk.file}` : undefined;
};

const getReactRouterManifestBuildAssets = (
  ctx: ReactRouterPluginContext,
  viteManifest: Vite.Manifest,
  entryFilePath: string,
  prependedAssetFilePaths: string[] = []
): ReactRouterManifest["entry"] & { css: string[] } => {
  let entryChunk = resolveChunk(ctx, viteManifest, entryFilePath);
  invariant(entryChunk, "Chunk not found");

  // This is here to support prepending client entry assets to the root route
  let prependedAssetChunks = prependedAssetFilePaths.map((filePath) => {
    let chunk = resolveChunk(ctx, viteManifest, filePath);
    invariant(chunk, "Chunk not found");
    return chunk;
  });

  let routeModuleChunks = routeChunkNames
    .map((routeChunkName) =>
      resolveChunk(
        ctx,
        viteManifest,
        getRouteChunkModuleId(entryFilePath.split("?")[0], routeChunkName)
      )
    )
    .filter(isNonNullable);

  let chunks = resolveDependantChunks(viteManifest, [
    ...prependedAssetChunks,
    entryChunk,
    ...routeModuleChunks,
  ]);

  return {
    module: `${ctx.publicPath}${entryChunk.file}`,
    imports:
      dedupe(chunks.flatMap((e) => e.imports ?? [])).map((imported) => {
        return `${ctx.publicPath}${viteManifest[imported].file}`;
      }) ?? [],
    css:
      dedupe(chunks.flatMap((e) => e.css ?? [])).map((href) => {
        return `${ctx.publicPath}${href}`;
      }) ?? [],
  };
};

function resolveDependantChunks(
  viteManifest: Vite.Manifest,
  entryChunks: Vite.ManifestChunk[]
): Vite.ManifestChunk[] {
  let chunks = new Set<Vite.ManifestChunk>();

  function walk(chunk: Vite.ManifestChunk) {
    if (chunks.has(chunk)) {
      return;
    }

    chunks.add(chunk);

    if (chunk.imports) {
      for (let importKey of chunk.imports) {
        walk(viteManifest[importKey]);
      }
    }
  }

  for (let entryChunk of entryChunks) {
    walk(entryChunk);
  }

  return Array.from(chunks);
}

function dedupe<T>(array: T[]): T[] {
  return [...new Set(array)];
}

const writeFileSafe = async (file: string, contents: string): Promise<void> => {
  await fse.ensureDir(path.dirname(file));
  await fse.writeFile(file, contents);
};

const getExportNames = (code: string): string[] => {
  let [, exportSpecifiers] = esModuleLexer(code);
  return exportSpecifiers.map(({ n: name }) => name);
};

const getRouteManifestModuleExports = async (
  viteChildCompiler: Vite.ViteDevServer | null,
  ctx: ReactRouterPluginContext
): Promise<Record<string, string[]>> => {
  let entries = await Promise.all(
    Object.entries(ctx.reactRouterConfig.routes).map(async ([key, route]) => {
      let sourceExports = await getRouteModuleExports(
        viteChildCompiler,
        ctx,
        route.file
      );
      return [key, sourceExports] as const;
    })
  );
  return Object.fromEntries(entries);
};

const compileRouteFile = async (
  viteChildCompiler: Vite.ViteDevServer | null,
  ctx: ReactRouterPluginContext,
  routeFile: string,
  readRouteFile?: () => string | Promise<string>
): Promise<string> => {
  if (!viteChildCompiler) {
    throw new Error("Vite child compiler not found");
  }

  // We transform the route module code with the Vite child compiler so that we
  // can parse the exports from non-JS files like MDX. This ensures that we can
  // understand the exports from anything that Vite can compile to JS, not just
  // the route file formats that the Remix compiler historically supported.

  let ssr = true;
  let { pluginContainer, moduleGraph } = viteChildCompiler;

  let routePath = path.resolve(ctx.reactRouterConfig.appDirectory, routeFile);
  let url = resolveFileUrl(ctx, routePath);

  let resolveId = async () => {
    let result = await pluginContainer.resolveId(url, undefined, { ssr });
    if (!result) throw new Error(`Could not resolve module ID for ${url}`);
    return result.id;
  };

  let [id, code] = await Promise.all([
    resolveId(),
    readRouteFile?.() ?? fse.readFile(routePath, "utf-8"),
    // pluginContainer.transform(...) fails if we don't do this first:
    moduleGraph.ensureEntryFromUrl(url, ssr),
  ]);

  let transformed = await pluginContainer.transform(code, id, { ssr });
  return transformed.code;
};

const getRouteModuleExports = async (
  viteChildCompiler: Vite.ViteDevServer | null,
  ctx: ReactRouterPluginContext,
  routeFile: string,
  readRouteFile?: () => string | Promise<string>
): Promise<string[]> => {
  if (!viteChildCompiler) {
    throw new Error("Vite child compiler not found");
  }

  let code = await compileRouteFile(
    viteChildCompiler,
    ctx,
    routeFile,
    readRouteFile
  );

  return getExportNames(code);
};

const resolveEnvironmentBuildContext = ({
  viteCommand,
  viteUserConfig,
}: {
  viteCommand: Vite.ResolvedConfig["command"];
  viteUserConfig: Vite.UserConfig;
}): ResolvedEnvironmentBuildContext | null => {
  if (
    !("__reactRouterEnvironmentBuildContext" in viteUserConfig) ||
    !viteUserConfig.__reactRouterEnvironmentBuildContext
  ) {
    return null;
  }

  let buildContext =
    viteUserConfig.__reactRouterEnvironmentBuildContext as EnvironmentBuildContext;

  let resolvedBuildContext: ResolvedEnvironmentBuildContext = {
    name: buildContext.name,
    options: buildContext.resolveOptions({ viteUserConfig }),
  };

  return resolvedBuildContext;
};

let getServerBuildDirectory = (
  ctx: ReactRouterPluginContext,
  { serverBundleId }: { serverBundleId?: string } = {}
) =>
  path.join(
    ctx.reactRouterConfig.buildDirectory,
    "server",
    ...(serverBundleId ? [serverBundleId] : [])
  );

let getClientBuildDirectory = (reactRouterConfig: ResolvedReactRouterConfig) =>
  path.join(reactRouterConfig.buildDirectory, "client");

let defaultEntriesDir = path.resolve(
  path.dirname(require.resolve("@react-router/dev/package.json")),
  "dist",
  "config",
  "defaults"
);
let defaultEntries = fse
  .readdirSync(defaultEntriesDir)
  .map((filename) => path.join(defaultEntriesDir, filename));
invariant(defaultEntries.length > 0, "No default entries found");

type MaybePromise<T> = T | Promise<T>;

let reactRouterDevLoadContext: (
  request: Request
) => MaybePromise<Record<string, unknown>> = () => ({});

export let setReactRouterDevLoadContext = (
  loadContext: (request: Request) => MaybePromise<Record<string, unknown>>
) => {
  reactRouterDevLoadContext = loadContext;
};

type ReactRouterVitePlugin = () => Vite.Plugin[];
/**
 * React Router [Vite plugin.](https://vitejs.dev/guide/using-plugins.html)
 */
export const reactRouterVitePlugin: ReactRouterVitePlugin = () => {
  let rootDirectory: string;
  let viteCommand: Vite.ResolvedConfig["command"];
  let viteUserConfig: Vite.UserConfig;
  let viteConfigEnv: Vite.ConfigEnv;
  let viteConfig: Vite.ResolvedConfig | undefined;
  let buildManifest: BuildManifest | undefined;
  let cssModulesManifest: Record<string, string> = {};
  let viteChildCompiler: Vite.ViteDevServer | null = null;
  let cache: Cache = new Map();

  let reactRouterConfigLoader: ConfigLoader;
  let typegenWatcherPromise: Promise<Typegen.Watcher> | undefined;
  let logger: Vite.Logger;
  let firstLoad = true;

  // This is initialized by `updatePluginContext` during Vite's `config`
  // hook, so most of the code can assume this defined without null check.
  // During dev, `updatePluginContext` is called again on every config file
  // change or route file addition/removal.
  let ctx: ReactRouterPluginContext;

  /** Mutates `ctx` as a side-effect */
  let updatePluginContext = async (): Promise<void> => {
    let reactRouterConfig: ResolvedReactRouterConfig;
    let reactRouterConfigResult = await reactRouterConfigLoader.getConfig();

    if (reactRouterConfigResult.ok) {
      reactRouterConfig = reactRouterConfigResult.value;
    } else {
      logger.error(reactRouterConfigResult.error);
      if (firstLoad) {
        process.exit(1);
      }
      return;
    }

    let { entryClientFilePath, entryServerFilePath } = await resolveEntryFiles({
      rootDirectory,
      reactRouterConfig,
    });

    let publicPath = viteUserConfig.base ?? "/";

    if (
      reactRouterConfig.basename !== "/" &&
      viteCommand === "serve" &&
      !viteUserConfig.server?.middlewareMode &&
      !reactRouterConfig.basename.startsWith(publicPath)
    ) {
      logger.error(
        colors.red(
          "When using the React Router `basename` and the Vite `base` config, " +
            "the `basename` config must begin with `base` for the default " +
            "Vite dev server."
        )
      );
      process.exit(1);
    }

    let viteManifestEnabled = viteUserConfig.build?.manifest === true;

    let environmentBuildContext: ResolvedEnvironmentBuildContext | null =
      viteCommand === "build"
        ? resolveEnvironmentBuildContext({ viteCommand, viteUserConfig })
        : null;

    firstLoad = false;

    ctx = {
      environmentBuildContext,
      reactRouterConfig,
      rootDirectory,
      entryClientFilePath,
      entryServerFilePath,
      publicPath,
      viteManifestEnabled,
    };
  };

  let pluginIndex = (pluginName: string) => {
    invariant(viteConfig);
    return viteConfig.plugins.findIndex((plugin) => plugin.name === pluginName);
  };

  let getServerEntry = async ({ routeIds }: { routeIds?: Array<string> }) => {
    invariant(viteConfig, "viteconfig required to generate the server entry");

    let routes = routeIds
      ? // For server bundle builds, the server build should only import the
        // routes for this bundle rather than importing all routes
        pick(ctx.reactRouterConfig.routes, routeIds)
      : // Otherwise, all routes are imported as usual
        ctx.reactRouterConfig.routes;

    let prerenderPaths = await getPrerenderPaths(
      ctx.reactRouterConfig.prerender,
      ctx.reactRouterConfig.ssr,
      routes
    );

    return `
    import * as entryServer from ${JSON.stringify(
      resolveFileUrl(ctx, ctx.entryServerFilePath)
    )};
    ${Object.keys(routes)
      .map((key, index) => {
        let route = routes[key]!;
        return `import * as route${index} from ${JSON.stringify(
          resolveFileUrl(
            ctx,
            resolveRelativeRouteFilePath(route, ctx.reactRouterConfig)
          )
        )};`;
      })
      .join("\n")}
      export { default as assets } from ${JSON.stringify(
        `${virtual.serverManifest.id}${
          routeIds ? `?route-ids=${routeIds.join(",")}` : ""
        }`
      )};
      export const assetsBuildDirectory = ${JSON.stringify(
        path.relative(
          ctx.rootDirectory,
          getClientBuildDirectory(ctx.reactRouterConfig)
        )
      )};
      export const basename = ${JSON.stringify(ctx.reactRouterConfig.basename)};
      export const future = ${JSON.stringify(ctx.reactRouterConfig.future)};
      export const ssr = ${ctx.reactRouterConfig.ssr};
      export const isSpaMode = ${isSpaModeEnabled(ctx.reactRouterConfig)};
      export const prerender = ${JSON.stringify(prerenderPaths)};
      export const publicPath = ${JSON.stringify(ctx.publicPath)};
      export const entry = { module: entryServer };
      export const routes = {
        ${Object.keys(routes)
          .map((key, index) => {
            let route = routes[key]!;
            return `${JSON.stringify(key)}: {
          id: ${JSON.stringify(route.id)},
          parentId: ${JSON.stringify(route.parentId)},
          path: ${JSON.stringify(route.path)},
          index: ${JSON.stringify(route.index)},
          caseSensitive: ${JSON.stringify(route.caseSensitive)},
          module: route${index}
        }`;
          })
          .join(",\n  ")}
      };`;
  };

  let loadViteManifest = async (directory: string) => {
    let manifestContents = await fse.readFile(
      path.resolve(directory, ".vite", "manifest.json"),
      "utf-8"
    );
    return JSON.parse(manifestContents) as Vite.Manifest;
  };

  let hasDependency = (name: string) => {
    try {
      return Boolean(require.resolve(name, { paths: [ctx.rootDirectory] }));
    } catch (err) {
      return false;
    }
  };

  let getViteManifestAssetPaths = (
    viteManifest: Vite.Manifest
  ): Set<string> => {
    // Get .css?url imports and CSS entry points
    let cssUrlPaths = Object.values(viteManifest)
      .filter((chunk) => chunk.file.endsWith(".css"))
      .map((chunk) => chunk.file);

    // Get bundled CSS files and generic asset types
    let chunkAssetPaths = Object.values(viteManifest).flatMap(
      (chunk) => chunk.assets ?? []
    );

    return new Set([...cssUrlPaths, ...chunkAssetPaths]);
  };

  let generateReactRouterManifestsForBuild = async ({
    routeIds,
  }: {
    routeIds?: Array<string>;
  }): Promise<{
    reactRouterBrowserManifest: ReactRouterManifest;
    reactRouterServerManifest: ReactRouterManifest;
  }> => {
    invariant(viteConfig);

    let viteManifest = await loadViteManifest(
      getClientBuildDirectory(ctx.reactRouterConfig)
    );

    let entry = getReactRouterManifestBuildAssets(
      ctx,
      viteManifest,
      ctx.entryClientFilePath
    );

    let browserRoutes: ReactRouterManifest["routes"] = {};
    let serverRoutes: ReactRouterManifest["routes"] = {};

    let routeManifestExports = await getRouteManifestModuleExports(
      viteChildCompiler,
      ctx
    );

    let enforceSplitRouteModules =
      ctx.reactRouterConfig.future.unstable_splitRouteModules === "enforce";
    for (let route of Object.values(ctx.reactRouterConfig.routes)) {
      let routeFile = path.join(ctx.reactRouterConfig.appDirectory, route.file);
      let sourceExports = routeManifestExports[route.id];
      let isRootRoute = route.parentId === undefined;
      let hasClientAction = sourceExports.includes("clientAction");
      let hasClientLoader = sourceExports.includes("clientLoader");
      let hasHydrateFallback = sourceExports.includes("HydrateFallback");

      let { hasRouteChunkByExportName } = await detectRouteChunksIfEnabled(
        cache,
        ctx,
        routeFile,
        { routeFile, viteChildCompiler }
      );

      if (enforceSplitRouteModules) {
        validateRouteChunks({
          ctx,
          id: route.file,
          valid: {
            clientAction:
              !hasClientAction || hasRouteChunkByExportName.clientAction,
            clientLoader:
              !hasClientLoader || hasRouteChunkByExportName.clientLoader,
            HydrateFallback:
              !hasHydrateFallback || hasRouteChunkByExportName.HydrateFallback,
          },
        });
      }

      let routeManifestEntry: ReactRouterManifest["routes"][string] = {
        id: route.id,
        parentId: route.parentId,
        path: route.path,
        index: route.index,
        caseSensitive: route.caseSensitive,
        hasAction: sourceExports.includes("action"),
        hasLoader: sourceExports.includes("loader"),
        hasClientAction,
        hasClientLoader,
        hasErrorBoundary: sourceExports.includes("ErrorBoundary"),
        ...getReactRouterManifestBuildAssets(
          ctx,
          viteManifest,
          `${routeFile}${BUILD_CLIENT_ROUTE_QUERY_STRING}`,
          // If this is the root route, we also need to include assets from the
          // client entry file as this is a common way for consumers to import
          // global reset styles, etc.
          isRootRoute ? [ctx.entryClientFilePath] : []
        ),
        clientActionModule: hasRouteChunkByExportName.clientAction
          ? getPublicModulePathForEntry(
              ctx,
              viteManifest,
              getRouteChunkModuleId(routeFile, "clientAction")
            )
          : undefined,
        clientLoaderModule: hasRouteChunkByExportName.clientLoader
          ? getPublicModulePathForEntry(
              ctx,
              viteManifest,
              getRouteChunkModuleId(routeFile, "clientLoader")
            )
          : undefined,
        hydrateFallbackModule: hasRouteChunkByExportName.HydrateFallback
          ? getPublicModulePathForEntry(
              ctx,
              viteManifest,
              getRouteChunkModuleId(routeFile, "HydrateFallback")
            )
          : undefined,
      };

      browserRoutes[route.id] = routeManifestEntry;

      if (!routeIds || routeIds.includes(route.id)) {
        serverRoutes[route.id] = routeManifestEntry;
      }
    }

    let fingerprintedValues = { entry, routes: browserRoutes };
    let version = getHash(JSON.stringify(fingerprintedValues), 8);
    let manifestPath = path.posix.join(
      viteConfig.build.assetsDir,
      `manifest-${version}.js`
    );
    let url = `${ctx.publicPath}${manifestPath}`;
    let nonFingerprintedValues = { url, version };

    let reactRouterBrowserManifest: ReactRouterManifest = {
      ...fingerprintedValues,
      ...nonFingerprintedValues,
    };

    // Write the browser manifest to disk as part of the build process
    await writeFileSafe(
      path.join(getClientBuildDirectory(ctx.reactRouterConfig), manifestPath),
      `window.__reactRouterManifest=${JSON.stringify(
        reactRouterBrowserManifest
      )};`
    );

    // The server manifest is the same as the browser manifest, except for
    // server bundle builds which only includes routes for the current bundle,
    // otherwise the server and client have the same routes
    let reactRouterServerManifest: ReactRouterManifest = {
      ...reactRouterBrowserManifest,
      routes: serverRoutes,
    };

    return {
      reactRouterBrowserManifest,
      reactRouterServerManifest,
    };
  };

  // In dev, the server and browser manifests are the same
  let getReactRouterManifestForDev = async (): Promise<ReactRouterManifest> => {
    let routes: ReactRouterManifest["routes"] = {};

    let routeManifestExports = await getRouteManifestModuleExports(
      viteChildCompiler,
      ctx
    );

    let enforceSplitRouteModules =
      ctx.reactRouterConfig.future.unstable_splitRouteModules === "enforce";

    for (let [key, route] of Object.entries(ctx.reactRouterConfig.routes)) {
      let routeFile = route.file;
      let sourceExports = routeManifestExports[key];
      let hasClientAction = sourceExports.includes("clientAction");
      let hasClientLoader = sourceExports.includes("clientLoader");
      let hasHydrateFallback = sourceExports.includes("HydrateFallback");
      let routeModulePath = combineURLs(
        ctx.publicPath,
        `${resolveFileUrl(
          ctx,
          resolveRelativeRouteFilePath(route, ctx.reactRouterConfig)
        )}`
      );

      if (enforceSplitRouteModules) {
        let { hasRouteChunkByExportName } = await detectRouteChunksIfEnabled(
          cache,
          ctx,
          routeFile,
          { routeFile, viteChildCompiler }
        );

        validateRouteChunks({
          ctx,
          id: route.file,
          valid: {
            clientAction:
              !hasClientAction || hasRouteChunkByExportName.clientAction,
            clientLoader:
              !hasClientLoader || hasRouteChunkByExportName.clientLoader,
            HydrateFallback:
              !hasHydrateFallback || hasRouteChunkByExportName.HydrateFallback,
          },
        });
      }

      routes[key] = {
        id: route.id,
        parentId: route.parentId,
        path: route.path,
        index: route.index,
        caseSensitive: route.caseSensitive,
        module: routeModulePath,
        // Split route modules are a build-time optimization
        clientActionModule: undefined,
        clientLoaderModule: undefined,
        hydrateFallbackModule: undefined,
        hasAction: sourceExports.includes("action"),
        hasLoader: sourceExports.includes("loader"),
        hasClientAction,
        hasClientLoader,
        hasErrorBoundary: sourceExports.includes("ErrorBoundary"),
        imports: [],
      };
    }

    return {
      version: String(Math.random()),
      url: combineURLs(ctx.publicPath, virtual.browserManifest.url),
      hmr: {
        runtime: combineURLs(ctx.publicPath, virtualInjectHmrRuntime.url),
      },
      entry: {
        module: combineURLs(
          ctx.publicPath,
          resolveFileUrl(ctx, ctx.entryClientFilePath)
        ),
        imports: [],
      },
      routes,
    };
  };

  return [
    {
      name: "react-router",
      config: async (_viteUserConfig, _viteConfigEnv) => {
        // Preload Vite's ESM build up-front as soon as we're in an async context
        await preloadVite();

        // Ensure sync import of Vite works after async preload
        let vite = getVite();

        viteUserConfig = _viteUserConfig;
        viteConfigEnv = _viteConfigEnv;
        viteCommand = viteConfigEnv.command;

        // This is a compatibility layer for Vite 5. Default conditions were
        // automatically added to any custom conditions in Vite 5, but Vite 6
        // removed this behavior. Instead, the default conditions are overridden
        // by any custom conditions. If we wish to retain the default
        // conditions, we need to manually merge them using the provided default
        // conditions arrays exported from Vite. In Vite 5, these default
        // conditions arrays do not exist.
        // https://vite.dev/guide/migration.html#default-value-for-resolve-conditions
        let viteClientConditions: string[] = [
          ...(vite.defaultClientConditions ?? []),
        ];

        logger = vite.createLogger(viteUserConfig.logLevel, {
          prefix: "[react-router]",
        });

        rootDirectory =
          viteUserConfig.root ?? process.env.REACT_ROUTER_ROOT ?? process.cwd();

        if (viteCommand === "serve") {
          typegenWatcherPromise = Typegen.watch(rootDirectory, {
            // ignore `info` logs from typegen since they are redundant when Vite plugin logs are active
            logger: vite.createLogger("warn", { prefix: "[react-router]" }),
          });
        }

        reactRouterConfigLoader = await createConfigLoader({
          rootDirectory,
          watch: viteCommand === "serve",
        });

        await updatePluginContext();
        buildManifest = await getBuildManifest(ctx);

        Object.assign(
          process.env,
          vite.loadEnv(
            viteConfigEnv.mode,
            viteUserConfig.envDir ?? ctx.rootDirectory,
            // We override default prefix of "VITE_" with a blank string since
            // we're targeting the server, so we want to load all environment
            // variables, not just those explicitly marked for the client
            ""
          )
        );

        let environments = await getEnvironmentsOptions(
          ctx,
          buildManifest,
          viteCommand,
          { viteUserConfig }
        );

        let serverEnvironment = getServerEnvironmentValues(
          environments,
          buildManifest
        )[0];
        invariant(serverEnvironment);

        let clientEnvironment = environments.client;
        invariant(clientEnvironment);

        return {
          __reactRouterPluginContext: ctx,
          appType:
            viteCommand === "serve" &&
            viteConfigEnv.mode === "production" &&
            ctx.reactRouterConfig.ssr === false
              ? "spa"
              : "custom",

          ssr: {
            external: serverEnvironment.resolve?.external,
            resolve: serverEnvironment.resolve,
          },
          optimizeDeps: {
            entries: ctx.reactRouterConfig.future.unstable_optimizeDeps
              ? [
                  vite.normalizePath(ctx.entryClientFilePath),
                  ...Object.values(ctx.reactRouterConfig.routes).map((route) =>
                    resolveRelativeRouteFilePath(route, ctx.reactRouterConfig)
                  ),
                ]
              : [],
            include: [
              // Pre-bundle React dependencies to avoid React duplicates,
              // even if React dependencies are not direct dependencies.
              // https://react.dev/warnings/invalid-hook-call-warning#duplicate-react
              "react",
              "react/jsx-runtime",
              "react/jsx-dev-runtime",
              "react-dom",
              "react-dom/client",

              // Pre-bundle router dependencies to avoid router duplicates.
              // Mismatching routers cause `Error: You must render this element inside a <Remix> element`.
              "react-router",
              "react-router/dom",
              // Check to avoid "Failed to resolve dependency: react-router-dom, present in 'optimizeDeps.include'"
              ...(hasDependency("react-router-dom")
                ? ["react-router-dom"]
                : []),
            ],
          },
          esbuild: {
            jsx: "automatic",
            jsxDev: viteCommand !== "build",
          },
          resolve: {
            dedupe: [
              // https://react.dev/warnings/invalid-hook-call-warning#duplicate-react
              "react",
              "react-dom",

              // see description for `optimizeDeps.include`
              "react-router",
              "react-router/dom",
              "react-router-dom",
            ],
            conditions:
              viteCommand === "build"
                ? viteClientConditions
                : ["development", ...viteClientConditions],
          },
          base: viteUserConfig.base,

          // When consumer provides an allow list for files that can be read by
          // the server, ensure that the default entry files are included.
          // If we don't do this and a default entry file is used, the server
          // will throw an error that the file is not allowed to be read.
          // https://vitejs.dev/config/server-options#server-fs-allow
          server: viteUserConfig.server?.fs?.allow
            ? { fs: { allow: defaultEntries } }
            : undefined,

          ...(ctx.reactRouterConfig.future.unstable_viteEnvironmentApi
            ? {
                environments,
                build: {
                  // This isn't honored by the SSR environment config (which seems
                  // to be a Vite bug?) so we set it here too.
                  ssrEmitAssets: true,
                },
                builder: {
                  sharedConfigBuild: true,
                  sharedPlugins: true,
                  async buildApp(builder) {
                    invariant(viteConfig);
                    invariant(buildManifest);

                    viteConfig.logger.info(
                      "Using Vite Environment API (experimental)"
                    );

                    let { reactRouterConfig } = ctx;

                    await cleanBuildDirectory(viteConfig, ctx);

                    await builder.build(builder.environments.client);

                    let serverEnvironments = getServerEnvironmentValues(
                      builder.environments,
                      buildManifest
                    );

                    await Promise.all(serverEnvironments.map(builder.build));

                    await cleanViteManifests(environments, ctx);

                    await reactRouterConfig.buildEnd?.({
                      buildManifest,
                      reactRouterConfig,
                      viteConfig,
                    });
                  },
                },
              }
            : {
                build:
                  ctx.environmentBuildContext?.options.build ??
                  (viteConfigEnv.isSsrBuild
                    ? serverEnvironment.build
                    : clientEnvironment.build),
              }),
        };
      },
      async configResolved(resolvedViteConfig) {
        await initEsModuleLexer;

        viteConfig = resolvedViteConfig;
        invariant(viteConfig);

        // We load the same Vite config file again for the child compiler so
        // that both parent and child compiler's plugins have independent state.
        // If we re-used the `viteUserConfig.plugins` array for the child
        // compiler, it could lead to mutating shared state between plugin
        // instances in unexpected ways, e.g. during `vite build` the
        // `configResolved` plugin hook would be called with `command = "build"`
        // by parent and then `command = "serve"` by child, which some plugins
        // may respond to by updating state referenced by the parent.
        if (!viteConfig.configFile) {
          throw new Error(
            "The React Router Vite plugin requires the use of a Vite config file"
          );
        }

        let vite = getVite();

        let childCompilerConfigFile = await vite.loadConfigFromFile(
          {
            command: viteConfig.command,
            mode: viteConfig.mode,
          },
          viteConfig.configFile
        );

        invariant(
          childCompilerConfigFile,
          "Vite config file was unable to be resolved for React Router child compiler"
        );

        // Validate that commonly used Rollup plugins that need to run before
        // ours are in the correct order. This is because Rollup plugins can't
        // set `enforce: "pre"` like Vite plugins can. Explicitly validating
        // this provides a much nicer developer experience.
        let rollupPrePlugins = [
          { pluginName: "@mdx-js/rollup", displayName: "@mdx-js/rollup" },
        ];
        for (let prePlugin of rollupPrePlugins) {
          let prePluginIndex = pluginIndex(prePlugin.pluginName);
          if (
            prePluginIndex >= 0 &&
            prePluginIndex > pluginIndex("react-router")
          ) {
            throw new Error(
              `The "${prePlugin.displayName}" plugin should be placed before the React Router plugin in your Vite config file`
            );
          }
        }

        viteChildCompiler = await vite.createServer({
          ...viteUserConfig,
          mode: viteConfig.mode,
          server: {
            watch: viteConfig.command === "build" ? null : undefined,
            preTransformRequests: false,
            hmr: false,
          },
          configFile: false,
          envFile: false,
          plugins: [
            ...(childCompilerConfigFile.config.plugins ?? [])
              .flat()
              // Exclude this plugin from the child compiler to prevent an
              // infinite loop (plugin creates a child compiler with the same
              // plugin that creates another child compiler, repeat ad
              // infinitum), and to prevent the manifest from being written to
              // disk from the child compiler. This is important in the
              // production build because the child compiler is a Vite dev
              // server and will generate incorrect manifests.
              .filter(
                (plugin) =>
                  typeof plugin === "object" &&
                  plugin !== null &&
                  "name" in plugin &&
                  plugin.name !== "react-router" &&
                  plugin.name !== "react-router:route-exports" &&
                  plugin.name !== "react-router:hmr-updates"
              ),
          ],
        });
        await viteChildCompiler.pluginContainer.buildStart({});
      },
      async transform(code, id) {
        if (isCssModulesFile(id)) {
          cssModulesManifest[id] = code;
        }
      },
      buildStart() {
        invariant(viteConfig);

        if (
          viteCommand === "build" &&
          viteConfig.mode === "production" &&
          !viteConfig.build.ssr &&
          viteConfig.build.sourcemap
        ) {
          viteConfig.logger.warn(
            colors.yellow(
              "\n" +
                colors.bold("  ⚠️  Source maps are enabled in production\n") +
                [
                  "This makes your server code publicly",
                  "visible in the browser. This is highly",
                  "discouraged! If you insist, ensure that",
                  "you are using environment variables for",
                  "secrets and not hard-coding them in",
                  "your source code.",
                ]
                  .map((line) => "     " + line)
                  .join("\n") +
                "\n"
            )
          );
        }
      },
      async configureServer(viteDevServer) {
        setDevServerHooks({
          // Give the request handler access to the critical CSS in dev to avoid a
          // flash of unstyled content since Vite injects CSS file contents via JS
          getCriticalCss: async (build, url) => {
            return getStylesForUrl({
              rootDirectory: ctx.rootDirectory,
              entryClientFilePath: ctx.entryClientFilePath,
              reactRouterConfig: ctx.reactRouterConfig,
              viteDevServer,
              cssModulesManifest,
              build,
              url,
            });
          },
          // If an error is caught within the request handler, let Vite fix the
          // stack trace so it maps back to the actual source code
          processRequestError: (error) => {
            if (error instanceof Error) {
              viteDevServer.ssrFixStacktrace(error);
            }
          },
        });

        reactRouterConfigLoader.onChange(
          async ({
            result,
            configCodeUpdated,
            configChanged,
            routeConfigChanged,
          }) => {
            if (!result.ok) {
              invalidateVirtualModules(viteDevServer);
              logger.error(result.error, {
                clear: true,
                timestamp: true,
              });
              return;
            }

            if (routeConfigChanged) {
              logger.info(colors.green("Route config changed."), {
                clear: true,
                timestamp: true,
              });
            } else if (configCodeUpdated) {
              logger.info(colors.green("Config updated."), {
                clear: true,
                timestamp: true,
              });
            }

            await updatePluginContext();

            if (configChanged) {
              invalidateVirtualModules(viteDevServer);
            }
          }
        );

        return () => {
          // Let user servers handle SSR requests in middleware mode,
          // otherwise the Vite plugin will handle the request
          if (!viteDevServer.config.server.middlewareMode) {
            viteDevServer.middlewares.use(async (req, res, next) => {
              try {
                let build = (await viteDevServer.ssrLoadModule(
                  virtual.serverBuild.id
                )) as ServerBuild;

                let handler = createRequestHandler(build, "development");
                let nodeHandler: NodeRequestHandler = async (
                  nodeReq,
                  nodeRes
                ) => {
                  let req = fromNodeRequest(nodeReq, nodeRes);
                  let res = await handler(
                    req,
                    await reactRouterDevLoadContext(req)
                  );
                  await toNodeRequest(res, nodeRes);
                };
                await nodeHandler(req, res);
              } catch (error) {
                next(error);
              }
            });
          }
        };
      },
      writeBundle: {
        // After the SSR build is finished, we inspect the Vite manifest for
        // the SSR build and move server-only assets to client assets directory
        async handler() {
          let { future } = ctx.reactRouterConfig;

          if (
            future.unstable_viteEnvironmentApi
              ? this.environment.name === "client"
              : !viteConfigEnv.isSsrBuild
          ) {
            return;
          }
          invariant(viteConfig);

          let clientBuildDirectory = getClientBuildDirectory(
            ctx.reactRouterConfig
          );

          let serverBuildDirectory = future.unstable_viteEnvironmentApi
            ? this.environment.config?.build?.outDir
            : ctx.environmentBuildContext?.options.build?.outDir ??
              getServerBuildDirectory(ctx);

          let ssrViteManifest = await loadViteManifest(serverBuildDirectory);
          let ssrAssetPaths = getViteManifestAssetPaths(ssrViteManifest);

          // We only move assets that aren't in the client build, otherwise we
          // remove them. These assets only exist because we explicitly set
          // `ssrEmitAssets: true` in the SSR Vite config. These assets
          // typically wouldn't exist by default, which is why we assume it's
          // safe to remove them. We're aiming for a clean build output so that
          // unnecessary assets don't get deployed alongside the server code.
          let movedAssetPaths: string[] = [];
          for (let ssrAssetPath of ssrAssetPaths) {
            let src = path.join(serverBuildDirectory, ssrAssetPath);
            let dest = path.join(clientBuildDirectory, ssrAssetPath);

            if (!fse.existsSync(dest)) {
              await fse.move(src, dest);
              movedAssetPaths.push(dest);
            } else {
              await fse.remove(src);
            }
          }

          // We assume CSS assets from the SSR build are unnecessary and remove
          // them for the same reasons as above.
          let ssrCssPaths = Object.values(ssrViteManifest).flatMap(
            (chunk) => chunk.css ?? []
          );
          await Promise.all(
            ssrCssPaths.map((cssPath) =>
              fse.remove(path.join(serverBuildDirectory, cssPath))
            )
          );

          if (movedAssetPaths.length) {
            viteConfig.logger.info(
              [
                "",
                `${colors.green("✓")} ${movedAssetPaths.length} asset${
                  movedAssetPaths.length > 1 ? "s" : ""
                } moved from React Router server build to client assets.`,
                ...movedAssetPaths.map((movedAssetPath) =>
                  colors.dim(path.relative(ctx.rootDirectory, movedAssetPath))
                ),
                "",
              ].join("\n")
            );
          }

          if (isPrerenderingEnabled(ctx.reactRouterConfig)) {
            // If we have prerender routes, that takes precedence over SPA mode
            // which is ssr:false and only the rot route being rendered
            await handlePrerender(
              viteConfig,
              ctx.reactRouterConfig,
              serverBuildDirectory,
              ssrViteManifest[virtual.serverBuild.id].file,
              clientBuildDirectory
            );
          }

          // When `ssr:false` is set, we always want a SPA HTML they can use
          // to serve non-prerendered routes.  This file will only SSR the root
          // route and can hydrate for any path.
          if (!ctx.reactRouterConfig.ssr) {
            await handleSpaMode(
              viteConfig,
              ctx.reactRouterConfig,
              serverBuildDirectory,
              ssrViteManifest[virtual.serverBuild.id].file,
              clientBuildDirectory
            );
          }

          // For both SPA mode and prerendering, we can remove the server builds
          // if ssr:false is set
          if (!ctx.reactRouterConfig.ssr) {
            // Cleanup - we no longer need the server build assets
            viteConfig.logger.info(
              [
                "Removing the server build in",
                colors.green(serverBuildDirectory),
                "due to ssr:false",
              ].join(" ")
            );
            fse.removeSync(serverBuildDirectory);
          }
        },
      },
      async buildEnd() {
        await viteChildCompiler?.close();
        await reactRouterConfigLoader.close();

        let typegenWatcher = await typegenWatcherPromise;
        await typegenWatcher?.close();
      },
    },
    {
      name: "react-router:route-chunks-index",
      // This plugin provides the route module "index" since route modules can
      // be chunked and may be made up of multiple smaller modules. This plugin
      // primarily ensures code is never duplicated across a route module and
      // its chunks. If we didn't have this plugin, any app that explicitly
      // imports a route module would result in duplicate code since the app
      // would contain code for both the unprocessed route module as well as its
      // individual chunks. This is because, since they have different module
      // IDs, they are treated as completely separate modules even though they
      // all reference the same underlying file. This plugin addresses this by
      // ensuring that any explicit imports of a route module resolve to a
      // module that simply re-exports from its underlying chunks, if present.
      async transform(code, id, options) {
        // Routes are only chunked in build mode
        if (viteCommand !== "build") return;

        // Routes aren't chunked on the server
        if (options?.ssr) {
          return;
        }

        // Ensure we're only operating on routes
        if (!isRoute(ctx.reactRouterConfig, id)) {
          return;
        }

        // Ensure we're only operating on raw route module imports
        if (isRouteVirtualModule(id)) {
          return;
        }

        let { hasRouteChunks, chunkedExports } =
          await detectRouteChunksIfEnabled(cache, ctx, id, code);

        // If there are no chunks, we can let this resolve to the raw route
        // module since there's no risk of duplication
        if (!hasRouteChunks) {
          return;
        }

        let sourceExports = await getRouteModuleExports(
          viteChildCompiler,
          ctx,
          id
        );

        let isMainChunkExport = (name: string) =>
          !chunkedExports.includes(name as string & RouteChunkExportName);

        let mainChunkReexports = sourceExports
          .filter(isMainChunkExport)
          .join(", ");

        let chunkBasePath = `./${path.basename(id)}`;

        return [
          `export { ${mainChunkReexports} } from "${getRouteChunkModuleId(
            chunkBasePath,
            "main"
          )}";`,
          ...chunkedExports.map(
            (exportName) =>
              `export { ${exportName} } from "${getRouteChunkModuleId(
                chunkBasePath,
                exportName
              )}";`
          ),
        ]
          .filter(Boolean)
          .join("\n");
      },
    },
    {
      name: "react-router:build-client-route",
      async transform(code, id, options) {
        if (!id.endsWith(BUILD_CLIENT_ROUTE_QUERY_STRING)) return;
        let routeModuleId = id.replace(BUILD_CLIENT_ROUTE_QUERY_STRING, "");

        let routeFileName = path.basename(routeModuleId);

        let sourceExports = await getRouteModuleExports(
          viteChildCompiler,
          ctx,
          routeModuleId
        );

        let { chunkedExports = [] } = options?.ssr
          ? {}
          : await detectRouteChunksIfEnabled(cache, ctx, id, code);

        let reexports = sourceExports
          .filter((exportName) => {
            let isRouteEntryExport =
              (options?.ssr &&
                SERVER_ONLY_ROUTE_EXPORTS.includes(exportName)) ||
              CLIENT_ROUTE_EXPORTS.includes(exportName);

            let isChunkedExport = chunkedExports.includes(
              exportName as string & RouteChunkExportName
            );

            return isRouteEntryExport && !isChunkedExport;
          })
          .join(", ");

        return `export { ${reexports} } from "./${routeFileName}";`;
      },
    },
    {
      name: "react-router:split-route-modules",
      async transform(code, id, options) {
        // Routes aren't chunked on the server
        if (options?.ssr) return;

        // Ignore anything that isn't marked as a route chunk
        if (!isRouteChunkModuleId(id)) return;

        invariant(
          viteCommand === "build",
          "Route modules are only split in build mode"
        );

        let chunkName = getRouteChunkNameFromModuleId(id);

        if (!chunkName) {
          throw new Error(`Invalid route chunk name "${chunkName}" in "${id}"`);
        }

        let chunk = await getRouteChunkIfEnabled(
          cache,
          ctx,
          id,
          chunkName,
          code
        );

        let preventEmptyChunkSnippet = ({ reason }: { reason: string }) =>
          `Math.random()<0&&console.log(${JSON.stringify(reason)});`;

        if (chunk === null) {
          return preventEmptyChunkSnippet({
            reason: "Split round modules disabled",
          });
        }

        let enforceSplitRouteModules =
          ctx.reactRouterConfig.future.unstable_splitRouteModules === "enforce";

        if (enforceSplitRouteModules && chunkName === "main" && chunk) {
          let exportNames = getExportNames(chunk.code);

          validateRouteChunks({
            ctx,
            id,
            valid: {
              clientAction: !exportNames.includes("clientAction"),
              clientLoader: !exportNames.includes("clientLoader"),
              HydrateFallback: !exportNames.includes("HydrateFallback"),
            },
          });
        }

        return (
          chunk ?? preventEmptyChunkSnippet({ reason: `No ${chunkName} chunk` })
        );
      },
    },
    {
      name: "react-router:virtual-modules",
      enforce: "pre",
      resolveId(id) {
        let [baseId, queryString] = id.split("?");
        const vmod = Object.values(virtual).find((vmod) => vmod.id === baseId);
        if (vmod)
          return vmod.resolvedId + (queryString ? `?${queryString}` : "");
      },
      async load(id) {
        let [baseId, queryString] = id.split("?");
        switch (baseId) {
          case virtual.serverBuild.resolvedId: {
            let searchParams = new URLSearchParams(queryString);
            let routeIds =
              searchParams.get("route-ids")?.split(",") || undefined;
            return await getServerEntry({ routeIds });
          }
          case virtual.serverManifest.resolvedId: {
            let searchParams = new URLSearchParams(queryString);
            let routeIds =
              searchParams.get("route-ids")?.split(",") || undefined;
            let reactRouterManifest =
              viteCommand === "build"
                ? (
                    await generateReactRouterManifestsForBuild({
                      routeIds,
                    })
                  ).reactRouterServerManifest
                : await getReactRouterManifestForDev();

            // Check for invalid APIs when SSR is disabled
            if (!ctx.reactRouterConfig.ssr) {
              invariant(viteConfig);
              validateSsrFalsePrerenderExports(
                viteConfig,
                ctx,
                reactRouterManifest,
                viteChildCompiler
              );
            }

            return `export default ${jsesc(reactRouterManifest, {
              es6: true,
            })};`;
          }
          case virtual.browserManifest.resolvedId: {
            if (viteCommand === "build") {
              throw new Error("This module only exists in development");
            }

            let reactRouterManifest = await getReactRouterManifestForDev();
            let reactRouterManifestString = jsesc(reactRouterManifest, {
              es6: true,
            });

            return `window.__reactRouterManifest=${reactRouterManifestString};`;
          }
        }
      },
    },
    {
      name: "react-router:dot-server",
      enforce: "pre",
      async resolveId(id, importer, options) {
        // https://vitejs.dev/config/dep-optimization-options
        let isOptimizeDeps =
          viteCommand === "serve" &&
          (options as { scan?: boolean })?.scan === true;

        if (isOptimizeDeps || options?.ssr) return;

        let isResolving = options?.custom?.["react-router:dot-server"] ?? false;
        if (isResolving) return;
        options.custom = { ...options.custom, "react-router:dot-server": true };
        let resolved = await this.resolve(id, importer, options);
        if (!resolved) return;

        let serverFileRE = /\.server(\.[cm]?[jt]sx?)?$/;
        let serverDirRE = /\/\.server\//;
        let isDotServer =
          serverFileRE.test(resolved!.id) || serverDirRE.test(resolved!.id);
        if (!isDotServer) return;

        if (!importer) return;
        if (viteCommand !== "build" && importer.endsWith(".html")) {
          // Vite has a special `index.html` importer for `resolveId` within `transformRequest`
          // https://github.com/vitejs/vite/blob/5684fcd8d27110d098b3e1c19d851f44251588f1/packages/vite/src/node/server/transformRequest.ts#L158
          // https://github.com/vitejs/vite/blob/5684fcd8d27110d098b3e1c19d851f44251588f1/packages/vite/src/node/server/pluginContainer.ts#L668
          return;
        }

        let vite = getVite();
        let importerShort = vite.normalizePath(
          path.relative(ctx.rootDirectory, importer)
        );
        if (isRoute(ctx.reactRouterConfig, importer)) {
          let serverOnlyExports = SERVER_ONLY_ROUTE_EXPORTS.map(
            (xport) => `\`${xport}\``
          ).join(", ");
          throw Error(
            [
              colors.red(`Server-only module referenced by client`),
              "",
              `    '${id}' imported by route '${importerShort}'`,
              "",
              `  React Router automatically removes server-code from these exports:`,
              `    ${serverOnlyExports}`,
              "",
              `  But other route exports in '${importerShort}' depend on '${id}'.`,
              "",
              "  See https://remix.run/docs/en/main/guides/vite#splitting-up-client-and-server-code",
              "",
            ].join("\n")
          );
        }

        throw Error(
          [
            colors.red(`Server-only module referenced by client`),
            "",
            `    '${id}' imported by '${importerShort}'`,
            "",
            "  See https://remix.run/docs/en/main/guides/vite#splitting-up-client-and-server-code",
            "",
          ].join("\n")
        );
      },
    },
    {
      name: "react-router:dot-client",
      async transform(code, id, options) {
        if (!options?.ssr) return;
        let clientFileRE = /\.client(\.[cm]?[jt]sx?)?$/;
        let clientDirRE = /\/\.client\//;
        if (clientFileRE.test(id) || clientDirRE.test(id)) {
          let exports = getExportNames(code);
          return {
            code: exports
              .map((name) =>
                name === "default"
                  ? "export default undefined;"
                  : `export const ${name} = undefined;`
              )
              .join("\n"),
            map: null,
          };
        }
      },
    },
    WithProps.plugin,
    {
      name: "react-router:route-exports",
      async transform(code, id, options) {
        // Ensure we perform this transform on all route module chunks
        if (isRouteChunkModuleId(id)) {
          id = id.split("?")[0];
        }

        let route = getRoute(ctx.reactRouterConfig, id);
        if (!route) return;

        if (!options?.ssr && isSpaModeEnabled(ctx.reactRouterConfig)) {
          let exportNames = getExportNames(code);
          let serverOnlyExports = exportNames.filter((exp) => {
            // Root route can have a loader in SPA mode
            if (route.id === "root" && exp === "loader") {
              return false;
            }
            return SERVER_ONLY_ROUTE_EXPORTS.includes(exp);
          });

          if (serverOnlyExports.length > 0) {
            let str = serverOnlyExports.map((e) => `\`${e}\``).join(", ");
            let message =
              `SPA Mode: ${serverOnlyExports.length} invalid route export(s) in ` +
              `\`${route.file}\`: ${str}. See https://reactrouter.com/how-to/spa ` +
              `for more information.`;
            throw Error(message);
          }

          if (route.id !== "root") {
            let hasHydrateFallback = exportNames.some(
              (exp) => exp === "HydrateFallback"
            );
            if (hasHydrateFallback) {
              let message =
                `SPA Mode: Invalid \`HydrateFallback\` export found in ` +
                `\`${route.file}\`. \`HydrateFallback\` is only permitted on ` +
                `the root route in SPA Mode. See https://reactrouter.com/how-to/spa ` +
                `for more information.`;
              throw Error(message);
            }
          }
        }

        let [filepath] = id.split("?");

        let ast = parse(code, { sourceType: "module" });
        if (!options?.ssr) {
          removeExports(ast, SERVER_ONLY_ROUTE_EXPORTS);
        }
        WithProps.transform(ast);
        return generate(ast, {
          sourceMaps: true,
          filename: id,
          sourceFileName: filepath,
        });
      },
    },
    {
      name: "react-router:inject-hmr-runtime",
      enforce: "pre",
      resolveId(id) {
        if (id === virtualInjectHmrRuntime.id) {
          return virtualInjectHmrRuntime.resolvedId;
        }
      },
      async load(id) {
        if (id !== virtualInjectHmrRuntime.resolvedId) return;

        return [
          `import RefreshRuntime from "${virtualHmrRuntime.id}"`,
          "RefreshRuntime.injectIntoGlobalHook(window)",
          "window.$RefreshReg$ = () => {}",
          "window.$RefreshSig$ = () => (type) => type",
          "window.__vite_plugin_react_preamble_installed__ = true",
        ].join("\n");
      },
    },
    {
      name: "react-router:hmr-runtime",
      enforce: "pre",
      resolveId(id) {
        if (id === virtualHmrRuntime.id) return virtualHmrRuntime.resolvedId;
      },
      async load(id) {
        if (id !== virtualHmrRuntime.resolvedId) return;

        let reactRefreshDir = path.dirname(
          require.resolve("react-refresh/package.json")
        );
        let reactRefreshRuntimePath = path.join(
          reactRefreshDir,
          "cjs/react-refresh-runtime.development.js"
        );

        return [
          "const exports = {}",
          await fse.readFile(reactRefreshRuntimePath, "utf8"),
          await fse.readFile(
            require.resolve("./static/refresh-utils.cjs"),
            "utf8"
          ),
          "export default exports",
        ].join("\n");
      },
    },
    {
      name: "react-router:react-refresh-babel",
      async transform(code, id, options) {
        if (viteCommand !== "serve") return;
        if (id.includes("/node_modules/")) return;

        let [filepath] = id.split("?");
        let extensionsRE = /\.(jsx?|tsx?|mdx?)$/;
        if (!extensionsRE.test(filepath)) return;

        let devRuntime = "react/jsx-dev-runtime";
        let ssr = options?.ssr === true;
        let isJSX = filepath.endsWith("x");
        let useFastRefresh = !ssr && (isJSX || code.includes(devRuntime));
        if (!useFastRefresh) return;

        if (isRouteVirtualModule(id)) {
          return { code: addRefreshWrapper(ctx.reactRouterConfig, code, id) };
        }

        let result = await babel.transformAsync(code, {
          babelrc: false,
          configFile: false,
          filename: id,
          sourceFileName: filepath,
          parserOpts: {
            sourceType: "module",
            allowAwaitOutsideFunction: true,
          },
          plugins: [[require("react-refresh/babel"), { skipEnvCheck: true }]],
          sourceMaps: true,
        });
        if (result === null) return;

        code = result.code!;
        let refreshContentRE = /\$Refresh(?:Reg|Sig)\$\(/;
        if (refreshContentRE.test(code)) {
          code = addRefreshWrapper(ctx.reactRouterConfig, code, id);
        }
        return { code, map: result.map };
      },
    },
    {
      name: "react-router:hmr-updates",
      async handleHotUpdate({ server, file, modules, read }) {
        let route = getRoute(ctx.reactRouterConfig, file);

        type HmrEventData = { route: ManifestRoute | null };
        let hmrEventData: HmrEventData = { route: null };

        if (route) {
          // invalidate manifest on route exports change
          let serverManifest = (
            await server.ssrLoadModule(virtual.serverManifest.id)
          ).default as ReactRouterManifest;

          let oldRouteMetadata = serverManifest.routes[route.id];
          let newRouteMetadata = await getRouteMetadata(
            cache,
            ctx,
            viteChildCompiler,
            route,
            read
          );

          hmrEventData.route = newRouteMetadata;

          if (
            !oldRouteMetadata ||
            (
              [
                "hasLoader",
                "hasClientLoader",
                "clientLoaderModule",
                "hasAction",
                "hasClientAction",
                "clientActionModule",
                "hasErrorBoundary",
                "hydrateFallbackModule",
              ] as const
            ).some((key) => oldRouteMetadata[key] !== newRouteMetadata[key])
          ) {
            invalidateVirtualModules(server);
          }
        }

        server.hot.send({
          type: "custom",
          event: "react-router:hmr",
          data: hmrEventData,
        });

        return modules;
      },
    },
    {
      name: "react-router-server-change-trigger-client-hmr",
      // This hook is only available in Vite v6+ so this is a no-op in v5.
      // Previously the server and client modules were shared in a single module
      // graph. This meant that changes to server code automatically resulted in
      // client HMR updates. In Vite v6+ these module graphs are separate from
      // each other so we need to manually trigger client HMR updates if server
      // code has changed.
      hotUpdate(this, { server, modules }) {
        if (this.environment.name !== "ssr" && modules.length <= 0) {
          return;
        }

        let clientModules = uniqueNodes(
          modules.flatMap((mod) =>
            getParentClientNodes(server.environments.client.moduleGraph, mod)
          )
        );

        for (let clientModule of clientModules) {
          server.environments.client.reloadModule(clientModule);
        }
      },
    },
  ];
};

function getParentClientNodes(
  clientModuleGraph: Vite.EnvironmentModuleGraph,
  module: Vite.EnvironmentModuleNode
): Vite.EnvironmentModuleNode[] {
  if (!module.id) {
    return [];
  }

  let clientModule = clientModuleGraph.getModuleById(module.id);
  if (clientModule) {
    return [clientModule];
  }

  return [...module.importers].flatMap((importer) =>
    getParentClientNodes(clientModuleGraph, importer)
  );
}

function uniqueNodes(
  nodes: Vite.EnvironmentModuleNode[]
): Vite.EnvironmentModuleNode[] {
  let nodeUrls = new Set<string>();
  let unique: Vite.EnvironmentModuleNode[] = [];
  for (let node of nodes) {
    if (nodeUrls.has(node.url)) {
      continue;
    }
    nodeUrls.add(node.url);
    unique.push(node);
  }
  return unique;
}

function findConfig(
  dir: string,
  basename: string,
  extensions: string[]
): string | undefined {
  for (let ext of extensions) {
    let name = basename + ext;
    let file = path.join(dir, name);
    if (fse.existsSync(file)) return file;
  }

  return undefined;
}

function addRefreshWrapper(
  reactRouterConfig: ResolvedReactRouterConfig,
  code: string,
  id: string
): string {
  let route = getRoute(reactRouterConfig, id);
  let acceptExports = route
    ? [
        "clientAction",
        "clientLoader",
        "handle",
        "meta",
        "links",
        "shouldRevalidate",
      ]
    : [];
  return (
    REACT_REFRESH_HEADER.replaceAll("__SOURCE__", JSON.stringify(id)) +
    code +
    REACT_REFRESH_FOOTER.replaceAll("__SOURCE__", JSON.stringify(id))
      .replaceAll("__ACCEPT_EXPORTS__", JSON.stringify(acceptExports))
      .replaceAll("__ROUTE_ID__", JSON.stringify(route?.id))
  );
}

const REACT_REFRESH_HEADER = `
import RefreshRuntime from "${virtualHmrRuntime.id}";

const inWebWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
let prevRefreshReg;
let prevRefreshSig;

if (import.meta.hot && !inWebWorker) {
  if (!window.__vite_plugin_react_preamble_installed__) {
    throw new Error(
      "React Router Vite plugin can't detect preamble. Something is wrong."
    );
  }

  prevRefreshReg = window.$RefreshReg$;
  prevRefreshSig = window.$RefreshSig$;
  window.$RefreshReg$ = (type, id) => {
    RefreshRuntime.register(type, __SOURCE__ + " " + id)
  };
  window.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform;
}`.replaceAll("\n", ""); // Header is all on one line so source maps aren't affected

const REACT_REFRESH_FOOTER = `
if (import.meta.hot && !inWebWorker) {
  window.$RefreshReg$ = prevRefreshReg;
  window.$RefreshSig$ = prevRefreshSig;
  RefreshRuntime.__hmr_import(import.meta.url).then((currentExports) => {
    RefreshRuntime.registerExportsForReactRefresh(__SOURCE__, currentExports);
    import.meta.hot.accept((nextExports) => {
      if (!nextExports) return;
      __ROUTE_ID__ && window.__reactRouterRouteModuleUpdates.set(__ROUTE_ID__, nextExports);
      const invalidateMessage = RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate(currentExports, nextExports, __ACCEPT_EXPORTS__);
      if (invalidateMessage) import.meta.hot.invalidate(invalidateMessage);
    });
  });
}`;

function getRoute(
  pluginConfig: ResolvedReactRouterConfig,
  file: string
): RouteManifestEntry | undefined {
  let vite = getVite();
  let routePath = vite.normalizePath(
    path.relative(pluginConfig.appDirectory, file)
  );
  let route = Object.values(pluginConfig.routes).find(
    (r) => vite.normalizePath(r.file) === routePath
  );
  return route;
}

function isRoute(
  pluginConfig: ResolvedReactRouterConfig,
  file: string
): boolean {
  return Boolean(getRoute(pluginConfig, file));
}

async function getRouteMetadata(
  cache: Cache,
  ctx: ReactRouterPluginContext,
  viteChildCompiler: Vite.ViteDevServer | null,
  route: RouteManifestEntry,
  readRouteFile?: () => string | Promise<string>
): Promise<ManifestRoute & { url: string }> {
  let routeFile = route.file;
  let sourceExports = await getRouteModuleExports(
    viteChildCompiler,
    ctx,
    route.file,
    readRouteFile
  );

  let { hasRouteChunkByExportName } = await detectRouteChunksIfEnabled(
    cache,
    ctx,
    routeFile,
    { routeFile, readRouteFile, viteChildCompiler }
  );

  let moduleUrl = combineURLs(
    ctx.publicPath,
    `${resolveFileUrl(
      ctx,
      resolveRelativeRouteFilePath(route, ctx.reactRouterConfig)
    )}`
  );

  let info: ManifestRoute & { url: string } = {
    id: route.id,
    parentId: route.parentId,
    path: route.path,
    index: route.index,
    caseSensitive: route.caseSensitive,
    url: combineURLs(
      ctx.publicPath,
      "/" +
        path.relative(
          ctx.rootDirectory,
          resolveRelativeRouteFilePath(route, ctx.reactRouterConfig)
        )
    ),
    module: `${moduleUrl}?import`, // Ensure the Vite dev server responds with a JS module
    clientActionModule: hasRouteChunkByExportName.clientAction
      ? `${getRouteChunkModuleId(moduleUrl, "clientAction")}`
      : undefined,
    clientLoaderModule: hasRouteChunkByExportName.clientLoader
      ? `${getRouteChunkModuleId(moduleUrl, "clientLoader")}`
      : undefined,
    hydrateFallbackModule: hasRouteChunkByExportName.HydrateFallback
      ? `${getRouteChunkModuleId(moduleUrl, "HydrateFallback")}`
      : undefined,
    hasAction: sourceExports.includes("action"),
    hasClientAction: sourceExports.includes("clientAction"),
    hasLoader: sourceExports.includes("loader"),
    hasClientLoader: sourceExports.includes("clientLoader"),
    hasErrorBoundary: sourceExports.includes("ErrorBoundary"),
    imports: [],
  };
  return info;
}

function isPrerenderingEnabled(
  reactRouterConfig: ReactRouterPluginContext["reactRouterConfig"]
) {
  return (
    reactRouterConfig.prerender != null && reactRouterConfig.prerender !== false
  );
}

function isSpaModeEnabled(
  reactRouterConfig: ReactRouterPluginContext["reactRouterConfig"]
) {
  // "SPA Mode" is possible in 2 ways:
  //  - `ssr:false` and no `prerender` config (undefined or null)
  //  - `ssr:false` and `prerender: false`
  //    - not an expected config but since we support `prerender:true` we allow it
  //
  // "SPA Mode" means we will only prerender a *single* `index.html` file which
  // prerenders only to the root route and thus can hydrate for _any_ path and
  // the proper routes below the root will be loaded via `route.lazy` during
  // hydration.
  //
  // If `ssr:false` is specified and the user provided a `prerender` config -
  // then it's no longer a "SPA" because we are generating multiple HTML pages.
  // It's now a MPA and we can prerender down past the root, which unlocks the
  // ability to use loaders on any routes and prerender the UI with build-time
  // loaderData
  return (
    reactRouterConfig.ssr === false && !isPrerenderingEnabled(reactRouterConfig)
  );
}

async function getPrerenderBuildAndHandler(
  viteConfig: Vite.ResolvedConfig,
  serverBuildDirectory: string,
  serverBuildFile: string
) {
  let serverBuildPath = path.join(serverBuildDirectory, serverBuildFile);
  let build = await import(url.pathToFileURL(serverBuildPath).toString());
  let { createRequestHandler: createHandler } = await import("react-router");
  return {
    build: build as ServerBuild,
    handler: createHandler(build, viteConfig.mode),
  };
}

async function handleSpaMode(
  viteConfig: Vite.ResolvedConfig,
  reactRouterConfig: ResolvedReactRouterConfig,
  serverBuildDirectory: string,
  serverBuildFile: string,
  clientBuildDirectory: string
) {
  let { build, handler } = await getPrerenderBuildAndHandler(
    viteConfig,
    serverBuildDirectory,
    serverBuildFile
  );
  let request = new Request(`http://localhost${reactRouterConfig.basename}`, {
    headers: {
      // Enable SPA mode in the server runtime and only render down to the root
      "X-React-Router-SPA-Mode": "yes",
    },
  });
  let response = await handler(request);
  let html = await response.text();

  // If the user prerendered `/`, then we write this out to a separate file
  // they can serve.  Otherwise it can be the main entry point.
  let isPrerenderSpaFallback = build.prerender.includes("/");
  let filename = isPrerenderSpaFallback ? "__spa-fallback.html" : "index.html";
  if (response.status !== 200) {
    if (isPrerenderSpaFallback) {
      throw new Error(
        `Prerender: Received a ${response.status} status code from ` +
          `\`entry.server.tsx\` while prerendering your \`${filename}\` file.\n` +
          html
      );
    } else {
      throw new Error(
        `SPA Mode: Received a ${response.status} status code from ` +
          `\`entry.server.tsx\` while prerendering your \`${filename}\` file.\n` +
          html
      );
    }
  }

  if (
    !html.includes("window.__reactRouterContext =") ||
    !html.includes("window.__reactRouterRouteModules =")
  ) {
    throw new Error(
      "SPA Mode: Did you forget to include `<Scripts/>` in your root route? " +
        "Your pre-rendered HTML cannot hydrate without `<Scripts />`."
    );
  }

  // Write out the HTML file for the SPA
  await fse.writeFile(path.join(clientBuildDirectory, filename), html);
  let prettyDir = path.relative(process.cwd(), clientBuildDirectory);
  let prettyPath = path.join(prettyDir, filename);
  if (build.prerender.length > 0) {
    viteConfig.logger.info(
      `Prerender (html): SPA Fallback -> ${colors.bold(prettyPath)}`
    );
  } else {
    viteConfig.logger.info(`SPA Mode: Generated ${colors.bold(prettyPath)}`);
  }
}

async function handlePrerender(
  viteConfig: Vite.ResolvedConfig,
  reactRouterConfig: ResolvedReactRouterConfig,
  serverBuildDirectory: string,
  serverBuildPath: string,
  clientBuildDirectory: string
) {
  let { build, handler } = await getPrerenderBuildAndHandler(
    viteConfig,
    serverBuildDirectory,
    serverBuildPath
  );

  let routes = createPrerenderRoutes(build.routes);
  let headers = {
    // Header that can be used in the loader to know if you're running at
    // build time or runtime
    "X-React-Router-Prerender": "yes",
  };
  for (let path of build.prerender) {
    // Ensure we have a leading slash for matching
    let matches = matchRoutes(routes, `/${path}/`.replace(/^\/\/+/, "/"));
    invariant(
      matches,
      `Unable to prerender path because it does not match any routes: ${path}`
    );
    // When prerendering a resource route, we don't want to pass along the
    // `.data` file since we want to prerender the raw Response returned from
    // the loader.  Presumably this is for routes where a file extension is
    // already included, such as `app/routes/items[.json].tsx` that will
    // render into `/items.json`
    let leafRoute = matches ? matches[matches.length - 1].route : null;
    let manifestRoute = leafRoute ? build.routes[leafRoute.id]?.module : null;
    let isResourceRoute =
      manifestRoute && !manifestRoute.default && !manifestRoute.ErrorBoundary;

    if (isResourceRoute) {
      invariant(leafRoute);
      invariant(manifestRoute);
      if (manifestRoute.loader) {
        // Prerender a .data file for turbo-stream consumption
        await prerenderData(
          handler,
          path,
          [leafRoute.id],
          clientBuildDirectory,
          reactRouterConfig,
          viteConfig,
          { headers }
        );
        // Prerender a raw file for external consumption
        await prerenderResourceRoute(
          handler,
          path,
          clientBuildDirectory,
          reactRouterConfig,
          viteConfig,
          { headers }
        );
      } else {
        viteConfig.logger.warn(
          `⚠️ Skipping prerendering for resource route without a loader: ${leafRoute?.id}`
        );
      }
    } else {
      let hasLoaders = matches.some(
        (m) => build.assets.routes[m.route.id]?.hasLoader
      );
      let data: string | undefined;
      if (!isResourceRoute && hasLoaders) {
        data = await prerenderData(
          handler,
          path,
          null,
          clientBuildDirectory,
          reactRouterConfig,
          viteConfig,
          { headers }
        );
      }

      await prerenderRoute(
        handler,
        path,
        clientBuildDirectory,
        reactRouterConfig,
        viteConfig,
        data
          ? {
              headers: {
                ...headers,
                "X-React-Router-Prerender-Data": encodeURI(data),
              },
            }
          : { headers }
      );
    }
  }
}

function getStaticPrerenderPaths(routes: DataRouteObject[]) {
  // Always start with the root/index route included
  let paths: string[] = ["/"];
  let paramRoutes: string[] = [];

  // Then recursively add any new path defined by the tree
  function recurse(subtree: typeof routes, prefix = "") {
    for (let route of subtree) {
      let newPath = [prefix, route.path].join("/").replace(/\/\/+/g, "/");
      if (route.path) {
        let segments = route.path.split("/");
        if (segments.some((s) => s.startsWith(":") || s === "*")) {
          paramRoutes.push(route.path);
        } else {
          paths.push(newPath);
        }
      }
      if (route.children) {
        recurse(route.children, newPath);
      }
    }
  }
  recurse(routes);

  // Clean double slashes and remove trailing slashes
  return {
    paths: paths.map((p) => p.replace(/\/\/+/g, "/").replace(/(.+)\/$/, "$1")),
    paramRoutes,
  };
}

async function prerenderData(
  handler: RequestHandler,
  prerenderPath: string,
  onlyRoutes: string[] | null,
  clientBuildDirectory: string,
  reactRouterConfig: ResolvedReactRouterConfig,
  viteConfig: Vite.ResolvedConfig,
  requestInit: RequestInit
) {
  let normalizedPath = `${reactRouterConfig.basename}${
    prerenderPath === "/"
      ? "/_root.data"
      : `${prerenderPath.replace(/\/$/, "")}.data`
  }`.replace(/\/\/+/g, "/");
  let url = new URL(`http://localhost${normalizedPath}`);
  if (onlyRoutes?.length) {
    url.searchParams.set("_routes", onlyRoutes.join(","));
  }
  let request = new Request(url, requestInit);
  let response = await handler(request);
  let data = await response.text();

  if (response.status !== 200) {
    throw new Error(
      `Prerender (data): Received a ${response.status} status code from ` +
        `\`entry.server.tsx\` while prerendering the \`${path}\` ` +
        `path.\n${normalizedPath}`
    );
  }

  // Write out the .data file
  let outdir = path.relative(process.cwd(), clientBuildDirectory);
  let outfile = path.join(outdir, ...normalizedPath.split("/"));
  await fse.ensureDir(path.dirname(outfile));
  await fse.outputFile(outfile, data);
  viteConfig.logger.info(
    `Prerender (data): ${prerenderPath} -> ${colors.bold(outfile)}`
  );
  return data;
}

async function prerenderRoute(
  handler: RequestHandler,
  prerenderPath: string,
  clientBuildDirectory: string,
  reactRouterConfig: ResolvedReactRouterConfig,
  viteConfig: Vite.ResolvedConfig,
  requestInit: RequestInit
) {
  let normalizedPath = `${reactRouterConfig.basename}${prerenderPath}/`.replace(
    /\/\/+/g,
    "/"
  );
  let request = new Request(`http://localhost${normalizedPath}`, requestInit);
  let response = await handler(request);
  let html = await response.text();

  if (response.status !== 200) {
    throw new Error(
      `Prerender (html): Received a ${response.status} status code from ` +
        `\`entry.server.tsx\` while prerendering the \`${normalizedPath}\` ` +
        `path.\n${html}`
    );
  }

  // Write out the HTML file
  let outdir = path.relative(process.cwd(), clientBuildDirectory);
  let outfile = path.join(outdir, ...normalizedPath.split("/"), "index.html");
  await fse.ensureDir(path.dirname(outfile));
  await fse.outputFile(outfile, html);
  viteConfig.logger.info(
    `Prerender (html): ${prerenderPath} -> ${colors.bold(outfile)}`
  );
}

async function prerenderResourceRoute(
  handler: RequestHandler,
  prerenderPath: string,
  clientBuildDirectory: string,
  reactRouterConfig: ResolvedReactRouterConfig,
  viteConfig: Vite.ResolvedConfig,
  requestInit: RequestInit
) {
  let normalizedPath = `${reactRouterConfig.basename}${prerenderPath}/`
    .replace(/\/\/+/g, "/")
    .replace(/\/$/g, "");
  let request = new Request(`http://localhost${normalizedPath}`, requestInit);
  let response = await handler(request);
  let text = await response.text();

  if (response.status !== 200) {
    throw new Error(
      `Prerender (resource): Received a ${response.status} status code from ` +
        `\`entry.server.tsx\` while prerendering the \`${normalizedPath}\` ` +
        `path.\n${text}`
    );
  }

  // Write out the resource route file
  let outdir = path.relative(process.cwd(), clientBuildDirectory);
  let outfile = path.join(outdir, ...normalizedPath.split("/"));
  await fse.ensureDir(path.dirname(outfile));
  await fse.outputFile(outfile, text);
  viteConfig.logger.info(
    `Prerender (resource): ${prerenderPath} -> ${colors.bold(outfile)}`
  );
}

// Allows us to use both the RouteManifest and the ServerRouteManifest from the build
export interface GenericRouteManifest {
  [routeId: string]: Omit<RouteManifestEntry, "file"> | undefined;
}

export async function getPrerenderPaths(
  prerender: ResolvedReactRouterConfig["prerender"],
  ssr: ResolvedReactRouterConfig["ssr"],
  routes: GenericRouteManifest,
  logWarning = false
): Promise<string[]> {
  let prerenderPaths: string[] = [];
  if (prerender != null && prerender !== false) {
    let prerenderRoutes = createPrerenderRoutes(routes);
    if (prerender === true) {
      let { paths, paramRoutes } = getStaticPrerenderPaths(prerenderRoutes);
      if (logWarning && !ssr && paramRoutes.length > 0) {
        console.warn(
          colors.yellow(
            [
              "⚠️ Paths with dynamic/splat params cannot be prerendered when " +
                "using `prerender: true`. You may want to use the `prerender()` " +
                "API to prerender the following paths:",
              ...paramRoutes.map((p) => "  - " + p),
            ].join("\n")
          )
        );
      }
      prerenderPaths = paths;
    } else if (typeof prerender === "function") {
      prerenderPaths = await prerender({
        getStaticPaths: () => getStaticPrerenderPaths(prerenderRoutes).paths,
      });
    } else {
      prerenderPaths = prerender || ["/"];
    }
  }
  return prerenderPaths;
}

// Note: Duplicated from react-router/lib/server-runtime
function groupRoutesByParentId(manifest: GenericRouteManifest) {
  let routes: Record<string, Omit<RouteManifestEntry, "file">[]> = {};

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

// Create a skeleton route tree of paths
function createPrerenderRoutes(
  manifest: GenericRouteManifest,
  parentId: string = "",
  routesByParentId = groupRoutesByParentId(manifest)
): DataRouteObject[] {
  return (routesByParentId[parentId] || []).map((route) => {
    let commonRoute = {
      id: route.id,
      path: route.path,
    };

    if (route.index) {
      return {
        index: true,
        ...commonRoute,
      };
    }

    return {
      children: createPrerenderRoutes(manifest, route.id, routesByParentId),
      ...commonRoute,
    };
  });
}

async function validateSsrFalsePrerenderExports(
  viteConfig: Vite.ResolvedConfig,
  ctx: ReactRouterPluginContext,
  manifest: ReactRouterManifest,
  viteChildCompiler: Vite.ViteDevServer | null
) {
  let prerenderPaths = await getPrerenderPaths(
    ctx.reactRouterConfig.prerender,
    ctx.reactRouterConfig.ssr,
    manifest.routes,
    true
  );

  if (prerenderPaths.length === 0) {
    return;
  }

  // Identify all routes used by a prerender path
  let prerenderRoutes = createPrerenderRoutes(manifest.routes);
  let prerenderedRoutes = new Set<string>();
  for (let path of prerenderPaths) {
    // Ensure we have a leading slash for matching
    let matches = matchRoutes(
      prerenderRoutes,
      `/${path}/`.replace(/^\/\/+/, "/")
    );
    invariant(
      matches,
      `Unable to prerender path because it does not match any routes: ${path}`
    );
    matches.forEach((m) => prerenderedRoutes.add(m.route.id));
  }

  // Identify invalid exports
  let errors: string[] = [];
  let routeExports = await getRouteManifestModuleExports(
    viteChildCompiler,
    ctx
  );
  for (let [routeId, route] of Object.entries(manifest.routes)) {
    let invalidApis: string[] = [];
    invariant(route, "Expected a route object in validateSsrFalseExports");
    let exports = routeExports[route.id];

    // `headers`/`action` are never valid without SSR
    if (exports.includes("headers")) invalidApis.push("headers");
    if (exports.includes("action")) invalidApis.push("action");
    if (invalidApis.length > 0) {
      errors.push(
        `Prerender: ${invalidApis.length} invalid route export(s) in ` +
          `\`${route.id}\` when prerendering with \`ssr:false\`: ` +
          `${invalidApis.join(", ")}.  ` +
          "See https://reactrouter.com/how-to/pre-rendering for more information."
      );
    }

    // `loader` is only valid if the route is matched by a `prerender` path
    if (exports.includes("loader") && !prerenderedRoutes.has(routeId)) {
      errors.push(
        `Prerender: 1 invalid route export in \`${route.id}\` when ` +
          "using `ssr:false` with `prerender` because the route is never " +
          "prerendered so the loader will never be called.  " +
          "See https://reactrouter.com/how-to/pre-rendering for more information."
      );
    }
  }
  if (errors.length > 0) {
    viteConfig.logger.error(colors.red(errors.join("\n")));
    throw new Error(
      "Invalid route exports found when prerendering with `ssr:false`"
    );
  }
}

function getAddressableRoutes(routes: RouteManifest): RouteManifestEntry[] {
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
  let branch: RouteManifestEntry[] = [];
  let currentRouteId: string | undefined = routeId;

  while (currentRouteId) {
    let route: RouteManifestEntry = routes[currentRouteId];
    invariant(route, `Missing route for ${currentRouteId}`);
    branch.push(route);
    currentRouteId = route.parentId;
  }

  return branch.reverse();
}

function hasServerBundles(buildManifest: BuildManifest) {
  return Object.keys(buildManifest.serverBundles ?? {}).length > 0;
}

function getRoutesByServerBundleId(
  buildManifest: BuildManifest
): Record<string, RouteManifest> {
  if (!buildManifest.routeIdToServerBundleId) {
    return {};
  }

  let routesByServerBundleId: Record<string, RouteManifest> = {};

  for (let [routeId, serverBundleId] of Object.entries(
    buildManifest.routeIdToServerBundleId
  )) {
    routesByServerBundleId[serverBundleId] ??= {};
    let branch = getRouteBranch(buildManifest.routes, routeId);
    for (let route of branch) {
      routesByServerBundleId[serverBundleId][route.id] = route;
    }
  }

  return routesByServerBundleId;
}

type ResolveRouteFileCodeInput =
  | string
  | {
      routeFile: string;
      readRouteFile?: () => string | Promise<string>;
      viteChildCompiler: Vite.ViteDevServer | null;
    };
const resolveRouteFileCode = async (
  ctx: ReactRouterPluginContext,
  input: ResolveRouteFileCodeInput
): Promise<string> => {
  if (typeof input === "string") return input;
  invariant(input.viteChildCompiler);
  return await compileRouteFile(
    input.viteChildCompiler,
    ctx,
    input.routeFile,
    input.readRouteFile
  );
};

async function detectRouteChunksIfEnabled(
  cache: Cache,
  ctx: ReactRouterPluginContext,
  id: string,
  input: ResolveRouteFileCodeInput
): Promise<ReturnType<typeof detectRouteChunks>> {
  function noRouteChunks(): ReturnType<typeof detectRouteChunks> {
    return {
      chunkedExports: [],
      hasRouteChunks: false,
      hasRouteChunkByExportName: {
        clientAction: false,
        clientLoader: false,
        HydrateFallback: false,
      },
    };
  }
  if (!ctx.reactRouterConfig.future.unstable_splitRouteModules) {
    return noRouteChunks();
  }

  // If this is the root route, we disable chunking since the chunks would never
  // be loaded on demand during navigation. Because the root route is matched
  // for all requests, all of its chunks would always be loaded up front during
  // the initial page load. Instead of firing off multiple requests to resolve
  // the root route code, we want it to be downloaded in a single request.
  if (
    normalizeRelativeFilePath(id, ctx.reactRouterConfig) ===
    ctx.reactRouterConfig.routes.root.file
  ) {
    return noRouteChunks();
  }

  let code = await resolveRouteFileCode(ctx, input);
  if (!routeChunkExportNames.some((exportName) => code.includes(exportName))) {
    return noRouteChunks();
  }

  let cacheKey =
    normalizeRelativeFilePath(id, ctx.reactRouterConfig) +
    (typeof input === "string" ? "" : "?read");

  return detectRouteChunks(code, cache, cacheKey);
}

async function getRouteChunkIfEnabled(
  cache: Cache,
  ctx: ReactRouterPluginContext,
  id: string,
  chunkName: RouteChunkName,
  input: ResolveRouteFileCodeInput
): Promise<ReturnType<typeof getRouteChunkCode> | null> {
  if (!ctx.reactRouterConfig.future.unstable_splitRouteModules) {
    return null;
  }

  let code = await resolveRouteFileCode(ctx, input);

  let cacheKey =
    normalizeRelativeFilePath(id, ctx.reactRouterConfig) +
    (typeof input === "string" ? "" : "?read");

  return getRouteChunkCode(code, chunkName, cache, cacheKey);
}

function validateRouteChunks({
  ctx,
  id,
  valid,
}: {
  ctx: ReactRouterPluginContext;
  id: string;
  valid: Record<Exclude<RouteChunkName, "main">, boolean>;
}): void {
  let invalidChunks = Object.entries(valid)
    .filter(([_, isValid]) => !isValid)
    .map(([chunkName]) => chunkName);

  if (invalidChunks.length === 0) {
    return;
  }

  let plural = invalidChunks.length > 1;

  throw new Error(
    [
      `Error splitting route module: ${normalizeRelativeFilePath(
        id,
        ctx.reactRouterConfig
      )}`,

      invalidChunks.map((name) => `- ${name}`).join("\n"),

      `${plural ? "These exports" : "This export"} could not be split into ${
        plural ? "their own chunks" : "its own chunk"
      } because ${
        plural ? "they share" : "it shares"
      } code with other exports. You should extract any shared code into its own module and then import it within the route module.`,
    ].join("\n\n")
  );
}

export async function cleanBuildDirectory(
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

export async function cleanViteManifests(
  environmentsOptions: Record<string, EnvironmentOptions>,
  ctx: ReactRouterPluginContext
) {
  let viteManifestPaths = Object.entries(environmentsOptions).map(
    ([environmentName, options]) => {
      let outDir = options.build?.outDir;
      invariant(outDir, `Expected build.outDir for ${environmentName}`);
      return path.join(outDir, ".vite/manifest.json");
    }
  );
  await Promise.all(
    viteManifestPaths.map(async (viteManifestPath) => {
      let manifestExists = await fse.pathExists(viteManifestPath);
      if (!manifestExists) return;

      // Delete original Vite manifest file if consumer doesn't want it
      if (!ctx.viteManifestEnabled) {
        await fse.remove(viteManifestPath);
      }

      // Remove .vite dir if it's now empty
      let viteDir = path.dirname(viteManifestPath);
      let viteDirFiles = await fse.readdir(viteDir);
      if (viteDirFiles.length === 0) {
        await fse.remove(viteDir);
      }
    })
  );
}

export async function getBuildManifest(
  ctx: ReactRouterPluginContext
): Promise<BuildManifest> {
  let { routes, serverBundles, appDirectory } = ctx.reactRouterConfig;

  if (!serverBundles) {
    return { routes };
  }

  let { normalizePath } = await import("vite");
  let serverBuildDirectory = getServerBuildDirectory(ctx);
  let resolvedAppDirectory = path.resolve(ctx.rootDirectory, appDirectory);
  let rootRelativeRoutes = Object.fromEntries(
    Object.entries(routes).map(([id, route]) => {
      let filePath = path.join(resolvedAppDirectory, route.file);
      let rootRelativeFilePath = normalizePath(
        path.relative(ctx.rootDirectory, filePath)
      );
      return [id, { ...route, file: rootRelativeFilePath }];
    })
  );

  let buildManifest: BuildManifest = {
    serverBundles: {},
    routeIdToServerBundleId: {},
    routes: rootRelativeRoutes,
  };

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

      buildManifest.serverBundles[serverBundleId] ??= {
        id: serverBundleId,
        file: normalizePath(
          path.join(
            path.relative(
              ctx.rootDirectory,
              path.join(serverBuildDirectory, serverBundleId)
            ),
            ctx.reactRouterConfig.serverBuildFile
          )
        ),
      };
    })
  );

  return buildManifest;
}

function mergeEnvironmentOptions(
  base: EnvironmentOptions,
  ...overrides: EnvironmentOptions[]
): EnvironmentOptions {
  let vite = getVite();

  return overrides.reduce(
    (merged, override) => vite.mergeConfig(merged, override, false),
    base
  );
}

export async function getEnvironmentOptionsResolvers(
  ctx: ReactRouterPluginContext,
  buildManifest: BuildManifest,
  viteCommand: Vite.ResolvedConfig["command"]
): Promise<EnvironmentOptionsResolvers> {
  let { serverBuildFile, serverModuleFormat } = ctx.reactRouterConfig;

  let packageRoot = path.dirname(
    require.resolve("@react-router/dev/package.json")
  );
  let { moduleSyncEnabled } = await import(
    `file:///${path.join(packageRoot, "module-sync-enabled/index.mjs")}`
  );
  let vite = getVite();
  let viteServerConditions: string[] = [
    ...(vite.defaultServerConditions ?? []),
    ...(moduleSyncEnabled ? ["module-sync"] : []),
  ];

  function getBaseOptions({
    viteUserConfig,
  }: {
    viteUserConfig: Vite.UserConfig;
  }): EnvironmentOptions {
    return {
      build: {
        cssMinify: viteUserConfig.build?.cssMinify ?? true,
        manifest: true, // The manifest is enabled for all builds to detect SSR-only assets
        rollupOptions: {
          preserveEntrySignatures: "exports-only",
          // Silence Rollup "use client" warnings
          // Adapted from https://github.com/vitejs/vite-plugin-react/pull/144
          onwarn(warning, defaultHandler) {
            if (
              warning.code === "MODULE_LEVEL_DIRECTIVE" &&
              warning.message.includes("use client")
            ) {
              return;
            }
            let userHandler = viteUserConfig.build?.rollupOptions?.onwarn;
            if (userHandler) {
              userHandler(warning, defaultHandler);
            } else {
              defaultHandler(warning);
            }
          },
        },
      },
    };
  }

  function getBaseServerOptions({
    viteUserConfig,
  }: {
    viteUserConfig: Vite.UserConfig;
  }): EnvironmentOptions {
    let conditions =
      viteCommand === "build"
        ? viteServerConditions
        : ["development", ...viteServerConditions];

    return mergeEnvironmentOptions(getBaseOptions({ viteUserConfig }), {
      resolve: {
        external: ssrExternals,
        conditions,
        externalConditions: conditions,
      },
      build: {
        // We move SSR-only assets to client assets. Note that the
        // SSR build can also emit code-split JS files (e.g. by
        // dynamic import) under the same assets directory
        // regardless of "ssrEmitAssets" option, so we also need to
        // keep these JS files have to be kept as-is.
        ssrEmitAssets: true,
        copyPublicDir: false, // Assets in the public directory are only used by the client
        rollupOptions: {
          output: {
            entryFileNames: serverBuildFile,
            format: serverModuleFormat,
          },
        },
      },
    });
  }

  let environmentOptionsResolvers: EnvironmentOptionsResolvers = {
    client: ({ viteUserConfig }) =>
      mergeEnvironmentOptions(getBaseOptions({ viteUserConfig }), {
        build: {
          rollupOptions: {
            input: [
              ctx.entryClientFilePath,
              ...Object.values(ctx.reactRouterConfig.routes).flatMap(
                (route) => {
                  let routeFilePath = path.resolve(
                    ctx.reactRouterConfig.appDirectory,
                    route.file
                  );

                  let isRootRoute =
                    route.file === ctx.reactRouterConfig.routes.root.file;

                  let code = fse.readFileSync(routeFilePath, "utf-8");

                  return [
                    `${routeFilePath}${BUILD_CLIENT_ROUTE_QUERY_STRING}`,
                    ...(ctx.reactRouterConfig.future
                      .unstable_splitRouteModules && !isRootRoute
                      ? routeChunkExportNames.map((exportName) =>
                          code.includes(exportName)
                            ? getRouteChunkModuleId(routeFilePath, exportName)
                            : null
                        )
                      : []),
                  ].filter(isNonNullable);
                }
              ),
            ],
            output: {
              entryFileNames({ moduleIds }) {
                let routeChunkModuleId = moduleIds.find(isRouteChunkModuleId);
                let routeChunkName = routeChunkModuleId
                  ? getRouteChunkNameFromModuleId(routeChunkModuleId)
                  : null;
                let routeChunkSuffix = routeChunkName
                  ? `-${kebabCase(routeChunkName)}`
                  : "";
                return `assets/[name]${routeChunkSuffix}-[hash].js`;
              },
            },
          },
          outDir: getClientBuildDirectory(ctx.reactRouterConfig),
        },
      }),
  };

  if (hasServerBundles(buildManifest)) {
    for (let [serverBundleId, routes] of Object.entries(
      getRoutesByServerBundleId(buildManifest)
    )) {
      // Note: Hyphens are not valid in Vite environment names
      const serverBundleEnvironmentId = serverBundleId.replaceAll("-", "_");
      const environmentName =
        `${SSR_BUNDLE_PREFIX}${serverBundleEnvironmentId}` as const;
      environmentOptionsResolvers[environmentName] = ({ viteUserConfig }) =>
        mergeEnvironmentOptions(
          getBaseServerOptions({ viteUserConfig }),
          {
            build: {
              outDir: getServerBuildDirectory(ctx, { serverBundleId }),
              rollupOptions: {
                input: `${virtual.serverBuild.id}?route-ids=${Object.keys(
                  routes
                ).join(",")}`,
              },
            },
          },
          // Ensure server bundle environments extend the user's SSR
          // environment config if it exists
          viteUserConfig.environments?.ssr ?? {}
        );
    }
  } else {
    environmentOptionsResolvers.ssr = ({ viteUserConfig }) =>
      mergeEnvironmentOptions(getBaseServerOptions({ viteUserConfig }), {
        build: {
          outDir: getServerBuildDirectory(ctx),
          rollupOptions: {
            input:
              (ctx.reactRouterConfig.future.unstable_viteEnvironmentApi
                ? viteUserConfig.environments?.ssr?.build?.rollupOptions?.input
                : viteUserConfig.build?.rollupOptions?.input) ??
              virtual.serverBuild.id,
          },
        },
      });
  }

  return environmentOptionsResolvers;
}

export function resolveEnvironmentsOptions(
  environmentResolvers: EnvironmentOptionsResolvers,
  resolverOptions: Parameters<EnvironmentOptionsResolver>[0]
): Record<string, EnvironmentOptions> {
  let environmentOptions: Record<string, EnvironmentOptions> = {};
  for (let [environmentName, resolver] of Object.entries(
    environmentResolvers
  ) as [EnvironmentName, EnvironmentOptionsResolver][]) {
    environmentOptions[environmentName] = resolver(resolverOptions);
  }
  return environmentOptions;
}

async function getEnvironmentsOptions(
  ctx: ReactRouterPluginContext,
  buildManifest: BuildManifest,
  viteCommand: Vite.ResolvedConfig["command"],
  resolverOptions: Parameters<EnvironmentOptionsResolver>[0]
): Promise<Record<string, EnvironmentOptions>> {
  let environmentOptionsResolvers = await getEnvironmentOptionsResolvers(
    ctx,
    buildManifest,
    viteCommand
  );
  return resolveEnvironmentsOptions(
    environmentOptionsResolvers,
    resolverOptions
  );
}

function isNonNullable<T>(x: T): x is NonNullable<T> {
  return x != null;
}
