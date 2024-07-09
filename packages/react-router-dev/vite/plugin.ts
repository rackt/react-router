// We can only import types from Vite at the top level since we're in a CJS
// context but want to use Vite's ESM build to avoid deprecation warnings
import type * as Vite from "vite";
import { type BinaryLike, createHash } from "node:crypto";
import * as path from "node:path";
import * as url from "node:url";
import { ViteNodeServer } from "vite-node/server";
import { ViteNodeRunner } from "vite-node/client";
import { installSourcemapsSupport } from "vite-node/source-map";
import * as fse from "fs-extra";
import babel from "@babel/core";
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
import jsesc from "jsesc";
import colors from "picocolors";

import { type ConfigRoute, type RouteManifest } from "../config/routes";
import { findConfig } from "../config/findConfig";
import type { Manifest as ReactRouterManifest } from "../manifest";
import invariant from "../invariant";
import type { NodeRequestHandler } from "./node-adapter";
import { fromNodeRequest, toNodeRequest } from "./node-adapter";
import { getStylesForUrl, isCssModulesFile } from "./styles";
import * as VirtualModule from "./vmod";
import { resolveFileUrl } from "./resolve-file-url";
import { removeExports } from "./remove-exports";
import { importViteEsmSync, preloadViteEsm } from "./import-vite-esm-sync";
import {
  type VitePluginConfig,
  type ResolvedVitePluginConfig,
  resolveReactRouterConfig,
  resolveEntryFiles,
  resolvePublicPath,
} from "../config";
import * as defineRoute from "./define-route";

export async function resolveViteConfig({
  configFile,
  mode,
  root,
}: {
  configFile?: string;
  mode?: string;
  root: string;
}) {
  let vite = await import("vite");

  let viteConfig = await vite.resolveConfig(
    { mode, configFile, root },
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

export async function loadPluginContext({
  configFile,
  root,
}: {
  configFile?: string;
  root?: string;
}) {
  if (!root) {
    root = process.env.REACT_ROUTER_ROOT || process.cwd();
  }

  configFile =
    configFile ??
    findConfig(root, "vite.config", [
      ".ts",
      ".cts",
      ".mts",
      ".js",
      ".cjs",
      ".mjs",
    ]);

  if (!configFile) {
    console.error(colors.red("Vite config file not found"));
    process.exit(1);
  }

  let viteConfig = await resolveViteConfig({ configFile, root });
  let ctx = await extractPluginContext(viteConfig);

  if (!ctx) {
    console.error(
      colors.red("React Router Vite plugin not found in Vite config")
    );
    process.exit(1);
  }

  return ctx;
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

// Each route gets its own virtual module marked with an entry query string
const ROUTE_ENTRY_QUERY_STRING = "?route-entry=1";

const isRouteEntry = (id: string): boolean => {
  return id.endsWith(ROUTE_ENTRY_QUERY_STRING);
};

export type ServerBundleBuildConfig = {
  routes: RouteManifest;
  serverBundleId: string;
};

type ReactRouterPluginSsrBuildContext =
  | {
      isSsrBuild: false;
      getReactRouterServerManifest?: never;
      serverBundleBuildConfig?: never;
    }
  | {
      isSsrBuild: true;
      getReactRouterServerManifest: () => Promise<ReactRouterManifest>;
      serverBundleBuildConfig: ServerBundleBuildConfig | null;
    };

export type ReactRouterPluginContext = ReactRouterPluginSsrBuildContext & {
  rootDirectory: string;
  entryClientFilePath: string;
  entryServerFilePath: string;
  publicPath: string;
  reactRouterConfig: ResolvedVitePluginConfig;
  viteManifestEnabled: boolean;
};

let serverBuildId = VirtualModule.id("server-build");
let serverManifestId = VirtualModule.id("server-manifest");
let browserManifestId = VirtualModule.id("browser-manifest");
let hmrRuntimeId = VirtualModule.id("hmr-runtime");
let injectHmrRuntimeId = VirtualModule.id("inject-hmr-runtime");

const resolveRelativeRouteFilePath = (
  route: ConfigRoute,
  reactRouterConfig: ResolvedVitePluginConfig
) => {
  let vite = importViteEsmSync();
  let file = route.file;
  let fullPath = path.resolve(reactRouterConfig.appDirectory, file);

  return vite.normalizePath(fullPath);
};

let vmods = [serverBuildId, serverManifestId, browserManifestId];

const invalidateVirtualModules = (viteDevServer: Vite.ViteDevServer) => {
  vmods.forEach((vmod) => {
    let mod = viteDevServer.moduleGraph.getModuleById(
      VirtualModule.resolve(vmod)
    );
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
  let vite = importViteEsmSync();
  let rootRelativeFilePath = vite.normalizePath(
    path.relative(ctx.rootDirectory, absoluteFilePath)
  );
  let entryChunk =
    viteManifest[rootRelativeFilePath + ROUTE_ENTRY_QUERY_STRING] ??
    viteManifest[rootRelativeFilePath];

  if (!entryChunk) {
    let knownManifestKeys = Object.keys(viteManifest)
      .map((key) => '"' + key + '"')
      .join(", ");
    throw new Error(
      `No manifest entry found for "${rootRelativeFilePath}". Known manifest keys: ${knownManifestKeys}`
    );
  }

  return entryChunk;
};

const getReactRouterManifestBuildAssets = (
  ctx: ReactRouterPluginContext,
  viteManifest: Vite.Manifest,
  entryFilePath: string,
  prependedAssetFilePaths: string[] = []
): ReactRouterManifest["entry"] & { css: string[] } => {
  let entryChunk = resolveChunk(ctx, viteManifest, entryFilePath);

  // This is here to support prepending client entry assets to the root route
  let prependedAssetChunks = prependedAssetFilePaths.map((filePath) =>
    resolveChunk(ctx, viteManifest, filePath)
  );

  let chunks = resolveDependantChunks(viteManifest, [
    ...prependedAssetChunks,
    entryChunk,
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

    if (chunk.imports) {
      for (let importKey of chunk.imports) {
        walk(viteManifest[importKey]);
      }
    }

    chunks.add(chunk);
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

const getRouteModuleExports = async (
  viteChildCompiler: Vite.ViteDevServer | null,
  ctx: ReactRouterPluginContext,
  routeFile: string,
  readRouteFile?: () => string | Promise<string>
): Promise<string[]> => {
  let routePath = path.resolve(ctx.reactRouterConfig.appDirectory, routeFile);
  let code = await (readRouteFile?.() ?? fse.readFile(routePath, "utf-8"));
  if (!code.includes("defineRoute")) {
    return _getRouteModuleExports(
      viteChildCompiler,
      ctx,
      routeFile,
      readRouteFile
    );
  }
  return defineRoute.parseFields(code);
};

const _getRouteModuleExports = async (
  viteChildCompiler: Vite.ViteDevServer | null,
  ctx: ReactRouterPluginContext,
  routeFile: string,
  readRouteFile?: () => string | Promise<string>
): Promise<string[]> => {
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
  let [, exports] = esModuleLexer(transformed.code);
  let exportNames = exports.map((e) => e.n);

  return exportNames;
};

const getServerBundleBuildConfig = (
  viteUserConfig: Vite.UserConfig
): ServerBundleBuildConfig | null => {
  if (
    !("__reactRouterServerBundleBuildConfig" in viteUserConfig) ||
    !viteUserConfig.__reactRouterServerBundleBuildConfig
  ) {
    return null;
  }

  return viteUserConfig.__reactRouterServerBundleBuildConfig as ServerBundleBuildConfig;
};

export let getServerBuildDirectory = (ctx: ReactRouterPluginContext) =>
  path.join(
    ctx.reactRouterConfig.buildDirectory,
    "server",
    ...(ctx.serverBundleBuildConfig
      ? [ctx.serverBundleBuildConfig.serverBundleId]
      : [])
  );

let getClientBuildDirectory = (reactRouterConfig: ResolvedVitePluginConfig) =>
  path.join(reactRouterConfig.buildDirectory, "client");

let defaultEntriesDir = path.resolve(__dirname, "..", "config", "defaults");
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

// Inlined from https://github.com/jsdf/deep-freeze
let deepFreeze = (o: any) => {
  Object.freeze(o);
  let oIsFunction = typeof o === "function";
  let hasOwnProp = Object.prototype.hasOwnProperty;
  Object.getOwnPropertyNames(o).forEach(function (prop) {
    if (
      hasOwnProp.call(o, prop) &&
      (oIsFunction
        ? prop !== "caller" && prop !== "callee" && prop !== "arguments"
        : true) &&
      o[prop] !== null &&
      (typeof o[prop] === "object" || typeof o[prop] === "function") &&
      !Object.isFrozen(o[prop])
    ) {
      deepFreeze(o[prop]);
    }
  });
  return o;
};

export type ReactRouterVitePlugin = (
  config?: VitePluginConfig
) => Vite.Plugin[];
export const reactRouterVitePlugin: ReactRouterVitePlugin = (_config) => {
  let reactRouterUserConfig = _config ?? {};

  // Prevent mutations to the user config
  reactRouterUserConfig = deepFreeze(reactRouterUserConfig);

  let viteCommand: Vite.ResolvedConfig["command"];
  let viteUserConfig: Vite.UserConfig;
  let viteConfigEnv: Vite.ConfigEnv;
  let viteConfig: Vite.ResolvedConfig | undefined;
  let cssModulesManifest: Record<string, string> = {};
  let viteChildCompiler: Vite.ViteDevServer | null = null;
  let routeConfigViteServer: Vite.ViteDevServer | null = null;
  let viteNodeRunner: ViteNodeRunner | null = null;

  let ssrExternals = isInReactRouterMonorepo()
    ? [
        // This is only needed within this repo because these packages
        // are linked to a directory outside of node_modules so Vite
        // treats them as internal code by default.
        "react-router",
        "react-router-dom",
        "@react-router/dev",
        "@react-router/express",
        "@react-router/node",
        "@react-router/serve",
      ]
    : undefined;

  // This is initialized by `updatePluginContext` during Vite's `config`
  // hook, so most of the code can assume this defined without null check.
  // During dev, `updatePluginContext` is called again on every config file
  // change or route file addition/removal.
  let ctx: ReactRouterPluginContext;

  /** Mutates `ctx` as a side-effect */
  let updatePluginContext = async (): Promise<void> => {
    let rootDirectory =
      viteUserConfig.root ?? process.env.REACT_ROUTER_ROOT ?? process.cwd();

    invariant(viteNodeRunner);
    let reactRouterConfig = await resolveReactRouterConfig({
      rootDirectory,
      reactRouterUserConfig,
      viteUserConfig,
      viteCommand,
      viteNodeRunner,
    });

    let { entryClientFilePath, entryServerFilePath } = await resolveEntryFiles({
      rootDirectory,
      reactRouterConfig,
    });

    let publicPath = resolvePublicPath(viteUserConfig);
    let viteManifestEnabled = viteUserConfig.build?.manifest === true;

    let ssrBuildCtx: ReactRouterPluginSsrBuildContext =
      viteConfigEnv.isSsrBuild && viteCommand === "build"
        ? {
            isSsrBuild: true,
            getReactRouterServerManifest: async () =>
              (await generateReactRouterManifestsForBuild())
                .reactRouterServerManifest,
            serverBundleBuildConfig: getServerBundleBuildConfig(viteUserConfig),
          }
        : { isSsrBuild: false };

    ctx = {
      reactRouterConfig,
      rootDirectory,
      entryClientFilePath,
      entryServerFilePath,
      publicPath,
      viteManifestEnabled,
      ...ssrBuildCtx,
    };
  };

  let pluginIndex = (pluginName: string) => {
    invariant(viteConfig);
    return viteConfig.plugins.findIndex((plugin) => plugin.name === pluginName);
  };

  let getServerEntry = async () => {
    invariant(viteConfig, "viteconfig required to generate the server entry");

    let routes = ctx.serverBundleBuildConfig
      ? // For server bundle builds, the server build should only import the
        // routes for this bundle rather than importing all routes
        ctx.serverBundleBuildConfig.routes
      : // Otherwise, all routes are imported as usual
        ctx.reactRouterConfig.routes;

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
          ) + ROUTE_ENTRY_QUERY_STRING
        )};`;
      })
      .join("\n")}
      export { default as assets } from ${JSON.stringify(serverManifestId)};
      export const assetsBuildDirectory = ${JSON.stringify(
        path.relative(
          ctx.rootDirectory,
          getClientBuildDirectory(ctx.reactRouterConfig)
        )
      )};
      export const basename = ${JSON.stringify(ctx.reactRouterConfig.basename)};
      export const future = ${JSON.stringify(ctx.reactRouterConfig.future)};
      export const isSpaMode = ${
        !ctx.reactRouterConfig.ssr && ctx.reactRouterConfig.prerender == null
      };
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

  let getViteManifestFilePaths = (viteManifest: Vite.Manifest): Set<string> => {
    let filePaths = Object.values(viteManifest).map((chunk) => chunk.file);
    return new Set(filePaths);
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

  let generateReactRouterManifestsForBuild = async (): Promise<{
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

    for (let [key, route] of Object.entries(ctx.reactRouterConfig.routes)) {
      let routeFilePath = path.join(
        ctx.reactRouterConfig.appDirectory,
        route.file
      );
      let sourceExports = routeManifestExports[key];
      let isRootRoute = route.parentId === undefined;

      let routeManifestEntry = {
        id: route.id,
        parentId: route.parentId,
        path: route.path,
        index: route.index,
        caseSensitive: route.caseSensitive,
        hasAction: sourceExports.includes("action"),
        hasLoader: sourceExports.includes("loader"),
        hasClientAction: sourceExports.includes("clientAction"),
        hasClientLoader: sourceExports.includes("clientLoader"),
        hasErrorBoundary: sourceExports.includes("ErrorBoundary"),
        ...getReactRouterManifestBuildAssets(
          ctx,
          viteManifest,
          routeFilePath,
          // If this is the root route, we also need to include assets from the
          // client entry file as this is a common way for consumers to import
          // global reset styles, etc.
          isRootRoute ? [ctx.entryClientFilePath] : []
        ),
      };

      browserRoutes[key] = routeManifestEntry;

      let serverBundleRoutes = ctx.serverBundleBuildConfig?.routes;
      if (!serverBundleRoutes || serverBundleRoutes[key]) {
        serverRoutes[key] = routeManifestEntry;
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
      `window.__remixManifest=${JSON.stringify(reactRouterBrowserManifest)};`
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

    for (let [key, route] of Object.entries(ctx.reactRouterConfig.routes)) {
      let sourceExports = routeManifestExports[key];
      routes[key] = {
        id: route.id,
        parentId: route.parentId,
        path: route.path,
        index: route.index,
        caseSensitive: route.caseSensitive,
        module: path.posix.join(
          ctx.publicPath,
          `${resolveFileUrl(
            ctx,
            resolveRelativeRouteFilePath(route, ctx.reactRouterConfig)
          )}${ROUTE_ENTRY_QUERY_STRING}`
        ),
        hasAction: sourceExports.includes("action"),
        hasLoader: sourceExports.includes("loader"),
        hasClientAction: sourceExports.includes("clientAction"),
        hasClientLoader: sourceExports.includes("clientLoader"),
        hasErrorBoundary: sourceExports.includes("ErrorBoundary"),
        imports: [],
      };
    }

    return {
      version: String(Math.random()),
      url: path.posix.join(
        ctx.publicPath,
        VirtualModule.url(browserManifestId)
      ),
      hmr: {
        runtime: path.posix.join(
          ctx.publicPath,
          VirtualModule.url(injectHmrRuntimeId)
        ),
      },
      entry: {
        module: path.posix.join(
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
        await preloadViteEsm();

        // Ensure sync import of Vite works after async preload
        let vite = importViteEsmSync();

        viteUserConfig = _viteUserConfig;
        viteConfigEnv = _viteConfigEnv;
        viteCommand = viteConfigEnv.command;

        routeConfigViteServer = await vite.createServer({
          mode: viteConfigEnv.mode,
          server: {
            watch: viteCommand === "build" ? null : undefined,
            preTransformRequests: false,
            hmr: false,
          },
          ssr: {
            external: ssrExternals,
          },
          optimizeDeps: {
            noDiscovery: true,
          },
          configFile: false,
          envFile: false,
          plugins: [],
        });
        await routeConfigViteServer.pluginContainer.buildStart({});

        let viteNodeServer = new ViteNodeServer(routeConfigViteServer);

        installSourcemapsSupport({
          getSourceMap: (source) => viteNodeServer.getSourceMap(source),
        });

        viteNodeRunner = new ViteNodeRunner({
          root: routeConfigViteServer.config.root,
          base: routeConfigViteServer.config.base,
          fetchModule(id) {
            return viteNodeServer.fetchModule(id);
          },
          resolveId(id, importer) {
            return viteNodeServer.resolveId(id, importer);
          },
        });

        await updatePluginContext();

        Object.assign(
          process.env,
          vite.loadEnv(
            viteConfigEnv.mode,
            ctx.rootDirectory,
            // We override default prefix of "VITE_" with a blank string since
            // we're targeting the server, so we want to load all environment
            // variables, not just those explicitly marked for the client
            ""
          )
        );

        let baseRollupOptions = {
          // Silence Rollup "use client" warnings
          // Adapted from https://github.com/vitejs/vite-plugin-react/pull/144
          onwarn(warning, defaultHandler) {
            if (
              warning.code === "MODULE_LEVEL_DIRECTIVE" &&
              warning.message.includes("use client")
            ) {
              return;
            }
            if (viteUserConfig.build?.rollupOptions?.onwarn) {
              viteUserConfig.build.rollupOptions.onwarn(
                warning,
                defaultHandler
              );
            } else {
              defaultHandler(warning);
            }
          },
        } satisfies Vite.BuildOptions["rollupOptions"];

        return {
          __reactRouterPluginContext: ctx,
          appType:
            viteCommand === "serve" &&
            viteConfigEnv.mode === "production" &&
            ctx.reactRouterConfig.ssr === false
              ? "spa"
              : "custom",

          ssr: {
            external: ssrExternals,
          },
          optimizeDeps: {
            include: [
              // Pre-bundle React dependencies to avoid React duplicates,
              // even if React dependencies are not direct dependencies.
              // https://react.dev/warnings/invalid-hook-call-warning#duplicate-react
              "react",
              "react/jsx-runtime",
              "react/jsx-dev-runtime",
              "react-dom/client",

              // Pre-bundle router dependencies to avoid router duplicates.
              // Mismatching routers cause `Error: You must render this element inside a <Remix> element`.
              "react-router",
              "react-router-dom",
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
              "react-router-dom",
            ],
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

          // Vite config options for building
          ...(viteCommand === "build"
            ? {
                build: {
                  cssMinify: viteUserConfig.build?.cssMinify ?? true,
                  ...(!viteConfigEnv.isSsrBuild
                    ? {
                        manifest: true,
                        outDir: getClientBuildDirectory(ctx.reactRouterConfig),
                        rollupOptions: {
                          ...baseRollupOptions,
                          preserveEntrySignatures: "exports-only",
                          input: [
                            ctx.entryClientFilePath,
                            ...Object.values(ctx.reactRouterConfig.routes).map(
                              (route) =>
                                `${path.resolve(
                                  ctx.reactRouterConfig.appDirectory,
                                  route.file
                                )}${ROUTE_ENTRY_QUERY_STRING}`
                            ),
                          ],
                        },
                      }
                    : {
                        // We move SSR-only assets to client assets. Note that the
                        // SSR build can also emit code-split JS files (e.g. by
                        // dynamic import) under the same assets directory
                        // regardless of "ssrEmitAssets" option, so we also need to
                        // keep these JS files have to be kept as-is.
                        ssrEmitAssets: true,
                        copyPublicDir: false, // Assets in the public directory are only used by the client
                        manifest: true, // We need the manifest to detect SSR-only assets
                        outDir: getServerBuildDirectory(ctx),
                        rollupOptions: {
                          ...baseRollupOptions,
                          preserveEntrySignatures: "exports-only",
                          input:
                            viteUserConfig.build?.rollupOptions?.input ??
                            serverBuildId,
                          output: {
                            entryFileNames:
                              ctx.reactRouterConfig.serverBuildFile,
                            format: ctx.reactRouterConfig.serverModuleFormat,
                          },
                        },
                      }),
                },
              }
            : undefined),

          // Vite config options for SPA preview mode
          ...(viteCommand === "serve" && ctx.reactRouterConfig.ssr === false
            ? {
                build: {
                  manifest: true,
                  outDir: getClientBuildDirectory(ctx.reactRouterConfig),
                },
              }
            : undefined),
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

        let vite = importViteEsmSync();

        let childCompilerConfigFile = await vite.loadConfigFromFile(
          {
            command: viteConfig.command,
            mode: viteConfig.mode,
            isSsrBuild: ctx.isSsrBuild,
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
                  plugin.name !== "react-router-hmr-updates"
              ),
          ],
        });
        await viteChildCompiler.pluginContainer.buildStart({});
      },
      async transform(code, id, options) {
        if (isCssModulesFile(id)) {
          cssModulesManifest[id] = code;
        }

        if (isRouteEntry(id)) {
          let routeModuleId = id.replace(ROUTE_ENTRY_QUERY_STRING, "");

          let sourceExports = await getRouteModuleExports(
            viteChildCompiler,
            ctx,
            routeModuleId
          );

          let routeFileName = path.basename(routeModuleId);

          if (!code.includes("defineRoute")) {
            let reexports = sourceExports
              .filter(
                (exportName) =>
                  (options?.ssr &&
                    SERVER_ONLY_ROUTE_EXPORTS.includes(exportName)) ||
                  CLIENT_ROUTE_EXPORTS.includes(exportName)
              )
              .join(", ");
            return `export { ${reexports} } from "./${routeFileName}";`;
          }

          let reexports = sourceExports
            .filter(
              (exportName) =>
                !["Component", "serverLoader", "serverAction"].includes(
                  exportName
                ) &&
                ((options?.ssr &&
                  SERVER_ONLY_ROUTE_EXPORTS.includes(exportName)) ||
                  CLIENT_ROUTE_EXPORTS.includes(exportName))
            )
            .map((reexport) => `export const ${reexport} = route.${reexport};`);

          let content = `import route from "./${routeFileName}";`;
          if (sourceExports.includes("Component")) {
            content += `\nexport default route.Component;`;
          }
          if (sourceExports.includes("serverLoader")) {
            content += `\nexport const loader = route.serverLoader;`;
          }
          if (sourceExports.includes("serverAction")) {
            content += `\nexport const action = route.serverAction;`;
          }
          content += "\n" + reexports.join("\n");
          return content;
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

        // Invalidate virtual modules and update cached plugin config via file watcher
        viteDevServer.watcher.on("all", async (eventName, filepath) => {
          let { normalizePath } = importViteEsmSync();

          let appFileAddedOrRemoved =
            (eventName === "add" || eventName === "unlink") &&
            normalizePath(filepath).startsWith(
              normalizePath(ctx.reactRouterConfig.appDirectory)
            );

          invariant(viteConfig?.configFile);
          let viteConfigChanged =
            eventName === "change" &&
            normalizePath(filepath) === normalizePath(viteConfig.configFile);

          let routesConfigModuleGraphChanged = Boolean(
            routeConfigViteServer?.moduleGraph.getModuleById(filepath)
          );

          if (routesConfigModuleGraphChanged) {
            routeConfigViteServer?.moduleGraph.invalidateAll();
            viteNodeRunner?.moduleCache.clear();
          }

          if (
            appFileAddedOrRemoved ||
            viteConfigChanged ||
            routesConfigModuleGraphChanged
          ) {
            let lastReactRouterConfig = ctx.reactRouterConfig;

            await updatePluginContext();

            if (!isEqualJson(lastReactRouterConfig, ctx.reactRouterConfig)) {
              invalidateVirtualModules(viteDevServer);
            }
          }
        });

        return () => {
          // Let user servers handle SSR requests in middleware mode,
          // otherwise the Vite plugin will handle the request
          if (!viteDevServer.config.server.middlewareMode) {
            viteDevServer.middlewares.use(async (req, res, next) => {
              try {
                let build = (await viteDevServer.ssrLoadModule(
                  serverBuildId
                )) as ServerBuild;

                let handler = createRequestHandler(build, "development");
                let nodeHandler: NodeRequestHandler = async (
                  nodeReq,
                  nodeRes
                ) => {
                  let req = fromNodeRequest(nodeReq);
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
          if (!ctx.isSsrBuild) {
            return;
          }

          invariant(viteConfig);

          let clientBuildDirectory = getClientBuildDirectory(
            ctx.reactRouterConfig
          );
          let serverBuildDirectory = getServerBuildDirectory(ctx);

          let ssrViteManifest = await loadViteManifest(serverBuildDirectory);
          let clientViteManifest = await loadViteManifest(clientBuildDirectory);

          let clientFilePaths = getViteManifestFilePaths(clientViteManifest);
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
            if (!clientFilePaths.has(ssrAssetPath)) {
              let dest = path.join(clientBuildDirectory, ssrAssetPath);
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

          if (ctx.reactRouterConfig.prerender != null) {
            // If we have prerender routes, that takes precedence over SPA mode
            // which is ssr:false and only the rot route being rendered
            await handlePrerender(
              viteConfig,
              ctx.reactRouterConfig,
              serverBuildDirectory,
              clientBuildDirectory
            );
          } else if (!ctx.reactRouterConfig.ssr) {
            await handleSpaMode(
              viteConfig,
              ctx.reactRouterConfig,
              serverBuildDirectory,
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
        await routeConfigViteServer?.close();
      },
    },
    {
      name: "react-router-virtual-modules",
      enforce: "pre",
      resolveId(id) {
        if (vmods.includes(id)) return VirtualModule.resolve(id);
      },
      async load(id) {
        switch (id) {
          case VirtualModule.resolve(serverBuildId): {
            return await getServerEntry();
          }
          case VirtualModule.resolve(serverManifestId): {
            let reactRouterManifest = ctx.isSsrBuild
              ? await ctx.getReactRouterServerManifest()
              : await getReactRouterManifestForDev();

            return `export default ${jsesc(reactRouterManifest, {
              es6: true,
            })};`;
          }
          case VirtualModule.resolve(browserManifestId): {
            if (viteCommand === "build") {
              throw new Error("This module only exists in development");
            }

            let reactRouterManifest = await getReactRouterManifestForDev();
            let reactRouterManifestString = jsesc(reactRouterManifest, {
              es6: true,
            });

            return `window.__remixManifest=${reactRouterManifestString};`;
          }
        }
      },
    },
    {
      name: "react-router-define-route",
      enforce: "pre",
      async transform(code, id, options) {
        if (options?.ssr) return;

        if (id.endsWith(ROUTE_ENTRY_QUERY_STRING)) return;

        let route = getRoute(ctx.reactRouterConfig, id);
        if (!route && code.includes("defineRoute")) {
          return defineRoute.assertNotImported(code);
        }

        if (!code.includes("defineRoute")) return; // temporary back compat, remove once old style routes are unsupported
        defineRoute.transform(code);
      },
    },
    {
      name: "react-router-dot-server",
      enforce: "pre",
      async resolveId(id, importer, options) {
        if (options?.ssr) return;

        let isResolving = options?.custom?.["react-router-dot-server"] ?? false;
        if (isResolving) return;
        options.custom = { ...options.custom, "react-router-dot-server": true };
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

        let vite = importViteEsmSync();
        let importerShort = vite.normalizePath(
          path.relative(ctx.rootDirectory, importer)
        );
        let isRoute = getRoute(ctx.reactRouterConfig, importer);

        if (isRoute) {
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
      name: "react-router-dot-client",
      async transform(code, id, options) {
        if (!options?.ssr) return;
        let clientFileRE = /\.client(\.[cm]?[jt]sx?)?$/;
        let clientDirRE = /\/\.client\//;
        if (clientFileRE.test(id) || clientDirRE.test(id)) {
          let exports = esModuleLexer(code)[1];
          return {
            code: exports
              .map(({ n: name }) =>
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
    {
      name: "react-router-route-exports",
      async transform(code, id, options) {
        if (options?.ssr) return;

        let route = getRoute(ctx.reactRouterConfig, id);
        if (!route) return;

        if (!ctx.reactRouterConfig.ssr) {
          let serverOnlyExports = esModuleLexer(code)[1]
            .map((exp) => exp.n)
            .filter((exp) => SERVER_ONLY_ROUTE_EXPORTS.includes(exp));
          if (serverOnlyExports.length > 0) {
            let str = serverOnlyExports.map((e) => `\`${e}\``).join(", ");
            let message =
              `SPA Mode: ${serverOnlyExports.length} invalid route export(s) in ` +
              `\`${route.file}\`: ${str}. See https://remix.run/guides/spa-mode ` +
              `for more information.`;
            throw Error(message);
          }

          if (route.id !== "root") {
            let hasHydrateFallback = esModuleLexer(code)[1]
              .map((exp) => exp.n)
              .some((exp) => exp === "HydrateFallback");
            if (hasHydrateFallback) {
              let message =
                `SPA Mode: Invalid \`HydrateFallback\` export found in ` +
                `\`${route.file}\`. \`HydrateFallback\` is only permitted on ` +
                `the root route in SPA Mode. See https://remix.run/guides/spa-mode ` +
                `for more information.`;
              throw Error(message);
            }
          }
        }

        let [filepath] = id.split("?");

        return removeExports(code, SERVER_ONLY_ROUTE_EXPORTS, {
          sourceMaps: true,
          filename: id,
          sourceFileName: filepath,
        });
      },
    },
    {
      name: "react-router-inject-hmr-runtime",
      enforce: "pre",
      resolveId(id) {
        if (id === injectHmrRuntimeId)
          return VirtualModule.resolve(injectHmrRuntimeId);
      },
      async load(id) {
        if (id !== VirtualModule.resolve(injectHmrRuntimeId)) return;

        return [
          `import RefreshRuntime from "${hmrRuntimeId}"`,
          "RefreshRuntime.injectIntoGlobalHook(window)",
          "window.$RefreshReg$ = () => {}",
          "window.$RefreshSig$ = () => (type) => type",
          "window.__vite_plugin_react_preamble_installed__ = true",
        ].join("\n");
      },
    },
    {
      name: "react-router-hmr-runtime",
      enforce: "pre",
      resolveId(id) {
        if (id === hmrRuntimeId) return VirtualModule.resolve(hmrRuntimeId);
      },
      async load(id) {
        if (id !== VirtualModule.resolve(hmrRuntimeId)) return;

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
      name: "react-router-react-refresh-babel",
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

        if (isRouteEntry(id)) {
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
      name: "react-router-hmr-updates",
      async handleHotUpdate({ server, file, modules, read }) {
        let route = getRoute(ctx.reactRouterConfig, file);

        type ManifestRoute = ReactRouterManifest["routes"][string];
        type HmrEventData = { route: ManifestRoute | null };
        let hmrEventData: HmrEventData = { route: null };

        if (route) {
          // invalidate manifest on route exports change
          let serverManifest = (await server.ssrLoadModule(serverManifestId))
            .default as ReactRouterManifest;

          let oldRouteMetadata = serverManifest.routes[route.id];
          let newRouteMetadata = await getRouteMetadata(
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
                "hasAction",
                "hasClientAction",
                "hasErrorBoundary",
              ] as const
            ).some((key) => oldRouteMetadata[key] !== newRouteMetadata[key])
          ) {
            invalidateVirtualModules(server);
          }
        }

        server.ws.send({
          type: "custom",
          event: "react-router:hmr",
          data: hmrEventData,
        });

        return modules;
      },
    },
  ];
};

function isInReactRouterMonorepo() {
  // We use '@react-router/node' for this check since it's a
  // dependency of this package and guaranteed to be in node_modules
  let serverRuntimePath = path.dirname(
    require.resolve("@react-router/node/package.json")
  );
  let serverRuntimeParentDir = path.basename(
    path.resolve(serverRuntimePath, "..")
  );
  return serverRuntimeParentDir === "packages";
}

function isEqualJson(v1: unknown, v2: unknown) {
  return JSON.stringify(v1) === JSON.stringify(v2);
}

function addRefreshWrapper(
  reactRouterConfig: ResolvedVitePluginConfig,
  code: string,
  id: string
): string {
  let route = getRoute(reactRouterConfig, id);
  let acceptExports =
    route || isRouteEntry(id)
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
import RefreshRuntime from "${hmrRuntimeId}";

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
}`.replace(/\n+/g, "");

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
  pluginConfig: ResolvedVitePluginConfig,
  file: string
): ConfigRoute | undefined {
  let vite = importViteEsmSync();
  let routePath = vite.normalizePath(
    path.relative(pluginConfig.appDirectory, file)
  );
  let route = Object.values(pluginConfig.routes).find(
    (r) => vite.normalizePath(r.file) === routePath
  );
  return route;
}

async function getRouteMetadata(
  ctx: ReactRouterPluginContext,
  viteChildCompiler: Vite.ViteDevServer | null,
  route: ConfigRoute,
  readRouteFile?: () => string | Promise<string>
) {
  let sourceExports = await getRouteModuleExports(
    viteChildCompiler,
    ctx,
    route.file,
    readRouteFile
  );

  let info = {
    id: route.id,
    parentId: route.parentId,
    path: route.path,
    index: route.index,
    caseSensitive: route.caseSensitive,
    url: path.posix.join(
      ctx.publicPath,
      "/" +
        path.relative(
          ctx.rootDirectory,
          resolveRelativeRouteFilePath(route, ctx.reactRouterConfig)
        )
    ),
    module: path.posix.join(
      ctx.publicPath,
      `${resolveFileUrl(
        ctx,
        resolveRelativeRouteFilePath(route, ctx.reactRouterConfig)
      )}?import`
    ), // Ensure the Vite dev server responds with a JS module
    hasAction: sourceExports.includes("action"),
    hasClientAction: sourceExports.includes("clientAction"),
    hasLoader: sourceExports.includes("loader"),
    hasClientLoader: sourceExports.includes("clientLoader"),
    hasErrorBoundary: sourceExports.includes("ErrorBoundary"),
    imports: [],
  };
  return info;
}

async function getPrerenderBuildAndHandler(
  viteConfig: Vite.ResolvedConfig,
  reactRouterConfig: Awaited<ReturnType<typeof resolveReactRouterConfig>>,
  serverBuildDirectory: string
) {
  let serverBuildPath = path.join(
    serverBuildDirectory,
    reactRouterConfig.serverBuildFile
  );
  let build = await import(url.pathToFileURL(serverBuildPath).toString());
  let { createRequestHandler: createHandler } = await import("react-router");
  return {
    build,
    handler: createHandler(build, viteConfig.mode),
  };
}

async function handleSpaMode(
  viteConfig: Vite.ResolvedConfig,
  reactRouterConfig: Awaited<ReturnType<typeof resolveReactRouterConfig>>,
  serverBuildDirectory: string,
  clientBuildDirectory: string
) {
  let { handler } = await getPrerenderBuildAndHandler(
    viteConfig,
    reactRouterConfig,
    serverBuildDirectory
  );
  let request = new Request(`http://localhost${reactRouterConfig.basename}`);
  let response = await handler(request);
  let html = await response.text();

  validatePrerenderedResponse(response, html, "SPA Mode", "/");
  validatePrerenderedHtml(html, "SPA Mode");

  // Write out the index.html file for the SPA
  await fse.writeFile(path.join(clientBuildDirectory, "index.html"), html);

  viteConfig.logger.info(
    "SPA Mode: index.html has been written to your " +
      colors.bold(path.relative(process.cwd(), clientBuildDirectory)) +
      " directory"
  );
}

async function handlePrerender(
  viteConfig: Vite.ResolvedConfig,
  reactRouterConfig: Awaited<ReturnType<typeof resolveReactRouterConfig>>,
  serverBuildDirectory: string,
  clientBuildDirectory: string
) {
  let { build, handler } = await getPrerenderBuildAndHandler(
    viteConfig,
    reactRouterConfig,
    serverBuildDirectory
  );

  let routes = createPrerenderRoutes(build.routes);
  let routesToPrerender = reactRouterConfig.prerender || ["/"];
  let requestInit = {
    headers: {
      // Header that can be used in the loader to know if you're running at
      // build time or runtime
      "X-React-Router-Prerender": "yes",
    },
  };
  for (let path of routesToPrerender) {
    let hasLoaders = matchRoutes(routes, path)?.some((m) => m.route.loader);
    if (hasLoaders) {
      await prerenderData(
        handler,
        path,
        clientBuildDirectory,
        reactRouterConfig,
        viteConfig,
        requestInit
      );
    }
    await prerenderRoute(
      handler,
      path,
      clientBuildDirectory,
      reactRouterConfig,
      viteConfig,
      requestInit
    );
  }

  async function prerenderData(
    handler: RequestHandler,
    prerenderPath: string,
    clientBuildDirectory: string,
    reactRouterConfig: Awaited<ReturnType<typeof resolveReactRouterConfig>>,
    viteConfig: Vite.ResolvedConfig,
    requestInit: RequestInit
  ) {
    let normalizedPath = `${reactRouterConfig.basename}${
      prerenderPath === "/"
        ? "/_root.data"
        : `${prerenderPath.replace(/\/$/, "")}.data`
    }`.replace(/\/\/+/g, "/");
    let request = new Request(`http://localhost${normalizedPath}`, requestInit);
    let response = await handler(request);
    let data = await response.text();

    validatePrerenderedResponse(response, data, "Prerender", normalizedPath);

    // Write out the .data file
    let outdir = path.relative(process.cwd(), clientBuildDirectory);
    let outfile = path.join(outdir, normalizedPath.split("/").join(path.sep));
    await fse.ensureDir(path.dirname(outfile));
    await fse.outputFile(outfile, data);
    viteConfig.logger.info(`Prerender: Generated ${colors.bold(outfile)}`);
  }
}

async function prerenderRoute(
  handler: RequestHandler,
  prerenderPath: string,
  clientBuildDirectory: string,
  reactRouterConfig: Awaited<ReturnType<typeof resolveReactRouterConfig>>,
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

  validatePrerenderedResponse(response, html, "Prerender", normalizedPath);

  if (!reactRouterConfig.ssr) {
    validatePrerenderedHtml(html, "Prerender");
  }

  // Write out the HTML file
  let outdir = path.relative(process.cwd(), clientBuildDirectory);
  let outfile = path.join(outdir, ...normalizedPath.split("/"), "index.html");
  await fse.ensureDir(path.dirname(outfile));
  await fse.outputFile(outfile, html);
  viteConfig.logger.info(`Prerender: Generated ${colors.bold(outfile)}`);
}

function validatePrerenderedResponse(
  response: Response,
  html: string,
  prefix: string,
  path: string
) {
  if (response.status !== 200) {
    throw new Error(
      `${prefix}: Received a ${response.status} status code from ` +
        `\`entry.server.tsx\` while prerendering the \`${path}\` ` +
        `path.\n${html}`
    );
  }
}

function validatePrerenderedHtml(html: string, prefix: string) {
  if (
    !html.includes("window.__remixContext =") ||
    !html.includes("window.__remixRouteModules =")
  ) {
    throw new Error(
      `${prefix}: Did you forget to include <Scripts/> in your root route? ` +
        "Your pre-rendered HTML files cannot hydrate without `<Scripts />`."
    );
  }
}

type ServerRoute = ServerBuild["routes"][string] & {
  children: ServerRoute[];
};

// Note: Duplicated from react-router/lib/server-runtime
function groupRoutesByParentId(manifest: ServerBuild["routes"]) {
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

// Note: Duplicated from react-router/lib/server-runtime
function createPrerenderRoutes(
  manifest: ServerBuild["routes"],
  parentId: string = "",
  routesByParentId: Record<
    string,
    Omit<ServerRoute, "children">[]
  > = groupRoutesByParentId(manifest)
): DataRouteObject[] {
  return (routesByParentId[parentId] || []).map((route) => {
    let commonRoute = {
      // Always include root due to default boundaries
      hasErrorBoundary:
        route.id === "root" || route.module.ErrorBoundary != null,
      id: route.id,
      path: route.path,
      loader: route.module.loader ? () => null : undefined,
      action: undefined,
      handle: route.module.handle,
    };

    return route.index
      ? {
          index: true,
          ...commonRoute,
        }
      : {
          caseSensitive: route.caseSensitive,
          children: createPrerenderRoutes(manifest, route.id, routesByParentId),
          ...commonRoute,
        };
  });
}
