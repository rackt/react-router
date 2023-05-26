/* eslint-disable jest/valid-title */
import type {
  AgnosticDataRouteObject,
  AgnosticRouteMatch,
  Fetcher,
  RouterFetchOptions,
  HydrationState,
  InitialEntry,
  Router,
  RouterNavigateOptions,
  StaticHandler,
  StaticHandlerContext,
  FutureConfig,
} from "../index";
import {
  createMemoryHistory,
  createPath,
  createRouter,
  createStaticHandler,
  defer,
  UNSAFE_DEFERRED_SYMBOL,
  ErrorResponse,
  IDLE_FETCHER,
  IDLE_NAVIGATION,
  json,
  matchRoutes,
  redirect,
  parsePath,
} from "../index";

// Private API
import type {
  AgnosticIndexRouteObject,
  AgnosticNonIndexRouteObject,
  AgnosticRouteObject,
  DeferredData,
  TrackedPromise,
} from "../utils";
import {
  AbortedDeferredError,
  isRouteErrorResponse,
  stripBasename,
} from "../utils";

///////////////////////////////////////////////////////////////////////////////
//#region Types and Utils
///////////////////////////////////////////////////////////////////////////////

// Routes passed into setup() should just have a boolean for loader/action
// indicating they want a stub.  They get enhanced back to AgnosticRouteObjects
// by our test harness
type TestIndexRouteObject = Pick<
  AgnosticIndexRouteObject,
  "id" | "index" | "path" | "shouldRevalidate"
> & {
  lazy?: boolean;
  loader?: boolean;
  action?: boolean;
  hasErrorBoundary?: boolean;
};

type TestNonIndexRouteObject = Pick<
  AgnosticNonIndexRouteObject,
  "id" | "index" | "path" | "shouldRevalidate"
> & {
  lazy?: boolean;
  loader?: boolean;
  action?: boolean;
  hasErrorBoundary?: boolean;
  children?: TestRouteObject[];
};

type TestRouteObject = TestIndexRouteObject | TestNonIndexRouteObject;

// A helper that includes the Deferred and stubs for any loaders/actions for the
// route allowing fine-grained test execution
type InternalHelpers = {
  navigationId: number;
  dfd: ReturnType<typeof createDeferred>;
  stub: jest.Mock;
  _signal?: AbortSignal;
};

type Helpers = InternalHelpers & {
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
type NavigationHelpers = {
  navigationId: number;
  lazy: Record<string, Helpers>;
  loaders: Record<string, Helpers>;
  actions: Record<string, Helpers>;
};

type FetcherHelpers = NavigationHelpers & {
  key: string;
  fetcher: Fetcher;
};

async function tick() {
  await new Promise((r) => setTimeout(r, 0));
}

function invariant(value: boolean, message?: string): asserts value;
function invariant<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T;
function invariant(value: any, message?: string) {
  if (value === false || value === null || typeof value === "undefined") {
    console.warn("Test invariant failed:", message);
    throw new Error(message);
  }
}

function createDeferred() {
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

function createFormData(obj: Record<string, string>): FormData {
  let formData = new FormData();
  Object.entries(obj).forEach((e) => formData.append(e[0], e[1]));
  return formData;
}

function isRedirect(result: any) {
  return (
    result instanceof Response && result.status >= 300 && result.status <= 399
  );
}

function findRouteById(
  routes: AgnosticDataRouteObject[],
  id: string
): AgnosticDataRouteObject {
  let foundRoute: AgnosticDataRouteObject | null = null;
  for (const route of routes) {
    if (route.id === id) {
      foundRoute = route;
      break;
    }
    if (route.children) {
      foundRoute = findRouteById(route.children, id);
      if (foundRoute) {
        break;
      }
    }
  }

  invariant(foundRoute, `Route not found with id "${id}".`);

  return foundRoute;
}

interface CustomMatchers<R = jest.Expect> {
  URL(url: string);
  trackedPromise(data?: any, error?: any, aborted?: boolean): R;
  deferredData(
    done: boolean,
    status?: number,
    headers?: Record<string, string>
  ): R;
}

declare global {
  namespace jest {
    interface Expect extends CustomMatchers {}
    interface Matchers<R> extends CustomMatchers<R> {}
    interface InverseAsymmetricMatchers extends CustomMatchers {}
  }
}

expect.extend({
  // Custom matcher for asserting against URLs
  URL(received, url) {
    return {
      message: () => `expected URL ${received.toString()} to equal URL ${url}`,
      pass: received instanceof URL && received.toString() === url,
    };
  },
  // Custom matcher for asserting deferred promise results for static handler
  //  - expect(val).deferredData(false) => Unresolved promise
  //  - expect(val).deferredData(false) => Resolved promise
  //  - expect(val).deferredData(false, 201, { 'x-custom': 'yes' })
  //      => Unresolved promise with status + headers
  //  - expect(val).deferredData(true, 201, { 'x-custom': 'yes' })
  //      => Resolved promise with status + headers
  deferredData(received, done, status = 200, headers = {}) {
    let deferredData = received as DeferredData;

    return {
      message: () =>
        `expected done=${String(
          done
        )}/status=${status}/headers=${JSON.stringify(headers)}, ` +
        `instead got done=${String(deferredData.done)}/status=${
          deferredData.init!.status || 200
        }/headers=${JSON.stringify(
          Object.fromEntries(new Headers(deferredData.init!.headers).entries())
        )}`,
      pass:
        deferredData.done === done &&
        (deferredData.init!.status || 200) === status &&
        JSON.stringify(
          Object.fromEntries(new Headers(deferredData.init!.headers).entries())
        ) === JSON.stringify(headers),
    };
  },
  // Custom matcher for asserting deferred promise results inside of `toEqual()`
  //  - expect.trackedPromise()                  =>  pending promise
  //  - expect.trackedPromise(value)             =>  promise resolved with `value`
  //  - expect.trackedPromise(null, error)       =>  promise rejected with `error`
  //  - expect.trackedPromise(null, null, true)  =>  promise aborted
  trackedPromise(received, data, error, aborted = false) {
    let promise = received as TrackedPromise;
    let isTrackedPromise =
      promise instanceof Promise && promise._tracked === true;

    if (data != null) {
      let dataMatches = promise._data === data;
      return {
        message: () => `expected ${received} to be a resolved deferred`,
        pass: isTrackedPromise && dataMatches,
      };
    }

    if (error != null) {
      let errorMatches =
        error instanceof Error
          ? promise._error.toString() === error.toString()
          : promise._error === error;
      return {
        message: () => `expected ${received} to be a rejected deferred`,
        pass: isTrackedPromise && errorMatches,
      };
    }

    if (aborted) {
      let errorMatches = promise._error instanceof AbortedDeferredError;
      return {
        message: () => `expected ${received} to be an aborted deferred`,
        pass: isTrackedPromise && errorMatches,
      };
    }

    return {
      message: () => `expected ${received} to be a pending deferred`,
      pass:
        isTrackedPromise &&
        promise._data === undefined &&
        promise._error === undefined,
    };
  },
});

// Router created by setup() - used for automatic cleanup
let currentRouter: Router | null = null;
// A set of to-be-garbage-collected Deferred's to clean up at the end of a test
let gcDfds = new Set<ReturnType<typeof createDeferred>>();

type SetupOpts = {
  routes: TestRouteObject[];
  basename?: string;
  initialEntries?: InitialEntry[];
  initialIndex?: number;
  hydrationData?: HydrationState;
  future?: FutureConfig;
};

function setup({
  routes,
  basename,
  initialEntries,
  initialIndex,
  hydrationData,
  future,
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
            .map((id) => `${id}:lazy:${r.id}`)
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
        enhancedRoute.loader = (args) => {
          let navigationId =
            activeLoaderType === "fetch"
              ? activeLoaderFetchId
              : activeLoaderNavigationId;
          let helperKey = `${activeLoaderType}:${navigationId}:loader:${r.id}`;
          let helpers = activeHelpers.get(helperKey);
          invariant(helpers, `No helpers found for: ${helperKey}`);
          helpers.stub(args);
          helpers._signal = args.request.signal;
          return helpers.dfd.promise;
        };
      }
      if (r.action) {
        enhancedRoute.action = (args) => {
          let type = activeActionType;
          let navigationId =
            activeActionType === "fetch"
              ? activeActionFetchId
              : activeActionNavigationId;
          let helperKey = `${activeActionType}:${navigationId}:action:${r.id}`;
          let helpers = activeHelpers.get(helperKey);
          invariant(helpers, `No helpers found for: ${helperKey}`);
          helpers.stub(args);
          helpers._signal = args.request.signal;
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
    history,
    routes: enhanceRoutes(routes),
    hydrationData,
    future,
    window: testWindow,
  }).initialize();

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
    if (opts?.formMethod != null && opts.formMethod.toLowerCase() !== "get") {
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
        return currentRouter.getFetcher(key);
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
    if (opts?.formMethod != null && opts.formMethod.toLowerCase() !== "get") {
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

    let navHref = href;
    if (currentRouter.basename) {
      navHref = stripBasename(navHref, currentRouter.basename) as string;
      invariant(
        navHref,
        "href passed to t.navigate() should start with basename"
      );
    }
    helpers = getNavigationHelpers(navHref, navigationId);
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
    if (opts?.formMethod != null && opts.formMethod.toLowerCase() !== "get") {
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
        currentRouter.state.navigation.formMethod !== "get"
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
    navigate,
    fetch,
    revalidate,
    shimHelper,
    enhanceRoutes,
    _internalSetRoutes,
  };
}

function initializeTmTest(init?: {
  url?: string;
  hydrationData?: HydrationState;
}) {
  return setup({
    routes: TM_ROUTES,
    hydrationData: init?.hydrationData || {
      loaderData: { root: "ROOT", index: "INDEX" },
    },
    ...(init?.url ? { initialEntries: [init.url] } : {}),
  });
}

function createRequest(path: string, opts?: RequestInit) {
  return new Request(`http://localhost${path}`, opts);
}

function createSubmitRequest(path: string, opts?: RequestInit) {
  let searchParams = new URLSearchParams();
  searchParams.append("key", "value");

  return createRequest(path, {
    method: "post",
    body: searchParams,
    ...opts,
  });
}

//#endregion

///////////////////////////////////////////////////////////////////////////////
//#region Tests
///////////////////////////////////////////////////////////////////////////////

// Reusable routes for a simple tasks app, for test cases that don't want
// to create their own more complex routes
const TASK_ROUTES: TestRouteObject[] = [
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

const TM_ROUTES: TestRouteObject[] = [
  {
    path: "",
    id: "root",
    hasErrorBoundary: true,
    loader: true,
    children: [
      {
        path: "/",
        id: "index",
        loader: true,
        action: true,
      },
      {
        path: "/foo",
        id: "foo",
        loader: true,
        action: true,
      },
      {
        path: "/foo/bar",
        id: "foobar",
        loader: true,
        action: true,
      },
      {
        path: "/bar",
        id: "bar",
        loader: true,
        action: true,
      },
      {
        path: "/baz",
        id: "baz",
        loader: true,
        action: true,
      },
      {
        path: "/p/:param",
        id: "param",
        loader: true,
        action: true,
      },
      {
        path: "/no-loader",
        id: "noLoader",
        loader: false,
        action: true,
      },
    ],
  },
];

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

// Detect any failures inside the router navigate code
afterEach(() => {
  // Cleanup any routers created using setup()
  if (currentRouter) {
    // eslint-disable-next-line jest/no-standalone-expect
    expect(currentRouter._internalFetchControllers.size).toBe(0);
    // eslint-disable-next-line jest/no-standalone-expect
    expect(currentRouter._internalActiveDeferreds.size).toBe(0);
  }
  currentRouter?.dispose();
  currentRouter = null;

  // Reject any lingering deferreds and remove
  for (let dfd of gcDfds.values()) {
    dfd.reject();
    gcDfds.delete(dfd);
  }

  // @ts-ignore
  console.warn.mockReset();
});

describe("a router", () => {
  describe("init", () => {
    it("initial state w/o hydrationData", async () => {
      let history = createMemoryHistory({ initialEntries: ["/"] });
      let router = createRouter({
        routes: [
          {
            id: "root",
            path: "/",
            hasErrorBoundary: true,
            loader: () => Promise.resolve(),
          },
        ],
        history,
      });
      expect(router.state).toEqual({
        historyAction: "POP",
        loaderData: {},
        actionData: null,
        errors: null,
        location: {
          hash: "",
          key: expect.any(String),
          pathname: "/",
          search: "",
          state: null,
        },
        matches: [
          {
            params: {},
            pathname: "/",
            pathnameBase: "/",
            route: {
              hasErrorBoundary: true,
              id: "root",
              loader: expect.any(Function),
              path: "/",
            },
          },
        ],
        initialized: false,
        navigation: {
          location: undefined,
          state: "idle",
        },
        preventScrollReset: false,
        restoreScrollPosition: null,
        revalidation: "idle",
        fetchers: new Map(),
        blockers: new Map(),
      });
    });

    it("initial state w/hydrationData values", async () => {
      let history = createMemoryHistory({ initialEntries: ["/"] });
      let router = createRouter({
        routes: [
          {
            id: "root",
            path: "/",
            hasErrorBoundary: true,
            loader: () => Promise.resolve(),
          },
        ],
        history,
        hydrationData: {
          loaderData: { root: "LOADER DATA" },
          actionData: { root: "ACTION DATA" },
          errors: { root: new Error("lol") },
        },
      });
      expect(router.state).toEqual({
        historyAction: "POP",
        loaderData: {
          root: "LOADER DATA",
        },
        actionData: {
          root: "ACTION DATA",
        },
        errors: {
          root: new Error("lol"),
        },
        location: {
          hash: "",
          key: expect.any(String),
          pathname: "/",
          search: "",
          state: null,
        },
        matches: [
          {
            params: {},
            pathname: "/",
            pathnameBase: "/",
            route: {
              hasErrorBoundary: true,
              id: "root",
              loader: expect.any(Function),
              path: "/",
            },
          },
        ],
        initialized: true,
        navigation: {
          location: undefined,
          state: "idle",
        },
        preventScrollReset: false,
        restoreScrollPosition: false,
        revalidation: "idle",
        fetchers: new Map(),
        blockers: new Map(),
      });
    });

    it("requires routes", async () => {
      let history = createMemoryHistory({ initialEntries: ["/"] });
      expect(() =>
        createRouter({
          routes: [],
          history,
          hydrationData: {},
        })
      ).toThrowErrorMatchingInlineSnapshot(
        `"You must provide a non-empty routes array to createRouter"`
      );
    });

    it("converts routes to data routes", async () => {
      let history = createMemoryHistory({
        initialEntries: ["/child/grandchild"],
      });
      let routes = [
        {
          path: "/",
          children: [
            {
              id: "child-keep-me",
              path: "child",
              children: [
                {
                  path: "grandchild",
                },
              ],
            },
          ],
        },
      ];
      let originalRoutes = JSON.parse(JSON.stringify(routes));
      let router = createRouter({
        routes,
        history,
        hydrationData: {},
      });
      // routes are not mutated in place
      expect(routes).toEqual(originalRoutes);
      expect(router.state.matches).toMatchObject([
        {
          route: {
            id: "0",
          },
        },
        {
          route: {
            id: "child-keep-me",
          },
        },
        {
          route: {
            id: "0-0-0",
          },
        },
      ]);
    });

    it("throws if it finds duplicate route ids", async () => {
      let history = createMemoryHistory({
        initialEntries: ["/child/grandchild"],
      });
      let routes = [
        {
          path: "/",
          children: [
            {
              id: "child",
              path: "child",
              children: [
                {
                  id: "child",
                  path: "grandchild",
                },
              ],
            },
          ],
        },
      ];
      expect(() =>
        createRouter({
          routes,
          history,
          hydrationData: {},
        })
      ).toThrowErrorMatchingInlineSnapshot(
        `"Found a route id collision on id "child".  Route id's must be globally unique within Data Router usages"`
      );
    });

    it("throws if it finds index routes with children", async () => {
      let routes: AgnosticRouteObject[] = [
        // @ts-expect-error
        {
          index: true,
          children: [
            {
              path: "nope",
            },
          ],
        },
      ];
      expect(() =>
        createRouter({
          routes,
          history: createMemoryHistory(),
        })
      ).toThrowErrorMatchingInlineSnapshot(
        `"Cannot specify children on an index route"`
      );
    });

    it("supports a basename prop for route matching", async () => {
      let history = createMemoryHistory({
        initialEntries: ["/base/name/path"],
      });
      let router = createRouter({
        basename: "/base/name",
        routes: [{ path: "path" }],
        history,
      });
      expect(router.state).toMatchObject({
        location: {
          hash: "",
          key: expect.any(String),
          pathname: "/base/name/path",
          search: "",
          state: null,
        },
        matches: [
          {
            params: {},
            pathname: "/path",
            pathnameBase: "/path",
            route: {
              id: "0",
              path: "path",
            },
          },
        ],
        initialized: true,
      });
    });

    it("supports subscribers", async () => {
      let history = createMemoryHistory({ initialEntries: ["/"] });
      let count = 0;
      let router = createRouter({
        routes: [
          {
            id: "root",
            path: "/",
            hasErrorBoundary: true,
            loader: () => ++count,
          },
        ],
        history,
        hydrationData: {
          loaderData: { root: 0 },
        },
      }).initialize();
      expect(router.state.loaderData).toEqual({
        root: 0,
      });

      let subscriber = jest.fn();
      let unsubscribe = router.subscribe(subscriber);
      let subscriber2 = jest.fn();
      let unsubscribe2 = router.subscribe(subscriber2);

      await router.navigate("/?key=a");
      expect(subscriber.mock.calls[0][0].navigation.state).toBe("loading");
      expect(subscriber.mock.calls[0][0].navigation.location.search).toBe(
        "?key=a"
      );
      expect(subscriber.mock.calls[1][0].navigation.state).toBe("idle");
      expect(subscriber.mock.calls[1][0].location.search).toBe("?key=a");
      expect(subscriber2.mock.calls[0][0].navigation.state).toBe("loading");
      expect(subscriber2.mock.calls[0][0].navigation.location.search).toBe(
        "?key=a"
      );
      expect(subscriber2.mock.calls[1][0].navigation.state).toBe("idle");
      expect(subscriber2.mock.calls[1][0].location.search).toBe("?key=a");

      unsubscribe2();
      await router.navigate("/?key=b");
      expect(subscriber.mock.calls[2][0].navigation.state).toBe("loading");
      expect(subscriber.mock.calls[2][0].navigation.location.search).toBe(
        "?key=b"
      );
      expect(subscriber.mock.calls[3][0].navigation.state).toBe("idle");
      expect(subscriber.mock.calls[3][0].location.search).toBe("?key=b");

      unsubscribe();
      await router.navigate("/?key=c");
      expect(subscriber).toHaveBeenCalledTimes(4);
      expect(subscriber2).toHaveBeenCalledTimes(2);
    });
  });

  describe("normal navigation", () => {
    it("fetches data on navigation", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.loaderData).toMatchInlineSnapshot(`
        {
          "foo": "FOO",
          "root": "ROOT",
        }
      `);
    });

    it("allows `null` as a valid data value", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve(null);
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        foo: null,
      });
    });

    it("unwraps non-redirect json Responses", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve(
        new Response(JSON.stringify({ key: "value" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        foo: { key: "value" },
      });
    });

    it("unwraps non-redirect json Responses (json helper)", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve(json({ key: "value" }, 200));
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        foo: { key: "value" },
      });
    });

    it("unwraps non-redirect text Responses", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve(new Response("FOO", { status: 200 }));
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        foo: "FOO",
      });
    });

    it("does not fetch unchanging layout data", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("FOO");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(t.router.state.loaderData.root).toBe("ROOT");
    });

    it("reloads all routes on search changes", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo?q=1");
      await A.loaders.root.resolve("ROOT1");
      await A.loaders.foo.resolve("1");
      expect(A.loaders.root.stub.mock.calls.length).toBe(1);
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT1",
        foo: "1",
      });

      let B = await t.navigate("/foo?q=2");
      await B.loaders.root.resolve("ROOT2");
      await B.loaders.foo.resolve("2");
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT2",
        foo: "2",
      });
    });

    it("does not reload all routes when search does not change", async () => {
      let t = initializeTmTest();
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
      });

      let A = await t.navigate("/foo?q=1");
      await A.loaders.root.resolve("ROOT1");
      await A.loaders.foo.resolve("1");
      expect(A.loaders.root.stub.mock.calls.length).toBe(1);
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT1",
        foo: "1",
      });

      let B = await t.navigate("/foo/bar?q=1");
      await B.loaders.foobar.resolve("2");
      expect(B.loaders.root.stub.mock.calls.length).toBe(0);

      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT1",
        foobar: "2",
      });
    });

    it("reloads only routes with changed params", async () => {
      let t = initializeTmTest();

      let A = await t.navigate("/p/one");
      await A.loaders.param.resolve("one");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        param: "one",
      });

      let B = await t.navigate("/p/two");
      await B.loaders.param.resolve("two");
      expect(B.loaders.root.stub.mock.calls.length).toBe(0);
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        param: "two",
      });
    });

    it("reloads all routes on refresh", async () => {
      let t = initializeTmTest();
      let url = "/p/same";

      let A = await t.navigate(url);
      await A.loaders.param.resolve("1");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        param: "1",
      });

      let B = await t.navigate(url);
      await B.loaders.root.resolve("ROOT2");
      await B.loaders.param.resolve("2");
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT2",
        param: "2",
      });
    });

    it("does not run loaders on hash change only navigations (no hash -> hash)", async () => {
      let t = initializeTmTest();
      expect(t.router.state.loaderData).toMatchObject({ root: "ROOT" });
      let A = await t.navigate("/#bar");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(t.router.state.loaderData).toMatchObject({ root: "ROOT" });
    });

    it("does not run loaders on hash change only navigations (hash -> new hash)", async () => {
      let t = initializeTmTest({ url: "/#foo" });
      expect(t.router.state.loaderData).toMatchObject({ root: "ROOT" });
      let A = await t.navigate("/#bar");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(t.router.state.loaderData).toMatchObject({ root: "ROOT" });
    });

    it("does not run loaders on same-hash navigations", async () => {
      let t = initializeTmTest({ url: "/#bar" });
      expect(t.router.state.loaderData).toMatchObject({ root: "ROOT" });
      let A = await t.navigate("/#bar");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(A.loaders.index.stub.mock.calls.length).toBe(0);
    });

    it("runs loaders on same-hash navigations to new paths", async () => {
      let t = initializeTmTest({ url: "/#bar" });
      expect(t.router.state.loaderData).toMatchObject({ root: "ROOT" });
      let A = await t.navigate("/foo#bar");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(A.loaders.foo.stub.mock.calls.length).toBe(1);
    });

    it("runs loaders on hash removal navigations (same path)", async () => {
      let t = initializeTmTest({ url: "/#bar" });
      expect(t.router.state.loaderData).toMatchObject({ root: "ROOT" });
      let A = await t.navigate("/");
      expect(A.loaders.root.stub.mock.calls.length).toBe(1);
      expect(A.loaders.index.stub.mock.calls.length).toBe(1);
    });

    it("runs loaders on hash removal navigations (nested path)", async () => {
      let t = initializeTmTest({ url: "/#bar" });
      expect(t.router.state.loaderData).toMatchObject({ root: "ROOT" });
      let A = await t.navigate("/foo");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(A.loaders.foo.stub.mock.calls.length).toBe(1);
    });

    it('does not load anything on hash change only empty <Form method="get"> navigations', async () => {
      let t = initializeTmTest();
      expect(t.router.state.loaderData).toMatchObject({ root: "ROOT" });
      let A = await t.navigate("/#bar", {
        formData: createFormData({}),
      });
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(t.router.state.loaderData).toMatchObject({ root: "ROOT" });
    });

    it('runs loaders on hash change only non-empty <Form method="get"> navigations', async () => {
      let t = initializeTmTest();
      expect(t.router.state.loaderData).toMatchObject({ root: "ROOT" });
      let A = await t.navigate("/#bar", {
        formData: createFormData({ key: "value" }),
      });
      await A.loaders.root.resolve("ROOT 2");
      await A.loaders.index.resolve("INDEX 2");
      expect(t.router.state.location.search).toBe("?key=value");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT 2",
        index: "INDEX 2",
      });
    });

    it('runs action/loaders on hash change only <Form method="post"> navigations', async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo#bar");
      expect(t.router.state.navigation.state).toBe("loading");
      await A.loaders.foo.resolve("A");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        foo: "A",
      });

      // Submit while we have an active hash causing us to lose it
      let B = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({}),
      });
      expect(t.router.state.navigation.state).toBe("submitting");
      await B.actions.foo.resolve("ACTION");
      await B.loaders.root.resolve("ROOT 2");
      await B.loaders.foo.resolve("B");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.actionData).toMatchObject({
        foo: "ACTION",
      });
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT 2",
        foo: "B",
      });
    });

    it("sets all right states on hash change only", async () => {
      let t = initializeTmTest();
      let key = t.router.state.location.key;
      t.navigate("/#bar");
      // hash changes are synchronous but force a key change
      expect(t.router.state.location.key).not.toBe(key);
      expect(t.router.state.location.hash).toBe("#bar");
      expect(t.router.state.navigation.state).toBe("idle");
    });

    it("loads new data on new routes even if there's also a hash change", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo#bar");
      expect(t.router.state.navigation.state).toBe("loading");
      await A.loaders.foo.resolve("A");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        foo: "A",
      });
    });

    it("redirects from loaders (throw)", async () => {
      let t = initializeTmTest();

      let A = await t.navigate("/bar");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location?.pathname).toBe("/bar");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
      });

      let B = await A.loaders.bar.redirect("/baz");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location?.pathname).toBe("/baz");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
      });

      await B.loaders.baz.resolve("B");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.location.pathname).toBe("/baz");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        baz: "B",
      });
    });

    it("redirects from loaders (return)", async () => {
      let t = initializeTmTest();

      let A = await t.navigate("/bar");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location?.pathname).toBe("/bar");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
      });

      let B = await A.loaders.bar.redirectReturn("/baz");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location?.pathname).toBe("/baz");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
      });

      await B.loaders.baz.resolve("B");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.location.pathname).toBe("/baz");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        baz: "B",
      });
    });

    it("reloads all routes if X-Remix-Revalidate was set in a loader redirect header", async () => {
      let t = initializeTmTest();

      let A = await t.navigate("/foo");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location?.pathname).toBe("/foo");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
      });

      let B = await A.loaders.foo.redirectReturn("/bar", undefined, {
        "X-Remix-Revalidate": "yes",
      });
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location?.pathname).toBe("/bar");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
      });

      await B.loaders.root.resolve("ROOT*");
      await B.loaders.bar.resolve("BAR");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.location.pathname).toBe("/bar");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT*",
        bar: "BAR",
      });
    });

    it("reloads all routes if X-Remix-Revalidate was set in a loader redirect header (chained redirects)", async () => {
      let t = initializeTmTest();

      let A = await t.navigate("/foo");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0); // Reused on navigation

      let B = await A.loaders.foo.redirectReturn("/bar", undefined, {
        "X-Remix-Revalidate": "yes",
      });
      await B.loaders.root.resolve("ROOT*");
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);

      // No cookie on second redirect
      let C = await B.loaders.bar.redirectReturn("/baz");
      expect(C.loaders.root.stub.mock.calls.length).toBe(1);
      await C.loaders.root.resolve("ROOT**");
      await C.loaders.baz.resolve("BAZ");

      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.location.pathname).toBe("/baz");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT**",
        baz: "BAZ",
      });
    });
  });

  describe("shouldRevalidate", () => {
    it("provides a default implementation", async () => {
      let rootLoader = jest.fn((args) => "ROOT");

      let history = createMemoryHistory();
      let router = createRouter({
        history,
        routes: [
          {
            path: "",
            loader: async (...args) => rootLoader(...args),
            children: [
              {
                path: "/",
                id: "index",
              },
              {
                path: "/child",
                action: async () => null,
              },
              {
                path: "/redirect",
                action: async () =>
                  new Response(null, {
                    status: 301,
                    headers: { location: "/" },
                  }),
              },
              {
                path: "/cookie",
                loader: async () =>
                  new Response(null, {
                    status: 301,
                    headers: {
                      location: "/",
                      "X-Remix-Revalidate": "1",
                    },
                  }),
              },
            ],
          },
        ],
      });
      router.initialize();

      // Initial load - no existing data, should always call loader
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      // Should not re-run on normal navigations re-using the loader
      router.navigate("/child");
      await tick();
      router.navigate("/");
      await tick();
      router.navigate("/child");
      await tick();
      expect(rootLoader.mock.calls.length).toBe(0);
      rootLoader.mockClear();

      // Should call on same-path navigations
      router.navigate("/child");
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      // Should call on query string changes
      router.navigate("/child?key=value");
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      // Should call after form submission revalidation
      router.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      // Should call after form submission redirect
      router.navigate("/redirect", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      // Should call after loader redirect with X-Remix-Revalidate
      router.navigate("/cookie");
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      router.dispose();
    });

    it("delegates to the route if it should reload or not", async () => {
      let rootLoader = jest.fn((args) => "ROOT");
      let childLoader = jest.fn((args) => "CHILD");
      let paramsLoader = jest.fn((args) => "PARAMS");
      let shouldRevalidate = jest.fn((args) => false);

      let history = createMemoryHistory();
      let router = createRouter({
        history,
        routes: [
          {
            path: "",
            id: "root",
            loader: async (...args) => rootLoader(...args),
            shouldRevalidate: (args) => shouldRevalidate(args) === true,

            children: [
              {
                path: "/",
                id: "index",
              },
              {
                path: "/child",
                id: "child",
                loader: async (...args) => childLoader(...args),
                action: async () => ({ ok: false }),
              },
              {
                path: "/params/:a/:b",
                id: "params",
                loader: async (...args) => paramsLoader(...args),
              },
            ],
          },
        ],
      });
      router.initialize();

      // Initial load - no existing data, should always call loader and should
      // not give use ability to opt-out
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(shouldRevalidate.mock.calls.length).toBe(0);
      rootLoader.mockClear();
      shouldRevalidate.mockClear();

      // Should not re-run on normal navigations re-using the loader
      router.navigate("/child");
      await tick();
      router.navigate("/");
      await tick();
      router.navigate("/child");
      await tick();
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(shouldRevalidate.mock.calls.length).toBe(3);
      rootLoader.mockClear();
      shouldRevalidate.mockClear();

      // Check that we pass the right args to shouldRevalidate and respect it's answer
      shouldRevalidate.mockImplementation(() => true);
      router.navigate("/params/aValue/bValue");
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(shouldRevalidate.mock.calls[0][0]).toMatchObject({
        currentParams: {},
        currentUrl: expect.URL("http://localhost/child"),
        nextParams: {
          a: "aValue",
          b: "bValue",
        },
        nextUrl: expect.URL("http://localhost/params/aValue/bValue"),
        defaultShouldRevalidate: false,
        actionResult: undefined,
      });
      rootLoader.mockClear();
      shouldRevalidate.mockClear();

      // On actions we send along the action result
      shouldRevalidate.mockImplementation(
        ({ actionResult }) => actionResult.ok === true
      );
      router.navigate("/child", {
        formMethod: "post",
        formData: createFormData({}),
      });
      await tick();
      expect(rootLoader.mock.calls.length).toBe(0);

      router.dispose();
    });

    it("includes submission on actions that return data", async () => {
      let shouldRevalidate = jest.fn(() => true);

      let history = createMemoryHistory({ initialEntries: ["/child"] });
      let router = createRouter({
        history,
        routes: [
          {
            path: "/",
            id: "root",
            loader: () => "ROOT",
            shouldRevalidate,
            children: [
              {
                path: "child",
                id: "child",
                loader: () => "CHILD",
                action: () => "ACTION",
              },
            ],
          },
        ],
      });
      router.initialize();

      // Initial load - no existing data, should always call loader and should
      // not give use ability to opt-out
      await tick();
      router.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await tick();
      expect(shouldRevalidate.mock.calls.length).toBe(1);
      // @ts-expect-error
      let arg = shouldRevalidate.mock.calls[0][0];
      expect(arg).toMatchObject({
        currentParams: {},
        currentUrl: expect.URL("http://localhost/child"),
        nextParams: {},
        nextUrl: expect.URL("http://localhost/child"),
        defaultShouldRevalidate: true,
        formMethod: "post",
        formAction: "/child",
        formEncType: "application/x-www-form-urlencoded",
        actionResult: "ACTION",
      });
      // @ts-expect-error
      expect(Object.fromEntries(arg.formData)).toEqual({ key: "value" });

      router.dispose();
    });

    it("includes submission on actions that return redirects", async () => {
      let shouldRevalidate = jest.fn(() => true);

      let history = createMemoryHistory({ initialEntries: ["/child"] });
      let router = createRouter({
        history,
        routes: [
          {
            path: "/",
            id: "root",
            loader: () => "ROOT",
            shouldRevalidate,
            children: [
              {
                path: "child",
                id: "child",
                loader: () => "CHILD",
                action: () => redirect("/"),
              },
            ],
          },
        ],
      });
      router.initialize();

      // Initial load - no existing data, should always call loader and should
      // not give use ability to opt-out
      await tick();
      router.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await tick();
      expect(shouldRevalidate.mock.calls.length).toBe(1);
      // @ts-expect-error
      let arg = shouldRevalidate.mock.calls[0][0];
      expect(arg).toMatchObject({
        currentParams: {},
        currentUrl: expect.URL("http://localhost/child"),
        nextParams: {},
        nextUrl: expect.URL("http://localhost/"),
        defaultShouldRevalidate: true,
        formMethod: "post",
        formAction: "/child",
        formEncType: "application/x-www-form-urlencoded",
        actionResult: undefined,
      });
      // @ts-expect-error
      expect(Object.fromEntries(arg.formData)).toEqual({ key: "value" });

      router.dispose();
    });

    it("provides the default implementation to the route function", async () => {
      let rootLoader = jest.fn((args) => "ROOT");

      let history = createMemoryHistory();
      let router = createRouter({
        history,
        routes: [
          {
            path: "",
            loader: async (...args) => rootLoader(...args),
            shouldRevalidate: ({ defaultShouldRevalidate }) =>
              defaultShouldRevalidate,
            children: [
              {
                path: "/",
                id: "index",
              },
              {
                path: "/child",
                action: async () => null,
              },
              {
                path: "/redirect",
                action: async () =>
                  new Response(null, {
                    status: 301,
                    headers: { location: "/" },
                  }),
              },
              {
                path: "/cookie",
                loader: async () =>
                  new Response(null, {
                    status: 301,
                    headers: {
                      location: "/",
                      "X-Remix-Revalidate": "1",
                    },
                  }),
              },
            ],
          },
        ],
      });
      router.initialize();

      // Initial load - no existing data, should always call loader
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      // Should not re-run on normal navigations re-using the loader
      router.navigate("/child");
      await tick();
      router.navigate("/");
      await tick();
      router.navigate("/child");
      await tick();
      expect(rootLoader.mock.calls.length).toBe(0);
      rootLoader.mockClear();

      // Should call on same-path navigations
      router.navigate("/child");
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      // Should call on query string changes
      router.navigate("/child?key=value");
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      // Should call after form submission revalidation
      router.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      // Should call after form submission redirect
      router.navigate("/redirect", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      // Should call after loader redirect with X-Remix-Revalidate
      router.navigate("/cookie");
      await tick();
      expect(rootLoader.mock.calls.length).toBe(1);
      rootLoader.mockClear();

      router.dispose();
    });

    it("applies to fetcher loads", async () => {
      let count = 0;
      let fetchLoader = jest.fn((args) => `FETCH ${++count}`);
      let shouldRevalidate = jest.fn((args) => false);

      let history = createMemoryHistory();
      let router = createRouter({
        history,
        routes: [
          {
            path: "",
            id: "root",

            children: [
              {
                path: "/",
                id: "index",
              },
              {
                path: "/child",
                id: "child",
              },
              {
                path: "/fetch",
                id: "fetch",
                loader: async (...args) => fetchLoader(...args),
                shouldRevalidate: (args) => shouldRevalidate(args) === true,
              },
            ],
          },
        ],
      });
      router.initialize();
      await tick();

      let key = "key";
      router.fetch(key, "root", "/fetch");
      await tick();
      expect(router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH 1",
      });
      expect(shouldRevalidate.mock.calls.length).toBe(0);

      // Normal navigations should trigger fetcher shouldRevalidate with
      // defaultShouldRevalidate=false
      router.navigate("/child");
      await tick();
      expect(shouldRevalidate.mock.calls.length).toBe(1);
      expect(shouldRevalidate.mock.calls[0][0]).toMatchObject({
        currentParams: {},
        currentUrl: expect.URL("http://localhost/"),
        nextParams: {},
        nextUrl: expect.URL("http://localhost/child"),
        defaultShouldRevalidate: false,
      });
      expect(router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH 1",
      });

      router.navigate("/");
      await tick();
      expect(shouldRevalidate.mock.calls.length).toBe(2);
      expect(shouldRevalidate.mock.calls[1][0]).toMatchObject({
        currentParams: {},
        currentUrl: expect.URL("http://localhost/child"),
        nextParams: {},
        nextUrl: expect.URL("http://localhost/"),
        defaultShouldRevalidate: false,
      });
      expect(router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH 1",
      });

      // Submission navigations should trigger fetcher shouldRevalidate with
      // defaultShouldRevalidate=true
      router.navigate("/child", {
        formMethod: "post",
        formData: createFormData({}),
      });
      await tick();
      expect(router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH 1",
      });
      expect(shouldRevalidate.mock.calls.length).toBe(3);
      expect(shouldRevalidate.mock.calls[2][0]).toMatchObject({
        currentParams: {},
        currentUrl: expect.URL("http://localhost/"),
        nextParams: {},
        nextUrl: expect.URL("http://localhost/child"),
        formAction: "/child",
        formData: createFormData({}),
        formEncType: "application/x-www-form-urlencoded",
        formMethod: "post",
        defaultShouldRevalidate: true,
      });

      router.dispose();
    });

    it("applies to fetcher submissions and sends fetcher actionResult through", async () => {
      let shouldRevalidate = jest.fn((args) => true);

      let history = createMemoryHistory();
      let router = createRouter({
        history,
        routes: [
          {
            path: "",
            id: "root",

            children: [
              {
                path: "/",
                id: "index",
                loader: () => "INDEX",
                shouldRevalidate,
              },
              {
                path: "/fetch",
                id: "fetch",
                action: () => "FETCH",
              },
            ],
          },
        ],
      });
      router.initialize();
      await tick();

      let key = "key";
      router.fetch(key, "root", "/fetch", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await tick();
      expect(router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH",
      });

      let arg = shouldRevalidate.mock.calls[0][0];
      expect(arg).toMatchInlineSnapshot(`
        {
          "actionResult": "FETCH",
          "currentParams": {},
          "currentUrl": "http://localhost/",
          "defaultShouldRevalidate": true,
          "formAction": "/fetch",
          "formData": FormData {},
          "formEncType": "application/x-www-form-urlencoded",
          "formMethod": "post",
          "nextParams": {},
          "nextUrl": "http://localhost/",
        }
      `);
      expect(Object.fromEntries(arg.formData)).toEqual({ key: "value" });

      router.dispose();
    });

    it("applies to fetcher submissions when action redirects", async () => {
      let shouldRevalidate = jest.fn((args) => true);

      let history = createMemoryHistory();
      let router = createRouter({
        history,
        routes: [
          {
            path: "",
            id: "root",

            children: [
              {
                path: "/",
                id: "index",
                loader: () => "INDEX",
                shouldRevalidate,
              },
              {
                path: "/fetch",
                id: "fetch",
                action: () => redirect("/"),
              },
            ],
          },
        ],
      });
      router.initialize();
      await tick();

      let key = "key";
      router.fetch(key, "root", "/fetch", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await tick();
      expect(router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: undefined,
      });

      let arg = shouldRevalidate.mock.calls[0][0];
      expect(arg).toMatchInlineSnapshot(`
        {
          "actionResult": undefined,
          "currentParams": {},
          "currentUrl": "http://localhost/",
          "defaultShouldRevalidate": true,
          "formAction": "/fetch",
          "formData": FormData {},
          "formEncType": "application/x-www-form-urlencoded",
          "formMethod": "post",
          "nextParams": {},
          "nextUrl": "http://localhost/",
        }
      `);

      router.dispose();
    });

    it("preserves non-revalidated loaderData on navigations", async () => {
      let count = 0;
      let history = createMemoryHistory();
      let router = createRouter({
        history,
        routes: [
          {
            path: "",
            id: "root",
            loader: () => `ROOT ${++count}`,

            children: [
              {
                path: "/",
                id: "index",
                loader: (args) => "SHOULD NOT GET CALLED",
                shouldRevalidate: () => false,
              },
            ],
          },
        ],
        hydrationData: {
          loaderData: {
            root: "ROOT 0",
            index: "INDEX",
          },
        },
      });
      router.initialize();
      await tick();

      // Navigating to the same link would normally cause all loaders to re-run
      router.navigate("/");
      await tick();
      expect(router.state.loaderData).toEqual({
        root: "ROOT 1",
        index: "INDEX",
      });

      router.navigate("/");
      await tick();
      expect(router.state.loaderData).toEqual({
        root: "ROOT 2",
        index: "INDEX",
      });

      router.dispose();
    });

    it("preserves non-revalidated loaderData on fetches", async () => {
      let count = 0;
      let history = createMemoryHistory();
      let router = createRouter({
        history,
        routes: [
          {
            path: "",
            id: "root",

            children: [
              {
                path: "/",
                id: "index",
                loader: () => "SHOULD NOT GET CALLED",
                shouldRevalidate: () => false,
              },
              {
                path: "/fetch",
                id: "fetch",
                action: () => `FETCH ${++count}`,
              },
            ],
          },
        ],
        hydrationData: {
          loaderData: {
            index: "INDEX",
          },
        },
      });
      router.initialize();
      await tick();

      let key = "key";

      router.fetch(key, "root", "/fetch", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await tick();
      expect(router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH 1",
      });
      expect(router.state.loaderData).toMatchObject({
        index: "INDEX",
      });

      router.fetch(key, "root", "/fetch", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await tick();
      expect(router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH 2",
      });
      expect(router.state.loaderData).toMatchObject({
        index: "INDEX",
      });

      router.dispose();
    });

    it("requires an explicit false return value to override default true behavior", async () => {
      let count = 0;
      let returnValue = true;
      let history = createMemoryHistory();
      let router = createRouter({
        history,
        routes: [
          {
            path: "",
            id: "root",
            loader: () => ++count,
            shouldRevalidate: () => returnValue,
          },
        ],
        hydrationData: {
          loaderData: {
            root: 0,
          },
        },
      });
      router.initialize();

      await tick();
      expect(router.state.loaderData).toEqual({
        root: 0,
      });

      router.revalidate();
      await tick();
      expect(router.state.loaderData).toEqual({
        root: 1,
      });

      // @ts-expect-error
      returnValue = undefined;
      router.revalidate();
      await tick();
      expect(router.state.loaderData).toEqual({
        root: 2,
      });

      // @ts-expect-error
      returnValue = null;
      router.revalidate();
      await tick();
      expect(router.state.loaderData).toEqual({
        root: 3,
      });

      // @ts-expect-error
      returnValue = "";
      router.revalidate();
      await tick();
      expect(router.state.loaderData).toEqual({
        root: 4,
      });

      returnValue = false;
      router.revalidate();
      await tick();
      expect(router.state.loaderData).toEqual({
        root: 4, // No revalidation
      });

      router.dispose();
    });

    it("requires an explicit true return value to override default false behavior", async () => {
      let count = 0;
      let returnValue = false;
      let history = createMemoryHistory({ initialEntries: ["/a"] });
      let router = createRouter({
        history,
        routes: [
          {
            path: "/",
            id: "root",
            loader: () => ++count,
            shouldRevalidate: () => returnValue,

            children: [
              {
                path: "a",
                id: "a",
              },
              {
                path: "b",
                id: "b",
              },
            ],
          },
        ],
        hydrationData: {
          loaderData: {
            root: 0,
          },
        },
      });
      router.initialize();

      await tick();
      expect(router.state.loaderData).toEqual({
        root: 0,
      });

      router.navigate("/b");
      await tick();
      expect(router.state.loaderData).toEqual({
        root: 0,
      });

      // @ts-expect-error
      returnValue = undefined;
      router.navigate("/a");
      await tick();
      expect(router.state.loaderData).toEqual({
        root: 0,
      });

      // @ts-expect-error
      returnValue = null;
      router.navigate("/b");
      await tick();
      expect(router.state.loaderData).toEqual({
        root: 0,
      });

      // @ts-expect-error
      returnValue = "truthy";
      router.navigate("/a");
      await tick();
      expect(router.state.loaderData).toEqual({
        root: 0,
      });

      returnValue = true;
      router.navigate("/b");
      await tick();
      expect(router.state.loaderData).toEqual({
        root: 1,
      });

      router.dispose();
    });
  });

  describe("no route match", () => {
    it("navigations to root catch", () => {
      let t = initializeTmTest();
      t.navigate("/not-found");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT",
      });
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponse(
          404,
          "Not Found",
          new Error('No route matches URL "/not-found"'),
          true
        ),
      });
      expect(t.router.state.matches).toMatchObject([
        {
          params: {},
          pathname: "",
          route: {
            hasErrorBoundary: true,
            children: expect.any(Array),
            id: "root",
            loader: expect.any(Function),
            path: "",
          },
        },
      ]);
    });

    it("matches root pathless route", () => {
      let t = setup({
        routes: [{ id: "root", children: [{ path: "foo" }] }],
      });

      t.navigate("/not-found");
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponse(
          404,
          "Not Found",
          new Error('No route matches URL "/not-found"'),
          true
        ),
      });
      expect(t.router.state.matches).toMatchObject([
        {
          params: {},
          pathname: "",
          route: {
            id: "root",
            children: expect.any(Array),
          },
        },
      ]);
    });

    it("clears prior loader/action data", async () => {
      let t = initializeTmTest();
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT",
        index: "INDEX",
      });

      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await A.actions.foo.resolve("ACTION");
      await A.loaders.root.resolve("ROOT*");
      await A.loaders.foo.resolve("LOADER");
      expect(t.router.state.actionData).toEqual({
        foo: "ACTION",
      });
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
        foo: "LOADER",
      });

      t.navigate("/not-found");
      expect(t.router.state.actionData).toBe(null);
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
      });
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponse(
          404,
          "Not Found",
          new Error('No route matches URL "/not-found"'),
          true
        ),
      });
      expect(t.router.state.matches).toMatchObject([
        {
          params: {},
          pathname: "",
          route: {
            hasErrorBoundary: true,
            children: expect.any(Array),
            id: "root",
            loader: expect.any(Function),
            path: "",
          },
        },
      ]);
    });
  });

  describe("errors on navigation", () => {
    describe("with an error boundary in the throwing route", () => {
      it("uses the throwing route's error boundary", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              children: [
                {
                  path: "/child",
                  id: "child",
                  hasErrorBoundary: true,
                  loader: true,
                },
              ],
            },
          ],
        });
        let nav = await t.navigate("/child");
        await nav.loaders.child.reject(new Error("Kaboom!"));
        expect(t.router.state.errors).toEqual({
          child: new Error("Kaboom!"),
        });
      });

      it("clears previous loaderData at that route", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              loader: true,
              children: [
                {
                  path: "/child",
                  id: "child",
                  hasErrorBoundary: true,
                  loader: true,
                },
              ],
            },
          ],
        });
        let nav = await t.navigate("/child");
        await nav.loaders.parent.resolve("PARENT");
        await nav.loaders.child.resolve("CHILD");
        expect(t.router.state.loaderData).toEqual({
          parent: "PARENT",
          child: "CHILD",
        });
        expect(t.router.state.errors).toEqual(null);

        let nav2 = await t.navigate("/child");
        await nav2.loaders.parent.resolve("PARENT2");
        await nav2.loaders.child.reject(new Error("Kaboom!"));
        expect(t.router.state.loaderData).toEqual({
          parent: "PARENT2",
        });
        expect(t.router.state.errors).toEqual({
          child: new Error("Kaboom!"),
        });
      });
    });

    describe("with an error boundary above the throwing route", () => {
      it("uses the nearest error boundary", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              hasErrorBoundary: true,
              children: [
                {
                  path: "/child",
                  id: "child",
                  loader: true,
                },
              ],
            },
          ],
          hydrationData: { loaderData: { parent: "stuff" } },
        });
        let nav = await t.navigate("/child");
        await nav.loaders.child.reject(new Error("Kaboom!"));
        expect(t.router.state.errors).toEqual({
          parent: new Error("Kaboom!"),
        });
      });

      it("clears out the error on new locations", async () => {
        let t = setup({
          routes: [
            {
              path: "",
              id: "root",
              loader: true,
              children: [
                {
                  path: "/",
                  id: "parent",
                  children: [
                    {
                      path: "/child",
                      id: "child",
                      hasErrorBoundary: true,
                      loader: true,
                    },
                  ],
                },
              ],
            },
          ],
          hydrationData: { loaderData: { root: "ROOT" } },
        });

        let nav = await t.navigate("/child");
        await nav.loaders.child.reject("Kaboom!");
        expect(t.router.state.loaderData).toEqual({ root: "ROOT" });
        expect(t.router.state.errors).toEqual({ child: "Kaboom!" });

        await t.navigate("/");
        expect(t.router.state.loaderData).toEqual({ root: "ROOT" });
        expect(t.router.state.errors).toBe(null);
      });
    });

    it("loads data above error boundary route", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            id: "a",
            loader: true,
            children: [
              {
                path: "/b",
                id: "b",
                loader: true,
                hasErrorBoundary: true,
                children: [
                  {
                    path: "/b/c",
                    id: "c",
                    loader: true,
                  },
                ],
              },
            ],
          },
        ],
        hydrationData: { loaderData: { a: "LOADER A" } },
      });
      let nav = await t.navigate("/b/c");
      await nav.loaders.b.resolve("LOADER B");
      await nav.loaders.c.reject("Kaboom!");
      expect(t.router.state.loaderData).toEqual({
        a: "LOADER A",
        b: "LOADER B",
      });
      expect(t.router.state.errors).toEqual({
        b: "Kaboom!",
      });
    });
  });

  describe("POP navigations", () => {
    it("does a normal load when backing into an action redirect", async () => {
      // start at / (history stack: [/])
      let t = initializeTmTest();

      // POST /foo, redirect /bar (history stack: [/, /bar])
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      let B = await A.actions.foo.redirect("/bar");
      await B.loaders.root.resolve("ROOT DATA");
      await B.loaders.bar.resolve("B LOADER");
      expect(t.router.state.historyAction).toEqual("PUSH");
      expect(t.router.state.location.pathname).toEqual("/bar");
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT DATA",
        bar: "B LOADER",
      });

      // Link to /baz (history stack: [/, /bar, /baz])
      let C = await t.navigate("/baz");
      await C.loaders.baz.resolve("C LOADER");
      expect(t.router.state.historyAction).toEqual("PUSH");
      expect(t.router.state.location.pathname).toEqual("/baz");
      expect(C.loaders.root.stub.mock.calls.length).toBe(0);
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT DATA",
        baz: "C LOADER",
      });

      // POP /bar (history stack: [/, /bar])
      let D = await t.navigate(-1);
      await D.loaders.bar.resolve("D LOADER");
      expect(t.router.state.historyAction).toEqual("POP");
      expect(t.router.state.location.pathname).toEqual("/bar");
      expect(D.loaders.root.stub.mock.calls.length).toBe(0);
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT DATA",
        bar: "D LOADER",
      });

      // POP / (history stack: [/])
      let E = await t.navigate(-1);
      await E.loaders.index.resolve("E LOADER");
      expect(t.router.state.historyAction).toEqual("POP");
      expect(t.router.state.location.pathname).toEqual("/");
      expect(E.loaders.root.stub.mock.calls.length).toBe(0);
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT DATA",
        index: "E LOADER",
      });
    });

    it("navigates correctly using POP navigations", async () => {
      let t = initializeTmTest();

      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.location.pathname).toEqual("/foo");

      let B = await t.navigate("/bar");
      await B.loaders.bar.resolve("BAR");
      expect(t.router.state.location.pathname).toEqual("/bar");

      let C = await t.navigate(-1);
      await C.loaders.foo.resolve("FOO*");
      expect(t.router.state.location.pathname).toEqual("/foo");

      let D = await t.navigate("/baz", { replace: true });
      await D.loaders.baz.resolve("BAZ");
      expect(t.router.state.location.pathname).toEqual("/baz");

      // POP to /
      let E = await t.navigate(-1);
      await E.loaders.index.resolve("INDEX*");
      expect(t.router.state.location.pathname).toEqual("/");
    });

    it("navigates correctly using POP navigations across actions", async () => {
      let t = initializeTmTest();

      // Navigate to /foo
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.location.pathname).toEqual("/foo");

      // Navigate to /bar
      let B = await t.navigate("/bar");
      await B.loaders.bar.resolve("BAR");
      expect(t.router.state.location.pathname).toEqual("/bar");

      // Post to /bar (should replace)
      let C = await t.navigate("/bar", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await C.actions.bar.resolve("BAR ACTION");
      await C.loaders.root.resolve("ROOT");
      await C.loaders.bar.resolve("BAR");
      expect(t.router.state.location.pathname).toEqual("/bar");

      // POP to /foo
      let D = await t.navigate(-1);
      await D.loaders.foo.resolve("FOO");
      expect(t.router.state.location.pathname).toEqual("/foo");
    });

    it("navigates correctly using POP navigations across actions to new locations", async () => {
      let t = initializeTmTest();

      // Navigate to /foo
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.location.pathname).toEqual("/foo");

      // Navigate to /bar
      let B = await t.navigate("/bar");
      await B.loaders.bar.resolve("BAR");
      expect(t.router.state.location.pathname).toEqual("/bar");

      // Post to /baz (should not replace)
      let C = await t.navigate("/baz", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await C.actions.baz.resolve("BAZ ACTION");
      await C.loaders.root.resolve("ROOT");
      await C.loaders.baz.resolve("BAZ");
      expect(t.router.state.location.pathname).toEqual("/baz");

      // POP to /bar
      let D = await t.navigate(-1);
      await D.loaders.bar.resolve("BAR");
      expect(t.router.state.location.pathname).toEqual("/bar");
    });

    it("navigates correctly using POP navigations across action errors", async () => {
      let t = initializeTmTest();

      // Navigate to /foo
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.location.pathname).toEqual("/foo");

      // Navigate to /bar
      let B = await t.navigate("/bar");
      await B.loaders.bar.resolve("BAR");
      expect(t.router.state.location.pathname).toEqual("/bar");

      // Post to /bar (should push due to our error)
      let C = await t.navigate("/bar", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await C.actions.bar.reject("BAR ERROR");
      await C.loaders.root.resolve("ROOT");
      await C.loaders.bar.resolve("BAR");
      expect(t.router.state.location.pathname).toEqual("/bar");

      // POP to /bar
      let D = await t.navigate(-1);
      await D.loaders.bar.resolve("BAR");
      expect(t.router.state.location.pathname).toEqual("/bar");
    });

    it("navigates correctly using POP navigations across loader redirects", async () => {
      // Start at / (history stack: [/])
      let t = initializeTmTest();

      // Navigate to /foo (history stack: [/, /foo])
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.location.pathname).toEqual("/foo");
      let fooKey = t.router.state.location?.key;

      // Navigate to /bar, redirect to /baz (history stack: [/, /foo, /baz])
      let B = await t.navigate("/bar");
      let C = await B.loaders.bar.redirect("/baz");
      await C.loaders.root.resolve("ROOT");
      await C.loaders.baz.resolve("BAZ");
      expect(t.router.state.location.pathname).toEqual("/baz");

      // POP to /foo (history stack: [/, /foo])
      let E = await t.navigate(-1);
      await E.loaders.foo.resolve("FOO");
      expect(t.router.state.location.pathname).toEqual("/foo");
      expect(t.router.state.location.key).toBe(fooKey);
    });

    it("navigates correctly using POP navigations across loader redirects with replace:true", async () => {
      // Start at / (history stack: [/])
      let t = initializeTmTest();
      let indexKey = t.router.state.location?.key;

      // Navigate to /foo (history stack: [/, /foo])
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.historyAction).toEqual("PUSH");
      expect(t.router.state.location.pathname).toEqual("/foo");

      // Navigate to /bar, redirect to /baz (history stack: [/, /baz])
      let B = await t.navigate("/bar", { replace: true });
      let C = await B.loaders.bar.redirect("/baz");
      await C.loaders.root.resolve("ROOT");
      await C.loaders.baz.resolve("BAZ");
      expect(t.router.state.historyAction).toEqual("REPLACE");
      expect(t.router.state.location.pathname).toEqual("/baz");

      // POP to / (history stack: [/])
      let E = await t.navigate(-1);
      await E.loaders.index.resolve("INDEX");
      expect(t.router.state.historyAction).toEqual("POP");
      expect(t.router.state.location.pathname).toEqual("/");
      expect(t.router.state.location.key).toBe(indexKey);
    });

    it("navigates correctly using POP navigations across action redirects", async () => {
      let t = initializeTmTest();

      // Navigate to /foo
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.location.pathname).toEqual("/foo");

      // Navigate to /bar
      let B = await t.navigate("/bar");
      let getBarKey = t.router.state.navigation.location?.key;
      await B.loaders.bar.resolve("BAR");
      expect(t.router.state.historyAction).toEqual("PUSH");
      expect(t.router.state.location.pathname).toEqual("/bar");

      // Post to /bar, redirect to /baz
      let C = await t.navigate("/bar", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      let postBarKey = t.router.state.navigation.location?.key;
      let D = await C.actions.bar.redirect("/baz");
      await D.loaders.root.resolve("ROOT");
      await D.loaders.baz.resolve("BAZ");
      expect(t.router.state.historyAction).toEqual("PUSH");
      expect(t.router.state.location.pathname).toEqual("/baz");

      // POP to /bar
      let E = await t.navigate(-1);
      await E.loaders.bar.resolve("BAR");
      expect(t.router.state.historyAction).toEqual("POP");
      expect(t.router.state.location.pathname).toEqual("/bar");
      expect(t.router.state.location.key).toBe(getBarKey);
      expect(t.router.state.location.key).not.toBe(postBarKey);
    });

    it("navigates correctly using POP navigations across action redirects to the same location", async () => {
      let t = initializeTmTest();

      // Navigate to /foo
      let A = await t.navigate("/foo");
      let fooKey = t.router.state.navigation.location?.key;
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.location.pathname).toEqual("/foo");

      // Navigate to /bar
      let B = await t.navigate("/bar");
      await B.loaders.bar.resolve("BAR");
      expect(t.router.state.historyAction).toEqual("PUSH");
      expect(t.router.state.location.pathname).toEqual("/bar");

      // Post to /bar, redirect to /bar
      let C = await t.navigate("/bar", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      let postBarKey = t.router.state.navigation.location?.key;
      let D = await C.actions.bar.redirect("/bar");
      await D.loaders.root.resolve("ROOT");
      await D.loaders.bar.resolve("BAR");
      expect(t.router.state.historyAction).toEqual("REPLACE");
      expect(t.router.state.location.pathname).toEqual("/bar");

      // POP to /foo
      let E = await t.navigate(-1);
      await E.loaders.foo.resolve("FOO");
      expect(t.router.state.historyAction).toEqual("POP");
      expect(t.router.state.location.pathname).toEqual("/foo");
      expect(t.router.state.location.key).toBe(fooKey);
      expect(t.router.state.location.key).not.toBe(postBarKey);
    });

    it("navigates correctly using POP navigations across <Form replace> redirects", async () => {
      let t = initializeTmTest();

      // Navigate to /foo
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.location.pathname).toEqual("/foo");

      // Navigate to /bar
      let B = await t.navigate("/bar");
      await B.loaders.bar.resolve("BAR");
      expect(t.router.state.historyAction).toEqual("PUSH");
      expect(t.router.state.location.pathname).toEqual("/bar");

      // Post to /bar, redirect to /baz
      let C = await t.navigate("/bar", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
        replace: true,
      });
      let D = await C.actions.bar.redirect("/baz");
      await D.loaders.root.resolve("ROOT");
      await D.loaders.baz.resolve("BAZ");
      expect(t.router.state.historyAction).toEqual("REPLACE");
      expect(t.router.state.location.pathname).toEqual("/baz");

      // POP to /foo
      let E = await t.navigate(-1);
      await E.loaders.foo.resolve("FOO");
      expect(t.router.state.historyAction).toEqual("POP");
      expect(t.router.state.location.pathname).toEqual("/foo");
    });

    it("should respect explicit replace:false on non-redirected actions to new locations", async () => {
      // start at / (history stack: [/])
      let t = initializeTmTest();

      // Link to /foo (history stack: [/, /foo])
      let A = await t.navigate("/foo");
      await A.loaders.root.resolve("ROOT");
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.historyAction).toEqual("PUSH");
      expect(t.router.state.location.pathname).toEqual("/foo");

      // POST /bar (history stack: [/, /foo, /bar])
      let B = await t.navigate("/bar", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
        replace: false,
      });
      await B.actions.bar.resolve("BAR");
      await B.loaders.root.resolve("ROOT");
      await B.loaders.bar.resolve("BAR");
      expect(t.router.state.historyAction).toEqual("PUSH");
      expect(t.router.state.location.pathname).toEqual("/bar");

      // POP /foo (history stack: [GET /, GET /foo])
      let C = await t.navigate(-1);
      await C.loaders.foo.resolve("FOO");
      expect(t.router.state.historyAction).toEqual("POP");
      expect(t.router.state.location.pathname).toEqual("/foo");
    });

    it("should respect explicit replace:false on non-redirected actions to the same location", async () => {
      // start at / (history stack: [/])
      let t = initializeTmTest();

      // Link to /foo (history stack: [/, /foo])
      let A = await t.navigate("/foo");
      await A.loaders.root.resolve("ROOT");
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.historyAction).toEqual("PUSH");
      expect(t.router.state.location.pathname).toEqual("/foo");

      // POST /foo (history stack: [/, /foo, /foo])
      let B = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
        replace: false,
      });
      await B.actions.foo.resolve("FOO2 ACTION");
      await B.loaders.root.resolve("ROOT2");
      await B.loaders.foo.resolve("FOO2");
      expect(t.router.state.historyAction).toEqual("PUSH");
      expect(t.router.state.location.pathname).toEqual("/foo");

      // POP /foo (history stack: [/, /foo])
      let C = await t.navigate(-1);
      await C.loaders.root.resolve("ROOT3");
      await C.loaders.foo.resolve("FOO3");
      expect(t.router.state.historyAction).toEqual("POP");
      expect(t.router.state.location.pathname).toEqual("/foo");
    });
  });

  describe("submission navigations", () => {
    it("reloads all routes when a loader during an actionReload redirects", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);

      await A.actions.foo.resolve("FOO ACTION");
      expect(A.loaders.root.stub.mock.calls.length).toBe(1);
      expect(t.router.state.actionData).toEqual({
        foo: "FOO ACTION",
      });

      let B = await A.loaders.foo.redirect("/bar");
      await A.loaders.root.reject("ROOT ERROR");
      await B.loaders.root.resolve("ROOT LOADER 2");
      await B.loaders.bar.resolve("BAR LOADER");
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);
      expect(t.router.state).toMatchObject({
        actionData: null,
        loaderData: {
          root: "ROOT LOADER 2",
          bar: "BAR LOADER",
        },
        errors: {},
      });
    });

    it("commits action data as soon as it lands", async () => {
      let t = initializeTmTest();

      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(t.router.state.actionData).toBeNull();

      await A.actions.foo.resolve("A");
      expect(t.router.state.actionData).toEqual({
        foo: "A",
      });
    });

    it("reloads all routes after the action", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);

      await A.actions.foo.resolve("FOO ACTION");
      expect(A.loaders.root.stub.mock.calls.length).toBe(1);
      expect(t.router.state.actionData).toEqual({
        foo: "FOO ACTION",
      });

      await A.loaders.foo.resolve("A LOADER");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT", // old data
        index: "INDEX", // old data
      });

      await A.loaders.root.resolve("ROOT LOADER");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.actionData).toEqual({
        foo: "FOO ACTION", // kept around on action reload
      });
      expect(t.router.state.loaderData).toEqual({
        foo: "A LOADER",
        root: "ROOT LOADER",
      });
    });

    it("reloads all routes after action redirect (throw)", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);

      let B = await A.actions.foo.redirect("/bar");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);

      await B.loaders.root.resolve("ROOT LOADER");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT", // old data
        index: "INDEX", // old data
      });

      await B.loaders.bar.resolve("B LOADER");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.loaderData).toEqual({
        bar: "B LOADER",
        root: "ROOT LOADER",
      });
    });

    it("reloads all routes after action redirect (return)", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);

      let B = await A.actions.foo.redirectReturn("/bar");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);

      await B.loaders.root.resolve("ROOT LOADER");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT", // old data
        index: "INDEX", // old data
      });

      await B.loaders.bar.resolve("B LOADER");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.loaderData).toEqual({
        bar: "B LOADER",
        root: "ROOT LOADER",
      });
    });

    it("reloads all routes after action redirect (chained redirects)", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);

      let B = await A.actions.foo.redirectReturn("/bar");
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);

      await B.loaders.root.resolve("ROOT*");
      let C = await B.loaders.bar.redirectReturn("/baz");
      expect(C.loaders.root.stub.mock.calls.length).toBe(1);

      await C.loaders.root.resolve("ROOT**");
      await C.loaders.baz.resolve("BAZ");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.loaderData).toEqual({
        baz: "BAZ",
        root: "ROOT**",
      });
    });

    it("removes action data at new locations", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await A.actions.foo.resolve("A ACTION");
      await A.loaders.root.resolve("A ROOT");
      await A.loaders.foo.resolve("A LOADER");
      expect(t.router.state.actionData).toEqual({ foo: "A ACTION" });

      let B = await t.navigate("/bar");
      await B.loaders.bar.resolve("B LOADER");
      expect(t.router.state.actionData).toBeNull();
    });

    it("removes action data after action redirect (w/o loaders to run)", async () => {
      let t = setup({
        routes: [
          {
            index: true,
            id: "index",
            action: true,
          },
          {
            path: "/other",
            id: "other",
          },
        ],
      });
      let A = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "" }),
      });
      await A.actions.index.resolve({ error: "invalid" });
      expect(t.router.state.actionData).toEqual({
        index: { error: "invalid" },
      });

      let B = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await B.actions.index.redirectReturn("/other");

      expect(t.router.state.actionData).toBeNull();
    });

    it("removes action data after action redirect (w/ loaders to run)", async () => {
      let t = setup({
        routes: [
          {
            index: true,
            id: "index",
            action: true,
          },
          {
            path: "/other",
            id: "other",
            loader: true,
          },
        ],
      });
      let A = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "" }),
      });
      await A.actions.index.resolve({ error: "invalid" });
      expect(t.router.state.actionData).toEqual({
        index: { error: "invalid" },
      });

      let B = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });

      let C = await B.actions.index.redirectReturn("/other");
      expect(t.router.state.actionData).toEqual({
        index: { error: "invalid" },
      });
      expect(t.router.state.loaderData).toEqual({});

      await C.loaders.other.resolve("OTHER");

      expect(t.router.state.actionData).toBeNull();
      expect(t.router.state.loaderData).toEqual({
        other: "OTHER",
      });
    });

    it("removes action data after action redirect to current location", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            id: "index",
            action: true,
            loader: true,
          },
        ],
      });
      let A = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "" }),
      });
      await A.actions.index.resolve({ error: "invalid" });
      expect(t.router.state.actionData).toEqual({
        index: { error: "invalid" },
      });

      let B = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });

      let C = await B.actions.index.redirectReturn("/");
      expect(t.router.state.actionData).toEqual({
        index: { error: "invalid" },
      });
      expect(t.router.state.loaderData).toEqual({});

      await C.loaders.index.resolve("NEW");

      expect(t.router.state.actionData).toBeNull();
      expect(t.router.state.loaderData).toEqual({
        index: "NEW",
      });
    });

    it("uses the proper action for index routes", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            id: "parent",
            children: [
              {
                path: "/child",
                id: "child",
                hasErrorBoundary: true,
                action: true,
                children: [
                  {
                    index: true,
                    id: "childIndex",
                    hasErrorBoundary: true,
                    action: true,
                  },
                ],
              },
            ],
          },
        ],
      });
      let A = await t.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await A.actions.child.resolve("CHILD");
      expect(t.router.state.actionData).toEqual({
        child: "CHILD",
      });

      let B = await t.navigate("/child?index", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await B.actions.childIndex.resolve("CHILD INDEX");
      expect(t.router.state.actionData).toEqual({
        childIndex: "CHILD INDEX",
      });
    });

    it("uses the proper action for pathless layout routes", async () => {
      let t = setup({
        routes: [
          {
            id: "parent",
            path: "/parent",
            action: true,
            children: [
              {
                hasErrorBoundary: true,
                children: [
                  {
                    id: "index",
                    index: true,
                    action: true,
                  },
                ],
              },
            ],
          },
        ],
      });
      let A = await t.navigate("/parent", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await A.actions.parent.resolve("PARENT");
      expect(t.router.state).toMatchObject({
        location: { pathname: "/parent" },
        actionData: {
          parent: "PARENT",
        },
        errors: null,
      });

      let B = await t.navigate("/parent?index", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await B.actions.index.resolve("INDEX");
      expect(t.router.state).toMatchObject({
        location: { pathname: "/parent", search: "?index" },
        actionData: {
          index: "INDEX",
        },
        errors: null,
      });
    });

    it("retains the index match when submitting to a layout route", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            id: "parent",
            loader: true,
            action: true,
            children: [
              {
                path: "/child",
                id: "child",
                loader: true,
                action: true,
                children: [
                  {
                    index: true,
                    id: "childIndex",
                    loader: true,
                    action: true,
                  },
                ],
              },
            ],
          },
        ],
      });
      let A = await t.navigate("/child", {
        formMethod: "post",
        formData: new FormData(),
      });
      await A.actions.child.resolve("CHILD ACTION");
      await A.loaders.parent.resolve("PARENT LOADER");
      await A.loaders.child.resolve("CHILD LOADER");
      await A.loaders.childIndex.resolve("CHILD INDEX LOADER");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT LOADER",
        child: "CHILD LOADER",
        childIndex: "CHILD INDEX LOADER",
      });
      expect(t.router.state.actionData).toEqual({
        child: "CHILD ACTION",
      });
      expect(t.router.state.matches.map((m) => m.route.id)).toEqual([
        "parent",
        "child",
        "childIndex",
      ]);
    });

    describe("formMethod casing", () => {
      it("normalizes to lowercase in v6", async () => {
        let t = setup({
          routes: [
            {
              id: "root",
              path: "/",
              children: [
                {
                  id: "child",
                  path: "child",
                  loader: true,
                  action: true,
                },
              ],
            },
          ],
        });
        let A = await t.navigate("/child", {
          formMethod: "get",
          formData: createFormData({}),
        });
        expect(t.router.state.navigation.formMethod).toBe("get");
        await A.loaders.child.resolve("LOADER");
        expect(t.router.state.navigation.formMethod).toBeUndefined();
        await t.router.navigate("/");

        let B = await t.navigate("/child", {
          formMethod: "POST",
          formData: createFormData({}),
        });
        expect(t.router.state.navigation.formMethod).toBe("post");
        await B.actions.child.resolve("ACTION");
        await B.loaders.child.resolve("LOADER");
        expect(t.router.state.navigation.formMethod).toBeUndefined();
        await t.router.navigate("/");

        let C = await t.fetch("/child", "key", {
          formMethod: "GET",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get("key")?.formMethod).toBe("get");
        await C.loaders.child.resolve("LOADER FETCH");
        expect(t.router.state.fetchers.get("key")?.formMethod).toBeUndefined();

        let D = await t.fetch("/child", "key", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get("key")?.formMethod).toBe("post");
        await D.actions.child.resolve("ACTION FETCH");
        expect(t.router.state.fetchers.get("key")?.formMethod).toBeUndefined();
      });

      it("normalizes to uppercase in v7 via v7_normalizeFormMethod", async () => {
        let t = setup({
          routes: [
            {
              id: "root",
              path: "/",
              children: [
                {
                  id: "child",
                  path: "child",
                  loader: true,
                  action: true,
                },
              ],
            },
          ],
          future: {
            v7_normalizeFormMethod: true,
            v7_prependBasename: false,
          },
        });
        let A = await t.navigate("/child", {
          formMethod: "get",
          formData: createFormData({}),
        });
        expect(t.router.state.navigation.formMethod).toBe("GET");
        await A.loaders.child.resolve("LOADER");
        expect(t.router.state.navigation.formMethod).toBeUndefined();
        await t.router.navigate("/");

        let B = await t.navigate("/child", {
          formMethod: "POST",
          formData: createFormData({}),
        });
        expect(t.router.state.navigation.formMethod).toBe("POST");
        await B.actions.child.resolve("ACTION");
        await B.loaders.child.resolve("LOADER");
        expect(t.router.state.navigation.formMethod).toBeUndefined();
        await t.router.navigate("/");

        let C = await t.fetch("/child", "key", {
          formMethod: "GET",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get("key")?.formMethod).toBe("GET");
        await C.loaders.child.resolve("LOADER FETCH");
        expect(t.router.state.fetchers.get("key")?.formMethod).toBeUndefined();

        let D = await t.fetch("/child", "key", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get("key")?.formMethod).toBe("POST");
        await D.actions.child.resolve("ACTION FETCH");
        expect(t.router.state.fetchers.get("key")?.formMethod).toBeUndefined();
      });
    });
  });

  describe("action errors", () => {
    describe("with an error boundary in the action route", () => {
      it("uses the action route's error boundary", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              children: [
                {
                  path: "/child",
                  id: "child",
                  hasErrorBoundary: true,
                  action: true,
                },
              ],
            },
          ],
        });
        let A = await t.navigate("/child", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        await A.actions.child.reject(new Error("Kaboom!"));
        expect(t.router.state.errors).toEqual({
          child: new Error("Kaboom!"),
        });
      });

      it("loads parent data, but not action data", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              loader: true,
              children: [
                {
                  path: "/child",
                  id: "child",
                  hasErrorBoundary: true,
                  loader: true,
                  action: true,
                },
              ],
            },
          ],
        });
        let A = await t.navigate("/child", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        await A.actions.child.reject(new Error("Kaboom!"));
        expect(A.loaders.parent.stub.mock.calls.length).toBe(1);
        expect(A.loaders.child.stub.mock.calls.length).toBe(0);
        await A.loaders.parent.resolve("PARENT LOADER");
        expect(t.router.state).toMatchObject({
          loaderData: {
            parent: "PARENT LOADER",
          },
          actionData: null,
          errors: {
            child: new Error("Kaboom!"),
          },
        });
      });
    });

    describe("with an error boundary above the action route", () => {
      it("uses the nearest error boundary", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              hasErrorBoundary: true,
              children: [
                {
                  path: "/child",
                  id: "child",
                  action: true,
                },
              ],
            },
          ],
        });
        let A = await t.navigate("/child", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        await A.actions.child.reject(new Error("Kaboom!"));
        expect(t.router.state.errors).toEqual({
          parent: new Error("Kaboom!"),
        });
      });
    });

    describe("with a parent loader that throws also, good grief!", () => {
      it("uses action error but nearest errorBoundary to parent", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "root",
              hasErrorBoundary: true,
              children: [
                {
                  path: "/parent",
                  id: "parent",
                  loader: true,
                  children: [
                    {
                      path: "/parent/child",
                      id: "child",
                      action: true,
                      hasErrorBoundary: true,
                    },
                  ],
                },
              ],
            },
          ],
        });

        let A = await t.navigate("/parent/child", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        await A.actions.child.reject(new Error("Kaboom!"));
        await A.loaders.parent.reject(new Error("Should not see this!"));
        expect(t.router.state).toMatchObject({
          loaderData: {},
          actionData: {},
          errors: {
            root: new Error("Kaboom!"),
          },
        });
      });
    });

    describe("with no corresponding action", () => {
      it("throws a 405 ErrorResponse", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              children: [
                {
                  path: "/child",
                  id: "child",
                  hasErrorBoundary: true,
                },
              ],
            },
          ],
        });
        let spy = jest.spyOn(console, "warn").mockImplementation(() => {});
        await t.navigate("/child", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        expect(t.router.state.errors).toEqual({
          child: new ErrorResponse(
            405,
            "Method Not Allowed",
            new Error(
              'You made a POST request to "/child" but did not provide an ' +
                '`action` for route "child", so there is no way to handle the request.'
            ),
            true
          ),
        });
        spy.mockReset();
      });

      it("still calls appropriate loaders after 405 ErrorResponse", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              loader: true,
              children: [
                {
                  path: "child",
                  id: "child",
                  loader: true,
                  children: [
                    {
                      path: "grandchild",
                      id: "grandchild",
                      loader: true,
                      // no action to post to
                      hasErrorBoundary: true,
                    },
                  ],
                },
              ],
            },
          ],
          hydrationData: {
            loaderData: {
              parent: "PARENT DATA",
            },
          },
        });
        let A = await t.navigate("/child/grandchild", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        expect(t.router.state.errors).toBe(null);
        expect(A.loaders.parent.stub.mock.calls.length).toBe(1); // called again for revalidation
        expect(A.loaders.child.stub.mock.calls.length).toBe(1); // called because it's above error
        expect(A.loaders.grandchild.stub.mock.calls.length).toBe(0); // don't call due to error
        await A.loaders.parent.resolve("PARENT DATA*");
        await A.loaders.child.resolve("CHILD DATA");
        expect(t.router.state.loaderData).toEqual({
          parent: "PARENT DATA*",
          child: "CHILD DATA",
        });
        expect(t.router.state.actionData).toBe(null);
        expect(t.router.state.errors).toEqual({
          grandchild: new ErrorResponse(
            405,
            "Method Not Allowed",
            new Error(
              'You made a POST request to "/child/grandchild" but did not ' +
                'provide an `action` for route "grandchild", so there is no way ' +
                "to handle the request."
            ),
            true
          ),
        });
      });
    });

    it("clears previous actionData at the throwing route", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            id: "parent",
            loader: true,
            children: [
              {
                path: "/child",
                id: "child",
                hasErrorBoundary: true,
                action: true,
                loader: true,
              },
            ],
          },
        ],
      });
      let nav = await t.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await nav.actions.child.resolve("ACTION");
      await nav.loaders.parent.resolve("PARENT");
      await nav.loaders.child.resolve("CHILD");
      expect(t.router.state.actionData).toEqual({
        child: "ACTION",
      });
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT",
        child: "CHILD",
      });
      expect(t.router.state.errors).toEqual(null);

      let nav2 = await t.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ key2: "value2" }),
      });
      await nav2.actions.child.reject(new Error("Kaboom!"));
      await nav2.loaders.parent.resolve("PARENT2");
      expect(t.router.state.actionData).toEqual(null);
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT2",
      });
      expect(t.router.state.errors).toEqual({
        child: new Error("Kaboom!"),
      });
    });

    it("does not clear previous loaderData at the handling route", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            id: "parent",
            loader: true,
            hasErrorBoundary: true,
            children: [
              {
                path: "/child",
                id: "child",
                action: true,
                loader: true,
              },
            ],
          },
        ],
      });
      let nav = await t.navigate("/child");
      await nav.loaders.parent.resolve("PARENT");
      await nav.loaders.child.resolve("CHILD");
      expect(t.router.state.actionData).toEqual(null);
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT",
        child: "CHILD",
      });
      expect(t.router.state.errors).toEqual(null);

      let nav2 = await t.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ key2: "value2" }),
      });
      await nav2.actions.child.reject(new Error("Kaboom!"));
      expect(t.router.state.actionData).toEqual(null);
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT",
      });
      expect(t.router.state.errors).toEqual({
        parent: new Error("Kaboom!"),
      });
    });
  });

  describe("navigation states", () => {
    it("initialization", async () => {
      let t = initializeTmTest();
      let navigation = t.router.state.navigation;
      expect(navigation.state).toBe("idle");
      expect(navigation.formData).toBeUndefined();
      expect(navigation.location).toBeUndefined();
    });

    it("get", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo");
      let navigation = t.router.state.navigation;
      expect(navigation.state).toBe("loading");
      expect(navigation.formData).toBeUndefined();
      expect(navigation.location).toMatchObject({
        pathname: "/foo",
        search: "",
        hash: "",
      });

      await A.loaders.foo.resolve("A");
      navigation = t.router.state.navigation;
      expect(navigation.state).toBe("idle");
      expect(navigation.formData).toBeUndefined();
      expect(navigation.location).toBeUndefined();
    });

    it("get + redirect", async () => {
      let t = initializeTmTest();

      let A = await t.navigate("/foo");
      let B = await A.loaders.foo.redirect("/bar");

      let navigation = t.router.state.navigation;
      expect(navigation.state).toBe("loading");
      expect(navigation.formData).toBeUndefined();
      expect(navigation.location?.pathname).toBe("/bar");

      await B.loaders.bar.resolve("B");
      navigation = t.router.state.navigation;
      expect(navigation.state).toBe("idle");
      expect(navigation.formData).toBeUndefined();
      expect(navigation.location).toBeUndefined();
    });

    it("action submission", async () => {
      let t = initializeTmTest();

      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      let navigation = t.router.state.navigation;
      expect(navigation.state).toBe("submitting");

      expect(
        // @ts-expect-error
        new URLSearchParams(navigation.formData).toString()
      ).toBe("gosh=dang");
      expect(navigation.formMethod).toBe("post");
      expect(navigation.formEncType).toBe("application/x-www-form-urlencoded");
      expect(navigation.location).toMatchObject({
        pathname: "/foo",
        search: "",
        hash: "",
      });

      await A.actions.foo.resolve("A");
      navigation = t.router.state.navigation;
      expect(navigation.state).toBe("loading");
      expect(
        // @ts-expect-error
        new URLSearchParams(navigation.formData).toString()
      ).toBe("gosh=dang");
      expect(navigation.formMethod).toBe("post");
      expect(navigation.formEncType).toBe("application/x-www-form-urlencoded");
      expect(navigation.location).toMatchObject({
        pathname: "/foo",
        search: "",
        hash: "",
      });

      await A.loaders.foo.resolve("A");
      navigation = t.router.state.navigation;
      expect(navigation.state).toBe("loading");

      await A.loaders.root.resolve("B");
      navigation = t.router.state.navigation;
      expect(navigation.state).toBe("idle");
      expect(navigation.formData).toBeUndefined();
      expect(navigation.location).toBeUndefined();
    });

    it("action submission + redirect", async () => {
      let t = initializeTmTest();

      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      let B = await A.actions.foo.redirect("/bar");

      let navigation = t.router.state.navigation;
      expect(navigation.state).toBe("loading");
      expect(
        // @ts-expect-error
        new URLSearchParams(navigation.formData).toString()
      ).toBe("gosh=dang");
      expect(navigation.formMethod).toBe("post");
      expect(navigation.location).toMatchObject({
        pathname: "/bar",
        search: "",
        hash: "",
      });

      await B.loaders.bar.resolve("B");
      navigation = t.router.state.navigation;
      expect(navigation.state).toBe("loading");

      await B.loaders.root.resolve("C");
      navigation = t.router.state.navigation;
      expect(navigation.state).toBe("idle");
      expect(navigation.formData).toBeUndefined();
      expect(navigation.location).toBeUndefined();
    });

    it("loader submission", async () => {
      let t = initializeTmTest();
      let A = await t.navigate("/foo", {
        formData: createFormData({ gosh: "dang" }),
      });
      let navigation = t.router.state.navigation;
      expect(navigation.state).toBe("loading");
      expect(navigation.formData).toEqual(createFormData({ gosh: "dang" }));
      expect(navigation.formMethod).toBe("get");
      expect(navigation.formEncType).toBe("application/x-www-form-urlencoded");
      expect(navigation.location).toMatchObject({
        pathname: "/foo",
        search: "?gosh=dang",
        hash: "",
      });

      await A.loaders.root.resolve("ROOT");
      await A.loaders.foo.resolve("A");
      navigation = t.router.state.navigation;
      expect(navigation.state).toBe("idle");
      expect(navigation.formData).toBeUndefined();
      expect(navigation.location).toBeUndefined();
    });

    it("loader submission + redirect", async () => {
      let t = initializeTmTest();

      let A = await t.navigate("/foo", {
        formData: createFormData({ gosh: "dang" }),
      });
      await A.loaders.root.resolve("ROOT");
      let B = await A.loaders.foo.redirect("/bar");

      let navigation = t.router.state.navigation;
      expect(navigation.state).toBe("loading");
      expect(navigation.formData).toEqual(createFormData({ gosh: "dang" }));
      expect(navigation.formMethod).toBe("get");
      expect(navigation.formEncType).toBe("application/x-www-form-urlencoded");
      expect(navigation.location?.pathname).toBe("/bar");

      await B.loaders.bar.resolve("B");
      navigation = t.router.state.navigation;
      expect(navigation.state).toBe("idle");
      expect(navigation.formData).toBeUndefined();
      expect(navigation.location).toBeUndefined();
    });
  });

  describe("interruptions", () => {
    describe(`
      A) GET /foo |---X
      B) GET /bar     |---O
    `, () => {
      it("aborts previous load", async () => {
        let t = initializeTmTest();
        let A = await t.navigate("/foo");
        t.navigate("/bar");
        expect(A.loaders.foo.stub.mock.calls.length).toBe(1);
      });
    });

    describe(`
      A) GET  /foo |---X
      B) POST /bar     |---O
    `, () => {
      it("aborts previous load", async () => {
        let t = initializeTmTest();
        let A = await t.navigate("/foo");
        await t.navigate("/bar", {
          formMethod: "post",
          formData: new FormData(),
        });
        expect(A.loaders.foo.signal.aborted).toBe(true);
      });
    });

    describe(`
      A) POST /foo |---X
      B) POST /bar     |---O
    `, () => {
      it("aborts previous action", async () => {
        let t = initializeTmTest();
        let A = await t.navigate("/foo", {
          formMethod: "post",
          formData: new FormData(),
        });
        await t.navigate("/bar", {
          formMethod: "post",
          formData: new FormData(),
        });
        expect(A.actions.foo.signal.aborted).toBe(true);
      });
    });

    describe(`
      A) POST /foo |--|--X
      B) GET  /bar       |---O
    `, () => {
      it("aborts previous action reload", async () => {
        let t = initializeTmTest();
        let A = await t.navigate("/foo", {
          formMethod: "post",
          formData: new FormData(),
        });
        await A.actions.foo.resolve("A ACTION");
        await t.navigate("/bar");
        expect(A.loaders.foo.signal.aborted).toBe(true);
      });
    });

    describe(`
      A) POST /foo |--|--X
      B) POST /bar       |---O
    `, () => {
      it("aborts previous action reload", async () => {
        let t = initializeTmTest();
        let A = await t.navigate("/foo", {
          formMethod: "post",
          formData: new FormData(),
        });
        await A.actions.foo.resolve("A ACTION");
        await t.navigate("/bar", {
          formMethod: "post",
          formData: new FormData(),
        });
        expect(A.loaders.foo.signal.aborted).toBe(true);
      });
    });

    describe(`
      A) GET /foo |--/bar--X
      B) GET /baz          |---O
    `, () => {
      it("aborts previous action redirect load", async () => {
        let t = initializeTmTest();
        let A = await t.navigate("/foo");
        let AR = await A.loaders.foo.redirect("/bar");
        t.navigate("/baz");
        expect(AR.loaders.bar.stub.mock.calls.length).toBe(1);
      });
    });

    describe(`
      A) POST /foo |--/bar--X
      B) GET  /baz          |---O
    `, () => {
      it("aborts previous action redirect load", async () => {
        let t = initializeTmTest();
        let A = await t.navigate("/foo", {
          formMethod: "post",
          formData: new FormData(),
        });
        let AR = await A.actions.foo.redirect("/bar");
        await t.navigate("/baz");
        expect(AR.loaders.bar.signal.aborted).toBe(true);
      });
    });

    describe(`
      A) GET /foo |---X
      B) GET /bar     |---X
      C) GET /baz         |---O
    `, () => {
      it("aborts multiple subsequent loads", async () => {
        let t = initializeTmTest();
        // Start A navigation and immediately interrupt
        let A = await t.navigate("/foo");
        let B = await t.navigate("/bar");
        // resolve A then interrupt B - ensure the A resolution doesn't clear
        // the new pendingNavigationController which is now reflecting B's nav
        await A.loaders.foo.resolve("A");
        let C = await t.navigate("/baz");
        await B.loaders.bar.resolve("B");
        await C.loaders.baz.resolve("C");

        expect(A.loaders.foo.stub.mock.calls.length).toBe(1);
        expect(A.loaders.foo.signal.aborted).toBe(true);

        expect(B.loaders.bar.stub.mock.calls.length).toBe(1);
        expect(B.loaders.bar.signal.aborted).toBe(true);

        expect(C.loaders.baz.stub.mock.calls.length).toBe(1);
        expect(C.loaders.baz.signal.aborted).toBe(false);

        expect(t.router.state.loaderData).toEqual({
          root: "ROOT",
          baz: "C",
        });
      });
    });

    describe(`
      A) POST /foo |---X
      B) POST /bar     |---X
      C) POST /baz         |---O
    `, () => {
      it("aborts previous load", async () => {
        let t = initializeTmTest();
        // Start A navigation and immediately interrupt
        let A = await t.navigate("/foo", {
          formMethod: "post",
          formData: new FormData(),
        });
        let B = await t.navigate("/bar", {
          formMethod: "post",
          formData: new FormData(),
        });
        // resolve A then interrupt B - ensure the A resolution doesn't clear
        // the new pendingNavigationController which is now reflecting B's nav
        await A.actions.foo.resolve("A");
        let C = await t.navigate("/baz", {
          formMethod: "post",
          formData: new FormData(),
        });
        await B.actions.bar.resolve("B");
        await C.actions.baz.resolve("C");

        expect(A.actions.foo.stub.mock.calls.length).toBe(1);
        expect(A.actions.foo.signal.aborted).toBe(true);

        expect(B.actions.bar.stub.mock.calls.length).toBe(1);
        expect(B.actions.bar.signal.aborted).toBe(true);

        expect(C.actions.baz.stub.mock.calls.length).toBe(1);
        expect(C.actions.baz.signal.aborted).toBe(false);

        expect(t.router.state.actionData).toEqual({
          baz: "C",
        });
      });
    });

    describe(`
      A) POST /foo |--X
      B) GET  /bar    |-----O
    `, () => {
      it("forces all loaders to revalidate on interrupted submission", async () => {
        let t = initializeTmTest();
        let A = await t.navigate("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        // Interrupting the submission should cause the next load to call all loaders
        let B = await t.navigate("/bar");
        await A.actions.foo.resolve("A ACTION");
        await B.loaders.root.resolve("ROOT*");
        await B.loaders.bar.resolve("BAR");
        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/bar" },
          actionData: null,
          loaderData: {
            root: "ROOT*",
            bar: "BAR",
          },
        });
      });
    });

    describe(`
      A) POST /foo |--|--X
      B) GET  /bar       |-----O
    `, () => {
      it("forces all loaders to revalidate on interrupted actionReload", async () => {
        let t = initializeTmTest();
        let A = await t.navigate("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.resolve("A ACTION");
        expect(t.router.state.navigation.state).toBe("loading");
        // Interrupting the actionReload should cause the next load to call all loaders
        let B = await t.navigate("/bar");
        await B.loaders.root.resolve("ROOT*");
        await B.loaders.bar.resolve("BAR");
        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/bar" },
          actionData: null,
          loaderData: {
            root: "ROOT*",
            bar: "BAR",
          },
        });
      });

      it("forces all loaders to revalidate on interrupted submissionRedirect", async () => {
        let t = initializeTmTest();
        let A = await t.navigate("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.redirect("/baz");
        expect(t.router.state.navigation.state).toBe("loading");
        // Interrupting the submissionRedirect should cause the next load to call all loaders
        let B = await t.navigate("/bar");
        await B.loaders.root.resolve("ROOT*");
        await B.loaders.bar.resolve("BAR");
        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/bar" },
          loaderData: {
            root: "ROOT*",
            bar: "BAR",
          },
        });
      });
    });
  });

  describe("navigation (new)", () => {
    it("navigates through a history stack without data loading", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
          },
          {
            id: "tasks",
            path: "tasks",
          },
          {
            id: "tasksId",
            path: "tasks/:id",
          },
        ],
        initialEntries: ["/"],
      });

      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
          search: "",
          hash: "",
          state: null,
          key: expect.any(String),
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        matches: [expect.objectContaining({ pathname: "/" })],
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await t.navigate("/tasks");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks",
          search: "",
          hash: "",
          state: null,
          key: expect.any(String),
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        matches: [expect.objectContaining({ pathname: "/tasks" })],
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks");

      await t.navigate("/tasks/1", { replace: true });
      expect(t.router.state).toMatchObject({
        historyAction: "REPLACE",
        location: {
          pathname: "/tasks/1",
          search: "",
          hash: "",
          state: null,
          key: expect.any(String),
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        matches: [expect.objectContaining({ pathname: "/tasks/1" })],
      });
      expect(t.history.action).toEqual("REPLACE");
      expect(t.history.location.pathname).toEqual("/tasks/1");

      t.router.navigate(-1);
      await tick();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
          search: "",
          hash: "",
          state: null,
          key: expect.any(String),
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        matches: [expect.objectContaining({ pathname: "/" })],
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await t.navigate("/tasks?foo=bar#hash");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks",
          search: "?foo=bar",
          hash: "#hash",
          state: null,
          key: expect.any(String),
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        matches: [expect.objectContaining({ pathname: "/tasks" })],
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location).toEqual({
        pathname: "/tasks",
        search: "?foo=bar",
        hash: "#hash",
        state: null,
        key: expect.any(String),
      });
    });

    it("navigates through a history stack without data loading (with a basename)", async () => {
      let t = setup({
        basename: "/base/name",
        routes: [
          {
            id: "index",
            index: true,
          },
          {
            id: "tasks",
            path: "tasks",
          },
          {
            id: "tasksId",
            path: "tasks/:id",
          },
        ],
        initialEntries: ["/base/name"],
      });

      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/base/name",
        },
        matches: [{ route: { id: "index" } }],
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/base/name");

      await t.navigate("/base/name/tasks");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/base/name/tasks",
        },
        matches: [{ route: { id: "tasks" } }],
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/base/name/tasks");

      await t.navigate("/base/name/tasks/1");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/base/name/tasks/1",
        },
        matches: [{ route: { id: "tasksId" } }],
      });
      expect(t.history.location.pathname).toEqual("/base/name/tasks/1");
    });

    it("handles 404 routes", () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
      });
      t.navigate("/junk");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/junk",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        errors: {
          root: new ErrorResponse(
            404,
            "Not Found",
            new Error('No route matches URL "/junk"'),
            true
          ),
        },
      });
    });

    it("converts formData to URLSearchParams for unspecified formMethod", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
      });
      await t.navigate("/tasks", {
        formData: createFormData({ key: "value" }),
      });
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location).toMatchObject({
        pathname: "/tasks",
        search: "?key=value",
      });
      expect(t.router.state.navigation.formMethod).toBe("get");
      expect(t.router.state.navigation.formData).toEqual(
        createFormData({ key: "value" })
      );
    });

    it("converts formData to URLSearchParams for formMethod=get", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
      });
      await t.navigate("/tasks", {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location).toMatchObject({
        pathname: "/tasks",
        search: "?key=value",
      });
      expect(t.router.state.navigation.formMethod).toBe("get");
      expect(t.router.state.navigation.formData).toEqual(
        createFormData({ key: "value" })
      );
    });

    it("does not preserve existing 'action' URLSearchParams for formMethod='get'", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
      });
      await t.navigate("/tasks?key=1", {
        formMethod: "get",
        formData: createFormData({ key: "2" }),
      });
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location).toMatchObject({
        pathname: "/tasks",
        search: "?key=2",
      });
      expect(t.router.state.navigation.formMethod).toBe("get");
      expect(t.router.state.navigation.formData).toEqual(
        createFormData({ key: "2" })
      );
    });

    it("preserves existing 'action' URLSearchParams for formMethod='post'", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
      });
      await t.navigate("/tasks?key=1", {
        formMethod: "post",
        formData: createFormData({ key: "2" }),
      });
      expect(t.router.state.navigation.state).toBe("submitting");
      expect(t.router.state.navigation.location).toMatchObject({
        pathname: "/tasks",
        search: "?key=1",
      });
      expect(t.router.state.navigation.formMethod).toBe("post");
      expect(t.router.state.navigation.formData).toEqual(
        createFormData({ key: "2" })
      );
    });

    it("url-encodes File names on GET submissions", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      let formData = new FormData();
      formData.append(
        "blob",
        new Blob(["<h1>Some html file contents</h1>"], {
          type: "text/html",
        }),
        "blob.html"
      );

      let A = await t.navigate("/tasks", {
        formMethod: "get",
        formData: formData,
      });
      let params = new URL(A.loaders.tasks.stub.mock.calls[0][0].request.url)
        .searchParams;
      expect(params.get("blob")).toEqual("blob.html");
    });

    it("returns a 405 error if attempting to submit with method=HEAD", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      let formData = new FormData();
      formData.append(
        "blob",
        new Blob(["<h1>Some html file contents</h1>"], {
          type: "text/html",
        })
      );

      await t.navigate("/tasks", {
        // @ts-expect-error
        formMethod: "head",
        formData: formData,
      });
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.location).toMatchObject({
        pathname: "/tasks",
        search: "",
      });
      expect(t.router.state.errors).toEqual({
        tasks: new ErrorResponse(
          405,
          "Method Not Allowed",
          new Error('Invalid request method "HEAD"'),
          true
        ),
      });
    });

    it("returns a 405 error if attempting to submit with method=OPTIONS", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      let formData = new FormData();
      formData.append(
        "blob",
        new Blob(["<h1>Some html file contents</h1>"], {
          type: "text/html",
        })
      );

      await t.navigate("/tasks", {
        // @ts-expect-error
        formMethod: "options",
        formData: formData,
      });
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.location).toMatchObject({
        pathname: "/tasks",
        search: "",
      });
      expect(t.router.state.errors).toEqual({
        tasks: new ErrorResponse(
          405,
          "Method Not Allowed",
          new Error('Invalid request method "OPTIONS"'),
          true
        ),
      });
    });
  });

  describe("data loading (new)", () => {
    it("marks as initialized immediately when no loaders are present", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
          },
        ],
        initialEntries: ["/"],
      });

      expect(console.warn).not.toHaveBeenCalled();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {},
      });
    });

    it("hydrates initial data", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      expect(console.warn).not.toHaveBeenCalled();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT DATA",
          index: "INDEX DATA",
        },
      });
    });

    it("kicks off initial data load if no hydration data is provided", async () => {
      let parentDfd = createDeferred();
      let parentSpy = jest.fn(() => parentDfd.promise);
      let childDfd = createDeferred();
      let childSpy = jest.fn(() => childDfd.promise);
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/child"] }),
        routes: [
          {
            path: "/",
            loader: parentSpy,
            children: [
              {
                path: "child",
                loader: childSpy,
              },
            ],
          },
        ],
      });
      router.initialize();

      expect(console.warn).not.toHaveBeenCalled();
      expect(parentSpy.mock.calls.length).toBe(1);
      expect(childSpy.mock.calls.length).toBe(1);
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/child" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      await parentDfd.resolve("PARENT DATA");
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/child" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      await childDfd.resolve("CHILD DATA");
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {
          "0": "PARENT DATA",
          "0-0": "CHILD DATA",
        },
      });

      router.dispose();
    });

    // This is needed because we can't detect valid "I have a loader" routes
    // in Remix since all routes have a loader to fetch JS bundles but may not
    // actually provide any loaderData
    it("treats partial hydration data as initialized", async () => {
      let parentSpy = jest.fn();
      let childSpy = jest.fn();
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/child"] }),
        routes: [
          {
            path: "/",
            loader: parentSpy,
            children: [
              {
                path: "child",
                loader: childSpy,
              },
            ],
          },
        ],
        hydrationData: {
          loaderData: {
            "0": "PARENT DATA",
          },
        },
      });
      router.initialize();

      expect(parentSpy.mock.calls.length).toBe(0);
      expect(childSpy.mock.calls.length).toBe(0);
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: true,
        navigation: IDLE_NAVIGATION,
      });
      expect(router.state.loaderData).toEqual({
        "0": "PARENT DATA",
      });

      router.dispose();
    });

    it("does not kick off initial data load due to partial hydration if errors exist", async () => {
      let parentDfd = createDeferred();
      let parentSpy = jest.fn(() => parentDfd.promise);
      let childDfd = createDeferred();
      let childSpy = jest.fn(() => childDfd.promise);
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/child"] }),
        routes: [
          {
            path: "/",
            loader: parentSpy,
            children: [
              {
                path: "child",
                loader: childSpy,
              },
            ],
          },
        ],
        hydrationData: {
          errors: {
            "0": "PARENT ERROR",
          },
          loaderData: {
            "0-0": "CHILD_DATA",
          },
        },
      });
      router.initialize();

      expect(console.warn).not.toHaveBeenCalled();
      expect(parentSpy).not.toHaveBeenCalled();
      expect(childSpy).not.toHaveBeenCalled();
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: true,
        navigation: IDLE_NAVIGATION,
        errors: {
          "0": "PARENT ERROR",
        },
        loaderData: {
          "0-0": "CHILD_DATA",
        },
      });

      router.dispose();
    });

    it("handles interruptions of initial data load", async () => {
      let parentDfd = createDeferred();
      let parentSpy = jest.fn(() => parentDfd.promise);
      let childDfd = createDeferred();
      let childSpy = jest.fn(() => childDfd.promise);
      let child2Dfd = createDeferred();
      let child2Spy = jest.fn(() => child2Dfd.promise);
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/child"] }),
        routes: [
          {
            path: "/",
            loader: parentSpy,
            children: [
              {
                path: "child",
                loader: childSpy,
              },
              {
                path: "child2",
                loader: child2Spy,
              },
            ],
          },
        ],
      });
      router.initialize();

      expect(console.warn).not.toHaveBeenCalled();
      expect(parentSpy.mock.calls.length).toBe(1);
      expect(childSpy.mock.calls.length).toBe(1);
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/child" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      await parentDfd.resolve("PARENT DATA");
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/child" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      router.navigate("/child2");
      await childDfd.resolve("CHILD DATA");
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/child2" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      await child2Dfd.resolve("CHILD2 DATA");
      expect(router.state).toMatchObject({
        historyAction: "PUSH",
        location: expect.objectContaining({ pathname: "/child2" }),
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {
          "0": "PARENT DATA",
          "0-1": "CHILD2 DATA",
        },
      });

      router.dispose();
    });

    it("handles errors in initial data load", async () => {
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/child"] }),
        routes: [
          {
            path: "/",
            loader: () => Promise.reject("Kaboom!"),
            children: [
              {
                path: "child",
                loader: () => Promise.resolve("child"),
              },
            ],
          },
        ],
      });
      router.initialize();

      await tick();
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {
          "0-0": "child",
        },
        errors: {
          "0": "Kaboom!",
        },
      });

      router.dispose();
    });

    it("kicks off initial data load when hash is present", async () => {
      let loaderDfd = createDeferred();
      let loaderSpy = jest.fn(() => loaderDfd.promise);
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/#hash"] }),
        routes: [
          {
            path: "/",
            loader: loaderSpy,
          },
        ],
      });
      router.initialize();

      expect(console.warn).not.toHaveBeenCalled();
      expect(loaderSpy.mock.calls.length).toBe(1);
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/", hash: "#hash" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/", hash: "#hash" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      await loaderDfd.resolve("DATA");
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/", hash: "#hash" }),
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {
          "0": "DATA",
        },
      });

      router.dispose();
    });

    it("executes loaders on push navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let nav1 = await t.navigate("/tasks");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await nav1.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasks: "TASKS_DATA",
        },
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks");

      let nav2 = await t.navigate("/tasks/1");
      await nav2.loaders.tasksId.resolve("TASKS_ID_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks/1",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasksId: "TASKS_ID_DATA",
        },
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks/1");
    });

    it("executes loaders on replace navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let nav = await t.navigate("/tasks", { replace: true });
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await nav.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "REPLACE",
        location: {
          pathname: "/tasks",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasks: "TASKS_DATA",
        },
      });
      expect(t.history.action).toEqual("REPLACE");
      expect(t.history.location.pathname).toEqual("/tasks");
    });

    it("executes loaders on go navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/", "/tasks"],
        initialIndex: 0,
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      // pop forward to /tasks
      let nav2 = await t.navigate(1);
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/tasks");

      await nav2.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/tasks",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasks: "TASKS_DATA",
        },
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/tasks");
    });

    it("persists location keys throughout navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      expect(t.router.state.location.key).toBe("default");

      let A = await t.navigate("/tasks");
      let navigationKey = t.router.state.navigation.location?.key;
      expect(t.router.state.location.key).toBe("default");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(navigationKey).not.toBe("default");
      expect(Number(navigationKey?.length) > 0).toBe(true);

      await A.loaders.tasks.resolve("TASKS");
      expect(t.router.state.navigation.state).toBe("idle");

      // Make sure we keep the same location.key throughout the navigation and
      // history isn't creating a new one in history.push
      expect(t.router.state.location.key).toBe(navigationKey);
      expect(t.history.location.key).toBe(navigationKey);
    });

    it("sends proper arguments to loaders", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
          },
        },
      });

      let nav = await t.navigate("/tasks");
      expect(nav.loaders.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: new Request("http://localhost/tasks", {
          signal: nav.loaders.tasks.stub.mock.calls[0][0].request.signal,
        }),
      });

      let nav2 = await t.navigate("/tasks/1");
      expect(nav2.loaders.tasksId.stub).toHaveBeenCalledWith({
        params: { id: "1" },
        request: new Request("http://localhost/tasks/1", {
          signal: nav2.loaders.tasksId.stub.mock.calls[0][0].request.signal,
        }),
      });

      let nav3 = await t.navigate("/tasks?foo=bar#hash");
      expect(nav3.loaders.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: new Request("http://localhost/tasks?foo=bar", {
          signal: nav3.loaders.tasks.stub.mock.calls[0][0].request.signal,
        }),
      });

      let nav4 = await t.navigate("/tasks#hash", {
        formData: createFormData({ foo: "bar" }),
      });
      expect(nav4.loaders.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: new Request("http://localhost/tasks?foo=bar", {
          signal: nav4.loaders.tasks.stub.mock.calls[0][0].request.signal,
        }),
      });

      expect(t.router.state.navigation.formAction).toBe("/tasks");
      expect(t.router.state.navigation?.location?.pathname).toBe("/tasks");
      expect(t.router.state.navigation?.location?.search).toBe("?foo=bar");
    });

    it("handles errors thrown from loaders", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      // Throw from tasks, handled by tasks
      let nav = await t.navigate("/tasks");
      await nav.loaders.tasks.reject("TASKS_ERROR");
      expect(t.router.state.navigation).toEqual(IDLE_NAVIGATION);
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT_DATA",
      });
      expect(t.router.state.errors).toEqual({
        tasks: "TASKS_ERROR",
      });

      // Throw from index, handled by root
      let nav2 = await t.navigate("/");
      await nav2.loaders.index.reject("INDEX_ERROR");
      expect(t.router.state.navigation).toEqual(IDLE_NAVIGATION);
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT_DATA",
      });
      expect(t.router.state.errors).toEqual({
        root: "INDEX_ERROR",
      });
    });

    it("re-runs loaders on post-error navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          errors: {
            root: "ROOT_ERROR",
          },
        },
      });

      // If a route has an error, we should call the loader if that route is
      // re-used on a navigation
      let nav = await t.navigate("/tasks");
      await nav.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state.navigation.state).toEqual("loading");
      expect(t.router.state.loaderData).toEqual({});
      expect(t.router.state.errors).toEqual({
        root: "ROOT_ERROR",
      });

      await nav.loaders.root.resolve("ROOT_DATA");
      expect(t.router.state.navigation).toEqual(IDLE_NAVIGATION);
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT_DATA",
        tasks: "TASKS_DATA",
      });
      expect(t.router.state.errors).toBe(null);
    });

    it("handles interruptions during navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let historySpy = jest.spyOn(t.history, "push");

      let nav = await t.navigate("/tasks");
      expect(t.router.state.navigation.state).toEqual("loading");
      expect(t.router.state.location.pathname).toEqual("/");
      expect(nav.loaders.tasks.signal.aborted).toBe(false);
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      // Interrupt and confirm prior loader was aborted
      let nav2 = await t.navigate("/tasks/1");
      expect(t.router.state.navigation.state).toEqual("loading");
      expect(t.router.state.location.pathname).toEqual("/");
      expect(nav.loaders.tasks.signal.aborted).toBe(true);
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      // Complete second navigation
      await nav2.loaders.tasksId.resolve("TASKS_ID_DATA");
      expect(t.router.state.navigation).toEqual(IDLE_NAVIGATION);
      expect(t.router.state.location.pathname).toEqual("/tasks/1");
      expect(t.history.location.pathname).toEqual("/tasks/1");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT_DATA",
        tasksId: "TASKS_ID_DATA",
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks/1");

      // Resolve first navigation - should no-op
      await nav.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state.navigation).toEqual(IDLE_NAVIGATION);
      expect(t.router.state.location.pathname).toEqual("/tasks/1");
      expect(t.history.location.pathname).toEqual("/tasks/1");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT_DATA",
        tasksId: "TASKS_ID_DATA",
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks/1");

      expect(historySpy.mock.calls).toEqual([
        [
          expect.objectContaining({
            pathname: "/tasks/1",
          }),
          null,
        ],
      ]);
    });

    it("handles redirects thrown from loaders", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let nav1 = await t.navigate("/tasks");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      let nav2 = await nav1.loaders.tasks.redirect("/tasks/1");

      // Should not abort if it redirected
      expect(nav1.loaders.tasks.signal.aborted).toBe(false);
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks/1",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await nav2.loaders.tasksId.resolve("TASKS_ID_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks/1",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasksId: "TASKS_ID_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks/1");
    });

    it("handles redirects returned from loaders", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let nav1 = await t.navigate("/tasks");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      let nav2 = await nav1.loaders.tasks.redirectReturn("/tasks/1");

      // Should not abort if it redirected
      expect(nav1.loaders.tasks.signal.aborted).toBe(false);
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks/1",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await nav2.loaders.tasksId.resolve("TASKS_ID_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks/1",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasksId: "TASKS_ID_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks/1");
    });

    it("handles thrown non-redirect Responses as ErrorResponse's (text)", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      // Throw from tasks, handled by tasks
      let nav = await t.navigate("/tasks");
      await nav.loaders.tasks.reject(
        new Response("broken", { status: 400, statusText: "Bad Request" })
      );
      expect(t.router.state).toMatchObject({
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
        },
        actionData: null,
        errors: {
          tasks: new ErrorResponse(400, "Bad Request", "broken"),
        },
      });
    });

    it("handles thrown non-redirect Responses as ErrorResponse's (json)", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      // Throw from tasks, handled by tasks
      let nav = await t.navigate("/tasks");
      await nav.loaders.tasks.reject(
        new Response(JSON.stringify({ key: "value" }), {
          status: 400,
          statusText: "Bad Request",
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
      expect(t.router.state).toMatchObject({
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
        },
        actionData: null,
        errors: {
          tasks: new ErrorResponse(400, "Bad Request", { key: "value" }),
        },
      });
    });

    it("handles thrown non-redirect Responses as ErrorResponse's (json utf8)", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      // Throw from tasks, handled by tasks
      let nav = await t.navigate("/tasks");
      await nav.loaders.tasks.reject(
        new Response(JSON.stringify({ key: "value" }), {
          status: 400,
          statusText: "Bad Request",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        })
      );
      expect(t.router.state).toMatchObject({
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
        },
        actionData: null,
        errors: {
          tasks: new ErrorResponse(400, "Bad Request", { key: "value" }),
        },
      });
    });

    it("sends proper arguments to actions", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
          },
        },
      });

      let nav = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({ query: "params" }),
      });
      expect(nav.actions.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: expect.any(Request),
      });

      // Assert request internals, cannot do a deep comparison above since some
      // internals aren't the same on separate creations
      let request = nav.actions.tasks.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/tasks");
      expect(request.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
      expect((await request.formData()).get("query")).toBe("params");

      await nav.actions.tasks.resolve("TASKS ACTION");
      let rootLoaderRequest = nav.loaders.root.stub.mock.calls[0][0].request;
      expect(rootLoaderRequest.method).toBe("GET");
      expect(rootLoaderRequest.url).toBe("http://localhost/tasks");

      let tasksLoaderRequest = nav.loaders.tasks.stub.mock.calls[0][0].request;
      expect(tasksLoaderRequest.method).toBe("GET");
      expect(tasksLoaderRequest.url).toBe("http://localhost/tasks");
    });

    it("sends proper arguments to actions (using query string)", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
          },
        },
      });

      let formData = createFormData({ query: "params" });

      let nav = await t.navigate("/tasks?foo=bar", {
        formMethod: "post",
        formData,
      });
      expect(nav.actions.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: expect.any(Request),
      });
      // Assert request internals, cannot do a deep comparison above since some
      // internals aren't the same on separate creations
      let request = nav.actions.tasks.stub.mock.calls[0][0].request;
      expect(request.url).toBe("http://localhost/tasks?foo=bar");
      expect(request.method).toBe("POST");
      expect(request.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
      expect((await request.formData()).get("query")).toBe("params");
    });

    // https://fetch.spec.whatwg.org/#concept-method
    it("properly handles method=PATCH weirdness", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
          },
        },
      });

      let nav = await t.navigate("/tasks", {
        formMethod: "patch",
        formData: createFormData({ query: "params" }),
      });
      expect(nav.actions.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: expect.any(Request),
      });

      // Assert request internals, cannot do a deep comparison above since some
      // internals aren't the same on separate creations
      let request = nav.actions.tasks.stub.mock.calls[0][0].request;
      expect(request.method).toBe("PATCH");
      expect(request.url).toBe("http://localhost/tasks");
      expect(request.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
      expect((await request.formData()).get("query")).toBe("params");

      await nav.actions.tasks.resolve("TASKS ACTION");
      let rootLoaderRequest = nav.loaders.root.stub.mock.calls[0][0].request;
      expect(rootLoaderRequest.method).toBe("GET");
      expect(rootLoaderRequest.url).toBe("http://localhost/tasks");

      let tasksLoaderRequest = nav.loaders.tasks.stub.mock.calls[0][0].request;
      expect(tasksLoaderRequest.method).toBe("GET");
      expect(tasksLoaderRequest.url).toBe("http://localhost/tasks");
    });

    it("handles multipart/form-data submissions", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            action: true,
          },
        ],
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
          },
        },
      });

      let fd = new FormData();
      fd.append("key", "value");
      fd.append("file", new Blob(["1", "2", "3"]), "file.txt");

      let A = await t.navigate("/", {
        formMethod: "post",
        formEncType: "multipart/form-data",
        formData: fd,
      });

      expect(
        A.actions.root.stub.mock.calls[0][0].request.headers.get("Content-Type")
      ).toMatch(
        /^multipart\/form-data; boundary=NodeFetchFormDataBoundary[a-z0-9]+/
      );
    });

    it("url-encodes File names on x-www-form-urlencoded submissions", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            action: true,
          },
        ],
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
          },
        },
      });

      let fd = new FormData();
      fd.append("key", "value");
      fd.append("file", new Blob(["1", "2", "3"]), "file.txt");

      let A = await t.navigate("/", {
        formMethod: "post",
        formEncType: "application/x-www-form-urlencoded",
        formData: fd,
      });

      let req = A.actions.root.stub.mock.calls[0][0].request.clone();
      expect((await req.formData()).get("file")).toEqual("file.txt");
    });

    it("races actions and loaders against abort signals", async () => {
      let loaderDfd = createDeferred();
      let actionDfd = createDeferred();
      let router = createRouter({
        routes: [
          {
            index: true,
          },
          {
            path: "foo",
            loader: () => loaderDfd.promise,
            action: () => actionDfd.promise,
          },
          {
            path: "bar",
          },
        ],
        hydrationData: { loaderData: { "0": null } },
        history: createMemoryHistory(),
      });

      expect(router.state.initialized).toBe(true);

      let fooPromise = router.navigate("/foo");
      expect(router.state.navigation.state).toBe("loading");

      let barPromise = router.navigate("/bar");

      // This should resolve _without_ us resolving the loader
      await fooPromise;
      await barPromise;

      expect(router.state.navigation.state).toBe("idle");
      expect(router.state.location.pathname).toBe("/bar");

      let fooPromise2 = router.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(router.state.navigation.state).toBe("submitting");

      let barPromise2 = router.navigate("/bar");

      // This should resolve _without_ us resolving the action
      await fooPromise2;
      await barPromise2;

      expect(router.state.navigation.state).toBe("idle");
      expect(router.state.location.pathname).toBe("/bar");

      router.dispose();
    });

    it("throws an error if actions/loaders return undefined", async () => {
      let t = setup({
        routes: [
          {
            index: true,
          },
          {
            id: "path",
            path: "/path",
            loader: true,
            action: true,
          },
        ],
      });

      let nav1 = await t.navigate("/path");
      await nav1.loaders.path.resolve(undefined);
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/path",
        },
        errors: {
          path: new Error(
            'You defined a loader for route "path" but didn\'t return anything ' +
              "from your `loader` function. Please return a value or `null`."
          ),
        },
      });

      await t.navigate("/");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/",
        },
        errors: {},
      });

      let nav3 = await t.navigate("/path", {
        formMethod: "post",
        formData: createFormData({}),
      });
      await nav3.actions.path.resolve(undefined);
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/path",
        },
        errors: {
          path: new Error(
            'You defined an action for route "path" but didn\'t return anything ' +
              "from your `action` function. Please return a value or `null`."
          ),
        },
      });
    });
  });

  describe("redirects", () => {
    let REDIRECT_ROUTES: TestRouteObject[] = [
      {
        id: "root",
        path: "/",
        children: [
          {
            id: "parent",
            path: "parent",
            action: true,
            loader: true,
            children: [
              {
                id: "child",
                path: "child",
                action: true,
                loader: true,
                children: [
                  {
                    id: "index",
                    index: true,
                    action: true,
                    loader: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    it("applies the basename to redirects returned from loaders", async () => {
      let t = setup({
        routes: REDIRECT_ROUTES,
        basename: "/base/name",
        initialEntries: ["/base/name"],
      });

      let nav1 = await t.navigate("/base/name/parent");

      let nav2 = await nav1.loaders.parent.redirectReturn("/parent/child");
      await nav2.loaders.parent.resolve("PARENT");
      await nav2.loaders.child.resolve("CHILD");
      await nav2.loaders.index.resolve("INDEX");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/base/name/parent/child",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          parent: "PARENT",
          child: "CHILD",
          index: "INDEX",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/base/name/parent/child");
    });

    it("supports relative routing in redirects (from parent navigation loader)", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let nav1 = await t.navigate("/parent/child");

      await nav1.loaders.child.resolve("CHILD");
      await nav1.loaders.index.resolve("INDEX");
      await nav1.loaders.parent.redirectReturn("..");
      // No root loader so redirect lands immediately
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        errors: null,
      });
    });

    it("supports relative routing in redirects (from child navigation loader)", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let nav1 = await t.navigate("/parent/child");

      await nav1.loaders.parent.resolve("PARENT");
      await nav1.loaders.index.resolve("INDEX");
      let nav2 = await nav1.loaders.child.redirectReturn(
        "..",
        undefined,
        undefined,
        ["parent"]
      );
      await nav2.loaders.parent.resolve("PARENT 2");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/parent",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          parent: "PARENT 2",
        },
        errors: null,
      });
    });

    it("supports relative routing in redirects (from index navigation loader)", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let nav1 = await t.navigate("/parent/child");

      await nav1.loaders.parent.resolve("PARENT");
      await nav1.loaders.child.resolve("INDEX");
      let nav2 = await nav1.loaders.index.redirectReturn(
        "..",
        undefined,
        undefined,
        ["parent"]
      );
      await nav2.loaders.parent.resolve("PARENT 2");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/parent",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          parent: "PARENT 2",
        },
        errors: null,
      });
    });

    it("supports relative routing in redirects (from parent fetch loader)", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let fetch = await t.fetch("/parent", "key");

      await fetch.loaders.parent.redirectReturn("..", undefined, undefined, [
        "parent",
      ]);

      // No root loader so redirect lands immediately
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        errors: null,
      });
      expect(t.router.state.fetchers.get("key")).toMatchObject({
        state: "idle",
        data: undefined,
      });
    });

    it("supports relative routing in redirects (from child fetch loader)", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let fetch = await t.fetch("/parent/child");
      let nav = await fetch.loaders.child.redirectReturn(
        "..",
        undefined,
        undefined,
        ["parent"]
      );

      await nav.loaders.parent.resolve("PARENT");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/parent",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          parent: "PARENT",
        },
        errors: null,
      });
    });

    it("supports relative routing in redirects (from index fetch loader)", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let fetch = await t.fetch("/parent/child?index");
      let nav = await fetch.loaders.index.redirectReturn(
        "..",
        undefined,
        undefined,
        ["parent"]
      );

      await nav.loaders.parent.resolve("PARENT");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/parent",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          parent: "PARENT",
        },
        errors: null,
      });
    });

    it("supports . redirects", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let nav1 = await t.navigate("/parent");

      let nav2 = await nav1.loaders.parent.redirectReturn(
        "./child",
        undefined,
        undefined,
        ["parent", "child", "index"]
      );
      await nav2.loaders.parent.resolve("PARENT");
      await nav2.loaders.child.resolve("CHILD");
      await nav2.loaders.index.resolve("INDEX");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/parent/child",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          parent: "PARENT",
          child: "CHILD",
          index: "INDEX",
        },
        errors: null,
      });
    });

    it("supports relative routing in navigation action redirects", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let nav1 = await t.navigate("/parent/child", {
        formMethod: "post",
        formData: createFormData({}),
      });

      let nav2 = await nav1.actions.child.redirectReturn(
        "..",
        undefined,
        undefined,
        ["parent"]
      );
      await nav2.loaders.parent.resolve("PARENT");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/parent",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          parent: "PARENT",
        },
        errors: null,
      });
    });

    it("supports relative routing in fetch action redirects", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let nav1 = await t.fetch("/parent/child", {
        formMethod: "post",
        formData: createFormData({}),
      });

      let nav2 = await nav1.actions.child.redirectReturn(
        "..",
        undefined,
        undefined,
        ["parent"]
      );
      await nav2.loaders.parent.resolve("PARENT");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/parent",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          parent: "PARENT",
        },
        errors: null,
      });
    });

    it("preserves query and hash in redirects", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let nav1 = await t.navigate("/parent/child", {
        formMethod: "post",
        formData: createFormData({}),
      });

      let nav2 = await nav1.actions.child.redirectReturn(
        "/parent?key=value#hash"
      );
      await nav2.loaders.parent.resolve("PARENT");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/parent",
          search: "?key=value",
          hash: "#hash",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          parent: "PARENT",
        },
        errors: null,
      });
    });

    it("preserves query and hash in relative redirects", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let nav1 = await t.navigate("/parent/child", {
        formMethod: "post",
        formData: createFormData({}),
      });

      let nav2 = await nav1.actions.child.redirectReturn(
        "..?key=value#hash",
        undefined,
        undefined,
        ["parent"]
      );
      await nav2.loaders.parent.resolve("PARENT");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/parent",
          search: "?key=value",
          hash: "#hash",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          parent: "PARENT",
        },
        errors: null,
      });
    });

    it("processes external redirects if window is present (push)", async () => {
      let urls = [
        "http://remix.run/blog",
        "https://remix.run/blog",
        "//remix.run/blog",
        "app://whatever",
      ];

      for (let url of urls) {
        let t = setup({ routes: REDIRECT_ROUTES });

        let A = await t.navigate("/parent/child", {
          formMethod: "post",
          formData: createFormData({}),
        });

        await A.actions.child.redirectReturn(url);
        expect(t.window.location.assign).toHaveBeenCalledWith(url);
        expect(t.window.location.replace).not.toHaveBeenCalled();
      }
    });

    it("processes external redirects if window is present (replace)", async () => {
      let urls = [
        "http://remix.run/blog",
        "https://remix.run/blog",
        "//remix.run/blog",
        "app://whatever",
      ];

      for (let url of urls) {
        let t = setup({ routes: REDIRECT_ROUTES });

        let A = await t.navigate("/parent/child", {
          formMethod: "post",
          formData: createFormData({}),
          replace: true,
        });

        await A.actions.child.redirectReturn(url);
        expect(t.window.location.replace).toHaveBeenCalledWith(url);
        expect(t.window.location.assign).not.toHaveBeenCalled();
      }
    });

    it("properly handles same-origin absolute URLs", async () => {
      let t = setup({ routes: REDIRECT_ROUTES });

      let A = await t.navigate("/parent/child", {
        formMethod: "post",
        formData: createFormData({}),
      });

      let B = await A.actions.child.redirectReturn(
        "http://localhost/parent",
        undefined,
        undefined,
        ["parent"]
      );
      await B.loaders.parent.resolve("PARENT");
      expect(t.router.state.location).toMatchObject({
        hash: "",
        pathname: "/parent",
        search: "",
        state: {
          _isRedirect: true,
        },
      });
    });

    it("properly handles same-origin absolute URLs when using a basename", async () => {
      let t = setup({ routes: REDIRECT_ROUTES, basename: "/base" });

      let A = await t.navigate("/base/parent/child", {
        formMethod: "post",
        formData: createFormData({}),
      });

      let B = await A.actions.child.redirectReturn(
        "http://localhost/base/parent",
        undefined,
        undefined,
        ["parent"]
      );
      await B.loaders.parent.resolve("PARENT");
      expect(t.router.state.location).toMatchObject({
        hash: "",
        pathname: "/base/parent",
        search: "",
        state: {
          _isRedirect: true,
        },
      });
    });

    it("treats same-origin absolute URLs as external if they don't match the basename", async () => {
      let t = setup({ routes: REDIRECT_ROUTES, basename: "/base" });

      let A = await t.navigate("/base/parent/child", {
        formMethod: "post",
        formData: createFormData({}),
      });

      let url = "http://localhost/not/the/same/basename";
      await A.actions.child.redirectReturn(url);
      expect(t.window.location.assign).toHaveBeenCalledWith(url);
      expect(t.window.location.replace).not.toHaveBeenCalled();
    });

    describe("redirect status code handling", () => {
      it("should not treat 300 as a redirect", async () => {
        let t = setup({ routes: REDIRECT_ROUTES });

        let A = await t.navigate("/parent");
        await A.loaders.parent.redirectReturn("/idk", 300);
        expect(t.router.state).toMatchObject({
          loaderData: {},
          location: {
            pathname: "/parent",
          },
          navigation: {
            state: "idle",
          },
        });
      });

      it("should not preserve the method on 301 redirects", async () => {
        let t = setup({ routes: REDIRECT_ROUTES });

        let A = await t.navigate("/parent/child", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        // Triggers a GET redirect
        let B = await A.actions.child.redirectReturn("/parent", 301);
        await B.loaders.parent.resolve("PARENT");
        expect(t.router.state).toMatchObject({
          loaderData: {
            parent: "PARENT",
          },
          location: {
            pathname: "/parent",
          },
          navigation: {
            state: "idle",
          },
        });
      });

      it("should not preserve the method on 302 redirects", async () => {
        let t = setup({ routes: REDIRECT_ROUTES });

        let A = await t.navigate("/parent/child", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        // Triggers a GET redirect
        let B = await A.actions.child.redirectReturn("/parent", 302);
        await B.loaders.parent.resolve("PARENT");
        expect(t.router.state).toMatchObject({
          loaderData: {
            parent: "PARENT",
          },
          location: {
            pathname: "/parent",
          },
          navigation: {
            state: "idle",
          },
        });
      });

      it("should not preserve the method on 303 redirects", async () => {
        let t = setup({ routes: REDIRECT_ROUTES });

        let A = await t.navigate("/parent/child", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        // Triggers a GET redirect
        let B = await A.actions.child.redirectReturn("/parent", 303);
        await B.loaders.parent.resolve("PARENT");
        expect(t.router.state).toMatchObject({
          loaderData: {
            parent: "PARENT",
          },
          location: {
            pathname: "/parent",
          },
          navigation: {
            state: "idle",
          },
        });
      });

      it("should not treat 304 as a redirect", async () => {
        let t = setup({ routes: REDIRECT_ROUTES });

        let A = await t.navigate("/parent");
        await A.loaders.parent.resolve(new Response(null, { status: 304 }));
        expect(t.router.state).toMatchObject({
          loaderData: {},
          location: {
            pathname: "/parent",
          },
          navigation: {
            state: "idle",
          },
        });
      });

      it("should preserve the method on 307 redirects", async () => {
        let t = setup({ routes: REDIRECT_ROUTES });

        let A = await t.navigate("/parent/child", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        // Triggers a POST redirect
        let B = await A.actions.child.redirectReturn("/parent", 307);
        await B.actions.parent.resolve("PARENT ACTION");
        await B.loaders.parent.resolve("PARENT");
        expect(t.router.state).toMatchObject({
          actionData: {
            parent: "PARENT ACTION",
          },
          loaderData: {
            parent: "PARENT",
          },
          location: {
            pathname: "/parent",
          },
          navigation: {
            state: "idle",
          },
        });

        let request = B.actions.parent.stub.mock.calls[0][0].request;
        expect(request.method).toBe("POST");
        let fd = await request.formData();
        expect(Array.from(fd.entries())).toEqual([["key", "value"]]);
      });

      it("should preserve the method on 308 redirects", async () => {
        let t = setup({ routes: REDIRECT_ROUTES });

        let A = await t.navigate("/parent/child", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        // Triggers a POST redirect
        let B = await A.actions.child.redirectReturn("/parent", 308);
        await B.actions.parent.resolve("PARENT ACTION");
        await B.loaders.parent.resolve("PARENT");
        expect(t.router.state).toMatchObject({
          actionData: {
            parent: "PARENT ACTION",
          },
          loaderData: {
            parent: "PARENT",
          },
          location: {
            pathname: "/parent",
          },
          navigation: {
            state: "idle",
          },
        });

        let request = B.actions.parent.stub.mock.calls[0][0].request;
        expect(request.method).toBe("POST");
        let fd = await request.formData();
        expect(Array.from(fd.entries())).toEqual([["key", "value"]]);
      });
    });
  });

  describe("scroll restoration", () => {
    // Version of TASK_ROUTES with no root loader to allow for initialized
    // hydrationData:null usage
    const SCROLL_ROUTES: TestRouteObject[] = [
      {
        path: "/",
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
          },
          {
            path: "no-loader",
          },
        ],
      },
    ];

    describe("scroll restoration", () => {
      it("restores scroll on initial load (w/o hydrationData)", async () => {
        let t = setup({
          routes: SCROLL_ROUTES,
          initialEntries: ["/no-loader"],
        });

        expect(t.router.state.restoreScrollPosition).toBe(null);
        expect(t.router.state.preventScrollReset).toBe(false);

        // Assume initial location had a saved position
        let positions = { default: 50 };
        t.router.enableScrollRestoration(positions, () => 0);
        expect(t.router.state.restoreScrollPosition).toBe(50);
      });

      it("restores scroll on initial load (w/ hydrationData)", async () => {
        let t = setup({
          routes: SCROLL_ROUTES,
          initialEntries: ["/"],
          hydrationData: {
            loaderData: {
              index: "INDEX",
            },
          },
        });

        expect(t.router.state.restoreScrollPosition).toBe(false);
        expect(t.router.state.preventScrollReset).toBe(false);

        // Assume initial location had a saved position
        let positions = { default: 50 };
        t.router.enableScrollRestoration(positions, () => 0);
        expect(t.router.state.restoreScrollPosition).toBe(false);
      });

      it("restores scroll on navigations", async () => {
        let t = setup({
          routes: SCROLL_ROUTES,
          initialEntries: ["/"],
          hydrationData: {
            loaderData: {
              index: "INDEX_DATA",
            },
          },
        });

        expect(t.router.state.restoreScrollPosition).toBe(false);
        expect(t.router.state.preventScrollReset).toBe(false);

        let positions = {};

        // Simulate scrolling to 100 on /
        let activeScrollPosition = 100;
        t.router.enableScrollRestoration(positions, () => activeScrollPosition);

        // No restoration on first click to /tasks
        let nav1 = await t.navigate("/tasks");
        await nav1.loaders.tasks.resolve("TASKS");
        expect(t.router.state.restoreScrollPosition).toBe(null);
        expect(t.router.state.preventScrollReset).toBe(false);

        // Simulate scrolling down on /tasks
        activeScrollPosition = 200;

        // Restore on pop back to /
        let nav2 = await t.navigate(-1);
        expect(t.router.state.restoreScrollPosition).toBe(null);
        await nav2.loaders.index.resolve("INDEX");
        expect(t.router.state.restoreScrollPosition).toBe(100);
        expect(t.router.state.preventScrollReset).toBe(false);

        // Restore on pop forward to /tasks
        let nav3 = await t.navigate(1);
        await nav3.loaders.tasks.resolve("TASKS");
        expect(t.router.state.restoreScrollPosition).toBe(200);
        expect(t.router.state.preventScrollReset).toBe(false);
      });

      it("restores scroll using custom key", async () => {
        let t = setup({
          routes: SCROLL_ROUTES,
          initialEntries: ["/"],
          hydrationData: {
            loaderData: {
              index: "INDEX_DATA",
            },
          },
        });

        expect(t.router.state.restoreScrollPosition).toBe(false);
        expect(t.router.state.preventScrollReset).toBe(false);

        let positions = { "/tasks": 100 };
        let activeScrollPosition = 0;
        t.router.enableScrollRestoration(
          positions,
          () => activeScrollPosition,
          (l) => l.pathname
        );

        let nav1 = await t.navigate("/tasks");
        await nav1.loaders.tasks.resolve("TASKS");
        expect(t.router.state.restoreScrollPosition).toBe(100);
        expect(t.router.state.preventScrollReset).toBe(false);
      });

      it("restores scroll on GET submissions", async () => {
        let t = setup({
          routes: SCROLL_ROUTES,
          initialEntries: ["/tasks"],
          hydrationData: {
            loaderData: {
              tasks: "TASKS",
            },
          },
        });

        expect(t.router.state.restoreScrollPosition).toBe(false);
        expect(t.router.state.preventScrollReset).toBe(false);
        // We were previously on tasks at 100
        let positions = { "/tasks": 100 };
        // But we've scrolled up to 50 to submit.  We'll save this overtop of
        // the 100 when we start this submission navigation and then restore to
        // 50 below
        let activeScrollPosition = 50;
        t.router.enableScrollRestoration(
          positions,
          () => activeScrollPosition,
          (l) => l.pathname
        );

        let nav1 = await t.navigate("/tasks", {
          formMethod: "get",
          formData: createFormData({ key: "value" }),
        });
        await nav1.loaders.tasks.resolve("TASKS2");
        expect(t.router.state.restoreScrollPosition).toBe(50);
        expect(t.router.state.preventScrollReset).toBe(false);
      });

      it("restores scroll on POST submissions", async () => {
        let t = setup({
          routes: SCROLL_ROUTES,
          initialEntries: ["/tasks"],
          hydrationData: {
            loaderData: {
              index: "INDEX_DATA",
            },
          },
        });

        expect(t.router.state.restoreScrollPosition).toBe(false);
        expect(t.router.state.preventScrollReset).toBe(false);
        // We were previously on tasks at 100
        let positions = { "/tasks": 100 };
        // But we've scrolled up to 50 to submit.  We'll save this overtop of
        // the 100 when we start this submission navigation and then restore to
        // 50 below
        let activeScrollPosition = 50;
        t.router.enableScrollRestoration(
          positions,
          () => activeScrollPosition,
          (l) => l.pathname
        );

        let nav1 = await t.navigate("/tasks", {
          formMethod: "post",
          formData: createFormData({}),
        });
        const nav2 = await nav1.actions.tasks.redirectReturn("/tasks");
        await nav2.loaders.tasks.resolve("TASKS");
        expect(t.router.state.restoreScrollPosition).toBe(50);
        expect(t.router.state.preventScrollReset).toBe(false);
      });
    });

    describe("scroll reset", () => {
      describe("default behavior", () => {
        it("resets on navigations", async () => {
          let t = setup({
            routes: SCROLL_ROUTES,
            initialEntries: ["/"],
            hydrationData: {
              loaderData: {
                index: "INDEX_DATA",
              },
            },
          });

          expect(t.router.state.restoreScrollPosition).toBe(false);
          expect(t.router.state.preventScrollReset).toBe(false);

          let positions = {};
          let activeScrollPosition = 0;
          t.router.enableScrollRestoration(
            positions,
            () => activeScrollPosition
          );

          let nav1 = await t.navigate("/tasks");
          await nav1.loaders.tasks.resolve("TASKS");
          expect(t.router.state.restoreScrollPosition).toBe(null);
          expect(t.router.state.preventScrollReset).toBe(false);
        });

        it("resets on navigations that redirect", async () => {
          let t = setup({
            routes: SCROLL_ROUTES,
            initialEntries: ["/"],
            hydrationData: {
              loaderData: {
                index: "INDEX_DATA",
              },
            },
          });

          expect(t.router.state.restoreScrollPosition).toBe(false);
          expect(t.router.state.preventScrollReset).toBe(false);

          let positions = {};
          let activeScrollPosition = 0;
          t.router.enableScrollRestoration(
            positions,
            () => activeScrollPosition
          );

          let nav1 = await t.navigate("/tasks");
          let nav2 = await nav1.loaders.tasks.redirectReturn("/");
          await nav2.loaders.index.resolve("INDEX_DATA 2");
          expect(t.router.state.restoreScrollPosition).toBe(null);
          expect(t.router.state.preventScrollReset).toBe(false);
        });

        it("does not reset on submission navigations", async () => {
          let t = setup({
            routes: SCROLL_ROUTES,
            initialEntries: ["/"],
            hydrationData: {
              loaderData: {
                index: "INDEX_DATA",
              },
            },
          });

          expect(t.router.state.restoreScrollPosition).toBe(false);
          expect(t.router.state.preventScrollReset).toBe(false);

          let positions = {};
          let activeScrollPosition = 0;
          t.router.enableScrollRestoration(
            positions,
            () => activeScrollPosition
          );

          let nav1 = await t.navigate("/tasks", {
            formMethod: "post",
            formData: createFormData({}),
          });
          await nav1.actions.tasks.resolve("ACTION");
          await nav1.loaders.tasks.resolve("TASKS");
          expect(t.router.state.restoreScrollPosition).toBe(null);
          expect(t.router.state.preventScrollReset).toBe(true);
        });

        it("resets on submission navigations that redirect", async () => {
          let t = setup({
            routes: SCROLL_ROUTES,
            initialEntries: ["/"],
            hydrationData: {
              loaderData: {
                index: "INDEX_DATA",
              },
            },
          });

          expect(t.router.state.restoreScrollPosition).toBe(false);
          expect(t.router.state.preventScrollReset).toBe(false);

          let positions = {};
          let activeScrollPosition = 0;
          t.router.enableScrollRestoration(
            positions,
            () => activeScrollPosition
          );

          let nav1 = await t.navigate("/tasks", {
            formMethod: "post",
            formData: createFormData({}),
          });
          let nav2 = await nav1.actions.tasks.redirectReturn("/");
          await nav2.loaders.index.resolve("INDEX_DATA2");
          expect(t.router.state.restoreScrollPosition).toBe(null);
          expect(t.router.state.preventScrollReset).toBe(false);
        });

        it("resets on fetch submissions that redirect", async () => {
          let t = setup({
            routes: SCROLL_ROUTES,
            initialEntries: ["/tasks"],
            hydrationData: {
              loaderData: {
                tasks: "TASKS",
              },
            },
          });

          expect(t.router.state.restoreScrollPosition).toBe(false);
          expect(t.router.state.preventScrollReset).toBe(false);

          let positions = {};
          let activeScrollPosition = 0;
          t.router.enableScrollRestoration(
            positions,
            () => activeScrollPosition
          );

          let nav1 = await t.fetch("/tasks", {
            formMethod: "post",
            formData: createFormData({}),
          });
          let nav2 = await nav1.actions.tasks.redirectReturn("/tasks");
          await nav2.loaders.tasks.resolve("TASKS 2");
          expect(t.router.state.restoreScrollPosition).toBe(null);
          expect(t.router.state.preventScrollReset).toBe(false);
        });
      });

      describe("user-specified flag preventScrollReset flag", () => {
        it("prevents scroll reset on navigations", async () => {
          let t = setup({
            routes: SCROLL_ROUTES,
            initialEntries: ["/"],
            hydrationData: {
              loaderData: {
                index: "INDEX_DATA",
              },
            },
          });

          expect(t.router.state.restoreScrollPosition).toBe(false);
          expect(t.router.state.preventScrollReset).toBe(false);

          let positions = {};
          let activeScrollPosition = 0;
          t.router.enableScrollRestoration(
            positions,
            () => activeScrollPosition
          );

          let nav1 = await t.navigate("/tasks", { preventScrollReset: true });
          await nav1.loaders.tasks.resolve("TASKS");
          expect(t.router.state.restoreScrollPosition).toBe(null);
          expect(t.router.state.preventScrollReset).toBe(true);
        });

        it("prevents scroll reset on navigations that redirect", async () => {
          let t = setup({
            routes: SCROLL_ROUTES,
            initialEntries: ["/"],
            hydrationData: {
              loaderData: {
                index: "INDEX_DATA",
              },
            },
          });

          expect(t.router.state.restoreScrollPosition).toBe(false);
          expect(t.router.state.preventScrollReset).toBe(false);

          let positions = {};
          let activeScrollPosition = 0;
          t.router.enableScrollRestoration(
            positions,
            () => activeScrollPosition
          );

          let nav1 = await t.navigate("/tasks", { preventScrollReset: true });
          let nav2 = await nav1.loaders.tasks.redirectReturn("/");
          await nav2.loaders.index.resolve("INDEX_DATA 2");
          expect(t.router.state.restoreScrollPosition).toBe(null);
          expect(t.router.state.preventScrollReset).toBe(true);
        });

        it("prevents scroll reset on submission navigations", async () => {
          let t = setup({
            routes: SCROLL_ROUTES,
            initialEntries: ["/"],
            hydrationData: {
              loaderData: {
                index: "INDEX_DATA",
              },
            },
          });

          expect(t.router.state.restoreScrollPosition).toBe(false);
          expect(t.router.state.preventScrollReset).toBe(false);

          let positions = {};
          let activeScrollPosition = 0;
          t.router.enableScrollRestoration(
            positions,
            () => activeScrollPosition
          );

          let nav1 = await t.navigate("/tasks", {
            formMethod: "post",
            formData: createFormData({}),
            preventScrollReset: true,
          });
          await nav1.actions.tasks.resolve("ACTION");
          await nav1.loaders.tasks.resolve("TASKS");
          expect(t.router.state.restoreScrollPosition).toBe(null);
          expect(t.router.state.preventScrollReset).toBe(true);
        });

        it("prevents scroll reset on submission navigations that redirect", async () => {
          let t = setup({
            routes: SCROLL_ROUTES,
            initialEntries: ["/"],
            hydrationData: {
              loaderData: {
                index: "INDEX_DATA",
              },
            },
          });

          expect(t.router.state.restoreScrollPosition).toBe(false);
          expect(t.router.state.preventScrollReset).toBe(false);

          let positions = {};
          let activeScrollPosition = 0;
          t.router.enableScrollRestoration(
            positions,
            () => activeScrollPosition
          );

          let nav1 = await t.navigate("/tasks", {
            formMethod: "post",
            formData: createFormData({}),
            preventScrollReset: true,
          });
          let nav2 = await nav1.actions.tasks.redirectReturn("/");
          await nav2.loaders.index.resolve("INDEX_DATA2");
          expect(t.router.state.restoreScrollPosition).toBe(null);
          expect(t.router.state.preventScrollReset).toBe(true);
        });

        it("prevents scroll reset on fetch submissions that redirect", async () => {
          let t = setup({
            routes: SCROLL_ROUTES,
            initialEntries: ["/tasks"],
            hydrationData: {
              loaderData: {
                tasks: "TASKS",
              },
            },
          });

          expect(t.router.state.restoreScrollPosition).toBe(false);
          expect(t.router.state.preventScrollReset).toBe(false);

          let positions = {};
          let activeScrollPosition = 0;
          t.router.enableScrollRestoration(
            positions,
            () => activeScrollPosition
          );

          let nav1 = await t.fetch("/tasks", {
            formMethod: "post",
            formData: createFormData({}),
            preventScrollReset: true,
          });
          let nav2 = await nav1.actions.tasks.redirectReturn("/tasks");
          await nav2.loaders.tasks.resolve("TASKS 2");
          expect(t.router.state.restoreScrollPosition).toBe(null);
          expect(t.router.state.preventScrollReset).toBe(true);
        });
      });
    });
  });

  describe("router.revalidate", () => {
    it("handles uninterrupted revalidation in an idle state (from POP)", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let key = t.router.state.location.key;
      let R = await t.revalidate();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      await R.loaders.root.resolve("ROOT_DATA*");
      await R.loaders.index.resolve("INDEX_DATA*");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA*",
          index: "INDEX_DATA*",
        },
      });
      expect(t.router.state.location.key).toBe(key);
      expect(t.history.push).not.toHaveBeenCalled();
      expect(t.history.replace).not.toHaveBeenCalled();
    });

    it("handles uninterrupted revalidation in an idle state (from PUSH)", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let N = await t.navigate("/");
      await N.loaders.root.resolve("ROOT_DATA");
      await N.loaders.index.resolve("INDEX_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });
      // @ts-expect-error
      expect(t.history.push.mock.calls.length).toBe(1);

      let key = t.router.state.location.key;
      let R = await t.revalidate();
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      await R.loaders.root.resolve("ROOT_DATA*");
      await R.loaders.index.resolve("INDEX_DATA*");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA*",
          index: "INDEX_DATA*",
        },
      });
      expect(t.router.state.location.key).toBe(key);
      // @ts-ignore
      expect(t.history.push.mock.calls.length).toBe(1);
      expect(t.history.replace).not.toHaveBeenCalled();
    });

    it("handles revalidation when a hash is present", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/#hash"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let key = t.router.state.location.key;
      let R = await t.revalidate();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      await R.loaders.root.resolve("ROOT_DATA*");
      await R.loaders.index.resolve("INDEX_DATA*");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA*",
          index: "INDEX_DATA*",
        },
      });
      expect(t.router.state.location.hash).toBe("#hash");
      expect(t.router.state.location.key).toBe(key);
      expect(t.history.push).not.toHaveBeenCalled();
      expect(t.history.replace).not.toHaveBeenCalled();
    });

    it("handles revalidation interrupted by a <Link> navigation", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let R = await t.revalidate();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      let N = await t.navigate("/tasks");
      // Revalidation was aborted
      expect(R.loaders.root.signal.aborted).toBe(true);
      expect(R.loaders.index.signal.aborted).toBe(true);
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: {
          state: "loading",
          location: { pathname: "/tasks" },
        },
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      // Land the revalidation calls - should no-op
      await R.loaders.root.resolve("ROOT_DATA interrupted");
      await R.loaders.index.resolve("INDEX_DATA interrupted");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: {
          state: "loading",
          location: { pathname: "/tasks" },
        },
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      // Land the navigation calls - should update state and end the revalidation
      await N.loaders.root.resolve("ROOT_DATA*");
      await N.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/tasks" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA*",
          tasks: "TASKS_DATA",
        },
      });
      expect(t.history.push).toHaveBeenCalledWith(
        t.router.state.location,
        t.router.state.location.state
      );
    });

    it("handles revalidation interrupted by a <Form method=get> navigation", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let R = await t.revalidate();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      let N = await t.navigate("/tasks", {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: {
          state: "loading",
          location: {
            pathname: "/tasks",
            search: "?key=value",
          },
          formMethod: "get",
          formData: createFormData({ key: "value" }),
        },
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });
      await R.loaders.root.resolve("ROOT_DATA interrupted");
      await R.loaders.index.resolve("INDEX_DATA interrupted");
      await N.loaders.root.resolve("ROOT_DATA*");
      await N.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/tasks" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA*",
          tasks: "TASKS_DATA",
        },
      });
      expect(t.history.push).toHaveBeenCalledWith(
        t.router.state.location,
        t.router.state.location.state
      );
    });

    it("handles revalidation interrupted by a <Form method=post> navigation", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let R = await t.revalidate();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      let N = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: {
          state: "submitting",
          location: { pathname: "/tasks" },
        },
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      // Aborted by the navigation, resolving should no-op
      expect(R.loaders.root.signal.aborted).toBe(true);
      expect(R.loaders.index.signal.aborted).toBe(true);
      await R.loaders.root.resolve("ROOT_DATA interrupted");
      await R.loaders.index.resolve("INDEX_DATA interrupted");

      await N.actions.tasks.resolve("TASKS_ACTION");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: {
          state: "loading",
          location: { pathname: "/tasks" },
        },
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      await N.loaders.root.resolve("ROOT_DATA*");
      await N.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/tasks" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA*",
          tasks: "TASKS_DATA",
        },
        actionData: {
          tasks: "TASKS_ACTION",
        },
      });
      expect(t.history.push).toHaveBeenCalledWith(
        t.router.state.location,
        t.router.state.location.state
      );
    });

    it("handles <Link> navigation interrupted by a revalidation", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let N = await t.navigate("/tasks");
      expect(N.loaders.root.stub).not.toHaveBeenCalled();
      expect(N.loaders.tasks.stub).toHaveBeenCalled();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: { state: "loading" },
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      let R = await t.revalidate();
      expect(R.loaders.root.stub).toHaveBeenCalled();
      expect(R.loaders.tasks.stub).toHaveBeenCalled();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: { state: "loading" },
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      await N.loaders.tasks.resolve("TASKS_DATA interrupted");
      await R.loaders.root.resolve("ROOT_DATA*");
      await R.loaders.tasks.resolve("TASKS_DATA*");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/tasks" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA*",
          tasks: "TASKS_DATA*",
        },
      });
      expect(t.history.push).toHaveBeenCalledWith(
        t.router.state.location,
        t.router.state.location.state
      );
    });

    it("handles <Form method=get> navigation interrupted by a revalidation", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let N = await t.navigate("/tasks", {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });
      // Called due to search param changing
      expect(N.loaders.root.stub).toHaveBeenCalled();
      expect(N.loaders.tasks.stub).toHaveBeenCalled();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: {
          state: "loading",
          location: {
            pathname: "/tasks",
            search: "?key=value",
          },
        },
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      let R = await t.revalidate();
      expect(R.loaders.root.stub).toHaveBeenCalled();
      expect(R.loaders.tasks.stub).toHaveBeenCalled();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: {
          state: "loading",
          location: {
            pathname: "/tasks",
            search: "?key=value",
          },
        },
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      await N.loaders.root.resolve("ROOT_DATA interrupted");
      await N.loaders.tasks.resolve("TASKS_DATA interrupted");
      await R.loaders.root.resolve("ROOT_DATA*");
      await R.loaders.tasks.resolve("TASKS_DATA*");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/tasks" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA*",
          tasks: "TASKS_DATA*",
        },
      });
      expect(t.history.push).toHaveBeenCalledWith(
        t.router.state.location,
        t.router.state.location.state
      );
    });

    it("handles <Form method=post> navigation interrupted by a revalidation during action phase", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let N = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: { state: "submitting" },
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      let R = await t.revalidate();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: { state: "submitting" },
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      await N.actions.tasks.resolve("TASKS_ACTION");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: { state: "loading" },
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
        actionData: {
          tasks: "TASKS_ACTION",
        },
      });

      await N.loaders.root.resolve("ROOT_DATA interrupted");
      await N.loaders.tasks.resolve("TASKS_DATA interrupted");
      await R.loaders.root.resolve("ROOT_DATA*");
      await R.loaders.tasks.resolve("TASKS_DATA*");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/tasks" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA*",
          tasks: "TASKS_DATA*",
        },
      });
      expect(t.history.push).toHaveBeenCalledWith(
        t.router.state.location,
        t.router.state.location.state
      );

      // Action was not resubmitted
      expect(N.actions.tasks.stub.mock.calls.length).toBe(1);
      // This is sort of an implementation detail.  Internally we do not start
      // a new navigation, but our helpers return the new "loaders" from the
      // revalidate.  The key here is that together, loaders only got called once
      expect(N.loaders.root.stub.mock.calls.length).toBe(0);
      expect(N.loaders.tasks.stub.mock.calls.length).toBe(0);
      expect(R.loaders.root.stub.mock.calls.length).toBe(1);
      expect(R.loaders.tasks.stub.mock.calls.length).toBe(1);
    });

    it("handles <Form method=post> navigation interrupted by a revalidation during loading phase", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let N = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: { state: "submitting" },
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      await N.actions.tasks.resolve("TASKS_ACTION");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: { state: "loading" },
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
        actionData: {
          tasks: "TASKS_ACTION",
        },
      });

      let R = await t.revalidate();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: { state: "loading" },
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
        actionData: {
          tasks: "TASKS_ACTION",
        },
      });

      await N.loaders.root.resolve("ROOT_DATA interrupted");
      await N.loaders.tasks.resolve("TASKS_DATA interrupted");
      await R.loaders.root.resolve("ROOT_DATA*");
      await R.loaders.tasks.resolve("TASKS_DATA*");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/tasks" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA*",
          tasks: "TASKS_DATA*",
        },
        actionData: {
          tasks: "TASKS_ACTION",
        },
      });
      expect(t.history.push).toHaveBeenCalledWith(
        t.router.state.location,
        t.router.state.location.state
      );

      // Action was not resubmitted
      expect(N.actions.tasks.stub.mock.calls.length).toBe(1);
      // Because we interrupted during the loading phase, all loaders got re-called
      expect(N.loaders.root.stub.mock.calls.length).toBe(1);
      expect(N.loaders.tasks.stub.mock.calls.length).toBe(1);
      expect(R.loaders.root.stub.mock.calls.length).toBe(1);
      expect(R.loaders.tasks.stub.mock.calls.length).toBe(1);
    });

    it("handles redirects returned from revalidations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let key = t.router.state.location.key;
      let R = await t.revalidate();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      await R.loaders.root.resolve("ROOT_DATA*");
      let N = await R.loaders.index.redirectReturn("/tasks");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: {
          state: "loading",
        },
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });
      expect(t.router.state.location.key).toBe(key);

      await N.loaders.root.resolve("ROOT_DATA redirect");
      await N.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/tasks" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA redirect",
          tasks: "TASKS_DATA",
        },
      });
      expect(t.router.state.location.key).not.toBe(key);

      let B = await t.navigate(-1);
      await B.loaders.index.resolve("INDEX_DATA 2");
      // PUSH on the revalidation redirect means back button takes us back to
      // the page that triggered the revalidation redirect
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA redirect",
          index: "INDEX_DATA 2",
        },
      });
      expect(t.router.state.location.key).toBe(key);
    });

    it("handles errors from revalidations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let key = t.router.state.location.key;
      let R = await t.revalidate();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      await R.loaders.root.reject("ROOT_ERROR");
      await R.loaders.index.resolve("INDEX_DATA*");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: undefined,
          index: "INDEX_DATA*",
        },
        errors: {
          root: "ROOT_ERROR",
        },
      });
      expect(t.router.state.location.key).toBe(key);
    });

    it("leverages shouldRevalidate on revalidation routes", async () => {
      let shouldRevalidate = jest.fn(({ nextUrl }) => {
        return nextUrl.searchParams.get("reload") === "1";
      });
      let t = setup({
        routes: [
          {
            id: "root",
            loader: true,
            shouldRevalidate: (...args) => shouldRevalidate(...args),
            children: [
              {
                id: "index",
                index: true,
                loader: true,
                shouldRevalidate: (...args) => shouldRevalidate(...args),
              },
            ],
          },
        ],
        initialEntries: ["/?reload=0"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let R = await t.revalidate();
      expect(R.loaders.root.stub).not.toHaveBeenCalled();
      expect(R.loaders.index.stub).not.toHaveBeenCalled();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });

      let N = await t.navigate("/?reload=1");
      await N.loaders.root.resolve("ROOT_DATA*");
      await N.loaders.index.resolve("INDEX_DATA*");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA*",
          index: "INDEX_DATA*",
        },
      });

      let R2 = await t.revalidate();
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "loading",
        loaderData: {
          root: "ROOT_DATA*",
          index: "INDEX_DATA*",
        },
      });

      await R2.loaders.root.resolve("ROOT_DATA**");
      await R2.loaders.index.resolve("INDEX_DATA**");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: { pathname: "/" },
        navigation: IDLE_NAVIGATION,
        revalidation: "idle",
        loaderData: {
          root: "ROOT_DATA**",
          index: "INDEX_DATA**",
        },
      });
    });

    it("triggers revalidation on fetcher loads", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let key = "key";
      let F = await t.fetch("/", key);
      await F.loaders.root.resolve("ROOT_DATA*");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "ROOT_DATA*",
      });

      let R = await t.revalidate();
      await R.loaders.root.resolve("ROOT_DATA**");
      await R.loaders.index.resolve("INDEX_DATA");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "ROOT_DATA**",
      });
    });
  });

  describe("router.dispose", () => {
    it("should cancel pending navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      let A = await t.navigate("/tasks");
      expect(t.router.state.navigation.state).toBe("loading");

      currentRouter?.dispose();
      expect(A.loaders.tasks.signal.aborted).toBe(true);
    });

    it("should cancel pending fetchers", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      let A = await t.fetch("/tasks");
      let B = await t.fetch("/tasks");

      currentRouter?.dispose();
      expect(A.loaders.tasks.signal.aborted).toBe(true);
      expect(B.loaders.tasks.signal.aborted).toBe(true);
    });
  });

  describe("fetchers", () => {
    describe("fetcher states", () => {
      it("unabstracted loader fetch", async () => {
        let dfd = createDeferred();
        let router = createRouter({
          history: createMemoryHistory({ initialEntries: ["/"] }),
          routes: [
            {
              id: "root",
              path: "/",
              loader: () => dfd.promise,
            },
          ],
          hydrationData: {
            loaderData: { root: "ROOT DATA" },
          },
        });

        let key = "key";
        router.fetch(key, "root", "/");
        expect(router.state.fetchers.get(key)).toEqual({
          state: "loading",
          formMethod: undefined,
          formEncType: undefined,
          formData: undefined,
          data: undefined,
          " _hasFetcherDoneAnything ": true,
        });

        await dfd.resolve("DATA");
        expect(router.state.fetchers.get(key)).toEqual({
          state: "idle",
          formMethod: undefined,
          formEncType: undefined,
          formData: undefined,
          data: "DATA",
          " _hasFetcherDoneAnything ": true,
        });

        expect(router._internalFetchControllers.size).toBe(0);
      });

      it("loader fetch", async () => {
        let t = initializeTmTest({ url: "/foo" });

        let A = await t.fetch("/foo");
        expect(A.fetcher.state).toBe("loading");

        await A.loaders.foo.resolve("A DATA");
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("A DATA");
      });

      it("loader re-fetch", async () => {
        let t = initializeTmTest({ url: "/foo" });
        let key = "key";

        let A = await t.fetch("/foo", key);
        await A.loaders.foo.resolve("A DATA");
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("A DATA");

        let B = await t.fetch("/foo", key);
        expect(B.fetcher.state).toBe("loading");
        expect(B.fetcher.data).toBe("A DATA");

        await B.loaders.foo.resolve("B DATA");
        expect(B.fetcher.state).toBe("idle");
        expect(B.fetcher.data).toBe("B DATA");

        expect(A.fetcher).toBe(B.fetcher);
      });

      it("loader submission fetch", async () => {
        let t = initializeTmTest({ url: "/foo" });

        let A = await t.fetch("/foo", {
          formMethod: "get",
          formData: createFormData({ key: "value" }),
        });
        expect(A.fetcher.state).toBe("loading");
        expect(A.fetcher.formMethod).toBe("get");
        expect(A.fetcher.formAction).toBe("/foo");
        expect(A.fetcher.formData).toEqual(createFormData({ key: "value" }));
        expect(A.fetcher.formEncType).toBe("application/x-www-form-urlencoded");
        expect(
          new URL(
            A.loaders.foo.stub.mock.calls[0][0].request.url
          ).searchParams.toString()
        ).toBe("key=value");

        await A.loaders.foo.resolve("A DATA");
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("A DATA");
      });

      it("loader submission re-fetch", async () => {
        let t = initializeTmTest({ url: "/foo" });
        let key = "key";

        let A = await t.fetch("/foo", key, {
          formMethod: "get",
          formData: createFormData({ key: "value" }),
        });
        expect(A.fetcher.state).toBe("loading");
        await A.loaders.foo.resolve("A DATA");
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("A DATA");

        let B = await t.fetch("/foo", key, {
          formMethod: "get",
          formData: createFormData({ key: "value" }),
        });
        expect(B.fetcher.state).toBe("loading");
        expect(B.fetcher.data).toBe("A DATA");

        await B.loaders.foo.resolve("B DATA");
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("B DATA");
      });

      it("action fetch", async () => {
        let t = initializeTmTest({ url: "/foo" });

        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        expect(A.fetcher.state).toBe("submitting");

        await A.actions.foo.resolve("A ACTION");
        expect(A.fetcher.state).toBe("loading");
        expect(A.fetcher.data).toBe("A ACTION");

        await A.loaders.root.resolve("ROOT DATA");
        expect(A.fetcher.state).toBe("loading");
        expect(A.fetcher.data).toBe("A ACTION");

        await A.loaders.foo.resolve("A DATA");
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("A ACTION");
        expect(t.router.state.loaderData).toEqual({
          root: "ROOT DATA",
          foo: "A DATA",
        });
      });

      it("action re-fetch", async () => {
        let t = initializeTmTest({ url: "/foo" });
        let key = "key";

        let A = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        expect(A.fetcher.state).toBe("submitting");

        await A.actions.foo.resolve("A ACTION");
        expect(A.fetcher.state).toBe("loading");
        expect(A.fetcher.data).toBe("A ACTION");

        await A.loaders.root.resolve("ROOT DATA");
        await A.loaders.foo.resolve("A DATA");
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("A ACTION");

        let B = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        expect(B.fetcher.state).toBe("submitting");
        expect(B.fetcher.data).toBe("A ACTION");

        await B.actions.foo.resolve("B ACTION");
        await B.loaders.root.resolve("ROOT DATA*");
        await B.loaders.foo.resolve("A DATA*");
        expect(B.fetcher.state).toBe("idle");
        expect(B.fetcher.data).toBe("B ACTION");
      });
    });

    describe("fetcher removal", () => {
      it("gives an idle fetcher before submission", async () => {
        let t = initializeTmTest();
        let fetcher = t.router.getFetcher("randomKey");
        expect(fetcher).toBe(IDLE_FETCHER);
      });

      it("removes fetchers", async () => {
        let t = initializeTmTest();
        let A = await t.fetch("/foo");
        await A.loaders.foo.resolve("A");
        expect(t.router.getFetcher(A.key).data).toBe("A");

        t.router.deleteFetcher(A.key);
        expect(t.router.getFetcher(A.key)).toBe(IDLE_FETCHER);
      });

      it("cleans up abort controllers", async () => {
        let t = initializeTmTest();
        let A = await t.fetch("/foo");
        expect(t.router._internalFetchControllers.size).toBe(1);
        let B = await t.fetch("/bar");
        expect(t.router._internalFetchControllers.size).toBe(2);
        await A.loaders.foo.resolve(null);
        expect(t.router._internalFetchControllers.size).toBe(1);
        await B.loaders.bar.resolve(null);
        expect(t.router._internalFetchControllers.size).toBe(0);
      });

      it("uses current page matches and URL when reloading routes after submissions", async () => {
        let pagePathname = "/foo";
        let t = initializeTmTest({
          url: pagePathname,
          hydrationData: {
            loaderData: { root: "ROOT", foo: "FOO" },
          },
        });

        let A = await t.fetch("/bar", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.bar.resolve("ACTION");
        await A.loaders.root.resolve("ROOT DATA");
        await A.loaders.foo.resolve("FOO DATA");
        expect(t.router.state.loaderData).toEqual({
          root: "ROOT DATA",
          foo: "FOO DATA",
        });
        expect(A.loaders.root.stub).toHaveBeenCalledWith({
          params: {},
          request: new Request("http://localhost/foo", {
            signal: A.loaders.root.stub.mock.calls[0][0].request.signal,
          }),
        });
      });
    });

    describe("fetcher error states (4xx Response)", () => {
      it("loader fetch", async () => {
        let t = initializeTmTest();
        let A = await t.fetch("/foo");
        await A.loaders.foo.reject(new Response(null, { status: 400 }));
        expect(A.fetcher).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          root: new ErrorResponse(400, undefined, ""),
        });
      });

      it("loader submission fetch", async () => {
        let t = initializeTmTest();
        let A = await t.fetch("/foo?key=value", {
          formMethod: "get",
          formData: createFormData({ key: "value" }),
        });
        await A.loaders.foo.reject(new Response(null, { status: 400 }));
        expect(A.fetcher).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          root: new ErrorResponse(400, undefined, ""),
        });
      });

      it("action fetch", async () => {
        let t = initializeTmTest();
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.reject(new Response(null, { status: 400 }));
        expect(A.fetcher).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          root: new ErrorResponse(400, undefined, ""),
        });
      });

      it("action fetch without action handler", async () => {
        let t = setup({
          routes: [
            {
              id: "root",
              path: "/",
              hasErrorBoundary: true,
              children: [
                {
                  id: "index",
                  index: true,
                },
              ],
            },
          ],
        });
        let A = await t.fetch("/", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        expect(A.fetcher).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          root: new ErrorResponse(
            405,
            "Method Not Allowed",
            new Error(
              'You made a POST request to "/" but did not provide an `action` ' +
                'for route "root", so there is no way to handle the request.'
            ),
            true
          ),
        });
      });

      it("handles fetcher errors at contextual route boundaries", async () => {
        let t = setup({
          routes: [
            {
              id: "root",
              path: "/",
              hasErrorBoundary: true,
              children: [
                {
                  id: "wit",
                  path: "wit",
                  loader: true,
                  hasErrorBoundary: true,
                },
                {
                  id: "witout",
                  path: "witout",
                  loader: true,
                },
                {
                  id: "error",
                  path: "error",
                  loader: true,
                },
              ],
            },
          ],
        });

        // If the routeId is not an active match, errors bubble to the root
        let A = await t.fetch("/error", "key1", "wit");
        await A.loaders.error.reject(new Error("Kaboom!"));
        expect(t.router.getFetcher("key1")).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          root: new Error("Kaboom!"),
        });

        await t.fetch("/not-found", "key2", "wit");
        expect(t.router.getFetcher("key2")).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          root: new ErrorResponse(
            404,
            "Not Found",
            new Error('No route matches URL "/not-found"'),
            true
          ),
        });

        // Navigate to /wit and trigger errors, handled at the wit boundary
        let B = await t.navigate("/wit");
        await B.loaders.wit.resolve("WIT");

        let C = await t.fetch("/error", "key3", "wit");
        await C.loaders.error.reject(new Error("Kaboom!"));
        expect(t.router.getFetcher("key3")).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          wit: new Error("Kaboom!"),
        });

        await t.fetch("/not-found", "key4", "wit", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        expect(t.router.getFetcher("key4")).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          wit: new ErrorResponse(
            404,
            "Not Found",
            new Error('No route matches URL "/not-found"'),
            true
          ),
        });

        await t.fetch("/not-found", "key5", "wit");
        expect(t.router.getFetcher("key5")).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          wit: new ErrorResponse(
            404,
            "Not Found",
            new Error('No route matches URL "/not-found"'),
            true
          ),
        });

        // Navigate to /witout and fetch a 404, handled at the root boundary
        let D = await t.navigate("/witout");
        await D.loaders.witout.resolve("WITOUT");

        let E = await t.fetch("/error", "key6", "witout");
        await E.loaders.error.reject(new Error("Kaboom!"));
        expect(t.router.getFetcher("key6")).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          root: new Error("Kaboom!"),
        });

        await t.fetch("/not-found", "key7", "witout");
        expect(t.router.getFetcher("key7")).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          root: new ErrorResponse(
            404,
            "Not Found",
            new Error('No route matches URL "/not-found"'),
            true
          ),
        });
      });
    });

    describe("fetcher error states (Error)", () => {
      it("loader fetch", async () => {
        let t = initializeTmTest();
        let A = await t.fetch("/foo");
        await A.loaders.foo.reject(new Error("Kaboom!"));
        expect(A.fetcher).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          root: new Error("Kaboom!"),
        });
      });

      it("loader submission fetch", async () => {
        let t = initializeTmTest();
        let A = await t.fetch("/foo?key=value", {
          formMethod: "get",
          formData: createFormData({ key: "value" }),
        });
        await A.loaders.foo.reject(new Error("Kaboom!"));
        expect(A.fetcher).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          root: new Error("Kaboom!"),
        });
      });

      it("action fetch", async () => {
        let t = initializeTmTest();
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.reject(new Error("Kaboom!"));
        expect(A.fetcher).toBe(IDLE_FETCHER);
        expect(t.router.state.errors).toEqual({
          root: new Error("Kaboom!"),
        });
      });
    });

    describe("fetcher redirects", () => {
      it("loader fetch", async () => {
        let t = initializeTmTest();
        let key = t.router.state.location.key;

        let A = await t.fetch("/foo");

        let B = await A.loaders.foo.redirect("/bar");
        expect(t.router.getFetcher(A.key)).toBe(A.fetcher);
        expect(t.router.state.navigation.state).toBe("loading");
        expect(t.router.state.navigation.location?.pathname).toBe("/bar");

        await B.loaders.bar.resolve("BAR");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.historyAction).toBe("PUSH");
        expect(t.router.state.location?.pathname).toBe("/bar");

        // Back button should take us back to location that triggered the fetch
        // redirect
        let C = await t.navigate(-1);
        await C.loaders.index.resolve("INDEX");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.location.key).toBe(key);
      });

      it("loader submission fetch", async () => {
        let t = initializeTmTest();
        let key = t.router.state.location.key;
        let A = await t.fetch("/foo?key=value", {
          formMethod: "get",
          formData: createFormData({ key: "value" }),
        });

        let B = await A.loaders.foo.redirect("/bar");
        expect(t.router.getFetcher(A.key)).toBe(A.fetcher);
        expect(t.router.state.navigation.state).toBe("loading");
        expect(t.router.state.navigation.location?.pathname).toBe("/bar");

        await B.loaders.bar.resolve("BAR");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.historyAction).toBe("PUSH");
        expect(t.router.state.location?.pathname).toBe("/bar");

        // Back button should take us back to location that triggered the fetch
        // redirect
        let C = await t.navigate(-1);
        await C.loaders.index.resolve("INDEX");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.location.key).toBe(key);
      });

      it("action fetch", async () => {
        let t = initializeTmTest();
        let key = t.router.state.location.key;

        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        expect(A.fetcher.state).toBe("submitting");
        let AR = await A.actions.foo.redirect("/bar");
        expect(A.fetcher.state).toBe("loading");
        expect(t.router.state.navigation).toMatchObject({
          state: "loading",
          location: {
            pathname: "/bar",
          },
          // Fetcher action redirect should not proxy the fetcher submission
          // onto the loading navigation
          formAction: undefined,
          formData: undefined,
          formEncType: undefined,
          formMethod: undefined,
        });
        await AR.loaders.root.resolve("ROOT*");
        await AR.loaders.bar.resolve("stuff");
        expect(A.fetcher).toEqual({
          data: undefined,
          state: "idle",
          formMethod: undefined,
          formAction: undefined,
          formEncType: undefined,
          formData: undefined,
          " _hasFetcherDoneAnything ": true,
        });
        expect(t.router.state.historyAction).toBe("PUSH");
        expect(t.router.state.location.pathname).toBe("/bar");
        // Root loader should be re-called after fetchActionRedirect
        expect(t.router.state.loaderData).toEqual({
          root: "ROOT*",
          bar: "stuff",
        });

        // Back button should take us back to location that triggered the fetch
        // redirect
        let C = await t.navigate(-1);
        await C.loaders.index.resolve("INDEX");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.location.key).toBe(key);
      });
    });

    describe("fetcher resubmissions/re-gets", () => {
      it("aborts re-gets", async () => {
        let t = initializeTmTest();
        let key = "KEY";
        let A = await t.fetch("/foo", key);
        let B = await t.fetch("/foo", key);
        await A.loaders.foo.resolve(null);
        let C = await t.fetch("/foo", key);
        await B.loaders.foo.resolve(null);
        await C.loaders.foo.resolve(null);
        expect(A.loaders.foo.signal.aborted).toBe(true);
        expect(B.loaders.foo.signal.aborted).toBe(true);
        expect(C.loaders.foo.signal.aborted).toBe(false);
      });

      it("aborts re-get-submissions", async () => {
        let t = initializeTmTest();
        let key = "KEY";
        let A = await t.fetch("/foo", key, {
          formMethod: "get",
          formData: createFormData({ key: "value" }),
        });
        let B = await t.fetch("/foo", key, {
          formMethod: "get",
          formData: createFormData({ key: "value" }),
        });
        let C = await t.fetch("/foo", key);
        expect(A.loaders.foo.signal.aborted).toBe(true);
        expect(B.loaders.foo.signal.aborted).toBe(true);
        await C.loaders.foo.resolve(null);
      });

      it("aborts resubmissions action call", async () => {
        let t = initializeTmTest();
        let key = "KEY";
        let A = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let B = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let C = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        expect(A.actions.foo.signal.aborted).toBe(true);
        expect(B.actions.foo.signal.aborted).toBe(true);
        await C.actions.foo.resolve(null);
        await C.loaders.root.resolve(null);
        await C.loaders.index.resolve(null);
      });

      it("aborts resubmissions loader call", async () => {
        let t = initializeTmTest({ url: "/foo" });
        let key = "KEY";
        let A = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.resolve("A ACTION");
        let C = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        expect(A.loaders.foo.signal.aborted).toBe(true);
        await C.actions.foo.resolve(null);
        await C.loaders.root.resolve(null);
        await C.loaders.foo.resolve(null);
      });

      describe(`
        A) POST |--|--XXX
        B) POST       |----XXX|XXX
        C) POST            |----|---O
      `, () => {
        it("aborts A load, ignores A resolve, aborts B action", async () => {
          let t = initializeTmTest({ url: "/foo" });
          let key = "KEY";

          let A = await t.fetch("/foo", key, {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await A.actions.foo.resolve("A ACTION");
          expect(t.router.getFetcher(key).data).toBe("A ACTION");

          let B = await t.fetch("/foo", key, {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          expect(A.loaders.foo.signal.aborted).toBe(true);
          expect(t.router.getFetcher(key).data).toBe("A ACTION");

          await A.loaders.root.resolve("A ROOT LOADER");
          await A.loaders.foo.resolve("A LOADER");
          expect(t.router.state.loaderData.foo).toBeUndefined();

          let C = await t.fetch("/foo", key, {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          expect(B.actions.foo.signal.aborted).toBe(true);

          await B.actions.foo.resolve("B ACTION");
          expect(t.router.getFetcher(key).data).toBe("A ACTION");

          await C.actions.foo.resolve("C ACTION");
          expect(t.router.getFetcher(key).data).toBe("C ACTION");

          await B.loaders.root.resolve("B ROOT LOADER");
          await B.loaders.foo.resolve("B LOADER");
          expect(t.router.state.loaderData.foo).toBeUndefined();

          await C.loaders.root.resolve("C ROOT LOADER");
          await C.loaders.foo.resolve("C LOADER");
          expect(t.router.getFetcher(key).data).toBe("C ACTION");
          expect(t.router.state.loaderData.foo).toBe("C LOADER");
        });
      });

      describe(`
        A) k1 |----|----X
        B) k2   |----|-----O
        C) k1           |-----|---O
      `, () => {
        it("aborts A load, commits B and C loads", async () => {
          let t = initializeTmTest({ url: "/foo" });
          let k1 = "1";
          let k2 = "2";

          let Ak1 = await t.fetch("/foo", k1, {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          let Bk2 = await t.fetch("/foo", k2, {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });

          await Ak1.actions.foo.resolve("A ACTION");
          await Bk2.actions.foo.resolve("B ACTION");
          expect(t.router.getFetcher(k2).data).toBe("B ACTION");

          let Ck1 = await t.fetch("/foo", k1, {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          expect(Ak1.loaders.foo.signal.aborted).toBe(true);

          await Ak1.loaders.root.resolve("A ROOT LOADER");
          await Ak1.loaders.foo.resolve("A LOADER");
          expect(t.router.state.loaderData.foo).toBeUndefined();

          await Bk2.loaders.root.resolve("B ROOT LOADER");
          await Bk2.loaders.foo.resolve("B LOADER");
          expect(Ck1.actions.foo.signal.aborted).toBe(false);
          expect(t.router.state.loaderData.foo).toBe("B LOADER");

          await Ck1.actions.foo.resolve("C ACTION");
          await Ck1.loaders.root.resolve("C ROOT LOADER");
          await Ck1.loaders.foo.resolve("C LOADER");

          expect(t.router.getFetcher(k1).data).toBe("C ACTION");
          expect(t.router.state.loaderData.foo).toBe("C LOADER");
        });
      });
    });

    describe("multiple fetcher action reloads", () => {
      describe(`
        A) POST /foo |---[A]------O
        B) POST /foo   |-----[A,B]---O
      `, () => {
        it("commits A, commits B", async () => {
          let t = initializeTmTest({ url: "/foo" });
          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          let B = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await A.actions.foo.resolve("A action");
          await B.actions.foo.resolve("B action");

          await A.loaders.root.resolve("A root");
          await A.loaders.foo.resolve("A loader");
          expect(t.router.state.loaderData).toEqual({
            root: "A root",
            foo: "A loader",
          });

          await B.loaders.root.resolve("A,B root");
          await B.loaders.foo.resolve("A,B loader");
          expect(t.router.state.loaderData).toEqual({
            root: "A,B root",
            foo: "A,B loader",
          });
        });
      });

      describe(`
        A) POST /foo |----🧤
        B) POST /foo   |--X
      `, () => {
        it("catches A, persists boundary for B", async () => {
          let t = initializeTmTest({ url: "/foo" });
          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          let B = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });

          await A.actions.foo.reject(new Response(null, { status: 400 }));
          expect(t.router.state.errors).toEqual({
            root: new ErrorResponse(400, undefined, ""),
          });

          await B.actions.foo.resolve("B");
          expect(t.router.state.errors).toEqual({
            root: new ErrorResponse(400, undefined, ""),
          });

          await B.loaders.root.resolve(null);
          await B.loaders.foo.resolve(null);
        });
      });

      describe(`
        A) POST /foo |----[A]-|
        B) POST /foo   |------🧤
      `, () => {
        it("commits A, catches B", async () => {
          let t = initializeTmTest({ url: "/foo" });
          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          let B = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });

          await A.actions.foo.resolve("A action");
          await A.loaders.root.resolve("A root");
          await A.loaders.foo.resolve("A loader");
          expect(t.router.state.loaderData).toEqual({
            root: "A root",
            foo: "A loader",
          });

          await B.actions.foo.reject(new Response(null, { status: 400 }));
          expect(t.router.state.errors).toEqual({
            root: new ErrorResponse(400, undefined, ""),
          });
        });
      });

      describe(`
        A) POST /foo |---[A]-------X
        B) POST /foo   |----[A,B]--O
      `, () => {
        it("aborts A, commits B, sets A done", async () => {
          let t = initializeTmTest({ url: "/foo" });
          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          let B = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await A.actions.foo.resolve("A");
          await B.actions.foo.resolve("B");

          await B.loaders.root.resolve("A,B root");
          await B.loaders.foo.resolve("A,B");
          expect(t.router.state.loaderData).toEqual({
            root: "A,B root",
            foo: "A,B",
          });
          expect(A.loaders.foo.signal.aborted).toBe(true);
          expect(A.fetcher.state).toBe("idle");
          expect(A.fetcher.data).toBe("A");
        });
      });

      describe(`
        A) POST /foo |--------[B,A]---O
        B) POST /foo   |--[B]-------O
      `, () => {
        it("commits B, commits A", async () => {
          let t = initializeTmTest({ url: "/foo" });
          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          let B = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });

          await B.actions.foo.resolve("B action");
          await A.actions.foo.resolve("A action");

          await B.loaders.root.resolve("B root");
          await B.loaders.foo.resolve("B");
          expect(t.router.state.loaderData).toEqual({
            root: "B root",
            foo: "B",
          });

          await A.loaders.root.resolve("B,A root");
          await A.loaders.foo.resolve("B,A");
          expect(t.router.state.loaderData).toEqual({
            root: "B,A root",
            foo: "B,A",
          });
        });
      });

      describe(`
        A) POST /foo |------|---O
        B) POST /foo   |--|-----X
      `, () => {
        it("aborts B, commits A, sets B done", async () => {
          let t = initializeTmTest({ url: "/foo" });

          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          let B = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });

          await B.actions.foo.resolve("B");
          await A.actions.foo.resolve("A");

          await A.loaders.root.resolve("B,A root");
          await A.loaders.foo.resolve("B,A");
          expect(t.router.state.loaderData).toEqual({
            root: "B,A root",
            foo: "B,A",
          });
          expect(B.loaders.foo.signal.aborted).toBe(true);
          expect(B.fetcher.state).toBe("idle");
          expect(B.fetcher.data).toBe("B");
        });
      });
    });

    describe("navigating with inflight fetchers", () => {
      describe(`
        A) fetch POST |-------|--O
        B) nav GET      |---O
      `, () => {
        it("does not abort A action or data reload", async () => {
          let t = initializeTmTest({ url: "/foo" });

          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          let B = await t.navigate("/foo");
          expect(A.actions.foo.signal.aborted).toBe(false);
          expect(t.router.state.navigation.state).toBe("loading");
          expect(t.router.state.navigation.location?.pathname).toBe("/foo");

          await B.loaders.root.resolve("B root");
          await B.loaders.foo.resolve("B");
          expect(t.router.state.navigation.state).toBe("idle");
          expect(t.router.state.location.pathname).toBe("/foo");
          expect(t.router.state.loaderData.foo).toBe("B");
          expect(A.loaders.foo.signal).toBe(undefined); // A loaders not called yet

          await A.actions.foo.resolve("A root");
          await A.loaders.root.resolve("A root");
          await A.loaders.foo.resolve("A");
          expect(A.loaders.foo.signal.aborted).toBe(false);
          expect(t.router.state.loaderData).toEqual({
            root: "A root",
            foo: "A",
          });
        });
      });

      describe(`
        A) fetch POST |----|-----O
        B) nav GET      |-----O
      `, () => {
        it("Commits A and uses next matches", async () => {
          let t = initializeTmTest({ url: "/" });

          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          // This fetcher's helpers take the current locations loaders (root/index).
          // Since we know we're about to interrupt with /foo let's shim in a
          // loader helper for foo ahead of time
          t.shimHelper(A.loaders, "fetch", "loader", "foo");

          let B = await t.navigate("/foo");
          await A.actions.foo.resolve("A action");
          await B.loaders.root.resolve("B root");
          await B.loaders.foo.resolve("B");
          expect(A.actions.foo.signal.aborted).toBe(false);
          expect(A.loaders.foo.signal.aborted).toBe(false);
          expect(t.router.state.navigation.state).toBe("idle");
          expect(t.router.state.location.pathname).toBe("/foo");
          expect(t.router.state.loaderData.foo).toBe("B");

          await A.loaders.root.resolve("A root");
          await A.loaders.foo.resolve("A");
          expect(t.router.state.loaderData).toEqual({
            root: "A root",
            foo: "A",
          });
        });
      });

      describe(`
        A) fetch POST |--|----X
        B) nav GET         |--O
      `, () => {
        it("aborts A, sets fetcher done", async () => {
          let t = initializeTmTest({
            url: "/foo",
            hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
          });

          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await A.actions.foo.resolve("A");
          let B = await t.navigate("/foo");
          await B.loaders.root.resolve("ROOT*");
          await B.loaders.foo.resolve("B");
          expect(t.router.state.navigation.state).toBe("idle");
          expect(t.router.state.location.pathname).toBe("/foo");
          expect(t.router.state.loaderData).toEqual({
            root: "ROOT*",
            foo: "B",
          });
          expect(A.loaders.foo.signal.aborted).toBe(true);
          expect(A.fetcher.state).toBe("idle");
          expect(A.fetcher.data).toBe("A");
        });
      });

      describe(`
        A) fetch POST |--|---O
        B) nav GET         |---O
      `, () => {
        it("commits both", async () => {
          let t = initializeTmTest({ url: "/foo" });

          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await A.actions.foo.resolve("A action");
          let B = await t.navigate("/foo");
          await A.loaders.root.resolve("A ROOT");
          await A.loaders.foo.resolve("A");
          expect(t.router.state.loaderData).toEqual({
            root: "A ROOT",
            foo: "A",
          });

          await B.loaders.root.resolve("B ROOT");
          await B.loaders.foo.resolve("B");
          expect(t.router.state.loaderData).toEqual({
            root: "B ROOT",
            foo: "B",
          });
        });
      });

      describe(`
        A) fetch POST |---[A]---O
        B) nav POST           |---[A,B]--O
      `, () => {
        it("keeps both", async () => {
          let t = initializeTmTest({ url: "/foo" });
          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await A.actions.foo.resolve("A action");
          let B = await t.navigate("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await A.loaders.root.resolve("A ROOT");
          await A.loaders.foo.resolve("A");
          expect(t.router.state.loaderData).toEqual({
            root: "A ROOT",
            foo: "A",
          });

          await B.actions.foo.resolve("A,B");
          await B.loaders.root.resolve("A,B ROOT");
          await B.loaders.foo.resolve("A,B");
          expect(t.router.state.loaderData).toEqual({
            root: "A,B ROOT",
            foo: "A,B",
          });
        });
      });

      describe(`
        A) fetch POST |---[A]--------X
        B) nav POST     |-----[A,B]--O
      `, () => {
        it("aborts A, commits B, marks fetcher done", async () => {
          let t = initializeTmTest({ url: "/foo" });
          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          let B = await t.navigate("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await A.actions.foo.resolve("A");
          await B.actions.foo.resolve("A,B");
          await B.loaders.root.resolve("A,B ROOT");
          await B.loaders.foo.resolve("A,B");
          expect(t.router.state.loaderData).toEqual({
            root: "A,B ROOT",
            foo: "A,B",
          });
          expect(A.loaders.foo.signal.aborted).toBe(true);
          expect(A.fetcher.state).toBe("idle");
          expect(A.fetcher.data).toBe("A");
        });
      });

      describe(`
        A) fetch POST |-----------[B,A]--O
        B) nav POST     |--[B]--O
      `, () => {
        it("commits both, uses the nav's href", async () => {
          let t = initializeTmTest({ url: "/foo" });
          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          t.shimHelper(A.loaders, "fetch", "loader", "bar");
          let B = await t.navigate("/bar", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await B.actions.bar.resolve("B");
          await B.loaders.root.resolve("B");
          await B.loaders.bar.resolve("B");
          await A.actions.foo.resolve("B,A");
          await A.loaders.root.resolve("B,A ROOT");
          await A.loaders.bar.resolve("B,A");
          expect(t.router.state.loaderData).toEqual({
            root: "B,A ROOT",
            bar: "B,A",
          });
        });
      });

      describe(`
        A) fetch POST |-------[B,A]--O
        B) nav POST     |--[B]-------X
      `, () => {
        it("aborts B, commits A, uses the nav's href", async () => {
          let t = initializeTmTest({ url: "/foo" });
          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          t.shimHelper(A.loaders, "fetch", "loader", "bar");
          let B = await t.navigate("/bar", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await B.actions.bar.resolve("B");
          await A.actions.foo.resolve("B,A");
          await A.loaders.root.resolve("B,A ROOT");
          await A.loaders.bar.resolve("B,A");
          expect(B.loaders.bar.signal.aborted).toBe(true);
          expect(t.router.state.loaderData).toEqual({
            root: "B,A ROOT",
            bar: "B,A",
          });
          expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);
        });
      });

      describe(`
        A) fetch POST /foo |--X
        B) nav   GET  /bar    |-----O
      `, () => {
        it("forces all loaders to revalidate on interrupted fetcher submission", async () => {
          let t = initializeTmTest();
          let A = await t.fetch("/foo", {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          t.shimHelper(A.loaders, "fetch", "loader", "bar");

          // Interrupting the submission should cause the next load to call all loaders
          let B = await t.navigate("/bar");
          await A.actions.foo.resolve("A ACTION");
          await B.loaders.root.resolve("ROOT*");
          await B.loaders.bar.resolve("BAR");
          expect(t.router.state).toMatchObject({
            navigation: IDLE_NAVIGATION,
            location: { pathname: "/bar" },
            actionData: null,
            loaderData: {
              root: "ROOT*",
              bar: "BAR",
            },
          });

          await A.loaders.root.resolve("ROOT**");
          await A.loaders.bar.resolve("BAR*");
          expect(t.router.state).toMatchObject({
            navigation: IDLE_NAVIGATION,
            location: { pathname: "/bar" },
            actionData: null,
            loaderData: {
              root: "ROOT**",
              bar: "BAR*",
            },
          });
        });
      });

      describe(`
        A) fetch POST /foo |--|--X
        B) nav   GET  /bar       |-----O
      `, () => {
        it("forces all loaders to revalidate on interrupted fetcher actionReload", async () => {
          let key = "key";
          let t = initializeTmTest();
          let A = await t.fetch("/foo", key, {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await A.actions.foo.resolve("A ACTION");
          expect(t.router.state.fetchers.get(key)?.state).toBe("loading");
          expect(t.router.state.fetchers.get(key)?.data).toBe("A ACTION");
          // Interrupting the actionReload should cause the next load to call all loaders
          let B = await t.navigate("/bar");
          await B.loaders.root.resolve("ROOT*");
          await B.loaders.bar.resolve("BAR");
          expect(t.router.state).toMatchObject({
            navigation: IDLE_NAVIGATION,
            location: { pathname: "/bar" },
            actionData: null,
            loaderData: {
              root: "ROOT*",
              bar: "BAR",
            },
          });
          expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
          expect(t.router.state.fetchers.get(key)?.data).toBe("A ACTION");
        });

        it("forces all loaders to revalidate on interrupted fetcher submissionRedirect", async () => {
          let key = "key";
          let t = initializeTmTest();
          let A = await t.fetch("/foo", key, {
            formMethod: "post",
            formData: createFormData({ key: "value" }),
          });
          await A.actions.foo.redirect("/baz");
          expect(t.router.state.fetchers.get(key)?.state).toBe("loading");
          // Interrupting the actionReload should cause the next load to call all loaders
          let B = await t.navigate("/bar");
          await B.loaders.root.resolve("ROOT*");
          await B.loaders.bar.resolve("BAR");
          expect(t.router.state).toMatchObject({
            navigation: IDLE_NAVIGATION,
            location: { pathname: "/bar" },
            loaderData: {
              root: "ROOT*",
              bar: "BAR",
            },
          });
          expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
          expect(t.router.state.fetchers.get(key)?.data).toBeUndefined();
        });
      });
    });

    describe("fetcher revalidation", () => {
      it("revalidates fetchers on action submissions", async () => {
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/"],
          hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
        });
        expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

        let key1 = "key1";
        let A = await t.fetch("/tasks/1", key1);
        await A.loaders.tasksId.resolve("TASKS 1");
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("TASKS 1");

        let C = await t.navigate("/tasks", {
          formMethod: "post",
          formData: createFormData({}),
        });
        // Add a helper for the fetcher that will be revalidating
        t.shimHelper(C.loaders, "navigation", "loader", "tasksId");

        // Resolve the action
        await C.actions.tasks.resolve("TASKS ACTION");

        // Fetcher should go back into a loading state
        expect(t.router.state.fetchers.get(key1)?.state).toBe("loading");

        // Resolve navigation loaders + fetcher loader
        await C.loaders.root.resolve("ROOT*");
        await C.loaders.tasks.resolve("TASKS LOADER");
        await C.loaders.tasksId.resolve("TASKS ID*");
        expect(t.router.state.fetchers.get(key1)).toMatchObject({
          state: "idle",
          data: "TASKS ID*",
        });

        // If a fetcher does a submission, it unsets the revalidation aspect
        let D = await t.fetch("/tasks/3", key1, {
          formMethod: "post",
          formData: createFormData({}),
        });
        await D.actions.tasksId.resolve("TASKS 3");
        await D.loaders.root.resolve("ROOT**");
        await D.loaders.tasks.resolve("TASKS**");
        expect(t.router.state.fetchers.get(key1)).toMatchObject({
          state: "idle",
          data: "TASKS 3",
        });

        let E = await t.navigate("/tasks", {
          formMethod: "post",
          formData: createFormData({}),
        });
        await E.actions.tasks.resolve("TASKS ACTION");
        await E.loaders.root.resolve("ROOT***");
        await E.actions.tasks.resolve("TASKS***");

        // Remains the same state as it was after the submission
        expect(t.router.state.fetchers.get(key1)).toMatchObject({
          state: "idle",
          data: "TASKS 3",
        });
      });

      it("revalidates fetchers on action redirects", async () => {
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/"],
          hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
        });
        expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

        let key = "key";
        let A = await t.fetch("/tasks/1", key);
        await A.loaders.tasksId.resolve("TASKS ID");
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("TASKS ID");

        let C = await t.navigate("/tasks", {
          formMethod: "post",
          formData: createFormData({}),
        });

        // Redirect the action
        let D = await C.actions.tasks.redirect("/", undefined, undefined, [
          "tasksId",
        ]);
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        // Resolve navigation loaders + fetcher loader
        await D.loaders.root.resolve("ROOT*");
        await D.loaders.index.resolve("INDEX*");
        await D.loaders.tasksId.resolve("TASKS ID*");
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "TASKS ID*",
        });
      });

      it("revalidates fetchers on action errors", async () => {
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/"],
          hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
        });
        expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

        let key = "key";
        let A = await t.fetch("/tasks/1", key);
        await A.loaders.tasksId.resolve("TASKS ID");
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("TASKS ID");

        let C = await t.navigate("/tasks", {
          formMethod: "post",
          formData: createFormData({}),
        });
        t.shimHelper(C.loaders, "navigation", "loader", "tasksId");

        // Reject the action
        await C.actions.tasks.reject(new Error("Kaboom!"));
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        // Resolve navigation loaders + fetcher loader
        await C.loaders.root.resolve("ROOT*");
        await C.loaders.tasksId.resolve("TASKS ID*");
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "TASKS ID*",
        });
      });

      it("does not revalidate fetchers on searchParams changes", async () => {
        let key = "key";
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/tasks/1"],
          hydrationData: {
            loaderData: {
              root: "ROOT",
              taskId: "TASK 1",
            },
          },
        });

        let A = await t.fetch("/?index", key);
        await A.loaders.index.resolve("FETCH 1");
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "FETCH 1",
        });

        let B = await t.navigate("/tasks/1?key=value", undefined, ["index"]);
        await B.loaders.root.resolve("ROOT 2");
        await B.loaders.tasksId.resolve("TASK 2");
        expect(t.router.state.loaderData).toMatchObject({
          root: "ROOT 2",
          tasksId: "TASK 2",
        });
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "FETCH 1",
        });
        expect(B.loaders.index.stub).not.toHaveBeenCalled();
      });

      it("revalidates fetchers on links to the current location", async () => {
        let key = "key";
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/tasks/1"],
          hydrationData: {
            loaderData: {
              root: "ROOT",
              taskId: "TASK 1",
            },
          },
        });

        let A = await t.fetch("/?index", key);
        await A.loaders.index.resolve("FETCH 1");
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "FETCH 1",
        });

        let B = await t.navigate("/tasks/1", undefined, ["index"]);
        await B.loaders.root.resolve("ROOT 2");
        await B.loaders.tasksId.resolve("TASK 2");
        expect(t.router.state.loaderData).toMatchObject({
          root: "ROOT 2",
          tasksId: "TASK 2",
        });
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "FETCH 1",
        });
        expect(B.loaders.index.stub).not.toHaveBeenCalled();
      });

      it("does not revalidate idle fetchers when a loader navigation is performed", async () => {
        let key = "key";
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/"],
          hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
        });

        let A = await t.fetch("/", key);
        await A.loaders.root.resolve("ROOT FETCH");
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "ROOT FETCH",
        });

        let B = await t.navigate("/tasks");
        await B.loaders.tasks.resolve("TASKS");
        expect(t.router.state.loaderData).toMatchObject({
          root: "ROOT",
          tasks: "TASKS",
        });
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "ROOT FETCH",
        });
      });

      it("respects shouldRevalidate for the fetcher route", async () => {
        let key = "key";
        let count = 0;
        let shouldRevalidate = jest.fn((args) => false);
        let router = createRouter({
          history: createMemoryHistory({ initialEntries: ["/one"] }),
          routes: [
            {
              id: "root",
              path: "/",
              loader: () => Promise.resolve(++count),
              children: [
                {
                  path: ":a",
                  children: [
                    {
                      path: ":b",
                      action: () => Promise.resolve(null),
                    },
                  ],
                },
              ],
            },
            {
              id: "fetch",
              path: "/fetch",
              loader: () => Promise.resolve(++count),
              shouldRevalidate,
            },
          ],
          hydrationData: {
            loaderData: { root: count },
          },
        });

        expect(router.state.loaderData).toMatchObject({
          root: 0,
        });
        expect(router.getFetcher(key)).toBe(IDLE_FETCHER);

        // Fetch from a different route
        router.fetch(key, "root", "/fetch");
        await tick();
        expect(router.getFetcher(key)).toMatchObject({
          state: "idle",
          data: 1,
        });

        // Post to the current route
        router.navigate("/two/three", {
          formMethod: "post",
          formData: createFormData({}),
        });
        await tick();
        expect(router.state.loaderData).toMatchObject({
          root: 2,
        });
        expect(router.getFetcher(key)).toMatchObject({
          state: "idle",
          data: 1,
        });
        expect(shouldRevalidate.mock.calls[0][0]).toMatchInlineSnapshot(`
          {
            "actionResult": null,
            "currentParams": {
              "a": "one",
            },
            "currentUrl": "http://localhost/one",
            "defaultShouldRevalidate": true,
            "formAction": "/two/three",
            "formData": FormData {},
            "formEncType": "application/x-www-form-urlencoded",
            "formMethod": "post",
            "nextParams": {
              "a": "two",
              "b": "three",
            },
            "nextUrl": "http://localhost/two/three",
          }
        `);

        expect(router._internalFetchControllers.size).toBe(0);
        router.dispose();
      });

      it("handles fetcher revalidation errors", async () => {
        let key = "key";
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/"],
          hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
        });

        expect(t.router.state).toMatchObject({
          loaderData: {
            root: "ROOT",
            index: "INDEX",
          },
          errors: null,
        });

        let A = await t.fetch("/tasks/1", key);
        await A.loaders.tasksId.resolve("ROOT FETCH");
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "ROOT FETCH",
        });

        let B = await t.navigate("/tasks", {
          formMethod: "post",
          formData: createFormData({}),
        });
        t.shimHelper(B.loaders, "navigation", "loader", "tasksId");
        await B.actions.tasks.resolve("TASKS ACTION");
        await B.loaders.root.resolve("ROOT*");
        await B.loaders.tasks.resolve("TASKS*");
        await B.loaders.tasksId.reject(new Error("Fetcher error"));
        expect(t.router.state).toMatchObject({
          loaderData: {
            root: "ROOT*",
            tasks: "TASKS*",
          },
          errors: {
            // Even though tasksId has an error boundary, this bubbles up to
            // the root since it's the closest "active" rendered route with an
            // error boundary
            root: new Error("Fetcher error"),
          },
        });
        expect(t.router.state.fetchers.get(key)).toBe(undefined);
      });

      it("revalidates fetchers on fetcher action submissions", async () => {
        let key = "key";
        let actionKey = "actionKey";
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/"],
          hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
        });

        // Load a fetcher
        let A = await t.fetch("/tasks/1", key);
        await A.loaders.tasksId.resolve("TASKS ID");
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "TASKS ID",
        });

        // Submit a fetcher, leaves loaded fetcher untouched
        let C = await t.fetch("/tasks", actionKey, {
          formMethod: "post",
          formData: createFormData({}),
        });
        t.shimHelper(C.loaders, "fetch", "loader", "tasksId");
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "TASKS ID",
        });
        expect(t.router.state.fetchers.get(actionKey)).toMatchObject({
          state: "submitting",
        });

        // After action resolves, both fetchers go into a loading state, with
        // the load fetcher still reflecting it's stale data
        await C.actions.tasks.resolve("TASKS ACTION");
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "loading",
          data: "TASKS ID",
        });
        expect(t.router.state.fetchers.get(actionKey)).toMatchObject({
          state: "loading",
          data: "TASKS ACTION",
        });

        // All go back to idle on resolutions
        await C.loaders.root.resolve("ROOT*");
        await C.loaders.index.resolve("INDEX*");
        await C.loaders.tasksId.resolve("TASKS ID*");

        expect(t.router.state.loaderData).toMatchObject({
          root: "ROOT*",
          index: "INDEX*",
        });
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "TASKS ID*",
        });
        expect(t.router.state.fetchers.get(actionKey)).toMatchObject({
          state: "idle",
          data: "TASKS ACTION",
        });
      });

      it("does not revalidate fetchers initiated from removed routes", async () => {
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/"],
          hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
        });

        let key = "key";

        // Trigger a fetch from the index route
        let A = await t.fetch("/tasks/1", key, "index");
        await A.loaders.tasksId.resolve("TASKS");
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "TASKS",
        });

        // Navigate such that the index route will be removed
        let B = await t.navigate("/tasks", {
          formMethod: "post",
          formData: createFormData({}),
        });

        // Resolve the action
        await B.actions.tasks.resolve("TASKS ACTION");

        // Fetcher should remain in an idle state since it's calling route is
        // being removed
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "TASKS",
        });

        // Resolve navigation loaders
        await B.loaders.root.resolve("ROOT*");
        await B.loaders.tasks.resolve("TASKS LOADER");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.location.pathname).toBe("/tasks");

        // Fetcher never got called
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "idle",
          data: "TASKS",
        });
      });

      it("cancels in-flight fetcher.loads on action submission and forces reload", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              children: [
                {
                  id: "index",
                  index: true,
                },
                {
                  id: "action",
                  path: "action",
                  action: true,
                },
                // fetch A will resolve before the action and will be able to opt-out
                {
                  id: "fetchA",
                  path: "fetch-a",
                  loader: true,
                  shouldRevalidate: () => false,
                },
                // fetch B will resolve before the action but then issue a second
                // load that gets cancelled.  It will not be able to opt out because
                // of the cancellation
                {
                  id: "fetchB",
                  path: "fetch-b",
                  loader: true,
                  shouldRevalidate: () => false,
                },
                // fetch C will not before the action, and will not be able to opt
                // out because it has no data
                {
                  id: "fetchC",
                  path: "fetch-c",
                  loader: true,
                  shouldRevalidate: () => false,
                },
              ],
            },
          ],
          initialEntries: ["/"],
          hydrationData: { loaderData: { index: "INDEX" } },
        });
        expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

        let keyA = "a";
        let A = await t.fetch("/fetch-a", keyA);
        await A.loaders.fetchA.resolve("A");
        expect(t.router.state.fetchers.get(keyA)).toMatchObject({
          state: "idle",
          data: "A",
        });

        let keyB = "b";
        let B = await t.fetch("/fetch-b", keyB);
        await B.loaders.fetchB.resolve("B");
        expect(t.router.state.fetchers.get(keyB)).toMatchObject({
          state: "idle",
          data: "B",
        });

        // Fetch again for B
        let B2 = await t.fetch("/fetch-b", keyB);
        expect(t.router.state.fetchers.get(keyB)?.state).toBe("loading");

        // Start another fetcher which will not resolve prior to the action
        let keyC = "c";
        let C = await t.fetch("/fetch-c", keyC);
        expect(t.router.state.fetchers.get(keyC)?.state).toBe("loading");

        // Navigation should cancel fetcher and since it has no data
        // shouldRevalidate should be ignored on subsequent fetch
        let D = await t.navigate("/action", {
          formMethod: "post",
          formData: createFormData({}),
        });
        // Add a helper for the fetcher that will be revalidating
        t.shimHelper(D.loaders, "navigation", "loader", "fetchA");
        t.shimHelper(D.loaders, "navigation", "loader", "fetchB");
        t.shimHelper(D.loaders, "navigation", "loader", "fetchC");

        // Fetcher load aborted and still in a loading state
        expect(t.router.state.navigation.state).toBe("submitting");
        expect(A.loaders.fetchA.signal.aborted).toBe(false);
        expect(B.loaders.fetchB.signal.aborted).toBe(false);
        expect(B2.loaders.fetchB.signal.aborted).toBe(true);
        expect(C.loaders.fetchC.signal.aborted).toBe(true);
        expect(t.router.state.fetchers.get(keyA)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(keyB)?.state).toBe("loading");
        expect(t.router.state.fetchers.get(keyC)?.state).toBe("loading");
        await B.loaders.fetchB.resolve("B"); // ignored due to abort
        await C.loaders.fetchC.resolve("C"); // ignored due to abort

        // Resolve the action
        await D.actions.action.resolve("ACTION");
        expect(t.router.state.navigation.state).toBe("loading");
        expect(t.router.state.fetchers.get(keyA)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(keyB)?.state).toBe("loading");
        expect(t.router.state.fetchers.get(keyC)?.state).toBe("loading");

        // Resolve fetcher loader
        await D.loaders.fetchB.resolve("B2");
        await D.loaders.fetchC.resolve("C");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.fetchers.get(keyA)).toMatchObject({
          state: "idle",
          data: "A",
        });
        expect(t.router.state.fetchers.get(keyB)).toMatchObject({
          state: "idle",
          data: "B2",
        });
        expect(t.router.state.fetchers.get(keyC)).toMatchObject({
          state: "idle",
          data: "C",
        });
      });

      it("does not cancel pending action navigation on deletion of revalidating fetcher", async () => {
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/"],
          hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
        });
        expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

        let key1 = "key1";
        let A = await t.fetch("/tasks/1", key1);
        await A.loaders.tasksId.resolve("TASKS 1");

        let C = await t.navigate("/tasks", {
          formMethod: "post",
          formData: createFormData({}),
        });
        // Add a helper for the fetcher that will be revalidating
        t.shimHelper(C.loaders, "navigation", "loader", "tasksId");

        // Resolve the action
        await C.actions.tasks.resolve("TASKS ACTION");

        // Fetcher should go back into a loading state
        expect(t.router.state.fetchers.get(key1)).toMatchObject({
          state: "loading",
          data: "TASKS 1",
        });

        // Delete fetcher in the middle of the revalidation
        t.router.deleteFetcher(key1);
        expect(t.router.state.fetchers.get(key1)).toBeUndefined();

        // Resolve navigation loaders
        await C.loaders.root.resolve("ROOT*");
        await C.loaders.tasks.resolve("TASKS LOADER");

        expect(t.router.state).toMatchObject({
          actionData: {
            tasks: "TASKS ACTION",
          },
          errors: null,
          loaderData: {
            tasks: "TASKS LOADER",
            root: "ROOT*",
          },
        });
        expect(t.router.state.fetchers.size).toBe(0);
      });

      it("does not cancel pending loader navigation on deletion of revalidating fetcher", async () => {
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/"],
          hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
        });
        expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

        let key1 = "key1";
        let A = await t.fetch("/tasks/1", key1);
        await A.loaders.tasksId.resolve("TASKS 1");

        // Submission navigation to trigger revalidations
        let C = await t.navigate("/tasks", {
          formMethod: "post",
          formData: createFormData({}),
        });
        await C.actions.tasks.resolve("TASKS ACTION");

        // Fetcher should go back into a loading state
        expect(t.router.state.fetchers.get(key1)).toMatchObject({
          state: "loading",
          data: "TASKS 1",
        });

        // Delete fetcher in the middle of the revalidation
        t.router.deleteFetcher(key1);
        expect(t.router.state.fetchers.get(key1)).toBeUndefined();

        // Resolve navigation action/loaders
        await C.loaders.root.resolve("ROOT*");
        await C.loaders.tasks.resolve("TASKS LOADER");

        expect(t.router.state).toMatchObject({
          errors: null,
          navigation: IDLE_NAVIGATION,
          actionData: {
            tasks: "TASKS ACTION",
          },
          loaderData: {
            tasks: "TASKS LOADER",
            root: "ROOT*",
          },
        });
        expect(t.router.state.fetchers.size).toBe(0);
      });

      it("does not cancel pending router.revalidate() on deletion of revalidating fetcher", async () => {
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/"],
          hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
        });
        expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

        let key1 = "key1";
        let A = await t.fetch("/tasks/1", key1);
        await A.loaders.tasksId.resolve("TASKS 1");

        // Trigger revalidations
        let C = await t.revalidate();

        // Fetcher should not go back into a loading state since it's a revalidation
        expect(t.router.state.fetchers.get(key1)).toMatchObject({
          state: "idle",
          data: "TASKS 1",
        });

        // Delete fetcher in the middle of the revalidation
        t.router.deleteFetcher(key1);
        expect(t.router.state.fetchers.get(key1)).toBeUndefined();

        // Resolve navigation loaders
        await C.loaders.root.resolve("ROOT*");
        await C.loaders.index.resolve("INDEX*");

        expect(t.router.state).toMatchObject({
          errors: null,
          loaderData: {
            root: "ROOT*",
            index: "INDEX*",
          },
        });
        expect(t.router.state.fetchers.size).toBe(0);
      });

      it("does not cancel pending fetcher submission on deletion of revalidating fetcher", async () => {
        let key = "key";
        let actionKey = "actionKey";
        let t = setup({
          routes: TASK_ROUTES,
          initialEntries: ["/"],
          hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
        });

        // Load a fetcher
        let A = await t.fetch("/tasks/1", key);
        await A.loaders.tasksId.resolve("TASKS ID");

        // Submit a fetcher, leaves loaded fetcher untouched
        let C = await t.fetch("/tasks", actionKey, {
          formMethod: "post",
          formData: createFormData({}),
        });

        // After action resolves, both fetchers go into a loading state, with
        // the load fetcher still reflecting it's stale data
        await C.actions.tasks.resolve("TASKS ACTION");
        expect(t.router.state.fetchers.get(key)).toMatchObject({
          state: "loading",
          data: "TASKS ID",
        });
        expect(t.router.state.fetchers.get(actionKey)).toMatchObject({
          state: "loading",
          data: "TASKS ACTION",
        });

        // Delete fetcher in the middle of the revalidation
        t.router.deleteFetcher(key);
        expect(t.router.state.fetchers.get(key)).toBeUndefined();

        // Resolve only active route loaders since fetcher was deleted
        await C.loaders.root.resolve("ROOT*");
        await C.loaders.index.resolve("INDEX*");

        expect(t.router.state.loaderData).toMatchObject({
          root: "ROOT*",
          index: "INDEX*",
        });
        expect(t.router.state.fetchers.get(key)).toBe(undefined);
        expect(t.router.state.fetchers.get(actionKey)).toMatchObject({
          state: "idle",
          data: "TASKS ACTION",
        });
      });
    });

    describe("fetcher ?index params", () => {
      it("hits the proper Routes when ?index params are present", async () => {
        let t = setup({
          routes: [
            {
              id: "parent",
              path: "parent",
              action: true,
              loader: true,
              // Turn off revalidation after fetcher action submission for this test
              shouldRevalidate: () => false,
              children: [
                {
                  id: "index",
                  index: true,
                  action: true,
                  loader: true,
                  // Turn off revalidation after fetcher action submission for this test
                  shouldRevalidate: () => false,
                },
              ],
            },
          ],
          initialEntries: ["/parent"],
          hydrationData: { loaderData: { parent: "PARENT", index: "INDEX" } },
        });

        let key = "KEY";

        // fetcher.load()
        let A = await t.fetch("/parent", key);
        await A.loaders.parent.resolve("PARENT LOADER");
        expect(t.router.getFetcher(key).data).toBe("PARENT LOADER");

        let B = await t.fetch("/parent?index", key);
        await B.loaders.index.resolve("INDEX LOADER");
        expect(t.router.getFetcher(key).data).toBe("INDEX LOADER");

        // fetcher.submit({}, { method: 'get' })
        let C = await t.fetch("/parent", key, {
          formMethod: "get",
          formData: createFormData({}),
        });
        await C.loaders.parent.resolve("PARENT LOADER");
        expect(t.router.getFetcher(key).data).toBe("PARENT LOADER");

        let D = await t.fetch("/parent?index", key, {
          formMethod: "get",
          formData: createFormData({}),
        });
        await D.loaders.index.resolve("INDEX LOADER");
        expect(t.router.getFetcher(key).data).toBe("INDEX LOADER");

        // fetcher.submit({}, { method: 'post' })
        let E = await t.fetch("/parent", key, {
          formMethod: "post",
          formData: createFormData({}),
        });
        await E.actions.parent.resolve("PARENT ACTION");
        expect(t.router.getFetcher(key).data).toBe("PARENT ACTION");

        let F = await t.fetch("/parent?index", key, {
          formMethod: "post",
          formData: createFormData({}),
        });
        await F.actions.index.resolve("INDEX ACTION");
        expect(t.router.getFetcher(key).data).toBe("INDEX ACTION");
      });

      it("throws a 404 ErrorResponse without ?index and parent route has no loader", async () => {
        let t = setup({
          routes: [
            {
              id: "parent",
              path: "parent",
              children: [
                {
                  id: "index",
                  index: true,
                  loader: true,
                },
              ],
            },
          ],
          initialEntries: ["/parent"],
          hydrationData: { loaderData: { index: "INDEX" } },
        });

        let key = "KEY";
        await t.fetch("/parent");
        expect(t.router.state.errors).toMatchInlineSnapshot(`
          {
            "parent": ErrorResponse {
              "data": "Error: No route matches URL "/parent"",
              "error": [Error: No route matches URL "/parent"],
              "internal": true,
              "status": 404,
              "statusText": "Not Found",
            },
          }
        `);
        expect(t.router.getFetcher(key).data).toBe(undefined);
      });

      it("throws a 404 ErrorResponse with ?index and index route has no loader", async () => {
        let t = setup({
          routes: [
            {
              id: "parent",
              path: "parent",
              loader: true,
              children: [
                {
                  id: "index",
                  index: true,
                },
              ],
            },
          ],
          initialEntries: ["/parent"],
          hydrationData: { loaderData: { parent: "PARENT" } },
        });

        let key = "KEY";
        await t.fetch("/parent?index");
        expect(t.router.state.errors).toMatchInlineSnapshot(`
          {
            "parent": ErrorResponse {
              "data": "Error: No route matches URL "/parent?index"",
              "error": [Error: No route matches URL "/parent?index"],
              "internal": true,
              "status": 404,
              "statusText": "Not Found",
            },
          }
        `);
        expect(t.router.getFetcher(key).data).toBe(undefined);
      });

      it("throws a 405 ErrorResponse without ?index and parent route has no action", async () => {
        let t = setup({
          routes: [
            {
              id: "parent",
              path: "parent",
              children: [
                {
                  id: "index",
                  index: true,
                  action: true,
                },
              ],
            },
          ],
          initialEntries: ["/parent"],
        });

        let key = "KEY";
        await t.fetch("/parent", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.errors).toMatchInlineSnapshot(`
          {
            "parent": ErrorResponse {
              "data": "Error: You made a POST request to "/parent" but did not provide an \`action\` for route "parent", so there is no way to handle the request.",
              "error": [Error: You made a POST request to "/parent" but did not provide an \`action\` for route "parent", so there is no way to handle the request.],
              "internal": true,
              "status": 405,
              "statusText": "Method Not Allowed",
            },
          }
        `);
        expect(t.router.getFetcher(key).data).toBe(undefined);
      });

      it("throws a 405 ErrorResponse with ?index and index route has no action", async () => {
        let t = setup({
          routes: [
            {
              id: "parent",
              path: "parent",
              action: true,
              children: [
                {
                  id: "index",
                  index: true,
                },
              ],
            },
          ],
          initialEntries: ["/parent"],
        });

        let key = "KEY";
        await t.fetch("/parent?index", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.errors).toMatchInlineSnapshot(`
          {
            "parent": ErrorResponse {
              "data": "Error: You made a POST request to "/parent?index" but did not provide an \`action\` for route "parent", so there is no way to handle the request.",
              "error": [Error: You made a POST request to "/parent?index" but did not provide an \`action\` for route "parent", so there is no way to handle the request.],
              "internal": true,
              "status": 405,
              "statusText": "Method Not Allowed",
            },
          }
        `);
        expect(t.router.getFetcher(key).data).toBe(undefined);
      });
    });
  });

  describe("deferred data", () => {
    it("should not track deferred responses on naked objects", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
          },
          {
            id: "lazy",
            path: "lazy",
            loader: true,
          },
        ],
        initialEntries: ["/"],
      });

      let A = await t.navigate("/lazy");

      let dfd = createDeferred();
      await A.loaders.lazy.resolve({
        critical: "1",
        lazy: dfd.promise,
      });
      expect(t.router.state.loaderData).toEqual({
        lazy: {
          critical: "1",
          lazy: expect.any(Promise),
        },
      });
      expect(t.router.state.loaderData.lazy.lazy._tracked).toBeUndefined();
    });

    it("should support returning deferred responses", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
          },
          {
            id: "lazy",
            path: "lazy",
            loader: true,
          },
        ],
        initialEntries: ["/"],
      });

      let A = await t.navigate("/lazy");

      let dfd1 = createDeferred();
      let dfd2 = createDeferred();
      let dfd3 = createDeferred();
      dfd1.resolve("Immediate data");
      await A.loaders.lazy.resolve(
        defer({
          critical1: "1",
          critical2: "2",
          lazy1: dfd1.promise,
          lazy2: dfd2.promise,
          lazy3: dfd3.promise,
        })
      );
      expect(t.router.state.loaderData).toEqual({
        lazy: {
          critical1: "1",
          critical2: "2",
          lazy1: expect.trackedPromise("Immediate data"),
          lazy2: expect.trackedPromise(),
          lazy3: expect.trackedPromise(),
        },
      });

      await dfd2.resolve("2");
      expect(t.router.state.loaderData).toEqual({
        lazy: {
          critical1: "1",
          critical2: "2",
          lazy1: expect.trackedPromise("Immediate data"),
          lazy2: expect.trackedPromise("2"),
          lazy3: expect.trackedPromise(),
        },
      });

      await dfd3.resolve("3");
      expect(t.router.state.loaderData).toEqual({
        lazy: {
          critical1: "1",
          critical2: "2",
          lazy1: expect.trackedPromise("Immediate data"),
          lazy2: expect.trackedPromise("2"),
          lazy3: expect.trackedPromise("3"),
        },
      });

      // Should proxy values through
      let data = t.router.state.loaderData.lazy;
      await expect(data.lazy1).resolves.toBe("Immediate data");
      await expect(data.lazy2).resolves.toBe("2");
      await expect(data.lazy3).resolves.toBe("3");
    });

    it("should cancel outstanding deferreds on a new navigation", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
            loader: true,
          },
          {
            id: "lazy",
            path: "lazy",
            loader: true,
          },
        ],
        hydrationData: { loaderData: { index: "INDEX" } },
        initialEntries: ["/"],
      });

      let A = await t.navigate("/lazy");
      let dfd1 = createDeferred();
      let dfd2 = createDeferred();
      await A.loaders.lazy.resolve(
        defer({
          critical1: "1",
          critical2: "2",
          lazy1: dfd1.promise,
          lazy2: dfd2.promise,
        })
      );

      // Interrupt pending deferred's from /lazy navigation
      let navPromise = t.navigate("/");

      // Cancelled promises should reject immediately
      let data = t.router.state.loaderData.lazy;
      await expect(data.lazy1).rejects.toBeInstanceOf(AbortedDeferredError);
      await expect(data.lazy2).rejects.toBeInstanceOf(AbortedDeferredError);
      await expect(data.lazy1).rejects.toThrowError("Deferred data aborted");
      await expect(data.lazy2).rejects.toThrowError("Deferred data aborted");

      let B = await navPromise;

      // During navigation - deferreds remain as promises
      expect(t.router.state.loaderData).toEqual({
        lazy: {
          critical1: "1",
          critical2: "2",
          lazy1: expect.trackedPromise(null, null, true),
          lazy2: expect.trackedPromise(null, null, true),
        },
      });

      // But they are frozen - no re-paints on resolve/reject!
      await dfd1.resolve("a");
      await dfd2.reject(new Error("b"));
      expect(t.router.state.loaderData).toEqual({
        lazy: {
          critical1: "1",
          critical2: "2",
          lazy1: expect.trackedPromise(null, null, true),
          lazy2: expect.trackedPromise(null, null, true),
        },
      });

      await B.loaders.index.resolve("INDEX*");
      expect(t.router.state.loaderData).toEqual({
        index: "INDEX*",
      });
    });

    it("should not cancel outstanding deferreds on reused routes", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            loader: true,
          },
          {
            id: "parent",
            path: "parent",
            loader: true,
            children: [
              {
                id: "a",
                path: "a",
                loader: true,
              },
              {
                id: "b",
                path: "b",
                loader: true,
              },
            ],
          },
        ],
        hydrationData: { loaderData: { root: "ROOT" } },
        initialEntries: ["/"],
      });

      let A = await t.navigate("/parent/a");
      let parentDfd = createDeferred();
      await A.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT",
          lazy: parentDfd.promise,
        })
      );
      let aDfd = createDeferred();
      await A.loaders.a.resolve(
        defer({
          critical: "CRITICAL A",
          lazy: aDfd.promise,
        })
      );

      // Navigate such that we reuse the parent route
      let B = await t.navigate("/parent/b");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(),
        },
        a: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(),
        },
      });

      // This should reflect in loaderData
      await parentDfd.resolve("LAZY PARENT");
      // This should not
      await aDfd.resolve("LAZY A");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise("LAZY PARENT"),
        },
        a: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(null, null, true), // No re-paint!
        },
      });

      // Complete the navigation
      await B.loaders.b.resolve("B DATA");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise("LAZY PARENT"),
        },
        b: "B DATA",
      });
    });

    it("should handle promise rejections", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
          },
          {
            id: "lazy",
            path: "lazy",
            loader: true,
          },
        ],
        initialEntries: ["/"],
      });

      let A = await t.navigate("/lazy");

      let dfd = createDeferred();
      await A.loaders.lazy.resolve(
        defer({
          critical: "1",
          lazy: dfd.promise,
        })
      );

      await dfd.reject(new Error("Kaboom!"));
      expect(t.router.state.loaderData).toEqual({
        lazy: {
          critical: "1",
          lazy: expect.trackedPromise(undefined, new Error("Kaboom!")),
        },
      });

      // should proxy the error through
      let data = t.router.state.loaderData.lazy;
      await expect(data.lazy).rejects.toEqual(new Error("Kaboom!"));
    });

    it("should cancel all outstanding deferreds on router.revalidate()", async () => {
      let shouldRevalidateSpy = jest.fn(() => false);
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            loader: true,
          },
          {
            id: "parent",
            path: "parent",
            loader: true,
            shouldRevalidate: shouldRevalidateSpy,
            children: [
              {
                id: "index",
                index: true,
                loader: true,
              },
            ],
          },
        ],
        hydrationData: { loaderData: { root: "ROOT" } },
        initialEntries: ["/"],
      });

      let A = await t.navigate("/parent");
      let parentDfd = createDeferred();
      await A.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT",
          lazy: parentDfd.promise,
        })
      );
      let indexDfd = createDeferred();
      await A.loaders.index.resolve(
        defer({
          critical: "CRITICAL INDEX",
          lazy: indexDfd.promise,
        })
      );

      // Trigger a revalidation which should cancel outstanding deferreds
      let R = await t.revalidate();
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(),
        },
        index: {
          critical: "CRITICAL INDEX",
          lazy: expect.trackedPromise(),
        },
      });

      // Neither should reflect in loaderData
      await parentDfd.resolve("Nope!");
      await indexDfd.resolve("Nope!");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(null, null, true),
        },
        index: {
          critical: "CRITICAL INDEX",
          lazy: expect.trackedPromise(null, null, true),
        },
      });

      // Complete the revalidation
      let parentDfd2 = createDeferred();
      await R.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT 2",
          lazy: parentDfd2.promise,
        })
      );
      let indexDfd2 = createDeferred();
      await R.loaders.index.resolve(
        defer({
          critical: "CRITICAL INDEX 2",
          lazy: indexDfd2.promise,
        })
      );

      // Revalidations await all deferreds, so we're still in a loading
      // state with the prior loaderData here
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.revalidation).toBe("loading");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(null, null, true),
        },
        index: {
          critical: "CRITICAL INDEX",
          lazy: expect.trackedPromise(null, null, true),
        },
      });

      await indexDfd2.resolve("LAZY INDEX 2");
      // Not done yet!
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.revalidation).toBe("loading");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(null, null, true),
        },
        index: {
          critical: "CRITICAL INDEX",
          lazy: expect.trackedPromise(null, null, true),
        },
      });

      await parentDfd2.resolve("LAZY PARENT 2");
      // Done now that all deferreds have resolved
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.revalidation).toBe("idle");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT 2",
          lazy: expect.trackedPromise("LAZY PARENT 2"),
        },
        index: {
          critical: "CRITICAL INDEX 2",
          lazy: expect.trackedPromise("LAZY INDEX 2"),
        },
      });

      expect(shouldRevalidateSpy).not.toHaveBeenCalled();
    });

    it("cancels correctly on revalidations chains", async () => {
      let shouldRevalidateSpy = jest.fn(() => false);
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
          },
          {
            id: "foo",
            path: "foo",
            loader: true,
            shouldRevalidate: shouldRevalidateSpy,
          },
        ],
      });

      let A = await t.navigate("/foo");
      let dfda = createDeferred();
      await A.loaders.foo.resolve(
        defer({
          critical: "CRITICAL A",
          lazy: dfda.promise,
        })
      );
      expect(t.router.state.loaderData).toEqual({
        foo: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(),
        },
      });

      let B = await t.revalidate();
      let dfdb = createDeferred();
      // This B data will _never_ make it through - since we will await all of
      // it and we'll revalidate before it resolves
      await B.loaders.foo.resolve(
        defer({
          critical: "CRITICAL B",
          lazy: dfdb.promise,
        })
      );
      // The initial revalidation cancelled the navigation deferred
      await dfda.resolve("Nope!");
      expect(t.router.state.loaderData).toEqual({
        foo: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(null, null, true),
        },
      });

      let C = await t.revalidate();
      let dfdc = createDeferred();
      await C.loaders.foo.resolve(
        defer({
          critical: "CRITICAL C",
          lazy: dfdc.promise,
        })
      );
      // The second revalidation should have cancelled the first revalidation
      // deferred
      await dfdb.resolve("Nope!");
      expect(t.router.state.loaderData).toEqual({
        foo: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(null, null, true),
        },
      });

      // Resolve the final revalidation which should make it into loaderData
      await dfdc.resolve("Yep!");
      expect(t.router.state.loaderData).toEqual({
        foo: {
          critical: "CRITICAL C",
          lazy: expect.trackedPromise("Yep!"),
        },
      });

      expect(shouldRevalidateSpy).not.toHaveBeenCalled();
    });

    it("cancels correctly on revalidations interrupted by navigations", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
          },
          {
            id: "foo",
            path: "foo",
            loader: true,
          },
          {
            id: "bar",
            path: "bar",
            loader: true,
          },
        ],
      });

      let A = await t.navigate("/foo");
      let dfda = createDeferred();
      await A.loaders.foo.resolve(
        defer({
          critical: "CRITICAL A",
          lazy: dfda.promise,
        })
      );
      await dfda.resolve("LAZY A");
      expect(t.router.state.loaderData).toEqual({
        foo: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise("LAZY A"),
        },
      });

      let B = await t.revalidate();
      let dfdb = createDeferred();
      await B.loaders.foo.resolve(
        defer({
          critical: "CRITICAL B",
          lazy: dfdb.promise,
        })
      );
      // B not reflected because its got existing loaderData
      expect(t.router.state.loaderData).toEqual({
        foo: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise("LAZY A"),
        },
      });

      let C = await t.navigate("/bar");
      let dfdc = createDeferred();
      await C.loaders.bar.resolve(
        defer({
          critical: "CRITICAL C",
          lazy: dfdc.promise,
        })
      );
      // The second revalidation should have cancelled the first revalidation
      // deferred
      await dfdb.resolve("Nope!");
      expect(t.router.state.loaderData).toEqual({
        bar: {
          critical: "CRITICAL C",
          lazy: expect.trackedPromise(),
        },
      });

      await dfdc.resolve("Yep!");
      expect(t.router.state.loaderData).toEqual({
        bar: {
          critical: "CRITICAL C",
          lazy: expect.trackedPromise("Yep!"),
        },
      });
    });

    it("cancels pending deferreds on 404 navigations", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
            loader: true,
          },
          {
            id: "lazy",
            path: "lazy",
            loader: true,
          },
        ],
        hydrationData: { loaderData: { index: "INDEX" } },
        initialEntries: ["/"],
      });

      let A = await t.navigate("/lazy");
      let dfd = createDeferred();
      await A.loaders.lazy.resolve(
        defer({
          critical: "CRITICAL",
          lazy: dfd.promise,
        })
      );

      await t.navigate("/not-found");
      // Navigation completes immediately and deferreds are cancelled
      expect(t.router.state.loaderData).toEqual({});

      // Resolution doesn't do anything
      await dfd.resolve("Nope!");
      expect(t.router.state.loaderData).toEqual({});
    });

    it("cancels pending deferreds on errored GET submissions (w/ reused routes)", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
            loader: true,
          },
          {
            id: "parent",
            path: "parent",
            loader: true,
            hasErrorBoundary: true,
            children: [
              {
                id: "a",
                path: "a",
                loader: true,
              },
              {
                id: "b",
                path: "b",
                loader: true,
              },
            ],
          },
        ],
        hydrationData: { loaderData: { index: "INDEX" } },
        initialEntries: ["/"],
      });

      // Navigate to /parent/a and kick off a deferred's for both
      let A = await t.navigate("/parent/a");
      let parentDfd = createDeferred();
      await A.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT",
          lazy: parentDfd.promise,
        })
      );
      let aDfd = createDeferred();
      await A.loaders.a.resolve(
        defer({
          critical: "CRITICAL A",
          lazy: aDfd.promise,
        })
      );
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(),
        },
        a: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(),
        },
      });

      // Perform an invalid navigation to /parent/b which will be handled
      // using parent's error boundary.  Parent's deferred should be left alone
      // while A's should be cancelled since they will no longer be rendered
      let B = await t.navigate("/parent/b");
      await B.loaders.b.reject(
        new Response("broken", { status: 400, statusText: "Bad Request" })
      );

      // Navigation completes immediately with an error at the boundary
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(),
        },
      });
      expect(t.router.state.errors).toEqual({
        parent: new ErrorResponse(400, "Bad Request", "broken", false),
      });

      await parentDfd.resolve("Yep!");
      await aDfd.resolve("Nope!");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise("Yep!"),
        },
      });
    });

    it("cancels pending deferreds on errored GET submissions (w/o reused routes)", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
            loader: true,
          },
          {
            id: "a",
            path: "a",
            loader: true,
            children: [
              {
                id: "aChild",
                path: "child",
                loader: true,
              },
            ],
          },
          {
            id: "b",
            path: "b",
            loader: true,
            children: [
              {
                id: "bChild",
                path: "child",
                loader: true,
                hasErrorBoundary: true,
              },
            ],
          },
        ],
        hydrationData: { loaderData: { index: "INDEX" } },
        initialEntries: ["/"],
      });

      // Navigate to /parent/a and kick off deferred's for both
      let A = await t.navigate("/a/child");
      let aDfd = createDeferred();
      await A.loaders.a.resolve(
        defer({
          critical: "CRITICAL A",
          lazy: aDfd.promise,
        })
      );
      let aChildDfd = createDeferred();
      await A.loaders.aChild.resolve(
        defer({
          critical: "CRITICAL A CHILD",
          lazy: aChildDfd.promise,
        })
      );
      expect(t.router.state.loaderData).toEqual({
        a: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(),
        },
        aChild: {
          critical: "CRITICAL A CHILD",
          lazy: expect.trackedPromise(),
        },
      });

      // Perform an invalid navigation to /b/child which should cancel all
      // pending deferred's since nothing is reused.  It should not call bChild's
      // loader since it's below the boundary but should call b's loader.
      let B = await t.navigate("/b/child");

      await B.loaders.bChild.reject(
        new Response("broken", { status: 400, statusText: "Bad Request" })
      );

      // Both should be cancelled
      await aDfd.resolve("Nope!");
      await aChildDfd.resolve("Nope!");
      expect(t.router.state.loaderData).toEqual({
        a: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(null, null, true),
        },
        aChild: {
          critical: "CRITICAL A CHILD",
          lazy: expect.trackedPromise(null, null, true),
        },
      });

      await B.loaders.b.resolve("B LOADER");
      expect(t.router.state.loaderData).toEqual({
        b: "B LOADER",
      });
      expect(t.router.state.errors).toEqual({
        bChild: new ErrorResponse(400, "Bad Request", "broken", false),
      });
    });

    it("does not cancel pending deferreds on hash change only navigations", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
            loader: true,
          },
          {
            id: "lazy",
            path: "lazy",
            loader: true,
          },
        ],
        hydrationData: { loaderData: { index: "INDEX" } },
        initialEntries: ["/"],
      });

      let A = await t.navigate("/lazy");
      let dfd = createDeferred();
      await A.loaders.lazy.resolve(
        defer({
          critical: "CRITICAL",
          lazy: dfd.promise,
        })
      );

      await t.navigate("/lazy#hash");
      expect(t.router.state.loaderData).toEqual({
        lazy: {
          critical: "CRITICAL",
          lazy: expect.trackedPromise(),
        },
      });

      await dfd.resolve("Yep!");
      expect(t.router.state.loaderData).toEqual({
        lazy: {
          critical: "CRITICAL",
          lazy: expect.trackedPromise("Yep!"),
        },
      });
    });

    it("cancels pending deferreds on action submissions", async () => {
      let shouldRevalidateSpy = jest.fn(() => false);
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
            loader: true,
          },
          {
            id: "parent",
            path: "parent",
            loader: true,
            shouldRevalidate: shouldRevalidateSpy,
            children: [
              {
                id: "a",
                path: "a",
                loader: true,
              },
              {
                id: "b",
                path: "b",
                action: true,
              },
            ],
          },
        ],
        hydrationData: { loaderData: { index: "INDEX" } },
        initialEntries: ["/"],
      });

      let A = await t.navigate("/parent/a");
      let parentDfd = createDeferred();
      await A.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT",
          lazy: parentDfd.promise,
        })
      );
      let aDfd = createDeferred();
      await A.loaders.a.resolve(
        defer({
          critical: "CRITICAL A",
          lazy: aDfd.promise,
        })
      );

      // Action submission causes all to be cancelled, even reused ones, and
      // ignores shouldRevalidate since the cancelled active deferred means we
      // are missing data
      let B = await t.navigate("/parent/b", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await parentDfd.resolve("Nope!");
      await aDfd.resolve("Nope!");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(null, null, true),
        },
        a: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(null, null, true),
        },
      });

      await B.actions.b.resolve("ACTION");
      let parentDfd2 = createDeferred();
      await B.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT 2",
          lazy: parentDfd2.promise,
        })
      );
      expect(t.router.state.actionData).toEqual({
        b: "ACTION",
      });
      // Since we still have outstanding deferreds on the revalidation, we're
      // still in the loading state and showing the old data
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(null, null, true),
        },
        a: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(null, null, true),
        },
      });

      await parentDfd2.resolve("Yep!");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT 2",
          lazy: expect.trackedPromise("Yep!"),
        },
      });

      expect(shouldRevalidateSpy).not.toHaveBeenCalled();
    });

    it("does not put resolved deferred's back into a loading state during revalidation", async () => {
      let shouldRevalidateSpy = jest.fn(() => false);
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
            loader: true,
          },
          {
            id: "parent",
            path: "parent",
            loader: true,
            shouldRevalidate: shouldRevalidateSpy,
            children: [
              {
                id: "a",
                path: "a",
                loader: true,
              },
              {
                id: "b",
                path: "b",
                action: true,
                loader: true,
              },
            ],
          },
        ],
        hydrationData: { loaderData: { index: "INDEX" } },
        initialEntries: ["/"],
      });

      // Route to /parent/a and return and resolve deferred's for both
      let A = await t.navigate("/parent/a");
      let parentDfd1 = createDeferred();
      let parentDfd2 = createDeferred();
      await A.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT",
          lazy1: parentDfd1.promise,
          lazy2: parentDfd2.promise,
        })
      );
      let aDfd1 = createDeferred();
      let aDfd2 = createDeferred();
      await A.loaders.a.resolve(
        defer({
          critical: "CRITICAL A",
          lazy1: aDfd1.promise,
          lazy2: aDfd2.promise,
        })
      );

      // Resolve one of the deferred for each prior to the action submission
      await parentDfd1.resolve("LAZY PARENT 1");
      await aDfd1.resolve("LAZY A 1");

      // Action submission causes all to be cancelled, even reused ones, and
      // ignores shouldRevalidate since the cancelled active deferred means we
      // are missing data
      let B = await t.navigate("/parent/b", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await parentDfd2.resolve("Nope!");
      await aDfd2.resolve("Nope!");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy1: expect.trackedPromise("LAZY PARENT 1"),
          lazy2: expect.trackedPromise(null, null, true),
        },
        a: {
          critical: "CRITICAL A",
          lazy1: expect.trackedPromise("LAZY A 1"),
          lazy2: expect.trackedPromise(null, null, true),
        },
      });

      await B.actions.b.resolve("ACTION");
      let parentDfd1Revalidation = createDeferred();
      let parentDfd2Revalidation = createDeferred();
      await B.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT*",
          lazy1: parentDfd1Revalidation.promise,
          lazy2: parentDfd2Revalidation.promise,
        })
      );
      await B.loaders.b.resolve("B");

      // At this point, we resolved the action and the loaders - however the
      // parent loader returned a deferred so we stay in the "loading" state
      // until everything resolves
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.actionData).toEqual({
        b: "ACTION",
      });
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy1: expect.trackedPromise("LAZY PARENT 1"),
          lazy2: expect.trackedPromise(null, null, true),
        },
        a: {
          critical: "CRITICAL A",
          lazy1: expect.trackedPromise("LAZY A 1"),
          lazy2: expect.trackedPromise(null, null, true),
        },
      });

      // Resolve the first deferred - should not complete the navigation yet
      await parentDfd1Revalidation.resolve("LAZY PARENT 1*");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy1: expect.trackedPromise("LAZY PARENT 1"),
          lazy2: expect.trackedPromise(null, null, true),
        },
        a: {
          critical: "CRITICAL A",
          lazy1: expect.trackedPromise("LAZY A 1"),
          lazy2: expect.trackedPromise(null, null, true),
        },
      });

      await parentDfd2Revalidation.resolve("LAZY PARENT 2*");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.actionData).toEqual({
        b: "ACTION",
      });
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT*",
          lazy1: expect.trackedPromise("LAZY PARENT 1*"),
          lazy2: expect.trackedPromise("LAZY PARENT 2*"),
        },
        b: "B",
      });

      expect(shouldRevalidateSpy).not.toHaveBeenCalled();
    });

    it("triggers fallbacks on new dynamic route instances", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
            loader: true,
          },
          {
            id: "invoice",
            path: "invoices/:id",
            loader: true,
          },
        ],
        hydrationData: { loaderData: { index: "INDEX" } },
        initialEntries: ["/"],
      });

      let A = await t.navigate("/invoices/1");
      let dfd1 = createDeferred();
      await A.loaders.invoice.resolve(defer({ lazy: dfd1.promise }));
      expect(t.router.state.loaderData).toEqual({
        invoice: {
          lazy: expect.trackedPromise(),
        },
      });

      await dfd1.resolve("DATA 1");
      expect(t.router.state.loaderData).toEqual({
        invoice: {
          lazy: expect.trackedPromise("DATA 1"),
        },
      });

      // Goes back into a loading state since this is a new instance of the
      // invoice route
      let B = await t.navigate("/invoices/2");
      let dfd2 = createDeferred();
      await B.loaders.invoice.resolve(defer({ lazy: dfd2.promise }));
      expect(t.router.state.loaderData).toEqual({
        invoice: {
          lazy: expect.trackedPromise(),
        },
      });

      await dfd2.resolve("DATA 2");
      expect(t.router.state.loaderData).toEqual({
        invoice: {
          lazy: expect.trackedPromise("DATA 2"),
        },
      });
    });

    it("triggers fallbacks on new splat route instances", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
            loader: true,
          },
          {
            id: "invoices",
            path: "invoices",
            children: [
              {
                id: "invoice",
                path: "*",
                loader: true,
              },
            ],
          },
        ],
        hydrationData: { loaderData: { index: "INDEX" } },
        initialEntries: ["/"],
      });

      let A = await t.navigate("/invoices/1");
      let dfd1 = createDeferred();
      await A.loaders.invoice.resolve(defer({ lazy: dfd1.promise }));
      expect(t.router.state.loaderData).toEqual({
        invoice: {
          lazy: expect.trackedPromise(),
        },
      });

      await dfd1.resolve("DATA 1");
      expect(t.router.state.loaderData).toEqual({
        invoice: {
          lazy: expect.trackedPromise("DATA 1"),
        },
      });

      // Goes back into a loading state since this is a new instance of the
      // invoice route
      let B = await t.navigate("/invoices/2");
      let dfd2 = createDeferred();
      await B.loaders.invoice.resolve(defer({ lazy: dfd2.promise }));
      expect(t.router.state.loaderData).toEqual({
        invoice: {
          lazy: expect.trackedPromise(),
        },
      });

      await dfd2.resolve("DATA 2");
      expect(t.router.state.loaderData).toEqual({
        invoice: {
          lazy: expect.trackedPromise("DATA 2"),
        },
      });
    });

    it("cancels awaited reused deferreds on subsequent navigations", async () => {
      let shouldRevalidateSpy = jest.fn(() => false);
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
            loader: true,
          },
          {
            id: "parent",
            path: "parent",
            loader: true,
            shouldRevalidate: shouldRevalidateSpy,
            children: [
              {
                id: "a",
                path: "a",
                loader: true,
              },
              {
                id: "b",
                path: "b",
                action: true,
                loader: true,
              },
            ],
          },
        ],
        hydrationData: { loaderData: { index: "INDEX" } },
        initialEntries: ["/"],
      });

      // Route to /parent/a and return and resolve deferred's for both
      let A = await t.navigate("/parent/a");
      let parentDfd = createDeferred(); // Never resolves in this test
      await A.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT",
          lazy: parentDfd.promise,
        })
      );
      let aDfd = createDeferred();
      await A.loaders.a.resolve(
        defer({
          critical: "CRITICAL A",
          lazy: aDfd.promise,
        })
      );

      // Action submission to cancel deferreds
      let B = await t.navigate("/parent/b", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(),
        },
        a: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(),
        },
      });

      await B.actions.b.resolve("ACTION");
      let parentDfd2 = createDeferred(); // Never resolves in this test
      await B.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT*",
          lazy: parentDfd2.promise,
        })
      );
      await B.loaders.b.resolve("B");

      // Still in loading state due to revalidation deferred
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(null, null, true),
        },
        a: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(null, null, true),
        },
      });

      // Navigate elsewhere - should cancel/abort revalidation deferreds
      let C = await t.navigate("/");
      await C.loaders.index.resolve("INDEX*");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.actionData).toEqual(null);
      expect(t.router.state.loaderData).toEqual({
        index: "INDEX*",
      });
    });

    it("does not support deferred data on fetcher loads", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
          },
          {
            id: "fetch",
            path: "fetch",
            loader: true,
          },
        ],
        initialEntries: ["/"],
      });

      let key = "key";
      let A = await t.fetch("/fetch", key);

      // deferred in a fetcher awaits all data in the loading state
      let dfd = createDeferred();
      await A.loaders.fetch.resolve(
        defer({
          critical: "1",
          lazy: dfd.promise,
        })
      );
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "loading",
        data: undefined,
      });

      await dfd.resolve("2");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: {
          critical: "1",
          lazy: "2",
        },
      });

      // Trigger a revalidation for the same fetcher
      let B = await t.revalidate("fetch", "fetch");
      expect(t.router.state.revalidation).toBe("loading");
      let dfd2 = createDeferred();
      await B.loaders.fetch.resolve(
        defer({
          critical: "3",
          lazy: dfd2.promise,
        })
      );
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: {
          critical: "1",
          lazy: "2",
        },
      });

      await dfd2.resolve("4");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: {
          critical: "3",
          lazy: "4",
        },
      });
    });

    it("triggers error boundaries if fetcher deferred data rejects", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
          },
          {
            id: "fetch",
            path: "fetch",
            loader: true,
          },
        ],
        initialEntries: ["/"],
      });

      let key = "key";
      let A = await t.fetch("/fetch", key);

      let dfd = createDeferred();
      await A.loaders.fetch.resolve(
        defer({
          critical: "1",
          lazy: dfd.promise,
        })
      );
      await dfd.reject(new Error("Kaboom!"));
      expect(t.router.state.errors).toMatchObject({
        index: new Error("Kaboom!"),
      });
      expect(t.router.state.fetchers.get(key)).toBeUndefined();
    });

    it("cancels pending deferreds on fetcher reloads", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
          },
          {
            id: "fetch",
            path: "fetch",
            loader: true,
          },
        ],
        initialEntries: ["/"],
      });

      let key = "key";
      let A = await t.fetch("/fetch", key);

      // deferred in a fetcher awaits all data in the loading state
      let dfd1 = createDeferred();
      let loaderPromise1 = A.loaders.fetch.resolve(
        defer({
          critical: "1",
          lazy: dfd1.promise,
        })
      );
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "loading",
        data: undefined,
      });

      // Fetch again
      let B = await t.fetch("/fetch", key);

      let dfd2 = createDeferred();
      let loaderPromise2 = B.loaders.fetch.resolve(
        defer({
          critical: "3",
          lazy: dfd2.promise,
        })
      );
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "loading",
        data: undefined,
      });

      // Resolving the second finishes us up
      await dfd1.resolve("2");
      await dfd2.resolve("4");
      await loaderPromise1;
      await loaderPromise2;
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: {
          critical: "3",
          lazy: "4",
        },
      });
    });

    it("cancels pending deferreds on fetcher action submissions", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
            loader: true,
          },
          {
            id: "parent",
            path: "parent",
            loader: true,
            shouldRevalidate: () => false,
            children: [
              {
                id: "a",
                path: "a",
                loader: true,
              },
              {
                id: "b",
                path: "b",
                action: true,
              },
            ],
          },
        ],
        hydrationData: { loaderData: { index: "INDEX" } },
        initialEntries: ["/"],
      });

      let A = await t.navigate("/parent/a");
      let parentDfd = createDeferred();
      await A.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT",
          lazy: parentDfd.promise,
        })
      );
      let aDfd = createDeferred();
      await A.loaders.a.resolve(
        defer({
          critical: "CRITICAL A",
          lazy: aDfd.promise,
        })
      );

      // Fetcher action submission causes all to be cancelled and
      // ignores shouldRevalidate since the cancelled active deferred means we
      // are missing data
      let key = "key";
      let B = await t.fetch("/parent/b", key, {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await parentDfd.resolve("Nope!");
      await aDfd.resolve("Nope!");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(null, null, true),
        },
        a: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(null, null, true),
        },
      });

      await B.actions.b.resolve("ACTION");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "loading",
        data: "ACTION",
      });

      await B.actions.b.resolve("ACTION");
      let parentDfd2 = createDeferred();
      await B.loaders.parent.resolve(
        defer({
          critical: "CRITICAL PARENT 2",
          lazy: parentDfd2.promise,
        })
      );
      let aDfd2 = createDeferred();
      await B.loaders.a.resolve(
        defer({
          critical: "CRITICAL A 2",
          lazy: aDfd2.promise,
        })
      );

      // Still showing old data while we wait on revalidation deferreds to
      // complete
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT",
          lazy: expect.trackedPromise(null, null, true),
        },
        a: {
          critical: "CRITICAL A",
          lazy: expect.trackedPromise(null, null, true),
        },
      });

      await parentDfd2.resolve("Yep!");
      await aDfd2.resolve("Yep!");
      expect(t.router.state.loaderData).toEqual({
        parent: {
          critical: "CRITICAL PARENT 2",
          lazy: expect.trackedPromise("Yep!"),
        },
        a: {
          critical: "CRITICAL A 2",
          lazy: expect.trackedPromise("Yep!"),
        },
      });
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "ACTION",
      });
    });

    it("differentiates between navigation and fetcher deferreds on cancellations", async () => {
      let dfds: Array<ReturnType<typeof createDeferred>> = [];
      let signals: Array<AbortSignal> = [];
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/"] }),
        routes: [
          {
            id: "root",
            path: "/",
            loader: ({ request }) => {
              let dfd = createDeferred();
              dfds.push(dfd);
              signals.push(request.signal);
              return defer({ value: dfd.promise });
            },
          },
        ],
        hydrationData: {
          loaderData: {
            root: { value: -1 },
          },
        },
      });

      // navigate to root, kicking off a reload of the root loader
      let key = "key";
      router.navigate("/");
      router.fetch(key, "root", "/");
      await tick();
      expect(router.state.navigation.state).toBe("loading");
      expect(router.state.loaderData).toEqual({
        root: { value: -1 },
      });
      expect(router.state.fetchers.get(key)).toMatchObject({
        state: "loading",
        data: undefined,
      });

      // Interrupt with a revalidation
      router.revalidate();

      // Original deferreds should do nothing on resolution
      dfds[0].resolve(0);
      dfds[1].resolve(1);
      await tick();
      expect(router.state.navigation.state).toBe("loading");
      expect(router.state.loaderData).toEqual({
        root: { value: -1 },
      });
      expect(router.state.fetchers.get(key)).toMatchObject({
        state: "loading",
        data: undefined,
      });

      // New deferreds should complete the revalidation
      dfds[2].resolve(2);
      dfds[3].resolve(3);
      await tick();
      expect(router.state.navigation.state).toBe("idle");
      expect(router.state.loaderData).toEqual({
        root: { value: expect.trackedPromise(2) },
      });
      expect(router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: { value: 3 },
      });

      // Assert that both the route loader and fetcher loader were aborted
      expect(signals[0].aborted).toBe(true); // initial route
      expect(signals[1].aborted).toBe(true); // initial fetcher
      expect(signals[2].aborted).toBe(false); // revalidating route
      expect(signals[3].aborted).toBe(false); // revalidating fetcher

      expect(router._internalActiveDeferreds.size).toBe(0);
      expect(router._internalFetchControllers.size).toBe(0);
      router.dispose();
    });
  });

  describe("lazily loaded route modules", () => {
    const LAZY_ROUTES: TestRouteObject[] = [
      {
        id: "root",
        path: "/",
        children: [
          {
            id: "lazy",
            path: "/lazy",
            lazy: true,
          },
        ],
      },
    ];

    describe("happy path", () => {
      it("fetches lazy route modules on loading navigation", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        let dfd = createDeferred();
        A.lazy.lazy.resolve({
          loader: () => dfd.promise,
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        await dfd.resolve("LAZY LOADER");

        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.loaderData).toEqual({
          lazy: "LAZY LOADER",
        });
      });

      it("fetches lazy route modules on submission navigation", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        let actionDfd = createDeferred();
        let loaderDfd = createDeferred();
        A.lazy.lazy.resolve({
          action: () => actionDfd.promise,
          loader: () => loaderDfd.promise,
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        await actionDfd.resolve("LAZY ACTION");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");
        expect(t.router.state.actionData).toEqual({
          lazy: "LAZY ACTION",
        });
        expect(t.router.state.loaderData).toEqual({});

        await loaderDfd.resolve("LAZY LOADER");
        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.actionData).toEqual({
          lazy: "LAZY ACTION",
        });
        expect(t.router.state.loaderData).toEqual({
          lazy: "LAZY LOADER",
        });
      });

      it("fetches lazy route modules on fetcher.load", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let key = "key";
        let A = await t.fetch("/lazy", key);
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        let loaderDfd = createDeferred();
        await A.lazy.lazy.resolve({
          loader: () => loaderDfd.promise,
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        await loaderDfd.resolve("LAZY LOADER");
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBe("LAZY LOADER");
      });

      it("fetches lazy route modules on fetcher.submit", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let key = "key";
        let A = await t.fetch("/lazy", key, {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

        let actionDfd = createDeferred();
        await A.lazy.lazy.resolve({
          action: () => actionDfd.promise,
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

        await actionDfd.resolve("LAZY ACTION");
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBe("LAZY ACTION");
      });

      it("fetches lazy route modules on staticHandler.query()", async () => {
        let { query } = createStaticHandler([
          {
            id: "lazy",
            path: "/lazy",
            lazy: async () => {
              await tick();
              return {
                async loader() {
                  return json({ value: "LAZY LOADER" });
                },
              };
            },
          },
        ]);

        let context = await query(createRequest("/lazy"));
        invariant(
          !(context instanceof Response),
          "Expected a StaticContext instance"
        );
        expect(context.loaderData).toEqual({ lazy: { value: "LAZY LOADER" } });
      });

      it("fetches lazy route modules on staticHandler.queryRoute()", async () => {
        let { queryRoute } = createStaticHandler([
          {
            id: "lazy",
            path: "/lazy",
            lazy: async () => {
              await tick();
              return {
                async loader() {
                  return json({ value: "LAZY LOADER" });
                },
              };
            },
          },
        ]);

        let response = await queryRoute(createRequest("/lazy"));
        let data = await response.json();
        expect(data).toEqual({ value: "LAZY LOADER" });
      });
    });

    describe("statically defined fields", () => {
      it("prefers statically defined loader over lazily defined loader", async () => {
        let consoleWarn = jest.spyOn(console, "warn");
        let t = setup({
          routes: [
            {
              id: "lazy",
              path: "/lazy",
              loader: true,
              lazy: true,
            },
          ],
        });

        let A = await t.navigate("/lazy");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");
        // Execute in parallel
        expect(A.loaders.lazy.stub).toHaveBeenCalled();
        expect(A.lazy.lazy.stub).toHaveBeenCalled();

        let lazyLoaderStub = jest.fn(() => "LAZY LOADER");
        await A.lazy.lazy.resolve({
          loader: lazyLoaderStub,
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        await A.loaders.lazy.resolve("STATIC LOADER");
        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.loaderData).toEqual({
          lazy: "STATIC LOADER",
        });

        let lazyRoute = findRouteById(t.router.routes, "lazy");
        expect(lazyRoute.lazy).toBeUndefined();
        expect(lazyRoute.loader).toEqual(expect.any(Function));
        expect(lazyRoute.loader).not.toBe(lazyLoaderStub);
        expect(lazyLoaderStub).not.toHaveBeenCalled();

        expect(consoleWarn).toHaveBeenCalledTimes(1);
        expect(consoleWarn.mock.calls[0][0]).toMatchInlineSnapshot(
          `"Route "lazy" has a static property "loader" defined but its lazy function is also returning a value for this property. The lazy route property "loader" will be ignored."`
        );
        consoleWarn.mockReset();
      });

      it("prefers statically defined action over lazily loaded action", async () => {
        let consoleWarn = jest.spyOn(console, "warn");
        let t = setup({
          routes: [
            {
              id: "lazy",
              path: "/lazy",
              action: true,
              lazy: true,
            },
          ],
        });

        let A = await t.navigate("/lazy", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");
        // Execute in parallel
        expect(A.actions.lazy.stub).toHaveBeenCalled();
        expect(A.lazy.lazy.stub).toHaveBeenCalled();

        let lazyActionStub = jest.fn(() => "LAZY ACTION");
        let loaderDfd = createDeferred();
        await A.lazy.lazy.resolve({
          action: lazyActionStub,
          loader: () => loaderDfd.promise,
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        await A.actions.lazy.resolve("STATIC ACTION");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");
        expect(t.router.state.actionData).toEqual({
          lazy: "STATIC ACTION",
        });
        expect(t.router.state.loaderData).toEqual({});

        await loaderDfd.resolve("LAZY LOADER");
        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.actionData).toEqual({
          lazy: "STATIC ACTION",
        });
        expect(t.router.state.loaderData).toEqual({
          lazy: "LAZY LOADER",
        });

        let lazyRoute = findRouteById(t.router.routes, "lazy");
        expect(lazyRoute.lazy).toBeUndefined();
        expect(lazyRoute.action).toEqual(expect.any(Function));
        expect(lazyRoute.action).not.toBe(lazyActionStub);
        expect(lazyActionStub).not.toHaveBeenCalled();

        expect(consoleWarn).toHaveBeenCalledTimes(1);
        expect(consoleWarn.mock.calls[0][0]).toMatchInlineSnapshot(
          `"Route "lazy" has a static property "action" defined but its lazy function is also returning a value for this property. The lazy route property "action" will be ignored."`
        );
        consoleWarn.mockReset();
      });

      it("prefers statically defined action/loader over lazily defined action/loader", async () => {
        let consoleWarn = jest.spyOn(console, "warn");
        let t = setup({
          routes: [
            {
              id: "lazy",
              path: "/lazy",
              action: true,
              loader: true,
              lazy: true,
            },
          ],
        });

        let A = await t.navigate("/lazy", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        let lazyActionStub = jest.fn(() => "LAZY ACTION");
        let lazyLoaderStub = jest.fn(() => "LAZY LOADER");
        await A.lazy.lazy.resolve({
          action: lazyActionStub,
          loader: lazyLoaderStub,
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        await A.actions.lazy.resolve("STATIC ACTION");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");
        expect(t.router.state.actionData).toEqual({
          lazy: "STATIC ACTION",
        });
        expect(t.router.state.loaderData).toEqual({});

        await A.loaders.lazy.resolve("STATIC LOADER");
        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.actionData).toEqual({
          lazy: "STATIC ACTION",
        });
        expect(t.router.state.loaderData).toEqual({
          lazy: "STATIC LOADER",
        });

        let lazyRoute = findRouteById(t.router.routes, "lazy");
        expect(lazyRoute.lazy).toBeUndefined();
        expect(lazyRoute.action).toEqual(expect.any(Function));
        expect(lazyRoute.loader).toEqual(expect.any(Function));
        expect(lazyRoute.action).not.toBe(lazyActionStub);
        expect(lazyRoute.loader).not.toBe(lazyLoaderStub);
        expect(lazyActionStub).not.toHaveBeenCalled();
        expect(lazyLoaderStub).not.toHaveBeenCalled();

        expect(consoleWarn).toHaveBeenCalledTimes(2);
        expect(consoleWarn.mock.calls[0][0]).toMatchInlineSnapshot(
          `"Route "lazy" has a static property "action" defined but its lazy function is also returning a value for this property. The lazy route property "action" will be ignored."`
        );
        expect(consoleWarn.mock.calls[1][0]).toMatchInlineSnapshot(
          `"Route "lazy" has a static property "loader" defined but its lazy function is also returning a value for this property. The lazy route property "loader" will be ignored."`
        );
        consoleWarn.mockReset();
      });

      it("prefers statically defined loader over lazily defined loader (staticHandler.query)", async () => {
        let consoleWarn = jest.spyOn(console, "warn");
        let lazyLoaderStub = jest.fn(async () => {
          await tick();
          return json({ value: "LAZY LOADER" });
        });

        let { query } = createStaticHandler([
          {
            id: "lazy",
            path: "/lazy",
            loader: async () => {
              await tick();
              return json({ value: "STATIC LOADER" });
            },
            lazy: async () => {
              await tick();
              return {
                loader: lazyLoaderStub,
              };
            },
          },
        ]);

        let context = await query(createRequest("/lazy"));
        invariant(
          !(context instanceof Response),
          "Expected a StaticContext instance"
        );
        expect(context.loaderData).toEqual({
          lazy: { value: "STATIC LOADER" },
        });
        expect(lazyLoaderStub).not.toHaveBeenCalled();

        expect(consoleWarn).toHaveBeenCalledTimes(1);
        expect(consoleWarn.mock.calls[0][0]).toMatchInlineSnapshot(
          `"Route "lazy" has a static property "loader" defined but its lazy function is also returning a value for this property. The lazy route property "loader" will be ignored."`
        );
        consoleWarn.mockReset();
      });

      it("prefers statically defined loader over lazily defined loader (staticHandler.queryRoute)", async () => {
        let consoleWarn = jest.spyOn(console, "warn");
        let lazyLoaderStub = jest.fn(async () => {
          await tick();
          return json({ value: "LAZY LOADER" });
        });

        let { query } = createStaticHandler([
          {
            id: "lazy",
            path: "/lazy",
            loader: async () => {
              await tick();
              return json({ value: "STATIC LOADER" });
            },
            lazy: async () => {
              await tick();
              return {
                loader: lazyLoaderStub,
              };
            },
          },
        ]);

        let context = await query(createRequest("/lazy"));
        invariant(
          !(context instanceof Response),
          "Expected a StaticContext instance"
        );
        expect(context.loaderData).toEqual({
          lazy: { value: "STATIC LOADER" },
        });
        expect(lazyLoaderStub).not.toHaveBeenCalled();

        expect(consoleWarn).toHaveBeenCalledTimes(1);
        expect(consoleWarn.mock.calls[0][0]).toMatchInlineSnapshot(
          `"Route "lazy" has a static property "loader" defined but its lazy function is also returning a value for this property. The lazy route property "loader" will be ignored."`
        );
        consoleWarn.mockReset();
      });
    });

    describe("interruptions", () => {
      it("runs lazily loaded route loader even if lazy() is interrupted", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        await t.navigate("/");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("idle");

        let lazyLoaderStub = jest.fn(() => "LAZY LOADER");
        await A.lazy.lazy.resolve({
          loader: lazyLoaderStub,
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(lazyLoaderStub).toHaveBeenCalledTimes(1);

        // Ensure the lazy route object update still happened
        let lazyRoute = findRouteById(t.router.routes, "lazy");
        expect(lazyRoute.lazy).toBeUndefined();
        expect(lazyRoute.loader).toBe(lazyLoaderStub);
      });

      it("runs lazily loaded route action even if lazy() is interrupted", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        await t.navigate("/");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("idle");

        let lazyActionStub = jest.fn(() => "LAZY ACTION");
        let lazyLoaderStub = jest.fn(() => "LAZY LOADER");
        await A.lazy.lazy.resolve({
          action: lazyActionStub,
          loader: lazyLoaderStub,
        });

        let lazyRoute = findRouteById(t.router.routes, "lazy");
        expect(lazyActionStub).toHaveBeenCalledTimes(1);
        expect(lazyLoaderStub).not.toHaveBeenCalled();
        expect(lazyRoute.lazy).toBeUndefined();
        expect(lazyRoute.action).toBe(lazyActionStub);
        expect(lazyRoute.loader).toBe(lazyLoaderStub);
      });

      it("runs lazily loaded route loader on fetcher.load() even if lazy() is interrupted", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let key = "key";
        let A = await t.fetch("/lazy", key);
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        let B = await t.fetch("/lazy", key);
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        // Resolve B's lazy route first
        let loaderDfdB = createDeferred();
        let lazyloaderStubB = jest.fn(() => loaderDfdB.promise);
        await B.lazy.lazy.resolve({
          loader: lazyloaderStubB,
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        // Resolve A's lazy route after B
        let loaderDfdA = createDeferred();
        let lazyLoaderStubA = jest.fn(() => loaderDfdA.promise);
        await A.lazy.lazy.resolve({
          loader: lazyLoaderStubA,
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        await loaderDfdA.resolve("LAZY LOADER A");
        await loaderDfdB.resolve("LAZY LOADER B");

        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBe("LAZY LOADER B");
        expect(lazyLoaderStubA).not.toHaveBeenCalled();
        expect(lazyloaderStubB).toHaveBeenCalledTimes(2);
      });

      it("runs lazily loaded route action on fetcher.submit() even if lazy() is interrupted", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let key = "key";
        let A = await t.fetch("/lazy", key, {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

        let B = await t.fetch("/lazy", key, {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

        // Resolve B's lazy route first
        let actionDfdB = createDeferred();
        let lazyActionStubB = jest.fn(() => actionDfdB.promise);
        await B.lazy.lazy.resolve({
          action: lazyActionStubB,
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

        // Resolve A's lazy route after B
        let actionDfdA = createDeferred();
        let lazyActionStubA = jest.fn(() => actionDfdA.promise);
        await A.lazy.lazy.resolve({
          action: lazyActionStubA,
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

        await actionDfdA.resolve("LAZY ACTION A");
        await actionDfdB.resolve("LAZY ACTION B");

        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBe("LAZY ACTION B");
        expect(lazyActionStubA).not.toHaveBeenCalled();
        expect(lazyActionStubB).toHaveBeenCalledTimes(2);
      });

      it("uses the first-resolved lazy() execution on repeated loading navigations", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        let B = await t.navigate("/lazy");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        // Resolve B's lazy route first
        let loaderDfdB = createDeferred();
        let lazyLoaderStubB = jest.fn(() => loaderDfdB.promise);
        await B.lazy.lazy.resolve({
          loader: lazyLoaderStubB,
        });

        // Resolve A's lazy route after B
        let loaderDfdA = createDeferred();
        let lazyLoaderStubA = jest.fn(() => loaderDfdA.promise);
        await A.lazy.lazy.resolve({
          loader: lazyLoaderStubA,
        });

        await loaderDfdA.resolve("LAZY LOADER A");
        await loaderDfdB.resolve("LAZY LOADER B");

        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");

        expect(t.router.state.loaderData).toEqual({ lazy: "LAZY LOADER B" });

        expect(lazyLoaderStubA).not.toHaveBeenCalled();
        expect(lazyLoaderStubB).toHaveBeenCalledTimes(2);
      });

      it("uses the first-resolved lazy() execution on repeated submission navigations", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        let B = await t.navigate("/lazy", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        // Resolve B's lazy route first
        let loaderDfdB = createDeferred();
        let actionDfdB = createDeferred();
        let lazyLoaderStubB = jest.fn(() => loaderDfdB.promise);
        let lazyActionStubB = jest.fn(() => actionDfdB.promise);
        await B.lazy.lazy.resolve({
          action: lazyActionStubB,
          loader: lazyLoaderStubB,
        });

        // Resolve A's lazy route after B
        let loaderDfdA = createDeferred();
        let actionDfdA = createDeferred();
        let lazyLoaderStubA = jest.fn(() => loaderDfdA.promise);
        let lazyActionStubA = jest.fn(() => actionDfdA.promise);
        await A.lazy.lazy.resolve({
          action: lazyActionStubA,
          loader: lazyLoaderStubA,
        });

        await actionDfdA.resolve("LAZY ACTION A");
        await loaderDfdA.resolve("LAZY LOADER A");
        await actionDfdB.resolve("LAZY ACTION B");
        await loaderDfdB.resolve("LAZY LOADER B");

        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");

        expect(t.router.state.actionData).toEqual({ lazy: "LAZY ACTION B" });
        expect(t.router.state.loaderData).toEqual({ lazy: "LAZY LOADER B" });

        expect(lazyActionStubA).not.toHaveBeenCalled();
        expect(lazyLoaderStubA).not.toHaveBeenCalled();
        expect(lazyActionStubB).toHaveBeenCalledTimes(2);
        expect(lazyLoaderStubB).toHaveBeenCalledTimes(1);
      });

      it("uses the first-resolved lazy() execution on repeated fetcher.load calls", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let key = "key";
        let A = await t.fetch("/lazy", key);
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        let B = await t.fetch("/lazy", key);
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        // Resolve B's lazy route first
        let loaderDfdB = createDeferred();
        let lazyLoaderStubB = jest.fn(() => loaderDfdB.promise);
        await B.lazy.lazy.resolve({
          loader: lazyLoaderStubB,
        });

        // Resolve A's lazy route after B
        let loaderDfdA = createDeferred();
        let lazyLoaderStubA = jest.fn(() => loaderDfdA.promise);
        await A.lazy.lazy.resolve({
          loader: lazyLoaderStubA,
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        await loaderDfdA.resolve("LAZY LOADER A");
        await loaderDfdB.resolve("LAZY LOADER B");

        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBe("LAZY LOADER B");
        expect(lazyLoaderStubA).not.toHaveBeenCalled();
        expect(lazyLoaderStubB).toHaveBeenCalledTimes(2);
      });
    });

    describe("errors", () => {
      it("handles errors when failing to load lazy route modules on initialization", async () => {
        let dfd = createDeferred();
        let router = createRouter({
          history: createMemoryHistory({ initialEntries: ["/lazy"] }),
          routes: [
            {
              id: "root",
              path: "/",
              hasErrorBoundary: true,
              children: [
                {
                  id: "lazy",
                  path: "lazy",
                  lazy: () => dfd.promise as Promise<AgnosticDataRouteObject>,
                },
              ],
            },
          ],
        }).initialize();

        expect(router.state.initialized).toBe(false);
        dfd.reject(new Error("LAZY FUNCTION ERROR"));
        await tick();
        expect(router.state.errors).toEqual({
          root: new Error("LAZY FUNCTION ERROR"),
        });
        expect(router.state.initialized).toBe(true);
      });

      it("handles errors when failing to load lazy route modules on loading navigation", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        await A.lazy.lazy.reject(new Error("LAZY FUNCTION ERROR"));
        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");

        expect(t.router.state.loaderData).toEqual({});
        expect(t.router.state.errors).toEqual({
          root: new Error("LAZY FUNCTION ERROR"),
        });
      });

      it("handles loader errors from lazy route modules when the route has an error boundary", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        let dfd = createDeferred();
        A.lazy.lazy.resolve({
          loader: () => dfd.promise,
          hasErrorBoundary: true,
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        await dfd.reject(new Error("LAZY LOADER ERROR"));

        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.errors).toEqual({
          lazy: new Error("LAZY LOADER ERROR"),
        });
      });

      it("bubbles loader errors from in lazy route modules when the route does not specify an error boundary", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        let dfd = createDeferred();
        A.lazy.lazy.resolve({
          loader: () => dfd.promise,
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        await dfd.reject(new Error("LAZY LOADER ERROR"));

        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.errors).toEqual({
          root: new Error("LAZY LOADER ERROR"),
        });
      });

      it("bubbles loader errors from lazy route modules when the route specifies hasErrorBoundary:false", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy");
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        let dfd = createDeferred();
        A.lazy.lazy.resolve({
          loader: () => dfd.promise,
          hasErrorBoundary: false,
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("loading");

        await dfd.reject(new Error("LAZY LOADER ERROR"));

        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.errors).toEqual({
          root: new Error("LAZY LOADER ERROR"),
        });
      });

      it("handles errors when failing to load lazy route modules on submission navigation", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        await A.lazy.lazy.reject(new Error("LAZY FUNCTION ERROR"));
        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");

        expect(t.router.state.errors).toEqual({
          root: new Error("LAZY FUNCTION ERROR"),
        });
        expect(t.router.state.actionData).toEqual(null);
        expect(t.router.state.loaderData).toEqual({});
      });

      it("handles action errors from lazy route modules on submission navigation", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        let actionDfd = createDeferred();
        A.lazy.lazy.resolve({
          action: () => actionDfd.promise,
          hasErrorBoundary: true,
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        await actionDfd.reject(new Error("LAZY ACTION ERROR"));
        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.actionData).toEqual(null);
        expect(t.router.state.errors).toEqual({
          lazy: new Error("LAZY ACTION ERROR"),
        });
      });

      it("bubbles action errors from lazy route modules when the route specifies hasErrorBoundary:false", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let A = await t.navigate("/lazy", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        let actionDfd = createDeferred();
        A.lazy.lazy.resolve({
          action: () => actionDfd.promise,
          hasErrorBoundary: false,
        });
        expect(t.router.state.location.pathname).toBe("/");
        expect(t.router.state.navigation.state).toBe("submitting");

        await actionDfd.reject(new Error("LAZY ACTION ERROR"));
        expect(t.router.state.location.pathname).toBe("/lazy");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.actionData).toEqual(null);
        expect(t.router.state.errors).toEqual({
          root: new Error("LAZY ACTION ERROR"),
        });
      });

      it("handles errors when failing to load lazy route modules on fetcher.load", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let key = "key";
        let A = await t.fetch("/lazy", key);
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        await A.lazy.lazy.reject(new Error("LAZY FUNCTION ERROR"));
        expect(t.router.state.fetchers.get(key)).toBeUndefined();
        expect(t.router.state.errors).toEqual({
          root: new Error("LAZY FUNCTION ERROR"),
        });
      });

      it("handles loader errors in lazy route modules on fetcher.load", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let key = "key";
        let A = await t.fetch("/lazy", key);
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        let loaderDfd = createDeferred();
        await A.lazy.lazy.resolve({
          loader: () => loaderDfd.promise,
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        await loaderDfd.reject(new Error("LAZY LOADER ERROR"));
        expect(t.router.state.fetchers.get(key)).toBeUndefined();
        expect(t.router.state.errors).toEqual({
          root: new Error("LAZY LOADER ERROR"),
        });
      });

      it("handles errors when failing to load lazy route modules on fetcher.submit", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let key = "key";
        let A = await t.fetch("/lazy", key, {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

        await A.lazy.lazy.reject(new Error("LAZY FUNCTION ERROR"));
        expect(t.router.state.fetchers.get(key)).toBeUndefined();
        expect(t.router.state.errors).toEqual({
          root: new Error("LAZY FUNCTION ERROR"),
        });
      });

      it("handles action errors in lazy route modules on fetcher.submit", async () => {
        let t = setup({ routes: LAZY_ROUTES });

        let key = "key";
        let A = await t.fetch("/lazy", key, {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

        let actionDfd = createDeferred();
        await A.lazy.lazy.resolve({
          action: () => actionDfd.promise,
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

        await actionDfd.reject(new Error("LAZY ACTION ERROR"));
        await tick();
        expect(t.router.state.fetchers.get(key)).toBeUndefined();
        expect(t.router.state.errors).toEqual({
          root: new Error("LAZY ACTION ERROR"),
        });
      });

      it("throws when failing to load lazy route modules on staticHandler.query()", async () => {
        let { query } = createStaticHandler([
          {
            id: "root",
            path: "/",
            children: [
              {
                id: "lazy",
                path: "/lazy",
                lazy: async () => {
                  throw new Error("LAZY FUNCTION ERROR");
                },
              },
            ],
          },
        ]);

        let context = await query(createRequest("/lazy"));
        invariant(
          !(context instanceof Response),
          "Expected a StaticContext instance"
        );
        expect(context.errors).toEqual({
          root: new Error("LAZY FUNCTION ERROR"),
        });
      });

      it("handles loader errors from lazy route modules on staticHandler.query()", async () => {
        let { query } = createStaticHandler([
          {
            id: "root",
            path: "/",
            children: [
              {
                id: "lazy",
                path: "/lazy",
                lazy: async () => {
                  await tick();
                  return {
                    async loader() {
                      throw new Error("LAZY LOADER ERROR");
                    },
                    hasErrorBoundary: true,
                  };
                },
              },
            ],
          },
        ]);

        let context = await query(createRequest("/lazy"));
        invariant(
          !(context instanceof Response),
          "Expected a StaticContext instance"
        );
        expect(context.loaderData).toEqual({
          root: null,
        });
        expect(context.errors).toEqual({
          lazy: new Error("LAZY LOADER ERROR"),
        });
      });

      it("bubbles loader errors from lazy route modules on staticHandler.query() when hasErrorBoundary is resolved as false", async () => {
        let { query } = createStaticHandler([
          {
            id: "root",
            path: "/",
            children: [
              {
                id: "lazy",
                path: "/lazy",
                lazy: async () => {
                  await tick();
                  return {
                    async loader() {
                      throw new Error("LAZY LOADER ERROR");
                    },
                    hasErrorBoundary: false,
                  };
                },
              },
            ],
          },
        ]);

        let context = await query(createRequest("/lazy"));
        invariant(
          !(context instanceof Response),
          "Expected a StaticContext instance"
        );
        expect(context.loaderData).toEqual({
          root: null,
        });
        expect(context.errors).toEqual({
          root: new Error("LAZY LOADER ERROR"),
        });
      });

      it("throws when failing to load lazy route modules on staticHandler.queryRoute()", async () => {
        let { queryRoute } = createStaticHandler([
          {
            id: "lazy",
            path: "/lazy",
            lazy: async () => {
              throw new Error("LAZY FUNCTION ERROR");
            },
          },
        ]);

        let err;
        try {
          await queryRoute(createRequest("/lazy"));
        } catch (_err) {
          err = _err;
        }

        expect(err?.message).toBe("LAZY FUNCTION ERROR");
      });

      it("handles loader errors in lazy route modules on staticHandler.queryRoute()", async () => {
        let { queryRoute } = createStaticHandler([
          {
            id: "lazy",
            path: "/lazy",
            lazy: async () => {
              await tick();
              return {
                async loader() {
                  throw new Error("LAZY LOADER ERROR");
                },
              };
            },
          },
        ]);

        let err;
        try {
          await queryRoute(createRequest("/lazy"));
        } catch (_err) {
          err = _err;
        }

        expect(err?.message).toBe("LAZY LOADER ERROR");
      });
    });
  });

  describe("ssr", () => {
    const SSR_ROUTES = [
      {
        id: "index",
        path: "/",
        loader: () => "INDEX LOADER",
      },
      {
        id: "parent",
        path: "/parent",
        loader: () => "PARENT LOADER",
        action: () => "PARENT ACTION",
        children: [
          {
            id: "parentIndex",
            index: true,
            loader: () => "PARENT INDEX LOADER",
            action: () => "PARENT INDEX ACTION",
          },
          {
            id: "child",
            path: "child",
            loader: () => "CHILD LOADER",
            action: () => "CHILD ACTION",
          },
          {
            id: "json",
            path: "json",
            loader: () => json({ type: "loader" }),
            action: () => json({ type: "action" }),
          },
          {
            id: "deferred",
            path: "deferred",
            loader: ({ request }) => {
              if (new URL(request.url).searchParams.has("reject")) {
                return defer({
                  critical: "loader",
                  lazy: new Promise((_, r) =>
                    setTimeout(() => r(new Error("broken!")), 10)
                  ),
                });
              }
              if (new URL(request.url).searchParams.has("status")) {
                return defer(
                  {
                    critical: "loader",
                    lazy: new Promise((r) => setTimeout(() => r("lazy"), 10)),
                  },
                  { status: 201, headers: { "X-Custom": "yes" } }
                );
              }
              return defer({
                critical: "loader",
                lazy: new Promise((r) => setTimeout(() => r("lazy"), 10)),
              });
            },
            action: () =>
              defer({
                critical: "critical",
                lazy: new Promise((r) => setTimeout(() => r("lazy"), 10)),
              }),
          },
          {
            id: "error",
            path: "error",
            loader: () => Promise.reject("ERROR LOADER ERROR"),
            action: () => Promise.reject("ERROR ACTION ERROR"),
          },
          {
            id: "errorBoundary",
            path: "error-boundary",
            hasErrorBoundary: true,
            loader: () => Promise.reject("ERROR BOUNDARY LOADER ERROR"),
            action: () => Promise.reject("ERROR BOUNDARY ACTION ERROR"),
          },
        ],
      },
      {
        id: "redirect",
        path: "/redirect",
        loader: () => redirect("/"),
      },
    ];

    // Regardless of if the URL is internal or external - all absolute URL
    // responses should return untouched during SSR so the browser can handle
    // them
    let ABSOLUTE_URLS = [
      "http://localhost/",
      "https://localhost/about",
      "http://remix.run/blog",
      "https://remix.run/blog",
      "//remix.run/blog",
      "app://whatever",
      "mailto:hello@remix.run",
      "web+remix:whatever",
    ];

    describe("document requests", () => {
      it("should support document load navigations", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context = await query(createRequest("/parent/child"));
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {
            parent: "PARENT LOADER",
            child: "CHILD LOADER",
          },
          errors: null,
          location: { pathname: "/parent/child" },
          matches: [{ route: { id: "parent" } }, { route: { id: "child" } }],
        });
      });

      it("should support document load navigations with HEAD requests", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context = await query(
          createRequest("/parent/child", { method: "HEAD" })
        );
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {
            parent: "PARENT LOADER",
            child: "CHILD LOADER",
          },
          errors: null,
          location: { pathname: "/parent/child" },
          matches: [{ route: { id: "parent" } }, { route: { id: "child" } }],
        });
      });

      it("should support document load navigations with a basename", async () => {
        let { query } = createStaticHandler(SSR_ROUTES, { basename: "/base" });
        let context = await query(createRequest("/base/parent/child"));
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {
            parent: "PARENT LOADER",
            child: "CHILD LOADER",
          },
          errors: null,
          location: { pathname: "/base/parent/child" },
          matches: [{ route: { id: "parent" } }, { route: { id: "child" } }],
        });
      });

      it("should fill in null loaderData values for routes without loaders", async () => {
        let { query } = createStaticHandler([
          {
            id: "root",
            path: "/",
            children: [
              {
                id: "none",
                path: "none",
              },
              {
                id: "a",
                path: "a",
                loader: () => "A",
                children: [
                  {
                    id: "b",
                    path: "b",
                  },
                ],
              },
            ],
          },
        ]);

        // No loaders at all
        let context = await query(createRequest("/none"));
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {
            root: null,
            none: null,
          },
          errors: null,
          location: { pathname: "/none" },
        });

        // Mix of loaders and no loaders
        context = await query(createRequest("/a/b"));
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {
            root: null,
            a: "A",
            b: null,
          },
          errors: null,
          location: { pathname: "/a/b" },
        });
      });

      it("should support document load navigations returning responses", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context = await query(createRequest("/parent/json"));
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {
            parent: "PARENT LOADER",
            json: { type: "loader" },
          },
          errors: null,
          matches: [{ route: { id: "parent" } }, { route: { id: "json" } }],
        });
      });

      it("should support document load navigations returning deferred", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context = await query(createRequest("/parent/deferred"));
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {
            parent: "PARENT LOADER",
            deferred: {
              critical: "loader",
              lazy: expect.trackedPromise(),
            },
          },
          activeDeferreds: {
            deferred: expect.deferredData(false),
          },
          errors: null,
          location: { pathname: "/parent/deferred" },
          matches: [{ route: { id: "parent" } }, { route: { id: "deferred" } }],
        });

        await new Promise((r) => setTimeout(r, 10));

        expect(context).toMatchObject({
          loaderData: {
            deferred: {
              lazy: expect.trackedPromise("lazy"),
            },
          },
          activeDeferreds: {
            deferred: expect.deferredData(true),
          },
        });
      });

      it("should support document submit navigations", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context = await query(createSubmitRequest("/parent/child"));
        expect(context).toMatchObject({
          actionData: {
            child: "CHILD ACTION",
          },
          loaderData: {
            parent: "PARENT LOADER",
            child: "CHILD LOADER",
          },
          errors: null,
          location: { pathname: "/parent/child" },
          matches: [{ route: { id: "parent" } }, { route: { id: "child" } }],
        });
      });

      it("should support alternative submission methods", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context;

        let expected = {
          actionData: {
            child: "CHILD ACTION",
          },
          loaderData: {
            parent: "PARENT LOADER",
            child: "CHILD LOADER",
          },
          errors: null,
          location: { pathname: "/parent/child" },
          matches: [{ route: { id: "parent" } }, { route: { id: "child" } }],
        };

        context = await query(
          createSubmitRequest("/parent/child", { method: "PUT" })
        );
        expect(context).toMatchObject(expected);

        context = await query(
          createSubmitRequest("/parent/child", { method: "PATCH" })
        );
        expect(context).toMatchObject(expected);

        context = await query(
          createSubmitRequest("/parent/child", { method: "DELETE" })
        );
        expect(context).toMatchObject(expected);
      });

      it("should support document submit navigations returning responses", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context = await query(createSubmitRequest("/parent/json"));
        expect(context).toMatchObject({
          actionData: {
            json: { type: "action" },
          },
          loaderData: {
            parent: "PARENT LOADER",
            json: { type: "loader" },
          },
          errors: null,
          matches: [{ route: { id: "parent" } }, { route: { id: "json" } }],
        });
      });

      it("should support document submit navigations to layout routes", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context = await query(createSubmitRequest("/parent"));
        expect(context).toMatchObject({
          actionData: {
            parent: "PARENT ACTION",
          },
          loaderData: {
            parent: "PARENT LOADER",
            parentIndex: "PARENT INDEX LOADER",
          },
          errors: null,
          matches: [
            { route: { id: "parent" } },
            { route: { id: "parentIndex" } },
          ],
        });
      });

      it("should support document submit navigations to index routes", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context = await query(createSubmitRequest("/parent?index"));
        expect(context).toMatchObject({
          actionData: {
            parentIndex: "PARENT INDEX ACTION",
          },
          loaderData: {
            parent: "PARENT LOADER",
            parentIndex: "PARENT INDEX LOADER",
          },
          errors: null,
          matches: [
            { route: { id: "parent" } },
            { route: { id: "parentIndex" } },
          ],
        });
      });

      it("should handle redirect Responses", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let response = await query(createRequest("/redirect"));
        expect(response instanceof Response).toBe(true);
        expect((response as Response).status).toBe(302);
        expect((response as Response).headers.get("Location")).toBe("/");
      });

      it("should handle relative redirect responses (loader)", async () => {
        let { query } = createStaticHandler([
          {
            path: "/",
            children: [
              {
                path: "parent",
                children: [
                  {
                    path: "child",
                    loader: () => redirect(".."),
                  },
                ],
              },
            ],
          },
        ]);
        let response = await query(createRequest("/parent/child"));
        expect(response instanceof Response).toBe(true);
        expect((response as Response).status).toBe(302);
        expect((response as Response).headers.get("Location")).toBe("/parent");
      });

      it("should handle relative redirect responses (action)", async () => {
        let { query } = createStaticHandler([
          {
            path: "/",
            children: [
              {
                path: "parent",
                children: [
                  {
                    path: "child",
                    action: () => redirect(".."),
                  },
                ],
              },
            ],
          },
        ]);
        let response = await query(createSubmitRequest("/parent/child"));
        expect(response instanceof Response).toBe(true);
        expect((response as Response).status).toBe(302);
        expect((response as Response).headers.get("Location")).toBe("/parent");
      });

      it("should handle absolute redirect Responses", async () => {
        for (let url of ABSOLUTE_URLS) {
          let handler = createStaticHandler([
            {
              path: "/",
              loader: () => redirect(url),
            },
          ]);
          let response = await handler.query(createRequest("/"));
          expect(response instanceof Response).toBe(true);
          expect((response as Response).status).toBe(302);
          expect((response as Response).headers.get("Location")).toBe(url);
        }
      });

      it("should handle 404 navigations", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context = await query(createRequest("/not/found"));

        expect(context).toMatchObject({
          loaderData: {},
          actionData: null,
          errors: {
            index: new ErrorResponse(
              404,
              "Not Found",
              new Error('No route matches URL "/not/found"'),
              true
            ),
          },
          matches: [{ route: { id: "index" } }],
        });
      });

      it("should handle load error responses", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context;

        // Error handled by child
        context = await query(createRequest("/parent/error-boundary"));
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {
            parent: "PARENT LOADER",
          },
          errors: {
            errorBoundary: "ERROR BOUNDARY LOADER ERROR",
          },
          matches: [
            { route: { id: "parent" } },
            { route: { id: "errorBoundary" } },
          ],
        });

        // Error propagates to parent
        context = await query(createRequest("/parent/error"));
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {
            parent: "PARENT LOADER",
          },
          errors: {
            parent: "ERROR LOADER ERROR",
          },
          matches: [{ route: { id: "parent" } }, { route: { id: "error" } }],
        });
      });

      it("should handle submit error responses", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let context;

        // Error handled by child
        context = await query(createSubmitRequest("/parent/error-boundary"));
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {
            parent: "PARENT LOADER",
          },
          errors: {
            errorBoundary: "ERROR BOUNDARY ACTION ERROR",
          },
          matches: [
            { route: { id: "parent" } },
            { route: { id: "errorBoundary" } },
          ],
        });

        // Error propagates to parent
        context = await query(createSubmitRequest("/parent/error"));
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {},
          errors: {
            parent: "ERROR ACTION ERROR",
          },
          matches: [{ route: { id: "parent" } }, { route: { id: "error" } }],
        });
      });

      it("should handle multiple errors at separate boundaries", async () => {
        let routes = [
          {
            id: "root",
            path: "/",
            loader: () => Promise.reject("ROOT"),
            hasErrorBoundary: true,
            children: [
              {
                id: "child",
                path: "child",
                loader: () => Promise.reject("CHILD"),
                hasErrorBoundary: true,
              },
            ],
          },
        ];

        let { query } = createStaticHandler(routes);
        let context;

        context = await query(createRequest("/child"));
        expect(context.errors).toEqual({
          root: "ROOT",
          child: "CHILD",
        });
      });

      it("should handle multiple errors at the same boundary", async () => {
        let routes = [
          {
            id: "root",
            path: "/",
            loader: () => Promise.reject("ROOT"),
            hasErrorBoundary: true,
            children: [
              {
                id: "child",
                path: "child",
                loader: () => Promise.reject("CHILD"),
              },
            ],
          },
        ];

        let { query } = createStaticHandler(routes);
        let context;

        context = await query(createRequest("/child"));
        expect(context.errors).toEqual({
          // higher error value wins
          root: "ROOT",
        });
      });

      it("should handle aborted load requests", async () => {
        let dfd = createDeferred();
        let controller = new AbortController();
        let { query } = createStaticHandler([
          {
            id: "root",
            path: "/",
            loader: () => dfd.promise,
          },
        ]);
        let request = createRequest("/", { signal: controller.signal });
        let e;
        try {
          let contextPromise = query(request);
          controller.abort();
          // This should resolve even though we never resolved the loader
          await contextPromise;
        } catch (_e) {
          e = _e;
        }
        expect(e).toMatchInlineSnapshot(`[Error: query() call aborted]`);
      });

      it("should handle aborted submit requests", async () => {
        let dfd = createDeferred();
        let controller = new AbortController();
        let { query } = createStaticHandler([
          {
            id: "root",
            path: "/",
            action: () => dfd.promise,
          },
        ]);
        let request = createSubmitRequest("/", {
          signal: controller.signal,
        });
        let e;
        try {
          let contextPromise = query(request);
          controller.abort();
          // This should resolve even though we never resolved the loader
          await contextPromise;
        } catch (_e) {
          e = _e;
        }
        expect(e).toMatchInlineSnapshot(`[Error: query() call aborted]`);
      });

      it("should assign signals to requests by default (per the", async () => {
        let { query } = createStaticHandler(SSR_ROUTES);
        let request = createRequest("/", { signal: undefined });
        let context = await query(request);
        expect((context as StaticHandlerContext).loaderData.index).toBe(
          "INDEX LOADER"
        );
      });

      it("should handle not found action submissions with a 405 error", async () => {
        let { query } = createStaticHandler([
          {
            id: "root",
            path: "/",
          },
        ]);
        let request = createSubmitRequest("/");
        let context = await query(request);
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {},
          errors: {
            root: new ErrorResponse(
              405,
              "Method Not Allowed",
              new Error(
                'You made a POST request to "/" but did not provide an `action` ' +
                  'for route "root", so there is no way to handle the request.'
              ),
              true
            ),
          },
          matches: [{ route: { id: "root" } }],
        });
      });

      it("should handle unsupported methods with a 405 error", async () => {
        let { query } = createStaticHandler([
          {
            id: "root",
            path: "/",
          },
        ]);
        let request = createRequest("/", { method: "OPTIONS" });
        let context = await query(request);
        expect(context).toMatchObject({
          actionData: null,
          loaderData: {},
          errors: {
            root: new ErrorResponse(
              405,
              "Method Not Allowed",
              new Error('Invalid request method "OPTIONS"'),
              true
            ),
          },
          matches: [{ route: { id: "root" } }],
        });
      });

      it("should send proper arguments to loaders", async () => {
        let rootLoaderStub = jest.fn(() => "ROOT");
        let childLoaderStub = jest.fn(() => "CHILD");
        let { query } = createStaticHandler([
          {
            id: "root",
            path: "/",
            loader: rootLoaderStub,
            children: [
              {
                id: "child",
                path: "child",
                loader: childLoaderStub,
              },
            ],
          },
        ]);
        await query(createRequest("/child"));

        // @ts-expect-error
        let rootLoaderRequest = rootLoaderStub.mock.calls[0][0]?.request;
        // @ts-expect-error
        let childLoaderRequest = childLoaderStub.mock.calls[0][0]?.request;
        expect(rootLoaderRequest.method).toBe("GET");
        expect(rootLoaderRequest.url).toBe("http://localhost/child");
        expect(childLoaderRequest.method).toBe("GET");
        expect(childLoaderRequest.url).toBe("http://localhost/child");
      });

      it("should send proper arguments to actions", async () => {
        let actionStub = jest.fn(() => "ACTION");
        let rootLoaderStub = jest.fn(() => "ROOT");
        let childLoaderStub = jest.fn(() => "CHILD");
        let { query } = createStaticHandler([
          {
            id: "root",
            path: "/",
            loader: rootLoaderStub,
            children: [
              {
                id: "child",
                path: "child",
                action: actionStub,
                loader: childLoaderStub,
              },
            ],
          },
        ]);
        await query(
          createSubmitRequest("/child", {
            headers: {
              test: "value",
            },
          })
        );

        // @ts-expect-error
        let actionRequest = actionStub.mock.calls[0][0]?.request;
        expect(actionRequest.method).toBe("POST");
        expect(actionRequest.url).toBe("http://localhost/child");
        expect(actionRequest.headers.get("Content-Type")).toBe(
          "application/x-www-form-urlencoded;charset=UTF-8"
        );
        expect((await actionRequest.formData()).get("key")).toBe("value");

        // @ts-expect-error
        let rootLoaderRequest = rootLoaderStub.mock.calls[0][0]?.request;
        // @ts-expect-error
        let childLoaderRequest = childLoaderStub.mock.calls[0][0]?.request;
        expect(rootLoaderRequest.method).toBe("GET");
        expect(rootLoaderRequest.url).toBe("http://localhost/child");
        expect(rootLoaderRequest.headers.get("test")).toBe("value");
        expect(await rootLoaderRequest.text()).toBe("");
        expect(childLoaderRequest.method).toBe("GET");
        expect(childLoaderRequest.url).toBe("http://localhost/child");
        expect(childLoaderRequest.headers.get("test")).toBe("value");
        // Can't re-read body here since it's the same request as the root
      });

      it("should support a requestContext passed to loaders and actions", async () => {
        let requestContext = { sessionId: "12345" };
        let rootStub = jest.fn(() => "ROOT");
        let childStub = jest.fn(() => "CHILD");
        let actionStub = jest.fn(() => "CHILD ACTION");
        let arg = (s) => s.mock.calls[0][0];
        let { query } = createStaticHandler([
          {
            id: "root",
            path: "/",
            loader: rootStub,
            children: [
              {
                id: "child",
                path: "child",
                action: actionStub,
                loader: childStub,
              },
            ],
          },
        ]);

        await query(createRequest("/child"), { requestContext });
        expect(arg(rootStub).context.sessionId).toBe("12345");
        expect(arg(childStub).context.sessionId).toBe("12345");

        actionStub.mockClear();
        rootStub.mockClear();
        childStub.mockClear();

        await query(createSubmitRequest("/child"), { requestContext });
        expect(arg(actionStub).context.sessionId).toBe("12345");
        expect(arg(rootStub).context.sessionId).toBe("12345");
        expect(arg(childStub).context.sessionId).toBe("12345");
      });

      describe("deferred", () => {
        let { query } = createStaticHandler(SSR_ROUTES);

        it("should return DeferredData on symbol", async () => {
          let context = (await query(
            createRequest("/parent/deferred")
          )) as StaticHandlerContext;
          expect(context).toMatchObject({
            loaderData: {
              parent: "PARENT LOADER",
              deferred: {
                critical: "loader",
                lazy: expect.trackedPromise(),
              },
            },
            activeDeferreds: {
              deferred: expect.deferredData(false),
            },
          });
          await new Promise((r) => setTimeout(r, 10));
          expect(context).toMatchObject({
            loaderData: {
              parent: "PARENT LOADER",
              deferred: {
                critical: "loader",
                lazy: expect.trackedPromise("lazy"),
              },
            },
            activeDeferreds: {
              deferred: expect.deferredData(true),
            },
          });
        });

        it("should return rejected DeferredData on symbol", async () => {
          let context = (await query(
            createRequest("/parent/deferred?reject")
          )) as StaticHandlerContext;
          expect(context).toMatchObject({
            loaderData: {
              parent: "PARENT LOADER",
              deferred: {
                critical: "loader",
                lazy: expect.trackedPromise(),
              },
            },
            activeDeferreds: {
              deferred: expect.deferredData(false),
            },
          });
          await new Promise((r) => setTimeout(r, 10));
          expect(context).toMatchObject({
            loaderData: {
              parent: "PARENT LOADER",
              deferred: {
                critical: "loader",
                lazy: expect.trackedPromise(undefined, new Error("broken!")),
              },
            },
            activeDeferreds: {
              deferred: expect.deferredData(true),
            },
          });
        });

        it("should return DeferredData on symbol with status + headers", async () => {
          let context = (await query(
            createRequest("/parent/deferred?status")
          )) as StaticHandlerContext;
          expect(context).toMatchObject({
            loaderData: {
              parent: "PARENT LOADER",
              deferred: {
                critical: "loader",
                lazy: expect.trackedPromise(),
              },
            },
            activeDeferreds: {
              deferred: expect.deferredData(false, 201, {
                "x-custom": "yes",
              }),
            },
          });
          await new Promise((r) => setTimeout(r, 10));
          expect(context).toMatchObject({
            loaderData: {
              parent: "PARENT LOADER",
              deferred: {
                critical: "loader",
                lazy: expect.trackedPromise("lazy"),
              },
            },
            activeDeferreds: {
              deferred: expect.deferredData(true, 201, {
                "x-custom": "yes",
              }),
            },
            statusCode: 201,
            loaderHeaders: {
              deferred: new Headers({ "x-custom": "yes" }),
            },
          });
        });

        it("does not support deferred on submissions", async () => {
          let context = (await query(
            createSubmitRequest("/parent/deferred")
          )) as StaticHandlerContext;
          expect(context.actionData).toEqual(null);
          expect(context.loaderData).toEqual({
            parent: null,
            deferred: null,
          });
          expect(context.activeDeferreds).toEqual(null);
          expect(context.errors).toEqual({
            parent: new ErrorResponse(
              400,
              "Bad Request",
              new Error("defer() is not supported in actions"),
              true
            ),
          });
        });
      });

      describe("statusCode", () => {
        it("should expose a 200 status code by default", async () => {
          let { query } = createStaticHandler([
            {
              id: "root",
              path: "/",
            },
          ]);
          let context = (await query(
            createRequest("/")
          )) as StaticHandlerContext;
          expect(context.statusCode).toBe(200);
        });

        it("should expose a 500 status code on loader errors", async () => {
          let { query } = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => json({ data: "ROOT" }, { status: 201 }),
              children: [
                {
                  id: "child",
                  index: true,
                  loader: () => {
                    throw new Error("💥");
                  },
                },
              ],
            },
          ]);
          let context = (await query(
            createRequest("/")
          )) as StaticHandlerContext;
          expect(context.statusCode).toBe(500);
        });

        it("should expose a 500 status code on action errors", async () => {
          let { query } = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => json({ data: "ROOT" }, { status: 201 }),
              children: [
                {
                  id: "child",
                  index: true,
                  loader: () => json({ data: "CHILD" }, { status: 202 }),
                  action: () => {
                    throw new Error("💥");
                  },
                },
              ],
            },
          ]);
          let context = (await query(
            createSubmitRequest("/?index")
          )) as StaticHandlerContext;
          expect(context.statusCode).toBe(500);
        });

        it("should expose a 4xx status code on thrown loader responses", async () => {
          let { query } = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => json({ data: "ROOT" }, { status: 201 }),
              children: [
                {
                  id: "child",
                  index: true,
                  loader: () => {
                    throw new Response(null, { status: 400 });
                  },
                },
              ],
            },
          ]);
          let context = (await query(
            createRequest("/")
          )) as StaticHandlerContext;
          expect(context.statusCode).toBe(400);
        });

        it("should expose a 4xx status code on thrown action responses", async () => {
          let { query } = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => json({ data: "ROOT" }, { status: 201 }),
              children: [
                {
                  id: "child",
                  index: true,
                  loader: () => json({ data: "CHILD" }, { status: 202 }),
                  action: () => {
                    throw new Response(null, { status: 400 });
                  },
                },
              ],
            },
          ]);
          let context = (await query(
            createSubmitRequest("/?index")
          )) as StaticHandlerContext;
          expect(context.statusCode).toBe(400);
        });

        it("should expose the action status on submissions", async () => {
          let { query } = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => json({ data: "ROOT" }, { status: 201 }),
              children: [
                {
                  id: "child",
                  index: true,
                  loader: () => json({ data: "ROOT" }, { status: 202 }),
                  action: () => json({ data: "ROOT" }, { status: 203 }),
                },
              ],
            },
          ]);
          let context = (await query(
            createSubmitRequest("/?index")
          )) as StaticHandlerContext;
          expect(context.statusCode).toBe(203);
        });

        it("should expose the deepest 2xx status", async () => {
          let { query } = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => json({ data: "ROOT" }, { status: 201 }),
              children: [
                {
                  id: "child",
                  index: true,
                  loader: () => json({ data: "ROOT" }, { status: 202 }),
                },
              ],
            },
          ]);
          let context = (await query(
            createRequest("/")
          )) as StaticHandlerContext;
          expect(context.statusCode).toBe(202);
        });

        it("should expose the shallowest 4xx/5xx status", async () => {
          let context;
          let query: StaticHandler["query"];

          query = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => {
                throw new Response(null, { status: 400 });
              },
              children: [
                {
                  id: "child",
                  index: true,
                  loader: () => {
                    throw new Response(null, { status: 401 });
                  },
                },
              ],
            },
          ]).query;
          context = (await query(createRequest("/"))) as StaticHandlerContext;
          expect(context.statusCode).toBe(400);

          query = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => {
                throw new Response(null, { status: 400 });
              },
              children: [
                {
                  id: "child",
                  index: true,
                  loader: () => {
                    throw new Response(null, { status: 500 });
                  },
                },
              ],
            },
          ]).query;
          context = (await query(createRequest("/"))) as StaticHandlerContext;
          expect(context.statusCode).toBe(400);

          query = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => {
                throw new Response(null, { status: 400 });
              },
              children: [
                {
                  id: "child",
                  index: true,
                  loader: () => {
                    throw new Error("💥");
                  },
                },
              ],
            },
          ]).query;
          context = (await query(createRequest("/"))) as StaticHandlerContext;
          expect(context.statusCode).toBe(400);
        });
      });

      describe("headers", () => {
        it("should expose headers from action/loader responses", async () => {
          let { query } = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => new Response(null, { headers: { two: "2" } }),
              children: [
                {
                  id: "child",
                  index: true,
                  action: () => new Response(null, { headers: { one: "1" } }),
                  loader: () => new Response(null, { headers: { three: "3" } }),
                },
              ],
            },
          ]);
          let context = (await query(
            createSubmitRequest("/?index")
          )) as StaticHandlerContext;
          expect(Array.from(context.actionHeaders.child.entries())).toEqual([
            ["one", "1"],
          ]);
          expect(Array.from(context.loaderHeaders.root.entries())).toEqual([
            ["two", "2"],
          ]);
          expect(Array.from(context.loaderHeaders.child.entries())).toEqual([
            ["three", "3"],
          ]);
        });

        it("should expose headers from loader error responses", async () => {
          let { query } = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => new Response(null, { headers: { one: "1" } }),
              children: [
                {
                  id: "child",
                  index: true,
                  loader: () => {
                    throw new Response(null, { headers: { two: "2" } });
                  },
                },
              ],
            },
          ]);
          let context = (await query(
            createRequest("/")
          )) as StaticHandlerContext;
          expect(Array.from(context.loaderHeaders.root.entries())).toEqual([
            ["one", "1"],
          ]);
          expect(Array.from(context.loaderHeaders.child.entries())).toEqual([
            ["two", "2"],
          ]);
        });

        it("should expose headers from action error responses", async () => {
          let { query } = createStaticHandler([
            {
              id: "root",
              path: "/",
              children: [
                {
                  id: "child",
                  index: true,
                  action: () => {
                    throw new Response(null, { headers: { one: "1" } });
                  },
                },
              ],
            },
          ]);
          let context = (await query(
            createSubmitRequest("/?index")
          )) as StaticHandlerContext;
          expect(Array.from(context.actionHeaders.child.entries())).toEqual([
            ["one", "1"],
          ]);
        });
      });
    });

    describe("singular route requests", () => {
      function setupFlexRouteTest() {
        function queryRoute(
          req: Request,
          routeId: string,
          type: "loader" | "action",
          data: any,
          isError = false
        ) {
          let handler = createStaticHandler([
            {
              id: "flex",
              path: "/flex",
              [type]: () =>
                isError ? Promise.reject(data) : Promise.resolve(data),
            },
          ]);
          return handler.queryRoute(req, { routeId });
        }

        return {
          resolveLoader(data: any) {
            return queryRoute(
              createRequest("/flex"),
              "flex",
              "loader",
              data,
              false
            );
          },
          rejectLoader(data: any) {
            return queryRoute(
              createRequest("/flex"),
              "flex",
              "loader",
              data,
              true
            );
          },
          resolveAction(data: any) {
            return queryRoute(
              createSubmitRequest("/flex"),
              "flex",
              "action",
              data,
              false
            );
          },
          rejectAction(data: any) {
            return queryRoute(
              createSubmitRequest("/flex"),
              "flex",
              "action",
              data,
              true
            );
          },
        };
      }

      it("should match routes automatically if no routeId is provided", async () => {
        let { queryRoute } = createStaticHandler(SSR_ROUTES);
        let data;

        data = await queryRoute(createRequest("/parent"));
        expect(data).toBe("PARENT LOADER");

        data = await queryRoute(createRequest("/parent?index"));
        expect(data).toBe("PARENT INDEX LOADER");

        data = await queryRoute(createRequest("/parent/child"), {
          routeId: "child",
        });
        expect(data).toBe("CHILD LOADER");
      });

      it("should support HEAD requests", async () => {
        let { queryRoute } = createStaticHandler(SSR_ROUTES);
        let data = await queryRoute(
          createRequest("/parent", { method: "HEAD" })
        );
        expect(data).toBe("PARENT LOADER");
      });

      it("should support OPTIONS requests", async () => {
        let { queryRoute } = createStaticHandler(SSR_ROUTES);
        let data = await queryRoute(
          createRequest("/parent", { method: "OPTIONS" })
        );
        expect(data).toBe("PARENT LOADER");
      });

      it("should support singular route load navigations (primitives)", async () => {
        let { queryRoute } = createStaticHandler(SSR_ROUTES);
        let data;

        // Layout route
        data = await queryRoute(createRequest("/parent"), {
          routeId: "parent",
        });
        expect(data).toBe("PARENT LOADER");

        // Index route
        data = await queryRoute(createRequest("/parent"), {
          routeId: "parentIndex",
        });
        expect(data).toBe("PARENT INDEX LOADER");

        // Parent in nested route
        data = await queryRoute(createRequest("/parent/child"), {
          routeId: "parent",
        });
        expect(data).toBe("PARENT LOADER");

        // Child in nested route
        data = await queryRoute(createRequest("/parent/child"), {
          routeId: "child",
        });
        expect(data).toBe("CHILD LOADER");

        // Non-undefined falsey values should count
        let T = setupFlexRouteTest();
        data = await T.resolveLoader(null);
        expect(data).toBeNull();
        data = await T.resolveLoader(false);
        expect(data).toBe(false);
        data = await T.resolveLoader("");
        expect(data).toBe("");
      });

      it("should support singular route load navigations (Responses)", async () => {
        /* eslint-disable jest/no-conditional-expect */
        let T = setupFlexRouteTest();
        let data;

        // When Responses are returned or thrown, it should always resolve the
        // raw Response from queryRoute

        // Returned Success Response
        data = await T.resolveLoader(new Response("Created!", { status: 201 }));
        expect(data.status).toBe(201);
        expect(await data.text()).toBe("Created!");

        // Thrown Success Response
        try {
          await T.rejectLoader(new Response("Created!", { status: 201 }));
          expect(false).toBe(true);
        } catch (data) {
          expect(data.status).toBe(201);
          expect(await data.text()).toBe("Created!");
        }

        // Returned Redirect Response
        data = await T.resolveLoader(
          new Response(null, {
            status: 302,
            headers: { Location: "/" },
          })
        );
        expect(data.status).toBe(302);
        expect(data.headers.get("Location")).toBe("/");

        // Thrown Redirect Response
        data = await T.rejectLoader(
          new Response(null, {
            status: 301,
            headers: { Location: "/" },
          })
        );
        expect(data.status).toBe(301);
        expect(data.headers.get("Location")).toBe("/");

        // Returned Error Response
        data = await T.resolveLoader(new Response("Why?", { status: 400 }));
        expect(data.status).toBe(400);
        expect(await data.text()).toBe("Why?");

        // Thrown Error Response
        try {
          await T.rejectLoader(new Response("Oh no!", { status: 401 }));
          expect(false).toBe(true);
        } catch (data) {
          expect(data.status).toBe(401);
          expect(await data.text()).toBe("Oh no!");
        }
        /* eslint-enable jest/no-conditional-expect */
      });

      it("should support singular route load navigations (Errors)", async () => {
        let T = setupFlexRouteTest();
        let data;

        // Returned Error instance is treated as data since it was not thrown
        data = await T.resolveLoader(new Error("Why?"));
        expect(data).toEqual(new Error("Why?"));

        // Anything thrown (Error instance or not) will throw from queryRoute
        // so we know to handle it as an errorPath in the server.  Generally
        // though in queryRoute, we would expect responses to be coming back -
        // not

        // Thrown Error
        try {
          await T.rejectLoader(new Error("Oh no!"));
        } catch (e) {
          data = e;
        }
        expect(data).toEqual(new Error("Oh no!"));

        // Thrown non-Error
        try {
          await T.rejectLoader("This is weird?");
        } catch (e) {
          data = e;
        }
        expect(data).toEqual("This is weird?");

        // Non-undefined falsey values should count
        try {
          await T.rejectLoader(null);
        } catch (e) {
          data = e;
        }
        expect(data).toBeNull();
        try {
          await T.rejectLoader(false);
        } catch (e) {
          data = e;
        }
        expect(data).toBe(false);
        try {
          await T.rejectLoader("");
        } catch (e) {
          data = e;
        }
        expect(data).toBe("");
      });

      it("should support singular route load navigations (with a basename)", async () => {
        let { queryRoute } = createStaticHandler(SSR_ROUTES, {
          basename: "/base",
        });
        let data;

        // Layout route
        data = await queryRoute(createRequest("/base/parent"), {
          routeId: "parent",
        });
        expect(data).toBe("PARENT LOADER");

        // Index route
        data = await queryRoute(createRequest("/base/parent"), {
          routeId: "parentIndex",
        });
        expect(data).toBe("PARENT INDEX LOADER");

        // Parent in nested route
        data = await queryRoute(createRequest("/base/parent/child"), {
          routeId: "parent",
        });
        expect(data).toBe("PARENT LOADER");

        // Child in nested route
        data = await queryRoute(createRequest("/base/parent/child"), {
          routeId: "child",
        });
        expect(data).toBe("CHILD LOADER");

        // Non-undefined falsey values should count
        let T = setupFlexRouteTest();
        data = await T.resolveLoader(null);
        expect(data).toBeNull();
        data = await T.resolveLoader(false);
        expect(data).toBe(false);
        data = await T.resolveLoader("");
        expect(data).toBe("");
      });

      it("should support singular route submit navigations (primitives)", async () => {
        let { queryRoute } = createStaticHandler(SSR_ROUTES);
        let data;

        // Layout route
        data = await queryRoute(createSubmitRequest("/parent"), {
          routeId: "parent",
        });
        expect(data).toBe("PARENT ACTION");

        // Index route
        data = await queryRoute(createSubmitRequest("/parent"), {
          routeId: "parentIndex",
        });
        expect(data).toBe("PARENT INDEX ACTION");

        // Parent in nested route
        data = await queryRoute(createSubmitRequest("/parent/child"), {
          routeId: "parent",
        });
        expect(data).toBe("PARENT ACTION");

        // Child in nested route
        data = await queryRoute(createSubmitRequest("/parent/child"), {
          routeId: "child",
        });
        expect(data).toBe("CHILD ACTION");

        // Non-undefined falsey values should count
        let T = setupFlexRouteTest();
        data = await T.resolveAction(null);
        expect(data).toBeNull();
        data = await T.resolveAction(false);
        expect(data).toBe(false);
        data = await T.resolveAction("");
        expect(data).toBe("");
      });

      it("should support alternative submission methods", async () => {
        let { queryRoute } = createStaticHandler(SSR_ROUTES);
        let data;

        data = await queryRoute(
          createSubmitRequest("/parent", { method: "PUT" }),
          { routeId: "parent" }
        );
        expect(data).toBe("PARENT ACTION");

        data = await queryRoute(
          createSubmitRequest("/parent", { method: "PATCH" }),
          { routeId: "parent" }
        );
        expect(data).toBe("PARENT ACTION");

        data = await queryRoute(
          createSubmitRequest("/parent", { method: "DELETE" }),
          { routeId: "parent" }
        );
        expect(data).toBe("PARENT ACTION");
      });

      it("should support singular route submit navigations (Responses)", async () => {
        /* eslint-disable jest/no-conditional-expect */
        let T = setupFlexRouteTest();
        let data;

        // When Responses are returned or thrown, it should always resolve the
        // raw Response from queryRoute

        // Returned Success Response
        data = await T.resolveAction(new Response("Created!", { status: 201 }));
        expect(data.status).toBe(201);
        expect(await data.text()).toBe("Created!");

        // Thrown Success Response
        try {
          await T.rejectAction(new Response("Created!", { status: 201 }));
          expect(false).toBe(true);
        } catch (data) {
          expect(data.status).toBe(201);
          expect(await data.text()).toBe("Created!");
        }

        // Returned Redirect Response
        data = await T.resolveAction(
          new Response(null, {
            status: 302,
            headers: { Location: "/" },
          })
        );
        expect(data.status).toBe(302);
        expect(data.headers.get("Location")).toBe("/");

        // Thrown Redirect Response
        data = await T.rejectAction(
          new Response(null, {
            status: 301,
            headers: { Location: "/" },
          })
        );
        expect(data.status).toBe(301);
        expect(data.headers.get("Location")).toBe("/");

        // Returned Error Response
        data = await T.resolveAction(new Response("Why?", { status: 400 }));
        expect(data.status).toBe(400);
        expect(await data.text()).toBe("Why?");

        // Thrown Error Response
        try {
          await T.rejectAction(new Response("Oh no!", { status: 401 }));
          expect(false).toBe(true);
        } catch (data) {
          expect(data.status).toBe(401);
          expect(await data.text()).toBe("Oh no!");
        }
        /* eslint-enable jest/no-conditional-expect */
      });

      it("should support singular route submit navigations (Errors)", async () => {
        let T = setupFlexRouteTest();
        let data;

        // Returned Error instance is treated as data since it was not thrown
        data = await T.resolveAction(new Error("Why?"));
        expect(data).toEqual(new Error("Why?"));

        // Anything thrown (Error instance or not) will throw from queryRoute
        // so we know to handle it as an errorPath in the server.  Generally
        // though in queryRoute, we would expect responses to be coming back -
        // not

        // Thrown Error
        try {
          await T.rejectAction(new Error("Oh no!"));
        } catch (e) {
          data = e;
        }
        expect(data).toEqual(new Error("Oh no!"));

        // Thrown non-Error
        try {
          await T.rejectAction("This is weird?");
        } catch (e) {
          data = e;
        }
        expect(data).toEqual("This is weird?");

        // Non-undefined falsey values should count
        try {
          await T.rejectAction(null);
        } catch (e) {
          data = e;
        }
        expect(data).toBeNull();
        try {
          await T.rejectAction(false);
        } catch (e) {
          data = e;
        }
        expect(data).toBe(false);
        try {
          await T.rejectAction("");
        } catch (e) {
          data = e;
        }
        expect(data).toBe("");
      });

      it("should error if an action/loader returns undefined", async () => {
        let T = setupFlexRouteTest();
        let data;

        try {
          data = await T.resolveLoader(undefined);
        } catch (e) {
          data = e;
        }
        expect(data).toEqual(
          new Error(
            'You defined a loader for route "flex" but didn\'t return anything ' +
              "from your `loader` function. Please return a value or `null`."
          )
        );

        try {
          data = await T.resolveAction(undefined);
        } catch (e) {
          data = e;
        }
        expect(data).toEqual(
          new Error(
            'You defined an action for route "flex" but didn\'t return anything ' +
              "from your `action` function. Please return a value or `null`."
          )
        );
      });

      it("should handle relative redirect responses (loader)", async () => {
        let { queryRoute } = createStaticHandler([
          {
            path: "/",
            children: [
              {
                path: "parent",
                children: [
                  {
                    id: "child",
                    path: "child",
                    loader: () => redirect(".."),
                  },
                ],
              },
            ],
          },
        ]);
        let response = await queryRoute(createRequest("/parent/child"), {
          routeId: "child",
        });
        expect(response instanceof Response).toBe(true);
        expect((response as Response).status).toBe(302);
        expect((response as Response).headers.get("Location")).toBe("/parent");
      });

      it("should handle relative redirect responses (action)", async () => {
        let { queryRoute } = createStaticHandler([
          {
            path: "/",
            children: [
              {
                path: "parent",
                children: [
                  {
                    id: "child",
                    path: "child",
                    action: () => redirect(".."),
                  },
                ],
              },
            ],
          },
        ]);
        let response = await queryRoute(createSubmitRequest("/parent/child"), {
          routeId: "child",
        });
        expect(response instanceof Response).toBe(true);
        expect((response as Response).status).toBe(302);
        expect((response as Response).headers.get("Location")).toBe("/parent");
      });

      it("should handle absolute redirect Responses", async () => {
        for (let url of ABSOLUTE_URLS) {
          let handler = createStaticHandler([
            {
              id: "root",
              path: "/",
              loader: () => redirect(url),
            },
          ]);
          let response = await handler.queryRoute(createRequest("/"), {
            routeId: "root",
          });
          expect(response instanceof Response).toBe(true);
          expect((response as Response).status).toBe(302);
          expect((response as Response).headers.get("Location")).toBe(url);
        }
      });

      it("should not unwrap responses returned from loaders", async () => {
        let response = json({ key: "value" });
        let { queryRoute } = createStaticHandler([
          {
            id: "root",
            path: "/",
            loader: () => Promise.resolve(response),
          },
        ]);
        let request = createRequest("/");
        let data = await queryRoute(request, { routeId: "root" });
        expect(data instanceof Response).toBe(true);
        expect(await data.json()).toEqual({ key: "value" });
      });

      it("should not unwrap responses returned from actions", async () => {
        let response = json({ key: "value" });
        let { queryRoute } = createStaticHandler([
          {
            id: "root",
            path: "/",
            action: () => Promise.resolve(response),
          },
        ]);
        let request = createSubmitRequest("/");
        let data = await queryRoute(request, { routeId: "root" });
        expect(data instanceof Response).toBe(true);
        expect(await data.json()).toEqual({ key: "value" });
      });

      it("should handle aborted load requests", async () => {
        let dfd = createDeferred();
        let controller = new AbortController();
        let { queryRoute } = createStaticHandler([
          {
            id: "root",
            path: "/",
            loader: () => dfd.promise,
          },
        ]);
        let request = createRequest("/", {
          signal: controller.signal,
        });
        let e;
        try {
          let statePromise = queryRoute(request, { routeId: "root" });
          controller.abort();
          // This should resolve even though we never resolved the loader
          await statePromise;
        } catch (_e) {
          e = _e;
        }
        expect(e).toMatchInlineSnapshot(`[Error: queryRoute() call aborted]`);
      });

      it("should handle aborted submit requests", async () => {
        let dfd = createDeferred();
        let controller = new AbortController();
        let { queryRoute } = createStaticHandler([
          {
            id: "root",
            path: "/",
            action: () => dfd.promise,
          },
        ]);
        let request = createSubmitRequest("/", {
          signal: controller.signal,
        });
        let e;
        try {
          let statePromise = queryRoute(request, { routeId: "root" });
          controller.abort();
          // This should resolve even though we never resolved the loader
          await statePromise;
        } catch (_e) {
          e = _e;
        }
        expect(e).toMatchInlineSnapshot(`[Error: queryRoute() call aborted]`);
      });

      it("should assign signals to requests by default (per the spec)", async () => {
        let { queryRoute } = createStaticHandler(SSR_ROUTES);
        let request = createRequest("/", { signal: undefined });
        let data = await queryRoute(request, { routeId: "index" });
        expect(data).toBe("INDEX LOADER");
      });

      it("should support a requestContext passed to loaders and actions", async () => {
        let requestContext = { sessionId: "12345" };
        let childStub = jest.fn(() => "CHILD");
        let actionStub = jest.fn(() => "CHILD ACTION");
        let arg = (s) => s.mock.calls[0][0];
        let { queryRoute } = createStaticHandler([
          {
            path: "/",
            children: [
              {
                id: "child",
                path: "child",
                action: actionStub,
                loader: childStub,
              },
            ],
          },
        ]);

        await queryRoute(createRequest("/child"), {
          routeId: "child",
          requestContext,
        });
        expect(arg(childStub).context.sessionId).toBe("12345");

        await queryRoute(createSubmitRequest("/child"), {
          routeId: "child",
          requestContext,
        });
        expect(arg(actionStub).context.sessionId).toBe("12345");
      });

      describe("deferred", () => {
        let { queryRoute } = createStaticHandler(SSR_ROUTES);

        it("should return DeferredData on symbol", async () => {
          let result = await queryRoute(createRequest("/parent/deferred"));
          expect(result).toMatchObject({
            critical: "loader",
            lazy: expect.trackedPromise(),
          });
          expect(result[UNSAFE_DEFERRED_SYMBOL]).deferredData(false);
          await new Promise((r) => setTimeout(r, 10));
          expect(result).toMatchObject({
            critical: "loader",
            lazy: expect.trackedPromise("lazy"),
          });
          expect(result[UNSAFE_DEFERRED_SYMBOL]).deferredData(true);
        });

        it("should return rejected DeferredData on symbol", async () => {
          let result = await queryRoute(
            createRequest("/parent/deferred?reject")
          );
          expect(result).toMatchObject({
            critical: "loader",
            lazy: expect.trackedPromise(),
          });
          expect(result[UNSAFE_DEFERRED_SYMBOL]).deferredData(false);
          await new Promise((r) => setTimeout(r, 10));
          expect(result).toMatchObject({
            critical: "loader",
            lazy: expect.trackedPromise(null, new Error("broken!")),
          });
          expect(result[UNSAFE_DEFERRED_SYMBOL]).deferredData(true);
        });

        it("should return DeferredData on symbol with status + headers", async () => {
          let result = await queryRoute(
            createRequest("/parent/deferred?status")
          );
          expect(result).toMatchObject({
            critical: "loader",
            lazy: expect.trackedPromise(),
          });
          expect(result[UNSAFE_DEFERRED_SYMBOL]).deferredData(false, 201, {
            "x-custom": "yes",
          });
          await new Promise((r) => setTimeout(r, 10));
          expect(result).toMatchObject({
            critical: "loader",
            lazy: expect.trackedPromise("lazy"),
          });
          expect(result[UNSAFE_DEFERRED_SYMBOL]).deferredData(true, 201, {
            "x-custom": "yes",
          });
        });

        it("does not support deferred on submissions", async () => {
          try {
            await queryRoute(createSubmitRequest("/parent/deferred"));
            expect(false).toBe(true);
          } catch (e) {
            // eslint-disable-next-line jest/no-conditional-expect
            expect(e).toEqual(
              new ErrorResponse(
                400,
                "Bad Request",
                new Error("defer() is not supported in actions"),
                true
              )
            );
          }
        });
      });

      describe("Errors with Status Codes", () => {
        /* eslint-disable jest/no-conditional-expect */
        let { queryRoute } = createStaticHandler([
          {
            id: "root",
            path: "/",
          },
        ]);

        it("should handle not found paths with a 404 Response", async () => {
          try {
            await queryRoute(createRequest("/junk"));
            expect(false).toBe(true);
          } catch (data) {
            expect(isRouteErrorResponse(data)).toBe(true);
            expect(data.status).toBe(404);
            expect(data.error).toEqual(
              new Error('No route matches URL "/junk"')
            );
            expect(data.internal).toBe(true);
          }

          try {
            await queryRoute(createSubmitRequest("/junk"));
            expect(false).toBe(true);
          } catch (data) {
            expect(isRouteErrorResponse(data)).toBe(true);
            expect(data.status).toBe(404);
            expect(data.error).toEqual(
              new Error('No route matches URL "/junk"')
            );
            expect(data.internal).toBe(true);
          }
        });

        it("should handle not found routeIds with a 403 Response", async () => {
          try {
            await queryRoute(createRequest("/"), { routeId: "junk" });
            expect(false).toBe(true);
          } catch (data) {
            expect(isRouteErrorResponse(data)).toBe(true);
            expect(data.status).toBe(403);
            expect(data.error).toEqual(
              new Error('Route "junk" does not match URL "/"')
            );
            expect(data.internal).toBe(true);
          }

          try {
            await queryRoute(createSubmitRequest("/"), { routeId: "junk" });
            expect(false).toBe(true);
          } catch (data) {
            expect(isRouteErrorResponse(data)).toBe(true);
            expect(data.status).toBe(403);
            expect(data.error).toEqual(
              new Error('Route "junk" does not match URL "/"')
            );
            expect(data.internal).toBe(true);
          }
        });

        it("should handle missing loaders with a 400 Response", async () => {
          try {
            await queryRoute(createRequest("/"), { routeId: "root" });
            expect(false).toBe(true);
          } catch (data) {
            expect(isRouteErrorResponse(data)).toBe(true);
            expect(data.status).toBe(400);
            expect(data.error).toEqual(
              new Error(
                'You made a GET request to "/" but did not provide a `loader` ' +
                  'for route "root", so there is no way to handle the request.'
              )
            );
            expect(data.internal).toBe(true);
          }
        });

        it("should handle missing actions with a 405 Response", async () => {
          try {
            await queryRoute(createSubmitRequest("/"), { routeId: "root" });
            expect(false).toBe(true);
          } catch (data) {
            expect(isRouteErrorResponse(data)).toBe(true);
            expect(data.status).toBe(405);
            expect(data.error).toEqual(
              new Error(
                'You made a POST request to "/" but did not provide an `action` ' +
                  'for route "root", so there is no way to handle the request.'
              )
            );
            expect(data.internal).toBe(true);
          }
        });

        it("should handle unsupported methods with a 405 Response", async () => {
          try {
            await queryRoute(createRequest("/", { method: "CHICKEN" }), {
              routeId: "root",
            });
            expect(false).toBe(true);
          } catch (data) {
            expect(isRouteErrorResponse(data)).toBe(true);
            expect(data.status).toBe(405);
            expect(data.error).toEqual(
              new Error('Invalid request method "CHICKEN"')
            );
            expect(data.internal).toBe(true);
          }
        });

        /* eslint-enable jest/no-conditional-expect */
      });
    });
  });

  describe("routes updates", () => {
    it("should retain existing routes until revalidation completes on loader removal", async () => {
      let t = initializeTmTest();
      let ogRoutes = t.router.routes;
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("foo");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        foo: "foo",
      });

      let newRoutes = t.enhanceRoutes([
        {
          path: "",
          id: "root",
          hasErrorBoundary: true,
          loader: true,
          children: [
            {
              path: "/",
              id: "index",
              loader: true,
              action: true,
              hasErrorBoundary: false,
            },
            {
              path: "/foo",
              id: "foo",
              loader: false,
              action: true,
              hasErrorBoundary: false,
            },
          ],
        },
      ]);
      t._internalSetRoutes(newRoutes);

      // Get a new revalidation helper that should use the updated routes
      let R = await t.revalidate();
      expect(t.router.state.revalidation).toBe("loading");

      // Should still expose be the og routes until revalidation completes
      expect(t.router.routes).toBe(ogRoutes);

      // Resolve any loaders that should have ran (foo's loader has been removed)
      await R.loaders.root.resolve("ROOT*");
      expect(t.router.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(t.router.routes).not.toBe(ogRoutes);
      expect(t.router.routes).toEqual(newRoutes);

      // Loader data should be updated and foo removed
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
      });
      expect(t.router.state.errors).toEqual(null);
    });

    it("should retain existing routes until revalidation completes on loader addition", async () => {
      let t = initializeTmTest();
      let ogRoutes = t.router.routes;
      await t.navigate("/no-loader");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
      });

      let newRoutes = t.enhanceRoutes([
        {
          path: "",
          id: "root",
          hasErrorBoundary: true,
          loader: true,
          children: [
            {
              path: "/no-loader",
              id: "noLoader",
              loader: true,
              action: true,
              hasErrorBoundary: false,
            },
          ],
        },
      ]);
      t._internalSetRoutes(newRoutes);
      // Get a new revalidation helper that should use the updated routes
      let R = await t.revalidate();
      expect(t.router.state.revalidation).toBe("loading");
      expect(t.router.routes).toBe(ogRoutes);

      // Should still expose be the og routes until revalidation completes
      expect(t.router.routes).toBe(ogRoutes);

      // Resolve any loaders that should have ran
      await R.loaders.root.resolve("ROOT*");
      await R.loaders.noLoader.resolve("NO_LOADER*");
      expect(t.router.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(t.router.routes).not.toBe(ogRoutes);
      expect(t.router.routes).toEqual(newRoutes);

      // Loader data should be updated
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
        noLoader: "NO_LOADER*",
      });
      expect(t.router.state.errors).toEqual(null);
    });

    it("should retain existing routes until interrupting navigation completes", async () => {
      let t = initializeTmTest();
      let ogRoutes = t.router.routes;
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("foo");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        foo: "foo",
      });

      let newRoutes = t.enhanceRoutes([
        {
          path: "",
          id: "root",
          hasErrorBoundary: true,
          loader: true,
          children: [
            {
              path: "/",
              id: "index",
              loader: false,
              action: true,
              hasErrorBoundary: false,
            },
            {
              path: "/foo",
              id: "foo",
              loader: false,
              action: true,
              hasErrorBoundary: false,
            },
          ],
        },
      ]);
      t._internalSetRoutes(newRoutes);

      // Revalidate and interrupt with a navigation
      let R = await t.revalidate();
      let N = await t.navigate("/?revalidate");

      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.revalidation).toBe("loading");

      // Should still expose be the og routes until navigation completes
      expect(t.router.routes).toBe(ogRoutes);

      // Revalidation cancelled so this shouldn't make it through
      await R.loaders.root.resolve("ROOT STALE");

      // Resolve any loaders that should have ran (foo's loader has been removed)
      await N.loaders.root.resolve("ROOT*");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(t.router.routes).not.toBe(ogRoutes);
      expect(t.router.routes).toEqual(newRoutes);

      // Loader data should be updated
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
      });
      expect(t.router.state.errors).toEqual(null);
    });

    it("should retain existing routes until interrupted navigation completes", async () => {
      let t = initializeTmTest();
      let ogRoutes = t.router.routes;

      let N = await t.navigate("/foo");

      let newRoutes = t.enhanceRoutes([
        {
          path: "",
          id: "root",
          hasErrorBoundary: true,
          loader: true,
          children: [
            {
              path: "/",
              id: "index",
              loader: false,
              action: true,
              hasErrorBoundary: false,
            },
            {
              path: "/foo",
              id: "foo",
              loader: false,
              action: true,
              hasErrorBoundary: false,
            },
          ],
        },
      ]);
      t._internalSetRoutes(newRoutes);

      // Interrupt /foo navigation with a revalidation
      let R = await t.revalidate();

      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.revalidation).toBe("loading");

      // Should still expose be the og routes until navigation completes
      expect(t.router.routes).toBe(ogRoutes);

      // NAvigation interrupted so this shouldn't make it through
      await N.loaders.root.resolve("ROOT STALE");

      // Resolve any loaders that should have ran (foo's loader has been removed)
      await R.loaders.root.resolve("ROOT*");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(t.router.routes).not.toBe(ogRoutes);
      expect(t.router.routes).toEqual(newRoutes);

      // Loader data should be updated
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
      });
      expect(t.router.state.errors).toEqual(null);
    });

    it("should retain existing routes until revalidation completes on loader removal (fetch)", async () => {
      let rootDfd = createDeferred();
      let fooDfd = createDeferred();
      let ogRoutes: AgnosticDataRouteObject[] = [
        {
          path: "/",
          id: "root",
          hasErrorBoundary: true,
          loader: () => rootDfd.promise,
          children: [
            {
              index: true,
              id: "index",
              hasErrorBoundary: false,
            },
            {
              path: "foo",
              id: "foo",
              loader: () => fooDfd.promise,
              children: undefined,
              hasErrorBoundary: false,
            },
          ],
        },
      ];
      currentRouter = createRouter({
        routes: ogRoutes,
        history: createMemoryHistory(),
        hydrationData: {
          loaderData: {
            root: "ROOT INITIAL",
          },
        },
      });
      currentRouter.initialize();

      let key = "key";
      currentRouter.fetch(key, "root", "/foo");
      await fooDfd.resolve("FOO");
      expect(currentRouter.state.fetchers.get("key")?.data).toBe("FOO");

      let rootDfd2 = createDeferred();
      let newRoutes: AgnosticDataRouteObject[] = [
        {
          path: "/",
          id: "root",
          loader: () => rootDfd2.promise,
          hasErrorBoundary: true,
          children: [
            {
              index: true,
              id: "index",
              hasErrorBoundary: false,
            },
            {
              path: "foo",
              id: "foo",
              children: undefined,
              hasErrorBoundary: false,
            },
          ],
        },
      ];

      currentRouter._internalSetRoutes(newRoutes);

      // Interrupt /foo navigation with a revalidation
      currentRouter.revalidate();

      expect(currentRouter.state.revalidation).toBe("loading");

      // Should still expose be the og routes until navigation completes
      expect(currentRouter.routes).toEqual(ogRoutes);

      // Resolve any loaders that should have ran (foo's loader has been removed)
      await rootDfd2.resolve("ROOT*");
      expect(currentRouter.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(currentRouter.routes).not.toEqual(ogRoutes);
      expect(currentRouter.routes).toEqual(newRoutes);

      // Loader data should be updated
      expect(currentRouter.state.loaderData).toEqual({
        root: "ROOT*",
      });
      // Fetcher should have been revalidated but throw an error since the
      // loader was removed
      expect(currentRouter.state.fetchers.get("key")?.data).toBe(undefined);
      expect(currentRouter.state.errors).toMatchInlineSnapshot(`
        {
          "root": ErrorResponse {
            "data": "Error: No route matches URL "/foo"",
            "error": [Error: No route matches URL "/foo"],
            "internal": true,
            "status": 404,
            "statusText": "Not Found",
          },
        }
      `);
    });

    it("should retain existing routes until revalidation completes on route removal (fetch)", async () => {
      let rootDfd = createDeferred();
      let fooDfd = createDeferred();
      let ogRoutes: AgnosticDataRouteObject[] = [
        {
          path: "/",
          id: "root",
          hasErrorBoundary: true,
          loader: () => rootDfd.promise,
          children: [
            {
              index: true,
              id: "index",
              hasErrorBoundary: false,
            },
            {
              path: "foo",
              id: "foo",
              loader: () => fooDfd.promise,
              children: undefined,
              hasErrorBoundary: false,
            },
          ],
        },
      ];
      currentRouter = createRouter({
        routes: ogRoutes,
        history: createMemoryHistory(),
        hydrationData: {
          loaderData: {
            root: "ROOT INITIAL",
          },
        },
      });
      currentRouter.initialize();

      let key = "key";
      currentRouter.fetch(key, "root", "/foo");
      await fooDfd.resolve("FOO");
      expect(currentRouter.state.fetchers.get("key")?.data).toBe("FOO");

      let rootDfd2 = createDeferred();
      let newRoutes: AgnosticDataRouteObject[] = [
        {
          path: "/",
          id: "root",
          loader: () => rootDfd2.promise,
          hasErrorBoundary: true,
          children: [
            {
              index: true,
              id: "index",
              hasErrorBoundary: false,
            },
          ],
        },
      ];

      currentRouter._internalSetRoutes(newRoutes);

      // Interrupt /foo navigation with a revalidation
      currentRouter.revalidate();

      expect(currentRouter.state.revalidation).toBe("loading");

      // Should still expose be the og routes until navigation completes
      expect(currentRouter.routes).toEqual(ogRoutes);

      // Resolve any loaders that should have ran (foo's loader has been removed)
      await rootDfd2.resolve("ROOT*");
      expect(currentRouter.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(currentRouter.routes).not.toEqual(ogRoutes);
      expect(currentRouter.routes).toEqual(newRoutes);

      // Loader data should be updated
      expect(currentRouter.state.loaderData).toEqual({
        root: "ROOT*",
      });
      // Fetcher should have been revalidated but theown a 404 wince the route was removed
      expect(currentRouter.state.fetchers.get("key")?.data).toBe(undefined);
      expect(currentRouter.state.errors).toEqual({
        root: new ErrorResponse(
          404,
          "Not Found",
          new Error('No route matches URL "/foo"'),
          true
        ),
      });
    });
  });

  describe("path resolution", () => {
    describe("routing to self", () => {
      // Utility that accepts children of /foo routes and executes the same
      // routing tests starting at /foo/bar/?a=b#hash
      function assertRoutingToSelf(fooChildren, expectedPath, expectIndex) {
        const getRouter = () =>
          createRouter({
            routes: [
              {
                path: "/",
                children: [
                  {
                    path: "foo",
                    children: fooChildren,
                  },
                ],
              },
            ],
            history: createMemoryHistory({
              initialEntries: ["/foo/bar?a=1#hash"],
            }),
          }).initialize();

        // Null should preserve the search/hash
        let router = getRouter();
        router.navigate(null, { fromRouteId: "activeRoute" });
        expect(createPath(router.state.location)).toBe(
          expectedPath + (expectIndex ? "?index&a=1#hash" : "?a=1#hash")
        );
        router.dispose();

        // "." and "" should not preserve the search and hash
        router = getRouter();
        router.navigate(".", { fromRouteId: "activeRoute" });
        expect(createPath(router.state.location)).toBe(
          expectedPath + (expectIndex ? "?index" : "")
        );
        router.dispose();

        router = getRouter();
        router.navigate("", { fromRouteId: "activeRoute" });
        expect(createPath(router.state.location)).toBe(
          expectedPath + (expectIndex ? "?index" : "")
        );
        router.dispose();
      }

      /* eslint-disable jest/expect-expect */
      it("from a static route", () => {
        assertRoutingToSelf(
          [
            {
              id: "activeRoute",
              path: "bar",
            },
          ],
          "/foo/bar",
          false
        );
      });

      it("from a layout route", () => {
        assertRoutingToSelf(
          [
            {
              id: "activeRoute",
              path: "bar",
              children: [
                {
                  index: true,
                },
              ],
            },
          ],
          "/foo/bar",
          false
        );
      });

      it("from an index route", () => {
        assertRoutingToSelf(
          [
            {
              path: "bar",
              children: [
                {
                  id: "activeRoute",
                  index: true,
                },
              ],
            },
          ],
          "/foo/bar",
          true
        );
      });

      it("from an index route with a path", () => {
        assertRoutingToSelf(
          [
            {
              id: "activeRoute",
              path: "bar",
              index: true,
            },
          ],
          "/foo/bar",
          true
        );
      });

      it("from a dynamic param route", () => {
        assertRoutingToSelf(
          [
            {
              id: "activeRoute",
              path: ":param",
            },
          ],
          "/foo/bar",
          false
        );
      });

      it("from a splat route", () => {
        assertRoutingToSelf(
          [
            {
              id: "activeRoute",
              path: "*",
            },
          ],
          "/foo",
          false
        );
      });
      /* eslint-enable jest/expect-expect */
    });

    describe("routing to parent", () => {
      function assertRoutingToParent(fooChildren) {
        let router = createRouter({
          routes: [
            {
              path: "/",
              children: [
                {
                  path: "foo",
                  children: fooChildren,
                },
              ],
            },
          ],
          history: createMemoryHistory({
            initialEntries: ["/foo/bar?a=1#hash"],
          }),
        }).initialize();

        // Null should preserve the search/hash
        router.navigate("..", { fromRouteId: "activeRoute" });
        expect(createPath(router.state.location)).toBe("/foo");
      }

      /* eslint-disable jest/expect-expect */
      it("from a static route", () => {
        assertRoutingToParent([
          {
            id: "activeRoute",
            path: "bar",
          },
        ]);
      });

      it("from a layout route", () => {
        assertRoutingToParent([
          {
            id: "activeRoute",
            path: "bar",
            children: [
              {
                index: true,
              },
            ],
          },
        ]);
      });

      it("from an index route", () => {
        assertRoutingToParent([
          {
            path: "bar",
            children: [
              {
                id: "activeRoute",
                index: true,
              },
            ],
          },
        ]);
      });

      it("from an index route with a path", () => {
        assertRoutingToParent([
          {
            id: "activeRoute",
            path: "bar",
            index: true,
          },
        ]);
      });

      it("from a dynamic param route", () => {
        assertRoutingToParent([
          {
            id: "activeRoute",
            path: ":param",
          },
        ]);
      });

      it("from a splat route", () => {
        assertRoutingToParent([
          {
            id: "activeRoute",
            path: "*",
          },
        ]);
      });
      /* eslint-enable jest/expect-expect */
    });

    describe("routing to sibling", () => {
      function assertRoutingToSibling(fooChildren) {
        let router = createRouter({
          routes: [
            {
              path: "/",
              children: [
                {
                  path: "foo",
                  children: [
                    ...fooChildren,
                    {
                      path: "bar-sibling",
                    },
                  ],
                },
              ],
            },
          ],
          history: createMemoryHistory({
            initialEntries: ["/foo/bar?a=1#hash"],
          }),
        }).initialize();

        // Null should preserve the search/hash
        router.navigate("../bar-sibling", { fromRouteId: "activeRoute" });
        expect(createPath(router.state.location)).toBe("/foo/bar-sibling");
      }

      /* eslint-disable jest/expect-expect */
      it("from a static route", () => {
        assertRoutingToSibling([
          {
            id: "activeRoute",
            path: "bar",
          },
        ]);
      });

      it("from a layout route", () => {
        assertRoutingToSibling([
          {
            id: "activeRoute",
            path: "bar",
            children: [
              {
                index: true,
              },
            ],
          },
        ]);
      });

      it("from an index route", () => {
        assertRoutingToSibling([
          {
            path: "bar",
            children: [
              {
                id: "activeRoute",
                index: true,
              },
            ],
          },
        ]);
      });

      it("from an index route with a path", () => {
        assertRoutingToSibling([
          {
            id: "activeRoute",
            path: "bar",
            index: true,
          },
        ]);
      });

      it("from a dynamic param route", () => {
        assertRoutingToSibling([
          {
            id: "activeRoute",
            path: ":param",
          },
        ]);
      });

      it("from a splat route", () => {
        assertRoutingToSibling([
          {
            id: "activeRoute",
            path: "*",
          },
        ]);
      });
      /* eslint-enable jest/expect-expect */
    });

    describe("routing to child", () => {
      function assertRoutingToChild(fooChildren) {
        const getRouter = () =>
          createRouter({
            routes: [
              {
                path: "/",
                children: [
                  {
                    path: "foo",
                    children: [...fooChildren],
                  },
                ],
              },
            ],
            history: createMemoryHistory({
              initialEntries: ["/foo/bar?a=1#hash"],
            }),
          }).initialize();

        let router = getRouter();
        router.navigate("baz", { fromRouteId: "activeRoute" });
        expect(createPath(router.state.location)).toBe("/foo/bar/baz");
        router.dispose();

        router = getRouter();
        router.navigate("./baz", { fromRouteId: "activeRoute" });
        expect(createPath(router.state.location)).toBe("/foo/bar/baz");
        router.dispose();
      }

      /* eslint-disable jest/expect-expect */
      it("from a static route", () => {
        assertRoutingToChild([
          {
            id: "activeRoute",
            path: "bar",
            children: [{ path: "baz" }],
          },
        ]);
      });

      it("from a layout route", () => {
        assertRoutingToChild([
          {
            id: "activeRoute",
            path: "bar",
            children: [
              {
                index: true,
              },
              { path: "baz" },
            ],
          },
        ]);
      });

      it("from a dynamic param route", () => {
        assertRoutingToChild([
          {
            id: "activeRoute",
            path: ":param",
            children: [{ path: "baz" }],
          },
        ]);
      });
      /* eslint-enable jest/expect-expect */
    });

    it("resolves relative routes when using relative:path", () => {
      let history = createMemoryHistory({
        initialEntries: ["/a/b/c/d/e/f"],
      });
      let routes = [
        {
          id: "a",
          path: "/a",
          children: [
            {
              id: "bc",
              path: "b/c",
              children: [
                {
                  id: "de",
                  path: "d/e",
                  children: [
                    {
                      id: "f",
                      path: "f",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];

      // Navigating without relative:path
      let router = createRouter({ routes, history }).initialize();
      router.navigate("..");
      expect(router.state.location.pathname).toBe("/a/b/c/d/e");
      router.navigate("/a/b/c/d/e/f");

      router.navigate("../..");
      expect(router.state.location.pathname).toBe("/a/b/c");
      router.navigate("/a/b/c/d/e/f");

      // Navigating with relative:path
      router.navigate("..", { relative: "path" });
      expect(router.state.location.pathname).toBe("/a/b/c/d/e");
      router.navigate("/a/b/c/d/e/f");

      router.navigate("../..", { relative: "path" });
      expect(router.state.location.pathname).toBe("/a/b/c/d");
      router.navigate("/a/b/c/d/e/f");

      router.dispose();
    });

    it("should not append ?index to get submission navigations to self from index route", () => {
      let router = createRouter({
        routes: [
          {
            path: "/",
            children: [
              {
                path: "path",
                children: [
                  {
                    id: "activeRouteId",
                    index: true,
                  },
                ],
              },
            ],
          },
        ],
        history: createMemoryHistory({ initialEntries: ["/path"] }),
      }).initialize();

      router.navigate(null, {
        fromRouteId: "activeRouteId",
        formData: createFormData({}),
      });
      expect(createPath(router.state.location)).toBe("/path");
      expect(router.state.matches[2].route.index).toBe(true);

      router.navigate(".", {
        fromRouteId: "activeRouteId",
        formData: createFormData({}),
      });
      expect(createPath(router.state.location)).toBe("/path");
      expect(router.state.matches[2].route.index).toBe(true);

      router.navigate("", {
        fromRouteId: "activeRouteId",
        formData: createFormData({}),
      });
      expect(createPath(router.state.location)).toBe("/path");
      expect(router.state.matches[2].route.index).toBe(true);
    });

    it("handles pathless relative routing when a basename is present", () => {
      let router = createRouter({
        routes: [{ path: "/path" }],
        future: { v7_prependBasename: true },
        history: createMemoryHistory({ initialEntries: ["/base/path"] }),
        basename: "/base",
      }).initialize();

      expect(createPath(router.state.location)).toBe("/base/path");
      expect(router.state.matches[0].route.path).toBe("/path");

      router.navigate(".?a=1");
      expect(createPath(router.state.location)).toBe("/base/path?a=1");
      expect(router.state.matches[0].route.path).toBe("/path");

      router.navigate("?b=2");
      expect(createPath(router.state.location)).toBe("/base/path?b=2");
      expect(router.state.matches[0].route.path).toBe("/path");

      router.navigate("/path?c=3");
      expect(createPath(router.state.location)).toBe("/base/path?c=3");
      expect(router.state.matches[0].route.path).toBe("/path");
    });
  });
});
