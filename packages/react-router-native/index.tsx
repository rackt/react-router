import * as React from "react";
import type {
  GestureResponderEvent,
  TouchableHighlightProps,
} from "react-native";
import { BackHandler, Linking, TouchableHighlight } from "react-native";
import type {
  To,
  MemoryRouterProps,
  NavigateOptions,
  RelativeRoutingType,
} from "react-router";
import { MemoryRouter, useLocation, useNavigate } from "react-router";

import URLSearchParams from "@ungap/url-search-params";

////////////////////////////////////////////////////////////////////////////////
// RE-EXPORTS
////////////////////////////////////////////////////////////////////////////////

// Note: Keep in sync with react-router exports!
export type {
  ActionFunction,
  ActionFunctionArgs,
  AwaitProps,
  Blocker,
  BlockerFunction,
  DataRouteMatch,
  DataRouteObject,
  unstable_DataStrategyFunction,
  unstable_DataStrategyFunctionArgs,
  unstable_DataStrategyMatch,
  ErrorResponse,
  Fetcher,
  FutureConfig,
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
  PathParam,
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
  ShouldRevalidateFunctionArgs,
  To,
  UIMatch,
  unstable_HandlerResult,
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
  redirectDocument,
  renderMatches,
  resolvePath,
  useActionData,
  useAsyncError,
  useAsyncValue,
  useBlocker,
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

////////////////////////////////////////////////////////////////////////////////
// COMPONENTS
////////////////////////////////////////////////////////////////////////////////

export interface NativeRouterProps extends MemoryRouterProps {}

/**
 * A `<Router>` that runs on React Native.
 */
export function NativeRouter(props: NativeRouterProps) {
  return <MemoryRouter {...props} />;
}

export interface LinkProps extends TouchableHighlightProps {
  children?: React.ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  relative?: RelativeRoutingType;
  replace?: boolean;
  state?: any;
  to: To;
}

/**
 * A `<TouchableHighlight>` that navigates to a different URL when touched.
 */
export function Link({
  onPress,
  relative,
  replace = false,
  state,
  to,
  ...rest
}: LinkProps) {
  let internalOnPress = useLinkPressHandler(to, { replace, state, relative });
  function handlePress(event: GestureResponderEvent) {
    if (onPress) onPress(event);
    if (!event.defaultPrevented) {
      internalOnPress(event);
    }
  }

  return <TouchableHighlight {...rest} onPress={handlePress} />;
}

////////////////////////////////////////////////////////////////////////////////
// HOOKS
////////////////////////////////////////////////////////////////////////////////

const HardwareBackPressEventType = "hardwareBackPress";
const URLEventType = "url";

/**
 * Handles the press behavior for router `<Link>` components. This is useful if
 * you need to create custom `<Link>` components with the same press behavior we
 * use in our exported `<Link>`.
 */
export function useLinkPressHandler(
  to: To,
  {
    replace,
    state,
    relative,
  }: {
    replace?: boolean;
    state?: any;
    relative?: RelativeRoutingType;
  } = {}
): (event: GestureResponderEvent) => void {
  let navigate = useNavigate();
  return function handlePress() {
    navigate(to, { replace, state, relative });
  };
}

/**
 * Enables support for the hardware back button on Android.
 */
export function useHardwareBackButton() {
  React.useEffect(() => {
    function handleHardwardBackPress() {
      return undefined;
      // TODO: The implementation will be something like this
      // if (history.index === 0) {
      //   return false; // home screen
      // } else {
      //   history.back();
      //   return true;
      // }
    }

    BackHandler.addEventListener(
      HardwareBackPressEventType,
      handleHardwardBackPress
    );

    return () => {
      BackHandler.removeEventListener(
        HardwareBackPressEventType,
        handleHardwardBackPress
      );
    };
  }, []);
}

export { useHardwareBackButton as useAndroidBackButton };

/**
 * Enables deep linking, both on the initial app launch and for
 * subsequent incoming links.
 */
export function useDeepLinking() {
  let navigate = useNavigate();

  // Get the initial URL
  React.useEffect(() => {
    let current = true;

    Linking.getInitialURL().then((url) => {
      if (current) {
        if (url) navigate(trimScheme(url));
      }
    });

    return () => {
      current = false;
    };
  }, [navigate]);

  // Listen for URL changes
  React.useEffect(() => {
    function handleURLChange(event: { url: string }) {
      navigate(trimScheme(event.url));
    }

    Linking.addEventListener(URLEventType, handleURLChange);

    return () => {
      Linking.removeEventListener(URLEventType, handleURLChange);
    };
  }, [navigate]);
}

function trimScheme(url: string) {
  return url.replace(/^.*?:\/\//, "");
}

/**
 * A convenient wrapper for accessing individual query parameters via the
 * URLSearchParams interface.
 */
export function useSearchParams(
  defaultInit?: URLSearchParamsInit
): [URLSearchParams, SetURLSearchParams] {
  let location = useLocation();
  let defaultSearchParamsRef = React.useRef(createSearchParams(defaultInit));
  let hasSetSearchParamsRef = React.useRef(false);

  let [searchParams, __setSearchParams] = React.useState<URLSearchParams>(createSearchParams(location.search));
  let searchParamsRef = React.useRef<URLSearchParams>(searchParams);

  let initializedRef = React.useRef<boolean>(false);
  React.useEffect(() => {
    // Prevent re-assigning the search params on initialization
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    searchParamsRef.current  = createSearchParams(location.search);
    if (!hasSetSearchParamsRef.current) {
      for (let key of defaultSearchParamsRef.current.keys()) {
        if (!searchParamsRef.current.has(key)) {
          defaultSearchParamsRef.current.getAll(key).forEach((value) => {
            searchParamsRef.current.append(key, value);
          });
        }
      }
    }

    __setSearchParams(searchParamsRef.current);
  }, [location.search, __setSearchParams]);

  let navigate = useNavigate();
  let setSearchParams = React.useCallback<SetURLSearchParams>(
    (nextInit, navigateOpts) => {
      const newSearchParams = createSearchParams(
        typeof nextInit === "function" ? nextInit(searchParamsRef.current) : nextInit
      );
      hasSetSearchParamsRef.current = true;
      navigate("?" + newSearchParams, navigateOpts);
    },
    [navigate]
  );

  return [searchParams, setSearchParams];
}

export type SetURLSearchParams = (
  nextInit?:
    | URLSearchParamsInit
    | ((prev: URLSearchParams) => URLSearchParamsInit),
  navigateOpts?: NavigateOptions
) => void;

export type ParamKeyValuePair = [string, string];

export type URLSearchParamsInit =
  | string
  | ParamKeyValuePair[]
  | Record<string, string | string[]>
  | URLSearchParams;

/**
 * Creates a URLSearchParams object using the given initializer.
 *
 * This is identical to `new URLSearchParams(init)` except it also
 * supports arrays as values in the object form of the initializer
 * instead of just strings. This is convenient when you need multiple
 * values for a given key, but don't want to use an array initializer.
 *
 * For example, instead of:
 *
 *   let searchParams = new URLSearchParams([
 *     ['sort', 'name'],
 *     ['sort', 'price']
 *   ]);
 *
 * you can do:
 *
 *   let searchParams = createSearchParams({
 *     sort: ['name', 'price']
 *   });
 */
export function createSearchParams(
  init: URLSearchParamsInit = ""
): URLSearchParams {
  return new URLSearchParams(
    typeof init === "string" ||
    Array.isArray(init) ||
    init instanceof URLSearchParams
      ? init
      : Object.keys(init).reduce((memo, key) => {
          let value = init[key];
          return memo.concat(
            Array.isArray(value) ? value.map((v) => [key, v]) : [[key, value]]
          );
        }, [] as ParamKeyValuePair[])
  );
}
