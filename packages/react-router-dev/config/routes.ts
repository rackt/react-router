import * as path from "node:path";
import { findEntry } from "./findEntry";
import { flatRoutes } from "./flatRoutes";

/**
 * A route tree exported from the routes config file
 */
export interface RouteConfig {
  /**
   * The unique id for this route.
   */
  id?: string;

  /**
   * The path this route uses to match on the URL pathname.
   */
  path?: string;

  /**
   * Should be `true` if it is an index route. This disallows child routes.
   */
  index?: boolean;

  /**
   * Should be `true` if the `path` is case-sensitive. Defaults to `false`.
   */
  caseSensitive?: boolean;

  /**
   * The path to the entry point for this route, relative to
   * `config.appDirectory`.
   */
  file: string;

  /**
   * The child routes.
   */
  children?: RouteConfig[];
}

type RouteConfigFunction = (args: {
  appDirectory: string;
}) => RouteConfig | Promise<RouteConfig>;

export type RouteConfigExport = RouteConfig | RouteConfigFunction;

export function routes(
  routeConfig: RouteConfig | RouteConfigFunction
): RouteConfig | Promise<RouteConfig> | RouteConfigFunction {
  return typeof routeConfig === "function"
    ? (args) => routeConfig(args)
    : routeConfig;
}

export function fileSystemRoutes({
  ignoredFilePatterns,
  prefix,
}: {
  ignoredFilePatterns?: string[];
  prefix?: string;
} = {}) {
  return routes(({ appDirectory }) => {
    let rootRouteFile = findEntry(appDirectory, "root");
    if (!rootRouteFile) {
      throw new Error(`Missing "root" route file in ${appDirectory}`);
    }

    return routeManifestToRouteConfig({
      root: { path: "", id: "root", file: rootRouteFile },
      ...flatRoutes(appDirectory, ignoredFilePatterns, prefix),
    });
  });
}

export function routeConfigToRouteManifest(
  routeConfig: RouteConfig
): RouteManifest {
  let routeManifest: RouteManifest = {};

  function resolveRouteId(node: RouteConfig): string {
    return node.id || createRouteId(node.file);
  }

  function walk(node: RouteConfig, parentId: string | null) {
    let id = resolveRouteId(node);
    let manifestItem: ConfigRoute = {
      id,
      parentId: parentId ?? undefined,
      file: node.file,
      path: node.path,
      index: node.index,
      caseSensitive: node.caseSensitive,
    };

    routeManifest[id] = manifestItem;

    if (node.children) {
      for (let child of node.children) {
        walk(child, id);
      }
    }
  }

  walk(routeConfig, null);

  return routeManifest;
}

export function routeManifestToRouteConfig(
  routeManifest: RouteManifest
): RouteConfig {
  let routeConfigs: { [id: string]: RouteConfig } = {};

  for (let [id, route] of Object.entries(routeManifest)) {
    routeConfigs[id] = {
      id: route.id,
      index: route.index,
      file: route.file,
      path: route.path,
      caseSensitive: route.caseSensitive,
    };
  }

  let rootConfig: RouteConfig | null = null;

  for (let [id, config] of Object.entries(routeConfigs)) {
    let manifestItem = routeManifest[id];

    if (!manifestItem.parentId) {
      if (rootConfig) {
        throw new Error("Route manifest must have a single root route");
      }
      rootConfig = config;
    } else {
      let parentConfig = routeConfigs[manifestItem.parentId];
      if (!parentConfig.children) {
        parentConfig.children = [];
      }
      parentConfig.children.push(config);
      rootConfig = config;
    }
  }

  if (!rootConfig) {
    throw new Error("Route manifest must have a root route");
  }

  return rootConfig;
}

/**
 * A route that was created using `defineRoutes` or created conventionally from
 * looking at the files on the filesystem.
 */
export interface ConfigRoute {
  /**
   * The path this route uses to match on the URL pathname.
   */
  path?: string;

  /**
   * Should be `true` if it is an index route. This disallows child routes.
   */
  index?: boolean;

  /**
   * Should be `true` if the `path` is case-sensitive. Defaults to `false`.
   */
  caseSensitive?: boolean;

  /**
   * The unique id for this route, named like its `file` but without the
   * extension. So `app/routes/gists/$username.tsx` will have an `id` of
   * `routes/gists/$username`.
   */
  id: string;

  /**
   * The unique `id` for this route's parent route, if there is one.
   */
  parentId?: string;

  /**
   * The path to the entry point for this route, relative to
   * `config.appDirectory`.
   */
  file: string;
}

export interface RouteManifest {
  [routeId: string]: ConfigRoute;
}

export interface DefineRouteOptions {
  /**
   * Should be `true` if the route `path` is case-sensitive. Defaults to
   * `false`.
   */
  caseSensitive?: boolean;

  /**
   * Should be `true` if this is an index route that does not allow child routes.
   */
  index?: boolean;

  /**
   * An optional unique id string for this route. Use this if you need to aggregate
   * two or more routes with the same route file.
   */
  id?: string;
}

interface DefineRouteChildren {
  (): void;
}

/**
 * A function for defining a route that is passed as the argument to the
 * `defineRoutes` callback.
 *
 * Calls to this function are designed to be nested, using the `children`
 * callback argument.
 *
 *   defineRoutes(route => {
 *     route('/', 'pages/layout', () => {
 *       route('react-router', 'pages/react-router');
 *       route('reach-ui', 'pages/reach-ui');
 *     });
 *   });
 */
export interface DefineRouteFunction {
  (
    /**
     * The path this route uses to match the URL pathname.
     */
    path: string | undefined,

    /**
     * The path to the file that exports the React component rendered by this
     * route as its default export, relative to the `app` directory.
     */
    file: string,

    /**
     * Options for defining routes, or a function for defining child routes.
     */
    optionsOrChildren?: DefineRouteOptions | DefineRouteChildren,

    /**
     * A function for defining child routes.
     */
    children?: DefineRouteChildren
  ): void;
}

export type DefineRoutesFunction = typeof defineRoutes;

/**
 * A function for defining routes programmatically, instead of using the
 * filesystem convention.
 */
export function defineRoutes(
  callback: (defineRoute: DefineRouteFunction) => void
): RouteManifest {
  let routes: RouteManifest = Object.create(null);
  let parentRoutes: ConfigRoute[] = [];
  let alreadyReturned = false;

  let defineRoute: DefineRouteFunction = (
    path,
    file,
    optionsOrChildren,
    children
  ) => {
    if (alreadyReturned) {
      throw new Error(
        "You tried to define routes asynchronously but started defining " +
          "routes before the async work was done. Please await all async " +
          "data before calling `defineRoutes()`"
      );
    }

    let options: DefineRouteOptions;
    if (typeof optionsOrChildren === "function") {
      // route(path, file, children)
      options = {};
      children = optionsOrChildren;
    } else {
      // route(path, file, options, children)
      // route(path, file, options)
      options = optionsOrChildren || {};
    }

    let route: ConfigRoute = {
      path: path ? path : undefined,
      index: options.index ? true : undefined,
      caseSensitive: options.caseSensitive ? true : undefined,
      id: options.id || createRouteId(file),
      parentId:
        parentRoutes.length > 0
          ? parentRoutes[parentRoutes.length - 1].id
          : "root",
      file,
    };

    if (route.id in routes) {
      throw new Error(
        `Unable to define routes with duplicate route id: "${route.id}"`
      );
    }

    routes[route.id] = route;

    if (children) {
      parentRoutes.push(route);
      children();
      parentRoutes.pop();
    }
  };

  callback(defineRoute);

  alreadyReturned = true;

  return routes;
}

export function createRouteId(file: string) {
  return normalizeSlashes(stripFileExtension(file));
}

export function normalizeSlashes(file: string) {
  return file.split(path.win32.sep).join("/");
}

function stripFileExtension(file: string) {
  return file.replace(/\.[a-z0-9]+$/i, "");
}
