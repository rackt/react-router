/**
 * NOTE: If you refactor this to split up the modules into separate files,
 * you'll need to update the rollup config for react-router-dom-v5-compat.
 */
import * as React from "react";
import type {
  Location,
  NavigateOptions,
  NavigationType,
  RelativeRoutingType,
  RouteObject,
  To,
} from "react-router";
import {
  Router,
  createPath,
  useHref,
  useLocation,
  useMatches,
  useNavigate,
  useNavigation,
  useResolvedPath,
  unstable_useBlocker as useBlocker,
  UNSAFE_DataRouterContext as DataRouterContext,
  UNSAFE_DataRouterStateContext as DataRouterStateContext,
  UNSAFE_NavigationContext as NavigationContext,
  UNSAFE_RouteContext as RouteContext,
  UNSAFE_mapRouteProperties as mapRouteProperties,
  UNSAFE_useRouteId as useRouteId,
} from "react-router";
import type {
  BrowserHistory,
  Fetcher,
  FormEncType,
  FormMethod,
  FutureConfig,
  GetScrollRestorationKeyFunction,
  HashHistory,
  History,
  HTMLFormMethod,
  HydrationState,
  Router as RemixRouter,
  V7_FormMethod,
} from "@remix-run/router";
import {
  createRouter,
  createBrowserHistory,
  createHashHistory,
  joinPaths,
  stripBasename,
  ErrorResponse,
  UNSAFE_invariant as invariant,
  UNSAFE_warning as warning,
} from "@remix-run/router";

import type {
  SubmitOptions,
  ParamKeyValuePair,
  URLSearchParamsInit,
} from "./dom";
import {
  createSearchParams,
  defaultMethod,
  getFormSubmissionInfo,
  getSearchParamsForLocation,
  shouldProcessLinkClick,
} from "./dom";

////////////////////////////////////////////////////////////////////////////////
//#region Re-exports
////////////////////////////////////////////////////////////////////////////////

export type {
  FormEncType,
  FormMethod,
  GetScrollRestorationKeyFunction,
  ParamKeyValuePair,
  SubmitOptions,
  URLSearchParamsInit,
  V7_FormMethod,
};
export { createSearchParams };

// Note: Keep in sync with react-router exports!
export type {
  ActionFunction,
  ActionFunctionArgs,
  AwaitProps,
  unstable_Blocker,
  unstable_BlockerFunction,
  DataRouteMatch,
  DataRouteObject,
  Fetcher,
  Hash,
  IndexRouteObject,
  IndexRouteProps,
  JsonFunction,
  LazyRouteFunction,
  LayoutRouteProps,
  LoaderFunction,
  LoaderFunctionArgs,
  Location,
  MemoryRouterProps,
  NavigateFunction,
  NavigateOptions,
  NavigateProps,
  Navigation,
  Navigator,
  NonIndexRouteObject,
  OutletProps,
  Params,
  ParamParseKey,
  Path,
  PathMatch,
  Pathname,
  PathPattern,
  PathRouteProps,
  RedirectFunction,
  RelativeRoutingType,
  RouteMatch,
  RouteObject,
  RouteProps,
  RouterProps,
  RouterProviderProps,
  RoutesProps,
  Search,
  ShouldRevalidateFunction,
  To,
} from "react-router";
export {
  AbortedDeferredError,
  Await,
  MemoryRouter,
  Navigate,
  NavigationType,
  Outlet,
  Route,
  Router,
  RouterProvider,
  Routes,
  createMemoryRouter,
  createPath,
  createRoutesFromChildren,
  createRoutesFromElements,
  defer,
  isRouteErrorResponse,
  generatePath,
  json,
  matchPath,
  matchRoutes,
  parsePath,
  redirect,
  renderMatches,
  resolvePath,
  useActionData,
  useAsyncError,
  useAsyncValue,
  unstable_useBlocker,
  useHref,
  useInRouterContext,
  useLoaderData,
  useLocation,
  useMatch,
  useMatches,
  useNavigate,
  useNavigation,
  useNavigationType,
  useOutlet,
  useOutletContext,
  useParams,
  useResolvedPath,
  useRevalidator,
  useRouteError,
  useRouteLoaderData,
  useRoutes,
} from "react-router";

///////////////////////////////////////////////////////////////////////////////
// DANGER! PLEASE READ ME!
// We provide these exports as an escape hatch in the event that you need any
// routing data that we don't provide an explicit API for. With that said, we
// want to cover your use case if we can, so if you feel the need to use these
// we want to hear from you. Let us know what you're building and we'll do our
// best to make sure we can support you!
//
// We consider these exports an implementation detail and do not guarantee
// against any breaking changes, regardless of the semver release. Use with
// extreme caution and only if you understand the consequences. Godspeed.
///////////////////////////////////////////////////////////////////////////////

/** @internal */
export {
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  UNSAFE_NavigationContext,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext,
  UNSAFE_useRouteId,
} from "react-router";
//#endregion

declare global {
  var __staticRouterHydrationData: HydrationState | undefined;
}

////////////////////////////////////////////////////////////////////////////////
//#region Routers
////////////////////////////////////////////////////////////////////////////////

interface DOMRouterOpts {
  basename?: string;
  future?: Partial<Omit<FutureConfig, "v7_prependBasename">>;
  hydrationData?: HydrationState;
  window?: Window;
}

export function createBrowserRouter(
  routes: RouteObject[],
  opts?: DOMRouterOpts
): RemixRouter {
  return createRouter({
    basename: opts?.basename,
    future: {
      ...opts?.future,
      v7_prependBasename: true,
    },
    history: createBrowserHistory({ window: opts?.window }),
    hydrationData: opts?.hydrationData || parseHydrationData(),
    routes,
    mapRouteProperties,
  }).initialize();
}

export function createHashRouter(
  routes: RouteObject[],
  opts?: DOMRouterOpts
): RemixRouter {
  return createRouter({
    basename: opts?.basename,
    future: {
      ...opts?.future,
      v7_prependBasename: true,
    },
    history: createHashHistory({ window: opts?.window }),
    hydrationData: opts?.hydrationData || parseHydrationData(),
    routes,
    mapRouteProperties,
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
  errors: RemixRouter["state"]["errors"]
): RemixRouter["state"]["errors"] {
  if (!errors) return null;
  let entries = Object.entries(errors);
  let serialized: RemixRouter["state"]["errors"] = {};
  for (let [key, val] of entries) {
    // Hey you!  If you change this, please change the corresponding logic in
    // serializeErrors in react-router-dom/server.tsx :)
    if (val && val.__type === "RouteErrorResponse") {
      serialized[key] = new ErrorResponse(
        val.status,
        val.statusText,
        val.data,
        val.internal === true
      );
    } else if (val && val.__type === "Error") {
      let error = new Error(val.message);
      // Wipe away the client-side stack trace.  Nothing to fill it in with
      // because we don't serialize SSR stack traces for security reasons
      error.stack = "";
      serialized[key] = error;
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

export interface BrowserRouterProps {
  basename?: string;
  children?: React.ReactNode;
  window?: Window;
}

/**
 * A `<Router>` for use in web browsers. Provides the cleanest URLs.
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
      "startTransition" in React
        ? React.startTransition(() => setStateImpl(newState))
        : setStateImpl(newState);
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

export interface HashRouterProps {
  basename?: string;
  children?: React.ReactNode;
  window?: Window;
}

/**
 * A `<Router>` for use in web browsers. Stores the location in the hash
 * portion of the URL so it is not sent to the server.
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
      "startTransition" in React
        ? React.startTransition(() => setStateImpl(newState))
        : setStateImpl(newState);
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
 */
function HistoryRouter({ basename, children, history }: HistoryRouterProps) {
  let [state, setStateImpl] = React.useState({
    action: history.action,
    location: history.location,
  });
  let setState = React.useCallback(
    (newState: { action: NavigationType; location: Location }) => {
      "startTransition" in React
        ? React.startTransition(() => setStateImpl(newState))
        : setStateImpl(newState);
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

if (__DEV__) {
  HistoryRouter.displayName = "unstable_HistoryRouter";
}

export { HistoryRouter as unstable_HistoryRouter };

export interface LinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  reloadDocument?: boolean;
  replace?: boolean;
  state?: any;
  preventScrollReset?: boolean;
  relative?: RelativeRoutingType;
  to: To;
}

const isBrowser =
  typeof window !== "undefined" &&
  typeof window.document !== "undefined" &&
  typeof window.document.createElement !== "undefined";

const ABSOLUTE_URL_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * The public API for rendering a history-aware <a>.
 */
export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  function LinkWithRef(
    {
      onClick,
      relative,
      reloadDocument,
      replace,
      state,
      target,
      to,
      preventScrollReset,
      ...rest
    },
    ref
  ) {
    let { basename } = React.useContext(NavigationContext);

    // Rendered into <a href> for absolute URLs
    let absoluteHref;
    let isExternal = false;

    if (typeof to === "string" && ABSOLUTE_URL_REGEX.test(to)) {
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

    let internalOnClick = useLinkClickHandler(to, {
      replace,
      state,
      target,
      preventScrollReset,
      relative,
    });
    function handleClick(
      event: React.MouseEvent<HTMLAnchorElement, MouseEvent>
    ) {
      if (onClick) onClick(event);
      if (!event.defaultPrevented) {
        internalOnClick(event);
      }
    }

    return (
      // eslint-disable-next-line jsx-a11y/anchor-has-content
      <a
        {...rest}
        href={absoluteHref || href}
        onClick={isExternal || reloadDocument ? onClick : handleClick}
        ref={ref}
        target={target}
      />
    );
  }
);

if (__DEV__) {
  Link.displayName = "Link";
}

export interface NavLinkProps
  extends Omit<LinkProps, "className" | "style" | "children"> {
  children?:
    | React.ReactNode
    | ((props: { isActive: boolean; isPending: boolean }) => React.ReactNode);
  caseSensitive?: boolean;
  className?:
    | string
    | ((props: {
        isActive: boolean;
        isPending: boolean;
      }) => string | undefined);
  end?: boolean;
  style?:
    | React.CSSProperties
    | ((props: {
        isActive: boolean;
        isPending: boolean;
      }) => React.CSSProperties | undefined);
}

/**
 * A <Link> wrapper that knows if it's "active" or not.
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
      children,
      ...rest
    },
    ref
  ) {
    let path = useResolvedPath(to, { relative: rest.relative });
    let location = useLocation();
    let routerState = React.useContext(DataRouterStateContext);
    let { navigator } = React.useContext(NavigationContext);

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

    let isActive =
      locationPathname === toPathname ||
      (!end &&
        locationPathname.startsWith(toPathname) &&
        locationPathname.charAt(toPathname.length) === "/");

    let isPending =
      nextLocationPathname != null &&
      (nextLocationPathname === toPathname ||
        (!end &&
          nextLocationPathname.startsWith(toPathname) &&
          nextLocationPathname.charAt(toPathname.length) === "/"));

    let ariaCurrent = isActive ? ariaCurrentProp : undefined;

    let className: string | undefined;
    if (typeof classNameProp === "function") {
      className = classNameProp({ isActive, isPending });
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
      ]
        .filter(Boolean)
        .join(" ");
    }

    let style =
      typeof styleProp === "function"
        ? styleProp({ isActive, isPending })
        : styleProp;

    return (
      <Link
        {...rest}
        aria-current={ariaCurrent}
        className={className}
        ref={ref}
        style={style}
        to={to}
      >
        {typeof children === "function"
          ? children({ isActive, isPending })
          : children}
      </Link>
    );
  }
);

if (__DEV__) {
  NavLink.displayName = "NavLink";
}

export interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  /**
   * The HTTP verb to use when the form is submit. Supports "get", "post",
   * "put", "delete", "patch".
   */
  method?: HTMLFormMethod;

  /**
   * Normal `<form action>` but supports React Router's relative paths.
   */
  action?: string;

  /**
   * Forces a full document navigation instead of a fetch.
   */
  reloadDocument?: boolean;

  /**
   * Replaces the current entry in the browser history stack when the form
   * navigates. Use this if you don't want the user to be able to click "back"
   * to the page with the form on it.
   */
  replace?: boolean;

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
 * A `@remix-run/router`-aware `<form>`. It behaves like a normal form except
 * that the interaction with the server is with `fetch` instead of new document
 * requests, allowing components to add nicer UX to the page as the form is
 * submitted and returns with data.
 */
export const Form = React.forwardRef<HTMLFormElement, FormProps>(
  (props, ref) => {
    return <FormImpl {...props} ref={ref} />;
  }
);

if (__DEV__) {
  Form.displayName = "Form";
}

type HTMLSubmitEvent = React.BaseSyntheticEvent<
  SubmitEvent,
  Event,
  HTMLFormElement
>;

type HTMLFormSubmitter = HTMLButtonElement | HTMLInputElement;

interface FormImplProps extends FormProps {
  fetcherKey?: string;
  routeId?: string;
}

const FormImpl = React.forwardRef<HTMLFormElement, FormImplProps>(
  (
    {
      reloadDocument,
      replace,
      method = defaultMethod,
      action,
      onSubmit,
      fetcherKey,
      routeId,
      relative,
      preventScrollReset,
      ...props
    },
    forwardedRef
  ) => {
    let submit = useSubmitImpl(fetcherKey, routeId);
    let formMethod: HTMLFormMethod =
      method.toLowerCase() === "get" ? "get" : "post";
    let formAction = useFormAction(action, { relative });
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
        method: submitMethod,
        replace,
        relative,
        preventScrollReset,
      });
    };

    return (
      <form
        ref={forwardedRef}
        method={formMethod}
        action={formAction}
        onSubmit={reloadDocument ? onSubmit : submitHandler}
        {...props}
      />
    );
  }
);

if (__DEV__) {
  FormImpl.displayName = "FormImpl";
}

export interface ScrollRestorationProps {
  getKey?: GetScrollRestorationKeyFunction;
  storageKey?: string;
  scrollContainer?: string | React.RefObject<HTMLElement>;
}

/**
 * This component will emulate the browser's scroll restoration on location
 * changes.
 */
export function ScrollRestoration({
  getKey,
  storageKey,
  scrollContainer,
}: ScrollRestorationProps) {
  useScrollRestoration({ getKey, storageKey, scrollContainer });
  return null;
}

if (__DEV__) {
  ScrollRestoration.displayName = "ScrollRestoration";
}
//#endregion

////////////////////////////////////////////////////////////////////////////////
//#region Hooks
////////////////////////////////////////////////////////////////////////////////

enum DataRouterHook {
  UseScrollRestoration = "useScrollRestoration",
  UseSubmitImpl = "useSubmitImpl",
  UseFetcher = "useFetcher",
}

enum DataRouterStateHook {
  UseFetchers = "useFetchers",
  UseScrollRestoration = "useScrollRestoration",
}

function getDataRouterConsoleError(
  hookName: DataRouterHook | DataRouterStateHook
) {
  return `${hookName} must be used within a data router.  See https://reactrouter.com/routers/picking-a-router.`;
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

/**
 * Handles the click behavior for router `<Link>` components. This is useful if
 * you need to create custom `<Link>` components with the same click behavior we
 * use in our exported `<Link>`.
 */
export function useLinkClickHandler<E extends Element = HTMLAnchorElement>(
  to: To,
  {
    target,
    replace: replaceProp,
    state,
    preventScrollReset,
    relative,
  }: {
    target?: React.HTMLAttributeAnchorTarget;
    replace?: boolean;
    state?: any;
    preventScrollReset?: boolean;
    relative?: RelativeRoutingType;
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

        navigate(to, { replace, state, preventScrollReset, relative });
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
    ]
  );
}

/**
 * A convenient wrapper for reading and writing search parameters via the
 * URLSearchParams interface.
 */
export function useSearchParams(
  defaultInit?: URLSearchParamsInit
): [URLSearchParams, SetURLSearchParams] {
  warning(
    typeof URLSearchParams !== "undefined",
    `You cannot use the \`useSearchParams\` hook in a browser that does not ` +
      `support the URLSearchParams API. If you need to support Internet ` +
      `Explorer 11, we recommend you load a polyfill such as ` +
      `https://github.com/ungap/url-search-params\n\n` +
      `If you're unsure how to load polyfills, we recommend you check out ` +
      `https://polyfill.io/v3/ which provides some recommendations about how ` +
      `to load polyfills only for users that need them, instead of for every ` +
      `user.`
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
        typeof nextInit === "function" ? nextInit(searchParams) : nextInit
      );
      hasSetSearchParamsRef.current = true;
      navigate("?" + newSearchParams, navigateOptions);
    },
    [navigate, searchParams]
  );

  return [searchParams, setSearchParams];
}

export type SetURLSearchParams = (
  nextInit?:
    | URLSearchParamsInit
    | ((prev: URLSearchParams) => URLSearchParamsInit),
  navigateOpts?: NavigateOptions
) => void;

type SubmitTarget =
  | HTMLFormElement
  | HTMLButtonElement
  | HTMLInputElement
  | FormData
  | URLSearchParams
  | { [name: string]: string }
  | null;

/**
 * Submits a HTML `<form>` to the server without reloading the page.
 */
export interface SubmitFunction {
  (
    /**
     * Specifies the `<form>` to be submitted to the server, a specific
     * `<button>` or `<input type="submit">` to use to submit the form, or some
     * arbitrary data to submit.
     *
     * Note: When using a `<button>` its `name` and `value` will also be
     * included in the form data that is submitted.
     */
    target: SubmitTarget,

    /**
     * Options that override the `<form>`'s own attributes. Required when
     * submitting arbitrary data without a backing `<form>`.
     */
    options?: SubmitOptions
  ): void;
}

/**
 * Returns a function that may be used to programmatically submit a form (or
 * some arbitrary data) to the server.
 */
export function useSubmit(): SubmitFunction {
  return useSubmitImpl();
}

function useSubmitImpl(
  fetcherKey?: string,
  fetcherRouteId?: string
): SubmitFunction {
  let { router } = useDataRouterContext(DataRouterHook.UseSubmitImpl);
  let { basename } = React.useContext(NavigationContext);
  let currentRouteId = useRouteId();

  return React.useCallback(
    (target, options = {}) => {
      if (typeof document === "undefined") {
        throw new Error(
          "You are calling submit during the server render. " +
            "Try calling submit within a `useEffect` or callback instead."
        );
      }

      let { action, method, encType, formData } = getFormSubmissionInfo(
        target,
        options,
        basename
      );

      // Base options shared between fetch() and navigate()
      let opts = {
        preventScrollReset: options.preventScrollReset,
        formData,
        formMethod: method as HTMLFormMethod,
        formEncType: encType as FormEncType,
      };

      if (fetcherKey) {
        invariant(
          fetcherRouteId != null,
          "No routeId available for useFetcher()"
        );
        router.fetch(fetcherKey, fetcherRouteId, action, opts);
      } else {
        router.navigate(action, {
          ...opts,
          replace: options.replace,
          fromRouteId: currentRouteId,
        });
      }
    },
    [router, basename, fetcherKey, fetcherRouteId, currentRouteId]
  );
}

// v7: Eventually we should deprecate this entirely in favor of using the
// router method directly?
export function useFormAction(
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

  // Previously we set the default action to ".". The problem with this is that
  // `useResolvedPath(".")` excludes search params and the hash of the resolved
  // URL. This is the intended behavior of when "." is specifically provided as
  // the form action, but inconsistent w/ browsers when the action is omitted.
  // https://github.com/remix-run/remix/issues/927
  let location = useLocation();
  if (action == null) {
    // Safe to write to these directly here since if action was undefined, we
    // would have called useResolvedPath(".") which will never include a search
    // or hash
    path.search = location.search;
    path.hash = location.hash;

    // When grabbing search params from the URL, remove the automatically
    // inserted ?index param so we match the useResolvedPath search behavior
    // which would not include ?index
    if (match.route.index) {
      let params = new URLSearchParams(path.search);
      params.delete("index");
      path.search = params.toString() ? `?${params.toString()}` : "";
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

function createFetcherForm(fetcherKey: string, routeId: string) {
  let FetcherForm = React.forwardRef<HTMLFormElement, FormProps>(
    (props, ref) => {
      return (
        <FormImpl
          {...props}
          ref={ref}
          fetcherKey={fetcherKey}
          routeId={routeId}
        />
      );
    }
  );
  if (__DEV__) {
    FetcherForm.displayName = "fetcher.Form";
  }
  return FetcherForm;
}

let fetcherId = 0;

export type FetcherWithComponents<TData> = Fetcher<TData> & {
  Form: ReturnType<typeof createFetcherForm>;
  submit: (
    target: SubmitTarget,
    // Fetchers cannot replace/preventScrollReset because they are not
    // navigation events
    options?: Omit<SubmitOptions, "replace" | "preventScrollReset">
  ) => void;
  load: (href: string) => void;
};

/**
 * Interacts with route loaders and actions without causing a navigation. Great
 * for any interaction that stays on the same page.
 */
export function useFetcher<TData = any>(): FetcherWithComponents<TData> {
  let { router } = useDataRouterContext(DataRouterHook.UseFetcher);

  let route = React.useContext(RouteContext);
  invariant(route, `useFetcher must be used inside a RouteContext`);

  let routeId = route.matches[route.matches.length - 1]?.route.id;
  invariant(
    routeId != null,
    `useFetcher can only be used on routes that contain a unique "id"`
  );

  let [fetcherKey] = React.useState(() => String(++fetcherId));
  let [Form] = React.useState(() => {
    invariant(routeId, `No routeId available for fetcher.Form()`);
    return createFetcherForm(fetcherKey, routeId);
  });
  let [load] = React.useState(() => (href: string) => {
    invariant(router, "No router available for fetcher.load()");
    invariant(routeId, "No routeId available for fetcher.load()");
    router.fetch(fetcherKey, routeId, href);
  });
  let submit = useSubmitImpl(fetcherKey, routeId);

  let fetcher = router.getFetcher<TData>(fetcherKey);

  let fetcherWithComponents = React.useMemo(
    () => ({
      Form,
      submit,
      load,
      ...fetcher,
    }),
    [fetcher, Form, submit, load]
  );

  React.useEffect(() => {
    // Is this busted when the React team gets real weird and calls effects
    // twice on mount?  We really just need to garbage collect here when this
    // fetcher is no longer around.
    return () => {
      if (!router) {
        console.warn(`No router available to clean up from useFetcher()`);
        return;
      }
      router.deleteFetcher(fetcherKey);
    };
  }, [router, fetcherKey]);

  return fetcherWithComponents;
}

/**
 * Provides all fetchers currently on the page. Useful for layouts and parent
 * routes that need to provide pending/optimistic UI regarding the fetch.
 */
export function useFetchers(): Fetcher[] {
  let state = useDataRouterState(DataRouterStateHook.UseFetchers);
  return [...state.fetchers.values()];
}

const SCROLL_RESTORATION_STORAGE_KEY = "react-router-scroll-positions";
let savedScrollPositions: Record<string, number> = {};

function getScrollTarget(
  scrollContainer: string | React.RefObject<HTMLElement> | undefined
) {
  if (typeof scrollContainer === "string") {
    return document.querySelector(scrollContainer);
  }
  return scrollContainer ? scrollContainer.current : window;
}

function getScrollY(
  scrollContainer: string | React.RefObject<HTMLElement> | undefined
) {
  const el = getScrollTarget(scrollContainer);
  // window has scrollY but normal elements have scrollTop
  return !el ? 0 : (el as Window).scrollY || (el as HTMLElement).scrollTop;
}

function scrollY(
  elementRef: string | React.RefObject<HTMLElement> | undefined,
  y: number
) {
  const el = getScrollTarget(elementRef);
  if (el) {
    el.scrollTo(0, y);
  }
}

/**
 * When rendered inside a RouterProvider, will restore scroll positions on navigations
 */
function useScrollRestoration({
  getKey,
  storageKey,
  scrollContainer,
}: {
  getKey?: GetScrollRestorationKeyFunction;
  storageKey?: string;
  scrollContainer?: string | React.RefObject<HTMLElement>;
} = {}) {
  let { router } = useDataRouterContext(DataRouterHook.UseScrollRestoration);
  let { restoreScrollPosition, preventScrollReset } = useDataRouterState(
    DataRouterStateHook.UseScrollRestoration
  );
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
        let key = (getKey ? getKey(location, matches) : null) || location.key;
        savedScrollPositions[key] = getScrollY(scrollContainer);
      }
      sessionStorage.setItem(
        storageKey || SCROLL_RESTORATION_STORAGE_KEY,
        JSON.stringify(savedScrollPositions)
      );
      window.history.scrollRestoration = "auto";
    }, [
      storageKey,
      getKey,
      scrollContainer,
      navigation.state,
      location,
      matches,
    ])
  );

  // Read in any saved scroll locations
  if (typeof document !== "undefined") {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useLayoutEffect(() => {
      try {
        // Only load once per session so it persists between unmounts/remounts
        // (i.e., different instance per layout)
        if (savedScrollPositions) {
          return;
        }
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
        () => getScrollY(scrollContainer),
        getKey
      );
      return () => disableScrollRestoration && disableScrollRestoration();
    }, [router, getKey, scrollContainer]);

    // Restore scrolling when state.restoreScrollPosition changes
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useLayoutEffect(() => {
      // Explicit false means don't do anything (used for submissions)
      if (restoreScrollPosition === false) {
        return;
      }

      // been here before, scroll to it
      if (typeof restoreScrollPosition === "number") {
        scrollY(scrollContainer, restoreScrollPosition);
        return;
      }

      // try to scroll to the hash
      if (location.hash) {
        let el = document.getElementById(location.hash.slice(1));
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
      scrollY(scrollContainer, 0);
    }, [location, restoreScrollPosition, preventScrollReset, scrollContainer]);
  }
}

export { useScrollRestoration as UNSAFE_useScrollRestoration };

/**
 * Setup a callback to be fired on the window's `beforeunload` event. This is
 * useful for saving some data to `window.localStorage` just before the page
 * refreshes.
 *
 * Note: The `callback` argument should be a function created with
 * `React.useCallback()`.
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
 * Wrapper around useBlocker to show a window.confirm prompt to users instead
 * of building a custom UI with useBlocker.
 *
 * Warning: This has *a lot of rough edges* and behaves very differently (and
 * very incorrectly in some cases) across browsers if user click addition
 * back/forward navigations while the confirm is open.  Use at your own risk.
 */
function usePrompt({ when, message }: { when: boolean; message: string }) {
  let blocker = useBlocker(when);

  React.useEffect(() => {
    if (blocker.state === "blocked" && !when) {
      blocker.reset();
    }
  }, [blocker, when]);

  React.useEffect(() => {
    if (blocker.state === "blocked") {
      let proceed = window.confirm(message);
      if (proceed) {
        setTimeout(blocker.proceed, 0);
      } else {
        blocker.reset();
      }
    }
  }, [blocker, message]);
}

export { usePrompt as unstable_usePrompt };

//#endregion
