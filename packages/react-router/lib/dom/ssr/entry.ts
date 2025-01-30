import type { StaticHandlerContext } from "../../router/router";

import type { EntryRoute } from "./routes";
import type { LoadRouteModuleFunction, RouteModules } from "./routeModules";
import type { RouteManifest } from "../../router/utils";

type SerializedError = {
  message: string;
  stack?: string;
};

// Object passed to RemixContext.Provider
export interface FrameworkContextObject {
  manifest: AssetsManifest;
  routeModules: RouteModules;
  criticalCss?: string;
  serverHandoffString?: string;
  future: FutureConfig;
  isSpaMode: boolean;
  loadRouteModule: LoadRouteModuleFunction;
  serializeError?(error: Error): SerializedError;
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
}

// Additional React-Router information needed at runtime, but not hydrated
// through RemixContext
export interface EntryContext extends FrameworkContextObject {
  staticHandlerContext: StaticHandlerContext;
  serverHandoffStream?: ReadableStream<Uint8Array>;
}

export interface FutureConfig {}

export interface AssetsManifest {
  entry: {
    imports: string[];
    module: string;
  };
  routes: RouteManifest<EntryRoute>;
  url: string;
  version: string;
  hmr?: {
    timestamp?: number;
    runtime: string;
  };
}
