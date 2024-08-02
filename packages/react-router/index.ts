// Expose old @remix-run/router API
export type { InitialEntry, Location, Path, To } from "./lib/router/history";
export type {
  HydrationState,
  StaticHandler,
  GetScrollPositionFunction,
  GetScrollRestorationKeyFunction,
  StaticHandlerContext,
  Fetcher,
  Navigation,
  NavigationStates,
  RelativeRoutingType,
  Blocker,
  BlockerFunction,
  Router as RemixRouter,
  RouterState,
  RouterInit,
  RouterSubscriber,
  RouterNavigateOptions,
  RouterFetchOptions,
  RevalidationState,
} from "./lib/router/router";
export type {
  ActionFunction,
  ActionFunctionArgs,
  DataStrategyFunction as unstable_DataStrategyFunction,
  DataStrategyFunctionArgs as unstable_DataStrategyFunctionArgs,
  DataStrategyMatch as unstable_DataStrategyMatch,
  DataWithResponseInit as UNSAFE_DataWithResponseInit,
  ErrorResponse,
  FormEncType,
  FormMethod,
  HandlerResult as unstable_HandlerResult,
  HTMLFormMethod,
  JsonFunction,
  LazyRouteFunction,
  LoaderFunction,
  LoaderFunctionArgs,
  ParamParseKey,
  Params,
  PathMatch,
  PathParam,
  PathPattern,
  RedirectFunction,
  ShouldRevalidateFunction,
  ShouldRevalidateFunctionArgs,
  UIMatch,
} from "./lib/router/utils";

export {
  Action as NavigationType,
  createPath,
  parsePath,
} from "./lib/router/history";
export {
  IDLE_NAVIGATION,
  IDLE_FETCHER,
  IDLE_BLOCKER,
} from "./lib/router/router";
export {
  data as unstable_data,
  generatePath,
  isRouteErrorResponse,
  json,
  matchPath,
  matchRoutes,
  redirect,
  redirectDocument,
  replace,
  resolvePath,
} from "./lib/router/utils";

// Expose react-router public API
export type {
  DataRouteMatch,
  DataRouteObject,
  IndexRouteObject,
  NavigateOptions,
  Navigator,
  NonIndexRouteObject,
  RouteMatch,
  RouteObject,
} from "./lib/context";
export type {
  AwaitProps,
  IndexRouteProps,
  LayoutRouteProps,
  MemoryRouterProps,
  NavigateProps,
  OutletProps,
  PathRouteProps,
  RouteProps,
  RouterProps,
  RouterProviderProps,
  RoutesProps,
  PatchRoutesOnMissFunction as unstable_PatchRoutesOnMissFunction,
} from "./lib/components";
export type { NavigateFunction } from "./lib/hooks";
export {
  Await,
  MemoryRouter,
  Navigate,
  Outlet,
  Route,
  Router,
  RouterProvider,
  Routes,
  createMemoryRouter,
  createRoutesFromChildren,
  createRoutesFromChildren as createRoutesFromElements,
  renderMatches,
} from "./lib/components";
export {
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
} from "./lib/hooks";

// Expose old RR DOM API
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
} from "./lib/dom/lib";
export {
  createBrowserRouter,
  createHashRouter,
  BrowserRouter,
  HashRouter,
  Link,
  HistoryRouter as unstable_HistoryRouter,
  NavLink,
  Form,
  ScrollRestoration,
  useLinkClickHandler,
  useSearchParams,
  useSubmit,
  useFormAction,
  useFetcher,
  useFetchers,
  useBeforeUnload,
  usePrompt as unstable_usePrompt,
  useViewTransitionState as unstable_useViewTransitionState,
} from "./lib/dom/lib";
export type {
  FetcherSubmitOptions,
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
export {
  Meta,
  Links,
  Scripts,
  PrefetchPageLinks,
} from "./lib/dom/ssr/components";
export type { ScriptsProps } from "./lib/dom/ssr/components";
export type { EntryContext } from "./lib/dom/ssr/entry";
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

// Expose old @remix-run/server-runtime API, minus duplicate APIs
export { createCookieFactory, isCookie } from "./lib/server-runtime/cookies";
export {
  composeUploadHandlers as unstable_composeUploadHandlers,
  parseMultipartFormData as unstable_parseMultipartFormData,
} from "./lib/server-runtime/formData";
// TODO: (v7) Clean up code paths for these exports
// export {
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
  CreateCookieFunction,
  IsCookieFunction,
} from "./lib/server-runtime/cookies";
// TODO: (v7) Clean up code paths for these exports
// export type {
//   JsonFunction,
//   RedirectFunction,
// } from "./lib/server-runtime/responses";
export type { CreateRequestHandlerFunction } from "./lib/server-runtime/server";
export type {
  CreateSessionFunction,
  CreateSessionStorageFunction,
  IsSessionFunction,
} from "./lib/server-runtime/sessions";
export type { CreateCookieSessionStorageFunction } from "./lib/server-runtime/sessions/cookieStorage";
export type { CreateMemorySessionStorageFunction } from "./lib/server-runtime/sessions/memoryStorage";

export type {
  HandleDataRequestFunction,
  HandleDocumentRequestFunction,
  HandleErrorFunction,
  ServerBuild,
  ServerEntryModule,
} from "./lib/server-runtime/build";

export type {
  UploadHandlerPart,
  UploadHandler,
} from "./lib/server-runtime/formData";
export type {
  MemoryUploadHandlerOptions,
  MemoryUploadHandlerFilterArgs,
} from "./lib/server-runtime/upload/memoryUploadHandler";

export type {
  Cookie,
  CookieOptions,
  CookieParseOptions,
  CookieSerializeOptions,
  CookieSignatureOptions,
} from "./lib/server-runtime/cookies";

export type { SignFunction, UnsignFunction } from "./lib/server-runtime/crypto";

export type { AppLoadContext } from "./lib/server-runtime/data";

export type {
  // TODO: (v7) Clean up code paths for these exports
  // HtmlLinkDescriptor,
  // LinkDescriptor,
  PageLinkDescriptor,
} from "./lib/server-runtime/links";

export type { TypedResponse } from "./lib/server-runtime/responses";

export type {
  // TODO: (v7) Clean up code paths for these exports
  // ActionFunction,
  // ActionFunctionArgs,
  // LinksFunction,
  // LoaderFunction,
  // LoaderFunctionArgs,
  // ServerRuntimeMetaArgs,
  // ServerRuntimeMetaDescriptor,
  // ServerRuntimeMetaFunction,
  DataFunctionArgs,
  HeadersArgs,
  HeadersFunction,
} from "./lib/server-runtime/routeModules";

export type { RequestHandler } from "./lib/server-runtime/server";

export type {
  Session,
  SessionData,
  SessionIdStorageStrategy,
  SessionStorage,
  FlashSessionData,
} from "./lib/server-runtime/sessions";

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
  createBrowserHistory as UNSAFE_createBrowserHistory,
  invariant as UNSAFE_invariant,
} from "./lib/router/history";

/** @internal */
export { createRouter as UNSAFE_createRouter } from "./lib/router/router";

/** @internal */
export { ErrorResponseImpl as UNSAFE_ErrorResponseImpl } from "./lib/router/utils";

/** @internal */
export {
  DataRouterContext as UNSAFE_DataRouterContext,
  DataRouterStateContext as UNSAFE_DataRouterStateContext,
  FetchersContext as UNSAFE_FetchersContext,
  LocationContext as UNSAFE_LocationContext,
  NavigationContext as UNSAFE_NavigationContext,
  RouteContext as UNSAFE_RouteContext,
  ViewTransitionContext as UNSAFE_ViewTransitionContext,
} from "./lib/context";

/** @internal */
export { mapRouteProperties as UNSAFE_mapRouteProperties } from "./lib/components";

/** @internal */
export { FrameworkContext as UNSAFE_FrameworkContext } from "./lib/dom/ssr/components";

/** @internal */
export type { AssetsManifest as UNSAFE_AssetsManifest } from "./lib/dom/ssr/entry";

/** @internal */
export { deserializeErrors as UNSAFE_deserializeErrors } from "./lib/dom/ssr/errors";

/** @internal */
export { RemixErrorBoundary as UNSAFE_RemixErrorBoundary } from "./lib/dom/ssr/errorBoundaries";

/** @internal */
export {
  initFogOfWar as UNSAFE_initFogOfWar,
  useFogOFWarDiscovery as UNSAFE_useFogOFWarDiscovery,
} from "./lib/dom/ssr/fog-of-war";

/** @internal */
export type { RouteModules as UNSAFE_RouteModules } from "./lib/dom/ssr/routeModules";

/** @internal */
export {
  createClientRoutes as UNSAFE_createClientRoutes,
  createClientRoutesWithHMRRevalidationOptOut as UNSAFE_createClientRoutesWithHMRRevalidationOptOut,
  shouldHydrateRouteLoader as UNSAFE_shouldHydrateRouteLoader,
} from "./lib/dom/ssr/routes";

/** @internal */
export { getSingleFetchDataStrategy as UNSAFE_getSingleFetchDataStrategy } from "./lib/dom/ssr/single-fetch";

/** @internal */
export {
  decodeViaTurboStream as UNSAFE_decodeViaTurboStream,
  SingleFetchRedirectSymbol as UNSAFE_SingleFetchRedirectSymbol,
} from "./lib/dom/ssr/single-fetch";

/** @internal */
export { ServerMode as UNSAFE_ServerMode } from "./lib/server-runtime/mode";

/** @internal */
export { useScrollRestoration as UNSAFE_useScrollRestoration } from "./lib/dom/lib";
