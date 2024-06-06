import type * as Vite from "vite";
import { execSync } from "node:child_process";
import path from "node:path";
import fse from "fs-extra";
import colors from "picocolors";
import pick from "lodash/pick";
import omit from "lodash/omit";
import PackageJson from "@npmcli/package-json";

import {
  type RouteManifest,
  type ConfigRoute,
  type DefineRoutesFunction,
  defineRoutes,
} from "./config/routes";
import { flatRoutes } from "./config/flatRoutes";
import { detectPackageManager } from "./cli/detectPackageManager";

const excludedConfigPresetKeys = ["presets"] as const satisfies ReadonlyArray<
  keyof VitePluginConfig
>;

type ExcludedConfigPresetKey = (typeof excludedConfigPresetKeys)[number];

type ConfigPreset = Omit<VitePluginConfig, ExcludedConfigPresetKey>;

export type Preset = {
  name: string;
  reactRouterConfig?: (args: {
    reactRouterUserConfig: VitePluginConfig;
  }) => ConfigPreset | Promise<ConfigPreset>;
  reactRouterConfigResolved?: (args: {
    reactRouterConfig: ResolvedVitePluginConfig;
  }) => void | Promise<void>;
};

// Only expose a subset of route properties to the "serverBundles" function
const branchRouteProperties = [
  "id",
  "path",
  "file",
  "index",
] as const satisfies ReadonlyArray<keyof ConfigRoute>;
type BranchRoute = Pick<ConfigRoute, (typeof branchRouteProperties)[number]>;

export const configRouteToBranchRoute = (
  configRoute: ConfigRoute
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
  v3_fetcherPersist: boolean;
  v3_relativeSplatPath: boolean;
  v3_throwAbortReason: boolean;
  unstable_serverComponents: boolean;
}

export type BuildManifest = DefaultBuildManifest | ServerBundlesBuildManifest;

type BuildEndHook = (args: {
  buildManifest: BuildManifest | undefined;
  reactRouterConfig: ResolvedVitePluginConfig;
  viteConfig: Vite.ResolvedConfig;
}) => void | Promise<void>;

export type VitePluginConfig = {
  /**
   * The path to the `app` directory, relative to `remix.config.js`. Defaults
   * to `"app"`.
   */
  appDirectory?: string;

  /**
   * A function for defining custom routes, in addition to those already defined
   * using the filesystem convention in `app/routes`. Both sets of routes will
   * be merged.
   */
  routes?: (
    defineRoutes: DefineRoutesFunction
  ) =>
    | ReturnType<DefineRoutesFunction>
    | Promise<ReturnType<DefineRoutesFunction>>;

  /**
   * The output format of the server build. Defaults to "esm".
   */
  serverModuleFormat?: ServerModuleFormat;

  /**
   * A list of filenames or a glob patterns to match files in the `app/routes`
   * directory that Remix will ignore. Matching files will not be recognized as
   * routes.
   */
  ignoredRouteFiles?: string[];

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
  prerender?: Array<string> | (() => Array<string> | Promise<Array<string>>);
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

export type ResolvedVitePluginConfig = Readonly<{
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
   * An array of URLs to prerender to HTML files at build time.
   */
  prerender: Array<string> | null;
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
  ...configs: VitePluginConfig[]
): VitePluginConfig => {
  let reducer = (
    configA: VitePluginConfig,
    configB: VitePluginConfig
  ): VitePluginConfig => {
    let mergeRequired = (key: keyof VitePluginConfig) =>
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
      ...(mergeRequired("ignoredRouteFiles")
        ? {
            ignoredRouteFiles: Array.from(
              new Set([
                ...(configA.ignoredRouteFiles ?? []),
                ...(configB.ignoredRouteFiles ?? []),
              ])
            ),
          }
        : {}),
      ...(mergeRequired("presets")
        ? {
            presets: [...(configA.presets ?? []), ...(configB.presets ?? [])],
          }
        : {}),
      ...(mergeRequired("routes")
        ? {
            routes: async (...args) => {
              let [routesA, routesB] = await Promise.all([
                configA.routes?.(...args),
                configB.routes?.(...args),
              ]);

              return {
                ...routesA,
                ...routesB,
              };
            },
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

export function resolvePublicPath(viteUserConfig: Vite.UserConfig) {
  return viteUserConfig.base ?? "/";
}

export async function resolveReactRouterConfig({
  rootDirectory,
  reactRouterUserConfig,
  viteUserConfig,
  viteCommand,
}: {
  rootDirectory: string;
  reactRouterUserConfig: VitePluginConfig;
  viteUserConfig: Vite.UserConfig;
  viteCommand: Vite.ConfigEnv["command"];
}) {
  let presets: VitePluginConfig[] = (
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

        let configPreset: VitePluginConfig = omit(
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
  } as const satisfies Partial<VitePluginConfig>;

  let {
    appDirectory: userAppDirectory,
    basename,
    buildDirectory: userBuildDirectory,
    buildEnd,
    future: userFuture,
    ignoredRouteFiles,
    routes: userRoutesFunction,
    prerender: prerenderConfig,
    serverBuildFile,
    serverBundles,
    serverModuleFormat,
    ssr,
  } = {
    ...defaults, // Default values should be completely overridden by user/preset config, not merged
    ...mergeReactRouterConfig(...presets, reactRouterUserConfig),
  };

  // Log warning for incompatible vite config flags
  if (!ssr && serverBundles) {
    console.warn(
      colors.yellow(
        colors.bold("⚠️  SPA Mode: ") +
          "the `serverBundles` config is invalid with " +
          "`ssr:false` and will be ignored`"
      )
    );
    serverBundles = undefined;
  }

  let prerender: Array<string> | null = null;
  if (prerenderConfig) {
    if (Array.isArray(prerenderConfig)) {
      prerender = prerenderConfig;
    } else if (typeof prerenderConfig === "function") {
      prerender = await prerenderConfig();
    } else {
      throw new Error(
        "The `prerender` config must be an array of string paths, or a function " +
          "returning an array of string paths"
      );
    }
  }

  let appDirectory = path.resolve(rootDirectory, userAppDirectory || "app");
  let buildDirectory = path.resolve(rootDirectory, userBuildDirectory);
  let publicPath = resolvePublicPath(viteUserConfig);

  if (
    basename !== "/" &&
    viteCommand === "serve" &&
    !viteUserConfig.server?.middlewareMode &&
    !basename.startsWith(publicPath)
  ) {
    throw new Error(
      "When using the React Router `basename` and the Vite `base` config, " +
        "the `basename` config must begin with `base` for the default " +
        "Vite dev server."
    );
  }

  let rootRouteFile = findEntry(appDirectory, "root");
  if (!rootRouteFile) {
    throw new Error(`Missing "root" route file in ${appDirectory}`);
  }

  let routes: RouteManifest = {
    root: { path: "", id: "root", file: rootRouteFile },
  };
  if (fse.existsSync(path.resolve(appDirectory, "routes"))) {
    let fileRoutes = flatRoutes(appDirectory, ignoredRouteFiles);
    for (let route of Object.values(fileRoutes)) {
      routes[route.id] = { ...route, parentId: route.parentId || "root" };
    }
  }
  if (userRoutesFunction) {
    let userRoutes = await userRoutesFunction(defineRoutes);
    for (let route of Object.values(userRoutes)) {
      routes[route.id] = { ...route, parentId: route.parentId || "root" };
    }
  }

  let future: FutureConfig = {
    v3_fetcherPersist: userFuture?.v3_fetcherPersist === true,
    v3_relativeSplatPath: userFuture?.v3_relativeSplatPath === true,
    v3_throwAbortReason: userFuture?.v3_throwAbortReason === true,
    unstable_serverComponents: userFuture?.unstable_serverComponents === true,
  };

  let reactRouterConfig: ResolvedVitePluginConfig = deepFreeze({
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

  return reactRouterConfig;
}

export async function resolveEntryFiles({
  rootDirectory,
  reactRouterConfig,
}: {
  rootDirectory: string;
  reactRouterConfig: ResolvedVitePluginConfig;
}) {
  let { appDirectory, future } = reactRouterConfig;

  let defaultsDirectory = path.resolve(__dirname, "config", "defaults");

  let userEntryClientFile = findEntry(appDirectory, "entry.client");
  let userEntryServerFile = findEntry(appDirectory, "entry.server");
  let userEntryReactServerFile = findEntry(appDirectory, "entry.react-server");

  let entryServerFile: string;
  let entryReactServerFile: string | undefined;
  let entryClientFile =
    userEntryClientFile || future.unstable_serverComponents
      ? "entry.client.rsc.tsx"
      : "entry.client.tsx";

  let pkgJson = await PackageJson.load(rootDirectory);
  let deps = pkgJson.content.dependencies ?? {};
  let serverRuntime = deps["@react-router/deno"]
    ? "deno"
    : deps["@react-router/cloudflare"]
    ? "cloudflare"
    : deps["@react-router/node"]
    ? "node"
    : undefined;

  if (!reactRouterConfig.ssr) {
    // This is a super-simple default since we don't need streaming in SPA Mode.
    // We can include this in a remix-spa template, but right now `npx remix reveal`
    // will still expose the streaming template since that command doesn't have
    // access to the `ssr:false` flag in the vite config (the streaming template
    // works just fine so maybe instead of having this we _only have this version
    // in the template...).  We let users manage an entry.server file in SPA Mode
    // so they can de ide if they want to hydrate the full document or just an
    // embedded `<div id="app">` or whatever.
    entryServerFile = "entry.server.spa.tsx";
  } else if (userEntryServerFile) {
    entryServerFile = userEntryServerFile;
  } else {
    if (!serverRuntime) {
      let serverRuntimes = [
        "@react-router/deno",
        "@react-router/cloudflare",
        "@react-router/node",
      ];
      let formattedList = disjunctionListFormat.format(serverRuntimes);
      throw new Error(
        `Could not determine server runtime. Please install one of the following: ${formattedList}`
      );
    }

    if (!deps["isbot"]) {
      console.log(
        "adding `isbot` to your package.json, you should commit this change"
      );

      pkgJson.update({
        dependencies: {
          ...pkgJson.content.dependencies,
          isbot: "^4",
        },
      });

      await pkgJson.save();

      let packageManager = detectPackageManager() ?? "npm";

      execSync(`${packageManager} install`, {
        cwd: rootDirectory,
        stdio: "inherit",
      });
    }

    entryServerFile = reactRouterConfig.future.unstable_serverComponents
      ? `entry.server.${serverRuntime}.rsc.tsx`
      : `entry.server.${serverRuntime}.tsx`;
  }

  if (future.unstable_serverComponents) {
    if (userEntryReactServerFile) {
      entryReactServerFile = userEntryReactServerFile;
    } else {
      if (!serverRuntime) {
        let serverRuntimes = [
          "@react-router/deno",
          "@react-router/cloudflare",
          "@react-router/node",
        ];
        let formattedList = disjunctionListFormat.format(serverRuntimes);
        throw new Error(
          `Could not determine server runtime. Please install one of the following: ${formattedList}`
        );
      }

      entryReactServerFile = `entry.react-server.${
        serverRuntime === "node" ? serverRuntime : "web"
      }.tsx`;
    }
  }

  let entryClientFilePath = userEntryClientFile
    ? path.resolve(reactRouterConfig.appDirectory, userEntryClientFile)
    : path.resolve(defaultsDirectory, entryClientFile);

  let entryServerFilePath = userEntryServerFile
    ? path.resolve(reactRouterConfig.appDirectory, userEntryServerFile)
    : path.resolve(defaultsDirectory, entryServerFile);

  let entryReactServerFilePath = userEntryReactServerFile
    ? path.resolve(reactRouterConfig.appDirectory, userEntryReactServerFile)
    : entryReactServerFile
    ? path.resolve(defaultsDirectory, entryReactServerFile)
    : undefined;

  return { entryClientFilePath, entryReactServerFilePath, entryServerFilePath };
}

const entryExts = [".js", ".jsx", ".ts", ".tsx"];

function findEntry(dir: string, basename: string): string | undefined {
  for (let ext of entryExts) {
    let file = path.resolve(dir, basename + ext);
    if (fse.existsSync(file)) return path.relative(dir, file);
  }

  return undefined;
}

// adds types for `Intl.ListFormat` to the global namespace
// we could also update our `tsconfig.json` to include `lib: ["es2021"]`
declare namespace Intl {
  type ListType = "conjunction" | "disjunction";

  interface ListFormatOptions {
    localeMatcher?: "lookup" | "best fit";
    type?: ListType;
    style?: "long" | "short" | "narrow";
  }

  interface ListFormatPart {
    type: "element" | "literal";
    value: string;
  }

  class ListFormat {
    constructor(locales?: string | string[], options?: ListFormatOptions);
    format(values: any[]): string;
    formatToParts(values: any[]): ListFormatPart[];
    supportedLocalesOf(
      locales: string | string[],
      options?: ListFormatOptions
    ): string[];
  }
}

let disjunctionListFormat = new Intl.ListFormat("en", {
  style: "long",
  type: "disjunction",
});
