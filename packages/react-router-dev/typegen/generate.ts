import ts from "dedent";
import * as Path from "pathe";
import * as Pathe from "pathe/utils";

import { type RouteManifestEntry } from "../config/routes";
import { type Context } from "./context";
import { getTypesPath } from "./paths";
import * as Params from "./params";
import * as Route from "./route";

export function generate(ctx: Context, route: RouteManifestEntry): string {
  const lineage = Route.lineage(ctx.config.routes, route);
  const fullpath = Route.fullpath(lineage);
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
        fullpath
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

function formatParamProperties(fullpath: string) {
  const params = Params.parse(fullpath);
  const properties = Object.entries(params).map(([name, isRequired]) =>
    isRequired ? `"${name}": string` : `"${name}"?: string`
  );
  return properties.join("; ");
}
