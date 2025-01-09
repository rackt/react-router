import type * as rr from "react-router";
import type { AppLoadContext, ServerBuild } from "react-router";
import { type Plugin } from "vite";
import { type GetPlatformProxyOptions, type PlatformProxy } from "wrangler";

import { fromNodeRequest, toNodeRequest } from "./node-adapter";
import { preloadVite, getVite } from "./vite";
import { virtual } from "./plugin";

let serverBuildId = "virtual:react-router/server-build";

type CfProperties = Record<string, unknown>;

type LoadContext<Env, Cf extends CfProperties> = {
  cloudflare: Omit<PlatformProxy<Env, Cf>, "dispose">;
};

type GetLoadContext<Env, Cf extends CfProperties> = (args: {
  request: Request;
  context: LoadContext<Env, Cf>;
}) => AppLoadContext | Promise<AppLoadContext>;

function importWrangler() {
  try {
    return import("wrangler");
  } catch (_) {
    throw Error("Could not import `wrangler`. Do you have it installed?");
  }
}

const PLUGIN_NAME = "react-router-cloudflare-vite-dev-proxy";

/**
 * Vite plugin that provides [Node proxies to local workerd
 * bindings](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)
 * to `context.cloudflare` in your server loaders and server actions during
 * development.
 */
export const cloudflareDevProxyVitePlugin = <Env, Cf extends CfProperties>(
  options: {
    getLoadContext?: GetLoadContext<Env, Cf>;
  } & GetPlatformProxyOptions = {}
): Plugin => {
  let { getLoadContext, ...restOptions } = options;

  return {
    name: PLUGIN_NAME,
    config: async () => {
      await preloadVite();
      const vite = getVite();
      // This is a compatibility layer for Vite 5. Default conditions were
      // automatically added to any custom conditions in Vite 5, but Vite 6
      // removed this behavior. Instead, the default conditions are overridden
      // by any custom conditions. If we wish to retain the default
      // conditions, we need to manually merge them using the provided default
      // conditions arrays exported from Vite. In Vite 5, these default
      // conditions arrays do not exist.
      // https://vite.dev/guide/migration.html#default-value-for-resolve-conditions
      const serverConditions: string[] = [
        ...(vite.defaultServerConditions ?? []),
      ];

      return {
        ssr: {
          resolve: {
            externalConditions: ["workerd", "worker", ...serverConditions],
          },
        },
      };
    },
    configResolved: (viteConfig) => {
      let pluginIndex = (name: string) =>
        viteConfig.plugins.findIndex((plugin) => plugin.name === name);
      let reactRouterPluginIndex = pluginIndex("react-router");
      if (
        reactRouterPluginIndex >= 0 &&
        reactRouterPluginIndex < pluginIndex(PLUGIN_NAME)
      ) {
        throw new Error(
          `The "${PLUGIN_NAME}" plugin should be placed before the React Router plugin in your Vite config file`
        );
      }
    },
    configureServer: async (viteDevServer) => {
      let { getPlatformProxy } = await importWrangler();
      // Do not include `dispose` in Cloudflare context
      let { dispose, ...cloudflare } = await getPlatformProxy<Env, Cf>(
        restOptions
      );
      let context = { cloudflare };
      return () => {
        if (!viteDevServer.config.server.middlewareMode) {
          viteDevServer.middlewares.use(async (nodeReq, nodeRes, next) => {
            try {
              let build = (await viteDevServer.ssrLoadModule(
                serverBuildId
              )) as ServerBuild;

              const { createRequestHandler } =
                (await viteDevServer.ssrLoadModule(
                  virtual.reactRouterReexport.id
                )) as typeof rr;
              let handler = createRequestHandler(build, "development");
              let req = fromNodeRequest(nodeReq, nodeRes);
              let loadContext = getLoadContext
                ? await getLoadContext({ request: req, context })
                : context;
              let res = await handler(req, loadContext);
              await toNodeRequest(res, nodeRes);
            } catch (error) {
              next(error);
            }
          });
        }
      };
    },
  };
};
