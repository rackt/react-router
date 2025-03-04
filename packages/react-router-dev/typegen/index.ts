import fs from "node:fs";

import ts from "dedent";
import * as Path from "pathe";
import pc from "picocolors";
import type vite from "vite";

import { createConfigLoader } from "../config/config";
import * as Babel from "../vite/babel";

import { generate } from "./generate";
import type { Context } from "./context";
import { getTypesDir, getTypesPath } from "./paths";
import * as Params from "./params";
import * as Route from "./route";

export async function run(rootDirectory: string) {
  const ctx = await createContext({ rootDirectory, watch: false });
  await writeAll(ctx);
}

export type Watcher = {
  close: () => Promise<void>;
};

export async function watch(
  rootDirectory: string,
  { logger }: { logger?: vite.Logger } = {}
): Promise<Watcher> {
  const ctx = await createContext({ rootDirectory, watch: true });
  await writeAll(ctx);
  logger?.info(pc.green("generated types"), { timestamp: true, clear: true });

  ctx.configLoader.onChange(async ({ result, routeConfigChanged }) => {
    if (!result.ok) {
      logger?.error(pc.red(result.error), { timestamp: true, clear: true });
      return;
    }

    ctx.config = result.value;
    if (routeConfigChanged) {
      await writeAll(ctx);
      logger?.info(pc.green("regenerated types"), {
        timestamp: true,
        clear: true,
      });
    }
  });

  return {
    close: async () => await ctx.configLoader.close(),
  };
}

async function createContext({
  rootDirectory,
  watch,
}: {
  rootDirectory: string;
  watch: boolean;
}): Promise<Context> {
  const configLoader = await createConfigLoader({ rootDirectory, watch });
  const configResult = await configLoader.getConfig();

  if (!configResult.ok) {
    throw new Error(configResult.error);
  }

  const config = configResult.value;

  return {
    configLoader,
    rootDirectory,
    config,
  };
}

async function writeAll(ctx: Context): Promise<void> {
  const typegenDir = getTypesDir(ctx);

  fs.rmSync(typegenDir, { recursive: true, force: true });
  Object.values(ctx.config.routes).forEach((route) => {
    const typesPath = getTypesPath(ctx, route);
    const content = generate(ctx, route);
    fs.mkdirSync(Path.dirname(typesPath), { recursive: true });
    fs.writeFileSync(typesPath, content);
  });

  const registerPath = Path.join(typegenDir, "+register.ts");
  fs.writeFileSync(registerPath, register(ctx));

  const virtualPath = Path.join(typegenDir, "+virtual.ts");
  fs.writeFileSync(virtualPath, virtual);
}

function register(ctx: Context) {
  const register = ts`
    import "react-router";

    declare module "react-router" {
      interface Register {
        params: Params;
      }
    }
  `;

  const { t } = Babel;

  const indexPaths = new Set(
    Object.values(ctx.config.routes)
      .filter((route) => route.index)
      .map((route) => route.path)
  );

  const typeParams = t.tsTypeAliasDeclaration(
    t.identifier("Params"),
    null,
    t.tsTypeLiteral(
      Object.values(ctx.config.routes)
        .map((route) => {
          // filter out pathless (layout) routes
          if (route.id !== "root" && !route.path) return undefined;

          // filter out layout routes that have a corresponding index
          if (!route.index && indexPaths.has(route.path)) return undefined;

          const lineage = Route.lineage(ctx.config.routes, route);
          const fullpath = Route.fullpath(lineage);
          const params = Params.parse(fullpath);
          return t.tsPropertySignature(
            t.stringLiteral(fullpath),
            t.tsTypeAnnotation(
              t.tsTypeLiteral(
                Object.entries(params).map(([param, isRequired]) => {
                  const property = t.tsPropertySignature(
                    t.stringLiteral(param),
                    t.tsTypeAnnotation(t.tsStringKeyword())
                  );
                  property.optional = !isRequired;
                  return property;
                })
              )
            )
          );
        })
        .filter((x): x is Babel.Babel.TSPropertySignature => x !== undefined)
    )
  );

  return [register, Babel.generate(typeParams).code].join("\n\n");
}

const virtual = ts`
  declare module "virtual:react-router/server-build" {
    import { ServerBuild } from "react-router";
    export const assets: ServerBuild["assets"];
    export const assetsBuildDirectory: ServerBuild["assetsBuildDirectory"];
    export const basename: ServerBuild["basename"];
    export const entry: ServerBuild["entry"];
    export const future: ServerBuild["future"];
    export const isSpaMode: ServerBuild["isSpaMode"];
    export const prerender: ServerBuild["prerender"];
    export const publicPath: ServerBuild["publicPath"];
    export const routes: ServerBuild["routes"];
    export const ssr: ServerBuild["ssr"];
    export const unstable_getCriticalCss: ServerBuild["unstable_getCriticalCss"];
  }
`;
