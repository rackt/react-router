import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  unstable_RouterContextProvider,
} from "../router/utils";
import type {
  AssetsManifest,
  CriticalCss,
  EntryContext,
  FutureConfig,
} from "../dom/ssr/entry";
import type { ServerRouteManifest } from "./routes";
import type { AppLoadContext } from "./data";
import type { MiddlewareEnabled } from "../types/future";

type OptionalCriticalCss = CriticalCss | undefined;

/**
 * The output of the compiler for the server build.
 */
export interface ServerBuild {
  entry: {
    module: ServerEntryModule;
  };
  routes: ServerRouteManifest;
  assets: AssetsManifest;
  basename?: string;
  publicPath: string;
  assetsBuildDirectory: string;
  future: FutureConfig;
  ssr: boolean;
  unstable_getCriticalCss?: (args: {
    pathname: string;
  }) => OptionalCriticalCss | Promise<OptionalCriticalCss>;
  /**
   * @deprecated This is now done via a custom header during prerendering
   */
  isSpaMode: boolean;
  prerender: string[];
}

export interface HandleDocumentRequestFunction {
  (
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    context: EntryContext,
    loadContext: MiddlewareEnabled extends true
      ? unstable_RouterContextProvider
      : AppLoadContext
  ): Promise<Response> | Response;
}

export interface HandleDataRequestFunction {
  (response: Response, args: LoaderFunctionArgs | ActionFunctionArgs):
    | Promise<Response>
    | Response;
}

export interface HandleErrorFunction {
  (error: unknown, args: LoaderFunctionArgs | ActionFunctionArgs): void;
}

/**
 * A module that serves as the entry point for a Remix app during server
 * rendering.
 */
export interface ServerEntryModule {
  default: HandleDocumentRequestFunction;
  handleDataRequest?: HandleDataRequestFunction;
  handleError?: HandleErrorFunction;
  streamTimeout?: number;
}
