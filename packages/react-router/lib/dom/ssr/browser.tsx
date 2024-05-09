import * as React from "react";
import type { HydrationState, Router as RemixRouter } from "../../router";
import { createBrowserHistory, createRouter, matchRoutes } from "../../router";

import "../global";
import { mapRouteProperties } from "../../components";
import { RouterProvider } from "../lib";
import type { AssetsManifest } from "./entry";
import { deserializeErrors } from "./errors";
import type { RouteModules } from "./routeModules";
import invariant from "./invariant";
import {
  createClientRoutes,
  createClientRoutesWithHMRRevalidationOptOut,
  shouldHydrateRouteLoader,
} from "./routes";
import {
  decodeViaTurboStream,
  getSingleFetchDataStrategy,
} from "./single-fetch";
import { RemixContext } from "./components";
import { RemixErrorBoundary } from "./errorBoundaries";

type SSRInfo = {
  context: NonNullable<(typeof window)["__remixContext"]>;
  routeModules: RouteModules;
  manifest: AssetsManifest;
  stateDecodingPromise:
    | (Promise<void> & {
        value?: unknown;
        error?: unknown;
      })
    | undefined;
  router: RemixRouter | undefined;
  routerInitialized: boolean;
};

let ssrInfo: SSRInfo | null = null;
let router: RemixRouter | null = null;

function initSsrInfo(): void {
  if (
    !ssrInfo &&
    window.__remixContext &&
    window.__remixManifest &&
    window.__remixRouteModules
  ) {
    ssrInfo = {
      context: window.__remixContext,
      manifest: window.__remixManifest,
      routeModules: window.__remixRouteModules,
      stateDecodingPromise: undefined,
      router: undefined,
      routerInitialized: false,
    };
  }
}

type HmrInfo = {
  abortController: AbortController | undefined;
  routerReadyResolve: (router: RemixRouter) => void;
  routerReadyPromise: Promise<RemixRouter>;
};

let hmrInfo: HmrInfo | null = null;

if (
  import.meta &&
  // @ts-expect-error
  import.meta.hot &&
  window.__remixManifest
) {
  let resolve: (router: RemixRouter) => void;
  let routerReadyPromise = new Promise((r) => {
    resolve = r;
  }).catch(() => {
    // This is a noop catch handler to avoid unhandled promise rejection warnings
    // in the console. The promise is never rejected.
    return undefined;
  }) as Promise<RemixRouter>;

  hmrInfo = {
    abortController: undefined,
    routerReadyResolve: resolve!,
    // There's a race condition with HMR where the remix:manifest is signaled before
    // the router is assigned in the RemixBrowser component. This promise gates the
    // HMR handler until the router is ready
    routerReadyPromise,
  };

  // @ts-expect-error
  import.meta.hot.accept(
    "remix:manifest",
    async ({
      assetsManifest,
      needsRevalidation,
    }: {
      assetsManifest: AssetsManifest;
      needsRevalidation: Set<string>;
    }) => {
      let router = await hmrInfo!.routerReadyPromise;
      // This should never happen, but just in case...
      if (!router || !ssrInfo || !hmrInfo) {
        console.error(
          "Failed to accept HMR update because the router/ssrInfo was not ready."
        );
        return;
      }

      let routeIds = [
        ...new Set(
          router.state.matches
            .map((m) => m.route.id)
            .concat(Object.keys(ssrInfo!.routeModules))
        ),
      ];

      hmrInfo.abortController?.abort();
      hmrInfo.abortController = new AbortController();
      let signal = hmrInfo.abortController.signal;

      // Load new route modules that we've seen.
      let newRouteModules = Object.assign(
        {},
        ssrInfo.routeModules,
        Object.fromEntries(
          (
            await Promise.all(
              routeIds.map(async (id) => {
                if (!assetsManifest.routes[id]) {
                  return null;
                }
                let imported = await import(
                  assetsManifest.routes[id].module +
                    `?t=${assetsManifest.hmr?.timestamp}`
                );
                invariant(ssrInfo, "ssrInfo unavailable for HMR update");
                return [
                  id,
                  {
                    ...imported,
                    // react-refresh takes care of updating these in-place,
                    // if we don't preserve existing values we'll loose state.
                    default: imported.default
                      ? ssrInfo.routeModules[id]?.default || imported.default
                      : imported.default,
                    ErrorBoundary: imported.ErrorBoundary
                      ? ssrInfo.routeModules[id]?.ErrorBoundary ||
                        imported.ErrorBoundary
                      : imported.ErrorBoundary,
                    HydrateFallback: imported.HydrateFallback
                      ? ssrInfo.routeModules[id]?.HydrateFallback ||
                        imported.HydrateFallback
                      : imported.HydrateFallback,
                  },
                ];
              })
            )
          ).filter(Boolean) as [string, RouteModules[string]][]
        )
      );

      Object.assign(ssrInfo.routeModules, newRouteModules);
      // Create new routes
      let routes = createClientRoutesWithHMRRevalidationOptOut(
        needsRevalidation,
        assetsManifest.routes,
        ssrInfo.routeModules,
        ssrInfo.context.state,
        ssrInfo.context.future,
        ssrInfo.context.isSpaMode
      );

      // This is temporary API and will be more granular before release
      router._internalSetRoutes(routes);

      // Wait for router to be idle before updating the manifest and route modules
      // and triggering a react-refresh
      let unsub = router.subscribe((state) => {
        if (state.revalidation === "idle") {
          unsub();
          // Abort if a new update comes in while we're waiting for the
          // router to be idle.
          if (signal.aborted) return;
          // Ensure RouterProvider setState has flushed before re-rendering
          setTimeout(() => {
            Object.assign(ssrInfo!.manifest, assetsManifest);
            window.$RefreshRuntime$!.performReactRefresh();
          }, 1);
        }
      });
      window.__remixRevalidation = (window.__remixRevalidation || 0) + 1;
      router.revalidate();
    }
  );
}

function createHydratedRouter(): RemixRouter {
  initSsrInfo();

  if (!ssrInfo) {
    throw new Error(
      "You must be using the SSR features of React Router in order to skip " +
        "passing a `router` prop to `<RouterProvider>`"
    );
  }

  // TODO: Do some testing to confirm it's OK to skip the hard reload check
  // now that all route.lazy stuff is wired up

  // We need to suspend until the initial state snapshot is decoded into
  // window.__remixContext.state

  let localSsrInfo = ssrInfo;
  // Note: `stateDecodingPromise` is not coupled to `router` - we'll reach this
  // code potentially many times waiting for our state to arrive, but we'll
  // then only get past here and create the `router` one time
  if (!ssrInfo.stateDecodingPromise) {
    let stream = ssrInfo.context.stream;
    invariant(stream, "No stream found for single fetch decoding");
    ssrInfo.context.stream = undefined;
    ssrInfo.stateDecodingPromise = decodeViaTurboStream(stream, window)
      .then((value) => {
        ssrInfo!.context.state =
          value.value as typeof localSsrInfo.context.state;
        localSsrInfo.stateDecodingPromise!.value = true;
      })
      .catch((e) => {
        localSsrInfo.stateDecodingPromise!.error = e;
      });
  }
  if (ssrInfo.stateDecodingPromise.error) {
    throw ssrInfo.stateDecodingPromise.error;
  }
  if (!ssrInfo.stateDecodingPromise.value) {
    throw ssrInfo.stateDecodingPromise;
  }

  let routes = createClientRoutes(
    ssrInfo.manifest.routes,
    ssrInfo.routeModules,
    ssrInfo.context.state,
    ssrInfo.context.future,
    ssrInfo.context.isSpaMode
  );

  let hydrationData: HydrationState | undefined = undefined;
  if (!ssrInfo.context.isSpaMode) {
    // Create a shallow clone of `loaderData` we can mutate for partial hydration.
    // When a route exports a `clientLoader` and a `HydrateFallback`, the SSR will
    // render the fallback so we need the client to do the same for hydration.
    // The server loader data has already been exposed to these route `clientLoader`'s
    // in `createClientRoutes` above, so we need to clear out the version we pass to
    // `createBrowserRouter` so it initializes and runs the client loaders.
    hydrationData = {
      ...ssrInfo.context.state,
      loaderData: { ...ssrInfo.context.state.loaderData },
    };
    let initialMatches = matchRoutes(routes, window.location);
    if (initialMatches) {
      for (let match of initialMatches) {
        let routeId = match.route.id;
        let route = ssrInfo.routeModules[routeId];
        let manifestRoute = ssrInfo.manifest.routes[routeId];
        // Clear out the loaderData to avoid rendering the route component when the
        // route opted into clientLoader hydration and either:
        // * gave us a HydrateFallback
        // * or doesn't have a server loader and we have no data to render
        if (
          route &&
          shouldHydrateRouteLoader(
            manifestRoute,
            route,
            ssrInfo.context.isSpaMode
          ) &&
          (route.HydrateFallback || !manifestRoute.hasLoader)
        ) {
          hydrationData.loaderData![routeId] = undefined;
        } else if (manifestRoute && !manifestRoute.hasLoader) {
          // Since every Remix route gets a `loader` on the client side to load
          // the route JS module, we need to add a `null` value to `loaderData`
          // for any routes that don't have server loaders so our partial
          // hydration logic doesn't kick off the route module loaders during
          // hydration
          hydrationData.loaderData![routeId] = null;
        }
      }
    }

    if (hydrationData && hydrationData.errors) {
      // TODO: De-dup this or remove entirely in v7 where single fetch is the
      // only approach and we have already serialized or deserialized on the server
      hydrationData.errors = deserializeErrors(hydrationData.errors);
    }
  }

  // We don't use createBrowserRouter here because we need fine-grained control
  // over initialization to support synchronous `clientLoader` flows.
  let router = createRouter({
    routes,
    history: createBrowserHistory(),
    basename: ssrInfo.context.basename,
    future: {
      v7_normalizeFormMethod: true,
      v7_fetcherPersist: ssrInfo.context.future.v3_fetcherPersist,
      v7_partialHydration: true,
      v7_prependBasename: true,
      v7_relativeSplatPath: ssrInfo.context.future.v3_relativeSplatPath,
      // Single fetch enables this underlying behavior
      unstable_skipActionErrorRevalidation: true,
    },
    hydrationData,
    mapRouteProperties,
    unstable_dataStrategy: getSingleFetchDataStrategy(
      ssrInfo.manifest,
      ssrInfo.routeModules
    ),
  });
  ssrInfo.router = router;

  // We can call initialize() immediately if the router doesn't have any
  // loaders to run on hydration
  if (router.state.initialized) {
    ssrInfo.routerInitialized = true;
    router.initialize();
  }

  // @ts-ignore
  router.createRoutesForHMR = createClientRoutesWithHMRRevalidationOptOut;
  window.__remixRouter = router;

  // Notify that the router is ready for HMR
  hmrInfo?.routerReadyResolve(router);

  return router;
}

export function HydratedRouter() {
  if (!router) {
    router = createHydratedRouter();
  }

  // Critical CSS can become stale after code changes, e.g. styles might be
  // removed from a component, but the styles will still be present in the
  // server HTML. This allows our HMR logic to clear the critical CSS state.
  let [criticalCss, setCriticalCss] = React.useState(
    process.env.NODE_ENV === "development"
      ? ssrInfo?.context.criticalCss
      : undefined
  );
  if (process.env.NODE_ENV === "development") {
    if (ssrInfo) {
      window.__remixClearCriticalCss = () => setCriticalCss(undefined);
    }
  }

  let [location, setLocation] = React.useState(router.state.location);

  React.useLayoutEffect(() => {
    // If we had to run clientLoaders on hydration, we delay initialization until
    // after we've hydrated to avoid hydration issues from synchronous client loaders
    if (ssrInfo && ssrInfo.router && !ssrInfo.routerInitialized) {
      ssrInfo.routerInitialized = true;
      ssrInfo.router.initialize();
    }
  }, []);

  React.useLayoutEffect(() => {
    if (ssrInfo && ssrInfo.router) {
      return ssrInfo.router.subscribe((newState) => {
        if (newState.location !== location) {
          setLocation(newState.location);
        }
      });
    }
  }, [location]);

  invariant(ssrInfo, "ssrInfo unavailable for HydratedRouter");

  // We need to include a wrapper RemixErrorBoundary here in case the root error
  // boundary also throws and we need to bubble up outside of the router entirely.
  // Then we need a stateful location here so the user can back-button navigate
  // out of there
  return (
    // This fragment is important to ensure we match the <RemixServer> JSX
    // structure so that useId values hydrate correctly
    <>
      <RemixContext.Provider
        value={{
          manifest: ssrInfo.manifest,
          routeModules: ssrInfo.routeModules,
          future: ssrInfo.context.future,
          criticalCss,
          isSpaMode: ssrInfo.context.isSpaMode,
        }}
      >
        <RemixErrorBoundary location={location}>
          <RouterProvider
            router={router}
            fallbackElement={null}
            future={{ v7_startTransition: true }}
          />
        </RemixErrorBoundary>
      </RemixContext.Provider>
      {/*
          This fragment is important to ensure we match the <RemixServer> JSX
          structure so that useId values hydrate correctly
        */}
      <></>
    </>
  );
}
