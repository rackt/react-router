import type { ActionFunctionArgs, LoaderFunctionArgs } from "./routeModules";
import type { AssetsManifest, EntryContext, FutureConfig } from "./entry";
import type { ServerRouteManifest } from "./routes";
import type { AppLoadContext } from "./data";

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
  isSpaMode: boolean;
}

export interface HandleDocumentRequestFunction {
  (
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    context: EntryContext,
    loadContext: AppLoadContext
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
  createFromReadableStream?: CreateFromReadableStreamFunction;
}

export interface RenderToReadableStreamFunction {
  (data: unknown): ReadableStream<Uint8Array>;
}

export interface CreateFromReadableStreamFunction {
  (body: ReadableStream<Uint8Array>): Promise<unknown>;
}

export interface ReactServerEntryModule {
  renderToReadableStream: RenderToReadableStreamFunction;
  decodeAction: (
    formData: FormData
  ) => null | ((...args: unknown[]) => Promise<unknown>);
  decodeFormState: (returnValue: unknown, formData: FormData) => unknown;
  decodeReply: (formData: FormData) => Promise<unknown[]>;
}

export interface ReactServerBuild {
  entry: {
    module: ReactServerEntryModule;
  };
  routes: ServerRouteManifest;
  future: FutureConfig;
  basename: string;
  serverReferences: Record<string, () => Promise<Record<string, unknown>>>;
}
