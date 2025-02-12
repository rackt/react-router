import prettier from "prettier";

import type {
  ActionFunction,
  HandleErrorFunction,
  HeadersFunction,
  LoaderFunction,
} from "../../lib/server-runtime";
import type { FutureConfig } from "../../lib/server-runtime/entry";
import type {
  EntryRoute,
  ServerRoute,
  ServerRouteManifest,
} from "../../lib/server-runtime/routes";

export function mockServerBuild(
  routes: Record<
    string,
    {
      parentId?: string;
      index?: true;
      path?: string;
      default?: any;
      ErrorBoundary?: any;
      action?: ActionFunction;
      headers?: HeadersFunction;
      loader?: LoaderFunction;
    }
  >,
  opts: {
    future?: Partial<FutureConfig>;
    handleError?: HandleErrorFunction;
  } = {}
) {
  return {
    future: {
      ...opts.future,
    },
    prerender: [],
    assets: {
      entry: {
        imports: [""],
        module: "",
      },
      routes: Object.entries(routes).reduce((p, [id, config]) => {
        let route: EntryRoute = {
          hasAction: !!config.action,
          hasErrorBoundary: !!config.ErrorBoundary,
          hasLoader: !!config.loader,
          id,
          module: "",
          index: config.index,
          path: config.path,
          parentId: config.parentId,
        };
        return {
          ...p,
          [id]: route,
        };
      }, {}),
      url: "",
      version: "",
    },
    entry: {
      module: {
        default: jest.fn(
          async (
            request,
            responseStatusCode,
            responseHeaders,
            entryContext,
            loadContext
          ) =>
            new Response(null, {
              status: responseStatusCode,
              headers: responseHeaders,
            })
        ),
        handleDataRequest: jest.fn(async (response) => response),
        handleError: opts.handleError,
      },
    },
    routes: Object.entries(routes).reduce<ServerRouteManifest>(
      (p, [id, config]) => {
        let route: Omit<ServerRoute, "children"> = {
          id,
          index: config.index,
          path: config.path,
          parentId: config.parentId,
          module: {
            default: config.default,
            ErrorBoundary: config.ErrorBoundary,
            action: config.action,
            headers: config.headers,
            loader: config.loader,
          },
        };
        return {
          ...p,
          [id]: route,
        };
      },
      {}
    ),
  };
}

export function prettyHtml(source: string): string {
  return prettier.format(source, { parser: "html" });
}

export function isEqual<A, B>(
  arg: A extends B ? (B extends A ? true : false) : false
): void {}
