import ts from "dedent";
import * as Path from "pathe";
import * as Pathe from "pathe/utils";

import { type RouteManifest, type RouteManifestEntry } from "../config/routes";
import { type Context } from "./context";
import { getTypesDir, getTypesPath } from "./paths";

export function generate(ctx: Context, route: RouteManifestEntry): string {
  const lineage = getRouteLineage(ctx.config.routes, route);
  const urlpath = lineage.map((route) => route.path).join("/");
  const typesPath = getTypesPath(ctx, route);

  const parents = lineage.slice(0, -1);
  const parentTypeImports = parents
    .map((parent, i) => {
      const rel = Path.relative(
        Path.dirname(typesPath),
        getTypesPath(ctx, parent)
      );

      const indent = i === 0 ? "" : "  ".repeat(2);
      let source = noExtension(rel);
      if (!source.startsWith("../")) source = "./" + source;
      return `${indent}import type { Info as Parent${i} } from "${source}.js"`;
    })
    .join("\n");

  return ts`
    // React Router generated types for route:
    // ${route.file}

    import type * as T from "react-router/route-module"

    ${parentTypeImports}

    type Module = typeof import("../${Pathe.filename(route.file)}.js")

    export type Info = {
      parents: [${parents.map((_, i) => `Parent${i}`).join(", ")}],
      id: "${route.id}"
      file: "${route.file}"
      path: "${route.path}"
      params: {${formatParamProperties(
        urlpath
      )}} & { [key: string]: string | undefined }
      module: Module
      loaderData: T.CreateLoaderData<Module>
      actionData: T.CreateActionData<Module>
    }

    export namespace Route {
      export type LinkDescriptors = T.LinkDescriptors
      export type LinksFunction = () => LinkDescriptors

      export type MetaArgs = T.CreateMetaArgs<Info>
      export type MetaDescriptors = T.MetaDescriptors
      export type MetaFunction = (args: MetaArgs) => MetaDescriptors

      export type HeadersArgs = T.HeadersArgs
      export type HeadersFunction = (args: HeadersArgs) => Headers | HeadersInit

      export type LoaderArgs = T.CreateServerLoaderArgs<Info>
      export type ClientLoaderArgs = T.CreateClientLoaderArgs<Info>
      export type ActionArgs = T.CreateServerActionArgs<Info>
      export type ClientActionArgs = T.CreateClientActionArgs<Info>

      export type HydrateFallbackProps = T.CreateHydrateFallbackProps<Info>
      export type ComponentProps = T.CreateComponentProps<Info>
      export type ErrorBoundaryProps = T.CreateErrorBoundaryProps<Info>
    }
  `;
}

const noExtension = (path: string) =>
  Path.join(Path.dirname(path), Pathe.filename(path));

function getRouteLineage(routes: RouteManifest, route: RouteManifestEntry) {
  const result: RouteManifestEntry[] = [];
  while (route) {
    result.push(route);
    if (!route.parentId) break;
    route = routes[route.parentId];
  }
  result.reverse();
  return result;
}

function formatParamProperties(urlpath: string) {
  const params = parseParams(urlpath);
  const properties = Object.entries(params).map(([name, values]) => {
    if (values.length === 1) {
      const isOptional = values[0];
      return isOptional ? `"${name}"?: string` : `"${name}": string`;
    }
    const items = values.map((isOptional) =>
      isOptional ? "string | undefined" : "string"
    );
    return `"${name}": [${items.join(", ")}]`;
  });
  return properties.join("; ");
}

function parseParams(urlpath: string) {
  const result: Record<string, boolean[]> = {};

  let segments = urlpath.split("/");
  segments.forEach((segment) => {
    const match = segment.match(/^:([\w-]+)(\?)?/);
    if (!match) return;
    const param = match[1];
    const isOptional = match[2] !== undefined;

    result[param] ??= [];
    result[param].push(isOptional);
    return;
  });

  const hasSplat = segments.at(-1) === "*";
  if (hasSplat) result["*"] = [false];
  return result;
}

export function generateRouteManifest(ctx: Context) {
  return ts`
    export type RouteManifest = {
      ${Object.entries(ctx.config.routes)
        .map(([routeId, routeEntry], i) => {
          const indent = i === 0 ? "" : "  ".repeat(3);
          const routeTypeFile = Path.relative(
            getTypesDir(ctx),
            getTypesPath(ctx, routeEntry)
          );
          return `${indent}"${routeId}": import("./${routeTypeFile}").Info,`;
        })
        .join("\n")}
    };

    export type RouteId = keyof RouteManifest;
  `;
}

export function generateUseRouteLoaderDataType(ctx: Context) {
  if (ctx.config.future.typesafeUseRouteLoaderData) {
    return ts`
      import type { RouteId, RouteManifest } from "./routeManifest";

      declare module "react-router" {
        export function useRouteLoaderData<RI extends RouteId>(
          id: RI,
        ): RouteManifest[RI]["loaderData"] | undefined;
      }
    `;
  }

  return ts`
    declare module "react-router" {
      export function useRouteLoaderData<T = any>(
        routeId: string
      ): SerializeFrom<T> | undefined;
    }
  `;
}
