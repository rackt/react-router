import fs from "node:fs";

import ts from "dedent";
import * as Path from "pathe";
import pc from "picocolors";
import type vite from "vite";

import { createConfigLoader } from "../config/config";
import type { RouteManifestEntry } from "../config/routes";
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

function isRouteInAppDirectory(ctx: Context, route: RouteManifestEntry) {
  const absoluteRoutePath = Path.resolve(ctx.config.appDirectory, route.file);
  return absoluteRoutePath.startsWith(ctx.config.appDirectory);
}

async function writeAll(ctx: Context): Promise<void> {
  const typegenDir = getTypesDir(ctx);

  fs.rmSync(typegenDir, { recursive: true, force: true });
  Object.values(ctx.config.routes).forEach((route) => {
    // We only generate types for routes in the app directory
    if (!isRouteInAppDirectory(ctx, route)) {
      return;
    }

    const typesPath = getTypesPath(ctx, route);
    const content = generate(ctx, route);
    fs.mkdirSync(Path.dirname(typesPath), { recursive: true });
    fs.writeFileSync(typesPath, content);
  });

  const registerPath = Path.join(typegenDir, "+register.ts");
  fs.writeFileSync(registerPath, register(ctx));
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

  const typeParams = t.tsTypeAliasDeclaration(
    t.identifier("Params"),
    null,
    t.tsTypeLiteral(
      Object.values(ctx.config.routes)
        .map((route) => {
          // filter out pathless (layout) routes
          if (route.id !== "root" && !route.path) return undefined;

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
