import type {
  FocusEventHandler,
  MouseEventHandler,
  TouchEventHandler,
} from "react";
import * as React from "react";

import type { RouterState } from "../../router/router";
import type { AgnosticDataRouteMatch } from "../../router/utils";
import { matchRoutes } from "../../router/utils";

import type { FrameworkContextObject } from "./entry";
import invariant from "./invariant";
import {
  getKeyedLinksForMatches,
  getKeyedPrefetchLinks,
  getModuleLinkHrefs,
  getNewMatchesForLinks,
  isPageLinkDescriptor,
} from "./links";
import type { KeyedHtmlLinkDescriptor, PrefetchPageDescriptor } from "./links";
import { createHtml } from "./markup";
import type {
  MetaFunction,
  MetaDescriptor,
  MetaMatch,
  MetaMatches,
} from "./routeModules";
import { addRevalidationParam, singleFetchUrl } from "./single-fetch";
import { DataRouterContext, DataRouterStateContext } from "../../context";
import { useLocation } from "../../hooks";
import { getPartialManifest, isFogOfWarEnabled } from "./fog-of-war";

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
// FrameworkContext

export const FrameworkContext = React.createContext<
  FrameworkContextObject | undefined
>(undefined);
FrameworkContext.displayName = "FrameworkContext";

export function useFrameworkContext(): FrameworkContextObject {
  let context = React.useContext(FrameworkContext);
  invariant(
    context,
    "You must render this element inside a <HydratedRouter> element"
  );
  return context;
}

////////////////////////////////////////////////////////////////////////////////
// Public API

/**
 * Defines the discovery behavior of the link:
 *
 * - "render" - default, discover the route when the link renders
 * - "none" - don't eagerly discover, only discover if the link is clicked
 */
export type DiscoverBehavior = "render" | "none";

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
  let frameworkContext = React.useContext(FrameworkContext);
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

  // No prefetching if not using SSR
  if (!frameworkContext) {
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
  Renders all of the `<link>` tags created by route module {@link LinksFunction} export. You should render it inside the `<head>` of your document.

  ```tsx
  import { Links } from "react-router";

  export default function Root() {
    return (
      <html>
        <head>
          <Links />
        </head>
        <body></body>
      </html>
    );
  }
  ```

  @category Components
 */
export function Links() {
  let { isSpaMode, manifest, routeModules, criticalCss } =
    useFrameworkContext();
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
  Renders `<link rel=prefetch|modulepreload>` tags for modules and data of another page to enable an instant navigation to that page. {@link LinkProps.prefetch | `<Link prefetch>`} uses this internally, but you can render it to prefetch a page for any other reason.

  ```tsx
  import { PrefetchPageLinks } from "react-router"

  <PrefetchPageLinks page="/absolute/path" />
  ```

  For example, you may render one of this as the user types into a search field to prefetch search results before they click through to their selection.

  @category Components
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
  let { manifest, routeModules } = useFrameworkContext();

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
  let { manifest, routeModules } = useFrameworkContext();
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

  let moduleHrefs = React.useMemo(
    () => getModuleLinkHrefs(newMatchesForAssets, manifest),
    [newMatchesForAssets, manifest]
  );

  // needs to be a hook with async behavior because we need the modules, not
  // just the manifest like the other links in here.
  let keyedPrefetchLinks = useKeyedPrefetchLinks(newMatchesForAssets);

  let linksToRender: React.ReactNode | React.ReactNode[] | null = null;
  if (newMatchesForData.length > 0) {
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
  Renders all the `<meta>` tags created by route module {@link MetaFunction} exports. You should render it inside the `<head>` of your HTML.

  ```tsx
  import { Meta } from "react-router";

  export default function Root() {
    return (
      <html>
        <head>
          <Meta />
        </head>
      </html>
    );
  }
  ```

  @category Components
 */
export function Meta() {
  let { isSpaMode, routeModules } = useFrameworkContext();
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

/**
 * Tracks whether hydration is finished, so scripts can be skipped
 * during client-side updates.
 */
let isHydrated = false;

/**
  A couple common attributes:

  - `<Scripts crossOrigin>` for hosting your static assets on a different server than your app.
  - `<Scripts nonce>` to support a [content security policy for scripts](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src) with [nonce-sources](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/Sources#sources) for your `<script>` tags.

  You cannot pass through attributes such as `async`, `defer`, `src`, `type`, `noModule` because they are managed by React Router internally.

  @category Types
 */
export type ScriptsProps = Omit<
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
  Renders the client runtime of your app. It should be rendered inside the `<body>` of the document.

  ```tsx
  import { Scripts } from "react-router";

  export default function Root() {
    return (
      <html>
        <head />
        <body>
          <Scripts />
        </body>
      </html>
    );
  }
  ```

  If server rendering, you can omit `<Scripts/>` and the app will work as a traditional web app without JavaScript, relying solely on HTML and browser behaviors.

  @category Components
 */
export function Scripts(props: ScriptsProps) {
  let { manifest, serverHandoffString, isSpaMode, renderMeta } =
    useFrameworkContext();
  let { router, static: isStatic, staticContext } = useDataRouterContext();
  let { matches: routerMatches } = useDataRouterStateContext();
  let enableFogOfWar = isFogOfWarEnabled(isSpaMode);

  // Let <ServerRouter> know that we hydrated and we should render the single
  // fetch streaming scripts
  if (renderMeta) {
    renderMeta.didRenderScripts = true;
  }

  let matches = getActiveMatches(routerMatches, null, isSpaMode);

  React.useEffect(() => {
    isHydrated = true;
  }, []);

  let initialScripts = React.useMemo(() => {
    let streamScript =
      "window.__remixContext.stream = new ReadableStream({" +
      "start(controller){" +
      "window.__remixContext.streamController = controller;" +
      "}" +
      "}).pipeThrough(new TextEncoderStream());";

    let contextScript = staticContext
      ? `window.__remixContext = ${serverHandoffString};${streamScript}`
      : " ";

    let routeModulesScript = !isStatic
      ? " "
      : `${
          manifest.hmr?.runtime
            ? `import ${JSON.stringify(manifest.hmr.runtime)};`
            : ""
        }${!enableFogOfWar ? `import ${JSON.stringify(manifest.url)}` : ""};
${matches
  .map(
    (match, index) =>
      `import * as route${index} from ${JSON.stringify(
        manifest.routes[match.route.id].module
      )};`
  )
  .join("\n")}
  ${
    enableFogOfWar
      ? // Inline a minimal manifest with the SSR matches
        `window.__remixManifest = ${JSON.stringify(
          getPartialManifest(manifest, router),
          null,
          2
        )};`
      : ""
  }
  window.__remixRouteModules = {${matches
    .map((match, index) => `${JSON.stringify(match.route.id)}:route${index}`)
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

  let routePreloads = matches
    .map((match) => {
      let route = manifest.routes[match.route.id];
      return (route.imports || []).concat([route.module]);
    })
    .flat(1);

  let preloads = isHydrated ? [] : manifest.entry.imports.concat(routePreloads);

  return isHydrated ? null : (
    <>
      {!enableFogOfWar ? (
        <link
          rel="modulepreload"
          href={manifest.url}
          crossOrigin={props.crossOrigin}
        />
      ) : null}
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
    </>
  );
}

function dedupe(array: any[]) {
  return [...new Set(array)];
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
