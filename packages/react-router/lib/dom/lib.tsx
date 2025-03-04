import * as React from "react";

import type {
  BrowserHistory,
  HashHistory,
  History,
  Action as NavigationType,
  Location,
  To,
} from "../router/history";
import {
  createBrowserHistory,
  createHashHistory,
  createPath,
  invariant,
  warning,
} from "../router/history";
import type {
  BlockerFunction,
  Fetcher,
  FutureConfig,
  GetScrollRestorationKeyFunction,
  HydrationState,
  RelativeRoutingType,
  Router as DataRouter,
  RouterInit,
} from "../router/router";
import { IDLE_FETCHER, createRouter } from "../router/router";
import type {
  DataStrategyFunction,
  FormEncType,
  HTMLFormMethod,
  UIMatch,
} from "../router/utils";
import {
  ErrorResponseImpl,
  joinPaths,
  matchPath,
  stripBasename,
} from "../router/utils";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type * as _ from "./global";
import type {
  SubmitOptions,
  URLSearchParamsInit,
  SubmitTarget,
  FetcherSubmitOptions,
} from "./dom";
import {
  createSearchParams,
  defaultMethod,
  getFormSubmissionInfo,
  getSearchParamsForLocation,
  shouldProcessLinkClick,
} from "./dom";

import type {
  DiscoverBehavior,
  PrefetchBehavior,
  ScriptsProps,
} from "./ssr/components";
import {
  PrefetchPageLinks,
  FrameworkContext,
  mergeRefs,
  usePrefetchBehavior,
} from "./ssr/components";
import { Router, mapRouteProperties } from "../components";
import type {
  RouteObject,
  NavigateOptions,
  PatchRoutesOnNavigationFunction,
} from "../context";
import {
  DataRouterContext,
  DataRouterStateContext,
  FetchersContext,
  NavigationContext,
  RouteContext,
  ViewTransitionContext,
} from "../context";
import {
  useBlocker,
  useHref,
  useLocation,
  useMatches,
  useNavigate,
  useNavigation,
  useResolvedPath,
  useRouteId,
} from "../hooks";
import type { SerializeFrom } from "../types/route-data";

////////////////////////////////////////////////////////////////////////////////
//#region Global Stuff
////////////////////////////////////////////////////////////////////////////////

const isBrowser =
  typeof window !== "undefined" &&
  typeof window.document !== "undefined" &&
  typeof window.document.createElement !== "undefined";

// HEY YOU! DON'T TOUCH THIS VARIABLE!
//
// It is replaced with the proper version at build time via a babel plugin in
// the rollup config.
//
// Export a global property onto the window for React Router detection by the
// Core Web Vitals Technology Report.  This way they can configure the `wappalyzer`
// to detect and properly classify live websites as being built with React Router:
// https://github.com/HTTPArchive/wappalyzer/blob/main/src/technologies/r.json
declare global {
  const REACT_ROUTER_VERSION: string;
}
try {
  if (isBrowser) {
    window.__reactRouterVersion = REACT_ROUTER_VERSION;
  }
} catch (e) {
  // no-op
}
//#endregion

////////////////////////////////////////////////////////////////////////////////
//#region Routers
////////////////////////////////////////////////////////////////////////////////

/**
 * @category Routers
 */
export interface DOMRouterOpts {
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
   * Override the default data strategy of loading in parallel.
   * Only intended for advanced usage.
   */
  dataStrategy?: DataStrategyFunction;
  /**
   * Lazily define portions of the route tree on navigations.
   */
  patchRoutesOnNavigation?: PatchRoutesOnNavigationFunction;
  /**
   * Window object override - defaults to the global `window` instance.
   */
  window?: Window;
}

/**
 * Create a new data router that manages the application path via `history.pushState`
 * and `history.replaceState`.
 *
 * @category Data Routers
 */
export function createBrowserRouter(
  /**
   * Application routes
   */
  routes: RouteObject[],
  /**
   * Router options
   */
  opts?: DOMRouterOpts
): DataRouter {
  return createRouter({
    basename: opts?.basename,
    unstable_getContext: opts?.unstable_getContext,
    future: opts?.future,
    history: createBrowserHistory({ window: opts?.window }),
    hydrationData: opts?.hydrationData || parseHydrationData(),
    routes,
    mapRouteProperties,
    dataStrategy: opts?.dataStrategy,
    patchRoutesOnNavigation: opts?.patchRoutesOnNavigation,
    window: opts?.window,
  }).initialize();
}

/**
 * Create a new data router that manages the application path via the URL hash
 *
 * @category Data Routers
 */
export function createHashRouter(
  routes: RouteObject[],
  opts?: DOMRouterOpts
): DataRouter {
  return createRouter({
    basename: opts?.basename,
    unstable_getContext: opts?.unstable_getContext,
    future: opts?.future,
    history: createHashHistory({ window: opts?.window }),
    hydrationData: opts?.hydrationData || parseHydrationData(),
    routes,
    mapRouteProperties,
    dataStrategy: opts?.dataStrategy,
    patchRoutesOnNavigation: opts?.patchRoutesOnNavigation,
    window: opts?.window,
  }).initialize();
}

function parseHydrationData(): HydrationState | undefined {
  let state = window?.__staticRouterHydrationData;
  if (state && state.errors) {
    state = {
      ...state,
      errors: deserializeErrors(state.errors),
    };
  }
  return state;
}

function deserializeErrors(
  errors: DataRouter["state"]["errors"]
): DataRouter["state"]["errors"] {
  if (!errors) return null;
  let entries = Object.entries(errors);
  let serialized: DataRouter["state"]["errors"] = {};
  for (let [key, val] of entries) {
    // Hey you!  If you change this, please change the corresponding logic in
    // serializeErrors in react-router-dom/server.tsx :)
    if (val && val.__type === "RouteErrorResponse") {
      serialized[key] = new ErrorResponseImpl(
        val.status,
        val.statusText,
        val.data,
        val.internal === true
      );
    } else if (val && val.__type === "Error") {
      // Attempt to reconstruct the right type of Error (i.e., ReferenceError)
      if (val.__subType) {
        let ErrorConstructor = window[val.__subType];
        if (typeof ErrorConstructor === "function") {
          try {
            // @ts-expect-error
            let error = new ErrorConstructor(val.message);
            // Wipe away the client-side stack trace.  Nothing to fill it in with
            // because we don't serialize SSR stack traces for security reasons
            error.stack = "";
            serialized[key] = error;
          } catch (e) {
            // no-op - fall through and create a normal Error
          }
        }
      }

      if (serialized[key] == null) {
        let error = new Error(val.message);
        // Wipe away the client-side stack trace.  Nothing to fill it in with
        // because we don't serialize SSR stack traces for security reasons
        error.stack = "";
        serialized[key] = error;
      }
    } else {
      serialized[key] = val;
    }
  }
  return serialized;
}

//#endregion

////////////////////////////////////////////////////////////////////////////////
//#region Components
////////////////////////////////////////////////////////////////////////////////

/**
 * @category Types
 */
export interface BrowserRouterProps {
  basename?: string;
  children?: React.ReactNode;
  window?: Window;
}

/**
 * A `<Router>` for use in web browsers. Provides the cleanest URLs.
 *
 * @category Component Routers
 */
export function BrowserRouter({
  basename,
  children,
  window,
}: BrowserRouterProps) {
  let historyRef = React.useRef<BrowserHistory>();
  if (historyRef.current == null) {
    historyRef.current = createBrowserHistory({ window, v5Compat: true });
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
export interface HashRouterProps {
  basename?: string;
  children?: React.ReactNode;
  window?: Window;
}

/**
 * A `<Router>` for use in web browsers. Stores the location in the hash
 * portion of the URL so it is not sent to the server.
 *
 * @category Component Routers
 */
export function HashRouter({ basename, children, window }: HashRouterProps) {
  let historyRef = React.useRef<HashHistory>();
  if (historyRef.current == null) {
    historyRef.current = createHashHistory({ window, v5Compat: true });
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
export interface HistoryRouterProps {
  basename?: string;
  children?: React.ReactNode;
  history: History;
}

/**
 * A `<Router>` that accepts a pre-instantiated history object. It's important
 * to note that using your own history object is highly discouraged and may add
 * two versions of the history library to your bundles unless you use the same
 * version of the history library that React Router uses internally.
 *
 * @name unstable_HistoryRouter
 * @category Component Routers
 */
export function HistoryRouter({
  basename,
  children,
  history,
}: HistoryRouterProps) {
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
HistoryRouter.displayName = "unstable_HistoryRouter";

/**
 * @category Types
 */
export interface LinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  /**
    Defines the link discovery behavior

    ```tsx
    <Link /> // default ("render")
    <Link discover="render" />
    <Link discover="none" />
    ```

    - **render** - default, discover the route when the link renders
    - **none** - don't eagerly discover, only discover if the link is clicked
  */
  discover?: DiscoverBehavior;

  /**
    Defines the data and module prefetching behavior for the link.

    ```tsx
    <Link /> // default
    <Link prefetch="none" />
    <Link prefetch="intent" />
    <Link prefetch="render" />
    <Link prefetch="viewport" />
    ```

    - **none** - default, no prefetching
    - **intent** - prefetches when the user hovers or focuses the link
    - **render** - prefetches when the link renders
    - **viewport** - prefetches when the link is in the viewport, very useful for mobile

    Prefetching is done with HTML `<link rel="prefetch">` tags. They are inserted after the link.

    ```tsx
    <a href="..." />
    <a href="..." />
    <link rel="prefetch" /> // might conditionally render
    ```

    Because of this, if you are using `nav :last-child` you will need to use `nav :last-of-type` so the styles don't conditionally fall off your last link (and any other similar selectors).
   */
  prefetch?: PrefetchBehavior;

  /**
    Will use document navigation instead of client side routing when the link is clicked: the browser will handle the transition normally (as if it were an `<a href>`).

    ```tsx
    <Link to="/logout" reloadDocument />
    ```
   */
  reloadDocument?: boolean;

  /**
    Replaces the current entry in the history stack instead of pushing a new one onto it.

    ```tsx
    <Link replace />
    ```

    ```
    # with a history stack like this
    A -> B

    # normal link click pushes a new entry
    A -> B -> C

    # but with `replace`, B is replaced by C
    A -> C
    ```
   */
  replace?: boolean;

  /**
    Adds persistent client side routing state to the next location.

    ```tsx
    <Link to="/somewhere/else" state={{ some: "value" }} />
    ```

    The location state is accessed from the `location`.

    ```tsx
    function SomeComp() {
      const location = useLocation()
      location.state; // { some: "value" }
    }
    ```

    This state is inaccessible on the server as it is implemented on top of [`history.state`](https://developer.mozilla.org/en-US/docs/Web/API/History/state)
   */
  state?: any;

  /**
    Prevents the scroll position from being reset to the top of the window when the link is clicked and the app is using {@link ScrollRestoration}. This only prevents new locations reseting scroll to the top, scroll position will be restored for back/forward button navigation.

    ```tsx
    <Link to="?tab=one" preventScrollReset />
    ```
   */
  preventScrollReset?: boolean;

  /**
    Defines the relative path behavior for the link.

    ```tsx
    <Link to=".." /> // default: "route"
    <Link relative="route" />
    <Link relative="path" />
    ```

    Consider a route hierarchy where a parent route pattern is "blog" and a child route pattern is "blog/:slug/edit".

    - **route** - default, resolves the link relative to the route pattern. In the example above a relative link of `".."` will remove both `:slug/edit` segments back to "/blog".
    - **path** - relative to the path so `..` will only remove one URL segment up to "/blog/:slug"
   */
  relative?: RelativeRoutingType;

  /**
    Can be a string or a partial {@link Path}:

    ```tsx
    <Link to="/some/path" />

    <Link
      to={{
        pathname: "/some/path",
        search: "?query=string",
        hash: "#hash",
      }}
    />
    ```
   */
  to: To;

  /**
    Enables a [View Transition](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API) for this navigation.

    ```jsx
    <Link to={to} viewTransition>
      Click me
    </Link>
    ```

    To apply specific styles for the transition, see {@link useViewTransitionState}
   */
  viewTransition?: boolean;
}

const ABSOLUTE_URL_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
  A progressively enhanced `<a href>` wrapper to enable navigation with client-side routing.

  ```tsx
  import { Link } from "react-router";

  <Link to="/dashboard">Dashboard</Link>;

  <Link
    to={{
      pathname: "/some/path",
      search: "?query=string",
      hash: "#hash",
    }}
  />
  ```

  @category Components
 */
export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  function LinkWithRef(
    {
      onClick,
      discover = "render",
      prefetch = "none",
      relative,
      reloadDocument,
      replace,
      state,
      target,
      to,
      preventScrollReset,
      viewTransition,
      ...rest
    },
    forwardedRef
  ) {
    let { basename } = React.useContext(NavigationContext);
    let isAbsolute = typeof to === "string" && ABSOLUTE_URL_REGEX.test(to);

    // Rendered into <a href> for absolute URLs
    let absoluteHref;
    let isExternal = false;

    if (typeof to === "string" && isAbsolute) {
      // Render the absolute href server- and client-side
      absoluteHref = to;

      // Only check for external origins client-side
      if (isBrowser) {
        try {
          let currentUrl = new URL(window.location.href);
          let targetUrl = to.startsWith("//")
            ? new URL(currentUrl.protocol + to)
            : new URL(to);
          let path = stripBasename(targetUrl.pathname, basename);

          if (targetUrl.origin === currentUrl.origin && path != null) {
            // Strip the protocol/origin/basename for same-origin absolute URLs
            to = path + targetUrl.search + targetUrl.hash;
          } else {
            isExternal = true;
          }
        } catch (e) {
          // We can't do external URL detection without a valid URL
          warning(
            false,
            `<Link to="${to}"> contains an invalid URL which will probably break ` +
              `when clicked - please update to a valid URL path.`
          );
        }
      }
    }

    // Rendered into <a href> for relative URLs
    let href = useHref(to, { relative });
    let [shouldPrefetch, prefetchRef, prefetchHandlers] = usePrefetchBehavior(
      prefetch,
      rest
    );

    let internalOnClick = useLinkClickHandler(to, {
      replace,
      state,
      target,
      preventScrollReset,
      relative,
      viewTransition,
    });
    function handleClick(
      event: React.MouseEvent<HTMLAnchorElement, MouseEvent>
    ) {
      if (onClick) onClick(event);
      if (!event.defaultPrevented) {
        internalOnClick(event);
      }
    }

    let link = (
      // eslint-disable-next-line jsx-a11y/anchor-has-content
      <a
        {...rest}
        {...prefetchHandlers}
        href={absoluteHref || href}
        onClick={isExternal || reloadDocument ? onClick : handleClick}
        ref={mergeRefs(forwardedRef, prefetchRef)}
        target={target}
        data-discover={
          !isAbsolute && discover === "render" ? "true" : undefined
        }
      />
    );

    return shouldPrefetch && !isAbsolute ? (
      <>
        {link}
        <PrefetchPageLinks page={href} />
      </>
    ) : (
      link
    );
  }
);
Link.displayName = "Link";

/**
  The object passed to {@link NavLink} `children`, `className`, and `style` prop callbacks to render and style the link based on its state.

  ```
  // className
  <NavLink
    to="/messages"
    className={({ isActive, isPending }) =>
      isPending ? "pending" : isActive ? "active" : ""
    }
  >
    Messages
  </NavLink>

  // style
  <NavLink
    to="/messages"
    style={({ isActive, isPending }) => {
      return {
        fontWeight: isActive ? "bold" : "",
        color: isPending ? "red" : "black",
      }
    )}
  />

  // children
  <NavLink to="/tasks">
    {({ isActive, isPending }) => (
      <span className={isActive ? "active" : ""}>Tasks</span>
    )}
  </NavLink>
  ```

 */
export type NavLinkRenderProps = {
  /**
   * Indicates if the link's URL matches the current location.
   */
  isActive: boolean;

  /**
   * Indicates if the pending location matches the link's URL.
   */
  isPending: boolean;

  /**
   * Indicates if a view transition to the link's URL is in progress. See {@link useViewTransitionState}
   */
  isTransitioning: boolean;
};

/**
 * @category Types
 */
export interface NavLinkProps
  extends Omit<LinkProps, "className" | "style" | "children"> {
  /**
    Can be regular React children or a function that receives an object with the active and pending states of the link.

    ```tsx
    <NavLink to="/tasks">
      {({ isActive }) => (
        <span className={isActive ? "active" : ""}>Tasks</span>
      )}
    </NavLink>
    ```
   */
  children?: React.ReactNode | ((props: NavLinkRenderProps) => React.ReactNode);

  /**
    Changes the matching logic to make it case-sensitive:

    | Link                                         | URL           | isActive |
    | -------------------------------------------- | ------------- | -------- |
    | `<NavLink to="/SpOnGe-bOB" />`               | `/sponge-bob` | true     |
    | `<NavLink to="/SpOnGe-bOB" caseSensitive />` | `/sponge-bob` | false    |
   */
  caseSensitive?: boolean;

  /**
    Classes are automatically applied to NavLink that correspond to {@link NavLinkRenderProps}.

    ```css
    a.active { color: red; }
    a.pending { color: blue; }
    a.transitioning {
      view-transition-name: my-transition;
    }
    ```
   */
  className?: string | ((props: NavLinkRenderProps) => string | undefined);

  /**
    Changes the matching logic for the `active` and `pending` states to only match to the "end" of the {@link NavLinkProps.to}. If the URL is longer, it will no longer be considered active.

    | Link                          | URL          | isActive |
    | ----------------------------- | ------------ | -------- |
    | `<NavLink to="/tasks" />`     | `/tasks`     | true     |
    | `<NavLink to="/tasks" />`     | `/tasks/123` | true     |
    | `<NavLink to="/tasks" end />` | `/tasks`     | true     |
    | `<NavLink to="/tasks" end />` | `/tasks/123` | false    |

    `<NavLink to="/">` is an exceptional case because _every_ URL matches `/`. To avoid this matching every single route by default, it effectively ignores the `end` prop and only matches when you're at the root route.
   */
  end?: boolean;

  style?:
    | React.CSSProperties
    | ((props: NavLinkRenderProps) => React.CSSProperties | undefined);
}

/**
  Wraps {@link Link | `<Link>`} with additional props for styling active and pending states.

  - Automatically applies classes to the link based on its active and pending states, see {@link NavLinkProps.className}.
  - Automatically applies `aria-current="page"` to the link when the link is active. See [`aria-current`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-current) on MDN.

  ```tsx
  import { NavLink } from "react-router"
  <NavLink to="/message" />
  ```

  States are available through the className, style, and children render props. See {@link NavLinkRenderProps}.

  ```tsx
  <NavLink
    to="/messages"
    className={({ isActive, isPending }) =>
      isPending ? "pending" : isActive ? "active" : ""
    }
  >
    Messages
  </NavLink>
  ```

  @category Components
 */
export const NavLink = React.forwardRef<HTMLAnchorElement, NavLinkProps>(
  function NavLinkWithRef(
    {
      "aria-current": ariaCurrentProp = "page",
      caseSensitive = false,
      className: classNameProp = "",
      end = false,
      style: styleProp,
      to,
      viewTransition,
      children,
      ...rest
    },
    ref
  ) {
    let path = useResolvedPath(to, { relative: rest.relative });
    let location = useLocation();
    let routerState = React.useContext(DataRouterStateContext);
    let { navigator, basename } = React.useContext(NavigationContext);
    let isTransitioning =
      routerState != null &&
      // Conditional usage is OK here because the usage of a data router is static
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useViewTransitionState(path) &&
      viewTransition === true;

    let toPathname = navigator.encodeLocation
      ? navigator.encodeLocation(path).pathname
      : path.pathname;
    let locationPathname = location.pathname;
    let nextLocationPathname =
      routerState && routerState.navigation && routerState.navigation.location
        ? routerState.navigation.location.pathname
        : null;

    if (!caseSensitive) {
      locationPathname = locationPathname.toLowerCase();
      nextLocationPathname = nextLocationPathname
        ? nextLocationPathname.toLowerCase()
        : null;
      toPathname = toPathname.toLowerCase();
    }

    if (nextLocationPathname && basename) {
      nextLocationPathname =
        stripBasename(nextLocationPathname, basename) || nextLocationPathname;
    }

    // If the `to` has a trailing slash, look at that exact spot.  Otherwise,
    // we're looking for a slash _after_ what's in `to`.  For example:
    //
    // <NavLink to="/users"> and <NavLink to="/users/">
    // both want to look for a / at index 6 to match URL `/users/matt`
    const endSlashPosition =
      toPathname !== "/" && toPathname.endsWith("/")
        ? toPathname.length - 1
        : toPathname.length;
    let isActive =
      locationPathname === toPathname ||
      (!end &&
        locationPathname.startsWith(toPathname) &&
        locationPathname.charAt(endSlashPosition) === "/");

    let isPending =
      nextLocationPathname != null &&
      (nextLocationPathname === toPathname ||
        (!end &&
          nextLocationPathname.startsWith(toPathname) &&
          nextLocationPathname.charAt(toPathname.length) === "/"));

    let renderProps = {
      isActive,
      isPending,
      isTransitioning,
    };

    let ariaCurrent = isActive ? ariaCurrentProp : undefined;

    let className: string | undefined;
    if (typeof classNameProp === "function") {
      className = classNameProp(renderProps);
    } else {
      // If the className prop is not a function, we use a default `active`
      // class for <NavLink />s that are active. In v5 `active` was the default
      // value for `activeClassName`, but we are removing that API and can still
      // use the old default behavior for a cleaner upgrade path and keep the
      // simple styling rules working as they currently do.
      className = [
        classNameProp,
        isActive ? "active" : null,
        isPending ? "pending" : null,
        isTransitioning ? "transitioning" : null,
      ]
        .filter(Boolean)
        .join(" ");
    }

    let style =
      typeof styleProp === "function" ? styleProp(renderProps) : styleProp;

    return (
      <Link
        {...rest}
        aria-current={ariaCurrent}
        className={className}
        ref={ref}
        style={style}
        to={to}
        viewTransition={viewTransition}
      >
        {typeof children === "function" ? children(renderProps) : children}
      </Link>
    );
  }
);
NavLink.displayName = "NavLink";

/**
 * Form props shared by navigations and fetchers
 */
interface SharedFormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  /**
   * The HTTP verb to use when the form is submitted. Supports "get", "post",
   * "put", "delete", and "patch".
   *
   * Native `<form>` only supports `get` and `post`, avoid the other verbs if
   * you'd like to support progressive enhancement
   */
  method?: HTMLFormMethod;

  /**
   * The encoding type to use for the form submission.
   */
  encType?:
    | "application/x-www-form-urlencoded"
    | "multipart/form-data"
    | "text/plain";

  /**
   * The URL to submit the form data to.  If `undefined`, this defaults to the closest route in context.
   */
  action?: string;

  /**
   * Determines whether the form action is relative to the route hierarchy or
   * the pathname.  Use this if you want to opt out of navigating the route
   * hierarchy and want to instead route based on /-delimited URL segments
   */
  relative?: RelativeRoutingType;

  /**
   * Prevent the scroll position from resetting to the top of the viewport on
   * completion of the navigation when using the <ScrollRestoration> component
   */
  preventScrollReset?: boolean;

  /**
   * A function to call when the form is submitted. If you call
   * `event.preventDefault()` then this form will not do anything.
   */
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
}

/**
 * Form props available to fetchers
 * @category Types
 */
export interface FetcherFormProps extends SharedFormProps {}

/**
 * Form props available to navigations
 * @category Types
 */
export interface FormProps extends SharedFormProps {
  discover?: DiscoverBehavior;

  /**
   * Indicates a specific fetcherKey to use when using `navigate={false}` so you
   * can pick up the fetcher's state in a different component in a {@link
   * useFetcher}.
   */
  fetcherKey?: string;

  /**
   * Skips the navigation and uses a {@link useFetcher | fetcher} internally
   * when `false`. This is essentially a shorthand for `useFetcher()` +
   * `<fetcher.Form>` where you don't care about the resulting data in this
   * component.
   */
  navigate?: boolean;

  /**
   * Forces a full document navigation instead of client side routing + data
   * fetch.
   */
  reloadDocument?: boolean;

  /**
   * Replaces the current entry in the browser history stack when the form
   * navigates. Use this if you don't want the user to be able to click "back"
   * to the page with the form on it.
   */
  replace?: boolean;

  /**
   * State object to add to the history stack entry for this navigation
   */
  state?: any;

  /**
   * Enables a [View
   * Transition](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API)
   * for this navigation. To apply specific styles during the transition see
   * {@link useViewTransitionState}.
   */
  viewTransition?: boolean;
}

type HTMLSubmitEvent = React.BaseSyntheticEvent<
  SubmitEvent,
  Event,
  HTMLFormElement
>;

type HTMLFormSubmitter = HTMLButtonElement | HTMLInputElement;

/**

A progressively enhanced HTML [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form) that submits data to actions via `fetch`, activating pending states in `useNavigation` which enables advanced user interfaces beyond a basic HTML form. After a form's action completes, all data on the page is automatically revalidated to keep the UI in sync with the data.

Because it uses the HTML form API, server rendered pages are interactive at a basic level before JavaScript loads. Instead of React Router managing the submission, the browser manages the submission as well as the pending states (like the spinning favicon). After JavaScript loads, React Router takes over enabling web application user experiences.

Form is most useful for submissions that should also change the URL or otherwise add an entry to the browser history stack. For forms that shouldn't manipulate the browser history stack, use [`<fetcher.Form>`][fetcher_form].

```tsx
import { Form } from "react-router";

function NewEvent() {
  return (
    <Form action="/events" method="post">
      <input name="title" type="text" />
      <input name="description" type="text" />
    </Form>
  )
}
```

@category Components
*/
export const Form = React.forwardRef<HTMLFormElement, FormProps>(
  (
    {
      discover = "render",
      fetcherKey,
      navigate,
      reloadDocument,
      replace,
      state,
      method = defaultMethod,
      action,
      onSubmit,
      relative,
      preventScrollReset,
      viewTransition,
      ...props
    },
    forwardedRef
  ) => {
    let submit = useSubmit();
    let formAction = useFormAction(action, { relative });
    let formMethod: HTMLFormMethod =
      method.toLowerCase() === "get" ? "get" : "post";
    let isAbsolute =
      typeof action === "string" && ABSOLUTE_URL_REGEX.test(action);

    let submitHandler: React.FormEventHandler<HTMLFormElement> = (event) => {
      onSubmit && onSubmit(event);
      if (event.defaultPrevented) return;
      event.preventDefault();

      let submitter = (event as unknown as HTMLSubmitEvent).nativeEvent
        .submitter as HTMLFormSubmitter | null;

      let submitMethod =
        (submitter?.getAttribute("formmethod") as HTMLFormMethod | undefined) ||
        method;

      submit(submitter || event.currentTarget, {
        fetcherKey,
        method: submitMethod,
        navigate,
        replace,
        state,
        relative,
        preventScrollReset,
        viewTransition,
      });
    };

    return (
      <form
        ref={forwardedRef}
        method={formMethod}
        action={formAction}
        onSubmit={reloadDocument ? onSubmit : submitHandler}
        {...props}
        data-discover={
          !isAbsolute && discover === "render" ? "true" : undefined
        }
      />
    );
  }
);
Form.displayName = "Form";

export type ScrollRestorationProps = ScriptsProps & {
  /**
    Defines the key used to restore scroll positions.

    ```tsx
    <ScrollRestoration
      getKey={(location, matches) => {
        // default behavior
        return location.key
      }}
    />
    ```
   */
  getKey?: GetScrollRestorationKeyFunction;

  storageKey?: string;
};

/**
  Emulates the browser's scroll restoration on location changes. Apps should only render one of these, right before the {@link Scripts} component.

  ```tsx
  import { ScrollRestoration } from "react-router";

  export default function Root() {
    return (
      <html>
        <body>
          <ScrollRestoration />
          <Scripts />
        </body>
      </html>
    );
  }
  ```

  This component renders an inline `<script>` to prevent scroll flashing. The `nonce` prop will be passed down to the script tag to allow CSP nonce usage.

  ```tsx
  <ScrollRestoration nonce={cspNonce} />
  ```

  @category Components
 */
export function ScrollRestoration({
  getKey,
  storageKey,
  ...props
}: ScrollRestorationProps) {
  let remixContext = React.useContext(FrameworkContext);
  let { basename } = React.useContext(NavigationContext);
  let location = useLocation();
  let matches = useMatches();
  useScrollRestoration({ getKey, storageKey });

  // In order to support `getKey`, we need to compute a "key" here so we can
  // hydrate that up so that SSR scroll restoration isn't waiting on React to
  // hydrate. *However*, our key on the server is not the same as our key on
  // the client!  So if the user's getKey implementation returns the SSR
  // location key, then let's ignore it and let our inline <script> below pick
  // up the client side history state key
  let ssrKey = React.useMemo(
    () => {
      if (!remixContext || !getKey) return null;
      let userKey = getScrollRestorationKey(
        location,
        matches,
        basename,
        getKey
      );
      return userKey !== location.key ? userKey : null;
    },
    // Nah, we only need this the first time for the SSR render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // In SPA Mode, there's nothing to restore on initial render since we didn't
  // render anything on the server
  if (!remixContext || remixContext.isSpaMode) {
    return null;
  }

  let restoreScroll = ((storageKey: string, restoreKey: string) => {
    if (!window.history.state || !window.history.state.key) {
      let key = Math.random().toString(32).slice(2);
      window.history.replaceState({ key }, "");
    }
    try {
      let positions = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
      let storedY = positions[restoreKey || window.history.state.key];
      if (typeof storedY === "number") {
        window.scrollTo(0, storedY);
      }
    } catch (error: unknown) {
      console.error(error);
      sessionStorage.removeItem(storageKey);
    }
  }).toString();

  return (
    <script
      {...props}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: `(${restoreScroll})(${JSON.stringify(
          storageKey || SCROLL_RESTORATION_STORAGE_KEY
        )}, ${JSON.stringify(ssrKey)})`,
      }}
    />
  );
}
ScrollRestoration.displayName = "ScrollRestoration";
//#endregion

////////////////////////////////////////////////////////////////////////////////
//#region Hooks
////////////////////////////////////////////////////////////////////////////////

enum DataRouterHook {
  UseScrollRestoration = "useScrollRestoration",
  UseSubmit = "useSubmit",
  UseSubmitFetcher = "useSubmitFetcher",
  UseFetcher = "useFetcher",
  useViewTransitionState = "useViewTransitionState",
}

enum DataRouterStateHook {
  UseFetcher = "useFetcher",
  UseFetchers = "useFetchers",
  UseScrollRestoration = "useScrollRestoration",
}

// Internal hooks

function getDataRouterConsoleError(
  hookName: DataRouterHook | DataRouterStateHook
) {
  return `${hookName} must be used within a data router.  See https://reactrouter.com/en/main/routers/picking-a-router.`;
}

function useDataRouterContext(hookName: DataRouterHook) {
  let ctx = React.useContext(DataRouterContext);
  invariant(ctx, getDataRouterConsoleError(hookName));
  return ctx;
}

function useDataRouterState(hookName: DataRouterStateHook) {
  let state = React.useContext(DataRouterStateContext);
  invariant(state, getDataRouterConsoleError(hookName));
  return state;
}

// External hooks

/**
 * Handles the click behavior for router `<Link>` components. This is useful if
 * you need to create custom `<Link>` components with the same click behavior we
 * use in our exported `<Link>`.
 *
 * @category Hooks
 */
export function useLinkClickHandler<E extends Element = HTMLAnchorElement>(
  to: To,
  {
    target,
    replace: replaceProp,
    state,
    preventScrollReset,
    relative,
    viewTransition,
  }: {
    target?: React.HTMLAttributeAnchorTarget;
    replace?: boolean;
    state?: any;
    preventScrollReset?: boolean;
    relative?: RelativeRoutingType;
    viewTransition?: boolean;
  } = {}
): (event: React.MouseEvent<E, MouseEvent>) => void {
  let navigate = useNavigate();
  let location = useLocation();
  let path = useResolvedPath(to, { relative });

  return React.useCallback(
    (event: React.MouseEvent<E, MouseEvent>) => {
      if (shouldProcessLinkClick(event, target)) {
        event.preventDefault();

        // If the URL hasn't changed, a regular <a> will do a replace instead of
        // a push, so do the same here unless the replace prop is explicitly set
        let replace =
          replaceProp !== undefined
            ? replaceProp
            : createPath(location) === createPath(path);

        navigate(to, {
          replace,
          state,
          preventScrollReset,
          relative,
          viewTransition,
        });
      }
    },
    [
      location,
      navigate,
      path,
      replaceProp,
      state,
      target,
      to,
      preventScrollReset,
      relative,
      viewTransition,
    ]
  );
}

/**
  Returns a tuple of the current URL's {@link URLSearchParams} and a function to update them. Setting the search params causes a navigation.

  ```tsx
  import { useSearchParams } from "react-router";

  export function SomeComponent() {
    const [searchParams, setSearchParams] = useSearchParams();
    // ...
  }
  ```

 @category Hooks
 */
export function useSearchParams(
  defaultInit?: URLSearchParamsInit
): [URLSearchParams, SetURLSearchParams] {
  warning(
    typeof URLSearchParams !== "undefined",
    `You cannot use the \`useSearchParams\` hook in a browser that does not ` +
      `support the URLSearchParams API. If you need to support Internet ` +
      `Explorer 11, we recommend you load a polyfill such as ` +
      `https://github.com/ungap/url-search-params.`
  );

  let defaultSearchParamsRef = React.useRef(createSearchParams(defaultInit));
  let hasSetSearchParamsRef = React.useRef(false);

  let location = useLocation();
  let searchParams = React.useMemo(
    () =>
      // Only merge in the defaults if we haven't yet called setSearchParams.
      // Once we call that we want those to take precedence, otherwise you can't
      // remove a param with setSearchParams({}) if it has an initial value
      getSearchParamsForLocation(
        location.search,
        hasSetSearchParamsRef.current ? null : defaultSearchParamsRef.current
      ),
    [location.search]
  );

  let navigate = useNavigate();
  let setSearchParams = React.useCallback<SetURLSearchParams>(
    (nextInit, navigateOptions) => {
      const newSearchParams = createSearchParams(
        typeof nextInit === "function"
          ? nextInit(new URLSearchParams(searchParams))
          : nextInit
      );
      hasSetSearchParamsRef.current = true;
      navigate("?" + newSearchParams, navigateOptions);
    },
    [navigate, searchParams]
  );

  return [searchParams, setSearchParams];
}

/**
  Sets new search params and causes a navigation when called.

  ```tsx
  <button
    onClick={() => {
      const params = new URLSearchParams();
      params.set("someKey", "someValue");
      setSearchParams(params, {
        preventScrollReset: true,
      });
    }}
  />
  ```

  It also supports a function for setting new search params.

  ```tsx
  <button
    onClick={() => {
      setSearchParams((prev) => {
        prev.set("someKey", "someValue");
        return prev;
      });
    }}
  />
  ```
 */
export type SetURLSearchParams = (
  nextInit?:
    | URLSearchParamsInit
    | ((prev: URLSearchParams) => URLSearchParamsInit),
  navigateOpts?: NavigateOptions
) => void;

/**
 * Submits a HTML `<form>` to the server without reloading the page.
 */
export interface SubmitFunction {
  (
    /**
      Can be multiple types of elements and objects

      **`HTMLFormElement`**

      ```tsx
      <Form
        onSubmit={(event) => {
          submit(event.currentTarget);
        }}
      />
      ```

      **`FormData`**

      ```tsx
      const formData = new FormData();
      formData.append("myKey", "myValue");
      submit(formData, { method: "post" });
      ```

      **Plain object that will be serialized as `FormData`**

      ```tsx
      submit({ myKey: "myValue" }, { method: "post" });
      ```

      **Plain object that will be serialized as JSON**

      ```tsx
      submit(
        { myKey: "myValue" },
        { method: "post", encType: "application/json" }
      );
      ```
     */
    target: SubmitTarget,

    /**
     * Options that override the `<form>`'s own attributes. Required when
     * submitting arbitrary data without a backing `<form>`.
     */
    options?: SubmitOptions
  ): Promise<void>;
}

/**
 * Submits a fetcher `<form>` to the server without reloading the page.
 */
export interface FetcherSubmitFunction {
  (
    /**
      Can be multiple types of elements and objects

      **`HTMLFormElement`**

      ```tsx
      <fetcher.Form
        onSubmit={(event) => {
          fetcher.submit(event.currentTarget);
        }}
      />
      ```

      **`FormData`**

      ```tsx
      const formData = new FormData();
      formData.append("myKey", "myValue");
      fetcher.submit(formData, { method: "post" });
      ```

      **Plain object that will be serialized as `FormData`**

      ```tsx
      fetcher.submit({ myKey: "myValue" }, { method: "post" });
      ```

      **Plain object that will be serialized as JSON**

      ```tsx
      fetcher.submit(
        { myKey: "myValue" },
        { method: "post", encType: "application/json" }
      );
      ```

     */
    target: SubmitTarget,

    // Fetchers cannot replace or set state because they are not navigation events
    options?: FetcherSubmitOptions
  ): Promise<void>;
}

let fetcherId = 0;
let getUniqueFetcherId = () => `__${String(++fetcherId)}__`;

/**
  The imperative version of {@link Form | `<Form>`} that lets you submit a form from code instead of a user interaction.

  ```tsx
  import { useSubmit } from "react-router";

  function SomeComponent() {
    const submit = useSubmit();
    return (
      <Form
        onChange={(event) => {
          submit(event.currentTarget);
        }}
      />
    );
  }
  ```

  @category Hooks
 */
export function useSubmit(): SubmitFunction {
  let { router } = useDataRouterContext(DataRouterHook.UseSubmit);
  let { basename } = React.useContext(NavigationContext);
  let currentRouteId = useRouteId();

  return React.useCallback<SubmitFunction>(
    async (target, options = {}) => {
      let { action, method, encType, formData, body } = getFormSubmissionInfo(
        target,
        basename
      );

      if (options.navigate === false) {
        let key = options.fetcherKey || getUniqueFetcherId();
        await router.fetch(key, currentRouteId, options.action || action, {
          preventScrollReset: options.preventScrollReset,
          formData,
          body,
          formMethod: options.method || (method as HTMLFormMethod),
          formEncType: options.encType || (encType as FormEncType),
          flushSync: options.flushSync,
        });
      } else {
        await router.navigate(options.action || action, {
          preventScrollReset: options.preventScrollReset,
          formData,
          body,
          formMethod: options.method || (method as HTMLFormMethod),
          formEncType: options.encType || (encType as FormEncType),
          replace: options.replace,
          state: options.state,
          fromRouteId: currentRouteId,
          flushSync: options.flushSync,
          viewTransition: options.viewTransition,
        });
      }
    },
    [router, basename, currentRouteId]
  );
}

// v7: Eventually we should deprecate this entirely in favor of using the
// router method directly?
/**
  Resolves the URL to the closest route in the component hierarchy instead of the current URL of the app.

  This is used internally by {@link Form} resolve the action to the closest route, but can be used generically as well.

  ```tsx
  import { useFormAction } from "react-router";

  function SomeComponent() {
    // closest route URL
    let action = useFormAction();

    // closest route URL + "destroy"
    let destroyAction = useFormAction("destroy");
  }
  ```

  @category Hooks
 */
export function useFormAction(
  /**
   * The action to append to the closest route URL.
   */
  action?: string,
  { relative }: { relative?: RelativeRoutingType } = {}
): string {
  let { basename } = React.useContext(NavigationContext);
  let routeContext = React.useContext(RouteContext);
  invariant(routeContext, "useFormAction must be used inside a RouteContext");

  let [match] = routeContext.matches.slice(-1);
  // Shallow clone path so we can modify it below, otherwise we modify the
  // object referenced by useMemo inside useResolvedPath
  let path = { ...useResolvedPath(action ? action : ".", { relative }) };

  // If no action was specified, browsers will persist current search params
  // when determining the path, so match that behavior
  // https://github.com/remix-run/remix/issues/927
  let location = useLocation();
  if (action == null) {
    // Safe to write to this directly here since if action was undefined, we
    // would have called useResolvedPath(".") which will never include a search
    path.search = location.search;

    // When grabbing search params from the URL, remove any included ?index param
    // since it might not apply to our contextual route.  We add it back based
    // on match.route.index below
    let params = new URLSearchParams(path.search);
    let indexValues = params.getAll("index");
    let hasNakedIndexParam = indexValues.some((v) => v === "");
    if (hasNakedIndexParam) {
      params.delete("index");
      indexValues.filter((v) => v).forEach((v) => params.append("index", v));
      let qs = params.toString();
      path.search = qs ? `?${qs}` : "";
    }
  }

  if ((!action || action === ".") && match.route.index) {
    path.search = path.search
      ? path.search.replace(/^\?/, "?index&")
      : "?index";
  }

  // If we're operating within a basename, prepend it to the pathname prior
  // to creating the form action.  If this is a root navigation, then just use
  // the raw basename which allows the basename to have full control over the
  // presence of a trailing slash on root actions
  if (basename !== "/") {
    path.pathname =
      path.pathname === "/" ? basename : joinPaths([basename, path.pathname]);
  }

  return createPath(path);
}

/**
The return value of `useFetcher` that keeps track of the state of a fetcher.

```tsx
let fetcher = useFetcher();
```
 */
export type FetcherWithComponents<TData> = Fetcher<TData> & {
  /**
    Just like {@link Form} except it doesn't cause a navigation.

    ```tsx
    function SomeComponent() {
      const fetcher = useFetcher()
      return (
        <fetcher.Form method="post" action="/some/route">
          <input type="text" />
        </fetcher.Form>
      )
    }
    ```
   */
  Form: React.ForwardRefExoticComponent<
    FetcherFormProps & React.RefAttributes<HTMLFormElement>
  >;

  /**
    Submits form data to a route. While multiple nested routes can match a URL, only the leaf route will be called.

    The `formData` can be multiple types:

    - [`FormData`][form_data] - A `FormData` instance.
    - [`HTMLFormElement`][html_form_element] - A [`<form>`][form_element] DOM element.
    - `Object` - An object of key/value pairs that will be converted to a `FormData` instance by default. You can pass a more complex object and serialize it as JSON by specifying `encType: "application/json"`. See [`useSubmit`][use-submit] for more details.

    If the method is `GET`, then the route [`loader`][loader] is being called and with the `formData` serialized to the url as [`URLSearchParams`][url_search_params]. If `DELETE`, `PATCH`, `POST`, or `PUT`, then the route [`action`][action] is being called with `formData` as the body.

    ```tsx
    // Submit a FormData instance (GET request)
    const formData = new FormData();
    fetcher.submit(formData);

    // Submit the HTML form element
    fetcher.submit(event.currentTarget.form, {
      method: "POST",
    });

    // Submit key/value JSON as a FormData instance
    fetcher.submit(
      { serialized: "values" },
      { method: "POST" }
    );

    // Submit raw JSON
    fetcher.submit(
      {
        deeply: {
          nested: {
            json: "values",
          },
        },
      },
      {
        method: "POST",
        encType: "application/json",
      }
    );
    ```
   */
  submit: FetcherSubmitFunction;

  /**
    Loads data from a route. Useful for loading data imperatively inside of user events outside of a normal button or form, like a combobox or search input.

    ```tsx
    let fetcher = useFetcher()

    <input onChange={e => {
      fetcher.load(`/search?q=${e.target.value}`)
    }} />
    ```
   */
  load: (
    href: string,
    opts?: {
      /**
       * Wraps the initial state update for this `fetcher.load` in a
       * `ReactDOM.flushSync` call instead of the default `React.startTransition`.
       * This allows you to perform synchronous DOM actions immediately after the
       * update is flushed to the DOM.
       */
      flushSync?: boolean;
    }
  ) => Promise<void>;
};

// TODO: (v7) Change the useFetcher generic default from `any` to `unknown`

/**
  Useful for creating complex, dynamic user interfaces that require multiple, concurrent data interactions without causing a navigation.

  Fetchers track their own, independent state and can be used to load data, submit forms, and generally interact with loaders and actions.

  ```tsx
  import { useFetcher } from "react-router"

  function SomeComponent() {
    let fetcher = useFetcher()

    // states are available on the fetcher
    fetcher.state // "idle" | "loading" | "submitting"
    fetcher.data // the data returned from the action or loader

    // render a form
    <fetcher.Form method="post" />

    // load data
    fetcher.load("/some/route")

    // submit data
    fetcher.submit(someFormRef, { method: "post" })
    fetcher.submit(someData, {
      method: "post",
      encType: "application/json"
    })
  }
  ```

  @category Hooks
 */
export function useFetcher<T = any>({
  key,
}: {
  /**
    By default, `useFetcher` generate a unique fetcher scoped to that component. If you want to identify a fetcher with your own key such that you can access it from elsewhere in your app, you can do that with the `key` option:

    ```tsx
    function SomeComp() {
      let fetcher = useFetcher({ key: "my-key" })
      // ...
    }

    // Somewhere else
    function AnotherComp() {
      // this will be the same fetcher, sharing the state across the app
      let fetcher = useFetcher({ key: "my-key" });
      // ...
    }
    ```
   */
  key?: string;
} = {}): FetcherWithComponents<SerializeFrom<T>> {
  let { router } = useDataRouterContext(DataRouterHook.UseFetcher);
  let state = useDataRouterState(DataRouterStateHook.UseFetcher);
  let fetcherData = React.useContext(FetchersContext);
  let route = React.useContext(RouteContext);
  let routeId = route.matches[route.matches.length - 1]?.route.id;

  invariant(fetcherData, `useFetcher must be used inside a FetchersContext`);
  invariant(route, `useFetcher must be used inside a RouteContext`);
  invariant(
    routeId != null,
    `useFetcher can only be used on routes that contain a unique "id"`
  );

  // Fetcher key handling
  let defaultKey = React.useId();
  let [fetcherKey, setFetcherKey] = React.useState<string>(key || defaultKey);
  if (key && key !== fetcherKey) {
    setFetcherKey(key);
  }

  // Registration/cleanup
  React.useEffect(() => {
    router.getFetcher(fetcherKey);
    return () => router.deleteFetcher(fetcherKey);
  }, [router, fetcherKey]);

  // Fetcher additions
  let load = React.useCallback(
    async (href: string, opts?: { flushSync?: boolean }) => {
      invariant(routeId, "No routeId available for fetcher.load()");
      await router.fetch(fetcherKey, routeId, href, opts);
    },
    [fetcherKey, routeId, router]
  );

  let submitImpl = useSubmit();
  let submit = React.useCallback<FetcherSubmitFunction>(
    async (target, opts) => {
      await submitImpl(target, {
        ...opts,
        navigate: false,
        fetcherKey,
      });
    },
    [fetcherKey, submitImpl]
  );

  let FetcherForm = React.useMemo(() => {
    let FetcherForm = React.forwardRef<HTMLFormElement, FetcherFormProps>(
      (props, ref) => {
        return (
          <Form {...props} navigate={false} fetcherKey={fetcherKey} ref={ref} />
        );
      }
    );
    FetcherForm.displayName = "fetcher.Form";
    return FetcherForm;
  }, [fetcherKey]);

  // Exposed FetcherWithComponents
  let fetcher = state.fetchers.get(fetcherKey) || IDLE_FETCHER;
  let data = fetcherData.get(fetcherKey);
  let fetcherWithComponents = React.useMemo(
    () => ({
      Form: FetcherForm,
      submit,
      load,
      ...fetcher,
      data,
    }),
    [FetcherForm, submit, load, fetcher, data]
  );

  return fetcherWithComponents;
}

/**
  Returns an array of all in-flight fetchers. This is useful for components throughout the app that didn't create the fetchers but want to use their submissions to participate in optimistic UI.

  ```tsx
  import { useFetchers } from "react-router";

  function SomeComponent() {
    const fetchers = useFetchers();
    fetchers[0].formData; // FormData
    fetchers[0].state; // etc.
    // ...
  }
  ```

  @category Hooks
 */
export function useFetchers(): (Fetcher & { key: string })[] {
  let state = useDataRouterState(DataRouterStateHook.UseFetchers);
  return Array.from(state.fetchers.entries()).map(([key, fetcher]) => ({
    ...fetcher,
    key,
  }));
}

const SCROLL_RESTORATION_STORAGE_KEY = "react-router-scroll-positions";
let savedScrollPositions: Record<string, number> = {};

function getScrollRestorationKey(
  location: Location,
  matches: UIMatch[],
  basename: string,
  getKey?: GetScrollRestorationKeyFunction
) {
  let key: string | null = null;
  if (getKey) {
    if (basename !== "/") {
      key = getKey(
        {
          ...location,
          pathname:
            stripBasename(location.pathname, basename) || location.pathname,
        },
        matches
      );
    } else {
      key = getKey(location, matches);
    }
  }
  if (key == null) {
    key = location.key;
  }
  return key;
}

/**
 * When rendered inside a RouterProvider, will restore scroll positions on navigations
 */
export function useScrollRestoration({
  getKey,
  storageKey,
}: {
  getKey?: GetScrollRestorationKeyFunction;
  storageKey?: string;
} = {}) {
  let { router } = useDataRouterContext(DataRouterHook.UseScrollRestoration);
  let { restoreScrollPosition, preventScrollReset } = useDataRouterState(
    DataRouterStateHook.UseScrollRestoration
  );
  let { basename } = React.useContext(NavigationContext);
  let location = useLocation();
  let matches = useMatches();
  let navigation = useNavigation();

  // Trigger manual scroll restoration while we're active
  React.useEffect(() => {
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = "auto";
    };
  }, []);

  // Save positions on pagehide
  usePageHide(
    React.useCallback(() => {
      if (navigation.state === "idle") {
        let key = getScrollRestorationKey(location, matches, basename, getKey);
        savedScrollPositions[key] = window.scrollY;
      }
      try {
        sessionStorage.setItem(
          storageKey || SCROLL_RESTORATION_STORAGE_KEY,
          JSON.stringify(savedScrollPositions)
        );
      } catch (error) {
        warning(
          false,
          `Failed to save scroll positions in sessionStorage, <ScrollRestoration /> will not work properly (${error}).`
        );
      }
      window.history.scrollRestoration = "auto";
    }, [navigation.state, getKey, basename, location, matches, storageKey])
  );

  // Read in any saved scroll locations
  if (typeof document !== "undefined") {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useLayoutEffect(() => {
      try {
        let sessionPositions = sessionStorage.getItem(
          storageKey || SCROLL_RESTORATION_STORAGE_KEY
        );
        if (sessionPositions) {
          savedScrollPositions = JSON.parse(sessionPositions);
        }
      } catch (e) {
        // no-op, use default empty object
      }
    }, [storageKey]);

    // Enable scroll restoration in the router
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useLayoutEffect(() => {
      let disableScrollRestoration = router?.enableScrollRestoration(
        savedScrollPositions,
        () => window.scrollY,
        getKey
          ? (location, matches) =>
              getScrollRestorationKey(location, matches, basename, getKey)
          : undefined
      );
      return () => disableScrollRestoration && disableScrollRestoration();
    }, [router, basename, getKey]);

    // Restore scrolling when state.restoreScrollPosition changes
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useLayoutEffect(() => {
      // Explicit false means don't do anything (used for submissions)
      if (restoreScrollPosition === false) {
        return;
      }

      // been here before, scroll to it
      if (typeof restoreScrollPosition === "number") {
        window.scrollTo(0, restoreScrollPosition);
        return;
      }

      // try to scroll to the hash
      if (location.hash) {
        let el = document.getElementById(
          decodeURIComponent(location.hash.slice(1))
        );
        if (el) {
          el.scrollIntoView();
          return;
        }
      }

      // Don't reset if this navigation opted out
      if (preventScrollReset === true) {
        return;
      }

      // otherwise go to the top on new locations
      window.scrollTo(0, 0);
    }, [location, restoreScrollPosition, preventScrollReset]);
  }
}

/**
 * Setup a callback to be fired on the window's `beforeunload` event.
 *
 * @category Hooks
 */
export function useBeforeUnload(
  callback: (event: BeforeUnloadEvent) => any,
  options?: { capture?: boolean }
): void {
  let { capture } = options || {};
  React.useEffect(() => {
    let opts = capture != null ? { capture } : undefined;
    window.addEventListener("beforeunload", callback, opts);
    return () => {
      window.removeEventListener("beforeunload", callback, opts);
    };
  }, [callback, capture]);
}

/**
 * Setup a callback to be fired on the window's `pagehide` event. This is
 * useful for saving some data to `window.localStorage` just before the page
 * refreshes.  This event is better supported than beforeunload across browsers.
 *
 * Note: The `callback` argument should be a function created with
 * `React.useCallback()`.
 */
function usePageHide(
  callback: (event: PageTransitionEvent) => any,
  options?: { capture?: boolean }
): void {
  let { capture } = options || {};
  React.useEffect(() => {
    let opts = capture != null ? { capture } : undefined;
    window.addEventListener("pagehide", callback, opts);
    return () => {
      window.removeEventListener("pagehide", callback, opts);
    };
  }, [callback, capture]);
}

/**
  Wrapper around useBlocker to show a window.confirm prompt to users instead of building a custom UI with {@link useBlocker}.

  The `unstable_` flag will not be removed because this technique has a lot of rough edges and behaves very differently (and incorrectly sometimes) across browsers if users click addition back/forward navigations while the confirmation is open.  Use at your own risk.

  ```tsx
  function ImportantForm() {
    let [value, setValue] = React.useState("");

    // Block navigating elsewhere when data has been entered into the input
    unstable_usePrompt({
      message: "Are you sure?",
      when: ({ currentLocation, nextLocation }) =>
        value !== "" &&
        currentLocation.pathname !== nextLocation.pathname,
    });

    return (
      <Form method="post">
        <label>
          Enter some important data:
          <input
            name="data"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <button type="submit">Save</button>
      </Form>
    );
  }
  ```

  @category Hooks
  @name unstable_usePrompt
 */
export function usePrompt({
  when,
  message,
}: {
  when: boolean | BlockerFunction;
  message: string;
}) {
  let blocker = useBlocker(when);

  React.useEffect(() => {
    if (blocker.state === "blocked") {
      let proceed = window.confirm(message);
      if (proceed) {
        // This timeout is needed to avoid a weird "race" on POP navigations
        // between the `window.history` revert navigation and the result of
        // `window.confirm`
        setTimeout(blocker.proceed, 0);
      } else {
        blocker.reset();
      }
    }
  }, [blocker, message]);

  React.useEffect(() => {
    if (blocker.state === "blocked" && !when) {
      blocker.reset();
    }
  }, [blocker, when]);
}

/**
  This hook returns `true` when there is an active [View Transition](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API) to the specified location. This can be used to apply finer-grained styles to elements to further customize the view transition. This requires that view transitions have been enabled for the given navigation via {@link LinkProps.viewTransition} (or the `Form`, `submit`, or `navigate` call)

  @category Hooks
  @name useViewTransitionState
 */
export function useViewTransitionState(
  to: To,
  opts: { relative?: RelativeRoutingType } = {}
) {
  let vtContext = React.useContext(ViewTransitionContext);

  invariant(
    vtContext != null,
    "`useViewTransitionState` must be used within `react-router-dom`'s `RouterProvider`.  " +
      "Did you accidentally import `RouterProvider` from `react-router`?"
  );

  let { basename } = useDataRouterContext(
    DataRouterHook.useViewTransitionState
  );
  let path = useResolvedPath(to, { relative: opts.relative });
  if (!vtContext.isTransitioning) {
    return false;
  }

  let currentPath =
    stripBasename(vtContext.currentLocation.pathname, basename) ||
    vtContext.currentLocation.pathname;
  let nextPath =
    stripBasename(vtContext.nextLocation.pathname, basename) ||
    vtContext.nextLocation.pathname;

  // Transition is active if we're going to or coming from the indicated
  // destination.  This ensures that other PUSH navigations that reverse
  // an indicated transition apply.  I.e., on the list view you have:
  //
  //   <NavLink to="/details/1" viewTransition>
  //
  // If you click the breadcrumb back to the list view:
  //
  //   <NavLink to="/list" viewTransition>
  //
  // We should apply the transition because it's indicated as active going
  // from /list -> /details/1 and therefore should be active on the reverse
  // (even though this isn't strictly a POP reverse)
  return (
    matchPath(path.pathname, nextPath) != null ||
    matchPath(path.pathname, currentPath) != null
  );
}

//#endregion
