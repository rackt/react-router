import type { HydrationState, Router as DataRouter } from "../router/router";
import type { AssetsManifest, CriticalCss, FutureConfig } from "./ssr/entry";
import type { RouteModules } from "./ssr/routeModules";

export type WindowReactRouterContext = {
  basename?: string;
  state: HydrationState;
  criticalCss?: CriticalCss;
  future: FutureConfig;
  ssr: boolean;
  isSpaMode: boolean;
  stream: ReadableStream<Uint8Array> | undefined;
  streamController: ReadableStreamDefaultController<Uint8Array>;
  // The number of active deferred keys rendered on the server
  a?: number;
  dev?: {
    port?: number;
    hmrRuntime?: string;
  };
};

export interface ViewTransition {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition(): void;
}

export type ViewTransitionOptions =
  | boolean
  | {
      /**
       * An array of transition type strings (e.g. "slide", "forwards", "backwards")
       * that will be applied to the navigation.
       */
      types?: string[];
    };

declare global {
  // TODO: v7 - Can this go away in favor of "just use remix"?
  var __staticRouterHydrationData: HydrationState | undefined;
  // v6 SPA info
  var __reactRouterVersion: string;
  interface Document {
    startViewTransition(cb: () => Promise<void> | void): ViewTransition;
    startViewTransition(options: {
      update: () => Promise<void> | void;
      types: string[];
    }): ViewTransition;
  }
  var __reactRouterContext: WindowReactRouterContext | undefined;
  var __reactRouterManifest: AssetsManifest | undefined;
  var __reactRouterRouteModules: RouteModules | undefined;
  var __reactRouterDataRouter: DataRouter | undefined;
  var __reactRouterHdrActive: boolean;
  var __reactRouterClearCriticalCss: (() => void) | undefined;
  var $RefreshRuntime$:
    | {
        performReactRefresh: () => void;
      }
    | undefined;
}

// https://stackoverflow.com/a/59499895
export {};
