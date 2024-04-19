import { execSync } from "node:child_process";
import path from "node:path";
import fse from "fs-extra";
import PackageJson from "@npmcli/package-json";

import type { RouteManifest, DefineRoutesFunction } from "./config/routes";
import { defineRoutes } from "./config/routes";
import { ServerMode, isValidServerMode } from "./config/serverModes";
import { flatRoutes } from "./config/flat-routes";
import { detectPackageManager } from "./cli/detectPackageManager";

export type ServerModuleFormat = "esm" | "cjs";
export type ServerPlatform = "node" | "neutral";

interface FutureConfig {
  v3_fetcherPersist: boolean;
  v3_relativeSplatPath: boolean;
  v3_throwAbortReason: boolean;
  unstable_serverComponents: boolean;
  unstable_singleFetch: boolean;
}

/**
 * The user-provided config in `remix.config.js`.
 */
export interface AppConfig {
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
}

/**
 * Fully resolved configuration object we use throughout Remix.
 */
export interface RemixConfig {
  /**
   * The absolute path to the application source directory.
   */
  appDirectory: string;

  /**
   * The absolute path to the entry.client file.
   */
  entryClientFilePath: string;

  /**
   * The absolute path to the entry.server file.
   */
  entryServerFilePath: string;

  /**
   * The absolute path to the entry.react-server file.
   */
  entryReactServerFilePath: string;

  /**
   * An object of all available routes, keyed by route id.
   */
  routes: RouteManifest;

  /**
   * The output format of the server build. Defaults to "esm".
   */
  serverModuleFormat: ServerModuleFormat;

  future: FutureConfig;
}

export async function resolveConfig(
  appConfig: AppConfig,
  {
    rootDirectory,
    serverMode = ServerMode.Production,
    isSpaMode = false,
  }: {
    rootDirectory: string;
    serverMode?: ServerMode;
    isSpaMode?: boolean;
  }
): Promise<RemixConfig> {
  if (!isValidServerMode(serverMode)) {
    throw new Error(`Invalid server mode "${serverMode}"`);
  }

  let serverModuleFormat = appConfig.serverModuleFormat || "esm";

  let appDirectory = path.resolve(
    rootDirectory,
    appConfig.appDirectory || "app"
  );

  let defaultsDirectory = path.resolve(__dirname, "config", "defaults");

  let userEntryClientFile = findEntry(appDirectory, "entry.client");
  let userEntryServerFile = findEntry(appDirectory, "entry.server");
  let userEntryReactServerFile = findEntry(appDirectory, "entry.react-server");

  let entryServerFile: string;
  let entryClientFile =
    userEntryClientFile ||
    (appConfig.future?.unstable_serverComponents
      ? "entry.client-rsc.tsx"
      : "entry.client.tsx");
  let entryReactServerFile;

  let pkgJson = await PackageJson.load(rootDirectory);
  let deps = pkgJson.content.dependencies ?? {};

  if (isSpaMode && appConfig.future?.unstable_singleFetch != true) {
    // This is a super-simple default since we don't need streaming in SPA Mode.
    // We can include this in a remix-spa template, but right now `npx remix reveal`
    // will still expose the streaming template since that command doesn't have
    // access to the `ssr:false` flag in the vite config (the streaming template
    // works just fine so maybe instea dof having this we _only have this version
    // in the template...).  We let users manage an entry.server file in SPA Mode
    // so they can de ide if they want to hydrate the full document or just an
    // embedded `<div id="app">` or whatever.
    entryServerFile = "entry.server.spa.tsx";
  } else if (userEntryServerFile) {
    entryServerFile = userEntryServerFile;
  } else {
    let serverRuntime = deps["@react-router/deno"]
      ? "deno"
      : deps["@react-router/cloudflare"]
      ? "cloudflare"
      : deps["@react-router/node"]
      ? "node"
      : undefined;

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

    entryServerFile = `entry.server.${serverRuntime}.tsx`;
  }

  if (userEntryReactServerFile) {
    entryReactServerFile = userEntryReactServerFile;
  } else {
    let serverRuntime = deps["@react-router/deno"]
      ? "deno"
      : deps["@react-router/cloudflare"]
      ? "cloudflare"
      : deps["@react-router/node"]
      ? "node"
      : undefined;

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
      serverRuntime === "node" ? "node" : "web"
    }.tsx`;
  }

  let entryClientFilePath = userEntryClientFile
    ? path.resolve(appDirectory, userEntryClientFile)
    : path.resolve(defaultsDirectory, entryClientFile);

  let entryServerFilePath = userEntryServerFile
    ? path.resolve(appDirectory, userEntryServerFile)
    : path.resolve(defaultsDirectory, entryServerFile);

  let entryReactServerFilePath = userEntryReactServerFile
    ? path.resolve(appDirectory, userEntryReactServerFile)
    : path.resolve(defaultsDirectory, entryReactServerFile);

  let rootRouteFile = findEntry(appDirectory, "root");
  if (!rootRouteFile) {
    throw new Error(`Missing "root" route file in ${appDirectory}`);
  }

  let routes: RouteManifest = {
    root: { path: "", id: "root", file: rootRouteFile },
  };

  if (fse.existsSync(path.resolve(appDirectory, "routes"))) {
    let fileRoutes = flatRoutes(appDirectory, appConfig.ignoredRouteFiles);
    for (let route of Object.values(fileRoutes)) {
      routes[route.id] = { ...route, parentId: route.parentId || "root" };
    }
  }
  if (appConfig.routes) {
    let manualRoutes = await appConfig.routes(defineRoutes);
    for (let route of Object.values(manualRoutes)) {
      routes[route.id] = { ...route, parentId: route.parentId || "root" };
    }
  }

  let unstable_serverComponents =
    appConfig.future?.unstable_serverComponents === true;
  let future: FutureConfig = {
    v3_fetcherPersist: appConfig.future?.v3_fetcherPersist === true,
    v3_relativeSplatPath: appConfig.future?.v3_relativeSplatPath === true,
    v3_throwAbortReason: appConfig.future?.v3_throwAbortReason === true,
    unstable_singleFetch:
      appConfig.future?.unstable_singleFetch === true ||
      unstable_serverComponents,
    unstable_serverComponents,
  };

  return {
    appDirectory,
    entryClientFilePath,
    entryServerFilePath,
    entryReactServerFilePath,
    routes,
    serverModuleFormat,
    future,
  };
}

const entryExts = [".js", ".jsx", ".ts", ".tsx"];

function findEntry(dir: string, basename: string): string | undefined {
  for (let ext of entryExts) {
    let file = path.resolve(dir, basename + ext);
    if (fse.existsSync(file)) return path.relative(dir, file);
  }

  return undefined;
}

export function findConfig(
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
