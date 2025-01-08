import fs from "node:fs";

import * as Path from "pathe";
import pc from "picocolors";
import type vite from "vite";

import { createConfigLoader } from "../config/config";

import {
  generate,
  generateRouteManifest,
  generateUseRouteLoaderDataType,
} from "./generate";
import type { Context } from "./context";
import { getTypesDir, getTypesPath, getGlobalTypesFilePath } from "./paths";

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

  const useRouteLoaderDataContent = generateUseRouteLoaderDataType(ctx);
  const useRouteLoaderDataTypesPath = getGlobalTypesFilePath(
    ctx,
    "useRouteLoaderData"
  );
  fs.writeFileSync(useRouteLoaderDataTypesPath, useRouteLoaderDataContent);

  if (ctx.config.future.typesafeUseRouteLoaderData) {
    const routeManifestContent = generateRouteManifest(ctx);
    const routeManifestPath = getGlobalTypesFilePath(ctx, "routeManifest");
    fs.writeFileSync(routeManifestPath, routeManifestContent);
  }
}
