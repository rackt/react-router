import type { HydrationState, Router as RemixRouter } from "../router";

import type { ViewTransition } from "./lib";
import type {
  AssetsManifest,
  FutureConfig as RemixFutureConfig,
} from "./ssr/entry";
import type { RouteModules } from "./ssr/routeModules";

export type WindowRemixContext = {
  url: string;
  basename?: string;
  state: HydrationState;
  criticalCss?: string;
  future: RemixFutureConfig;
  isSpaMode: boolean;
  stream: ReadableStream<Uint8Array> | undefined;
  streamController: ReadableStreamDefaultController<Uint8Array>;
  streamAction?: ReadableStream<Uint8Array> | undefined;
  streamControllerAction?: ReadableStreamDefaultController<Uint8Array>;
  // The number of active deferred keys rendered on the server
  a?: number;
  dev?: {
    port?: number;
    hmrRuntime?: string;
  };
};

declare global {
  // TODO: v7 - Can this go away in favor of "just use remix"?
  var __staticRouterHydrationData: HydrationState | undefined;
  // v6 SPA info
  var __reactRouterVersion: string;
  interface Document {
    startViewTransition(cb: () => Promise<void> | void): ViewTransition;
  }
  // TODO: v7 - Once this is all working, rename these global variables to __reactRouter*
  var __remixContext: WindowRemixContext | undefined;
  var __remixManifest: AssetsManifest | undefined;
  var __remixRouteModules: RouteModules | undefined;
  var __remixRouter: RemixRouter | undefined;
  var __remixRevalidation: number | undefined;
  var __remixClearCriticalCss: (() => void) | undefined;
  var $RefreshRuntime$:
    | {
        performReactRefresh: () => void;
      }
    | undefined;
}

// https://stackoverflow.com/a/59499895
export {};
