import fs from "node:fs";
import path from "node:path";
import {
  type RouteConfigEntry,
  getAppDirectory,
} from "@react-router/dev/routes";

import { routeManifestToRouteConfig } from "./manifest";
import { flatRoutes as flatRoutesImpl } from "./flatRoutes";
import { foldersRoutes as foldesRoutesImpl } from "./foldersRoutes";
import { normalizeSlashes } from "./normalizeSlashes";

/**
 * Creates route config from the file system using a convention that matches
 * [Remix v2's route file
 * naming](https://remix.run/docs/en/v2/file-conventions/routes-files), for use
 * within `routes.ts`.
 */
export async function flatRoutes(
  options: {
    /**
     * An array of [minimatch](https://www.npmjs.com/package/minimatch) globs that match files to ignore.
     * Defaults to `[]`.
     */
    ignoredRouteFiles?: string[];

    /**
     * The directory containing file system routes, relative to the app directory.
     * Defaults to `"./routes"`.
     */
    rootDirectory?: string;
  } = {}
): Promise<RouteConfigEntry[]> {
  let { ignoredRouteFiles = [], rootDirectory: userRootDirectory = "routes" } =
    options;
  let appDirectory = getAppDirectory();
  let rootDirectory = path.resolve(appDirectory, userRootDirectory);
  let relativeRootDirectory = path.relative(appDirectory, rootDirectory);
  let prefix = normalizeSlashes(relativeRootDirectory);

  let routes = fs.existsSync(rootDirectory)
    ? flatRoutesImpl(appDirectory, ignoredRouteFiles, prefix)
    : {};

  return routeManifestToRouteConfig(routes);
}

/**
 * Creates route config from the file system using a convention that matches
 * [Remix v1's route file
 * naming](https://remix.run/docs/en/v1/file-conventions/routes-files), for use
 * within `routes.ts`.
 */
export async function foldersRoutes(): Promise<RouteConfigEntry[]> {
  return foldesRoutesImpl();
}
