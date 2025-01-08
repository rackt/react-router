import type { InitialEntry } from "../../../lib/router/history";
import type {
  Fetcher,
  RouterFetchOptions,
  HydrationState,
  Router,
  RouterNavigateOptions,
} from "../../../lib/router/router";
import type {
  AgnosticDataRouteObject,
  AgnosticRouteMatch,
  DefaultRouterContext,
} from "../../../lib/router/utils";
import { createRouter, IDLE_FETCHER } from "../../../lib/router/router";
import {
  createMemoryHistory,
  invariant,
  parsePath,
} from "../../../lib/router/history";
import type {
  AgnosticIndexRouteObject,
  AgnosticNonIndexRouteObject,
  DataStrategyFunction,
} from "../../../lib/router/utils";
import {
  matchRoutes,
  redirect,
  stripBasename,
} from "../../../lib/router/utils";

import { isRedirect, tick } from "./utils";

// Routes passed into setup() should just have a boolean for loader/action
// indicating they want a stub.  They get enhanced back to AgnosticRouteObjects
// by our test harness
export type TestIndexRouteObject = Pick<
  AgnosticIndexRouteObject,
  "id" | "index" | "path" | "shouldRevalidate" | "handle"
> & {
  lazy?: boolean;
  loader?: boolean;
  action?: boolean;
  hasErrorBoundary?: boolean;
};

export type TestNonIndexRouteObject = Pick<
  AgnosticNonIndexRouteObject,
  "id" | "index" | "path" | "shouldRevalidate" | "handle"
> & {
  lazy?: boolean;
  loader?: boolean;
  action?: boolean;
  hasErrorBoundary?: boolean;
  children?: TestRouteObject[];
};

export type TestRouteObject = TestIndexRouteObject | TestNonIndexRouteObject;

// A helper that includes the Deferred and stubs for any loaders/actions for the
// route allowing fine-grained test execution
export type InternalHelpers = {
  navigationId: number;
  dfd: ReturnType<typeof createDeferred>;
  stub: jest.Mock;
  _signal?: AbortSignal;
};

export type Helpers = InternalHelpers & {
  get signal(): AbortSignal;
  resolve: (d: any) => Promise<void>;
  reject: (d: any) => Promise<void>;
  redirect: (
    href: string,
    status?: number,
    headers?: Record<string, string>,
    shims?: string[]
  ) => Promise<NavigationHelpers>;
  redirectReturn: (
    href: string,
    status?: number,
    headers?: Record<string, string>,
    shims?: string[]
  ) => Promise<NavigationHelpers>;
};

// Helpers returned from a TestHarness.navigate call, allowing fine grained
// control and assertions over the loaders/actions
export type NavigationHelpers = {
  navigationId: number;
  lazy: Record<string, Helpers>;
  loaders: Record<string, Helpers>;
  actions: Record<string, Helpers>;
};

export type FetcherHelpers = NavigationHelpers & {
  key: string;
  fetcher: Fetcher;
};

// Router created by setup() - used for automatic cleanup
let currentRouter: Router | null = null;
// A set of to-be-garbage-collected Deferred's to clean up at the end of a test
let gcDfds = new Set<ReturnType<typeof createDeferred>>();

// Reusable routes for a simple tasks app, for test cases that don't want
// to create their own more complex routes
export const TASK_ROUTES: TestRouteObject[] = [
  {
    id: "root",
    path: "/",
    loader: true,
    hasErrorBoundary: true,
    children: [
      {
        id: "index",
        index: true,
        loader: true,
      },
      {
        id: "tasks",
        path: "tasks",
        loader: true,
        action: true,
        hasErrorBoundary: true,
      },
      {
        id: "tasksId",
        path: "tasks/:id",
        loader: true,
        action: true,
        hasErrorBoundary: true,
      },
      {
        id: "noLoader",
        path: "no-loader",
      },
    ],
  },
];

type SetupOpts = {
  routes: TestRouteObject[];
  basename?: string;
  initialEntries?: InitialEntry[];
  initialIndex?: number;
  hydrationData?: HydrationState;
  dataStrategy?: DataStrategyFunction;
  context?: DefaultRouterContext;
};

// We use a slightly modified version of createDeferred here that includes the
// tick() calls to let the router finish updating
export function createDeferred() {
  let resolve: (val?: any) => Promise<void>;
  let reject: (error?: Error) => Promise<void>;
  let promise = new Promise((res, rej) => {
    resolve = async (val: any) => {
      res(val);
      await tick();
      await promise;
    };
    reject = async (error?: Error) => {
      rej(error);
      await promise.catch(() => tick());
    };
  });
  return {
    promise,
    //@ts-ignore
    resolve,
    //@ts-ignore
    reject,
  };
}

export function getFetcherData(router: Router) {
  let fetcherData = new Map<string, unknown>();
  router.subscribe((state, { deletedFetchers }) => {
    deletedFetchers.forEach((k) => {
      fetcherData.delete(k);
    });
    state.fetchers.forEach((fetcher, key) => {
      if (
        fetcher.data !== undefined &&
        // action fetch
        ((fetcher.formMethod !== "GET" && fetcher.state === "loading") ||
          // normal fetch
          fetcher.state === "idle")
      ) {
        fetcherData.set(key, fetcher.data);
      }
    });
  });
  return fetcherData;
}

export function setup({
  routes,
  basename,
  initialEntries,
  initialIndex,
  hydrationData,
  dataStrategy,
  context,
}: SetupOpts) {
  let guid = 0;
  // Global "active" helpers, keyed by navType:guid:loaderOrAction:routeId.
  // For example, the first navigation for /parent/foo would generate:
  //   navigation:1:action:parent -> helpers
  //   navigation:1:action:foo -> helpers
  //   navigation:1:loader:parent -> helpers
  //   navigation:1:loader:foo -> helpers
  //
  let activeHelpers = new Map<string, InternalHelpers>();
  // "Active" flags to indicate which helpers should be used the next time a
  // router calls an action or loader internally.
  let activeActionType: "navigation" | "fetch" = "navigation";
  let activeLoaderType: "navigation" | "fetch" = "navigation";
  let activeLoaderNavigationId = guid;
  let activeActionNavigationId = guid;
  let activeLoaderFetchId = guid;
  let activeActionFetchId = guid;

  // Enhance routes with loaders/actions as requested that will call the
  // active navigation loader/action
  function enhanceRoutes(_routes: TestRouteObject[]) {
    return _routes.map((r) => {
      let enhancedRoute: AgnosticDataRouteObject = {
        ...r,
        lazy: undefined,
        loader: undefined,
        action: undefined,
        children: undefined,
        id: r.id || `route-${guid++}`,
      };
      if (r.lazy) {
        // @ts-expect-error
        enhancedRoute.lazy = (args) => {
          // This is maybe not ideal, but works for now :).  We don't really know
          // which key to look for so we resolve the earliest one we find and
          // remove it such that subsequent calls resolve the later ones.
          const sortedIds = [
            activeLoaderNavigationId,
            activeActionNavigationId,
            activeLoaderFetchId,
            activeActionFetchId,
          ].sort();
          let helperKey = sortedIds
            .map((id) => `${id}:lazy:${enhancedRoute.id}`)
            .find((k) => activeHelpers.has(k));
          invariant(helperKey != null, `No helperKey found`);
          let helpers = activeHelpers.get(helperKey);
          invariant(helpers, `No helpers found for: ${helperKey}`);
          helpers.stub(args);
          return helpers.dfd.promise.then((def) => {
            activeHelpers.delete(helperKey!);
            return def;
          });
        };
      }
      if (r.loader) {
        enhancedRoute.loader = (...args) => {
          let navigationId =
            activeLoaderType === "fetch"
              ? activeLoaderFetchId
              : activeLoaderNavigationId;
          let helperKey = `${activeLoaderType}:${navigationId}:loader:${enhancedRoute.id}`;
          let helpers = activeHelpers.get(helperKey);
          invariant(helpers, `No helpers found for: ${helperKey}`);
          helpers.stub(...args);
          helpers._signal = args[0].request.signal;
          return helpers.dfd.promise;
        };
      }
      if (r.action) {
        enhancedRoute.action = (...args) => {
          let type = activeActionType;
          let navigationId =
            activeActionType === "fetch"
              ? activeActionFetchId
              : activeActionNavigationId;
          let helperKey = `${activeActionType}:${navigationId}:action:${enhancedRoute.id}`;
          let helpers = activeHelpers.get(helperKey);
          invariant(helpers, `No helpers found for: ${helperKey}`);
          helpers.stub(...args);
          helpers._signal = args[0].request.signal;
          return helpers.dfd.promise.then(
            (result) => {
              // After a successful non-redirect action, ensure we call the right
              // loaders as a follow up.  In the case of a redirect, ths navigation
              // is aborted and we will use whatever new navigationId the redirect
              // already assigned
              if (!isRedirect(result)) {
                if (type === "navigation") {
                  activeLoaderType = "navigation";
                  activeLoaderNavigationId = navigationId;
                } else {
                  activeLoaderType = "fetch";
                  activeLoaderFetchId = navigationId;
                }
              }
              return result;
            },
            (result) => {
              // After a non-redirect rejected navigation action, we may still call
              // ancestor loaders so set the right values to ensure we trigger the
              // right ones.
              if (type === "navigation" && !isRedirect(result)) {
                activeLoaderType = "navigation";
                activeLoaderNavigationId = navigationId;
              }
              return Promise.reject(result);
            }
          );
        };
      }
      if (!r.index && r.children) {
        enhancedRoute.children = enhanceRoutes(r.children);
      }
      return enhancedRoute;
    });
  }

  // jsdom is making more and more properties non-configurable, so we inject
  // our own jest-friendly window.
  let testWindow = {
    ...window,
    location: {
      ...window.location,
      assign: jest.fn(),
      replace: jest.fn(),
    },
  } as unknown as Window;
  // ^ Spread makes TS sad - `window.NaN` conflicts with `[index: number]: Window`

  let history = createMemoryHistory({ initialEntries, initialIndex });
  jest.spyOn(history, "push");
  jest.spyOn(history, "replace");
  currentRouter = createRouter({
    basename,
    context,
    history,
    routes: enhanceRoutes(routes),
    hydrationData,
    window: testWindow,
    dataStrategy: dataStrategy,
  });

  let fetcherData = getFetcherData(currentRouter);
  currentRouter.initialize();

  function getRouteHelpers(
    routeId: string,
    navigationId: number,
    addHelpers: (routeId: string, helpers: InternalHelpers) => void
  ): Helpers {
    // Internal methods we need access to from the route loader execution
    let internalHelpers: InternalHelpers = {
      navigationId,
      dfd: createDeferred(),
      stub: jest.fn(),
    };
    // Allow the caller to store off the helpers in the right spot so eventual
    // executions by the router can access the right ones
    addHelpers(routeId, internalHelpers);
    gcDfds.add(internalHelpers.dfd);

    async function _redirect(
      isRejection: boolean,
      href: string,
      status = 301,
      headers = {},
      shims: string[] = []
    ) {
      let redirectNavigationId = ++guid;
      activeLoaderType = "navigation";
      activeLoaderNavigationId = redirectNavigationId;
      if (status === 307 || status === 308) {
        activeActionType = "navigation";
        activeActionNavigationId = redirectNavigationId;
      }

      let helpers = getNavigationHelpers(href, redirectNavigationId);

      // Since a redirect kicks off and awaits a new navigation we can't shim
      // these _after_ the redirect, so we allow the caller to pass in loader
      // shims with the redirect
      shims.forEach((routeId) =>
        shimHelper(helpers.loaders, "navigation", "loader", routeId)
      );

      try {
        let redirectResponse = redirect(href, { status, headers });
        if (isRejection) {
          // @ts-ignore
          await internalHelpers.dfd.reject(redirectResponse);
        } else {
          await internalHelpers.dfd.resolve(redirectResponse);
        }
        await tick();
      } catch (e) {}
      return helpers;
    }

    let routeHelpers: Helpers = {
      get signal() {
        return internalHelpers._signal!;
      },
      // Note: This spread has to come _after_ the above getter, otherwise
      // we lose the getter nature of it somewhere in the babel/typescript
      // transform.  Doesn't seem ot be an issue in ts-jest but that's a
      // bit large of a change to look into at the moment
      ...internalHelpers,
      // Public APIs only needed for test execution
      async resolve(value) {
        await internalHelpers.dfd.resolve(value);
      },
      async reject(value) {
        try {
          await internalHelpers.dfd.reject(value);
        } catch (e) {}
      },
      async redirect(href, status = 301, headers = {}, shims = []) {
        return _redirect(true, href, status, headers, shims);
      },
      async redirectReturn(href, status = 301, headers = {}, shims = []) {
        return _redirect(false, href, status, headers, shims);
      },
    };
    return routeHelpers;
  }

  function getHelpers(
    matches: AgnosticRouteMatch<string, AgnosticDataRouteObject>[],
    navigationId: number,
    addHelpers: (routeId: string, helpers: InternalHelpers) => void
  ): Record<string, Helpers> {
    return matches.reduce(
      (acc, m) =>
        Object.assign(acc, {
          [m.route.id]: getRouteHelpers(m.route.id, navigationId, addHelpers),
        }),
      {}
    );
  }

  let inFlightRoutes: AgnosticDataRouteObject[] | undefined;
  function _internalSetRoutes(routes: AgnosticDataRouteObject[]) {
    inFlightRoutes = routes;
    currentRouter?._internalSetRoutes(routes);
  }

  function getNavigationHelpers(
    href: string,
    navigationId: number
  ): NavigationHelpers {
    invariant(
      currentRouter?.routes,
      "No currentRouter.routes available in getNavigationHelpers"
    );
    let matches = matchRoutes(inFlightRoutes || currentRouter.routes, href);

    // Generate helpers for all route matches that contain loaders
    let lazyHelpers = getHelpers(
      (matches || []).filter((m) => m.route.lazy),
      navigationId,
      (routeId, helpers) =>
        activeHelpers.set(`${navigationId}:lazy:${routeId}`, helpers)
    );
    let loaderHelpers = getHelpers(
      (matches || []).filter((m) => m.route.loader),
      navigationId,
      (routeId, helpers) =>
        activeHelpers.set(
          `navigation:${navigationId}:loader:${routeId}`,
          helpers
        )
    );
    let actionHelpers = getHelpers(
      (matches || []).filter((m) => m.route.action),
      navigationId,
      (routeId, helpers) =>
        activeHelpers.set(
          `navigation:${navigationId}:action:${routeId}`,
          helpers
        )
    );

    return {
      navigationId,
      lazy: lazyHelpers,
      loaders: loaderHelpers,
      actions: actionHelpers,
    };
  }

  function getFetcherHelpers(
    key: string,
    href: string,
    navigationId: number,
    opts?: RouterNavigateOptions
  ): FetcherHelpers {
    invariant(
      currentRouter?.routes,
      "No currentRouter.routes available in getFetcherHelpers"
    );
    let matches = matchRoutes(inFlightRoutes || currentRouter.routes, href);
    invariant(currentRouter, "No currentRouter available");
    let search = parsePath(href).search || "";
    let hasNakedIndexQuery = new URLSearchParams(search)
      .getAll("index")
      .some((v) => v === "");

    // Let fetcher 404s go right through
    if (!matches) {
      return {
        key,
        navigationId,
        get fetcher() {
          invariant(currentRouter, "No currentRouter available");
          return currentRouter.getFetcher(key);
        },
        lazy: {},
        loaders: {},
        actions: {},
      };
    }

    let match =
      matches[matches.length - 1].route.index && !hasNakedIndexQuery
        ? matches.slice(-2)[0]
        : matches.slice(-1)[0];

    // If this is an action submission we need loaders for all current matches.
    // Otherwise we should only need a loader for the leaf match
    let activeLoaderMatches = [match];
    // @ts-expect-error
    if (opts?.formMethod != null && opts.formMethod.toUpperCase() !== "GET") {
      if (currentRouter.state.navigation?.location) {
        let matches = matchRoutes(
          inFlightRoutes || currentRouter.routes,
          currentRouter.state.navigation.location
        );
        invariant(matches, "No matches found for fetcher");
        activeLoaderMatches = matches;
      } else {
        activeLoaderMatches = currentRouter.state.matches;
      }
    }

    // Generate helpers for all route matches that contain loaders
    let lazyHelpers = getHelpers(
      match.route.lazy ? [match] : [],
      navigationId,
      (routeId, helpers) =>
        activeHelpers.set(`${navigationId}:lazy:${routeId}`, helpers)
    );
    let loaderHelpers = getHelpers(
      activeLoaderMatches.filter((m) => m.route.loader),
      navigationId,
      (routeId, helpers) =>
        activeHelpers.set(`fetch:${navigationId}:loader:${routeId}`, helpers)
    );
    let actionHelpers = getHelpers(
      match.route.action ? [match] : [],
      navigationId,
      (routeId, helpers) =>
        activeHelpers.set(`fetch:${navigationId}:action:${routeId}`, helpers)
    );

    return {
      key,
      navigationId,
      get fetcher() {
        invariant(currentRouter, "No currentRouter available");
        return {
          ...currentRouter.getFetcher(key),
          data: fetcherData.get(key),
        };
      },
      lazy: lazyHelpers,
      loaders: loaderHelpers,
      actions: actionHelpers,
    };
  }

  // Simulate a navigation, returning a series of helpers to manually
  // control/assert loader/actions
  function navigate(n: number): Promise<NavigationHelpers>;
  function navigate(
    href: string,
    opts?: RouterNavigateOptions,
    shims?: string[]
  ): Promise<NavigationHelpers>;
  async function navigate(
    href: number | string,
    opts?: RouterNavigateOptions,
    shims?: string[]
  ): Promise<NavigationHelpers> {
    let navigationId = ++guid;
    let helpers: NavigationHelpers;

    invariant(currentRouter, "No currentRouter available");

    // @ts-expect-error
    if (opts?.formMethod != null && opts.formMethod.toUpperCase() !== "GET") {
      activeActionType = "navigation";
      activeActionNavigationId = navigationId;
      // Assume happy path and mark this navigations loaders as active.  Even if
      // we never call them from the router (if the action rejects) we'll want
      // this to be accurate so we can assert against the stubs
      activeLoaderType = "navigation";
      activeLoaderNavigationId = navigationId;
    } else {
      activeLoaderType = "navigation";
      activeLoaderNavigationId = navigationId;
    }

    if (typeof href === "number") {
      let promise = new Promise<void>((r) => {
        invariant(currentRouter, "No currentRouter available");
        let unsubscribe = currentRouter.subscribe(() => {
          let popHref = history.createHref(history.location);
          if (currentRouter?.basename) {
            popHref = stripBasename(popHref, currentRouter.basename) as string;
            invariant(
              popHref,
              "href passed to navigate should start with basename"
            );
          }
          helpers = getNavigationHelpers(popHref, navigationId);
          unsubscribe();
          r();
        });
      });
      currentRouter.navigate(href);
      await promise;
      //@ts-ignore
      return helpers;
    }

    helpers = getNavigationHelpers(href, navigationId);
    shims?.forEach((routeId) =>
      shimHelper(helpers.loaders, "navigation", "loader", routeId)
    );
    currentRouter.navigate(href, opts);
    return helpers;
  }

  // Simulate a fetcher call, returning a series of helpers to manually
  // control/assert loader/actions
  async function fetch(
    href: string,
    opts?: RouterFetchOptions
  ): Promise<FetcherHelpers>;
  async function fetch(
    href: string,
    key: string,
    opts?: RouterFetchOptions
  ): Promise<FetcherHelpers>;
  async function fetch(
    href: string,
    key: string,
    routeId: string,
    opts?: RouterFetchOptions
  ): Promise<FetcherHelpers>;
  async function fetch(
    href: string,
    keyOrOpts?: string | RouterFetchOptions,
    routeIdOrOpts?: string | RouterFetchOptions,
    opts?: RouterFetchOptions
  ): Promise<FetcherHelpers> {
    let navigationId = ++guid;
    let key = typeof keyOrOpts === "string" ? keyOrOpts : String(navigationId);
    let routeId =
      typeof routeIdOrOpts === "string"
        ? routeIdOrOpts
        : String(currentRouter?.routes[0].id);
    opts =
      typeof keyOrOpts === "object"
        ? keyOrOpts
        : typeof routeIdOrOpts === "object"
        ? routeIdOrOpts
        : opts;
    invariant(currentRouter, "No currentRouter available");

    // @ts-expect-error
    if (opts?.formMethod != null && opts.formMethod.toUpperCase() !== "GET") {
      activeActionType = "fetch";
      activeActionFetchId = navigationId;
    } else {
      activeLoaderType = "fetch";
      activeLoaderFetchId = navigationId;
    }

    let helpers = getFetcherHelpers(key, href, navigationId, opts);
    currentRouter.fetch(key, routeId, href, opts);
    return helpers;
  }

  // Simulate a revalidation, returning a series of helpers to manually
  // control/assert loader/actions
  async function revalidate(
    type: "navigation" | "fetch" = "navigation",
    shimRouteId?: string
  ): Promise<NavigationHelpers> {
    invariant(currentRouter, "No currentRouter available");
    let navigationId;
    if (type === "fetch") {
      // This is a special case for when we want to test revalidation against
      // fetchers, so that our A.loaders.routeId will trigger the fetcher loader,
      // not the route loader
      navigationId = ++guid;
      activeLoaderType = "fetch";
      activeLoaderFetchId = navigationId;
    } else {
      // if a revalidation interrupts an action submission, we don't actually
      // start a new navigation so don't increment here
      navigationId =
        currentRouter.state.navigation.state === "submitting" &&
        currentRouter.state.navigation.formMethod !== "GET"
          ? guid
          : ++guid;
      activeLoaderType = "navigation";
      activeLoaderNavigationId = navigationId;
    }
    let href = currentRouter.createHref(
      currentRouter.state.navigation.location || currentRouter.state.location
    );
    let helpers = getNavigationHelpers(href, navigationId);
    if (shimRouteId) {
      shimHelper(helpers.loaders, type, "loader", shimRouteId);
    }
    currentRouter.revalidate();
    return helpers;
  }

  function shimHelper(
    navHelpers: Record<string, Helpers>,
    type: "navigation" | "fetch",
    type2: "loader" | "action",
    routeId: string
  ) {
    invariant(!navHelpers[routeId], "Can't overwrite existing helpers");
    navHelpers[routeId] = getRouteHelpers(routeId, guid, (routeId, helpers) =>
      activeHelpers.set(`${type}:${guid}:${type2}:${routeId}`, helpers)
    );
  }

  return {
    window: testWindow,
    history,
    router: currentRouter,
    get fetchers() {
      let fetchers = {};
      currentRouter?.state.fetchers.forEach((f, key) => {
        fetchers[key] = {
          ...f,
          data: fetcherData.get(key),
        };
      });
      fetcherData.forEach((data, key) => {
        if (!fetchers[key]) {
          fetchers[key] = {
            ...IDLE_FETCHER,
            data: fetcherData.get(key),
          };
        }
      });
      return fetchers;
    },
    navigate,
    fetch,
    revalidate,
    shimHelper,
    enhanceRoutes,
    _internalSetRoutes,
  };
}

export function cleanup(_router?: Router) {
  let router = _router || currentRouter;

  // Cleanup any routers created using setup()
  if (router) {
    expect(router._internalFetchControllers.size).toBe(0);
  }
  router?.dispose();
  currentRouter = null;

  // Reject any lingering deferreds and remove
  for (let dfd of gcDfds.values()) {
    dfd.reject();
    gcDfds.delete(dfd);
  }
  expect(gcDfds.size).toBe(0);
}
