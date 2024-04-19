import type {
  FocusEventHandler,
  MouseEventHandler,
  TouchEventHandler,
} from "react";
import * as React from "react";
import type {
  AgnosticDataRouteMatch,
  UNSAFE_DeferredData as DeferredData,
  RouterState,
  TrackedPromise,
  UIMatch as UIMatchRR,
} from "@remix-run/router";
import {
  Await as AwaitRR,
  UNSAFE_DataRouterContext as DataRouterContext,
  UNSAFE_DataRouterStateContext as DataRouterStateContext,
  matchRoutes,
  useAsyncError,
  useActionData as useActionDataRR,
  useLoaderData as useLoaderDataRR,
  useMatches as useMatchesRR,
  useRouteLoaderData as useRouteLoaderDataRR,
  useLocation,
  useNavigation,
} from "react-router";

import type { FetcherWithComponents } from "../index";
import { useFetcher as useFetcherRR } from "../index";
import type { AppData } from "./data";
import type { RemixContextObject } from "./entry";
import invariant from "./invariant";
import {
  getDataLinkHrefs,
  getKeyedLinksForMatches,
  getKeyedPrefetchLinks,
  getModuleLinkHrefs,
  getNewMatchesForLinks,
  isPageLinkDescriptor,
} from "./links";
import type { KeyedHtmlLinkDescriptor, PrefetchPageDescriptor } from "./links";
import { createHtml, escapeHtml } from "./markup";
import type {
  MetaFunction,
  MetaDescriptor,
  MetaMatch,
  MetaMatches,
  RouteHandle,
} from "./routeModules";
import { addRevalidationParam, singleFetchUrl } from "./single-fetch";

// TODO: Temporary shim until we figure out the way to handle typings in v7
export type SerializeFrom<D> = D extends () => {} ? Awaited<ReturnType<D>> : D;

function useDataRouterContext() {
  let context = React.useContext(DataRouterContext);
  invariant(
    context,
    "You must render this element inside a <DataRouterContext.Provider> element"
  );
  return context;
}

function useDataRouterStateContext() {
  let context = React.useContext(DataRouterStateContext);
  invariant(
    context,
    "You must render this element inside a <DataRouterStateContext.Provider> element"
  );
  return context;
}

////////////////////////////////////////////////////////////////////////////////
// RemixContext

export const RemixContext = React.createContext<RemixContextObject | undefined>(
  undefined
);
RemixContext.displayName = "Remix";

export function useRemixContext(): RemixContextObject {
  let context = React.useContext(RemixContext);
  invariant(context, "You must render this element inside a <Remix> element");
  return context;
}

////////////////////////////////////////////////////////////////////////////////
// Public API

/**
 * Defines the prefetching behavior of the link:
 *
 * - "none": Never fetched
 * - "intent": Fetched when the user focuses or hovers the link
 * - "render": Fetched when the link is rendered
 * - "viewport": Fetched when the link is in the viewport
 */
export type PrefetchBehavior = "intent" | "render" | "none" | "viewport";

interface PrefetchHandlers {
  onFocus?: FocusEventHandler;
  onBlur?: FocusEventHandler;
  onMouseEnter?: MouseEventHandler;
  onMouseLeave?: MouseEventHandler;
  onTouchStart?: TouchEventHandler;
}

export function usePrefetchBehavior<T extends HTMLAnchorElement>(
  prefetch: PrefetchBehavior,
  theirElementProps: PrefetchHandlers
): [boolean, React.RefObject<T>, PrefetchHandlers] {
  let remixContext = React.useContext(RemixContext);
  let [maybePrefetch, setMaybePrefetch] = React.useState(false);
  let [shouldPrefetch, setShouldPrefetch] = React.useState(false);
  let { onFocus, onBlur, onMouseEnter, onMouseLeave, onTouchStart } =
    theirElementProps;

  let ref = React.useRef<T>(null);

  React.useEffect(() => {
    if (prefetch === "render") {
      setShouldPrefetch(true);
    }

    if (prefetch === "viewport") {
      let callback: IntersectionObserverCallback = (entries) => {
        entries.forEach((entry) => {
          setShouldPrefetch(entry.isIntersecting);
        });
      };
      let observer = new IntersectionObserver(callback, { threshold: 0.5 });
      if (ref.current) observer.observe(ref.current);

      return () => {
        observer.disconnect();
      };
    }
  }, [prefetch]);

  React.useEffect(() => {
    if (maybePrefetch) {
      let id = setTimeout(() => {
        setShouldPrefetch(true);
      }, 100);
      return () => {
        clearTimeout(id);
      };
    }
  }, [maybePrefetch]);

  let setIntent = () => {
    setMaybePrefetch(true);
  };

  let cancelIntent = () => {
    setMaybePrefetch(false);
    setShouldPrefetch(false);
  };

  // No prefetching if not using Remix-style SSR
  if (!remixContext) {
    return [false, ref, {}];
  }

  if (prefetch !== "intent") {
    return [shouldPrefetch, ref, {}];
  }

  // When using prefetch="intent" we need to attach focus/hover listeners
  return [
    shouldPrefetch,
    ref,
    {
      onFocus: composeEventHandlers(onFocus, setIntent),
      onBlur: composeEventHandlers(onBlur, cancelIntent),
      onMouseEnter: composeEventHandlers(onMouseEnter, setIntent),
      onMouseLeave: composeEventHandlers(onMouseLeave, cancelIntent),
      onTouchStart: composeEventHandlers(onTouchStart, setIntent),
    },
  ];
}

export function composeEventHandlers<
  EventType extends React.SyntheticEvent | Event
>(
  theirHandler: ((event: EventType) => any) | undefined,
  ourHandler: (event: EventType) => any
): (event: EventType) => any {
  return (event) => {
    theirHandler && theirHandler(event);
    if (!event.defaultPrevented) {
      ourHandler(event);
    }
  };
}

// Return the matches actively being displayed:
// - In SPA Mode we only SSR/hydrate the root match, and include all matches
//   after hydration. This lets the router handle initial match loads via lazy().
// - When an error boundary is rendered, we slice off matches up to the
//   boundary for <Links>/<Meta>
function getActiveMatches(
  matches: RouterState["matches"],
  errors: RouterState["errors"],
  isSpaMode: boolean
) {
  if (isSpaMode && !isHydrated) {
    return [matches[0]];
  }

  if (errors) {
    let errorIdx = matches.findIndex((m) => errors[m.route.id] !== undefined);
    return matches.slice(0, errorIdx + 1);
  }

  return matches;
}

/**
 * Renders the `<link>` tags for the current routes.
 *
 * @see https://remix.run/components/links
 */
export function Links() {
  let { isSpaMode, manifest, routeModules, criticalCss } = useRemixContext();
  let { errors, matches: routerMatches } = useDataRouterStateContext();

  let matches = getActiveMatches(routerMatches, errors, isSpaMode);

  let keyedLinks = React.useMemo(
    () => getKeyedLinksForMatches(matches, routeModules, manifest),
    [matches, routeModules, manifest]
  );

  return (
    <>
      {criticalCss ? (
        <style dangerouslySetInnerHTML={{ __html: criticalCss }} />
      ) : null}
      {keyedLinks.map(({ key, link }) =>
        isPageLinkDescriptor(link) ? (
          <PrefetchPageLinks key={key} {...link} />
        ) : (
          <link key={key} {...link} />
        )
      )}
    </>
  );
}

/**
 * This component renders all the `<link rel="prefetch">` and
 * `<link rel="modulepreload"/>` tags for all the assets (data, modules, css) of
 * a given page.
 *
 * @param props
 * @param props.page
 * @see https://remix.run/components/prefetch-page-links
 */
export function PrefetchPageLinks({
  page,
  ...dataLinkProps
}: PrefetchPageDescriptor) {
  let { router } = useDataRouterContext();
  let matches = React.useMemo(
    () => matchRoutes(router.routes, page, router.basename),
    [router.routes, page, router.basename]
  );

  if (!matches) {
    console.warn(`Tried to prefetch ${page} but no routes matched.`);
    return null;
  }

  return (
    <PrefetchPageLinksImpl page={page} matches={matches} {...dataLinkProps} />
  );
}

function useKeyedPrefetchLinks(matches: AgnosticDataRouteMatch[]) {
  let { manifest, routeModules } = useRemixContext();

  let [keyedPrefetchLinks, setKeyedPrefetchLinks] = React.useState<
    KeyedHtmlLinkDescriptor[]
  >([]);

  React.useEffect(() => {
    let interrupted: boolean = false;

    void getKeyedPrefetchLinks(matches, manifest, routeModules).then(
      (links) => {
        if (!interrupted) {
          setKeyedPrefetchLinks(links);
        }
      }
    );

    return () => {
      interrupted = true;
    };
  }, [matches, manifest, routeModules]);

  return keyedPrefetchLinks;
}

function PrefetchPageLinksImpl({
  page,
  matches: nextMatches,
  ...linkProps
}: PrefetchPageDescriptor & {
  matches: AgnosticDataRouteMatch[];
}) {
  let location = useLocation();
  let { future, manifest, routeModules } = useRemixContext();
  let { matches } = useDataRouterStateContext();

  let newMatchesForData = React.useMemo(
    () =>
      getNewMatchesForLinks(
        page,
        nextMatches,
        matches,
        manifest,
        location,
        "data"
      ),
    [page, nextMatches, matches, manifest, location]
  );

  let newMatchesForAssets = React.useMemo(
    () =>
      getNewMatchesForLinks(
        page,
        nextMatches,
        matches,
        manifest,
        location,
        "assets"
      ),
    [page, nextMatches, matches, manifest, location]
  );

  let dataHrefs = React.useMemo(
    () => getDataLinkHrefs(page, newMatchesForData, manifest),
    [newMatchesForData, page, manifest]
  );

  let moduleHrefs = React.useMemo(
    () => getModuleLinkHrefs(newMatchesForAssets, manifest),
    [newMatchesForAssets, manifest]
  );

  // needs to be a hook with async behavior because we need the modules, not
  // just the manifest like the other links in here.
  let keyedPrefetchLinks = useKeyedPrefetchLinks(newMatchesForAssets);

  let linksToRender: React.ReactNode | React.ReactNode[] | null = null;
  if (!future.unstable_singleFetch) {
    // Non-single-fetch prefetching
    linksToRender = dataHrefs.map((href) => (
      <link key={href} rel="prefetch" as="fetch" href={href} {...linkProps} />
    ));
  } else if (newMatchesForData.length > 0) {
    // Single-fetch with routes that require data
    let url = addRevalidationParam(
      manifest,
      routeModules,
      nextMatches.map((m) => m.route),
      newMatchesForData.map((m) => m.route),
      singleFetchUrl(page)
    );
    if (url.searchParams.get("_routes") !== "") {
      linksToRender = (
        <link
          key={url.pathname + url.search}
          rel="prefetch"
          as="fetch"
          href={url.pathname + url.search}
          {...linkProps}
        />
      );
    } else {
      // No single-fetch prefetching if _routes param is empty due to `clientLoader`'s
    }
  } else {
    // No single-fetch prefetching if there are no new matches for data
  }

  return (
    <>
      {linksToRender}
      {moduleHrefs.map((href) => (
        <link key={href} rel="modulepreload" href={href} {...linkProps} />
      ))}
      {keyedPrefetchLinks.map(({ key, link }) => (
        // these don't spread `linkProps` because they are full link descriptors
        // already with their own props
        <link key={key} {...link} />
      ))}
    </>
  );
}

/**
 * Renders HTML tags related to metadata for the current route.
 *
 * @see https://remix.run/components/meta
 */
export function Meta() {
  let { isSpaMode, routeModules } = useRemixContext();
  let {
    errors,
    matches: routerMatches,
    loaderData,
  } = useDataRouterStateContext();
  let location = useLocation();

  let _matches = getActiveMatches(routerMatches, errors, isSpaMode);

  let error: any = null;
  if (errors) {
    error = errors[_matches[_matches.length - 1].route.id];
  }

  let meta: MetaDescriptor[] = [];
  let leafMeta: MetaDescriptor[] | null = null;
  let matches: MetaMatches = [];
  for (let i = 0; i < _matches.length; i++) {
    let _match = _matches[i];
    let routeId = _match.route.id;
    let data = loaderData[routeId];
    let params = _match.params;
    let routeModule = routeModules[routeId];
    let routeMeta: MetaDescriptor[] | undefined = [];

    let match: MetaMatch = {
      id: routeId,
      data,
      meta: [],
      params: _match.params,
      pathname: _match.pathname,
      handle: _match.route.handle,
      error,
    };
    matches[i] = match;

    if (routeModule?.meta) {
      routeMeta =
        typeof routeModule.meta === "function"
          ? (routeModule.meta as MetaFunction)({
              data,
              params,
              location,
              matches,
              error,
            })
          : Array.isArray(routeModule.meta)
          ? [...routeModule.meta]
          : routeModule.meta;
    } else if (leafMeta) {
      // We only assign the route's meta to the nearest leaf if there is no meta
      // export in the route. The meta function may return a falsy value which
      // is effectively the same as an empty array.
      routeMeta = [...leafMeta];
    }

    routeMeta = routeMeta || [];
    if (!Array.isArray(routeMeta)) {
      throw new Error(
        "The route at " +
          _match.route.path +
          " returns an invalid value. All route meta functions must " +
          "return an array of meta objects." +
          "\n\nTo reference the meta function API, see https://remix.run/route/meta"
      );
    }

    match.meta = routeMeta;
    matches[i] = match;
    meta = [...routeMeta];
    leafMeta = meta;
  }

  return (
    <>
      {meta.flat().map((metaProps) => {
        if (!metaProps) {
          return null;
        }

        if ("tagName" in metaProps) {
          let { tagName, ...rest } = metaProps;
          if (!isValidMetaTag(tagName)) {
            console.warn(
              `A meta object uses an invalid tagName: ${tagName}. Expected either 'link' or 'meta'`
            );
            return null;
          }
          let Comp = tagName;
          return <Comp key={JSON.stringify(rest)} {...rest} />;
        }

        if ("title" in metaProps) {
          return <title key="title">{String(metaProps.title)}</title>;
        }

        if ("charset" in metaProps) {
          metaProps.charSet ??= metaProps.charset;
          delete metaProps.charset;
        }

        if ("charSet" in metaProps && metaProps.charSet != null) {
          return typeof metaProps.charSet === "string" ? (
            <meta key="charSet" charSet={metaProps.charSet} />
          ) : null;
        }

        if ("script:ld+json" in metaProps) {
          try {
            let json = JSON.stringify(metaProps["script:ld+json"]);
            return (
              <script
                key={`script:ld+json:${json}`}
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: json }}
              />
            );
          } catch (err) {
            return null;
          }
        }
        return <meta key={JSON.stringify(metaProps)} {...metaProps} />;
      })}
    </>
  );
}

function isValidMetaTag(tagName: unknown): tagName is "meta" | "link" {
  return typeof tagName === "string" && /^(meta|link)$/.test(tagName);
}

export interface AwaitProps<Resolve> {
  children: React.ReactNode | ((value: Awaited<Resolve>) => React.ReactNode);
  errorElement?: React.ReactNode;
  resolve: Resolve;
}

export function Await<Resolve>(props: AwaitProps<Resolve>) {
  return <AwaitRR {...props} />;
}

/**
 * Tracks whether Remix has finished hydrating or not, so scripts can be skipped
 * during client-side updates.
 */
let isHydrated = false;

export type ScriptProps = Omit<
  React.HTMLProps<HTMLScriptElement>,
  | "children"
  | "async"
  | "defer"
  | "src"
  | "type"
  | "noModule"
  | "dangerouslySetInnerHTML"
  | "suppressHydrationWarning"
>;

/**
 * Renders the `<script>` tags needed for the initial render. Bundles for
 * additional routes are loaded later as needed.
 *
 * @param props Additional properties to add to each script tag that is rendered.
 * In addition to scripts, \<link rel="modulepreload"> tags receive the crossOrigin
 * property if provided.
 *
 * @see https://remix.run/components/scripts
 */
export function Scripts(props: ScriptProps) {
  let {
    manifest,
    serverHandoffString,
    abortDelay,
    serializeError,
    isSpaMode,
    future,
    renderMeta,
  } = useRemixContext();
  let { router, static: isStatic, staticContext } = useDataRouterContext();
  let { matches: routerMatches } = useDataRouterStateContext();
  let navigation = useNavigation();

  // Let <RemixServer> know that we hydrated and we should render the single
  // fetch streaming scripts
  if (renderMeta) {
    renderMeta.didRenderScripts = true;
  }

  let matches = getActiveMatches(routerMatches, null, isSpaMode);

  React.useEffect(() => {
    isHydrated = true;
  }, []);

  let serializePreResolvedErrorImp = (key: string, error: unknown) => {
    let toSerialize: unknown;
    if (serializeError && error instanceof Error) {
      toSerialize = serializeError(error);
    } else {
      toSerialize = error;
    }
    return `${JSON.stringify(key)}:__remixContext.p(!1, ${escapeHtml(
      JSON.stringify(toSerialize)
    )})`;
  };

  let serializePreresolvedDataImp = (
    routeId: string,
    key: string,
    data: unknown
  ) => {
    let serializedData;
    try {
      serializedData = JSON.stringify(data);
    } catch (error) {
      return serializePreResolvedErrorImp(key, error);
    }
    return `${JSON.stringify(key)}:__remixContext.p(${escapeHtml(
      serializedData
    )})`;
  };

  let serializeErrorImp = (routeId: string, key: string, error: unknown) => {
    let toSerialize: unknown;
    if (serializeError && error instanceof Error) {
      toSerialize = serializeError(error);
    } else {
      toSerialize = error;
    }
    return `__remixContext.r(${JSON.stringify(routeId)}, ${JSON.stringify(
      key
    )}, !1, ${escapeHtml(JSON.stringify(toSerialize))})`;
  };

  let serializeDataImp = (routeId: string, key: string, data: unknown) => {
    let serializedData;
    try {
      serializedData = JSON.stringify(data);
    } catch (error) {
      return serializeErrorImp(routeId, key, error);
    }
    return `__remixContext.r(${JSON.stringify(routeId)}, ${JSON.stringify(
      key
    )}, ${escapeHtml(serializedData)})`;
  };

  let deferredScripts: any[] = [];
  let initialScripts = React.useMemo(() => {
    let streamScript = future.unstable_singleFetch
      ? // prettier-ignore
        "window.__remixContext.stream = new ReadableStream({" +
          "start(controller){" +
            "window.__remixContext.streamController = controller;" +
          "}" +
        "}).pipeThrough(new TextEncoderStream());"
      : "";

    if (streamScript && staticContext?.actionData) {
      streamScript +=
        "window.__remixContext.streamAction = new ReadableStream({" +
        "start(controller){" +
        "window.__remixContext.streamControllerAction = controller;" +
        "}" +
        "}).pipeThrough(new TextEncoderStream());";
    }

    let contextScript = staticContext
      ? `window.__remixContext = ${serverHandoffString};${streamScript}`
      : " ";

    // When single fetch is enabled, deferred is handled by turbo-stream
    let activeDeferreds = future.unstable_singleFetch
      ? undefined
      : staticContext?.activeDeferreds;

    // This sets up the __remixContext with utility functions used by the
    // deferred scripts.
    // - __remixContext.p is a function that takes a resolved value or error and returns a promise.
    //   This is used for transmitting pre-resolved promises from the server to the client.
    // - __remixContext.n is a function that takes a routeID and key to returns a promise for later
    //   resolution by the subsequently streamed chunks.
    // - __remixContext.r is a function that takes a routeID, key and value or error and resolves
    //   the promise created by __remixContext.n.
    // - __remixContext.t is a map or routeId to keys to an object containing `e` and `r` methods
    //   to resolve or reject the promise created by __remixContext.n.
    // - __remixContext.a is the active number of deferred scripts that should be rendered to match
    //   the SSR tree for hydration on the client.
    contextScript += !activeDeferreds
      ? ""
      : [
          "__remixContext.p = function(v,e,p,x) {",
          "  if (typeof e !== 'undefined') {",
          process.env.NODE_ENV === "development"
            ? "    x=new Error(e.message);\n    x.stack=e.stack;"
            : '    x=new Error("Unexpected Server Error");\n    x.stack=undefined;',
          "    p=Promise.reject(x);",
          "  } else {",
          "    p=Promise.resolve(v);",
          "  }",
          "  return p;",
          "};",
          "__remixContext.n = function(i,k) {",
          "  __remixContext.t = __remixContext.t || {};",
          "  __remixContext.t[i] = __remixContext.t[i] || {};",
          "  let p = new Promise((r, e) => {__remixContext.t[i][k] = {r:(v)=>{r(v);},e:(v)=>{e(v);}};});",
          typeof abortDelay === "number"
            ? `setTimeout(() => {if(typeof p._error !== "undefined" || typeof p._data !== "undefined"){return;} __remixContext.t[i][k].e(new Error("Server timeout."))}, ${abortDelay});`
            : "",
          "  return p;",
          "};",
          "__remixContext.r = function(i,k,v,e,p,x) {",
          "  p = __remixContext.t[i][k];",
          "  if (typeof e !== 'undefined') {",
          process.env.NODE_ENV === "development"
            ? "    x=new Error(e.message);\n    x.stack=e.stack;"
            : '    x=new Error("Unexpected Server Error");\n    x.stack=undefined;',
          "    p.e(x);",
          "  } else {",
          "    p.r(v);",
          "  }",
          "};",
        ].join("\n") +
        Object.entries(activeDeferreds)
          .map(([routeId, deferredData]) => {
            let pendingKeys = new Set(deferredData.pendingKeys);
            let promiseKeyValues = deferredData.deferredKeys
              .map((key) => {
                if (pendingKeys.has(key)) {
                  deferredScripts.push(
                    <DeferredHydrationScript
                      key={`${routeId} | ${key}`}
                      deferredData={deferredData}
                      routeId={routeId}
                      dataKey={key}
                      scriptProps={props}
                      serializeData={serializeDataImp}
                      serializeError={serializeErrorImp}
                    />
                  );

                  return `${JSON.stringify(
                    key
                  )}:__remixContext.n(${JSON.stringify(
                    routeId
                  )}, ${JSON.stringify(key)})`;
                } else {
                  let trackedPromise = deferredData.data[key] as TrackedPromise;
                  if (typeof trackedPromise._error !== "undefined") {
                    return serializePreResolvedErrorImp(
                      key,
                      trackedPromise._error
                    );
                  } else {
                    return serializePreresolvedDataImp(
                      routeId,
                      key,
                      trackedPromise._data
                    );
                  }
                }
              })
              .join(",\n");
            return `Object.assign(__remixContext.state.loaderData[${JSON.stringify(
              routeId
            )}], {${promiseKeyValues}});`;
          })
          .join("\n") +
        (deferredScripts.length > 0
          ? `__remixContext.a=${deferredScripts.length};`
          : "");

    let routeModulesScript = !isStatic
      ? " "
      : `${
          manifest.hmr?.runtime
            ? `import ${JSON.stringify(manifest.hmr.runtime)};`
            : ""
        }import ${JSON.stringify(manifest.url)};
${matches
  .map(
    (match, index) =>
      `import * as route${index} from ${JSON.stringify(
        manifest.routes[match.route.id].module
      )};`
  )
  .join("\n")}
window.__remixRouteModules = {${matches
          .map(
            (match, index) => `${JSON.stringify(match.route.id)}:route${index}`
          )
          .join(",")}};

import(${JSON.stringify(manifest.entry.module)});`;

    return (
      <>
        <script
          {...props}
          suppressHydrationWarning
          dangerouslySetInnerHTML={createHtml(contextScript)}
          type={undefined}
        />
        <script
          {...props}
          suppressHydrationWarning
          dangerouslySetInnerHTML={createHtml(routeModulesScript)}
          type="module"
          async
        />
      </>
    );
    // disabled deps array because we are purposefully only rendering this once
    // for hydration, after that we want to just continue rendering the initial
    // scripts as they were when the page first loaded
    // eslint-disable-next-line
  }, []);

  if (!isStatic && typeof __remixContext === "object" && __remixContext.a) {
    for (let i = 0; i < __remixContext.a; i++) {
      deferredScripts.push(
        <DeferredHydrationScript
          key={i}
          scriptProps={props}
          serializeData={serializeDataImp}
          serializeError={serializeErrorImp}
        />
      );
    }
  }

  // avoid waterfall when importing the next route module
  let nextMatches = React.useMemo(() => {
    if (navigation.location) {
      // FIXME: can probably use transitionManager `nextMatches`
      let matches = matchRoutes(
        router.routes,
        navigation.location,
        router.basename
      );
      invariant(
        matches,
        `No routes match path "${navigation.location.pathname}"`
      );
      return matches;
    }

    return [];
  }, [navigation.location, router.routes, router.basename]);

  let routePreloads = matches
    .concat(nextMatches)
    .map((match) => {
      let route = manifest.routes[match.route.id];
      return (route.imports || []).concat([route.module]);
    })
    .flat(1);

  let preloads = isHydrated ? [] : manifest.entry.imports.concat(routePreloads);

  return isHydrated ? null : (
    <>
      <link
        rel="modulepreload"
        href={manifest.url}
        crossOrigin={props.crossOrigin}
      />
      <link
        rel="modulepreload"
        href={manifest.entry.module}
        crossOrigin={props.crossOrigin}
      />
      {dedupe(preloads).map((path) => (
        <link
          key={path}
          rel="modulepreload"
          href={path}
          crossOrigin={props.crossOrigin}
        />
      ))}
      {initialScripts}
      {deferredScripts}
    </>
  );
}

function DeferredHydrationScript({
  dataKey,
  deferredData,
  routeId,
  scriptProps,
  serializeData,
  serializeError,
}: {
  dataKey?: string;
  deferredData?: DeferredData;
  routeId?: string;
  scriptProps?: ScriptProps;
  serializeData: (routeId: string, key: string, data: unknown) => string;
  serializeError: (routeId: string, key: string, error: unknown) => string;
}) {
  if (typeof document === "undefined" && deferredData && dataKey && routeId) {
    invariant(
      deferredData.pendingKeys.includes(dataKey),
      `Deferred data for route ${routeId} with key ${dataKey} was not pending but tried to render a script for it.`
    );
  }

  return (
    <React.Suspense
      fallback={
        // This makes absolutely no sense. The server renders null as a fallback,
        // but when hydrating, we need to render a script tag to avoid a hydration issue.
        // To reproduce a hydration mismatch, just render null as a fallback.
        typeof document === "undefined" &&
        deferredData &&
        dataKey &&
        routeId ? null : (
          <script
            {...scriptProps}
            async
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: " " }}
          />
        )
      }
    >
      {typeof document === "undefined" && deferredData && dataKey && routeId ? (
        <Await
          resolve={deferredData.data[dataKey]}
          errorElement={
            <ErrorDeferredHydrationScript
              dataKey={dataKey}
              routeId={routeId}
              scriptProps={scriptProps}
              serializeError={serializeError}
            />
          }
          children={(data) => {
            return (
              <script
                {...scriptProps}
                async
                suppressHydrationWarning
                dangerouslySetInnerHTML={{
                  __html: serializeData(routeId, dataKey, data),
                }}
              />
            );
          }}
        />
      ) : (
        <script
          {...scriptProps}
          async
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: " " }}
        />
      )}
    </React.Suspense>
  );
}

function ErrorDeferredHydrationScript({
  dataKey,
  routeId,
  scriptProps,
  serializeError,
}: {
  dataKey: string;
  routeId: string;
  scriptProps?: ScriptProps;
  serializeError: (routeId: string, key: string, error: unknown) => string;
}) {
  let error = useAsyncError() as Error;

  return (
    <script
      {...scriptProps}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: serializeError(routeId, dataKey, error),
      }}
    />
  );
}

function dedupe(array: any[]) {
  return [...new Set(array)];
}

export type UIMatch<D = AppData, H = RouteHandle> = UIMatchRR<
  SerializeFrom<D>,
  H
>;

/**
 * Returns the active route matches, useful for accessing loaderData for
 * parent/child routes or the route "handle" property
 *
 * @see https://remix.run/hooks/use-matches
 */
export function useMatches(): UIMatch[] {
  return useMatchesRR() as UIMatch[];
}

/**
 * Returns the JSON parsed data from the current route's `loader`.
 *
 * @see https://remix.run/hooks/use-loader-data
 */
export function useLoaderData<T = AppData>(): SerializeFrom<T> {
  return useLoaderDataRR() as SerializeFrom<T>;
}

/**
 * Returns the loaderData for the given routeId.
 *
 * @see https://remix.run/hooks/use-route-loader-data
 */
export function useRouteLoaderData<T = AppData>(
  routeId: string
): SerializeFrom<T> | undefined {
  return useRouteLoaderDataRR(routeId) as SerializeFrom<T> | undefined;
}

/**
 * Returns the JSON parsed data from the current route's `action`.
 *
 * @see https://remix.run/hooks/use-action-data
 */
export function useActionData<T = AppData>(): SerializeFrom<T> | undefined {
  return useActionDataRR() as SerializeFrom<T> | undefined;
}

/**
 * Interacts with route loaders and actions without causing a navigation. Great
 * for any interaction that stays on the same page.
 *
 * @see https://remix.run/hooks/use-fetcher
 */
export function useFetcher<TData = AppData>(
  opts: Parameters<typeof useFetcherRR>[0] = {}
): FetcherWithComponents<SerializeFrom<TData>> {
  return useFetcherRR(opts);
}

export function mergeRefs<T = any>(
  ...refs: Array<React.MutableRefObject<T> | React.LegacyRef<T>>
): React.RefCallback<T> {
  return (value) => {
    refs.forEach((ref) => {
      if (typeof ref === "function") {
        ref(value);
      } else if (ref != null) {
        (ref as React.MutableRefObject<T | null>).current = value;
      }
    });
  };
}
