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
import jsesc from "jsesc";
import colors from "picocolors";

import * as Typegen from "../typegen";
import { type RouteManifestEntry, type RouteManifest } from "../config/routes";
import type { Manifest as ReactRouterManifest } from "../manifest";
import invariant from "../invariant";
import { generate, parse } from "./babel";
import type { NodeRequestHandler } from "./node-adapter";
import { fromNodeRequest, toNodeRequest } from "./node-adapter";
import { getStylesForUrl, isCssModulesFile } from "./styles";
import * as VirtualModule from "./virtual-module";
import { resolveFileUrl } from "./resolve-file-url";
import { combineURLs } from "./combine-urls";
import { removeExports } from "./remove-exports";
import { importViteEsmSync, preloadViteEsm } from "./import-vite-esm-sync";
import {
  type ResolvedReactRouterConfig,
  type ConfigLoader,
  createConfigLoader,
  resolveEntryFiles,
  ssrExternals,
} from "../config/config";
import * as WithProps from "./with-props";

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

/** This is used to manage a build optimization to remove unused route exports
from the client build output. This is important in cases where custom route
exports are only ever used on the server. Without this optimization we can't
tree-shake any unused custom exports because routes are entry points. */
const BUILD_CLIENT_ROUTE_QUERY_STRING = "?__react-router-build-client-route";

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
  reactRouterConfig: ResolvedReactRouterConfig;
  viteManifestEnabled: boolean;
};

let virtualHmrRuntime = VirtualModule.create("hmr-runtime");
let virtualInjectHmrRuntime = VirtualModule.create("inject-hmr-runtime");

const resolveRelativeRouteFilePath = (
  route: RouteManifestEntry,
  reactRouterConfig: ResolvedReactRouterConfig
) => {
  let vite = importViteEsmSync();
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
  let vite = importViteEsmSync();
  let rootRelativeFilePath = vite.normalizePath(
    path.relative(ctx.rootDirectory, absoluteFilePath)
  );
  let entryChunk =
    viteManifest[rootRelativeFilePath + BUILD_CLIENT_ROUTE_QUERY_STRING] ??
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
  let cssModulesManifest: Record<string, string> = {};
  let viteChildCompiler: Vite.ViteDevServer | null = null;
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

    firstLoad = false;

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
          )
        )};`;
      })
      .join("\n")}
      export { default as assets } from ${JSON.stringify(
        virtual.serverManifest.id
      )};
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

    for (let [key, route] of Object.entries(ctx.reactRouterConfig.routes)) {
      let sourceExports = routeManifestExports[key];
      routes[key] = {
        id: route.id,
        parentId: route.parentId,
        path: route.path,
        index: route.index,
        caseSensitive: route.caseSensitive,
        module: combineURLs(
          ctx.publicPath,
          resolveFileUrl(
            ctx,
            resolveRelativeRouteFilePath(route, ctx.reactRouterConfig)
          )
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
        await preloadViteEsm();

        // Ensure sync import of Vite works after async preload
        let vite = importViteEsmSync();

        viteUserConfig = _viteUserConfig;
        viteConfigEnv = _viteConfigEnv;
        viteCommand = viteConfigEnv.command;

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
            resolve: {
              conditions: viteCommand === "build" ? [] : ["development"],
              externalConditions:
                viteCommand === "build" ? [] : ["development"],
            },
          },
          optimizeDeps: {
            entries: ctx.reactRouterConfig.future.unstable_optimizeDeps
              ? [
                  ctx.entryClientFilePath,
                  ...Object.values(ctx.reactRouterConfig.routes).map((route) =>
                    path.join(ctx.reactRouterConfig.appDirectory, route.file)
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
            conditions: viteCommand === "build" ? [] : ["development"],
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
                                )}${BUILD_CLIENT_ROUTE_QUERY_STRING}`
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
                            virtual.serverBuild.id,
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
            configCodeChanged,
            routeConfigCodeChanged,
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

            let message = (() => {
              if (configChanged) return "Config changed.";
              if (routeConfigChanged) return "Route config changed.";
              if (configCodeChanged) return "Config saved.";
              if (routeConfigCodeChanged) return "Route config saved.";
              return "Config saved.";
            })();

            logger.info(colors.green(message), {
              clear: true,
              timestamp: true,
            });

            await updatePluginContext();

            if (configChanged || routeConfigChanged) {
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
          if (!ctx.isSsrBuild) {
            return;
          }

          invariant(viteConfig);

          let clientBuildDirectory = getClientBuildDirectory(
            ctx.reactRouterConfig
          );
          let serverBuildDirectory = getServerBuildDirectory(ctx);

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

          if (
            ctx.reactRouterConfig.prerender != null &&
            ctx.reactRouterConfig.prerender !== false
          ) {
            // If we have prerender routes, that takes precedence over SPA mode
            // which is ssr:false and only the rot route being rendered
            await handlePrerender(
              viteConfig,
              ctx.reactRouterConfig,
              serverBuildDirectory,
              clientBuildDirectory
            );
          }

          // If we are in SPA mode, *always* generate the `index.html` that can be served at any location for hydration.
          if (!ctx.reactRouterConfig.ssr) {
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
        await reactRouterConfigLoader.close();

        let typegenWatcher = await typegenWatcherPromise;
        await typegenWatcher?.close();
      },
    },
    {
      name: "react-router:build-client-route",
      enforce: "pre",
      async transform(_code, id, options) {
        if (!id.endsWith(BUILD_CLIENT_ROUTE_QUERY_STRING)) return;
        let routeModuleId = id.replace(BUILD_CLIENT_ROUTE_QUERY_STRING, "");

        let routeFileName = path.basename(routeModuleId);

        let sourceExports = await getRouteModuleExports(
          viteChildCompiler,
          ctx,
          routeModuleId
        );

        let reexports = sourceExports
          .filter(
            (exportName) =>
              (options?.ssr &&
                SERVER_ONLY_ROUTE_EXPORTS.includes(exportName)) ||
              CLIENT_ROUTE_EXPORTS.includes(exportName)
          )
          .join(", ");
        return `export { ${reexports} } from "./${routeFileName}";`;
      },
    },
    {
      name: "react-router:virtual-modules",
      enforce: "pre",
      resolveId(id) {
        const vmod = Object.values(virtual).find((vmod) => vmod.id === id);
        if (vmod) return vmod.resolvedId;
      },
      async load(id) {
        switch (id) {
          case virtual.serverBuild.resolvedId: {
            return await getServerEntry();
          }
          case virtual.serverManifest.resolvedId: {
            let reactRouterManifest = ctx.isSsrBuild
              ? await ctx.getReactRouterServerManifest()
              : await getReactRouterManifestForDev();

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
      name: "react-router:dot-client",
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
    WithProps.plugin,
    {
      name: "react-router:route-exports",
      async transform(code, id, options) {
        let route = getRoute(ctx.reactRouterConfig, id);
        if (!route) return;

        if (!options?.ssr && !ctx.reactRouterConfig.ssr) {
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

        type ManifestRoute = ReactRouterManifest["routes"][string];
        type HmrEventData = { route: ManifestRoute | null };
        let hmrEventData: HmrEventData = { route: null };

        if (route) {
          // invalidate manifest on route exports change
          let serverManifest = (
            await server.ssrLoadModule(virtual.serverManifest.id)
          ).default as ReactRouterManifest;

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
    "\n\n" +
    withCommentBoundaries(
      "REACT REFRESH HEADER",
      REACT_REFRESH_HEADER.replaceAll("__SOURCE__", JSON.stringify(id))
    ) +
    "\n\n" +
    withCommentBoundaries("REACT REFRESH BODY", code) +
    "\n\n" +
    withCommentBoundaries(
      "REACT REFRESH FOOTER",
      REACT_REFRESH_FOOTER.replaceAll("__SOURCE__", JSON.stringify(id))
        .replaceAll("__ACCEPT_EXPORTS__", JSON.stringify(acceptExports))
        .replaceAll("__ROUTE_ID__", JSON.stringify(route?.id))
    ) +
    "\n"
  );
}

function withCommentBoundaries(label: string, text: string) {
  let begin = `// [BEGIN] ${label} `;
  begin += "-".repeat(80 - begin.length);
  let end = `// [END] ${label} `;
  end += "-".repeat(80 - end.length);
  return `${begin}\n${text}\n${end}`;
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
}`.trim();

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
}`.trim();

function getRoute(
  pluginConfig: ResolvedReactRouterConfig,
  file: string
): RouteManifestEntry | undefined {
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
  route: RouteManifestEntry,
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
    url: combineURLs(
      ctx.publicPath,
      "/" +
        path.relative(
          ctx.rootDirectory,
          resolveRelativeRouteFilePath(route, ctx.reactRouterConfig)
        )
    ),
    module: combineURLs(
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
  reactRouterConfig: ResolvedReactRouterConfig,
  serverBuildDirectory: string
) {
  let serverBuildPath = path.join(
    serverBuildDirectory,
    reactRouterConfig.serverBuildFile
  );
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
  reactRouterConfig: ResolvedReactRouterConfig,
  serverBuildDirectory: string,
  clientBuildDirectory: string
) {
  let { build, handler } = await getPrerenderBuildAndHandler(
    viteConfig,
    reactRouterConfig,
    serverBuildDirectory
  );

  let routes = createPrerenderRoutes(build.routes);
  let routesToPrerender: string[];
  if (typeof reactRouterConfig.prerender === "boolean") {
    invariant(reactRouterConfig.prerender, "Expected prerender:true");
    routesToPrerender = determineStaticPrerenderRoutes(
      routes,
      viteConfig,
      true
    );
  } else if (typeof reactRouterConfig.prerender === "function") {
    routesToPrerender = await reactRouterConfig.prerender({
      getStaticPaths: () =>
        determineStaticPrerenderRoutes(routes, viteConfig, false),
    });
  } else {
    routesToPrerender = reactRouterConfig.prerender || ["/"];
  }
  let headers = {
    // Header that can be used in the loader to know if you're running at
    // build time or runtime
    "X-React-Router-Prerender": "yes",
  };
  for (let path of routesToPrerender) {
    let matches = matchRoutes(routes, path);
    let hasLoaders = matches?.some((m) => m.route.loader);
    let data: string | undefined;
    if (hasLoaders) {
      data = await prerenderData(
        handler,
        path,
        clientBuildDirectory,
        reactRouterConfig,
        viteConfig,
        { headers }
      );
    }

    // When prerendering a resource route, we don't want to pass along the
    // `.data` file since we want to prerender the raw Response returned from
    // the loader.  Presumably this is for routes where a file extension is
    // already included, such as `app/routes/items[.json].tsx` that will
    // render into `/items.json`
    let leafRoute = matches ? matches[matches.length - 1].route : null;
    let manifestRoute = leafRoute ? build.routes[leafRoute.id]?.module : null;
    let isResourceRoute =
      manifestRoute &&
      !manifestRoute.default &&
      !manifestRoute.ErrorBoundary &&
      manifestRoute.loader;

    if (isResourceRoute) {
      await prerenderResourceRoute(
        handler,
        path,
        clientBuildDirectory,
        reactRouterConfig,
        viteConfig,
        { headers }
      );
    } else {
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

  await prerenderManifest(
    build,
    clientBuildDirectory,
    reactRouterConfig,
    viteConfig
  );
}

function determineStaticPrerenderRoutes(
  routes: DataRouteObject[],
  viteConfig: Vite.ResolvedConfig,
  isBooleanUsage = false
): string[] {
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

  if (isBooleanUsage && paramRoutes.length > 0) {
    viteConfig.logger.warn(
      [
        "⚠️ Paths with dynamic/splat params cannot be prerendered when using `prerender: true`.",
        "You may want to use the `prerender()` API to prerender the following paths:",
        ...paramRoutes.map((p) => "  - " + p),
      ].join("\n")
    );
  }

  // Clean double slashes and remove trailing slashes
  return paths.map((p) => p.replace(/\/\/+/g, "/").replace(/(.+)\/$/, "$1"));
}

async function prerenderData(
  handler: RequestHandler,
  prerenderPath: string,
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
  let request = new Request(`http://localhost${normalizedPath}`, requestInit);
  let response = await handler(request);
  let data = await response.text();

  validatePrerenderedResponse(response, data, "Prerender", normalizedPath);

  // Write out the .data file
  let outdir = path.relative(process.cwd(), clientBuildDirectory);
  let outfile = path.join(outdir, ...normalizedPath.split("/"));
  await fse.ensureDir(path.dirname(outfile));
  await fse.outputFile(outfile, data);
  viteConfig.logger.info(`Prerender: Generated ${colors.bold(outfile)}`);
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

  validatePrerenderedResponse(response, text, "Prerender", normalizedPath);

  // Write out the resource route file
  let outdir = path.relative(process.cwd(), clientBuildDirectory);
  let outfile = path.join(outdir, ...normalizedPath.split("/"));
  await fse.ensureDir(path.dirname(outfile));
  await fse.outputFile(outfile, text);
  viteConfig.logger.info(`Prerender: Generated ${colors.bold(outfile)}`);
}

async function prerenderManifest(
  build: ServerBuild,
  clientBuildDirectory: string,
  reactRouterConfig: ResolvedReactRouterConfig,
  viteConfig: Vite.ResolvedConfig
) {
  let normalizedPath = `${reactRouterConfig.basename}/__manifest`.replace(
    /\/\/+/g,
    "/"
  );
  let outdir = path.relative(process.cwd(), clientBuildDirectory);
  let outfile = path.join(outdir, ...normalizedPath.split("/"));
  await fse.ensureDir(path.dirname(outfile));
  let manifestData = JSON.stringify(build.assets.routes);
  await fse.outputFile(outfile, manifestData);
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
    !html.includes("window.__reactRouterContext =") ||
    !html.includes("window.__reactRouterRouteModules =")
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
