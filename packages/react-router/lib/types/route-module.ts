import type { MetaDescriptor } from "../dom/ssr/routeModules";
import type { LinkDescriptor } from "../router/links";
import type { AppLoadContext } from "../server-runtime/data";

import type { ClientDataFrom, ServerDataFrom } from "./route-data";
import type { Equal, Expect, Func, Pretty } from "./utils";

type IsDefined<T> = Equal<T, undefined> extends true ? false : true;

type RouteModule = {
  meta?: Func;
  links?: Func;
  headers?: Func;
  loader?: Func;
  clientLoader?: Func;
  action?: Func;
  clientAction?: Func;
  HydrateFallback?: unknown;
  default?: unknown;
  ErrorBoundary?: unknown;
  [key: string]: unknown; // allow user-defined exports
};

export type LinkDescriptors = LinkDescriptor[];

type RouteInfo = {
  parents: RouteInfo[];
  module: RouteModule;
  id: unknown;
  file: string;
  path: string;
  params: unknown;
  loaderData: unknown;
  actionData: unknown;
};

type MetaMatch<T extends RouteInfo> = Pretty<
  Pick<T, "id" | "params"> & {
    pathname: string;
    meta: MetaDescriptor[];
    data: T["loaderData"];
    handle?: unknown;
    error?: unknown;
  }
>;

// prettier-ignore
type MetaMatches<T extends RouteInfo[]> =
  T extends [infer F extends RouteInfo, ...infer R extends RouteInfo[]]
    ? [MetaMatch<F>, ...MetaMatches<R>]
    : Array<MetaMatch<RouteInfo> | undefined>;

export type CreateMetaArgs<T extends RouteInfo> = {
  location: Location;
  params: T["params"];
  data: T["loaderData"];
  error?: unknown;
  matches: MetaMatches<[...T["parents"], T]>;
};
export type MetaDescriptors = MetaDescriptor[];

export type HeadersArgs = {
  loaderHeaders: Headers;
  parentHeaders: Headers;
  actionHeaders: Headers;
  errorHeaders: Headers | undefined;
};

// prettier-ignore
type IsHydrate<ClientLoader> =
  ClientLoader extends { hydrate: true } ? true :
  ClientLoader extends { hydrate: false } ? false :
  false

export type CreateLoaderData<T extends RouteModule> = _CreateLoaderData<
  ServerDataFrom<T["loader"]>,
  ClientDataFrom<T["clientLoader"]>,
  IsHydrate<T["clientLoader"]>,
  T extends { HydrateFallback: Func } ? true : false
>;

// prettier-ignore
type _CreateLoaderData<
  ServerLoaderData,
  ClientLoaderData,
  ClientLoaderHydrate extends boolean,
  HasHydrateFallback
> =
  [HasHydrateFallback, ClientLoaderHydrate] extends [true, true] ?
    IsDefined<ClientLoaderData> extends true ? ClientLoaderData :
    undefined
  :
  [IsDefined<ClientLoaderData>, IsDefined<ServerLoaderData>] extends [true, true] ? ServerLoaderData | ClientLoaderData :
  IsDefined<ClientLoaderData> extends true ? ClientLoaderData :
  IsDefined<ServerLoaderData> extends true ? ServerLoaderData :
  undefined

export type CreateActionData<T extends RouteModule> = _CreateActionData<
  ServerDataFrom<T["action"]>,
  ClientDataFrom<T["clientAction"]>
>;

// prettier-ignore
type _CreateActionData<ServerActionData, ClientActionData> = Awaited<
  [IsDefined<ServerActionData>, IsDefined<ClientActionData>] extends [true, true] ? ServerActionData | ClientActionData :
  IsDefined<ClientActionData> extends true ? ClientActionData :
  IsDefined<ServerActionData> extends true ? ServerActionData :
  undefined
>

type ClientDataFunctionArgs<T extends RouteInfo> = {
  request: Request;
  params: T["params"];
};

type ServerDataFunctionArgs<T extends RouteInfo> = ClientDataFunctionArgs<T> & {
  context: AppLoadContext;
};

export type CreateServerLoaderArgs<T extends RouteInfo> =
  ServerDataFunctionArgs<T>;

export type CreateClientLoaderArgs<T extends RouteInfo> =
  ClientDataFunctionArgs<T> & {
    serverLoader: () => Promise<ServerDataFrom<T["module"]["loader"]>>;
  };

export type CreateServerActionArgs<T extends RouteInfo> =
  ServerDataFunctionArgs<T>;

export type CreateClientActionArgs<T extends RouteInfo> =
  ClientDataFunctionArgs<T> & {
    serverAction: () => Promise<ServerDataFrom<T["module"]["action"]>>;
  };

export type CreateHydrateFallbackProps<T extends RouteInfo> = {
  params: T["params"];
  loaderData?: T["loaderData"];
  actionData?: T["actionData"];
};

type Match<T extends RouteInfo> = Pretty<
  Pick<T, "id" | "params"> & {
    pathname: string;
    data: T["loaderData"];
    handle: unknown;
  }
>;

// prettier-ignore
type Matches<T extends RouteInfo[]> =
  T extends [infer F extends RouteInfo, ...infer R extends RouteInfo[]]
    ? [Match<F>, ...Matches<R>]
    : Array<Match<RouteInfo> | undefined>;

export type CreateComponentProps<T extends RouteInfo> = {
  params: T["params"];
  loaderData: T["loaderData"];
  actionData?: T["actionData"];
  matches: Matches<[...T["parents"], T]>;
};

export type CreateErrorBoundaryProps<T extends RouteInfo> = {
  params: T["params"];
  error: unknown;
  loaderData?: T["loaderData"];
  actionData?: T["actionData"];
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type __tests = [
  // LoaderData
  Expect<Equal<CreateLoaderData<{}>, undefined>>,
  Expect<
    Equal<
      CreateLoaderData<{
        loader: () => { a: string; b: Date; c: () => boolean };
      }>,
      { a: string; b: Date; c: undefined }
    >
  >,
  Expect<
    Equal<
      CreateLoaderData<{
        clientLoader: () => { a: string; b: Date; c: () => boolean };
      }>,
      { a: string; b: Date; c: () => boolean }
    >
  >,
  Expect<
    Equal<
      CreateLoaderData<{
        loader: () => { a: string; b: Date; c: () => boolean };
        clientLoader: () => { d: string; e: Date; f: () => boolean };
      }>,
      | { a: string; b: Date; c: undefined }
      | { d: string; e: Date; f: () => boolean }
    >
  >,
  Expect<
    Equal<
      CreateLoaderData<{
        loader: () => { a: string; b: Date; c: () => boolean };
        clientLoader: () => { d: string; e: Date; f: () => boolean };
        HydrateFallback: () => unknown;
      }>,
      | { a: string; b: Date; c: undefined }
      | { d: string; e: Date; f: () => boolean }
    >
  >,
  Expect<
    Equal<
      CreateLoaderData<{
        loader: () => { a: string; b: Date; c: () => boolean };
        clientLoader: (() => { d: string; e: Date; f: () => boolean }) & {
          hydrate: true;
        };
      }>,
      | { a: string; b: Date; c: undefined }
      | { d: string; e: Date; f: () => boolean }
    >
  >,
  Expect<
    Equal<
      CreateLoaderData<{
        loader: () => { a: string; b: Date; c: () => boolean };
        clientLoader: (() => { d: string; e: Date; f: () => boolean }) & {
          hydrate: true;
        };
        HydrateFallback: () => unknown;
      }>,
      { d: string; e: Date; f: () => boolean }
    >
  >,

  // ActionData
  Expect<Equal<CreateActionData<{}>, undefined>>,
  Expect<
    Equal<
      CreateActionData<{
        action: () => { a: string; b: Date; c: () => boolean };
      }>,
      { a: string; b: Date; c: undefined }
    >
  >,
  Expect<
    Equal<
      CreateActionData<{
        clientAction: () => { a: string; b: Date; c: () => boolean };
      }>,
      { a: string; b: Date; c: () => boolean }
    >
  >,
  Expect<
    Equal<
      CreateActionData<{
        action: () => { a: string; b: Date; c: () => boolean };
        clientAction: () => { d: string; e: Date; f: () => boolean };
      }>,
      | { a: string; b: Date; c: undefined }
      | { d: string; e: Date; f: () => boolean }
    >
  >
];
