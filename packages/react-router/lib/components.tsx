import * as React from "react";

import type {
  InitialEntry,
  Location,
  MemoryHistory,
  To,
} from "./router/history";
import {
  Action as NavigationType,
  createMemoryHistory,
  invariant,
  parsePath,
  warning,
} from "./router/history";
import type {
  FutureConfig,
  HydrationState,
  RelativeRoutingType,
  Router as DataRouter,
  RouterState,
  RouterSubscriber,
  RouterInit,
} from "./router/router";
import { createRouter } from "./router/router";
import type {
  DataStrategyFunction,
  LazyRouteFunction,
  TrackedPromise,
} from "./router/utils";
import { getResolveToMatches, resolveTo, stripBasename } from "./router/utils";

import type {
  DataRouteObject,
  IndexRouteObject,
  Navigator,
  NonIndexRouteObject,
  PatchRoutesOnNavigationFunction,
  RouteMatch,
  RouteObject,
  ViewTransitionContextObject,
} from "./context";
import {
  AwaitContext,
  DataRouterContext,
  DataRouterStateContext,
  FetchersContext,
  LocationContext,
  NavigationContext,
  RouteContext,
  ViewTransitionContext,
} from "./context";
import {
  _renderMatches,
  useAsyncValue,
  useInRouterContext,
  useLocation,
  useNavigate,
  useOutlet,
  useRoutes,
  useRoutesImpl,
} from "./hooks";
import type { ViewTransition } from "./dom/global";
import { warnOnce } from "./server-runtime/warnings";

// Provided by the build system
declare const __DEV__: boolean;
const ENABLE_DEV_WARNINGS = __DEV__;

/**
 * @private
 */
export function mapRouteProperties(route: RouteObject) {
  let updates: Partial<RouteObject> & { hasErrorBoundary: boolean } = {
    // Note: this check also occurs in createRoutesFromChildren so update
    // there if you change this -- please and thank you!
    hasErrorBoundary:
      route.hasErrorBoundary ||
      route.ErrorBoundary != null ||
      route.errorElement != null,
  };

  if (route.Component) {
    if (ENABLE_DEV_WARNINGS) {
      if (route.element) {
        warning(
          false,
          "You should not include both `Component` and `element` on your route - " +
            "`Component` will be used."
        );
      }
    }
    Object.assign(updates, {
      element: React.createElement(route.Component),
      Component: undefined,
    });
  }

  if (route.HydrateFallback) {
    if (ENABLE_DEV_WARNINGS) {
      if (route.hydrateFallbackElement) {
        warning(
          false,
          "You should not include both `HydrateFallback` and `hydrateFallbackElement` on your route - " +
            "`HydrateFallback` will be used."
        );
      }
    }
    Object.assign(updates, {
      hydrateFallbackElement: React.createElement(route.HydrateFallback),
      HydrateFallback: undefined,
    });
  }

  if (route.ErrorBoundary) {
    if (ENABLE_DEV_WARNINGS) {
      if (route.errorElement) {
        warning(
          false,
          "You should not include both `ErrorBoundary` and `errorElement` on your route - " +
            "`ErrorBoundary` will be used."
        );
      }
    }
    Object.assign(updates, {
      errorElement: React.createElement(route.ErrorBoundary),
      ErrorBoundary: undefined,
    });
  }

  return updates;
}

export interface MemoryRouterOpts {
  /**
   * Basename path for the application.
   */
  basename?: string;
  /**
   * Function to provide the initial context values for all client side navigations/fetches
   */
  unstable_getContext?: RouterInit["unstable_getContext"];
  /**
   * Future flags to enable for the router.
   */
  future?: Partial<FutureConfig>;
  /**
   * Hydration data to initialize the router with if you have already performed
   * data loading on the server.
   */
  hydrationData?: HydrationState;
  /**
   * Initial entires in the in-memory history stack
   */
  initialEntries?: InitialEntry[];
  /**
   * Index of `initialEntries` the application should initialize to
   */
  initialIndex?: number;
  /**
   * Override the default data strategy of loading in parallel.
   * Only intended for advanced usage.
   */
  dataStrategy?: DataStrategyFunction;
  /**
   * Lazily define portions of the route tree on navigations.
   */
  patchRoutesOnNavigation?: PatchRoutesOnNavigationFunction;
}

/**
 * Create a new data router that manages the application path using an in-memory
 * history stack.  Useful for non-browser environments without a DOM API.
 *
 * @category Data Routers
 */
export function createMemoryRouter(
  /**
   * Application routes
   */
  routes: RouteObject[],
  /**
   * Router options
   */
  opts?: MemoryRouterOpts
): DataRouter {
  return createRouter({
    basename: opts?.basename,
    unstable_getContext: opts?.unstable_getContext,
    future: opts?.future,
    history: createMemoryHistory({
      initialEntries: opts?.initialEntries,
      initialIndex: opts?.initialIndex,
    }),
    hydrationData: opts?.hydrationData,
    routes,
    mapRouteProperties,
    dataStrategy: opts?.dataStrategy,
    patchRoutesOnNavigation: opts?.patchRoutesOnNavigation,
  }).initialize();
}

class Deferred<T> {
  status: "pending" | "resolved" | "rejected" = "pending";
  promise: Promise<T>;
  // @ts-expect-error - no initializer
  resolve: (value: T) => void;
  // @ts-expect-error - no initializer
  reject: (reason?: unknown) => void;
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = (value) => {
        if (this.status === "pending") {
          this.status = "resolved";
          resolve(value);
        }
      };
      this.reject = (reason) => {
        if (this.status === "pending") {
          this.status = "rejected";
          reject(reason);
        }
      };
    });
  }
}

// Copied from react-dom types
export interface RouterProviderProps {
  router: DataRouter;
  flushSync?: (fn: () => unknown) => undefined;
}

/**
 * Given a Remix Router instance, render the appropriate UI
 */
export function RouterProvider({
  router,
  flushSync: reactDomFlushSyncImpl,
}: RouterProviderProps): React.ReactElement {
  let [state, setStateImpl] = React.useState(router.state);
  let [pendingState, setPendingState] = React.useState<RouterState>();
  let [vtContext, setVtContext] = React.useState<ViewTransitionContextObject>({
    isTransitioning: false,
  });
  let [renderDfd, setRenderDfd] = React.useState<Deferred<void>>();
  let [transition, setTransition] = React.useState<ViewTransition>();
  let [interruption, setInterruption] = React.useState<{
    state: RouterState;
    currentLocation: Location;
    nextLocation: Location;
  }>();
  let fetcherData = React.useRef<Map<string, any>>(new Map());
  let [vtTypes, setVtTypes] = React.useState<string[] | undefined>(undefined);

  let setState = React.useCallback<RouterSubscriber>(
    (
      newState: RouterState,
      { deletedFetchers, flushSync, viewTransitionOpts }
    ) => {
      newState.fetchers.forEach((fetcher, key) => {
        if (fetcher.data !== undefined) {
          fetcherData.current.set(key, fetcher.data);
        }
      });
      deletedFetchers.forEach((key) => fetcherData.current.delete(key));

      warnOnce(
        flushSync === false || reactDomFlushSyncImpl != null,
        "You provided the `flushSync` option to a router update, " +
          "but you are not using the `<RouterProvider>` from `react-router/dom` " +
          "so `ReactDOM.flushSync()` is unavailable.  Please update your app " +
          'to `import { RouterProvider } from "react-router/dom"` and ensure ' +
          "you have `react-dom` installed as a dependency to use the " +
          "`flushSync` option."
      );

      let isViewTransitionAvailable =
        router.window != null &&
        router.window.document != null &&
        typeof router.window.document.startViewTransition === "function";

      warnOnce(
        viewTransitionOpts == null || isViewTransitionAvailable,
        "You provided the `viewTransition` option to a router update, " +
          "but you do not appear to be running in a DOM environment as " +
          "`window.startViewTransition` is not available."
      );

      // If this isn't a view transition or it's not available in this browser,
      // just update and be done with it
      if (!viewTransitionOpts || !isViewTransitionAvailable) {
        if (reactDomFlushSyncImpl && flushSync) {
          reactDomFlushSyncImpl(() => setStateImpl(newState));
        } else {
          React.startTransition(() => setStateImpl(newState));
        }
        return;
      }

      // flushSync + startViewTransition
      if (reactDomFlushSyncImpl && flushSync) {
        // Flush through the context to mark DOM elements as transition=ing
        reactDomFlushSyncImpl(() => {
          // Cancel any pending transitions
          if (transition) {
            renderDfd && renderDfd.resolve();
            transition.skipTransition();
          }
          setVtContext({
            isTransitioning: true,
            flushSync: true,
            currentLocation: viewTransitionOpts.currentLocation,
            nextLocation: viewTransitionOpts.nextLocation,
          });
        });

        // Update the DOM
        let t;
        if (
          viewTransitionOpts &&
          typeof viewTransitionOpts.opts === "object" &&
          viewTransitionOpts.opts.types
        ) {
          // Set view transition types when provided
          setVtTypes(viewTransitionOpts.opts.types);

          t = router.window!.document.startViewTransition({
            update: () => {
              reactDomFlushSyncImpl(() => setStateImpl(newState));
            },
            types: viewTransitionOpts.opts.types,
          });
        } else {
          t = router.window!.document.startViewTransition(() => {
            reactDomFlushSyncImpl(() => setStateImpl(newState));
          });
        }

        // Clean up after the animation completes
        t.finished.finally(() => {
          reactDomFlushSyncImpl(() => {
            setRenderDfd(undefined);
            setTransition(undefined);
            setPendingState(undefined);
            setVtContext({ isTransitioning: false });
          });
        });

        reactDomFlushSyncImpl(() => setTransition(t));
        return;
      }

      // startTransition + startViewTransition
      if (transition) {
        // Interrupting an in-progress transition, cancel and let everything flush
        // out, and then kick off a new transition from the interruption state
        renderDfd && renderDfd.resolve();
        transition.skipTransition();
        setInterruption({
          state: newState,
          currentLocation: viewTransitionOpts.currentLocation,
          nextLocation: viewTransitionOpts.nextLocation,
        });
      } else {
        // Completed navigation update with opted-in view transitions, let 'er rip
        if (
          viewTransitionOpts &&
          typeof viewTransitionOpts.opts === "object" &&
          viewTransitionOpts.opts.types
        ) {
          setVtTypes(viewTransitionOpts.opts.types);
        }
        setPendingState(newState);
        setVtContext({
          isTransitioning: true,
          flushSync: false,
          currentLocation: viewTransitionOpts.currentLocation,
          nextLocation: viewTransitionOpts.nextLocation,
        });
      }
    },
    [router.window, reactDomFlushSyncImpl, transition, renderDfd]
  );

  // Need to use a layout effect here so we are subscribed early enough to
  // pick up on any render-driven redirects/navigations (useEffect/<Navigate>)
  React.useLayoutEffect(() => router.subscribe(setState), [router, setState]);

  // When we start a view transition, create a Deferred we can use for the
  // eventual "completed" render
  React.useEffect(() => {
    if (vtContext.isTransitioning && !vtContext.flushSync) {
      setRenderDfd(new Deferred<void>());
    }
  }, [vtContext]);

  // Once the deferred is created, kick off startViewTransition() to update the
  // DOM and then wait on the Deferred to resolve (indicating the DOM update has
  // happened)
  React.useEffect(() => {
    if (renderDfd && pendingState && router.window) {
      let newState = pendingState;
      let renderPromise = renderDfd.promise;
      let transition;
      if (vtTypes) {
        transition = router.window.document.startViewTransition({
          update: async () => {
            React.startTransition(() => setStateImpl(newState));
            await renderPromise;
          },
          types: vtTypes,
        });
      } else {
        transition = router.window.document.startViewTransition(async () => {
          React.startTransition(() => setStateImpl(newState));
          await renderPromise;
        });
      }
      transition.finished.finally(() => {
        setRenderDfd(undefined);
        setTransition(undefined);
        setPendingState(undefined);
        setVtContext({ isTransitioning: false });
      });
      setTransition(transition);
    }
  }, [pendingState, renderDfd, router.window, vtTypes]);

  // When the new location finally renders and is committed to the DOM, this
  // effect will run to resolve the transition
  React.useEffect(() => {
    if (
      renderDfd &&
      pendingState &&
      state.location.key === pendingState.location.key
    ) {
      renderDfd.resolve();
    }
  }, [renderDfd, transition, state.location, pendingState]);

  // If we get interrupted with a new navigation during a transition, we skip
  // the active transition, let it cleanup, then kick it off again here
  React.useEffect(() => {
    if (!vtContext.isTransitioning && interruption) {
      setPendingState(interruption.state);
      setVtContext({
        isTransitioning: true,
        flushSync: false,
        currentLocation: interruption.currentLocation,
        nextLocation: interruption.nextLocation,
      });
      setInterruption(undefined);
    }
  }, [vtContext.isTransitioning, interruption]);

  let navigator = React.useMemo((): Navigator => {
    return {
      createHref: router.createHref,
      encodeLocation: router.encodeLocation,
      go: (n) => router.navigate(n),
      push: (to, state, opts) =>
        router.navigate(to, {
          state,
          preventScrollReset: opts?.preventScrollReset,
        }),
      replace: (to, state, opts) =>
        router.navigate(to, {
          replace: true,
          state,
          preventScrollReset: opts?.preventScrollReset,
        }),
    };
  }, [router]);

  let basename = router.basename || "/";

  let dataRouterContext = React.useMemo(
    () => ({
      router,
      navigator,
      static: false,
      basename,
    }),
    [router, navigator, basename]
  );

  // The fragment and {null} here are important!  We need them to keep React 18's
  // useId happy when we are server-rendering since we may have a <script> here
  // containing the hydrated server-side staticContext (from StaticRouterProvider).
  // useId relies on the component tree structure to generate deterministic id's
  // so we need to ensure it remains the same on the client even though
  // we don't need the <script> tag
  return (
    <>
      <DataRouterContext.Provider value={dataRouterContext}>
        <DataRouterStateContext.Provider value={state}>
          <FetchersContext.Provider value={fetcherData.current}>
            <ViewTransitionContext.Provider value={vtContext}>
              <Router
                basename={basename}
                location={state.location}
                navigationType={state.historyAction}
                navigator={navigator}
              >
                <MemoizedDataRoutes
                  routes={router.routes}
                  future={router.future}
                  state={state}
                />
              </Router>
            </ViewTransitionContext.Provider>
          </FetchersContext.Provider>
        </DataRouterStateContext.Provider>
      </DataRouterContext.Provider>
      {null}
    </>
  );
}

// Memoize to avoid re-renders when updating `ViewTransitionContext`
const MemoizedDataRoutes = React.memo(DataRoutes);

function DataRoutes({
  routes,
  future,
  state,
}: {
  routes: DataRouteObject[];
  future: DataRouter["future"];
  state: RouterState;
}): React.ReactElement | null {
  return useRoutesImpl(routes, undefined, state, future);
}

/**
 * @category Types
 */
export interface MemoryRouterProps {
  basename?: string;
  children?: React.ReactNode;
  initialEntries?: InitialEntry[];
  initialIndex?: number;
}

/**
 * A `<Router>` that stores all entries in memory.
 *
 * @category Component Routers
 */
export function MemoryRouter({
  basename,
  children,
  initialEntries,
  initialIndex,
}: MemoryRouterProps): React.ReactElement {
  let historyRef = React.useRef<MemoryHistory>();
  if (historyRef.current == null) {
    historyRef.current = createMemoryHistory({
      initialEntries,
      initialIndex,
      v5Compat: true,
    });
  }

  let history = historyRef.current;
  let [state, setStateImpl] = React.useState({
    action: history.action,
    location: history.location,
  });
  let setState = React.useCallback(
    (newState: { action: NavigationType; location: Location }) => {
      React.startTransition(() => setStateImpl(newState));
    },
    [setStateImpl]
  );

  React.useLayoutEffect(() => history.listen(setState), [history, setState]);

  return (
    <Router
      basename={basename}
      children={children}
      location={state.location}
      navigationType={state.action}
      navigator={history}
    />
  );
}

/**
 * @category Types
 */
export interface NavigateProps {
  to: To;
  replace?: boolean;
  state?: any;
  relative?: RelativeRoutingType;
}

/**
 * A component-based version of {@link useNavigate} to use in a [`React.Component
 * Class`](https://reactjs.org/docs/react-component.html) where hooks are not
 * able to be used.
 *
 * It's recommended to avoid using this component in favor of {@link useNavigate}
 *
 * @category Components
 */
export function Navigate({
  to,
  replace,
  state,
  relative,
}: NavigateProps): null {
  invariant(
    useInRouterContext(),
    // TODO: This error is probably because they somehow have 2 versions of
    // the router loaded. We can help them understand how to avoid that.
    `<Navigate> may be used only in the context of a <Router> component.`
  );

  let { static: isStatic } = React.useContext(NavigationContext);

  warning(
    !isStatic,
    `<Navigate> must not be used on the initial render in a <StaticRouter>. ` +
      `This is a no-op, but you should modify your code so the <Navigate> is ` +
      `only ever rendered in response to some user interaction or state change.`
  );

  let { matches } = React.useContext(RouteContext);
  let { pathname: locationPathname } = useLocation();
  let navigate = useNavigate();

  // Resolve the path outside of the effect so that when effects run twice in
  // StrictMode they navigate to the same place
  let path = resolveTo(
    to,
    getResolveToMatches(matches),
    locationPathname,
    relative === "path"
  );
  let jsonPath = JSON.stringify(path);

  React.useEffect(() => {
    navigate(JSON.parse(jsonPath), { replace, state, relative });
  }, [navigate, jsonPath, relative, replace, state]);

  return null;
}

/**
 * @category Types
 */
export interface OutletProps {
  /**
    Provides a context value to the element tree below the outlet. Use when the parent route needs to provide values to child routes.

    ```tsx
    <Outlet context={myContextValue} />
    ```

    Access the context with {@link useOutletContext}.
   */
  context?: unknown;
}

/**
  Renders the matching child route of a parent route or nothing if no child route matches.

  ```tsx
  import { Outlet } from "react-router"

  export default function SomeParent() {
    return (
      <div>
        <h1>Parent Content</h1>
        <Outlet />
      </div>
    );
  }
  ```

  @category Components
 */
export function Outlet(props: OutletProps): React.ReactElement | null {
  return useOutlet(props.context);
}

/**
 * @category Types
 */
export interface PathRouteProps {
  caseSensitive?: NonIndexRouteObject["caseSensitive"];
  path?: NonIndexRouteObject["path"];
  id?: NonIndexRouteObject["id"];
  lazy?: LazyRouteFunction<NonIndexRouteObject>;
  loader?: NonIndexRouteObject["loader"];
  action?: NonIndexRouteObject["action"];
  hasErrorBoundary?: NonIndexRouteObject["hasErrorBoundary"];
  shouldRevalidate?: NonIndexRouteObject["shouldRevalidate"];
  handle?: NonIndexRouteObject["handle"];
  index?: false;
  children?: React.ReactNode;
  element?: React.ReactNode | null;
  hydrateFallbackElement?: React.ReactNode | null;
  errorElement?: React.ReactNode | null;
  Component?: React.ComponentType | null;
  HydrateFallback?: React.ComponentType | null;
  ErrorBoundary?: React.ComponentType | null;
}

/**
 * @category Types
 */
export interface LayoutRouteProps extends PathRouteProps {}

/**
 * @category Types
 */
export interface IndexRouteProps {
  caseSensitive?: IndexRouteObject["caseSensitive"];
  path?: IndexRouteObject["path"];
  id?: IndexRouteObject["id"];
  lazy?: LazyRouteFunction<IndexRouteObject>;
  loader?: IndexRouteObject["loader"];
  action?: IndexRouteObject["action"];
  hasErrorBoundary?: IndexRouteObject["hasErrorBoundary"];
  shouldRevalidate?: IndexRouteObject["shouldRevalidate"];
  handle?: IndexRouteObject["handle"];
  index: true;
  children?: undefined;
  element?: React.ReactNode | null;
  hydrateFallbackElement?: React.ReactNode | null;
  errorElement?: React.ReactNode | null;
  Component?: React.ComponentType | null;
  HydrateFallback?: React.ComponentType | null;
  ErrorBoundary?: React.ComponentType | null;
}

export type RouteProps = PathRouteProps | LayoutRouteProps | IndexRouteProps;

/**
 * Configures an element to render when a pattern matches the current location.
 * It must be rendered within a {@link Routes} element. Note that these routes
 * do not participate in data loading, actions, code splitting, or any other
 * route module features.
 *
 * @category Components
 */
export function Route(_props: RouteProps): React.ReactElement | null {
  invariant(
    false,
    `A <Route> is only ever to be used as the child of <Routes> element, ` +
      `never rendered directly. Please wrap your <Route> in a <Routes>.`
  );
}

/**
 * @category Types
 */
export interface RouterProps {
  basename?: string;
  children?: React.ReactNode;
  location: Partial<Location> | string;
  navigationType?: NavigationType;
  navigator: Navigator;
  static?: boolean;
}

/**
 * Provides location context for the rest of the app.
 *
 * Note: You usually won't render a `<Router>` directly. Instead, you'll render a
 * router that is more specific to your environment such as a `<BrowserRouter>`
 * in web browsers or a `<StaticRouter>` for server rendering.
 *
 * @category Components
 */
export function Router({
  basename: basenameProp = "/",
  children = null,
  location: locationProp,
  navigationType = NavigationType.Pop,
  navigator,
  static: staticProp = false,
}: RouterProps): React.ReactElement | null {
  invariant(
    !useInRouterContext(),
    `You cannot render a <Router> inside another <Router>.` +
      ` You should never have more than one in your app.`
  );

  // Preserve trailing slashes on basename, so we can let the user control
  // the enforcement of trailing slashes throughout the app
  let basename = basenameProp.replace(/^\/*/, "/");
  let navigationContext = React.useMemo(
    () => ({
      basename,
      navigator,
      static: staticProp,
      future: {},
    }),
    [basename, navigator, staticProp]
  );

  if (typeof locationProp === "string") {
    locationProp = parsePath(locationProp);
  }

  let {
    pathname = "/",
    search = "",
    hash = "",
    state = null,
    key = "default",
  } = locationProp;

  let locationContext = React.useMemo(() => {
    let trailingPathname = stripBasename(pathname, basename);

    if (trailingPathname == null) {
      return null;
    }

    return {
      location: {
        pathname: trailingPathname,
        search,
        hash,
        state,
        key,
      },
      navigationType,
    };
  }, [basename, pathname, search, hash, state, key, navigationType]);

  warning(
    locationContext != null,
    `<Router basename="${basename}"> is not able to match the URL ` +
      `"${pathname}${search}${hash}" because it does not start with the ` +
      `basename, so the <Router> won't render anything.`
  );

  if (locationContext == null) {
    return null;
  }

  return (
    <NavigationContext.Provider value={navigationContext}>
      <LocationContext.Provider children={children} value={locationContext} />
    </NavigationContext.Provider>
  );
}

/**
 * @category Types
 */
export interface RoutesProps {
  /**
   * Nested {@link Route} elements
   */
  children?: React.ReactNode;

  /**
   * The location to match against. Defaults to the current location.
   */
  location?: Partial<Location> | string;
}

/**
 Renders a branch of {@link Route | `<Routes>`} that best matches the current
 location. Note that these routes do not participate in data loading, actions,
 code splitting, or any other route module features.

 ```tsx
 import { Routes, Route } from "react-router"

<Routes>
  <Route index element={<StepOne />} />
  <Route path="step-2" element={<StepTwo />} />
  <Route path="step-3" element={<StepThree />}>
</Routes>
 ```

 @category Components
 */
export function Routes({
  children,
  location,
}: RoutesProps): React.ReactElement | null {
  return useRoutes(createRoutesFromChildren(children), location);
}

export interface AwaitResolveRenderFunction<Resolve = any> {
  (data: Awaited<Resolve>): React.ReactNode;
}

/**
 * @category Types
 */
export interface AwaitProps<Resolve> {
  /**
  When using a function, the resolved value is provided as the parameter.

  ```tsx [2]
  <Await resolve={reviewsPromise}>
    {(resolvedReviews) => <Reviews items={resolvedReviews} />}
  </Await>
  ```

  When using React elements, {@link useAsyncValue} will provide the
  resolved value:

  ```tsx [2]
  <Await resolve={reviewsPromise}>
    <Reviews />
  </Await>

  function Reviews() {
    const resolvedReviews = useAsyncValue()
    return <div>...</div>
  }
  ```
  */
  children: React.ReactNode | AwaitResolveRenderFunction<Resolve>;

  /**
  The error element renders instead of the children when the promise rejects.

  ```tsx
  <Await
    errorElement={<div>Oops</div>}
    resolve={reviewsPromise}
  >
    <Reviews />
  </Await>
  ```

  To provide a more contextual error, you can use the {@link useAsyncError} in a
  child component

  ```tsx
  <Await
    errorElement={<ReviewsError />}
    resolve={reviewsPromise}
  >
    <Reviews />
  </Await>

  function ReviewsError() {
    const error = useAsyncError()
    return <div>Error loading reviews: {error.message}</div>
  }
  ```

  If you do not provide an errorElement, the rejected value will bubble up to
  the nearest route-level {@link NonIndexRouteObject#ErrorBoundary | ErrorBoundary} and be accessible
  via {@link useRouteError} hook.
  */
  errorElement?: React.ReactNode;

  /**
  Takes a promise returned from a {@link LoaderFunction | loader} value to be resolved and rendered.

  ```jsx
  import { useLoaderData, Await } from "react-router"

  export async function loader() {
    let reviews = getReviews() // not awaited
    let book = await getBook()
    return {
      book,
      reviews, // this is a promise
    }
  }

  export default function Book() {
    const {
      book,
      reviews, // this is the same promise
    } = useLoaderData()

    return (
      <div>
        <h1>{book.title}</h1>
        <p>{book.description}</p>
        <React.Suspense fallback={<ReviewsSkeleton />}>
          <Await
            // and is the promise we pass to Await
            resolve={reviews}
          >
            <Reviews />
          </Await>
        </React.Suspense>
      </div>
    );
  }
  ```
   */
  resolve: Resolve;
}

/**
Used to render promise values with automatic error handling.

```tsx
import { Await, useLoaderData } from "react-router";

export function loader() {
  // not awaited
  const reviews = getReviews()
  // awaited (blocks the transition)
  const book = await fetch("/api/book").then((res) => res.json())
  return { book, reviews }
}

function Book() {
  const { book, reviews } = useLoaderData();
  return (
    <div>
      <h1>{book.title}</h1>
      <p>{book.description}</p>
      <React.Suspense fallback={<ReviewsSkeleton />}>
        <Await
          resolve={reviews}
          errorElement={
            <div>Could not load reviews 😬</div>
          }
          children={(resolvedReviews) => (
            <Reviews items={resolvedReviews} />
          )}
        />
      </React.Suspense>
    </div>
  );
}
```

**Note:** `<Await>` expects to be rendered inside of a `<React.Suspense>`

@category Components

*/
export function Await<Resolve>({
  children,
  errorElement,
  resolve,
}: AwaitProps<Resolve>) {
  return (
    <AwaitErrorBoundary resolve={resolve} errorElement={errorElement}>
      <ResolveAwait>{children}</ResolveAwait>
    </AwaitErrorBoundary>
  );
}

type AwaitErrorBoundaryProps = React.PropsWithChildren<{
  errorElement?: React.ReactNode;
  resolve: TrackedPromise | any;
}>;

type AwaitErrorBoundaryState = {
  error: any;
};

enum AwaitRenderStatus {
  pending,
  success,
  error,
}

class AwaitErrorBoundary extends React.Component<
  AwaitErrorBoundaryProps,
  AwaitErrorBoundaryState
> {
  constructor(props: AwaitErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error(
      "<Await> caught the following error during render",
      error,
      errorInfo
    );
  }

  render() {
    let { children, errorElement, resolve } = this.props;

    let promise: TrackedPromise | null = null;
    let status: AwaitRenderStatus = AwaitRenderStatus.pending;

    if (!(resolve instanceof Promise)) {
      // Didn't get a promise - provide as a resolved promise
      status = AwaitRenderStatus.success;
      promise = Promise.resolve();
      Object.defineProperty(promise, "_tracked", { get: () => true });
      Object.defineProperty(promise, "_data", { get: () => resolve });
    } else if (this.state.error) {
      // Caught a render error, provide it as a rejected promise
      status = AwaitRenderStatus.error;
      let renderError = this.state.error;
      promise = Promise.reject().catch(() => {}); // Avoid unhandled rejection warnings
      Object.defineProperty(promise, "_tracked", { get: () => true });
      Object.defineProperty(promise, "_error", { get: () => renderError });
    } else if ((resolve as TrackedPromise)._tracked) {
      // Already tracked promise - check contents
      promise = resolve;
      status =
        "_error" in promise
          ? AwaitRenderStatus.error
          : "_data" in promise
          ? AwaitRenderStatus.success
          : AwaitRenderStatus.pending;
    } else {
      // Raw (untracked) promise - track it
      status = AwaitRenderStatus.pending;
      Object.defineProperty(resolve, "_tracked", { get: () => true });
      promise = resolve.then(
        (data: any) =>
          Object.defineProperty(resolve, "_data", { get: () => data }),
        (error: any) =>
          Object.defineProperty(resolve, "_error", { get: () => error })
      );
    }

    if (status === AwaitRenderStatus.error && !errorElement) {
      // No errorElement, throw to the nearest route-level error boundary
      throw promise._error;
    }

    if (status === AwaitRenderStatus.error) {
      // Render via our errorElement
      return <AwaitContext.Provider value={promise} children={errorElement} />;
    }

    if (status === AwaitRenderStatus.success) {
      // Render children with resolved value
      return <AwaitContext.Provider value={promise} children={children} />;
    }

    // Throw to the suspense boundary
    throw promise;
  }
}

/**
 * @private
 * Indirection to leverage useAsyncValue for a render-prop API on `<Await>`
 */
function ResolveAwait({
  children,
}: {
  children: React.ReactNode | AwaitResolveRenderFunction;
}) {
  let data = useAsyncValue();
  let toRender = typeof children === "function" ? children(data) : children;
  return <>{toRender}</>;
}

///////////////////////////////////////////////////////////////////////////////
// UTILS
///////////////////////////////////////////////////////////////////////////////

/**
 * Creates a route config from a React "children" object, which is usually
 * either a `<Route>` element or an array of them. Used internally by
 * `<Routes>` to create a route config from its children.
 *
 * @category Utils
 */
export function createRoutesFromChildren(
  children: React.ReactNode,
  parentPath: number[] = []
): RouteObject[] {
  let routes: RouteObject[] = [];

  React.Children.forEach(children, (element, index) => {
    if (!React.isValidElement(element)) {
      // Ignore non-elements. This allows people to more easily inline
      // conditionals in their route config.
      return;
    }

    let treePath = [...parentPath, index];

    if (element.type === React.Fragment) {
      // Transparently support React.Fragment and its children.
      routes.push.apply(
        routes,
        createRoutesFromChildren(element.props.children, treePath)
      );
      return;
    }

    invariant(
      element.type === Route,
      `[${
        typeof element.type === "string" ? element.type : element.type.name
      }] is not a <Route> component. All component children of <Routes> must be a <Route> or <React.Fragment>`
    );

    invariant(
      !element.props.index || !element.props.children,
      "An index route cannot have child routes."
    );

    let route: RouteObject = {
      id: element.props.id || treePath.join("-"),
      caseSensitive: element.props.caseSensitive,
      element: element.props.element,
      Component: element.props.Component,
      index: element.props.index,
      path: element.props.path,
      loader: element.props.loader,
      action: element.props.action,
      hydrateFallbackElement: element.props.hydrateFallbackElement,
      HydrateFallback: element.props.HydrateFallback,
      errorElement: element.props.errorElement,
      ErrorBoundary: element.props.ErrorBoundary,
      hasErrorBoundary:
        element.props.hasErrorBoundary === true ||
        element.props.ErrorBoundary != null ||
        element.props.errorElement != null,
      shouldRevalidate: element.props.shouldRevalidate,
      handle: element.props.handle,
      lazy: element.props.lazy,
    };

    if (element.props.children) {
      route.children = createRoutesFromChildren(
        element.props.children,
        treePath
      );
    }

    routes.push(route);
  });

  return routes;
}

/**
 * Create route objects from JSX elements instead of arrays of objects
 */
export let createRoutesFromElements = createRoutesFromChildren;

/**
 * Renders the result of `matchRoutes()` into a React element.
 *
 * @category Utils
 */
export function renderMatches(
  matches: RouteMatch[] | null
): React.ReactElement | null {
  return _renderMatches(matches);
}
