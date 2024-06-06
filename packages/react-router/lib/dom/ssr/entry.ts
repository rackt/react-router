import type { StaticHandlerContext } from "../../router";

import type { RouteManifest, EntryRoute } from "./routes";
import type { RouteModules } from "./routeModules";

// Object passed to RemixContext.Provider

type SerializedError = {
  message: string;
  stack?: string;
};
export interface RemixContextObject {
  manifest: AssetsManifest;
  routeModules: RouteModules;
  criticalCss?: string;
  serverHandoffString?: string;
  future: FutureConfig;
  isSpaMode: boolean;
  abortDelay?: number;
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
    streamCacheAction?: Record<
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
export interface EntryContext extends RemixContextObject {
  staticHandlerContext: StaticHandlerContext;
  serverHandoffStream?: ReadableStream<Uint8Array>;
  serverHandoffStreamAction?: ReadableStream<Uint8Array>;
}

export interface FutureConfig {
  v3_fetcherPersist: boolean;
  v3_relativeSplatPath: boolean;
  unstable_serverComponents: boolean;
}

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
