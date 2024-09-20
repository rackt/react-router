import * as React from "react";
import type {
  Path,
  RevalidationState,
  Router as RemixRouter,
  StaticHandlerContext,
  CreateStaticHandlerOptions as RouterCreateStaticHandlerOptions,
  UNSAFE_RouteManifest as RouteManifest,
  RouterState,
  FutureConfig as RouterFutureConfig,
} from "@remix-run/router";
import {
  IDLE_BLOCKER,
  IDLE_FETCHER,
  IDLE_NAVIGATION,
  Action,
  UNSAFE_invariant as invariant,
  isRouteErrorResponse,
  createStaticHandler as routerCreateStaticHandler,
  UNSAFE_convertRoutesToDataRoutes as convertRoutesToDataRoutes,
} from "@remix-run/router";
import {
  UNSAFE_mapRouteProperties as mapRouteProperties,
  UNSAFE_useRoutesImpl as useRoutesImpl,
} from "react-router";
import type {
  DataRouteObject,
  FutureConfig,
  Location,
  RouteObject,
  To,
} from "react-router-dom";
import {
  createPath,
  parsePath,
  Router,
  UNSAFE_DataRouterContext as DataRouterContext,
  UNSAFE_DataRouterStateContext as DataRouterStateContext,
  UNSAFE_FetchersContext as FetchersContext,
  UNSAFE_ViewTransitionContext as ViewTransitionContext,
} from "react-router-dom";

export interface StaticRouterProps {
  basename?: string;
  children?: React.ReactNode;
  location: Partial<Location> | string;
  future?: Partial<FutureConfig>;
}

/**
 * A `<Router>` that may not navigate to any other location. This is useful
 * on the server where there is no stateful UI.
 */
export function StaticRouter({
  basename,
  children,
  location: locationProp = "/",
  future,
}: StaticRouterProps) {
  if (typeof locationProp === "string") {
    locationProp = parsePath(locationProp);
  }

  let action = Action.Pop;
  let location: Location = {
    pathname: locationProp.pathname || "/",
    search: locationProp.search || "",
    hash: locationProp.hash || "",
    state: locationProp.state != null ? locationProp.state : null,
    key: locationProp.key || "default",
  };

  let staticNavigator = getStatelessNavigator();
  return (
    <Router
      basename={basename}
      children={children}
      location={location}
      navigationType={action}
      navigator={staticNavigator}
      future={future}
      static={true}
    />
  );
}

export { StaticHandlerContext };

export interface StaticRouterProviderProps {
  context: StaticHandlerContext;
  router: RemixRouter;
  hydrate?: boolean;
  nonce?: string;
}

/**
 * A Data Router that may not navigate to any other location. This is useful
 * on the server where there is no stateful UI.
 */
export function StaticRouterProvider({
  context,
  router,
  hydrate = true,
  nonce,
}: StaticRouterProviderProps) {
  invariant(
    router && context,
    "You must provide `router` and `context` to <StaticRouterProvider>"
  );

  let dataRouterContext = {
    router,
    navigator: getStatelessNavigator(),
    static: true,
    staticContext: context,
    basename: context.basename || "/",
  };

  let fetchersContext = new Map();

  let hydrateScript = "";

  if (hydrate !== false) {
    let data = {
      loaderData: context.loaderData,
      actionData: context.actionData,
      errors: serializeErrors(context.errors),
    };
    // Use JSON.parse here instead of embedding a raw JS object here to speed
    // up parsing on the client.  Dual-stringify is needed to ensure all quotes
    // are properly escaped in the resulting string.  See:
    //   https://v8.dev/blog/cost-of-javascript-2019#json
    let json = htmlEscape(JSON.stringify(JSON.stringify(data)));
    hydrateScript = `window.__staticRouterHydrationData = JSON.parse(${json});`;
  }

  let { state } = dataRouterContext.router;

  return (
    <>
      <DataRouterContext.Provider value={dataRouterContext}>
        <DataRouterStateContext.Provider value={state}>
          <FetchersContext.Provider value={fetchersContext}>
            <ViewTransitionContext.Provider value={{ isTransitioning: false }}>
              <Router
                basename={dataRouterContext.basename}
                location={state.location}
                navigationType={state.historyAction}
                navigator={dataRouterContext.navigator}
                static={dataRouterContext.static}
                future={{
                  v7_relativeSplatPath: router.future.v7_relativeSplatPath,
                }}
              >
                <DataRoutes
                  routes={router.routes}
                  future={router.future}
                  state={state}
                />
              </Router>
            </ViewTransitionContext.Provider>
          </FetchersContext.Provider>
        </DataRouterStateContext.Provider>
      </DataRouterContext.Provider>
      {hydrateScript ? (
        <script
          suppressHydrationWarning
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: hydrateScript }}
        />
      ) : null}
    </>
  );
}

function DataRoutes({
  routes,
  future,
  state,
}: {
  routes: DataRouteObject[];
  future: RemixRouter["future"];
  state: RouterState;
}): React.ReactElement | null {
  return useRoutesImpl(routes, undefined, state, future);
}

function serializeErrors(
  errors: StaticHandlerContext["errors"]
): StaticHandlerContext["errors"] {
  if (!errors) return null;
  let entries = Object.entries(errors);
  let serialized: StaticHandlerContext["errors"] = {};
  for (let [key, val] of entries) {
    // Hey you!  If you change this, please change the corresponding logic in
    // deserializeErrors in react-router-dom/index.tsx :)
    if (isRouteErrorResponse(val)) {
      serialized[key] = { ...val, __type: "RouteErrorResponse" };
    } else if (val instanceof Error) {
      // Do not serialize stack traces from SSR for security reasons
      serialized[key] = {
        message: val.message,
        __type: "Error",
        // If this is a subclass (i.e., ReferenceError), send up the type so we
        // can re-create the same type during hydration.
        ...(val.name !== "Error"
          ? {
              __subType: val.name,
            }
          : {}),
      };
    } else {
      serialized[key] = val;
    }
  }
  return serialized;
}

function getStatelessNavigator() {
  return {
    createHref,
    encodeLocation,
    push(to: To) {
      throw new Error(
        `You cannot use navigator.push() on the server because it is a stateless ` +
          `environment. This error was probably triggered when you did a ` +
          `\`navigate(${JSON.stringify(to)})\` somewhere in your app.`
      );
    },
    replace(to: To) {
      throw new Error(
        `You cannot use navigator.replace() on the server because it is a stateless ` +
          `environment. This error was probably triggered when you did a ` +
          `\`navigate(${JSON.stringify(to)}, { replace: true })\` somewhere ` +
          `in your app.`
      );
    },
    go(delta: number) {
      throw new Error(
        `You cannot use navigator.go() on the server because it is a stateless ` +
          `environment. This error was probably triggered when you did a ` +
          `\`navigate(${delta})\` somewhere in your app.`
      );
    },
    back() {
      throw new Error(
        `You cannot use navigator.back() on the server because it is a stateless ` +
          `environment.`
      );
    },
    forward() {
      throw new Error(
        `You cannot use navigator.forward() on the server because it is a stateless ` +
          `environment.`
      );
    },
  };
}

type CreateStaticHandlerOptions = Omit<
  RouterCreateStaticHandlerOptions,
  "detectErrorBoundary" | "mapRouteProperties"
>;

export function createStaticHandler(
  routes: RouteObject[],
  opts?: CreateStaticHandlerOptions
) {
  return routerCreateStaticHandler(routes, {
    ...opts,
    mapRouteProperties,
  });
}

export function createStaticRouter(
  routes: RouteObject[],
  context: StaticHandlerContext,
  opts: {
    // Only accept future flags that impact the server render
    future?: Partial<
      Pick<RouterFutureConfig, "v7_partialHydration" | "v7_relativeSplatPath">
    >;
  } = {}
): RemixRouter {
  let manifest: RouteManifest = {};
  let dataRoutes = convertRoutesToDataRoutes(
    routes,
    mapRouteProperties,
    undefined,
    manifest
  );

  // Because our context matches may be from a framework-agnostic set of
  // routes passed to createStaticHandler(), we update them here with our
  // newly created/enhanced data routes
  let matches = context.matches.map((match) => {
    let route = manifest[match.route.id] || match.route;
    return {
      ...match,
      route,
    };
  });

  let msg = (method: string) =>
    `You cannot use router.${method}() on the server because it is a stateless environment`;

  return {
    get basename() {
      return context.basename;
    },
    get future() {
      return {
        v7_fetcherPersist: false,
        v7_normalizeFormMethod: false,
        v7_partialHydration: opts.future?.v7_partialHydration === true,
        v7_prependBasename: false,
        v7_relativeSplatPath: opts.future?.v7_relativeSplatPath === true,
        v7_skipActionErrorRevalidation: false,
      };
    },
    get state() {
      return {
        historyAction: Action.Pop,
        location: context.location,
        matches,
        loaderData: context.loaderData,
        actionData: context.actionData,
        errors: context.errors,
        initialized: true,
        navigation: IDLE_NAVIGATION,
        restoreScrollPosition: null,
        preventScrollReset: false,
        revalidation: "idle" as RevalidationState,
        fetchers: new Map(),
        blockers: new Map(),
      };
    },
    get routes() {
      return dataRoutes;
    },
    get window() {
      return undefined;
    },
    initialize() {
      throw msg("initialize");
    },
    subscribe() {
      throw msg("subscribe");
    },
    enableScrollRestoration() {
      throw msg("enableScrollRestoration");
    },
    navigate() {
      throw msg("navigate");
    },
    fetch() {
      throw msg("fetch");
    },
    revalidate() {
      throw msg("revalidate");
    },
    createHref,
    encodeLocation,
    getFetcher() {
      return IDLE_FETCHER;
    },
    deleteFetcher() {
      throw msg("deleteFetcher");
    },
    resetFetcher() {
      throw msg("resetFetcher");
    },
    abortFetcher() {
      throw msg("abortFetcher");
    },
    dispose() {
      throw msg("dispose");
    },
    getBlocker() {
      return IDLE_BLOCKER;
    },
    deleteBlocker() {
      throw msg("deleteBlocker");
    },
    patchRoutes() {
      throw msg("patchRoutes");
    },
    _internalFetchControllers: new Map(),
    _internalActiveDeferreds: new Map(),
    _internalSetRoutes() {
      throw msg("_internalSetRoutes");
    },
  };
}

function createHref(to: To) {
  return typeof to === "string" ? to : createPath(to);
}

function encodeLocation(to: To): Path {
  let href = typeof to === "string" ? to : createPath(to);
  // Treating this as a full URL will strip any trailing spaces so we need to
  // pre-encode them since they might be part of a matching splat param from
  // an ancestor route
  href = href.replace(/ $/, "%20");
  let encoded = ABSOLUTE_URL_REGEX.test(href)
    ? new URL(href)
    : new URL(href, "http://localhost");
  return {
    pathname: encoded.pathname,
    search: encoded.search,
    hash: encoded.hash,
  };
}

const ABSOLUTE_URL_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

// This utility is based on https://github.com/zertosh/htmlescape
// License: https://github.com/zertosh/htmlescape/blob/0527ca7156a524d256101bb310a9f970f63078ad/LICENSE
const ESCAPE_LOOKUP: { [match: string]: string } = {
  "&": "\\u0026",
  ">": "\\u003e",
  "<": "\\u003c",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

const ESCAPE_REGEX = /[&><\u2028\u2029]/g;

function htmlEscape(str: string): string {
  return str.replace(ESCAPE_REGEX, (match) => ESCAPE_LOOKUP[match]);
}
