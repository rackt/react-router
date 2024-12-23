import fs from "node:fs";
import { execSync } from "node:child_process";
import PackageJson from "@npmcli/package-json";
import * as ViteNode from "../vite/vite-node";
import type * as Vite from "vite";
import Path from "pathe";
import chokidar, {
  type FSWatcher,
  type EmitArgs as ChokidarEmitArgs,
} from "chokidar";
import colors from "picocolors";
import pick from "lodash/pick";
import omit from "lodash/omit";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";

import {
  type RouteManifest,
  type RouteManifestEntry,
  setAppDirectory,
  validateRouteConfig,
  configRoutesToRouteManifest,
} from "./routes";
import { detectPackageManager } from "../cli/detectPackageManager";

const excludedConfigPresetKeys = ["presets"] as const satisfies ReadonlyArray<
  keyof ReactRouterConfig
>;

type ExcludedConfigPresetKey = (typeof excludedConfigPresetKeys)[number];

type ConfigPreset = Omit<ReactRouterConfig, ExcludedConfigPresetKey>;

export type Preset = {
  name: string;
  reactRouterConfig?: (args: {
    reactRouterUserConfig: ReactRouterConfig;
  }) => ConfigPreset | Promise<ConfigPreset>;
  reactRouterConfigResolved?: (args: {
    reactRouterConfig: ResolvedReactRouterConfig;
  }) => void | Promise<void>;
};

// Only expose a subset of route properties to the "serverBundles" function
const branchRouteProperties = [
  "id",
  "path",
  "file",
  "index",
] as const satisfies ReadonlyArray<keyof RouteManifestEntry>;
type BranchRoute = Pick<
  RouteManifestEntry,
  (typeof branchRouteProperties)[number]
>;

export const configRouteToBranchRoute = (
  configRoute: RouteManifestEntry
): BranchRoute => pick(configRoute, branchRouteProperties);

export type ServerBundlesFunction = (args: {
  branch: BranchRoute[];
}) => string | Promise<string>;

type BaseBuildManifest = {
  routes: RouteManifest;
};

type DefaultBuildManifest = BaseBuildManifest & {
  serverBundles?: never;
  routeIdToServerBundleId?: never;
};

export type ServerBundlesBuildManifest = BaseBuildManifest & {
  serverBundles: {
    [serverBundleId: string]: {
      id: string;
      file: string;
    };
  };
  routeIdToServerBundleId: Record<string, string>;
};

type ServerModuleFormat = "esm" | "cjs";

interface FutureConfig {
  unstable_optimizeDeps: boolean;
}

export type BuildManifest = DefaultBuildManifest | ServerBundlesBuildManifest;

type BuildEndHook = (args: {
  buildManifest: BuildManifest | undefined;
  reactRouterConfig: ResolvedReactRouterConfig;
  viteConfig: Vite.ResolvedConfig;
}) => void | Promise<void>;

/**
 * Config to be exported via the default export from `react-router.config.ts`.
 */
export type ReactRouterConfig = {
  /**
   * The path to the `app` directory, relative to the root directory. Defaults
   * to `"app"`.
   */
  appDirectory?: string;

  /**
   * The output format of the server build. Defaults to "esm".
   */
  serverModuleFormat?: ServerModuleFormat;

  /**
   * Enabled future flags
   */
  future?: [keyof FutureConfig] extends [never]
    ? // Partial<FutureConfig> doesn't work when it's empty so just prevent any keys
      { [key: string]: never }
    : Partial<FutureConfig>;

  /**
   * The React Router app basename.  Defaults to `"/"`.
   */
  basename?: string;
  /**
   * The path to the build directory, relative to the project. Defaults to
   * `"build"`.
   */
  buildDirectory?: string;
  /**
   * A function that is called after the full React Router build is complete.
   */
  buildEnd?: BuildEndHook;
  /**
   * An array of URLs to prerender to HTML files at build time.  Can also be a
   * function returning an array to dynamically generate URLs.
   */
  prerender?:
    | boolean
    | Array<string>
    | ((args: {
        getStaticPaths: () => string[];
      }) => Array<string> | Promise<Array<string>>);
  /**
   * An array of React Router plugin config presets to ease integration with
   * other platforms and tools.
   */
  presets?: Array<Preset>;
  /**
   * The file name of the server build output. This file
   * should end in a `.js` extension and should be deployed to your server.
   * Defaults to `"index.js"`.
   */
  serverBuildFile?: string;
  /**
   * A function for assigning routes to different server bundles. This
   * function should return a server bundle ID which will be used as the
   * bundle's directory name within the server build directory.
   */
  serverBundles?: ServerBundlesFunction;
  /**
   * Enable server-side rendering for your application. Disable to use "SPA
   * Mode", which will request the `/` path at build-time and save it as an
   * `index.html` file with your assets so your application can be deployed as a
   * SPA without server-rendering. Default's to `true`.
   */
  ssr?: boolean;
};

export type ResolvedReactRouterConfig = Readonly<{
  /**
   * The absolute path to the application source directory.
   */
  appDirectory: string;
  /**
   * The React Router app basename.  Defaults to `"/"`.
   */
  basename: string;
  /**
   * The absolute path to the build directory.
   */
  buildDirectory: string;
  /**
   * A function that is called after the full React Router build is complete.
   */
  buildEnd?: BuildEndHook;
  /**
   * Enabled future flags
   */
  future: FutureConfig;
  /**
   * An array of URLs to prerender to HTML files at build time.  Can also be a
   * function returning an array to dynamically generate URLs.
   */
  prerender: ReactRouterConfig["prerender"];
  /**
   * An object of all available routes, keyed by route id.
   */
  routes: RouteManifest;
  /**
   * The file name of the server build output. This file
   * should end in a `.js` extension and should be deployed to your server.
   * Defaults to `"index.js"`.
   */
  serverBuildFile: string;
  /**
   * A function for assigning routes to different server bundles. This
   * function should return a server bundle ID which will be used as the
   * bundle's directory name within the server build directory.
   */
  serverBundles?: ServerBundlesFunction;
  /**
   * The output format of the server build. Defaults to "esm".
   */
  serverModuleFormat: ServerModuleFormat;
  /**
   * Enable server-side rendering for your application. Disable to use "SPA
   * Mode", which will request the `/` path at build-time and save it as an
   * `index.html` file with your assets so your application can be deployed as a
   * SPA without server-rendering. Default's to `true`.
   */
  ssr: boolean;
}>;

let mergeReactRouterConfig = (
  ...configs: ReactRouterConfig[]
): ReactRouterConfig => {
  let reducer = (
    configA: ReactRouterConfig,
    configB: ReactRouterConfig
  ): ReactRouterConfig => {
    let mergeRequired = (key: keyof ReactRouterConfig) =>
      configA[key] !== undefined && configB[key] !== undefined;

    return {
      ...configA,
      ...configB,
      ...(mergeRequired("buildEnd")
        ? {
            buildEnd: async (...args) => {
              await Promise.all([
                configA.buildEnd?.(...args),
                configB.buildEnd?.(...args),
              ]);
            },
          }
        : {}),
      ...(mergeRequired("future")
        ? {
            future: {
              ...configA.future,
              ...configB.future,
            },
          }
        : {}),
      ...(mergeRequired("presets")
        ? {
            presets: [...(configA.presets ?? []), ...(configB.presets ?? [])],
          }
        : {}),
    };
  };

  return configs.reduce(reducer, {});
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

type Result<T> =
  | {
      ok: true;
      value: T;
      error?: undefined;
    }
  | {
      ok: false;
      value?: undefined;
      error: string;
    };

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(error: string): Result<T> {
  return { ok: false, error };
}

async function resolveConfig({
  root,
  viteNodeContext,
  reactRouterConfigFile,
}: {
  root: string;
  viteNodeContext: ViteNode.Context;
  reactRouterConfigFile?: string;
}): Promise<Result<ResolvedReactRouterConfig>> {
  let reactRouterUserConfig: ReactRouterConfig = {};

  if (reactRouterConfigFile) {
    try {
      if (!fs.existsSync(reactRouterConfigFile)) {
        return err(`${reactRouterConfigFile} no longer exists`);
      }

      let configModule = await viteNodeContext.runner.executeFile(
        reactRouterConfigFile
      );

      if (configModule.default === undefined) {
        return err(`${reactRouterConfigFile} must provide a default export`);
      }

      if (typeof configModule.default !== "object") {
        return err(`${reactRouterConfigFile} must export a config`);
      }

      reactRouterUserConfig = configModule.default;
    } catch (error) {
      return err(`Error loading ${reactRouterConfigFile}: ${error}`);
    }
  }

  // Prevent mutations to the user config
  reactRouterUserConfig = deepFreeze(cloneDeep(reactRouterUserConfig));

  let presets: ReactRouterConfig[] = (
    await Promise.all(
      (reactRouterUserConfig.presets ?? []).map(async (preset) => {
        if (!preset.name) {
          throw new Error(
            "React Router presets must have a `name` property defined."
          );
        }

        if (!preset.reactRouterConfig) {
          return null;
        }

        let configPreset: ReactRouterConfig = omit(
          await preset.reactRouterConfig({ reactRouterUserConfig }),
          excludedConfigPresetKeys
        );

        return configPreset;
      })
    )
  ).filter(function isNotNull<T>(value: T | null): value is T {
    return value !== null;
  });

  let defaults = {
    basename: "/",
    buildDirectory: "build",
    serverBuildFile: "index.js",
    serverModuleFormat: "esm",
    ssr: true,
  } as const satisfies Partial<ReactRouterConfig>;

  let {
    appDirectory: userAppDirectory,
    basename,
    buildDirectory: userBuildDirectory,
    buildEnd,
    prerender,
    serverBuildFile,
    serverBundles,
    serverModuleFormat,
    ssr,
  } = {
    ...defaults, // Default values should be completely overridden by user/preset config, not merged
    ...mergeReactRouterConfig(...presets, reactRouterUserConfig),
  };

  if (!ssr && serverBundles) {
    serverBundles = undefined;
  }

  let isValidPrerenderConfig =
    prerender == null ||
    typeof prerender === "boolean" ||
    Array.isArray(prerender) ||
    typeof prerender === "function";

  if (!isValidPrerenderConfig) {
    return err(
      "The `prerender` config must be a boolean, an array of string paths, " +
        "or a function returning a boolean or array of string paths"
    );
  }

  let appDirectory = Path.resolve(root, userAppDirectory || "app");
  let buildDirectory = Path.resolve(root, userBuildDirectory);

  let rootRouteFile = findEntry(appDirectory, "root");
  if (!rootRouteFile) {
    let rootRouteDisplayPath = Path.relative(
      root,
      Path.join(appDirectory, "root.tsx")
    );
    return err(
      `Could not find a root route module in the app directory as "${rootRouteDisplayPath}"`
    );
  }

  let routes: RouteManifest = {
    root: { path: "", id: "root", file: rootRouteFile },
  };

  let routeConfigFile = findEntry(appDirectory, "routes");

  try {
    if (!routeConfigFile) {
      let routeConfigDisplayPath = Path.relative(
        root,
        Path.join(appDirectory, "routes.ts")
      );
      return err(`Route config file not found at "${routeConfigDisplayPath}".`);
    }

    setAppDirectory(appDirectory);
    let routeConfigExport = (
      await viteNodeContext.runner.executeFile(
        Path.join(appDirectory, routeConfigFile)
      )
    ).default;
    let routeConfig = await routeConfigExport;

    let result = validateRouteConfig({
      routeConfigFile,
      routeConfig,
    });

    if (!result.valid) {
      return err(result.message);
    }

    routes = {
      ...routes,
      ...configRoutesToRouteManifest(appDirectory, routeConfig),
    };
  } catch (error: any) {
    return err(
      [
        colors.red(`Route config in "${routeConfigFile}" is invalid.`),
        "",
        error.loc?.file && error.loc?.column && error.frame
          ? [
              Path.relative(appDirectory, error.loc.file) +
                ":" +
                error.loc.line +
                ":" +
                error.loc.column,
              error.frame.trim?.(),
            ]
          : error.stack,
      ]
        .flat()
        .join("\n")
    );
  }

  let future: FutureConfig = {
    unstable_optimizeDeps:
      reactRouterUserConfig.future?.unstable_optimizeDeps ?? false,
  };

  let reactRouterConfig: ResolvedReactRouterConfig = deepFreeze({
    appDirectory,
    basename,
    buildDirectory,
    buildEnd,
    future,
    prerender,
    routes,
    serverBuildFile,
    serverBundles,
    serverModuleFormat,
    ssr,
  });

  for (let preset of reactRouterUserConfig.presets ?? []) {
    await preset.reactRouterConfigResolved?.({ reactRouterConfig });
  }

  return ok(reactRouterConfig);
}

type ChokidarEventName = ChokidarEmitArgs[0];

type ChangeHandler = (args: {
  result: Result<ResolvedReactRouterConfig>;
  configCodeChanged: boolean;
  routeConfigCodeChanged: boolean;
  configChanged: boolean;
  routeConfigChanged: boolean;
  path: string;
  event: ChokidarEventName;
}) => void;

export type ConfigLoader = {
  getConfig: () => Promise<Result<ResolvedReactRouterConfig>>;
  onChange: (handler: ChangeHandler) => () => void;
  close: () => Promise<void>;
};

export async function createConfigLoader({
  rootDirectory: root,
  watch,
}: {
  watch: boolean;
  rootDirectory?: string;
}): Promise<ConfigLoader> {
  root = Path.normalize(root ?? process.env.REACT_ROUTER_ROOT ?? process.cwd());

  let vite = await import("vite");
  let viteNodeContext = await ViteNode.createContext({
    root,
    mode: watch ? "development" : "production",
    server: !watch ? { watch: null } : {},
    ssr: { external: ssrExternals },
    // Filter out any info level logs from vite-node
    customLogger: vite.createLogger("warn", {
      prefix: "[react-router]",
    }),
  });

  let reactRouterConfigFile: string | undefined;

  let updateReactRouterConfigFile = () => {
    reactRouterConfigFile = findEntry(root, "react-router.config", {
      absolute: true,
    });
  };

  updateReactRouterConfigFile();

  let getConfig = () =>
    resolveConfig({ root, viteNodeContext, reactRouterConfigFile });

  let appDirectory: string;

  let initialConfigResult = await getConfig();

  if (!initialConfigResult.ok) {
    throw new Error(initialConfigResult.error);
  }

  appDirectory = Path.normalize(initialConfigResult.value.appDirectory);

  let currentConfig = initialConfigResult.value;

  let fsWatcher: FSWatcher | undefined;
  let changeHandlers: ChangeHandler[] = [];

  return {
    getConfig,
    onChange: (handler: ChangeHandler) => {
      if (!watch) {
        throw new Error(
          "onChange is not supported when watch mode is disabled"
        );
      }

      changeHandlers.push(handler);

      if (!fsWatcher) {
        fsWatcher = chokidar.watch([root, appDirectory], {
          ignoreInitial: true,
          ignored: (path) => {
            let dirname = Path.dirname(path);

            return (
              !dirname.startsWith(appDirectory) &&
              // Ensure we're only watching files outside of the app directory
              // that are at the root level, not nested in subdirectories
              path !== root && // Watch the root directory itself
              dirname !== root // Watch files at the root level
            );
          },
        });

        fsWatcher.on("all", async (...args: ChokidarEmitArgs) => {
          let [event, rawFilepath] = args;
          let filepath = Path.normalize(rawFilepath);

          let fileAddedOrRemoved = event === "add" || event === "unlink";

          let appFileAddedOrRemoved =
            fileAddedOrRemoved &&
            filepath.startsWith(Path.normalize(appDirectory));

          let rootRelativeFilepath = Path.relative(root, filepath);

          let configFileAddedOrRemoved =
            fileAddedOrRemoved &&
            isEntryFile("react-router.config", rootRelativeFilepath);

          if (configFileAddedOrRemoved) {
            updateReactRouterConfigFile();
          }

          let moduleGraphChanged =
            configFileAddedOrRemoved ||
            Boolean(
              viteNodeContext.devServer?.moduleGraph.getModuleById(filepath)
            );

          // Bail out if no relevant changes detected
          if (!moduleGraphChanged && !appFileAddedOrRemoved) {
            return;
          }

          viteNodeContext.devServer?.moduleGraph.invalidateAll();
          viteNodeContext.runner?.moduleCache.clear();

          let result = await getConfig();

          let prevAppDirectory = appDirectory;
          appDirectory = Path.normalize(
            (result.value ?? currentConfig).appDirectory
          );

          if (appDirectory !== prevAppDirectory) {
            fsWatcher!.unwatch(prevAppDirectory);
            fsWatcher!.add(appDirectory);
          }

          let configCodeChanged =
            configFileAddedOrRemoved ||
            (reactRouterConfigFile !== undefined &&
              isEntryFileDependency(
                viteNodeContext.devServer.moduleGraph,
                reactRouterConfigFile,
                filepath
              ));

          let routeConfigFile = findEntry(appDirectory, "routes", {
            absolute: true,
          });
          let routeConfigCodeChanged =
            typeof routeConfigFile === "string" &&
            isEntryFileDependency(
              viteNodeContext.devServer.moduleGraph,
              routeConfigFile,
              filepath
            );

          let configChanged =
            result.ok &&
            !isEqual(omitRoutes(currentConfig), omitRoutes(result.value));

          let routeConfigChanged =
            result.ok && !isEqual(currentConfig?.routes, result.value.routes);

          for (let handler of changeHandlers) {
            handler({
              result,
              configCodeChanged,
              routeConfigCodeChanged,
              configChanged,
              routeConfigChanged,
              path: filepath,
              event,
            });
          }

          if (result.ok) {
            currentConfig = result.value;
          }
        });
      }

      return () => {
        changeHandlers = changeHandlers.filter(
          (changeHandler) => changeHandler !== handler
        );
      };
    },
    close: async () => {
      changeHandlers = [];
      await viteNodeContext.devServer.close();
      await fsWatcher?.close();
    },
  };
}

export async function loadConfig({ rootDirectory }: { rootDirectory: string }) {
  let configLoader = await createConfigLoader({
    rootDirectory,
    watch: false,
  });
  let config = await configLoader.getConfig();
  await configLoader.close();
  return config;
}

export async function resolveEntryFiles({
  rootDirectory,
  reactRouterConfig,
}: {
  rootDirectory: string;
  reactRouterConfig: ResolvedReactRouterConfig;
}) {
  let { appDirectory } = reactRouterConfig;

  let defaultsDirectory = Path.resolve(
    Path.dirname(require.resolve("@react-router/dev/package.json")),
    "dist",
    "config",
    "defaults"
  );

  let userEntryClientFile = findEntry(appDirectory, "entry.client");
  let userEntryServerFile = findEntry(appDirectory, "entry.server");

  let entryServerFile: string;
  let entryClientFile = userEntryClientFile || "entry.client.tsx";

  let pkgJson = await PackageJson.load(rootDirectory);
  let deps = pkgJson.content.dependencies ?? {};

  if (userEntryServerFile) {
    entryServerFile = userEntryServerFile;
  } else {
    if (!deps["@react-router/node"]) {
      throw new Error(
        `Could not determine server runtime. Please install @react-router/node, or provide a custom entry.server.tsx/jsx file in your app directory.`
      );
    }

    if (!deps["isbot"]) {
      console.log(
        "adding `isbot@5` to your package.json, you should commit this change"
      );

      pkgJson.update({
        dependencies: {
          ...pkgJson.content.dependencies,
          isbot: "^5",
        },
      });

      await pkgJson.save();

      let packageManager = detectPackageManager() ?? "npm";

      execSync(`${packageManager} install`, {
        cwd: rootDirectory,
        stdio: "inherit",
      });
    }

    entryServerFile = `entry.server.node.tsx`;
  }

  let entryClientFilePath = userEntryClientFile
    ? Path.resolve(reactRouterConfig.appDirectory, userEntryClientFile)
    : Path.resolve(defaultsDirectory, entryClientFile);

  let entryServerFilePath = userEntryServerFile
    ? Path.resolve(reactRouterConfig.appDirectory, userEntryServerFile)
    : Path.resolve(defaultsDirectory, entryServerFile);

  return { entryClientFilePath, entryServerFilePath };
}

export const ssrExternals = isInReactRouterMonorepo()
  ? [
      // This is only needed within this repo because these packages
      // are linked to a directory outside of node_modules so Vite
      // treats them as internal code by default.
      "react-router",
      "react-router-dom",
      "@react-router/architect",
      "@react-router/cloudflare",
      "@react-router/dev",
      "@react-router/express",
      "@react-router/node",
      "@react-router/serve",
    ]
  : undefined;

function isInReactRouterMonorepo() {
  // We use '@react-router/node' for this check since it's a
  // dependency of this package and guaranteed to be in node_modules
  let serverRuntimePath = Path.dirname(
    require.resolve("@react-router/node/package.json")
  );
  let serverRuntimeParentDir = Path.basename(
    Path.resolve(serverRuntimePath, "..")
  );
  return serverRuntimeParentDir === "packages";
}

function omitRoutes(
  config: ResolvedReactRouterConfig
): ResolvedReactRouterConfig {
  return {
    ...config,
    routes: {},
  };
}

const entryExts = [".js", ".jsx", ".ts", ".tsx"];

function isEntryFile(entryBasename: string, filename: string) {
  return entryExts.some((ext) => filename === `${entryBasename}${ext}`);
}

function findEntry(
  dir: string,
  basename: string,
  options?: { absolute?: boolean }
): string | undefined {
  for (let ext of entryExts) {
    let file = Path.resolve(dir, basename + ext);
    if (fs.existsSync(file)) {
      return options?.absolute ?? false ? file : Path.relative(dir, file);
    }
  }

  return undefined;
}

function isEntryFileDependency(
  moduleGraph: Vite.ModuleGraph,
  entryFilepath: string,
  filepath: string,
  visited = new Set<string>()
): boolean {
  // Ensure normalized paths
  entryFilepath = Path.normalize(entryFilepath);
  filepath = Path.normalize(filepath);

  if (visited.has(filepath)) {
    return false;
  }

  visited.add(filepath);

  if (filepath === entryFilepath) {
    return true;
  }

  let mod = moduleGraph.getModuleById(filepath);

  if (!mod) {
    return false;
  }

  // Recursively check all importers to see if any of them are the entry file
  for (let importer of mod.importers) {
    if (!importer.id) {
      continue;
    }

    if (
      importer.id === entryFilepath ||
      isEntryFileDependency(moduleGraph, entryFilepath, importer.id, visited)
    ) {
      return true;
    }
  }

  return false;
}
