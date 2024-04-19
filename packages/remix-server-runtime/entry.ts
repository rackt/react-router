import type { StaticHandlerContext } from "@remix-run/router";

import type { SerializedError } from "./errors";
import type { RouteManifest, ServerRouteManifest, EntryRoute } from "./routes";
import type { RouteModules, EntryRouteModule } from "./routeModules";

export interface EntryContext {
  manifest: AssetsManifest;
  routeModules: RouteModules<EntryRouteModule>;
  criticalCss?: string;
  serverHandoffString?: string;
  serverHandoffStream?: ReadableStream<Uint8Array>;
  serverHandoffActionId?: string;
  serverHandoffStreamAction?: ReadableStream<Uint8Array>;
  renderMeta?: {
    didRenderScripts?: boolean;
    streamCache?: Record<
      number,
      Promise<void> & {
        result?: {
          done: boolean;
          value: string;
        };
        error?: unknown;
      }
    >;
  };
  staticHandlerContext: StaticHandlerContext;
  future: FutureConfig;
  isSpaMode: boolean;
  serializeError(error: Error): SerializedError;
}

export interface FutureConfig {
  v3_fetcherPersist: boolean;
  v3_relativeSplatPath: boolean;
  v3_throwAbortReason: boolean;
  unstable_serverComponents: boolean;
  unstable_singleFetch: boolean;
}

export interface AssetsManifest {
  entry: {
    imports: string[];
    module: string;
  };
  routes: RouteManifest<EntryRoute>;
  url: string;
  version: string;
  hmrRuntime?: string;
}

export function createEntryRouteModules(
  manifest: ServerRouteManifest
): RouteModules<EntryRouteModule> {
  return Object.keys(manifest).reduce((memo, routeId) => {
    memo[routeId] = manifest[routeId].module;
    return memo;
  }, {} as RouteModules<EntryRouteModule>);
}
