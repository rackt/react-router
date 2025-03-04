import type { RouteConfigEntry } from "@react-router/dev/routes";

import fs from "node:fs";
import path from "node:path";

const paramPrefixChar = "$" as const;
const escapeStart = "[" as const;
const escapeEnd = "]" as const;
const optionalStart = "(" as const;
const optionalEnd = ")" as const;

const routeModuleExts = [".js", ".jsx", ".ts", ".tsx", ".md", ".mdx"];

function isRouteModuleFile(filename: string): boolean {
  return routeModuleExts.includes(path.extname(filename));
}

/**
 * Defines routes using the filesystem convention in `app/routes`. The rules are:
 *
 * - Route paths are derived from the file path. A `.` in the filename indicates
 *   a `/` in the URL (a "nested" URL, but no route nesting). A `$` in the
 *   filename indicates a dynamic URL segment.
 * - Subdirectories are used for nested routes.
 *
 * For example, a file named `app/routes/gists/$username.tsx` creates a route
 * with a path of `gists/:username`.
 */
export function foldersRoutes(): RouteConfigEntry[] {
  const routesDirectory = "routes";
  const appRoutesDirectory = "app/routes";
  const files: { [routeId: string]: string } = {};

  // First, find all route modules in app/routes
  visitFiles(appRoutesDirectory, (file) => {
    if (isRouteModuleFile(file)) {
      const relativePath = path.join(routesDirectory, file);
      const routeId = relativePath
        .replace(
          new RegExp(
            `(${routeModuleExts
              .map((ext) => ext.replace(".", "\\."))
              .join("|")})$`
          ),
          ""
        )
        .replace("/_layout", ""); // Allows _layout.tsx to colocate layout route file in same folder
      files[routeId] = relativePath;
      return;
    }

    throw new Error(
      `Invalid route module file: ${path.join(appRoutesDirectory, file)}`
    );
  });

  const routeIds = Object.keys(files).sort(byLongestFirst);
  const parentRouteIds = getParentRouteIds(routeIds);
  const uniqueRoutes = new Map<string, string>();

  function defineNestedRoutes(parentId?: string): RouteConfigEntry[] {
    const childRouteIds = routeIds.filter((id) => {
      return parentRouteIds[id] === parentId;
    });

    const nestedRoutes = [];
    for (const routeId of childRouteIds) {
      const routePath: string | undefined = createRoutePath(
        routeId.slice((parentId || routesDirectory).length + 1)
      );

      const isIndexRoute = routeId.endsWith("/index");
      const fullPath = createRoutePath(
        routeId.slice(routesDirectory.length + 1)
      );
      const uniqueRouteId = (fullPath || "") + (isIndexRoute ? "?index" : "");
      const isPathlessLayoutRoute =
        routeId.split("/").pop()?.startsWith("__") === true;

      /**
       * We do not try to detect path collisions for pathless layout route
       * files because, by definition, they create the potential for route
       * collisions _at that level in the tree_.
       *
       * Consider example where a user may want multiple pathless layout routes
       * for different subfolders
       *
       *   routes/
       *     account.tsx
       *     account/
       *       __public/
       *         login.tsx
       *         perks.tsx
       *       __private/
       *         orders.tsx
       *         profile.tsx
       *       __public.tsx
       *       __private.tsx
       *
       * In order to support both a public and private layout for `/account/*`
       * URLs, we are creating a mutually exclusive set of URLs beneath 2
       * separate pathless layout routes.  In this case, the route paths for
       * both account/__public.tsx and account/__private.tsx is the same
       * (/account), but we're again not expecting to match at that level.
       *
       * By only ignoring this check when the final portion of the filename is
       * pathless, we will still detect path collisions such as:
       *
       *   routes/parent/__pathless/foo.tsx
       *   routes/parent/__pathless2/foo.tsx
       *
       * and
       *
       *   routes/parent/__pathless/index.tsx
       *   routes/parent/__pathless2/index.tsx
       */
      if (uniqueRouteId && !isPathlessLayoutRoute) {
        if (uniqueRoutes.has(uniqueRouteId)) {
          throw new Error(
            `Path ${JSON.stringify(fullPath || "/")} defined by route ` +
              `${JSON.stringify(routeId)} conflicts with route ` +
              `${JSON.stringify(uniqueRoutes.get(uniqueRouteId))}`
          );
        } else {
          uniqueRoutes.set(uniqueRouteId, routeId);
        }
      }

      if (isIndexRoute) {
        const invalidChildRoutes = routeIds.filter(
          (id) => parentRouteIds[id] === routeId
        );

        if (invalidChildRoutes.length > 0) {
          throw new Error(
            `Child routes are not allowed in index routes. Please remove child routes of ${routeId}`
          );
        }

        nestedRoutes.push({
          path: routePath,
          file: files[routeId],
          index: true,
          id: routeId,
        });
      } else {
        nestedRoutes.push({
          path: routePath,
          file: files[routeId],
          id: routeId,
          children: defineNestedRoutes(routeId),
        });
      }
    }
    return nestedRoutes;
  }

  return defineNestedRoutes();
}

// TODO: Cleanup and write some tests for this function
export function createRoutePath(partialRouteId: string): string | undefined {
  let result = "";
  let rawSegmentBuffer = "";

  let inEscapeSequence = 0;
  let inOptionalSegment = 0;
  let optionalSegmentIndex = null;
  let skipSegment = false;
  for (let i = 0; i < partialRouteId.length; i++) {
    const char = partialRouteId.charAt(i);
    const prevChar = i > 0 ? partialRouteId.charAt(i - 1) : undefined;
    const nextChar =
      i < partialRouteId.length - 1 ? partialRouteId.charAt(i + 1) : undefined;

    function isNewEscapeSequence() {
      return (
        !inEscapeSequence && char === escapeStart && prevChar !== escapeStart
      );
    }

    function isCloseEscapeSequence() {
      return inEscapeSequence && char === escapeEnd && nextChar !== escapeEnd;
    }

    function isStartOfLayoutSegment() {
      return char === "_" && nextChar === "_" && !rawSegmentBuffer;
    }

    function isNewOptionalSegment() {
      return (
        char === optionalStart &&
        prevChar !== optionalStart &&
        (isSegmentSeparator(prevChar) || prevChar === undefined) &&
        !inOptionalSegment &&
        !inEscapeSequence
      );
    }

    function isCloseOptionalSegment() {
      return (
        char === optionalEnd &&
        nextChar !== optionalEnd &&
        (isSegmentSeparator(nextChar) || nextChar === undefined) &&
        inOptionalSegment &&
        !inEscapeSequence
      );
    }

    if (skipSegment) {
      if (isSegmentSeparator(char)) {
        skipSegment = false;
      }
      continue;
    }

    if (isNewEscapeSequence()) {
      inEscapeSequence++;
      continue;
    }

    if (isCloseEscapeSequence()) {
      inEscapeSequence--;
      continue;
    }

    if (isNewOptionalSegment()) {
      inOptionalSegment++;
      optionalSegmentIndex = result.length;
      result += optionalStart;
      continue;
    }

    if (isCloseOptionalSegment()) {
      if (optionalSegmentIndex !== null) {
        result =
          result.slice(0, optionalSegmentIndex) +
          result.slice(optionalSegmentIndex + 1);
      }
      optionalSegmentIndex = null;
      inOptionalSegment--;
      result += "?";
      continue;
    }

    if (inEscapeSequence) {
      result += char;
      continue;
    }

    if (isSegmentSeparator(char)) {
      if (rawSegmentBuffer === "index" && result.endsWith("index")) {
        result = result.replace(/\/?index$/, "");
      } else {
        result += "/";
      }

      rawSegmentBuffer = "";
      inOptionalSegment = 0;
      optionalSegmentIndex = null;
      continue;
    }

    if (isStartOfLayoutSegment()) {
      skipSegment = true;
      continue;
    }

    rawSegmentBuffer += char;

    if (char === paramPrefixChar) {
      if (nextChar === optionalEnd) {
        throw new Error(
          `Invalid route path: ${partialRouteId}. Splat route $ is already optional`
        );
      }
      result += typeof nextChar === "undefined" ? "*" : ":";
      continue;
    }

    result += char;
  }

  if (rawSegmentBuffer === "index" && result.endsWith("index")) {
    result = result.replace(/\/?index$/, "");
  } else {
    result = result.replace(/\/$/, "");
  }

  if (rawSegmentBuffer === "index" && result.endsWith("index?")) {
    throw new Error(
      `Invalid route path: ${partialRouteId}. Make index route optional by using (index)`
    );
  }

  return result || undefined;
}

function isSegmentSeparator(checkChar: string | undefined) {
  if (!checkChar) return false;
  return ["/", ".", path.win32.sep].includes(checkChar);
}

function getParentRouteIds(
  routeIds: string[]
): Record<string, string | undefined> {
  return routeIds.reduce<Record<string, string | undefined>>(
    (parentRouteIds, childRouteId) => ({
      ...parentRouteIds,
      [childRouteId]: routeIds.find((id) => childRouteId.startsWith(`${id}/`)),
    }),
    {}
  );
}

function byLongestFirst(a: string, b: string): number {
  return b.length - a.length;
}

function visitFiles(
  dir: string,
  visitor: (file: string) => void,
  baseDir = dir
): void {
  for (const filename of fs.readdirSync(dir)) {
    const file = path.resolve(dir, filename);
    const stat = fs.lstatSync(file);

    if (stat.isDirectory()) {
      visitFiles(file, visitor, baseDir);
    } else if (stat.isFile()) {
      visitor(path.relative(baseDir, file));
    }
  }
}
