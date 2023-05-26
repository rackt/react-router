import type { History, Location, Path, To } from "./history";
import {
  Action as HistoryAction,
  createLocation,
  createPath,
  invariant,
  parsePath,
  warning,
} from "./history";
import type {
  DataResult,
  DeferredData,
  AgnosticDataRouteMatch,
  AgnosticDataRouteObject,
  DeferredResult,
  ErrorResult,
  FormEncType,
  FormMethod,
  DetectErrorBoundaryFunction,
  RedirectResult,
  RouteData,
  AgnosticRouteObject,
  Submission,
  SuccessResult,
  AgnosticRouteMatch,
  ShouldRevalidateFunction,
  RouteManifest,
  ImmutableRouteKey,
  ActionFunction,
  LoaderFunction,
  V7_MutationFormMethod,
  V7_FormMethod,
  HTMLFormMethod,
  MutationFormMethod,
  MapRoutePropertiesFunction,
} from "./utils";
import {
  ErrorResponse,
  ResultType,
  convertRoutesToDataRoutes,
  getPathContributingMatches,
  immutableRouteKeys,
  isRouteErrorResponse,
  joinPaths,
  matchRoutes,
  resolveTo,
  stripBasename,
} from "./utils";

////////////////////////////////////////////////////////////////////////////////
//#region Types and Constants
////////////////////////////////////////////////////////////////////////////////

/**
 * A Router instance manages all navigation and data loading/mutations
 */
export interface Router {
  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Return the basename for the router
   */
  get basename(): RouterInit["basename"];

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Return the current state of the router
   */
  get state(): RouterState;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Return the routes for this router instance
   */
  get routes(): AgnosticDataRouteObject[];

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Initialize the router, including adding history listeners and kicking off
   * initial data fetches.  Returns a function to cleanup listeners and abort
   * any in-progress loads
   */
  initialize(): Router;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Subscribe to router.state updates
   *
   * @param fn function to call with the new state
   */
  subscribe(fn: RouterSubscriber): () => void;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Enable scroll restoration behavior in the router
   *
   * @param savedScrollPositions Object that will manage positions, in case
   *                             it's being restored from sessionStorage
   * @param getScrollPosition    Function to get the active Y scroll position
   * @param getKey               Function to get the key to use for restoration
   */
  enableScrollRestoration(
    savedScrollPositions: Record<string, number>,
    getScrollPosition: GetScrollPositionFunction,
    getKey?: GetScrollRestorationKeyFunction
  ): () => void;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Navigate forward/backward in the history stack
   * @param to Delta to move in the history stack
   */
  navigate(to: number): Promise<void>;

  /**
   * Navigate to the given path
   * @param to Path to navigate to
   * @param opts Navigation options (method, submission, etc.)
   */
  navigate(to: To | null, opts?: RouterNavigateOptions): Promise<void>;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Trigger a fetcher load/submission
   *
   * @param key     Fetcher key
   * @param routeId Route that owns the fetcher
   * @param href    href to fetch
   * @param opts    Fetcher options, (method, submission, etc.)
   */
  fetch(
    key: string,
    routeId: string,
    href: string | null,
    opts?: RouterNavigateOptions
  ): void;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Trigger a revalidation of all current route loaders and fetcher loads
   */
  revalidate(): void;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Utility function to create an href for the given location
   * @param location
   */
  createHref(location: Location | URL): string;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Utility function to URL encode a destination path according to the internal
   * history implementation
   * @param to
   */
  encodeLocation(to: To): Path;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Get/create a fetcher for the given key
   * @param key
   */
  getFetcher<TData = any>(key?: string): Fetcher<TData>;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Delete the fetcher for a given key
   * @param key
   */
  deleteFetcher(key?: string): void;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Cleanup listeners and abort any in-progress loads
   */
  dispose(): void;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Get a navigation blocker
   * @param key The identifier for the blocker
   * @param fn The blocker function implementation
   */
  getBlocker(key: string, fn: BlockerFunction): Blocker;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Delete a navigation blocker
   * @param key The identifier for the blocker
   */
  deleteBlocker(key: string): void;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * HMR needs to pass in-flight route updates to React Router
   * TODO: Replace this with granular route update APIs (addRoute, updateRoute, deleteRoute)
   */
  _internalSetRoutes(routes: AgnosticRouteObject[]): void;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Internal fetch AbortControllers accessed by unit tests
   */
  _internalFetchControllers: Map<string, AbortController>;

  /**
   * @internal
   * PRIVATE - DO NOT USE
   *
   * Internal pending DeferredData instances accessed by unit tests
   */
  _internalActiveDeferreds: Map<string, DeferredData>;
}

/**
 * State maintained internally by the router.  During a navigation, all states
 * reflect the the "old" location unless otherwise noted.
 */
export interface RouterState {
  /**
   * The action of the most recent navigation
   */
  historyAction: HistoryAction;

  /**
   * The current location reflected by the router
   */
  location: Location;

  /**
   * The current set of route matches
   */
  matches: AgnosticDataRouteMatch[];

  /**
   * Tracks whether we've completed our initial data load
   */
  initialized: boolean;

  /**
   * Current scroll position we should start at for a new view
   *  - number -> scroll position to restore to
   *  - false -> do not restore scroll at all (used during submissions)
   *  - null -> don't have a saved position, scroll to hash or top of page
   */
  restoreScrollPosition: number | false | null;

  /**
   * Indicate whether this navigation should skip resetting the scroll position
   * if we are unable to restore the scroll position
   */
  preventScrollReset: boolean;

  /**
   * Tracks the state of the current navigation
   */
  navigation: Navigation;

  /**
   * Tracks any in-progress revalidations
   */
  revalidation: RevalidationState;

  /**
   * Data from the loaders for the current matches
   */
  loaderData: RouteData;

  /**
   * Data from the action for the current matches
   */
  actionData: RouteData | null;

  /**
   * Errors caught from loaders for the current matches
   */
  errors: RouteData | null;

  /**
   * Map of current fetchers
   */
  fetchers: Map<string, Fetcher>;

  /**
   * Map of current blockers
   */
  blockers: Map<string, Blocker>;
}

/**
 * Data that can be passed into hydrate a Router from SSR
 */
export type HydrationState = Partial<
  Pick<RouterState, "loaderData" | "actionData" | "errors">
>;

/**
 * Future flags to toggle new feature behavior
 */
export interface FutureConfig {
  v7_normalizeFormMethod: boolean;
  v7_prependBasename: boolean;
}

/**
 * Initialization options for createRouter
 */
export interface RouterInit {
  routes: AgnosticRouteObject[];
  history: History;
  basename?: string;
  /**
   * @deprecated Use `mapRouteProperties` instead
   */
  detectErrorBoundary?: DetectErrorBoundaryFunction;
  mapRouteProperties?: MapRoutePropertiesFunction;
  future?: Partial<FutureConfig>;
  hydrationData?: HydrationState;
  window?: Window;
}

/**
 * State returned from a server-side query() call
 */
export interface StaticHandlerContext {
  basename: Router["basename"];
  location: RouterState["location"];
  matches: RouterState["matches"];
  loaderData: RouterState["loaderData"];
  actionData: RouterState["actionData"];
  errors: RouterState["errors"];
  statusCode: number;
  loaderHeaders: Record<string, Headers>;
  actionHeaders: Record<string, Headers>;
  activeDeferreds: Record<string, DeferredData> | null;
  _deepestRenderedBoundaryId?: string | null;
}

/**
 * A StaticHandler instance manages a singular SSR navigation/fetch event
 */
export interface StaticHandler {
  dataRoutes: AgnosticDataRouteObject[];
  query(
    request: Request,
    opts?: { requestContext?: unknown }
  ): Promise<StaticHandlerContext | Response>;
  queryRoute(
    request: Request,
    opts?: { routeId?: string; requestContext?: unknown }
  ): Promise<any>;
}

/**
 * Subscriber function signature for changes to router state
 */
export interface RouterSubscriber {
  (state: RouterState): void;
}

interface UseMatchesMatch {
  id: string;
  pathname: string;
  params: AgnosticRouteMatch["params"];
  data: unknown;
  handle: unknown;
}

/**
 * Function signature for determining the key to be used in scroll restoration
 * for a given location
 */
export interface GetScrollRestorationKeyFunction {
  (location: Location, matches: UseMatchesMatch[]): string | null;
}

/**
 * Function signature for determining the current scroll position
 */
export interface GetScrollPositionFunction {
  (): number;
}

export type RelativeRoutingType = "route" | "path";

type BaseNavigateOptions = {
  replace?: boolean;
  state?: any;
  preventScrollReset?: boolean;
  relative?: RelativeRoutingType;
  fromRouteId?: string;
};

/**
 * Options for a navigate() call for a Link navigation
 */
type LinkNavigateOptions = BaseNavigateOptions;

/**
 * Options for a navigate() call for a Form navigation
 */
type SubmissionNavigateOptions = BaseNavigateOptions & {
  formMethod?: HTMLFormMethod;
  formEncType?: FormEncType;
  formData: FormData;
};

/**
 * Options to pass to navigate() for either a Link or Form navigation
 */
export type RouterNavigateOptions =
  | LinkNavigateOptions
  | SubmissionNavigateOptions;

/**
 * Options to pass to fetch()
 */
export type RouterFetchOptions =
  | Omit<LinkNavigateOptions, "replace">
  | Omit<SubmissionNavigateOptions, "replace">;

/**
 * Potential states for state.navigation
 */
export type NavigationStates = {
  Idle: {
    state: "idle";
    location: undefined;
    formMethod: undefined;
    formAction: undefined;
    formEncType: undefined;
    formData: undefined;
  };
  Loading: {
    state: "loading";
    location: Location;
    formMethod: FormMethod | V7_FormMethod | undefined;
    formAction: string | undefined;
    formEncType: FormEncType | undefined;
    formData: FormData | undefined;
  };
  Submitting: {
    state: "submitting";
    location: Location;
    formMethod: FormMethod | V7_FormMethod;
    formAction: string;
    formEncType: FormEncType;
    formData: FormData;
  };
};

export type Navigation = NavigationStates[keyof NavigationStates];

export type RevalidationState = "idle" | "loading";

/**
 * Potential states for fetchers
 */
type FetcherStates<TData = any> = {
  Idle: {
    state: "idle";
    formMethod: undefined;
    formAction: undefined;
    formEncType: undefined;
    formData: undefined;
    data: TData | undefined;
    " _hasFetcherDoneAnything "?: boolean;
  };
  Loading: {
    state: "loading";
    formMethod: FormMethod | V7_FormMethod | undefined;
    formAction: string | undefined;
    formEncType: FormEncType | undefined;
    formData: FormData | undefined;
    data: TData | undefined;
    " _hasFetcherDoneAnything "?: boolean;
  };
  Submitting: {
    state: "submitting";
    formMethod: FormMethod | V7_FormMethod;
    formAction: string;
    formEncType: FormEncType;
    formData: FormData;
    data: TData | undefined;
    " _hasFetcherDoneAnything "?: boolean;
  };
};

export type Fetcher<TData = any> =
  FetcherStates<TData>[keyof FetcherStates<TData>];

interface BlockerBlocked {
  state: "blocked";
  reset(): void;
  proceed(): void;
  location: Location;
}

interface BlockerUnblocked {
  state: "unblocked";
  reset: undefined;
  proceed: undefined;
  location: undefined;
}

interface BlockerProceeding {
  state: "proceeding";
  reset: undefined;
  proceed: undefined;
  location: Location;
}

export type Blocker = BlockerUnblocked | BlockerBlocked | BlockerProceeding;

export type BlockerFunction = (args: {
  currentLocation: Location;
  nextLocation: Location;
  historyAction: HistoryAction;
}) => boolean;

interface ShortCircuitable {
  /**
   * startNavigation does not need to complete the navigation because we
   * redirected or got interrupted
   */
  shortCircuited?: boolean;
}

interface HandleActionResult extends ShortCircuitable {
  /**
   * Error thrown from the current action, keyed by the route containing the
   * error boundary to render the error.  To be committed to the state after
   * loaders have completed
   */
  pendingActionError?: RouteData;
  /**
   * Data returned from the current action, keyed by the route owning the action.
   * To be committed to the state after loaders have completed
   */
  pendingActionData?: RouteData;
}

interface HandleLoadersResult extends ShortCircuitable {
  /**
   * loaderData returned from the current set of loaders
   */
  loaderData?: RouterState["loaderData"];
  /**
   * errors thrown from the current set of loaders
   */
  errors?: RouterState["errors"];
}

/**
 * Cached info for active fetcher.load() instances so they can participate
 * in revalidation
 */
interface FetchLoadMatch {
  routeId: string;
  path: string;
}

/**
 * Identified fetcher.load() calls that need to be revalidated
 */
interface RevalidatingFetcher extends FetchLoadMatch {
  key: string;
  match: AgnosticDataRouteMatch | null;
  matches: AgnosticDataRouteMatch[] | null;
  controller: AbortController | null;
}

/**
 * Wrapper object to allow us to throw any response out from callLoaderOrAction
 * for queryRouter while preserving whether or not it was thrown or returned
 * from the loader/action
 */
interface QueryRouteResponse {
  type: ResultType.data | ResultType.error;
  response: Response;
}

const validMutationMethodsArr: MutationFormMethod[] = [
  "post",
  "put",
  "patch",
  "delete",
];
const validMutationMethods = new Set<MutationFormMethod>(
  validMutationMethodsArr
);

const validRequestMethodsArr: FormMethod[] = [
  "get",
  ...validMutationMethodsArr,
];
const validRequestMethods = new Set<FormMethod>(validRequestMethodsArr);

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);
const redirectPreserveMethodStatusCodes = new Set([307, 308]);

export const IDLE_NAVIGATION: NavigationStates["Idle"] = {
  state: "idle",
  location: undefined,
  formMethod: undefined,
  formAction: undefined,
  formEncType: undefined,
  formData: undefined,
};

export const IDLE_FETCHER: FetcherStates["Idle"] = {
  state: "idle",
  data: undefined,
  formMethod: undefined,
  formAction: undefined,
  formEncType: undefined,
  formData: undefined,
};

export const IDLE_BLOCKER: BlockerUnblocked = {
  state: "unblocked",
  proceed: undefined,
  reset: undefined,
  location: undefined,
};

const ABSOLUTE_URL_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const defaultMapRouteProperties: MapRoutePropertiesFunction = (route) => ({
  hasErrorBoundary: Boolean(route.hasErrorBoundary),
});

//#endregion

////////////////////////////////////////////////////////////////////////////////
//#region createRouter
////////////////////////////////////////////////////////////////////////////////

/**
 * Create a router and listen to history POP navigations
 */
export function createRouter(init: RouterInit): Router {
  const routerWindow = init.window
    ? init.window
    : typeof window !== "undefined"
    ? window
    : undefined;
  const isBrowser =
    typeof routerWindow !== "undefined" &&
    typeof routerWindow.document !== "undefined" &&
    typeof routerWindow.document.createElement !== "undefined";
  const isServer = !isBrowser;

  invariant(
    init.routes.length > 0,
    "You must provide a non-empty routes array to createRouter"
  );

  let mapRouteProperties: MapRoutePropertiesFunction;
  if (init.mapRouteProperties) {
    mapRouteProperties = init.mapRouteProperties;
  } else if (init.detectErrorBoundary) {
    // If they are still using the deprecated version, wrap it with the new API
    let detectErrorBoundary = init.detectErrorBoundary;
    mapRouteProperties = (route) => ({
      hasErrorBoundary: detectErrorBoundary(route),
    });
  } else {
    mapRouteProperties = defaultMapRouteProperties;
  }

  // Routes keyed by ID
  let manifest: RouteManifest = {};
  // Routes in tree format for matching
  let dataRoutes = convertRoutesToDataRoutes(
    init.routes,
    mapRouteProperties,
    undefined,
    manifest
  );
  let inFlightDataRoutes: AgnosticDataRouteObject[] | undefined;
  let basename = init.basename || "/";
  // Config driven behavior flags
  let future: FutureConfig = {
    v7_normalizeFormMethod: false,
    v7_prependBasename: false,
    ...init.future,
  };
  // Cleanup function for history
  let unlistenHistory: (() => void) | null = null;
  // Externally-provided functions to call on all state changes
  let subscribers = new Set<RouterSubscriber>();
  // Externally-provided object to hold scroll restoration locations during routing
  let savedScrollPositions: Record<string, number> | null = null;
  // Externally-provided function to get scroll restoration keys
  let getScrollRestorationKey: GetScrollRestorationKeyFunction | null = null;
  // Externally-provided function to get current scroll position
  let getScrollPosition: GetScrollPositionFunction | null = null;
  // One-time flag to control the initial hydration scroll restoration.  Because
  // we don't get the saved positions from <ScrollRestoration /> until _after_
  // the initial render, we need to manually trigger a separate updateState to
  // send along the restoreScrollPosition
  // Set to true if we have `hydrationData` since we assume we were SSR'd and that
  // SSR did the initial scroll restoration.
  let initialScrollRestored = init.hydrationData != null;

  let initialMatches = matchRoutes(dataRoutes, init.history.location, basename);
  let initialErrors: RouteData | null = null;

  if (initialMatches == null) {
    // If we do not match a user-provided-route, fall back to the root
    // to allow the error boundary to take over
    let error = getInternalRouterError(404, {
      pathname: init.history.location.pathname,
    });
    let { matches, route } = getShortCircuitMatches(dataRoutes);
    initialMatches = matches;
    initialErrors = { [route.id]: error };
  }

  let initialized =
    // All initialMatches need to be loaded before we're ready.  If we have lazy
    // functions around still then we'll need to run them in initialize()
    !initialMatches.some((m) => m.route.lazy) &&
    // And we have to either have no loaders or have been provided hydrationData
    (!initialMatches.some((m) => m.route.loader) || init.hydrationData != null);

  let router: Router;
  let state: RouterState = {
    historyAction: init.history.action,
    location: init.history.location,
    matches: initialMatches,
    initialized,
    navigation: IDLE_NAVIGATION,
    // Don't restore on initial updateState() if we were SSR'd
    restoreScrollPosition: init.hydrationData != null ? false : null,
    preventScrollReset: false,
    revalidation: "idle",
    loaderData: (init.hydrationData && init.hydrationData.loaderData) || {},
    actionData: (init.hydrationData && init.hydrationData.actionData) || null,
    errors: (init.hydrationData && init.hydrationData.errors) || initialErrors,
    fetchers: new Map(),
    blockers: new Map(),
  };

  // -- Stateful internal variables to manage navigations --
  // Current navigation in progress (to be committed in completeNavigation)
  let pendingAction: HistoryAction = HistoryAction.Pop;

  // Should the current navigation prevent the scroll reset if scroll cannot
  // be restored?
  let pendingPreventScrollReset = false;

  // AbortController for the active navigation
  let pendingNavigationController: AbortController | null;

  // We use this to avoid touching history in completeNavigation if a
  // revalidation is entirely uninterrupted
  let isUninterruptedRevalidation = false;

  // Use this internal flag to force revalidation of all loaders:
  //  - submissions (completed or interrupted)
  //  - useRevalidator()
  //  - X-Remix-Revalidate (from redirect)
  let isRevalidationRequired = false;

  // Use this internal array to capture routes that require revalidation due
  // to a cancelled deferred on action submission
  let cancelledDeferredRoutes: string[] = [];

  // Use this internal array to capture fetcher loads that were cancelled by an
  // action navigation and require revalidation
  let cancelledFetcherLoads: string[] = [];

  // AbortControllers for any in-flight fetchers
  let fetchControllers = new Map<string, AbortController>();

  // Track loads based on the order in which they started
  let incrementingLoadId = 0;

  // Track the outstanding pending navigation data load to be compared against
  // the globally incrementing load when a fetcher load lands after a completed
  // navigation
  let pendingNavigationLoadId = -1;

  // Fetchers that triggered data reloads as a result of their actions
  let fetchReloadIds = new Map<string, number>();

  // Fetchers that triggered redirect navigations
  let fetchRedirectIds = new Set<string>();

  // Most recent href/match for fetcher.load calls for fetchers
  let fetchLoadMatches = new Map<string, FetchLoadMatch>();

  // Store DeferredData instances for active route matches.  When a
  // route loader returns defer() we stick one in here.  Then, when a nested
  // promise resolves we update loaderData.  If a new navigation starts we
  // cancel active deferreds for eliminated routes.
  let activeDeferreds = new Map<string, DeferredData>();

  // Store blocker functions in a separate Map outside of router state since
  // we don't need to update UI state if they change
  let blockerFunctions = new Map<string, BlockerFunction>();

  // Flag to ignore the next history update, so we can revert the URL change on
  // a POP navigation that was blocked by the user without touching router state
  let ignoreNextHistoryUpdate = false;

  // Initialize the router, all side effects should be kicked off from here.
  // Implemented as a Fluent API for ease of:
  //   let router = createRouter(init).initialize();
  function initialize() {
    // If history informs us of a POP navigation, start the navigation but do not update
    // state.  We'll update our own state once the navigation completes
    unlistenHistory = init.history.listen(
      ({ action: historyAction, location, delta }) => {
        // Ignore this event if it was just us resetting the URL from a
        // blocked POP navigation
        if (ignoreNextHistoryUpdate) {
          ignoreNextHistoryUpdate = false;
          return;
        }

        warning(
          blockerFunctions.size === 0 || delta != null,
          "You are trying to use a blocker on a POP navigation to a location " +
            "that was not created by @remix-run/router. This will fail silently in " +
            "production. This can happen if you are navigating outside the router " +
            "via `window.history.pushState`/`window.location.hash` instead of using " +
            "router navigation APIs.  This can also happen if you are using " +
            "createHashRouter and the user manually changes the URL."
        );

        let blockerKey = shouldBlockNavigation({
          currentLocation: state.location,
          nextLocation: location,
          historyAction,
        });

        if (blockerKey && delta != null) {
          // Restore the URL to match the current UI, but don't update router state
          ignoreNextHistoryUpdate = true;
          init.history.go(delta * -1);

          // Put the blocker into a blocked state
          updateBlocker(blockerKey, {
            state: "blocked",
            location,
            proceed() {
              updateBlocker(blockerKey!, {
                state: "proceeding",
                proceed: undefined,
                reset: undefined,
                location,
              });
              // Re-do the same POP navigation we just blocked
              init.history.go(delta);
            },
            reset() {
              deleteBlocker(blockerKey!);
              updateState({ blockers: new Map(router.state.blockers) });
            },
          });
          return;
        }

        return startNavigation(historyAction, location);
      }
    );

    // Kick off initial data load if needed.  Use Pop to avoid modifying history
    // Note we don't do any handling of lazy here.  For SPA's it'll get handled
    // in the normal navigation flow.  For SSR it's expected that lazy modules are
    // resolved prior to router creation since we can't go into a fallbackElement
    // UI for SSR'd apps
    if (!state.initialized) {
      startNavigation(HistoryAction.Pop, state.location);
    }

    return router;
  }

  // Clean up a router and it's side effects
  function dispose() {
    if (unlistenHistory) {
      unlistenHistory();
    }
    subscribers.clear();
    pendingNavigationController && pendingNavigationController.abort();
    state.fetchers.forEach((_, key) => deleteFetcher(key));
    state.blockers.forEach((_, key) => deleteBlocker(key));
  }

  // Subscribe to state updates for the router
  function subscribe(fn: RouterSubscriber) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  // Update our state and notify the calling context of the change
  function updateState(newState: Partial<RouterState>): void {
    state = {
      ...state,
      ...newState,
    };
    subscribers.forEach((subscriber) => subscriber(state));
  }

  // Complete a navigation returning the state.navigation back to the IDLE_NAVIGATION
  // and setting state.[historyAction/location/matches] to the new route.
  // - Location is a required param
  // - Navigation will always be set to IDLE_NAVIGATION
  // - Can pass any other state in newState
  function completeNavigation(
    location: Location,
    newState: Partial<Omit<RouterState, "action" | "location" | "navigation">>
  ): void {
    // Deduce if we're in a loading/actionReload state:
    // - We have committed actionData in the store
    // - The current navigation was a mutation submission
    // - We're past the submitting state and into the loading state
    // - The location being loaded is not the result of a redirect
    let isActionReload =
      state.actionData != null &&
      state.navigation.formMethod != null &&
      isMutationMethod(state.navigation.formMethod) &&
      state.navigation.state === "loading" &&
      location.state?._isRedirect !== true;

    let actionData: RouteData | null;
    if (newState.actionData) {
      if (Object.keys(newState.actionData).length > 0) {
        actionData = newState.actionData;
      } else {
        // Empty actionData -> clear prior actionData due to an action error
        actionData = null;
      }
    } else if (isActionReload) {
      // Keep the current data if we're wrapping up the action reload
      actionData = state.actionData;
    } else {
      // Clear actionData on any other completed navigations
      actionData = null;
    }

    // Always preserve any existing loaderData from re-used routes
    let loaderData = newState.loaderData
      ? mergeLoaderData(
          state.loaderData,
          newState.loaderData,
          newState.matches || [],
          newState.errors
        )
      : state.loaderData;

    // On a successful navigation we can assume we got through all blockers
    // so we can start fresh
    for (let [key] of blockerFunctions) {
      deleteBlocker(key);
    }

    // Always respect the user flag.  Otherwise don't reset on mutation
    // submission navigations unless they redirect
    let preventScrollReset =
      pendingPreventScrollReset === true ||
      (state.navigation.formMethod != null &&
        isMutationMethod(state.navigation.formMethod) &&
        location.state?._isRedirect !== true);

    if (inFlightDataRoutes) {
      dataRoutes = inFlightDataRoutes;
      inFlightDataRoutes = undefined;
    }

    updateState({
      ...newState, // matches, errors, fetchers go through as-is
      actionData,
      loaderData,
      historyAction: pendingAction,
      location,
      initialized: true,
      navigation: IDLE_NAVIGATION,
      revalidation: "idle",
      restoreScrollPosition: getSavedScrollPosition(
        location,
        newState.matches || state.matches
      ),
      preventScrollReset,
      blockers: new Map(state.blockers),
    });

    if (isUninterruptedRevalidation) {
      // If this was an uninterrupted revalidation then do not touch history
    } else if (pendingAction === HistoryAction.Pop) {
      // Do nothing for POP - URL has already been updated
    } else if (pendingAction === HistoryAction.Push) {
      init.history.push(location, location.state);
    } else if (pendingAction === HistoryAction.Replace) {
      init.history.replace(location, location.state);
    }

    // Reset stateful navigation vars
    pendingAction = HistoryAction.Pop;
    pendingPreventScrollReset = false;
    isUninterruptedRevalidation = false;
    isRevalidationRequired = false;
    cancelledDeferredRoutes = [];
    cancelledFetcherLoads = [];
  }

  // Trigger a navigation event, which can either be a numerical POP or a PUSH
  // replace with an optional submission
  async function navigate(
    to: number | To | null,
    opts?: RouterNavigateOptions
  ): Promise<void> {
    if (typeof to === "number") {
      init.history.go(to);
      return;
    }

    let normalizedPath = normalizeTo(
      state.location,
      state.matches,
      basename,
      future.v7_prependBasename,
      to,
      opts?.fromRouteId,
      opts?.relative
    );
    let { path, submission, error } = normalizeNavigateOptions(
      future.v7_normalizeFormMethod,
      false,
      normalizedPath,
      opts
    );

    let currentLocation = state.location;
    let nextLocation = createLocation(state.location, path, opts && opts.state);

    // When using navigate as a PUSH/REPLACE we aren't reading an already-encoded
    // URL from window.location, so we need to encode it here so the behavior
    // remains the same as POP and non-data-router usages.  new URL() does all
    // the same encoding we'd get from a history.pushState/window.location read
    // without having to touch history
    nextLocation = {
      ...nextLocation,
      ...init.history.encodeLocation(nextLocation),
    };

    let userReplace = opts && opts.replace != null ? opts.replace : undefined;

    let historyAction = HistoryAction.Push;

    if (userReplace === true) {
      historyAction = HistoryAction.Replace;
    } else if (userReplace === false) {
      // no-op
    } else if (
      submission != null &&
      isMutationMethod(submission.formMethod) &&
      submission.formAction === state.location.pathname + state.location.search
    ) {
      // By default on submissions to the current location we REPLACE so that
      // users don't have to double-click the back button to get to the prior
      // location.  If the user redirects to a different location from the
      // action/loader this will be ignored and the redirect will be a PUSH
      historyAction = HistoryAction.Replace;
    }

    let preventScrollReset =
      opts && "preventScrollReset" in opts
        ? opts.preventScrollReset === true
        : undefined;

    let blockerKey = shouldBlockNavigation({
      currentLocation,
      nextLocation,
      historyAction,
    });
    if (blockerKey) {
      // Put the blocker into a blocked state
      updateBlocker(blockerKey, {
        state: "blocked",
        location: nextLocation,
        proceed() {
          updateBlocker(blockerKey!, {
            state: "proceeding",
            proceed: undefined,
            reset: undefined,
            location: nextLocation,
          });
          // Send the same navigation through
          navigate(to, opts);
        },
        reset() {
          deleteBlocker(blockerKey!);
          updateState({ blockers: new Map(state.blockers) });
        },
      });
      return;
    }

    return await startNavigation(historyAction, nextLocation, {
      submission,
      // Send through the formData serialization error if we have one so we can
      // render at the right error boundary after we match routes
      pendingError: error,
      preventScrollReset,
      replace: opts && opts.replace,
    });
  }

  // Revalidate all current loaders.  If a navigation is in progress or if this
  // is interrupted by a navigation, allow this to "succeed" by calling all
  // loaders during the next loader round
  function revalidate() {
    interruptActiveLoads();
    updateState({ revalidation: "loading" });

    // If we're currently submitting an action, we don't need to start a new
    // navigation, we'll just let the follow up loader execution call all loaders
    if (state.navigation.state === "submitting") {
      return;
    }

    // If we're currently in an idle state, start a new navigation for the current
    // action/location and mark it as uninterrupted, which will skip the history
    // update in completeNavigation
    if (state.navigation.state === "idle") {
      startNavigation(state.historyAction, state.location, {
        startUninterruptedRevalidation: true,
      });
      return;
    }

    // Otherwise, if we're currently in a loading state, just start a new
    // navigation to the navigation.location but do not trigger an uninterrupted
    // revalidation so that history correctly updates once the navigation completes
    startNavigation(
      pendingAction || state.historyAction,
      state.navigation.location,
      { overrideNavigation: state.navigation }
    );
  }

  // Start a navigation to the given action/location.  Can optionally provide a
  // overrideNavigation which will override the normalLoad in the case of a redirect
  // navigation
  async function startNavigation(
    historyAction: HistoryAction,
    location: Location,
    opts?: {
      submission?: Submission;
      fetcherSubmission?: Submission;
      overrideNavigation?: Navigation;
      pendingError?: ErrorResponse;
      startUninterruptedRevalidation?: boolean;
      preventScrollReset?: boolean;
      replace?: boolean;
    }
  ): Promise<void> {
    // Abort any in-progress navigations and start a new one. Unset any ongoing
    // uninterrupted revalidations unless told otherwise, since we want this
    // new navigation to update history normally
    pendingNavigationController && pendingNavigationController.abort();
    pendingNavigationController = null;
    pendingAction = historyAction;
    isUninterruptedRevalidation =
      (opts && opts.startUninterruptedRevalidation) === true;

    // Save the current scroll position every time we start a new navigation,
    // and track whether we should reset scroll on completion
    saveScrollPosition(state.location, state.matches);
    pendingPreventScrollReset = (opts && opts.preventScrollReset) === true;

    let routesToUse = inFlightDataRoutes || dataRoutes;
    let loadingNavigation = opts && opts.overrideNavigation;
    let matches = matchRoutes(routesToUse, location, basename);

    // Short circuit with a 404 on the root error boundary if we match nothing
    if (!matches) {
      let error = getInternalRouterError(404, { pathname: location.pathname });
      let { matches: notFoundMatches, route } =
        getShortCircuitMatches(routesToUse);
      // Cancel all pending deferred on 404s since we don't keep any routes
      cancelActiveDeferreds();
      completeNavigation(location, {
        matches: notFoundMatches,
        loaderData: {},
        errors: {
          [route.id]: error,
        },
      });
      return;
    }

    // Short circuit if it's only a hash change and not a revalidation or
    // mutation submission.
    //
    // Ignore on initial page loads because since the initial load will always
    // be "same hash".  For example, on /page#hash and submit a <Form method="post">
    // which will default to a navigation to /page
    if (
      state.initialized &&
      !isRevalidationRequired &&
      isHashChangeOnly(state.location, location) &&
      !(opts && opts.submission && isMutationMethod(opts.submission.formMethod))
    ) {
      completeNavigation(location, { matches });
      return;
    }

    // Create a controller/Request for this navigation
    pendingNavigationController = new AbortController();
    let request = createClientSideRequest(
      init.history,
      location,
      pendingNavigationController.signal,
      opts && opts.submission
    );
    let pendingActionData: RouteData | undefined;
    let pendingError: RouteData | undefined;

    if (opts && opts.pendingError) {
      // If we have a pendingError, it means the user attempted a GET submission
      // with binary FormData so assign here and skip to handleLoaders.  That
      // way we handle calling loaders above the boundary etc.  It's not really
      // different from an actionError in that sense.
      pendingError = {
        [findNearestBoundary(matches).route.id]: opts.pendingError,
      };
    } else if (
      opts &&
      opts.submission &&
      isMutationMethod(opts.submission.formMethod)
    ) {
      // Call action if we received an action submission
      let actionOutput = await handleAction(
        request,
        location,
        opts.submission,
        matches,
        { replace: opts.replace }
      );

      if (actionOutput.shortCircuited) {
        return;
      }

      pendingActionData = actionOutput.pendingActionData;
      pendingError = actionOutput.pendingActionError;

      let navigation: NavigationStates["Loading"] = {
        state: "loading",
        location,
        ...opts.submission,
      };
      loadingNavigation = navigation;

      // Create a GET request for the loaders
      request = new Request(request.url, { signal: request.signal });
    }

    // Call loaders
    let { shortCircuited, loaderData, errors } = await handleLoaders(
      request,
      location,
      matches,
      loadingNavigation,
      opts && opts.submission,
      opts && opts.fetcherSubmission,
      opts && opts.replace,
      pendingActionData,
      pendingError
    );

    if (shortCircuited) {
      return;
    }

    // Clean up now that the action/loaders have completed.  Don't clean up if
    // we short circuited because pendingNavigationController will have already
    // been assigned to a new controller for the next navigation
    pendingNavigationController = null;

    completeNavigation(location, {
      matches,
      ...(pendingActionData ? { actionData: pendingActionData } : {}),
      loaderData,
      errors,
    });
  }

  // Call the action matched by the leaf route for this navigation and handle
  // redirects/errors
  async function handleAction(
    request: Request,
    location: Location,
    submission: Submission,
    matches: AgnosticDataRouteMatch[],
    opts?: { replace?: boolean }
  ): Promise<HandleActionResult> {
    interruptActiveLoads();

    // Put us in a submitting state
    let navigation: NavigationStates["Submitting"] = {
      state: "submitting",
      location,
      ...submission,
    };
    updateState({ navigation });

    // Call our action and get the result
    let result: DataResult;
    let actionMatch = getTargetMatch(matches, location);

    if (!actionMatch.route.action && !actionMatch.route.lazy) {
      result = {
        type: ResultType.error,
        error: getInternalRouterError(405, {
          method: request.method,
          pathname: location.pathname,
          routeId: actionMatch.route.id,
        }),
      };
    } else {
      result = await callLoaderOrAction(
        "action",
        request,
        actionMatch,
        matches,
        manifest,
        mapRouteProperties,
        basename
      );

      if (request.signal.aborted) {
        return { shortCircuited: true };
      }
    }

    if (isRedirectResult(result)) {
      let replace: boolean;
      if (opts && opts.replace != null) {
        replace = opts.replace;
      } else {
        // If the user didn't explicity indicate replace behavior, replace if
        // we redirected to the exact same location we're currently at to avoid
        // double back-buttons
        replace =
          result.location === state.location.pathname + state.location.search;
      }
      await startRedirectNavigation(state, result, { submission, replace });
      return { shortCircuited: true };
    }

    if (isErrorResult(result)) {
      // Store off the pending error - we use it to determine which loaders
      // to call and will commit it when we complete the navigation
      let boundaryMatch = findNearestBoundary(matches, actionMatch.route.id);

      // By default, all submissions are REPLACE navigations, but if the
      // action threw an error that'll be rendered in an errorElement, we fall
      // back to PUSH so that the user can use the back button to get back to
      // the pre-submission form location to try again
      if ((opts && opts.replace) !== true) {
        pendingAction = HistoryAction.Push;
      }

      return {
        // Send back an empty object we can use to clear out any prior actionData
        pendingActionData: {},
        pendingActionError: { [boundaryMatch.route.id]: result.error },
      };
    }

    if (isDeferredResult(result)) {
      throw getInternalRouterError(400, { type: "defer-action" });
    }

    return {
      pendingActionData: { [actionMatch.route.id]: result.data },
    };
  }

  // Call all applicable loaders for the given matches, handling redirects,
  // errors, etc.
  async function handleLoaders(
    request: Request,
    location: Location,
    matches: AgnosticDataRouteMatch[],
    overrideNavigation?: Navigation,
    submission?: Submission,
    fetcherSubmission?: Submission,
    replace?: boolean,
    pendingActionData?: RouteData,
    pendingError?: RouteData
  ): Promise<HandleLoadersResult> {
    // Figure out the right navigation we want to use for data loading
    let loadingNavigation = overrideNavigation;
    if (!loadingNavigation) {
      let navigation: NavigationStates["Loading"] = {
        state: "loading",
        location,
        formMethod: undefined,
        formAction: undefined,
        formEncType: undefined,
        formData: undefined,
        ...submission,
      };
      loadingNavigation = navigation;
    }

    // If this was a redirect from an action we don't have a "submission" but
    // we have it on the loading navigation so use that if available
    let activeSubmission =
      submission || fetcherSubmission
        ? submission || fetcherSubmission
        : loadingNavigation.formMethod &&
          loadingNavigation.formAction &&
          loadingNavigation.formData &&
          loadingNavigation.formEncType
        ? {
            formMethod: loadingNavigation.formMethod,
            formAction: loadingNavigation.formAction,
            formData: loadingNavigation.formData,
            formEncType: loadingNavigation.formEncType,
          }
        : undefined;

    let routesToUse = inFlightDataRoutes || dataRoutes;
    let [matchesToLoad, revalidatingFetchers] = getMatchesToLoad(
      init.history,
      state,
      matches,
      activeSubmission,
      location,
      isRevalidationRequired,
      cancelledDeferredRoutes,
      cancelledFetcherLoads,
      fetchLoadMatches,
      routesToUse,
      basename,
      pendingActionData,
      pendingError
    );

    // Cancel pending deferreds for no-longer-matched routes or routes we're
    // about to reload.  Note that if this is an action reload we would have
    // already cancelled all pending deferreds so this would be a no-op
    cancelActiveDeferreds(
      (routeId) =>
        !(matches && matches.some((m) => m.route.id === routeId)) ||
        (matchesToLoad && matchesToLoad.some((m) => m.route.id === routeId))
    );

    // Short circuit if we have no loaders to run
    if (matchesToLoad.length === 0 && revalidatingFetchers.length === 0) {
      let updatedFetchers = markFetchRedirectsDone();
      completeNavigation(location, {
        matches,
        loaderData: {},
        // Commit pending error if we're short circuiting
        errors: pendingError || null,
        ...(pendingActionData ? { actionData: pendingActionData } : {}),
        ...(updatedFetchers ? { fetchers: new Map(state.fetchers) } : {}),
      });
      return { shortCircuited: true };
    }

    // If this is an uninterrupted revalidation, we remain in our current idle
    // state.  If not, we need to switch to our loading state and load data,
    // preserving any new action data or existing action data (in the case of
    // a revalidation interrupting an actionReload)
    if (!isUninterruptedRevalidation) {
      revalidatingFetchers.forEach((rf) => {
        let fetcher = state.fetchers.get(rf.key);
        let revalidatingFetcher: FetcherStates["Loading"] = {
          state: "loading",
          data: fetcher && fetcher.data,
          formMethod: undefined,
          formAction: undefined,
          formEncType: undefined,
          formData: undefined,
          " _hasFetcherDoneAnything ": true,
        };
        state.fetchers.set(rf.key, revalidatingFetcher);
      });
      let actionData = pendingActionData || state.actionData;
      updateState({
        navigation: loadingNavigation,
        ...(actionData
          ? Object.keys(actionData).length === 0
            ? { actionData: null }
            : { actionData }
          : {}),
        ...(revalidatingFetchers.length > 0
          ? { fetchers: new Map(state.fetchers) }
          : {}),
      });
    }

    pendingNavigationLoadId = ++incrementingLoadId;
    revalidatingFetchers.forEach((rf) => {
      if (rf.controller) {
        // Fetchers use an independent AbortController so that aborting a fetcher
        // (via deleteFetcher) does not abort the triggering navigation that
        // triggered the revalidation
        fetchControllers.set(rf.key, rf.controller);
      }
    });

    // Proxy navigation abort through to revalidation fetchers
    let abortPendingFetchRevalidations = () =>
      revalidatingFetchers.forEach((f) => abortFetcher(f.key));
    if (pendingNavigationController) {
      pendingNavigationController.signal.addEventListener(
        "abort",
        abortPendingFetchRevalidations
      );
    }

    let { results, loaderResults, fetcherResults } =
      await callLoadersAndMaybeResolveData(
        state.matches,
        matches,
        matchesToLoad,
        revalidatingFetchers,
        request
      );

    if (request.signal.aborted) {
      return { shortCircuited: true };
    }

    // Clean up _after_ loaders have completed.  Don't clean up if we short
    // circuited because fetchControllers would have been aborted and
    // reassigned to new controllers for the next navigation
    if (pendingNavigationController) {
      pendingNavigationController.signal.removeEventListener(
        "abort",
        abortPendingFetchRevalidations
      );
    }
    revalidatingFetchers.forEach((rf) => fetchControllers.delete(rf.key));

    // If any loaders returned a redirect Response, start a new REPLACE navigation
    let redirect = findRedirect(results);
    if (redirect) {
      await startRedirectNavigation(state, redirect, { replace });
      return { shortCircuited: true };
    }

    // Process and commit output from loaders
    let { loaderData, errors } = processLoaderData(
      state,
      matches,
      matchesToLoad,
      loaderResults,
      pendingError,
      revalidatingFetchers,
      fetcherResults,
      activeDeferreds
    );

    // Wire up subscribers to update loaderData as promises settle
    activeDeferreds.forEach((deferredData, routeId) => {
      deferredData.subscribe((aborted) => {
        // Note: No need to updateState here since the TrackedPromise on
        // loaderData is stable across resolve/reject
        // Remove this instance if we were aborted or if promises have settled
        if (aborted || deferredData.done) {
          activeDeferreds.delete(routeId);
        }
      });
    });

    let updatedFetchers = markFetchRedirectsDone();
    let didAbortFetchLoads = abortStaleFetchLoads(pendingNavigationLoadId);
    let shouldUpdateFetchers =
      updatedFetchers || didAbortFetchLoads || revalidatingFetchers.length > 0;

    return {
      loaderData,
      errors,
      ...(shouldUpdateFetchers ? { fetchers: new Map(state.fetchers) } : {}),
    };
  }

  function getFetcher<TData = any>(key: string): Fetcher<TData> {
    return state.fetchers.get(key) || IDLE_FETCHER;
  }

  // Trigger a fetcher load/submit for the given fetcher key
  function fetch(
    key: string,
    routeId: string,
    href: string | null,
    opts?: RouterFetchOptions
  ) {
    if (isServer) {
      throw new Error(
        "router.fetch() was called during the server render, but it shouldn't be. " +
          "You are likely calling a useFetcher() method in the body of your component. " +
          "Try moving it to a useEffect or a callback."
      );
    }

    if (fetchControllers.has(key)) abortFetcher(key);

    let routesToUse = inFlightDataRoutes || dataRoutes;
    let normalizedPath = normalizeTo(
      state.location,
      state.matches,
      basename,
      future.v7_prependBasename,
      href,
      routeId,
      opts?.relative
    );
    let matches = matchRoutes(routesToUse, normalizedPath, basename);

    if (!matches) {
      setFetcherError(
        key,
        routeId,
        getInternalRouterError(404, { pathname: normalizedPath })
      );
      return;
    }

    let { path, submission } = normalizeNavigateOptions(
      future.v7_normalizeFormMethod,
      true,
      normalizedPath,
      opts
    );
    let match = getTargetMatch(matches, path);

    pendingPreventScrollReset = (opts && opts.preventScrollReset) === true;

    if (submission && isMutationMethod(submission.formMethod)) {
      handleFetcherAction(key, routeId, path, match, matches, submission);
      return;
    }

    // Store off the match so we can call it's shouldRevalidate on subsequent
    // revalidations
    fetchLoadMatches.set(key, { routeId, path });
    handleFetcherLoader(key, routeId, path, match, matches, submission);
  }

  // Call the action for the matched fetcher.submit(), and then handle redirects,
  // errors, and revalidation
  async function handleFetcherAction(
    key: string,
    routeId: string,
    path: string,
    match: AgnosticDataRouteMatch,
    requestMatches: AgnosticDataRouteMatch[],
    submission: Submission
  ) {
    interruptActiveLoads();
    fetchLoadMatches.delete(key);

    if (!match.route.action && !match.route.lazy) {
      let error = getInternalRouterError(405, {
        method: submission.formMethod,
        pathname: path,
        routeId: routeId,
      });
      setFetcherError(key, routeId, error);
      return;
    }

    // Put this fetcher into it's submitting state
    let existingFetcher = state.fetchers.get(key);
    let fetcher: FetcherStates["Submitting"] = {
      state: "submitting",
      ...submission,
      data: existingFetcher && existingFetcher.data,
      " _hasFetcherDoneAnything ": true,
    };
    state.fetchers.set(key, fetcher);
    updateState({ fetchers: new Map(state.fetchers) });

    // Call the action for the fetcher
    let abortController = new AbortController();
    let fetchRequest = createClientSideRequest(
      init.history,
      path,
      abortController.signal,
      submission
    );
    fetchControllers.set(key, abortController);

    let actionResult = await callLoaderOrAction(
      "action",
      fetchRequest,
      match,
      requestMatches,
      manifest,
      mapRouteProperties,
      basename
    );

    if (fetchRequest.signal.aborted) {
      // We can delete this so long as we weren't aborted by ou our own fetcher
      // re-submit which would have put _new_ controller is in fetchControllers
      if (fetchControllers.get(key) === abortController) {
        fetchControllers.delete(key);
      }
      return;
    }

    if (isRedirectResult(actionResult)) {
      fetchControllers.delete(key);
      fetchRedirectIds.add(key);
      let loadingFetcher: FetcherStates["Loading"] = {
        state: "loading",
        ...submission,
        data: undefined,
        " _hasFetcherDoneAnything ": true,
      };
      state.fetchers.set(key, loadingFetcher);
      updateState({ fetchers: new Map(state.fetchers) });

      return startRedirectNavigation(state, actionResult, {
        submission,
        isFetchActionRedirect: true,
      });
    }

    // Process any non-redirect errors thrown
    if (isErrorResult(actionResult)) {
      setFetcherError(key, routeId, actionResult.error);
      return;
    }

    if (isDeferredResult(actionResult)) {
      throw getInternalRouterError(400, { type: "defer-action" });
    }

    // Start the data load for current matches, or the next location if we're
    // in the middle of a navigation
    let nextLocation = state.navigation.location || state.location;
    let revalidationRequest = createClientSideRequest(
      init.history,

      nextLocation,
      abortController.signal
    );
    let routesToUse = inFlightDataRoutes || dataRoutes;
    let matches =
      state.navigation.state !== "idle"
        ? matchRoutes(routesToUse, state.navigation.location, basename)
        : state.matches;

    invariant(matches, "Didn't find any matches after fetcher action");

    let loadId = ++incrementingLoadId;
    fetchReloadIds.set(key, loadId);

    let loadFetcher: FetcherStates["Loading"] = {
      state: "loading",
      data: actionResult.data,
      ...submission,
      " _hasFetcherDoneAnything ": true,
    };
    state.fetchers.set(key, loadFetcher);

    let [matchesToLoad, revalidatingFetchers] = getMatchesToLoad(
      init.history,
      state,
      matches,
      submission,
      nextLocation,
      isRevalidationRequired,
      cancelledDeferredRoutes,
      cancelledFetcherLoads,
      fetchLoadMatches,
      routesToUse,
      basename,
      { [match.route.id]: actionResult.data },
      undefined // No need to send through errors since we short circuit above
    );

    // Put all revalidating fetchers into the loading state, except for the
    // current fetcher which we want to keep in it's current loading state which
    // contains it's action submission info + action data
    revalidatingFetchers
      .filter((rf) => rf.key !== key)
      .forEach((rf) => {
        let staleKey = rf.key;
        let existingFetcher = state.fetchers.get(staleKey);
        let revalidatingFetcher: FetcherStates["Loading"] = {
          state: "loading",
          data: existingFetcher && existingFetcher.data,
          formMethod: undefined,
          formAction: undefined,
          formEncType: undefined,
          formData: undefined,
          " _hasFetcherDoneAnything ": true,
        };
        state.fetchers.set(staleKey, revalidatingFetcher);
        if (rf.controller) {
          fetchControllers.set(staleKey, rf.controller);
        }
      });

    updateState({ fetchers: new Map(state.fetchers) });

    let abortPendingFetchRevalidations = () =>
      revalidatingFetchers.forEach((rf) => abortFetcher(rf.key));

    abortController.signal.addEventListener(
      "abort",
      abortPendingFetchRevalidations
    );

    let { results, loaderResults, fetcherResults } =
      await callLoadersAndMaybeResolveData(
        state.matches,
        matches,
        matchesToLoad,
        revalidatingFetchers,
        revalidationRequest
      );

    if (abortController.signal.aborted) {
      return;
    }

    abortController.signal.removeEventListener(
      "abort",
      abortPendingFetchRevalidations
    );

    fetchReloadIds.delete(key);
    fetchControllers.delete(key);
    revalidatingFetchers.forEach((r) => fetchControllers.delete(r.key));

    let redirect = findRedirect(results);
    if (redirect) {
      return startRedirectNavigation(state, redirect);
    }

    // Process and commit output from loaders
    let { loaderData, errors } = processLoaderData(
      state,
      state.matches,
      matchesToLoad,
      loaderResults,
      undefined,
      revalidatingFetchers,
      fetcherResults,
      activeDeferreds
    );

    let doneFetcher: FetcherStates["Idle"] = {
      state: "idle",
      data: actionResult.data,
      formMethod: undefined,
      formAction: undefined,
      formEncType: undefined,
      formData: undefined,
      " _hasFetcherDoneAnything ": true,
    };
    state.fetchers.set(key, doneFetcher);

    let didAbortFetchLoads = abortStaleFetchLoads(loadId);

    // If we are currently in a navigation loading state and this fetcher is
    // more recent than the navigation, we want the newer data so abort the
    // navigation and complete it with the fetcher data
    if (
      state.navigation.state === "loading" &&
      loadId > pendingNavigationLoadId
    ) {
      invariant(pendingAction, "Expected pending action");
      pendingNavigationController && pendingNavigationController.abort();

      completeNavigation(state.navigation.location, {
        matches,
        loaderData,
        errors,
        fetchers: new Map(state.fetchers),
      });
    } else {
      // otherwise just update with the fetcher data, preserving any existing
      // loaderData for loaders that did not need to reload.  We have to
      // manually merge here since we aren't going through completeNavigation
      updateState({
        errors,
        loaderData: mergeLoaderData(
          state.loaderData,
          loaderData,
          matches,
          errors
        ),
        ...(didAbortFetchLoads ? { fetchers: new Map(state.fetchers) } : {}),
      });
      isRevalidationRequired = false;
    }
  }

  // Call the matched loader for fetcher.load(), handling redirects, errors, etc.
  async function handleFetcherLoader(
    key: string,
    routeId: string,
    path: string,
    match: AgnosticDataRouteMatch,
    matches: AgnosticDataRouteMatch[],
    submission?: Submission
  ) {
    let existingFetcher = state.fetchers.get(key);
    // Put this fetcher into it's loading state
    let loadingFetcher: FetcherStates["Loading"] = {
      state: "loading",
      formMethod: undefined,
      formAction: undefined,
      formEncType: undefined,
      formData: undefined,
      ...submission,
      data: existingFetcher && existingFetcher.data,
      " _hasFetcherDoneAnything ": true,
    };
    state.fetchers.set(key, loadingFetcher);
    updateState({ fetchers: new Map(state.fetchers) });

    // Call the loader for this fetcher route match
    let abortController = new AbortController();
    let fetchRequest = createClientSideRequest(
      init.history,
      path,
      abortController.signal
    );
    fetchControllers.set(key, abortController);

    let result: DataResult = await callLoaderOrAction(
      "loader",
      fetchRequest,
      match,
      matches,
      manifest,
      mapRouteProperties,
      basename
    );

    // Deferred isn't supported for fetcher loads, await everything and treat it
    // as a normal load.  resolveDeferredData will return undefined if this
    // fetcher gets aborted, so we just leave result untouched and short circuit
    // below if that happens
    if (isDeferredResult(result)) {
      result =
        (await resolveDeferredData(result, fetchRequest.signal, true)) ||
        result;
    }

    // We can delete this so long as we weren't aborted by our our own fetcher
    // re-load which would have put _new_ controller is in fetchControllers
    if (fetchControllers.get(key) === abortController) {
      fetchControllers.delete(key);
    }

    if (fetchRequest.signal.aborted) {
      return;
    }

    // If the loader threw a redirect Response, start a new REPLACE navigation
    if (isRedirectResult(result)) {
      fetchRedirectIds.add(key);
      await startRedirectNavigation(state, result);
      return;
    }

    // Process any non-redirect errors thrown
    if (isErrorResult(result)) {
      let boundaryMatch = findNearestBoundary(state.matches, routeId);
      state.fetchers.delete(key);
      // TODO: In remix, this would reset to IDLE_NAVIGATION if it was a catch -
      // do we need to behave any differently with our non-redirect errors?
      // What if it was a non-redirect Response?
      updateState({
        fetchers: new Map(state.fetchers),
        errors: {
          [boundaryMatch.route.id]: result.error,
        },
      });
      return;
    }

    invariant(!isDeferredResult(result), "Unhandled fetcher deferred data");

    // Put the fetcher back into an idle state
    let doneFetcher: FetcherStates["Idle"] = {
      state: "idle",
      data: result.data,
      formMethod: undefined,
      formAction: undefined,
      formEncType: undefined,
      formData: undefined,
      " _hasFetcherDoneAnything ": true,
    };
    state.fetchers.set(key, doneFetcher);
    updateState({ fetchers: new Map(state.fetchers) });
  }

  /**
   * Utility function to handle redirects returned from an action or loader.
   * Normally, a redirect "replaces" the navigation that triggered it.  So, for
   * example:
   *
   *  - user is on /a
   *  - user clicks a link to /b
   *  - loader for /b redirects to /c
   *
   * In a non-JS app the browser would track the in-flight navigation to /b and
   * then replace it with /c when it encountered the redirect response.  In
   * the end it would only ever update the URL bar with /c.
   *
   * In client-side routing using pushState/replaceState, we aim to emulate
   * this behavior and we also do not update history until the end of the
   * navigation (including processed redirects).  This means that we never
   * actually touch history until we've processed redirects, so we just use
   * the history action from the original navigation (PUSH or REPLACE).
   */
  async function startRedirectNavigation(
    state: RouterState,
    redirect: RedirectResult,
    {
      submission,
      replace,
      isFetchActionRedirect,
    }: {
      submission?: Submission;
      replace?: boolean;
      isFetchActionRedirect?: boolean;
    } = {}
  ) {
    if (redirect.revalidate) {
      isRevalidationRequired = true;
    }

    let redirectLocation = createLocation(
      state.location,
      redirect.location,
      // TODO: This can be removed once we get rid of useTransition in Remix v2
      {
        _isRedirect: true,
        ...(isFetchActionRedirect ? { _isFetchActionRedirect: true } : {}),
      }
    );
    invariant(
      redirectLocation,
      "Expected a location on the redirect navigation"
    );
    // Check if this an absolute external redirect that goes to a new origin
    if (ABSOLUTE_URL_REGEX.test(redirect.location) && isBrowser) {
      let url = init.history.createURL(redirect.location);
      let isDifferentBasename = stripBasename(url.pathname, basename) == null;

      if (routerWindow.location.origin !== url.origin || isDifferentBasename) {
        if (replace) {
          routerWindow.location.replace(redirect.location);
        } else {
          routerWindow.location.assign(redirect.location);
        }
        return;
      }
    }

    // There's no need to abort on redirects, since we don't detect the
    // redirect until the action/loaders have settled
    pendingNavigationController = null;

    let redirectHistoryAction =
      replace === true ? HistoryAction.Replace : HistoryAction.Push;

    // Use the incoming submission if provided, fallback on the active one in
    // state.navigation
    let { formMethod, formAction, formEncType, formData } = state.navigation;
    if (!submission && formMethod && formAction && formData && formEncType) {
      submission = {
        formMethod,
        formAction,
        formEncType,
        formData,
      };
    }

    // If this was a 307/308 submission we want to preserve the HTTP method and
    // re-submit the GET/POST/PUT/PATCH/DELETE as a submission navigation to the
    // redirected location
    if (
      redirectPreserveMethodStatusCodes.has(redirect.status) &&
      submission &&
      isMutationMethod(submission.formMethod)
    ) {
      await startNavigation(redirectHistoryAction, redirectLocation, {
        submission: {
          ...submission,
          formAction: redirect.location,
        },
        // Preserve this flag across redirects
        preventScrollReset: pendingPreventScrollReset,
      });
    } else if (isFetchActionRedirect) {
      // For a fetch action redirect, we kick off a new loading navigation
      // without the fetcher submission, but we send it along for shouldRevalidate
      await startNavigation(redirectHistoryAction, redirectLocation, {
        overrideNavigation: {
          state: "loading",
          location: redirectLocation,
          formMethod: undefined,
          formAction: undefined,
          formEncType: undefined,
          formData: undefined,
        },
        fetcherSubmission: submission,
        // Preserve this flag across redirects
        preventScrollReset: pendingPreventScrollReset,
      });
    } else {
      // Otherwise, we kick off a new loading navigation, preserving the
      // submission info for the duration of this navigation
      await startNavigation(redirectHistoryAction, redirectLocation, {
        overrideNavigation: {
          state: "loading",
          location: redirectLocation,
          formMethod: submission ? submission.formMethod : undefined,
          formAction: submission ? submission.formAction : undefined,
          formEncType: submission ? submission.formEncType : undefined,
          formData: submission ? submission.formData : undefined,
        },
        // Preserve this flag across redirects
        preventScrollReset: pendingPreventScrollReset,
      });
    }
  }

  async function callLoadersAndMaybeResolveData(
    currentMatches: AgnosticDataRouteMatch[],
    matches: AgnosticDataRouteMatch[],
    matchesToLoad: AgnosticDataRouteMatch[],
    fetchersToLoad: RevalidatingFetcher[],
    request: Request
  ) {
    // Call all navigation loaders and revalidating fetcher loaders in parallel,
    // then slice off the results into separate arrays so we can handle them
    // accordingly
    let results = await Promise.all([
      ...matchesToLoad.map((match) =>
        callLoaderOrAction(
          "loader",
          request,
          match,
          matches,
          manifest,
          mapRouteProperties,
          basename
        )
      ),
      ...fetchersToLoad.map((f) => {
        if (f.matches && f.match && f.controller) {
          return callLoaderOrAction(
            "loader",
            createClientSideRequest(init.history, f.path, f.controller.signal),
            f.match,
            f.matches,
            manifest,
            mapRouteProperties,
            basename
          );
        } else {
          let error: ErrorResult = {
            type: ResultType.error,
            error: getInternalRouterError(404, { pathname: f.path }),
          };
          return error;
        }
      }),
    ]);
    let loaderResults = results.slice(0, matchesToLoad.length);
    let fetcherResults = results.slice(matchesToLoad.length);

    await Promise.all([
      resolveDeferredResults(
        currentMatches,
        matchesToLoad,
        loaderResults,
        loaderResults.map(() => request.signal),
        false,
        state.loaderData
      ),
      resolveDeferredResults(
        currentMatches,
        fetchersToLoad.map((f) => f.match),
        fetcherResults,
        fetchersToLoad.map((f) => (f.controller ? f.controller.signal : null)),
        true
      ),
    ]);

    return { results, loaderResults, fetcherResults };
  }

  function interruptActiveLoads() {
    // Every interruption triggers a revalidation
    isRevalidationRequired = true;

    // Cancel pending route-level deferreds and mark cancelled routes for
    // revalidation
    cancelledDeferredRoutes.push(...cancelActiveDeferreds());

    // Abort in-flight fetcher loads
    fetchLoadMatches.forEach((_, key) => {
      if (fetchControllers.has(key)) {
        cancelledFetcherLoads.push(key);
        abortFetcher(key);
      }
    });
  }

  function setFetcherError(key: string, routeId: string, error: any) {
    let boundaryMatch = findNearestBoundary(state.matches, routeId);
    deleteFetcher(key);
    updateState({
      errors: {
        [boundaryMatch.route.id]: error,
      },
      fetchers: new Map(state.fetchers),
    });
  }

  function deleteFetcher(key: string): void {
    if (fetchControllers.has(key)) abortFetcher(key);
    fetchLoadMatches.delete(key);
    fetchReloadIds.delete(key);
    fetchRedirectIds.delete(key);
    state.fetchers.delete(key);
  }

  function abortFetcher(key: string) {
    let controller = fetchControllers.get(key);
    invariant(controller, `Expected fetch controller: ${key}`);
    controller.abort();
    fetchControllers.delete(key);
  }

  function markFetchersDone(keys: string[]) {
    for (let key of keys) {
      let fetcher = getFetcher(key);
      let doneFetcher: FetcherStates["Idle"] = {
        state: "idle",
        data: fetcher.data,
        formMethod: undefined,
        formAction: undefined,
        formEncType: undefined,
        formData: undefined,
        " _hasFetcherDoneAnything ": true,
      };
      state.fetchers.set(key, doneFetcher);
    }
  }

  function markFetchRedirectsDone(): boolean {
    let doneKeys = [];
    let updatedFetchers = false;
    for (let key of fetchRedirectIds) {
      let fetcher = state.fetchers.get(key);
      invariant(fetcher, `Expected fetcher: ${key}`);
      if (fetcher.state === "loading") {
        fetchRedirectIds.delete(key);
        doneKeys.push(key);
        updatedFetchers = true;
      }
    }
    markFetchersDone(doneKeys);
    return updatedFetchers;
  }

  function abortStaleFetchLoads(landedId: number): boolean {
    let yeetedKeys = [];
    for (let [key, id] of fetchReloadIds) {
      if (id < landedId) {
        let fetcher = state.fetchers.get(key);
        invariant(fetcher, `Expected fetcher: ${key}`);
        if (fetcher.state === "loading") {
          abortFetcher(key);
          fetchReloadIds.delete(key);
          yeetedKeys.push(key);
        }
      }
    }
    markFetchersDone(yeetedKeys);
    return yeetedKeys.length > 0;
  }

  function getBlocker(key: string, fn: BlockerFunction) {
    let blocker: Blocker = state.blockers.get(key) || IDLE_BLOCKER;

    if (blockerFunctions.get(key) !== fn) {
      blockerFunctions.set(key, fn);
    }

    return blocker;
  }

  function deleteBlocker(key: string) {
    state.blockers.delete(key);
    blockerFunctions.delete(key);
  }

  // Utility function to update blockers, ensuring valid state transitions
  function updateBlocker(key: string, newBlocker: Blocker) {
    let blocker = state.blockers.get(key) || IDLE_BLOCKER;

    // Poor mans state machine :)
    // https://mermaid.live/edit#pako:eNqVkc9OwzAMxl8l8nnjAYrEtDIOHEBIgwvKJTReGy3_lDpIqO27k6awMG0XcrLlnz87nwdonESogKXXBuE79rq75XZO3-yHds0RJVuv70YrPlUrCEe2HfrORS3rubqZfuhtpg5C9wk5tZ4VKcRUq88q9Z8RS0-48cE1iHJkL0ugbHuFLus9L6spZy8nX9MP2CNdomVaposqu3fGayT8T8-jJQwhepo_UtpgBQaDEUom04dZhAN1aJBDlUKJBxE1ceB2Smj0Mln-IBW5AFU2dwUiktt_2Qaq2dBfaKdEup85UV7Yd-dKjlnkabl2Pvr0DTkTreM
    invariant(
      (blocker.state === "unblocked" && newBlocker.state === "blocked") ||
        (blocker.state === "blocked" && newBlocker.state === "blocked") ||
        (blocker.state === "blocked" && newBlocker.state === "proceeding") ||
        (blocker.state === "blocked" && newBlocker.state === "unblocked") ||
        (blocker.state === "proceeding" && newBlocker.state === "unblocked"),
      `Invalid blocker state transition: ${blocker.state} -> ${newBlocker.state}`
    );

    state.blockers.set(key, newBlocker);
    updateState({ blockers: new Map(state.blockers) });
  }

  function shouldBlockNavigation({
    currentLocation,
    nextLocation,
    historyAction,
  }: {
    currentLocation: Location;
    nextLocation: Location;
    historyAction: HistoryAction;
  }): string | undefined {
    if (blockerFunctions.size === 0) {
      return;
    }

    // We ony support a single active blocker at the moment since we don't have
    // any compelling use cases for multi-blocker yet
    if (blockerFunctions.size > 1) {
      warning(false, "A router only supports one blocker at a time");
    }

    let entries = Array.from(blockerFunctions.entries());
    let [blockerKey, blockerFunction] = entries[entries.length - 1];
    let blocker = state.blockers.get(blockerKey);

    if (blocker && blocker.state === "proceeding") {
      // If the blocker is currently proceeding, we don't need to re-check
      // it and can let this navigation continue
      return;
    }

    // At this point, we know we're unblocked/blocked so we need to check the
    // user-provided blocker function
    if (blockerFunction({ currentLocation, nextLocation, historyAction })) {
      return blockerKey;
    }
  }

  function cancelActiveDeferreds(
    predicate?: (routeId: string) => boolean
  ): string[] {
    let cancelledRouteIds: string[] = [];
    activeDeferreds.forEach((dfd, routeId) => {
      if (!predicate || predicate(routeId)) {
        // Cancel the deferred - but do not remove from activeDeferreds here -
        // we rely on the subscribers to do that so our tests can assert proper
        // cleanup via _internalActiveDeferreds
        dfd.cancel();
        cancelledRouteIds.push(routeId);
        activeDeferreds.delete(routeId);
      }
    });
    return cancelledRouteIds;
  }

  // Opt in to capturing and reporting scroll positions during navigations,
  // used by the <ScrollRestoration> component
  function enableScrollRestoration(
    positions: Record<string, number>,
    getPosition: GetScrollPositionFunction,
    getKey?: GetScrollRestorationKeyFunction
  ) {
    savedScrollPositions = positions;
    getScrollPosition = getPosition;
    getScrollRestorationKey = getKey || ((location) => location.key);

    // Perform initial hydration scroll restoration, since we miss the boat on
    // the initial updateState() because we've not yet rendered <ScrollRestoration/>
    // and therefore have no savedScrollPositions available
    if (!initialScrollRestored && state.navigation === IDLE_NAVIGATION) {
      initialScrollRestored = true;
      let y = getSavedScrollPosition(state.location, state.matches);
      if (y != null) {
        updateState({ restoreScrollPosition: y });
      }
    }

    return () => {
      savedScrollPositions = null;
      getScrollPosition = null;
      getScrollRestorationKey = null;
    };
  }

  function saveScrollPosition(
    location: Location,
    matches: AgnosticDataRouteMatch[]
  ): void {
    if (savedScrollPositions && getScrollRestorationKey && getScrollPosition) {
      let userMatches = matches.map((m) =>
        createUseMatchesMatch(m, state.loaderData)
      );
      let key = getScrollRestorationKey(location, userMatches) || location.key;
      savedScrollPositions[key] = getScrollPosition();
    }
  }

  function getSavedScrollPosition(
    location: Location,
    matches: AgnosticDataRouteMatch[]
  ): number | null {
    if (savedScrollPositions && getScrollRestorationKey && getScrollPosition) {
      let userMatches = matches.map((m) =>
        createUseMatchesMatch(m, state.loaderData)
      );
      let key = getScrollRestorationKey(location, userMatches) || location.key;
      let y = savedScrollPositions[key];
      if (typeof y === "number") {
        return y;
      }
    }
    return null;
  }

  function _internalSetRoutes(newRoutes: AgnosticDataRouteObject[]) {
    manifest = {};
    inFlightDataRoutes = convertRoutesToDataRoutes(
      newRoutes,
      mapRouteProperties,
      undefined,
      manifest
    );
  }

  router = {
    get basename() {
      return basename;
    },
    get state() {
      return state;
    },
    get routes() {
      return dataRoutes;
    },
    initialize,
    subscribe,
    enableScrollRestoration,
    navigate,
    fetch,
    revalidate,
    // Passthrough to history-aware createHref used by useHref so we get proper
    // hash-aware URLs in DOM paths
    createHref: (to: To) => init.history.createHref(to),
    encodeLocation: (to: To) => init.history.encodeLocation(to),
    getFetcher,
    deleteFetcher,
    dispose,
    getBlocker,
    deleteBlocker,
    _internalFetchControllers: fetchControllers,
    _internalActiveDeferreds: activeDeferreds,
    // TODO: Remove setRoutes, it's temporary to avoid dealing with
    // updating the tree while validating the update algorithm.
    _internalSetRoutes,
  };

  return router;
}
//#endregion

////////////////////////////////////////////////////////////////////////////////
//#region createStaticHandler
////////////////////////////////////////////////////////////////////////////////

export const UNSAFE_DEFERRED_SYMBOL = Symbol("deferred");

export interface CreateStaticHandlerOptions {
  basename?: string;
  /**
   * @deprecated Use `mapRouteProperties` instead
   */
  detectErrorBoundary?: DetectErrorBoundaryFunction;
  mapRouteProperties?: MapRoutePropertiesFunction;
}

export function createStaticHandler(
  routes: AgnosticRouteObject[],
  opts?: CreateStaticHandlerOptions
): StaticHandler {
  invariant(
    routes.length > 0,
    "You must provide a non-empty routes array to createStaticHandler"
  );

  let manifest: RouteManifest = {};
  let basename = (opts ? opts.basename : null) || "/";
  let mapRouteProperties: MapRoutePropertiesFunction;
  if (opts?.mapRouteProperties) {
    mapRouteProperties = opts.mapRouteProperties;
  } else if (opts?.detectErrorBoundary) {
    // If they are still using the deprecated version, wrap it with the new API
    let detectErrorBoundary = opts.detectErrorBoundary;
    mapRouteProperties = (route) => ({
      hasErrorBoundary: detectErrorBoundary(route),
    });
  } else {
    mapRouteProperties = defaultMapRouteProperties;
  }

  let dataRoutes = convertRoutesToDataRoutes(
    routes,
    mapRouteProperties,
    undefined,
    manifest
  );

  /**
   * The query() method is intended for document requests, in which we want to
   * call an optional action and potentially multiple loaders for all nested
   * routes.  It returns a StaticHandlerContext object, which is very similar
   * to the router state (location, loaderData, actionData, errors, etc.) and
   * also adds SSR-specific information such as the statusCode and headers
   * from action/loaders Responses.
   *
   * It _should_ never throw and should report all errors through the
   * returned context.errors object, properly associating errors to their error
   * boundary.  Additionally, it tracks _deepestRenderedBoundaryId which can be
   * used to emulate React error boundaries during SSr by performing a second
   * pass only down to the boundaryId.
   *
   * The one exception where we do not return a StaticHandlerContext is when a
   * redirect response is returned or thrown from any action/loader.  We
   * propagate that out and return the raw Response so the HTTP server can
   * return it directly.
   */
  async function query(
    request: Request,
    { requestContext }: { requestContext?: unknown } = {}
  ): Promise<StaticHandlerContext | Response> {
    let url = new URL(request.url);
    let method = request.method;
    let location = createLocation("", createPath(url), null, "default");
    let matches = matchRoutes(dataRoutes, location, basename);

    // SSR supports HEAD requests while SPA doesn't
    if (!isValidMethod(method) && method !== "HEAD") {
      let error = getInternalRouterError(405, { method });
      let { matches: methodNotAllowedMatches, route } =
        getShortCircuitMatches(dataRoutes);
      return {
        basename,
        location,
        matches: methodNotAllowedMatches,
        loaderData: {},
        actionData: null,
        errors: {
          [route.id]: error,
        },
        statusCode: error.status,
        loaderHeaders: {},
        actionHeaders: {},
        activeDeferreds: null,
      };
    } else if (!matches) {
      let error = getInternalRouterError(404, { pathname: location.pathname });
      let { matches: notFoundMatches, route } =
        getShortCircuitMatches(dataRoutes);
      return {
        basename,
        location,
        matches: notFoundMatches,
        loaderData: {},
        actionData: null,
        errors: {
          [route.id]: error,
        },
        statusCode: error.status,
        loaderHeaders: {},
        actionHeaders: {},
        activeDeferreds: null,
      };
    }

    let result = await queryImpl(request, location, matches, requestContext);
    if (isResponse(result)) {
      return result;
    }

    // When returning StaticHandlerContext, we patch back in the location here
    // since we need it for React Context.  But this helps keep our submit and
    // loadRouteData operating on a Request instead of a Location
    return { location, basename, ...result };
  }

  /**
   * The queryRoute() method is intended for targeted route requests, either
   * for fetch ?_data requests or resource route requests.  In this case, we
   * are only ever calling a single action or loader, and we are returning the
   * returned value directly.  In most cases, this will be a Response returned
   * from the action/loader, but it may be a primitive or other value as well -
   * and in such cases the calling context should handle that accordingly.
   *
   * We do respect the throw/return differentiation, so if an action/loader
   * throws, then this method will throw the value.  This is important so we
   * can do proper boundary identification in Remix where a thrown Response
   * must go to the Catch Boundary but a returned Response is happy-path.
   *
   * One thing to note is that any Router-initiated Errors that make sense
   * to associate with a status code will be thrown as an ErrorResponse
   * instance which include the raw Error, such that the calling context can
   * serialize the error as they see fit while including the proper response
   * code.  Examples here are 404 and 405 errors that occur prior to reaching
   * any user-defined loaders.
   */
  async function queryRoute(
    request: Request,
    {
      routeId,
      requestContext,
    }: { requestContext?: unknown; routeId?: string } = {}
  ): Promise<any> {
    let url = new URL(request.url);
    let method = request.method;
    let location = createLocation("", createPath(url), null, "default");
    let matches = matchRoutes(dataRoutes, location, basename);

    // SSR supports HEAD requests while SPA doesn't
    if (!isValidMethod(method) && method !== "HEAD" && method !== "OPTIONS") {
      throw getInternalRouterError(405, { method });
    } else if (!matches) {
      throw getInternalRouterError(404, { pathname: location.pathname });
    }

    let match = routeId
      ? matches.find((m) => m.route.id === routeId)
      : getTargetMatch(matches, location);

    if (routeId && !match) {
      throw getInternalRouterError(403, {
        pathname: location.pathname,
        routeId,
      });
    } else if (!match) {
      // This should never hit I don't think?
      throw getInternalRouterError(404, { pathname: location.pathname });
    }

    let result = await queryImpl(
      request,
      location,
      matches,
      requestContext,
      match
    );
    if (isResponse(result)) {
      return result;
    }

    let error = result.errors ? Object.values(result.errors)[0] : undefined;
    if (error !== undefined) {
      // If we got back result.errors, that means the loader/action threw
      // _something_ that wasn't a Response, but it's not guaranteed/required
      // to be an `instanceof Error` either, so we have to use throw here to
      // preserve the "error" state outside of queryImpl.
      throw error;
    }

    // Pick off the right state value to return
    if (result.actionData) {
      return Object.values(result.actionData)[0];
    }

    if (result.loaderData) {
      let data = Object.values(result.loaderData)[0];
      if (result.activeDeferreds?.[match.route.id]) {
        data[UNSAFE_DEFERRED_SYMBOL] = result.activeDeferreds[match.route.id];
      }
      return data;
    }

    return undefined;
  }

  async function queryImpl(
    request: Request,
    location: Location,
    matches: AgnosticDataRouteMatch[],
    requestContext: unknown,
    routeMatch?: AgnosticDataRouteMatch
  ): Promise<Omit<StaticHandlerContext, "location" | "basename"> | Response> {
    invariant(
      request.signal,
      "query()/queryRoute() requests must contain an AbortController signal"
    );

    try {
      if (isMutationMethod(request.method.toLowerCase())) {
        let result = await submit(
          request,
          matches,
          routeMatch || getTargetMatch(matches, location),
          requestContext,
          routeMatch != null
        );
        return result;
      }

      let result = await loadRouteData(
        request,
        matches,
        requestContext,
        routeMatch
      );
      return isResponse(result)
        ? result
        : {
            ...result,
            actionData: null,
            actionHeaders: {},
          };
    } catch (e) {
      // If the user threw/returned a Response in callLoaderOrAction, we throw
      // it to bail out and then return or throw here based on whether the user
      // returned or threw
      if (isQueryRouteResponse(e)) {
        if (e.type === ResultType.error && !isRedirectResponse(e.response)) {
          throw e.response;
        }
        return e.response;
      }
      // Redirects are always returned since they don't propagate to catch
      // boundaries
      if (isRedirectResponse(e)) {
        return e;
      }
      throw e;
    }
  }

  async function submit(
    request: Request,
    matches: AgnosticDataRouteMatch[],
    actionMatch: AgnosticDataRouteMatch,
    requestContext: unknown,
    isRouteRequest: boolean
  ): Promise<Omit<StaticHandlerContext, "location" | "basename"> | Response> {
    let result: DataResult;

    if (!actionMatch.route.action && !actionMatch.route.lazy) {
      let error = getInternalRouterError(405, {
        method: request.method,
        pathname: new URL(request.url).pathname,
        routeId: actionMatch.route.id,
      });
      if (isRouteRequest) {
        throw error;
      }
      result = {
        type: ResultType.error,
        error,
      };
    } else {
      result = await callLoaderOrAction(
        "action",
        request,
        actionMatch,
        matches,
        manifest,
        mapRouteProperties,
        basename,
        true,
        isRouteRequest,
        requestContext
      );

      if (request.signal.aborted) {
        let method = isRouteRequest ? "queryRoute" : "query";
        throw new Error(`${method}() call aborted`);
      }
    }

    if (isRedirectResult(result)) {
      // Uhhhh - this should never happen, we should always throw these from
      // callLoaderOrAction, but the type narrowing here keeps TS happy and we
      // can get back on the "throw all redirect responses" train here should
      // this ever happen :/
      throw new Response(null, {
        status: result.status,
        headers: {
          Location: result.location,
        },
      });
    }

    if (isDeferredResult(result)) {
      let error = getInternalRouterError(400, { type: "defer-action" });
      if (isRouteRequest) {
        throw error;
      }
      result = {
        type: ResultType.error,
        error,
      };
    }

    if (isRouteRequest) {
      // Note: This should only be non-Response values if we get here, since
      // isRouteRequest should throw any Response received in callLoaderOrAction
      if (isErrorResult(result)) {
        throw result.error;
      }

      return {
        matches: [actionMatch],
        loaderData: {},
        actionData: { [actionMatch.route.id]: result.data },
        errors: null,
        // Note: statusCode + headers are unused here since queryRoute will
        // return the raw Response or value
        statusCode: 200,
        loaderHeaders: {},
        actionHeaders: {},
        activeDeferreds: null,
      };
    }

    if (isErrorResult(result)) {
      // Store off the pending error - we use it to determine which loaders
      // to call and will commit it when we complete the navigation
      let boundaryMatch = findNearestBoundary(matches, actionMatch.route.id);
      let context = await loadRouteData(
        request,
        matches,
        requestContext,
        undefined,
        {
          [boundaryMatch.route.id]: result.error,
        }
      );

      // action status codes take precedence over loader status codes
      return {
        ...context,
        statusCode: isRouteErrorResponse(result.error)
          ? result.error.status
          : 500,
        actionData: null,
        actionHeaders: {
          ...(result.headers ? { [actionMatch.route.id]: result.headers } : {}),
        },
      };
    }

    // Create a GET request for the loaders
    let loaderRequest = new Request(request.url, {
      headers: request.headers,
      redirect: request.redirect,
      signal: request.signal,
    });
    let context = await loadRouteData(loaderRequest, matches, requestContext);

    return {
      ...context,
      // action status codes take precedence over loader status codes
      ...(result.statusCode ? { statusCode: result.statusCode } : {}),
      actionData: {
        [actionMatch.route.id]: result.data,
      },
      actionHeaders: {
        ...(result.headers ? { [actionMatch.route.id]: result.headers } : {}),
      },
    };
  }

  async function loadRouteData(
    request: Request,
    matches: AgnosticDataRouteMatch[],
    requestContext: unknown,
    routeMatch?: AgnosticDataRouteMatch,
    pendingActionError?: RouteData
  ): Promise<
    | Omit<
        StaticHandlerContext,
        "location" | "basename" | "actionData" | "actionHeaders"
      >
    | Response
  > {
    let isRouteRequest = routeMatch != null;

    // Short circuit if we have no loaders to run (queryRoute())
    if (
      isRouteRequest &&
      !routeMatch?.route.loader &&
      !routeMatch?.route.lazy
    ) {
      throw getInternalRouterError(400, {
        method: request.method,
        pathname: new URL(request.url).pathname,
        routeId: routeMatch?.route.id,
      });
    }

    let requestMatches = routeMatch
      ? [routeMatch]
      : getLoaderMatchesUntilBoundary(
          matches,
          Object.keys(pendingActionError || {})[0]
        );
    let matchesToLoad = requestMatches.filter(
      (m) => m.route.loader || m.route.lazy
    );

    // Short circuit if we have no loaders to run (query())
    if (matchesToLoad.length === 0) {
      return {
        matches,
        // Add a null for all matched routes for proper revalidation on the client
        loaderData: matches.reduce(
          (acc, m) => Object.assign(acc, { [m.route.id]: null }),
          {}
        ),
        errors: pendingActionError || null,
        statusCode: 200,
        loaderHeaders: {},
        activeDeferreds: null,
      };
    }

    let results = await Promise.all([
      ...matchesToLoad.map((match) =>
        callLoaderOrAction(
          "loader",
          request,
          match,
          matches,
          manifest,
          mapRouteProperties,
          basename,
          true,
          isRouteRequest,
          requestContext
        )
      ),
    ]);

    if (request.signal.aborted) {
      let method = isRouteRequest ? "queryRoute" : "query";
      throw new Error(`${method}() call aborted`);
    }

    // Process and commit output from loaders
    let activeDeferreds = new Map<string, DeferredData>();
    let context = processRouteLoaderData(
      matches,
      matchesToLoad,
      results,
      pendingActionError,
      activeDeferreds
    );

    // Add a null for any non-loader matches for proper revalidation on the client
    let executedLoaders = new Set<string>(
      matchesToLoad.map((match) => match.route.id)
    );
    matches.forEach((match) => {
      if (!executedLoaders.has(match.route.id)) {
        context.loaderData[match.route.id] = null;
      }
    });

    return {
      ...context,
      matches,
      activeDeferreds:
        activeDeferreds.size > 0
          ? Object.fromEntries(activeDeferreds.entries())
          : null,
    };
  }

  return {
    dataRoutes,
    query,
    queryRoute,
  };
}

//#endregion

////////////////////////////////////////////////////////////////////////////////
//#region Helpers
////////////////////////////////////////////////////////////////////////////////

/**
 * Given an existing StaticHandlerContext and an error thrown at render time,
 * provide an updated StaticHandlerContext suitable for a second SSR render
 */
export function getStaticContextFromError(
  routes: AgnosticDataRouteObject[],
  context: StaticHandlerContext,
  error: any
) {
  let newContext: StaticHandlerContext = {
    ...context,
    statusCode: 500,
    errors: {
      [context._deepestRenderedBoundaryId || routes[0].id]: error,
    },
  };
  return newContext;
}

function isSubmissionNavigation(
  opts: RouterNavigateOptions
): opts is SubmissionNavigateOptions {
  return opts != null && "formData" in opts;
}

function normalizeTo(
  location: Path,
  matches: AgnosticDataRouteMatch[],
  basename: string,
  prependBasename: boolean,
  to: To | null,
  fromRouteId?: string,
  relative?: RelativeRoutingType
) {
  let contextualMatches: AgnosticDataRouteMatch[];
  let activeRouteMatch: AgnosticDataRouteMatch | undefined;
  if (fromRouteId != null && relative !== "path") {
    // Grab matches up to the calling route so our route-relative logic is
    // relative to the correct source route.  When using relative:path,
    // fromRouteId is ignored since that is always relative to the current
    // location path
    contextualMatches = [];
    for (let match of matches) {
      contextualMatches.push(match);
      if (match.route.id === fromRouteId) {
        activeRouteMatch = match;
        break;
      }
    }
  } else {
    contextualMatches = matches;
    activeRouteMatch = matches[matches.length - 1];
  }

  // Resolve the relative path
  let path = resolveTo(
    to ? to : ".",
    getPathContributingMatches(contextualMatches).map((m) => m.pathnameBase),
    stripBasename(location.pathname, basename) || location.pathname,
    relative === "path"
  );

  // When `to` is not specified we inherit search/hash from the current
  // location, unlike when to="." and we just inherit the path.
  // See https://github.com/remix-run/remix/issues/927
  if (to == null) {
    path.search = location.search;
    path.hash = location.hash;
  }

  // Add an ?index param for matched index routes if we don't already have one
  if (
    (to == null || to === "" || to === ".") &&
    activeRouteMatch &&
    activeRouteMatch.route.index &&
    !hasNakedIndexQuery(path.search)
  ) {
    path.search = path.search
      ? path.search.replace(/^\?/, "?index&")
      : "?index";
  }

  // If we're operating within a basename, prepend it to the pathname.  If
  // this is a root navigation, then just use the raw basename which allows
  // the basename to have full control over the presence of a trailing slash
  // on root actions
  if (prependBasename && basename !== "/") {
    path.pathname =
      path.pathname === "/" ? basename : joinPaths([basename, path.pathname]);
  }

  return createPath(path);
}

// Normalize navigation options by converting formMethod=GET formData objects to
// URLSearchParams so they behave identically to links with query params
function normalizeNavigateOptions(
  normalizeFormMethod: boolean,
  isFetcher: boolean,
  path: string,
  opts?: RouterNavigateOptions
): {
  path: string;
  submission?: Submission;
  error?: ErrorResponse;
} {
  // Return location verbatim on non-submission navigations
  if (!opts || !isSubmissionNavigation(opts)) {
    return { path };
  }

  if (opts.formMethod && !isValidMethod(opts.formMethod)) {
    return {
      path,
      error: getInternalRouterError(405, { method: opts.formMethod }),
    };
  }

  // Create a Submission on non-GET navigations
  let submission: Submission | undefined;
  if (opts.formData) {
    let formMethod = opts.formMethod || "get";
    submission = {
      formMethod: normalizeFormMethod
        ? (formMethod.toUpperCase() as V7_FormMethod)
        : (formMethod.toLowerCase() as FormMethod),
      formAction: stripHashFromPath(path),
      formEncType:
        (opts && opts.formEncType) || "application/x-www-form-urlencoded",
      formData: opts.formData,
    };

    if (isMutationMethod(submission.formMethod)) {
      return { path, submission };
    }
  }

  // Flatten submission onto URLSearchParams for GET submissions
  let parsedPath = parsePath(path);
  let searchParams = convertFormDataToSearchParams(opts.formData);
  // On GET navigation submissions we can drop the ?index param from the
  // resulting location since all loaders will run.  But fetcher GET submissions
  // only run a single loader so we need to preserve any incoming ?index params
  if (isFetcher && parsedPath.search && hasNakedIndexQuery(parsedPath.search)) {
    searchParams.append("index", "");
  }
  parsedPath.search = `?${searchParams}`;

  return { path: createPath(parsedPath), submission };
}

// Filter out all routes below any caught error as they aren't going to
// render so we don't need to load them
function getLoaderMatchesUntilBoundary(
  matches: AgnosticDataRouteMatch[],
  boundaryId?: string
) {
  let boundaryMatches = matches;
  if (boundaryId) {
    let index = matches.findIndex((m) => m.route.id === boundaryId);
    if (index >= 0) {
      boundaryMatches = matches.slice(0, index);
    }
  }
  return boundaryMatches;
}

function getMatchesToLoad(
  history: History,
  state: RouterState,
  matches: AgnosticDataRouteMatch[],
  submission: Submission | undefined,
  location: Location,
  isRevalidationRequired: boolean,
  cancelledDeferredRoutes: string[],
  cancelledFetcherLoads: string[],
  fetchLoadMatches: Map<string, FetchLoadMatch>,
  routesToUse: AgnosticDataRouteObject[],
  basename: string | undefined,
  pendingActionData?: RouteData,
  pendingError?: RouteData
): [AgnosticDataRouteMatch[], RevalidatingFetcher[]] {
  let actionResult = pendingError
    ? Object.values(pendingError)[0]
    : pendingActionData
    ? Object.values(pendingActionData)[0]
    : undefined;

  let currentUrl = history.createURL(state.location);
  let nextUrl = history.createURL(location);

  // Pick navigation matches that are net-new or qualify for revalidation
  let boundaryId = pendingError ? Object.keys(pendingError)[0] : undefined;
  let boundaryMatches = getLoaderMatchesUntilBoundary(matches, boundaryId);

  let navigationMatches = boundaryMatches.filter((match, index) => {
    if (match.route.lazy) {
      // We haven't loaded this route yet so we don't know if it's got a loader!
      return true;
    }
    if (match.route.loader == null) {
      return false;
    }

    // Always call the loader on new route instances and pending defer cancellations
    if (
      isNewLoader(state.loaderData, state.matches[index], match) ||
      cancelledDeferredRoutes.some((id) => id === match.route.id)
    ) {
      return true;
    }

    // This is the default implementation for when we revalidate.  If the route
    // provides it's own implementation, then we give them full control but
    // provide this value so they can leverage it if needed after they check
    // their own specific use cases
    let currentRouteMatch = state.matches[index];
    let nextRouteMatch = match;

    return shouldRevalidateLoader(match, {
      currentUrl,
      currentParams: currentRouteMatch.params,
      nextUrl,
      nextParams: nextRouteMatch.params,
      ...submission,
      actionResult,
      defaultShouldRevalidate:
        // Forced revalidation due to submission, useRevalidator, or X-Remix-Revalidate
        isRevalidationRequired ||
        // Clicked the same link, resubmitted a GET form
        currentUrl.pathname + currentUrl.search ===
          nextUrl.pathname + nextUrl.search ||
        // Search params affect all loaders
        currentUrl.search !== nextUrl.search ||
        isNewRouteInstance(currentRouteMatch, nextRouteMatch),
    });
  });

  // Pick fetcher.loads that need to be revalidated
  let revalidatingFetchers: RevalidatingFetcher[] = [];
  fetchLoadMatches.forEach((f, key) => {
    // Don't revalidate if fetcher won't be present in the subsequent render
    if (!matches.some((m) => m.route.id === f.routeId)) {
      return;
    }

    let fetcherMatches = matchRoutes(routesToUse, f.path, basename);

    // If the fetcher path no longer matches, push it in with null matches so
    // we can trigger a 404 in callLoadersAndMaybeResolveData
    if (!fetcherMatches) {
      revalidatingFetchers.push({
        key,
        routeId: f.routeId,
        path: f.path,
        matches: null,
        match: null,
        controller: null,
      });
      return;
    }

    let fetcherMatch = getTargetMatch(fetcherMatches, f.path);

    if (cancelledFetcherLoads.includes(key)) {
      revalidatingFetchers.push({
        key,
        routeId: f.routeId,
        path: f.path,
        matches: fetcherMatches,
        match: fetcherMatch,
        controller: new AbortController(),
      });
      return;
    }

    // Revalidating fetchers are decoupled from the route matches since they
    // hit a static href, so they _always_ check shouldRevalidate and the
    // default is strictly if a revalidation is explicitly required (action
    // submissions, useRevalidator, X-Remix-Revalidate).
    let shouldRevalidate = shouldRevalidateLoader(fetcherMatch, {
      currentUrl,
      currentParams: state.matches[state.matches.length - 1].params,
      nextUrl,
      nextParams: matches[matches.length - 1].params,
      ...submission,
      actionResult,
      // Forced revalidation due to submission, useRevalidator, or X-Remix-Revalidate
      defaultShouldRevalidate: isRevalidationRequired,
    });
    if (shouldRevalidate) {
      revalidatingFetchers.push({
        key,
        routeId: f.routeId,
        path: f.path,
        matches: fetcherMatches,
        match: fetcherMatch,
        controller: new AbortController(),
      });
    }
  });

  return [navigationMatches, revalidatingFetchers];
}

function isNewLoader(
  currentLoaderData: RouteData,
  currentMatch: AgnosticDataRouteMatch,
  match: AgnosticDataRouteMatch
) {
  let isNew =
    // [a] -> [a, b]
    !currentMatch ||
    // [a, b] -> [a, c]
    match.route.id !== currentMatch.route.id;

  // Handle the case that we don't have data for a re-used route, potentially
  // from a prior error or from a cancelled pending deferred
  let isMissingData = currentLoaderData[match.route.id] === undefined;

  // Always load if this is a net-new route or we don't yet have data
  return isNew || isMissingData;
}

function isNewRouteInstance(
  currentMatch: AgnosticDataRouteMatch,
  match: AgnosticDataRouteMatch
) {
  let currentPath = currentMatch.route.path;
  return (
    // param change for this match, /users/123 -> /users/456
    currentMatch.pathname !== match.pathname ||
    // splat param changed, which is not present in match.path
    // e.g. /files/images/avatar.jpg -> files/finances.xls
    (currentPath != null &&
      currentPath.endsWith("*") &&
      currentMatch.params["*"] !== match.params["*"])
  );
}

function shouldRevalidateLoader(
  loaderMatch: AgnosticDataRouteMatch,
  arg: Parameters<ShouldRevalidateFunction>[0]
) {
  if (loaderMatch.route.shouldRevalidate) {
    let routeChoice = loaderMatch.route.shouldRevalidate(arg);
    if (typeof routeChoice === "boolean") {
      return routeChoice;
    }
  }

  return arg.defaultShouldRevalidate;
}

/**
 * Execute route.lazy() methods to lazily load route modules (loader, action,
 * shouldRevalidate) and update the routeManifest in place which shares objects
 * with dataRoutes so those get updated as well.
 */
async function loadLazyRouteModule(
  route: AgnosticDataRouteObject,
  mapRouteProperties: MapRoutePropertiesFunction,
  manifest: RouteManifest
) {
  if (!route.lazy) {
    return;
  }

  let lazyRoute = await route.lazy();

  // If the lazy route function was executed and removed by another parallel
  // call then we can return - first lazy() to finish wins because the return
  // value of lazy is expected to be static
  if (!route.lazy) {
    return;
  }

  let routeToUpdate = manifest[route.id];
  invariant(routeToUpdate, "No route found in manifest");

  // Update the route in place.  This should be safe because there's no way
  // we could yet be sitting on this route as we can't get there without
  // resolving lazy() first.
  //
  // This is different than the HMR "update" use-case where we may actively be
  // on the route being updated.  The main concern boils down to "does this
  // mutation affect any ongoing navigations or any current state.matches
  // values?".  If not, it should be safe to update in place.
  let routeUpdates: Record<string, any> = {};
  for (let lazyRouteProperty in lazyRoute) {
    let staticRouteValue =
      routeToUpdate[lazyRouteProperty as keyof typeof routeToUpdate];

    let isPropertyStaticallyDefined =
      staticRouteValue !== undefined &&
      // This property isn't static since it should always be updated based
      // on the route updates
      lazyRouteProperty !== "hasErrorBoundary";

    warning(
      !isPropertyStaticallyDefined,
      `Route "${routeToUpdate.id}" has a static property "${lazyRouteProperty}" ` +
        `defined but its lazy function is also returning a value for this property. ` +
        `The lazy route property "${lazyRouteProperty}" will be ignored.`
    );

    if (
      !isPropertyStaticallyDefined &&
      !immutableRouteKeys.has(lazyRouteProperty as ImmutableRouteKey)
    ) {
      routeUpdates[lazyRouteProperty] =
        lazyRoute[lazyRouteProperty as keyof typeof lazyRoute];
    }
  }

  // Mutate the route with the provided updates.  Do this first so we pass
  // the updated version to mapRouteProperties
  Object.assign(routeToUpdate, routeUpdates);

  // Mutate the `hasErrorBoundary` property on the route based on the route
  // updates and remove the `lazy` function so we don't resolve the lazy
  // route again.
  Object.assign(routeToUpdate, {
    // To keep things framework agnostic, we use the provided
    // `mapRouteProperties` (or wrapped `detectErrorBoundary`) function to
    // set the framework-aware properties (`element`/`hasErrorBoundary`) since
    // the logic will differ between frameworks.
    ...mapRouteProperties(routeToUpdate),
    lazy: undefined,
  });
}

async function callLoaderOrAction(
  type: "loader" | "action",
  request: Request,
  match: AgnosticDataRouteMatch,
  matches: AgnosticDataRouteMatch[],
  manifest: RouteManifest,
  mapRouteProperties: MapRoutePropertiesFunction,
  basename: string,
  isStaticRequest: boolean = false,
  isRouteRequest: boolean = false,
  requestContext?: unknown
): Promise<DataResult> {
  let resultType;
  let result;
  let onReject: (() => void) | undefined;

  let runHandler = (handler: ActionFunction | LoaderFunction) => {
    // Setup a promise we can race against so that abort signals short circuit
    let reject: () => void;
    let abortPromise = new Promise((_, r) => (reject = r));
    onReject = () => reject();
    request.signal.addEventListener("abort", onReject);
    return Promise.race([
      handler({ request, params: match.params, context: requestContext }),
      abortPromise,
    ]);
  };

  try {
    let handler = match.route[type];

    if (match.route.lazy) {
      if (handler) {
        // Run statically defined handler in parallel with lazy()
        let values = await Promise.all([
          runHandler(handler),
          loadLazyRouteModule(match.route, mapRouteProperties, manifest),
        ]);
        result = values[0];
      } else {
        // Load lazy route module, then run any returned handler
        await loadLazyRouteModule(match.route, mapRouteProperties, manifest);

        handler = match.route[type];
        if (handler) {
          // Handler still run even if we got interrupted to maintain consistency
          // with un-abortable behavior of handler execution on non-lazy or
          // previously-lazy-loaded routes
          result = await runHandler(handler);
        } else if (type === "action") {
          let url = new URL(request.url);
          let pathname = url.pathname + url.search;
          throw getInternalRouterError(405, {
            method: request.method,
            pathname,
            routeId: match.route.id,
          });
        } else {
          // lazy() route has no loader to run.  Short circuit here so we don't
          // hit the invariant below that errors on returning undefined.
          return { type: ResultType.data, data: undefined };
        }
      }
    } else if (!handler) {
      let url = new URL(request.url);
      let pathname = url.pathname + url.search;
      throw getInternalRouterError(404, {
        pathname,
      });
    } else {
      result = await runHandler(handler);
    }

    invariant(
      result !== undefined,
      `You defined ${type === "action" ? "an action" : "a loader"} for route ` +
        `"${match.route.id}" but didn't return anything from your \`${type}\` ` +
        `function. Please return a value or \`null\`.`
    );
  } catch (e) {
    resultType = ResultType.error;
    result = e;
  } finally {
    if (onReject) {
      request.signal.removeEventListener("abort", onReject);
    }
  }

  if (isResponse(result)) {
    let status = result.status;

    // Process redirects
    if (redirectStatusCodes.has(status)) {
      let location = result.headers.get("Location");
      invariant(
        location,
        "Redirects returned/thrown from loaders/actions must have a Location header"
      );

      // Support relative routing in internal redirects
      if (!ABSOLUTE_URL_REGEX.test(location)) {
        location = normalizeTo(
          new URL(request.url),
          matches.slice(0, matches.indexOf(match) + 1),
          basename,
          true,
          location
        );
      } else if (!isStaticRequest) {
        // Strip off the protocol+origin for same-origin + same-basename absolute
        // redirects. If this is a static request, we can let it go back to the
        // browser as-is
        let currentUrl = new URL(request.url);
        let url = location.startsWith("//")
          ? new URL(currentUrl.protocol + location)
          : new URL(location);
        let isSameBasename = stripBasename(url.pathname, basename) != null;
        if (url.origin === currentUrl.origin && isSameBasename) {
          location = url.pathname + url.search + url.hash;
        }
      }

      // Don't process redirects in the router during static requests requests.
      // Instead, throw the Response and let the server handle it with an HTTP
      // redirect.  We also update the Location header in place in this flow so
      // basename and relative routing is taken into account
      if (isStaticRequest) {
        result.headers.set("Location", location);
        throw result;
      }

      return {
        type: ResultType.redirect,
        status,
        location,
        revalidate: result.headers.get("X-Remix-Revalidate") !== null,
      };
    }

    // For SSR single-route requests, we want to hand Responses back directly
    // without unwrapping.  We do this with the QueryRouteResponse wrapper
    // interface so we can know whether it was returned or thrown
    if (isRouteRequest) {
      // eslint-disable-next-line no-throw-literal
      throw {
        type: resultType || ResultType.data,
        response: result,
      };
    }

    let data: any;
    let contentType = result.headers.get("Content-Type");
    // Check between word boundaries instead of startsWith() due to the last
    // paragraph of https://httpwg.org/specs/rfc9110.html#field.content-type
    if (contentType && /\bapplication\/json\b/.test(contentType)) {
      data = await result.json();
    } else {
      data = await result.text();
    }

    if (resultType === ResultType.error) {
      return {
        type: resultType,
        error: new ErrorResponse(status, result.statusText, data),
        headers: result.headers,
      };
    }

    return {
      type: ResultType.data,
      data,
      statusCode: result.status,
      headers: result.headers,
    };
  }

  if (resultType === ResultType.error) {
    return { type: resultType, error: result };
  }

  if (isDeferredData(result)) {
    return {
      type: ResultType.deferred,
      deferredData: result,
      statusCode: result.init?.status,
      headers: result.init?.headers && new Headers(result.init.headers),
    };
  }

  return { type: ResultType.data, data: result };
}

// Utility method for creating the Request instances for loaders/actions during
// client-side navigations and fetches.  During SSR we will always have a
// Request instance from the static handler (query/queryRoute)
function createClientSideRequest(
  history: History,
  location: string | Location,
  signal: AbortSignal,
  submission?: Submission
): Request {
  let url = history.createURL(stripHashFromPath(location)).toString();
  let init: RequestInit = { signal };

  if (submission && isMutationMethod(submission.formMethod)) {
    let { formMethod, formEncType, formData } = submission;
    // Didn't think we needed this but it turns out unlike other methods, patch
    // won't be properly normalized to uppercase and results in a 405 error.
    // See: https://fetch.spec.whatwg.org/#concept-method
    init.method = formMethod.toUpperCase();
    init.body =
      formEncType === "application/x-www-form-urlencoded"
        ? convertFormDataToSearchParams(formData)
        : formData;
  }

  // Content-Type is inferred (https://fetch.spec.whatwg.org/#dom-request)
  return new Request(url, init);
}

function convertFormDataToSearchParams(formData: FormData): URLSearchParams {
  let searchParams = new URLSearchParams();

  for (let [key, value] of formData.entries()) {
    // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#converting-an-entry-list-to-a-list-of-name-value-pairs
    searchParams.append(key, value instanceof File ? value.name : value);
  }

  return searchParams;
}

function processRouteLoaderData(
  matches: AgnosticDataRouteMatch[],
  matchesToLoad: AgnosticDataRouteMatch[],
  results: DataResult[],
  pendingError: RouteData | undefined,
  activeDeferreds: Map<string, DeferredData>
): {
  loaderData: RouterState["loaderData"];
  errors: RouterState["errors"] | null;
  statusCode: number;
  loaderHeaders: Record<string, Headers>;
} {
  // Fill in loaderData/errors from our loaders
  let loaderData: RouterState["loaderData"] = {};
  let errors: RouterState["errors"] | null = null;
  let statusCode: number | undefined;
  let foundError = false;
  let loaderHeaders: Record<string, Headers> = {};

  // Process loader results into state.loaderData/state.errors
  results.forEach((result, index) => {
    let id = matchesToLoad[index].route.id;
    invariant(
      !isRedirectResult(result),
      "Cannot handle redirect results in processLoaderData"
    );
    if (isErrorResult(result)) {
      // Look upwards from the matched route for the closest ancestor
      // error boundary, defaulting to the root match
      let boundaryMatch = findNearestBoundary(matches, id);
      let error = result.error;
      // If we have a pending action error, we report it at the highest-route
      // that throws a loader error, and then clear it out to indicate that
      // it was consumed
      if (pendingError) {
        error = Object.values(pendingError)[0];
        pendingError = undefined;
      }

      errors = errors || {};

      // Prefer higher error values if lower errors bubble to the same boundary
      if (errors[boundaryMatch.route.id] == null) {
        errors[boundaryMatch.route.id] = error;
      }

      // Clear our any prior loaderData for the throwing route
      loaderData[id] = undefined;

      // Once we find our first (highest) error, we set the status code and
      // prevent deeper status codes from overriding
      if (!foundError) {
        foundError = true;
        statusCode = isRouteErrorResponse(result.error)
          ? result.error.status
          : 500;
      }
      if (result.headers) {
        loaderHeaders[id] = result.headers;
      }
    } else {
      if (isDeferredResult(result)) {
        activeDeferreds.set(id, result.deferredData);
        loaderData[id] = result.deferredData.data;
      } else {
        loaderData[id] = result.data;
      }

      // Error status codes always override success status codes, but if all
      // loaders are successful we take the deepest status code.
      if (
        result.statusCode != null &&
        result.statusCode !== 200 &&
        !foundError
      ) {
        statusCode = result.statusCode;
      }
      if (result.headers) {
        loaderHeaders[id] = result.headers;
      }
    }
  });

  // If we didn't consume the pending action error (i.e., all loaders
  // resolved), then consume it here.  Also clear out any loaderData for the
  // throwing route
  if (pendingError) {
    errors = pendingError;
    loaderData[Object.keys(pendingError)[0]] = undefined;
  }

  return {
    loaderData,
    errors,
    statusCode: statusCode || 200,
    loaderHeaders,
  };
}

function processLoaderData(
  state: RouterState,
  matches: AgnosticDataRouteMatch[],
  matchesToLoad: AgnosticDataRouteMatch[],
  results: DataResult[],
  pendingError: RouteData | undefined,
  revalidatingFetchers: RevalidatingFetcher[],
  fetcherResults: DataResult[],
  activeDeferreds: Map<string, DeferredData>
): {
  loaderData: RouterState["loaderData"];
  errors?: RouterState["errors"];
} {
  let { loaderData, errors } = processRouteLoaderData(
    matches,
    matchesToLoad,
    results,
    pendingError,
    activeDeferreds
  );

  // Process results from our revalidating fetchers
  for (let index = 0; index < revalidatingFetchers.length; index++) {
    let { key, match, controller } = revalidatingFetchers[index];
    invariant(
      fetcherResults !== undefined && fetcherResults[index] !== undefined,
      "Did not find corresponding fetcher result"
    );
    let result = fetcherResults[index];

    // Process fetcher non-redirect errors
    if (controller && controller.signal.aborted) {
      // Nothing to do for aborted fetchers
      continue;
    } else if (isErrorResult(result)) {
      let boundaryMatch = findNearestBoundary(state.matches, match?.route.id);
      if (!(errors && errors[boundaryMatch.route.id])) {
        errors = {
          ...errors,
          [boundaryMatch.route.id]: result.error,
        };
      }
      state.fetchers.delete(key);
    } else if (isRedirectResult(result)) {
      // Should never get here, redirects should get processed above, but we
      // keep this to type narrow to a success result in the else
      invariant(false, "Unhandled fetcher revalidation redirect");
    } else if (isDeferredResult(result)) {
      // Should never get here, deferred data should be awaited for fetchers
      // in resolveDeferredResults
      invariant(false, "Unhandled fetcher deferred data");
    } else {
      let doneFetcher: FetcherStates["Idle"] = {
        state: "idle",
        data: result.data,
        formMethod: undefined,
        formAction: undefined,
        formEncType: undefined,
        formData: undefined,
        " _hasFetcherDoneAnything ": true,
      };
      state.fetchers.set(key, doneFetcher);
    }
  }

  return { loaderData, errors };
}

function mergeLoaderData(
  loaderData: RouteData,
  newLoaderData: RouteData,
  matches: AgnosticDataRouteMatch[],
  errors: RouteData | null | undefined
): RouteData {
  let mergedLoaderData = { ...newLoaderData };
  for (let match of matches) {
    let id = match.route.id;
    if (newLoaderData.hasOwnProperty(id)) {
      if (newLoaderData[id] !== undefined) {
        mergedLoaderData[id] = newLoaderData[id];
      } else {
        // No-op - this is so we ignore existing data if we have a key in the
        // incoming object with an undefined value, which is how we unset a prior
        // loaderData if we encounter a loader error
      }
    } else if (loaderData[id] !== undefined && match.route.loader) {
      // Preserve existing keys not included in newLoaderData and where a loader
      // wasn't removed by HMR
      mergedLoaderData[id] = loaderData[id];
    }

    if (errors && errors.hasOwnProperty(id)) {
      // Don't keep any loader data below the boundary
      break;
    }
  }
  return mergedLoaderData;
}

// Find the nearest error boundary, looking upwards from the leaf route (or the
// route specified by routeId) for the closest ancestor error boundary,
// defaulting to the root match
function findNearestBoundary(
  matches: AgnosticDataRouteMatch[],
  routeId?: string
): AgnosticDataRouteMatch {
  let eligibleMatches = routeId
    ? matches.slice(0, matches.findIndex((m) => m.route.id === routeId) + 1)
    : [...matches];
  return (
    eligibleMatches.reverse().find((m) => m.route.hasErrorBoundary === true) ||
    matches[0]
  );
}

function getShortCircuitMatches(routes: AgnosticDataRouteObject[]): {
  matches: AgnosticDataRouteMatch[];
  route: AgnosticDataRouteObject;
} {
  // Prefer a root layout route if present, otherwise shim in a route object
  let route = routes.find((r) => r.index || !r.path || r.path === "/") || {
    id: `__shim-error-route__`,
  };

  return {
    matches: [
      {
        params: {},
        pathname: "",
        pathnameBase: "",
        route,
      },
    ],
    route,
  };
}

function getInternalRouterError(
  status: number,
  {
    pathname,
    routeId,
    method,
    type,
  }: {
    pathname?: string;
    routeId?: string;
    method?: string;
    type?: "defer-action";
  } = {}
) {
  let statusText = "Unknown Server Error";
  let errorMessage = "Unknown @remix-run/router error";

  if (status === 400) {
    statusText = "Bad Request";
    if (method && pathname && routeId) {
      errorMessage =
        `You made a ${method} request to "${pathname}" but ` +
        `did not provide a \`loader\` for route "${routeId}", ` +
        `so there is no way to handle the request.`;
    } else if (type === "defer-action") {
      errorMessage = "defer() is not supported in actions";
    }
  } else if (status === 403) {
    statusText = "Forbidden";
    errorMessage = `Route "${routeId}" does not match URL "${pathname}"`;
  } else if (status === 404) {
    statusText = "Not Found";
    errorMessage = `No route matches URL "${pathname}"`;
  } else if (status === 405) {
    statusText = "Method Not Allowed";
    if (method && pathname && routeId) {
      errorMessage =
        `You made a ${method.toUpperCase()} request to "${pathname}" but ` +
        `did not provide an \`action\` for route "${routeId}", ` +
        `so there is no way to handle the request.`;
    } else if (method) {
      errorMessage = `Invalid request method "${method.toUpperCase()}"`;
    }
  }

  return new ErrorResponse(
    status || 500,
    statusText,
    new Error(errorMessage),
    true
  );
}

// Find any returned redirect errors, starting from the lowest match
function findRedirect(results: DataResult[]): RedirectResult | undefined {
  for (let i = results.length - 1; i >= 0; i--) {
    let result = results[i];
    if (isRedirectResult(result)) {
      return result;
    }
  }
}

function stripHashFromPath(path: To) {
  let parsedPath = typeof path === "string" ? parsePath(path) : path;
  return createPath({ ...parsedPath, hash: "" });
}

function isHashChangeOnly(a: Location, b: Location): boolean {
  if (a.pathname !== b.pathname || a.search !== b.search) {
    return false;
  }

  if (a.hash === "") {
    // /page -> /page#hash
    return b.hash !== "";
  } else if (a.hash === b.hash) {
    // /page#hash -> /page#hash
    return true;
  } else if (b.hash !== "") {
    // /page#hash -> /page#other
    return true;
  }

  // If the hash is removed the browser will re-perform a request to the server
  // /page#hash -> /page
  return false;
}

function isDeferredResult(result: DataResult): result is DeferredResult {
  return result.type === ResultType.deferred;
}

function isErrorResult(result: DataResult): result is ErrorResult {
  return result.type === ResultType.error;
}

function isRedirectResult(result?: DataResult): result is RedirectResult {
  return (result && result.type) === ResultType.redirect;
}

export function isDeferredData(value: any): value is DeferredData {
  let deferred: DeferredData = value;
  return (
    deferred &&
    typeof deferred === "object" &&
    typeof deferred.data === "object" &&
    typeof deferred.subscribe === "function" &&
    typeof deferred.cancel === "function" &&
    typeof deferred.resolveData === "function"
  );
}

function isResponse(value: any): value is Response {
  return (
    value != null &&
    typeof value.status === "number" &&
    typeof value.statusText === "string" &&
    typeof value.headers === "object" &&
    typeof value.body !== "undefined"
  );
}

function isRedirectResponse(result: any): result is Response {
  if (!isResponse(result)) {
    return false;
  }

  let status = result.status;
  let location = result.headers.get("Location");
  return status >= 300 && status <= 399 && location != null;
}

function isQueryRouteResponse(obj: any): obj is QueryRouteResponse {
  return (
    obj &&
    isResponse(obj.response) &&
    (obj.type === ResultType.data || ResultType.error)
  );
}

function isValidMethod(method: string): method is FormMethod | V7_FormMethod {
  return validRequestMethods.has(method.toLowerCase() as FormMethod);
}

function isMutationMethod(
  method: string
): method is MutationFormMethod | V7_MutationFormMethod {
  return validMutationMethods.has(method.toLowerCase() as MutationFormMethod);
}

async function resolveDeferredResults(
  currentMatches: AgnosticDataRouteMatch[],
  matchesToLoad: (AgnosticDataRouteMatch | null)[],
  results: DataResult[],
  signals: (AbortSignal | null)[],
  isFetcher: boolean,
  currentLoaderData?: RouteData
) {
  for (let index = 0; index < results.length; index++) {
    let result = results[index];
    let match = matchesToLoad[index];
    // If we don't have a match, then we can have a deferred result to do
    // anything with.  This is for revalidating fetchers where the route was
    // removed during HMR
    if (!match) {
      continue;
    }

    let currentMatch = currentMatches.find(
      (m) => m.route.id === match!.route.id
    );
    let isRevalidatingLoader =
      currentMatch != null &&
      !isNewRouteInstance(currentMatch, match) &&
      (currentLoaderData && currentLoaderData[match.route.id]) !== undefined;

    if (isDeferredResult(result) && (isFetcher || isRevalidatingLoader)) {
      // Note: we do not have to touch activeDeferreds here since we race them
      // against the signal in resolveDeferredData and they'll get aborted
      // there if needed
      let signal = signals[index];
      invariant(
        signal,
        "Expected an AbortSignal for revalidating fetcher deferred result"
      );
      await resolveDeferredData(result, signal, isFetcher).then((result) => {
        if (result) {
          results[index] = result || results[index];
        }
      });
    }
  }
}

async function resolveDeferredData(
  result: DeferredResult,
  signal: AbortSignal,
  unwrap = false
): Promise<SuccessResult | ErrorResult | undefined> {
  let aborted = await result.deferredData.resolveData(signal);
  if (aborted) {
    return;
  }

  if (unwrap) {
    try {
      return {
        type: ResultType.data,
        data: result.deferredData.unwrappedData,
      };
    } catch (e) {
      // Handle any TrackedPromise._error values encountered while unwrapping
      return {
        type: ResultType.error,
        error: e,
      };
    }
  }

  return {
    type: ResultType.data,
    data: result.deferredData.data,
  };
}

function hasNakedIndexQuery(search: string): boolean {
  return new URLSearchParams(search).getAll("index").some((v) => v === "");
}

// Note: This should match the format exported by useMatches, so if you change
// this please also change that :)  Eventually we'll DRY this up
function createUseMatchesMatch(
  match: AgnosticDataRouteMatch,
  loaderData: RouteData
): UseMatchesMatch {
  let { route, pathname, params } = match;
  return {
    id: route.id,
    pathname,
    params,
    data: loaderData[route.id] as unknown,
    handle: route.handle as unknown,
  };
}

function getTargetMatch(
  matches: AgnosticDataRouteMatch[],
  location: Location | string
) {
  let search =
    typeof location === "string" ? parsePath(location).search : location.search;
  if (
    matches[matches.length - 1].route.index &&
    hasNakedIndexQuery(search || "")
  ) {
    // Return the leaf index route when index is present
    return matches[matches.length - 1];
  }
  // Otherwise grab the deepest "path contributing" match (ignoring index and
  // pathless layout routes)
  let pathMatches = getPathContributingMatches(matches);
  return pathMatches[pathMatches.length - 1];
}
//#endregion
