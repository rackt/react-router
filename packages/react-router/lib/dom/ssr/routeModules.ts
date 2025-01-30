import type { ComponentType, ReactElement } from "react";
import type { Location } from "../../router/history";
import type {
  ActionFunction,
  ActionFunctionArgs,
  LoaderFunction,
  LoaderFunctionArgs,
  Params,
  ShouldRevalidateFunction,
} from "../../router/utils";

import type { EntryRoute } from "./routes";
import type { DataRouteMatch } from "../../context";
import type { LinkDescriptor } from "../../router/links";
import type { SerializeFrom } from "../../types/route-data";

export interface RouteModules {
  [routeId: string]: RouteModule | undefined;
}

/**
 * The shape of a route module shipped to the client
 */
export interface RouteModule {
  clientAction?: ClientActionFunction;
  clientLoader?: ClientLoaderFunction;
  ErrorBoundary?: ErrorBoundaryComponent;
  HydrateFallback?: HydrateFallbackComponent;
  Layout?: LayoutComponent;
  default: RouteComponent;
  handle?: RouteHandle;
  links?: LinksFunction;
  meta?: MetaFunction;
  shouldRevalidate?: ShouldRevalidateFunction;
}

/**
 * The shape of a route module on the server
 */
export interface ServerRouteModule extends RouteModule {
  action?: ActionFunction;
  headers?: HeadersFunction | { [name: string]: string };
  loader?: LoaderFunction;
}

/**
 * A function that handles data mutations for a route on the client
 */
export type ClientActionFunction = (
  args: ClientActionFunctionArgs
) => ReturnType<ActionFunction>;

/**
 * Arguments passed to a route `clientAction` function
 */
export type ClientActionFunctionArgs = ActionFunctionArgs<undefined> & {
  serverAction: <T = unknown>() => Promise<SerializeFrom<T>>;
};

/**
 * A function that loads data for a route on the client
 */
export type ClientLoaderFunction = ((
  args: ClientLoaderFunctionArgs
) => ReturnType<LoaderFunction>) & {
  hydrate?: boolean;
};

/**
 * Arguments passed to a route `clientLoader` function
 */
export type ClientLoaderFunctionArgs = LoaderFunctionArgs<undefined> & {
  serverLoader: <T = unknown>() => Promise<SerializeFrom<T>>;
};

/**
 * ErrorBoundary to display for this route
 */
export type ErrorBoundaryComponent = ComponentType;

export type HeadersArgs = {
  loaderHeaders: Headers;
  parentHeaders: Headers;
  actionHeaders: Headers;
  errorHeaders: Headers | undefined;
};

/**
 * A function that returns HTTP headers to be used for a route. These headers
 * will be merged with (and take precedence over) headers from parent routes.
 */
export interface HeadersFunction {
  (args: HeadersArgs): Headers | HeadersInit;
}

/**
 * `<Route HydrateFallback>` component to render on initial loads
 * when client loaders are present
 */
export type HydrateFallbackComponent = ComponentType;

/**
 * Optional, root-only `<Route Layout>` component to wrap the root content in.
 * Useful for defining the <html>/<head>/<body> document shell shared by the
 * Component, HydrateFallback, and ErrorBoundary
 */
export type LayoutComponent = ComponentType<{
  children: ReactElement<
    unknown,
    ErrorBoundaryComponent | HydrateFallbackComponent | RouteComponent
  >;
}>;

/**
 * A function that defines `<link>` tags to be inserted into the `<head>` of
 * the document on route transitions.
 *
 * @see https://remix.run/route/meta
 */
export interface LinksFunction {
  (): LinkDescriptor[];
}

export interface MetaMatch<
  RouteId extends string = string,
  Loader extends LoaderFunction | ClientLoaderFunction | unknown = unknown
> {
  id: RouteId;
  pathname: DataRouteMatch["pathname"];
  data: Loader extends LoaderFunction | ClientLoaderFunction
    ? SerializeFrom<Loader>
    : unknown;
  handle?: RouteHandle;
  params: DataRouteMatch["params"];
  meta: MetaDescriptor[];
  error?: unknown;
}

export type MetaMatches<
  MatchLoaders extends Record<
    string,
    LoaderFunction | ClientLoaderFunction | unknown
  > = Record<string, unknown>
> = Array<
  {
    [K in keyof MatchLoaders]: MetaMatch<
      Exclude<K, number | symbol>,
      MatchLoaders[K]
    >;
  }[keyof MatchLoaders]
>;

export interface MetaArgs<
  Loader extends LoaderFunction | ClientLoaderFunction | unknown = unknown,
  MatchLoaders extends Record<
    string,
    LoaderFunction | ClientLoaderFunction | unknown
  > = Record<string, unknown>
> {
  data:
    | (Loader extends LoaderFunction | ClientLoaderFunction
        ? SerializeFrom<Loader>
        : unknown)
    | undefined;
  params: Params;
  location: Location;
  matches: MetaMatches<MatchLoaders>;
  error?: unknown;
}

/**
 * A function that returns an array of data objects to use for rendering
 * metadata HTML tags in a route. These tags are not rendered on descendant
 * routes in the route hierarchy. In other words, they will only be rendered on
 * the route in which they are exported.
 *
 * @param Loader - The type of the current route's loader function
 * @param MatchLoaders - Mapping from a parent route's filepath to its loader
 * function type
 *
 * Note that parent route filepaths are relative to the `app/` directory.
 *
 * For example, if this meta function is for `/sales/customers/$customerId`:
 *
 * ```ts
 * // app/root.tsx
 * const loader = () => ({ hello: "world" })
 * export type Loader = typeof loader
 *
 * // app/routes/sales.tsx
 * const loader = () => ({ salesCount: 1074 })
 * export type Loader = typeof loader
 *
 * // app/routes/sales/customers.tsx
 * const loader = () => ({ customerCount: 74 })
 * export type Loader = typeof loader
 *
 * // app/routes/sales/customers/$customersId.tsx
 * import type { Loader as RootLoader } from "../../../root"
 * import type { Loader as SalesLoader } from "../../sales"
 * import type { Loader as CustomersLoader } from "../../sales/customers"
 *
 * const loader = () => ({ name: "Customer name" })
 *
 * const meta: MetaFunction<typeof loader, {
 *  "root": RootLoader,
 *  "routes/sales": SalesLoader,
 *  "routes/sales/customers": CustomersLoader,
 * }> = ({ data, matches }) => {
 *   const { name } = data
 *   //      ^? string
 *   const { customerCount } = matches.find((match) => match.id === "routes/sales/customers").data
 *   //      ^? number
 *   const { salesCount } = matches.find((match) => match.id === "routes/sales").data
 *   //      ^? number
 *   const { hello } = matches.find((match) => match.id === "root").data
 *   //      ^? "world"
 * }
 * ```
 */
export interface MetaFunction<
  Loader extends LoaderFunction | ClientLoaderFunction | unknown = unknown,
  MatchLoaders extends Record<
    string,
    LoaderFunction | ClientLoaderFunction | unknown
  > = Record<string, unknown>
> {
  (args: MetaArgs<Loader, MatchLoaders>): MetaDescriptor[] | undefined;
}

export type MetaDescriptor =
  | { charSet: "utf-8" }
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }
  | { httpEquiv: string; content: string }
  | { "script:ld+json": LdJsonObject }
  | { tagName: "meta" | "link"; [name: string]: string }
  | { [name: string]: unknown };

type LdJsonObject = { [Key in string]: LdJsonValue } & {
  [Key in string]?: LdJsonValue | undefined;
};
type LdJsonArray = LdJsonValue[] | readonly LdJsonValue[];
type LdJsonPrimitive = string | number | boolean | null;
type LdJsonValue = LdJsonPrimitive | LdJsonObject | LdJsonArray;

/**
 * A React component that is rendered for a route.
 */
export type RouteComponent = ComponentType<{}>;

/**
 * An arbitrary object that is associated with a route.
 *
 * @see https://remix.run/route/handle
 */
export type RouteHandle = unknown;

export type LoadRouteModuleFunction = (
  route: EntryRoute,
  routeModulesCache: RouteModules
) => Promise<RouteModule>;

export const defaultLoadRouteModule: LoadRouteModuleFunction = async (
  route,
  routeModulesCache
) => {
  if (route.id in routeModulesCache) {
    return routeModulesCache[route.id] as RouteModule;
  }

  try {
    let routeModule = await import(
      /* @vite-ignore */
      /* webpackIgnore: true */
      route.module
    );
    routeModulesCache[route.id] = routeModule;
    return routeModule;
  } catch (error: unknown) {
    // If we can't load the route it's likely one of 2 things:
    // - User got caught in the middle of a deploy and the CDN no longer has the
    //   asset we're trying to import! Reload from the server and the user
    //   (should) get the new manifest--unless the developer purged the static
    //   assets, the manifest path, but not the documents 😬
    // - Or, the asset trying to be imported has an error (usually in vite dev
    //   mode), so the best we can do here is log the error for visibility
    //   (via `Preserve log`) and reload

    // Log the error so it can be accessed via the `Preserve Log` setting
    console.error(
      `Error loading route module \`${route.module}\`, reloading page...`
    );
    console.error(error);

    if (
      window.__reactRouterContext &&
      window.__reactRouterContext.isSpaMode &&
      // @ts-expect-error
      import.meta.hot
    ) {
      // In SPA Mode (which implies vite) we don't want to perform a hard reload
      // on dev-time errors since it's a vite compilation error and a reload is
      // just going to fail with the same issue.  Let the UI bubble to the error
      // boundary and let them see the error in the overlay or the dev server log
      throw error;
    }

    window.location.reload();

    return new Promise(() => {
      // check out of this hook cause the DJs never gonna re[s]olve this
    });
  }
};
