import type {
  ActionFunction,
  ActionFunctionArgs,
  Blocker,
  BlockerFunction,
  unstable_DataStrategyFunction,
  unstable_DataStrategyFunctionArgs,
  unstable_DataStrategyMatch,
  ErrorResponse,
  Fetcher,
  JsonFunction,
  LazyRouteFunction,
  LoaderFunction,
  LoaderFunctionArgs,
  Location,
  Navigation,
  NavigationStates,
  ParamParseKey,
  Params,
  Path,
  PathMatch,
  PathParam,
  PathPattern,
  RedirectFunction,
  RelativeRoutingType,
  ShouldRevalidateFunction,
  ShouldRevalidateFunctionArgs,
  To,
  UIMatch,
  unstable_HandlerResult,
} from "./lib/router";
import {
  AbortedDeferredError,
  Action as NavigationType,
  createPath,
  defer,
  generatePath,
  isRouteErrorResponse,
  json,
  matchPath,
  matchRoutes,
  parsePath,
  redirect,
  redirectDocument,
  resolvePath,
  UNSAFE_ErrorResponseImpl,
} from "./lib/router";

import type {
  AwaitProps,
  FutureConfig,
  IndexRouteProps,
  LayoutRouteProps,
  MemoryRouterProps,
  NavigateProps,
  OutletProps,
  PathRouteProps,
  RouteProps,
  RouterProps,
  RoutesProps,
} from "./lib/components";
import {
  Await,
  MemoryRouter,
  Navigate,
  Outlet,
  Route,
  Router,
  Routes,
  createRoutesFromChildren,
  renderMatches,
  createMemoryRouter,
  mapRouteProperties,
} from "./lib/components";
import type {
  DataRouteMatch,
  DataRouteObject,
  IndexRouteObject,
  NavigateOptions,
  Navigator,
  NonIndexRouteObject,
  RouteMatch,
  RouteObject,
} from "./lib/context";
import {
  DataRouterContext,
  DataRouterStateContext,
  LocationContext,
  NavigationContext,
  RouteContext,
} from "./lib/context";
import type { NavigateFunction } from "./lib/hooks";
import {
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
  useRouteId,
  useRouteLoaderData,
  useRoutes,
  useRoutesImpl,
} from "./lib/hooks";

// Exported for backwards compatibility, but not being used internally anymore
type Hash = string;
type Pathname = string;
type Search = string;

// Expose react-router public API
export type {
  ActionFunction,
  ActionFunctionArgs,
  AwaitProps,
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
  LayoutRouteProps,
  LazyRouteFunction,
  LoaderFunction,
  LoaderFunctionArgs,
  Location,
  MemoryRouterProps,
  NavigateFunction,
  NavigateOptions,
  NavigateProps,
  Navigation,
  NavigationStates,
  Navigator,
  NonIndexRouteObject,
  OutletProps,
  ParamParseKey,
  Params,
  Path,
  PathMatch,
  PathParam,
  PathPattern,
  PathRouteProps,
  Pathname,
  RedirectFunction,
  RelativeRoutingType,
  RouteMatch,
  RouteObject,
  RouteProps,
  RouterProps,
  RoutesProps,
  Search,
  ShouldRevalidateFunction,
  ShouldRevalidateFunctionArgs,
  To,
  UIMatch,
  Blocker,
  BlockerFunction,
  unstable_HandlerResult,
};
export {
  AbortedDeferredError,
  Await,
  MemoryRouter,
  Navigate,
  NavigationType,
  Outlet,
  Route,
  Router,
  Routes,
  createMemoryRouter,
  createPath,
  createRoutesFromChildren,
  createRoutesFromChildren as createRoutesFromElements,
  defer,
  generatePath,
  isRouteErrorResponse,
  json,
  matchPath,
  matchRoutes,
  parsePath,
  redirect,
  redirectDocument,
  renderMatches,
  resolvePath,
  useBlocker,
  useActionData,
  useAsyncError,
  useAsyncValue,
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
};

// Expose old @remix-run/router API
export type {
  // TODO: Stop exporting agnostic stuff in v7?
  AgnosticDataIndexRouteObject,
  AgnosticDataNonIndexRouteObject,
  AgnosticDataRouteMatch,
  AgnosticDataRouteObject,
  AgnosticIndexRouteObject,
  AgnosticNonIndexRouteObject,
  AgnosticRouteMatch,
  AgnosticRouteObject,
  HydrationState,
  InitialEntry,
  LowerCaseFormMethod,
  StaticHandler,
  TrackedPromise,
  FetcherStates,
  UpperCaseFormMethod,
  UNSAFE_DeferredData,
} from "./lib/router";
export {
  getStaticContextFromError,
  stripBasename,
  UNSAFE_DEFERRED_SYMBOL,
  UNSAFE_convertRoutesToDataRoutes,
} from "./lib/router";

// Expose old RR DOM API
export type {
  FormEncType,
  FormMethod,
  GetScrollRestorationKeyFunction,
  StaticHandlerContext,
  Submission,
  V7_FormMethod,
} from "./lib/router";

export type {
  BrowserRouterProps,
  HashRouterProps,
  HistoryRouterProps,
  LinkProps,
  NavLinkProps,
  NavLinkRenderProps,
  FetcherFormProps,
  FormProps,
  ScrollRestorationProps,
  SetURLSearchParams,
  SubmitFunction,
  FetcherSubmitFunction,
  FetcherWithComponents,
  RouterProviderProps,
} from "./lib/dom/lib";
export {
  createBrowserRouter,
  createHashRouter,
  BrowserRouter,
  HashRouter,
  Link,
  // TODO: Collapse RouterProvider implementations
  // RouterProvider,
  UNSAFE_ViewTransitionContext,
  UNSAFE_FetchersContext,
  unstable_HistoryRouter,
  NavLink,
  Form,
  RouterProvider,
  ScrollRestoration,
  useLinkClickHandler,
  useSearchParams,
  useSubmit,
  useFormAction,
  useFetcher,
  useFetchers,
  UNSAFE_useScrollRestoration,
  useBeforeUnload,
  unstable_usePrompt,
  unstable_useViewTransitionState,
} from "./lib/dom/lib";
export type {
  ParamKeyValuePair,
  SubmitOptions,
  URLSearchParamsInit,
  SubmitTarget,
} from "./lib/dom/dom";
export { createSearchParams } from "./lib/dom/dom";
export type {
  StaticRouterProps,
  StaticRouterProviderProps,
} from "./lib/dom/server";
export {
  createStaticHandler,
  createStaticRouter,
  StaticRouter,
  StaticRouterProvider,
} from "./lib/dom/server";
export { HydratedRouter } from "./lib/dom/ssr/browser";
export {
  Meta,
  Links,
  Scripts,
  PrefetchPageLinks,
} from "./lib/dom/ssr/components";
export type { ScriptsProps } from "./lib/dom/ssr/components";
export type {
  HtmlLinkDescriptor,
  LinkDescriptor,
  PrefetchPageDescriptor,
} from "./lib/dom/ssr/links";
export type {
  ClientActionFunction,
  ClientActionFunctionArgs,
  ClientLoaderFunction,
  ClientLoaderFunctionArgs,
  MetaArgs,
  MetaDescriptor,
  MetaFunction,
  LinksFunction,
} from "./lib/dom/ssr/routeModules";
export type { ServerRouterProps } from "./lib/dom/ssr/server";
export { ServerRouter } from "./lib/dom/ssr/server";
export type { RoutesTestStubProps } from "./lib/dom/ssr/routes-test-stub";
export { createRoutesStub } from "./lib/dom/ssr/routes-test-stub";
export {
  defineRoute,
  type Match,
  type MetaMatch,
} from "./lib/router/define-route";

// Expose old @remix-run/server-runtime API, minus duplicate APIs
export { createCookieFactory, isCookie } from "./lib/server-runtime/cookies";
export {
  composeUploadHandlers as unstable_composeUploadHandlers,
  parseMultipartFormData as unstable_parseMultipartFormData,
} from "./lib/server-runtime/formData";
// TODO: (v7) Clean up code paths for these exports
// export {
//   defer,
//   json,
//   redirect,
//   redirectDocument,
// } from "./lib/server-runtime/responses";
export { createRequestHandler } from "./lib/server-runtime/server";
export {
  createSession,
  createSessionStorageFactory,
  isSession,
} from "./lib/server-runtime/sessions";
export { createCookieSessionStorageFactory } from "./lib/server-runtime/sessions/cookieStorage";
export { createMemorySessionStorageFactory } from "./lib/server-runtime/sessions/memoryStorage";
export { createMemoryUploadHandler as unstable_createMemoryUploadHandler } from "./lib/server-runtime/upload/memoryUploadHandler";
export { MaxPartSizeExceededError } from "./lib/server-runtime/upload/errors";
export { setDevServerHooks as unstable_setDevServerHooks } from "./lib/server-runtime/dev";

export type {
  // TODO: (v7) Clean up code paths for these exports
  // JsonFunction,
  // RedirectFunction,
  CreateCookieFunction,
  CreateCookieSessionStorageFunction,
  CreateMemorySessionStorageFunction,
  CreateRequestHandlerFunction,
  CreateSessionFunction,
  CreateSessionStorageFunction,
  IsCookieFunction,
  IsSessionFunction,
} from "./lib/server-runtime/interface";

export type {
  // TODO: (v7) Clean up code paths for these exports
  // ActionFunction,
  // ActionFunctionArgs,
  // ErrorResponse,
  // HtmlLinkDescriptor,
  // LinkDescriptor,
  // LinksFunction,
  // LoaderFunction,
  // LoaderFunctionArgs,
  // ServerRuntimeMetaArgs,
  // ServerRuntimeMetaDescriptor,
  // ServerRuntimeMetaFunction,
  AppLoadContext,
  Cookie,
  CookieOptions,
  CookieParseOptions,
  CookieSerializeOptions,
  CookieSignatureOptions,
  DataFunctionArgs,
  EntryContext,
  FlashSessionData,
  HandleDataRequestFunction,
  HandleDocumentRequestFunction,
  HeadersArgs,
  HeadersFunction,
  MemoryUploadHandlerFilterArgs,
  MemoryUploadHandlerOptions,
  HandleErrorFunction,
  PageLinkDescriptor,
  RequestHandler,
  SerializeFrom,
  ServerBuild,
  ServerEntryModule,
  Session,
  SessionData,
  SessionIdStorageStrategy,
  SessionStorage,
  SignFunction,
  TypedDeferredData,
  TypedResponse,
  UnsignFunction,
  UploadHandler,
  UploadHandlerPart,
} from "./lib/server-runtime/reexport";

// Private exports for internal use
export { ServerMode as UNSAFE_ServerMode } from "./lib/server-runtime/mode";

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
  DataRouterContext as UNSAFE_DataRouterContext,
  DataRouterStateContext as UNSAFE_DataRouterStateContext,
  LocationContext as UNSAFE_LocationContext,
  NavigationContext as UNSAFE_NavigationContext,
  RouteContext as UNSAFE_RouteContext,
  mapRouteProperties as UNSAFE_mapRouteProperties,
  useRouteId as UNSAFE_useRouteId,
  useRoutesImpl as UNSAFE_useRoutesImpl,
  UNSAFE_ErrorResponseImpl,
};

/** @internal */
export { RemixContext as UNSAFE_RemixContext } from "./lib/dom/ssr/components";

/** @internal */
export type { RouteModules as UNSAFE_RouteModules } from "./lib/dom/ssr/routeModules";

/** @internal */
export type {
  FutureConfig as UNSAFE_FutureConfig,
  AssetsManifest as UNSAFE_AssetsManifest,
  RemixContextObject as UNSAFE_RemixContextObject,
} from "./lib/dom/ssr/entry";

/** @internal */
export type {
  EntryRoute as UNSAFE_EntryRoute,
  RouteManifest as UNSAFE_RouteManifest,
} from "./lib/dom/ssr/routes";

/** @internal */
export type {
  SingleFetchRedirectResult as UNSAFE_SingleFetchRedirectResult,
  SingleFetchResult as UNSAFE_SingleFetchResult,
  SingleFetchResults as UNSAFE_SingleFetchResults,
} from "./lib/dom/ssr/single-fetch";
export {
  decodeViaTurboStream as UNSAFE_decodeViaTurboStream,
  SingleFetchRedirectSymbol as UNSAFE_SingleFetchRedirectSymbol,
} from "./lib/dom/ssr/single-fetch";
