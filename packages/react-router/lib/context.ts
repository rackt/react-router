import * as React from "react";
import type {
  History,
  Action as NavigationType,
  Location,
  To,
} from "./router/history";
import type {
  RelativeRoutingType,
  Router,
  StaticHandlerContext,
} from "./router/router";
import type {
  AgnosticIndexRouteObject,
  AgnosticNonIndexRouteObject,
  AgnosticPatchRoutesOnNavigationFunction,
  AgnosticPatchRoutesOnNavigationFunctionArgs,
  AgnosticRouteMatch,
  LazyRouteFunction,
  TrackedPromise,
} from "./router/utils";
import type { ViewTransitionOptions } from "./dom/global";

// Create react-specific types from the agnostic types in @remix-run/router to
// export from react-router
export interface IndexRouteObject {
  caseSensitive?: AgnosticIndexRouteObject["caseSensitive"];
  path?: AgnosticIndexRouteObject["path"];
  id?: AgnosticIndexRouteObject["id"];
  unstable_middleware?: AgnosticIndexRouteObject["unstable_middleware"];
  loader?: AgnosticIndexRouteObject["loader"];
  action?: AgnosticIndexRouteObject["action"];
  hasErrorBoundary?: AgnosticIndexRouteObject["hasErrorBoundary"];
  shouldRevalidate?: AgnosticIndexRouteObject["shouldRevalidate"];
  handle?: AgnosticIndexRouteObject["handle"];
  index: true;
  children?: undefined;
  element?: React.ReactNode | null;
  hydrateFallbackElement?: React.ReactNode | null;
  errorElement?: React.ReactNode | null;
  Component?: React.ComponentType | null;
  HydrateFallback?: React.ComponentType | null;
  ErrorBoundary?: React.ComponentType | null;
  lazy?: LazyRouteFunction<RouteObject>;
}

export interface NonIndexRouteObject {
  caseSensitive?: AgnosticNonIndexRouteObject["caseSensitive"];
  path?: AgnosticNonIndexRouteObject["path"];
  id?: AgnosticNonIndexRouteObject["id"];
  unstable_middleware?: AgnosticNonIndexRouteObject["unstable_middleware"];
  loader?: AgnosticNonIndexRouteObject["loader"];
  action?: AgnosticNonIndexRouteObject["action"];
  hasErrorBoundary?: AgnosticNonIndexRouteObject["hasErrorBoundary"];
  shouldRevalidate?: AgnosticNonIndexRouteObject["shouldRevalidate"];
  handle?: AgnosticNonIndexRouteObject["handle"];
  index?: false;
  children?: RouteObject[];
  element?: React.ReactNode | null;
  hydrateFallbackElement?: React.ReactNode | null;
  errorElement?: React.ReactNode | null;
  Component?: React.ComponentType | null;
  HydrateFallback?: React.ComponentType | null;
  ErrorBoundary?: React.ComponentType | null;
  lazy?: LazyRouteFunction<RouteObject>;
}

export type RouteObject = IndexRouteObject | NonIndexRouteObject;

export type DataRouteObject = RouteObject & {
  children?: DataRouteObject[];
  id: string;
};

export interface RouteMatch<
  ParamKey extends string = string,
  RouteObjectType extends RouteObject = RouteObject
> extends AgnosticRouteMatch<ParamKey, RouteObjectType> {}

export interface DataRouteMatch extends RouteMatch<string, DataRouteObject> {}

export type PatchRoutesOnNavigationFunctionArgs =
  AgnosticPatchRoutesOnNavigationFunctionArgs<RouteObject, RouteMatch>;

export type PatchRoutesOnNavigationFunction =
  AgnosticPatchRoutesOnNavigationFunction<RouteObject, RouteMatch>;

export interface DataRouterContextObject
  // Omit `future` since those can be pulled from the `router`
  // `NavigationContext` needs future since it doesn't have a `router` in all cases
  extends Omit<NavigationContextObject, "future"> {
  router: Router;
  staticContext?: StaticHandlerContext;
}

export const DataRouterContext =
  React.createContext<DataRouterContextObject | null>(null);
DataRouterContext.displayName = "DataRouter";

export const DataRouterStateContext = React.createContext<
  Router["state"] | null
>(null);
DataRouterStateContext.displayName = "DataRouterState";

export type ViewTransitionContextObject =
  | {
      isTransitioning: false;
    }
  | {
      isTransitioning: true;
      flushSync: boolean;
      currentLocation: Location;
      nextLocation: Location;
      viewTransitionTypes?: string[];
    };

export const ViewTransitionContext =
  React.createContext<ViewTransitionContextObject>({
    isTransitioning: false,
  });
ViewTransitionContext.displayName = "ViewTransition";

// TODO: (v7) Change the useFetcher data from `any` to `unknown`
export type FetchersContextObject = Map<string, any>;

export const FetchersContext = React.createContext<FetchersContextObject>(
  new Map()
);
FetchersContext.displayName = "Fetchers";

export const AwaitContext = React.createContext<TrackedPromise | null>(null);
AwaitContext.displayName = "Await";

export interface NavigateOptions {
  /** Replace the current entry in the history stack instead of pushing a new one */
  replace?: boolean;
  /** Adds persistent client side routing state to the next location */
  state?: any;
  /** If you are using {@link https://api.reactrouter.com/v7/functions/react_router.ScrollRestoration.html <ScrollRestoration>}, prevent the scroll position from being reset to the top of the window when navigating */
  preventScrollReset?: boolean;
  /** Defines the relative path behavior for the link. "route" will use the route hierarchy so ".." will remove all URL segments of the current route pattern while "path" will use the URL path so ".." will remove one URL segment. */
  relative?: RelativeRoutingType;
  /** Wraps the initial state update for this navigation in a {@link https://react.dev/reference/react-dom/flushSync ReactDOM.flushSync} call instead of the default {@link https://react.dev/reference/react/startTransition React.startTransition} */
  flushSync?: boolean;
  /**
   * Enables a {@link https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API View Transition} for this navigation by wrapping the final state update in `document.startViewTransition()`.
   * If you need to apply specific styles for this view transition, you will also need to leverage the {@link https://api.reactrouter.com/v7/functions/react_router.useViewTransitionState.html useViewTransitionState()} hook.
   */
  viewTransition?: ViewTransitionOptions;
}

/**
 * A Navigator is a "location changer"; it's how you get to different locations.
 *
 * Every history instance conforms to the Navigator interface, but the
 * distinction is useful primarily when it comes to the low-level `<Router>` API
 * where both the location and a navigator must be provided separately in order
 * to avoid "tearing" that may occur in a suspense-enabled app if the action
 * and/or location were to be read directly from the history instance.
 */
export interface Navigator {
  createHref: History["createHref"];
  // Optional for backwards-compat with Router/HistoryRouter usage (edge case)
  encodeLocation?: History["encodeLocation"];
  go: History["go"];
  push(to: To, state?: any, opts?: NavigateOptions): void;
  replace(to: To, state?: any, opts?: NavigateOptions): void;
}

interface NavigationContextObject {
  basename: string;
  navigator: Navigator;
  static: boolean;
  // TODO: Re-introduce a singular `FutureConfig` once we land our first
  // future.unstable_ or future.v8_ flag
  future: {};
}

export const NavigationContext = React.createContext<NavigationContextObject>(
  null!
);
NavigationContext.displayName = "Navigation";

interface LocationContextObject {
  location: Location;
  navigationType: NavigationType;
}

export const LocationContext = React.createContext<LocationContextObject>(
  null!
);
LocationContext.displayName = "Location";

export interface RouteContextObject {
  outlet: React.ReactElement | null;
  matches: RouteMatch[];
  isDataRoute: boolean;
}

export const RouteContext = React.createContext<RouteContextObject>({
  outlet: null,
  matches: [],
  isDataRoute: false,
});
RouteContext.displayName = "Route";

export const RouteErrorContext = React.createContext<any>(null);
RouteErrorContext.displayName = "RouteError";
