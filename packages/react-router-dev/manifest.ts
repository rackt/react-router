export type ManifestRoute = {
  id: string;
  parentId?: string;
  path?: string;
  index?: boolean;
  caseSensitive?: boolean;
  module: string;
  clientLoaderModule: string | undefined;
  clientActionModule: string | undefined;
  clientMiddlewareModule: string | undefined;
  hydrateFallbackModule: string | undefined;
  imports?: string[];
  hasAction: boolean;
  hasLoader: boolean;
  hasClientAction: boolean;
  hasClientLoader: boolean;
  hasClientMiddleware: boolean;
  hasErrorBoundary: boolean;
};

export type Manifest = {
  version: string;
  url?: string;
  entry: {
    module: string;
    imports: string[];
  };
  routes: {
    [routeId: string]: ManifestRoute;
  };
  hmr?: {
    timestamp?: number;
    runtime: string;
  };
};
