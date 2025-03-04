import type {
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from "../dom/ssr/routeModules";
import type { DataWithResponseInit } from "../router/utils";
import type { Serializable } from "../server-runtime/single-fetch";
import type { unstable_SerializesTo } from "./serializes-to";
import type { Equal, Expect, Func, IsAny, Pretty } from "./utils";

// prettier-ignore
type Serialize<T> =
  // If type has a `SerializesTo` brand, use that type
  T extends unstable_SerializesTo<infer To> ? To :

  // Then, let type stay as-is if its already serializable...
  T extends Serializable ? T :

  // ...then don't allow functions to be serialized...
  T extends (...args: any[]) => unknown ? undefined :

  // ...lastly handle inner types for all container types allowed by `turbo-stream`

  // Promise
  T extends Promise<infer U> ? Promise<Serialize<U>> :

  // Map & Set
  T extends Map<infer K, infer V> ? Map<Serialize<K>, Serialize<V>> :
  T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<Serialize<K>, Serialize<V>> :
  T extends Set<infer U> ? Set<Serialize<U>> :
  T extends ReadonlySet<infer U> ? ReadonlySet<Serialize<U>> :

  // Array
  T extends [] ? [] :
  T extends readonly [infer F, ...infer R] ? [Serialize<F>, ...Serialize<R>] :
  T extends Array<infer U> ? Array<Serialize<U>> :
  T extends readonly unknown[] ? readonly Serialize<T[number]>[] :

  // Record
  T extends Record<any, any> ? {[K in keyof T]: Serialize<T[K]>} :

  undefined

type VoidToUndefined<T> = Equal<T, void> extends true ? undefined : T;

// prettier-ignore
type DataFrom<T> =
  IsAny<T> extends true ? undefined :
  T extends Func ? VoidToUndefined<Awaited<ReturnType<T>>> :
  undefined

// prettier-ignore
type ClientData<T> =
  T extends Response ? never :
  T extends DataWithResponseInit<infer U> ? U :
  T

// prettier-ignore
type ServerData<T> =
  T extends Response ? never :
  T extends DataWithResponseInit<infer U> ? Serialize<U> :
  Serialize<T>

export type ServerDataFrom<T> = ServerData<DataFrom<T>>;
export type ClientDataFrom<T> = ClientData<DataFrom<T>>;

export type SerializeFrom<T> = T extends (...args: infer Args) => unknown
  ? Args extends [ClientLoaderFunctionArgs | ClientActionFunctionArgs]
    ? ClientDataFrom<T>
    : ServerDataFrom<T>
  : T;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type __tests = [
  // ServerDataFrom
  Expect<Equal<ServerDataFrom<any>, undefined>>,
  Expect<
    Equal<
      ServerDataFrom<
        () => {
          a: string;
          b: Date;
          c: () => boolean;
          d: unstable_SerializesTo<number>;
        }
      >,
      { a: string; b: Date; c: undefined; d: number }
    >
  >,
  Expect<
    Equal<
      Pretty<
        ServerDataFrom<
          () =>
            | {
                json: string;
                b: Date;
                c: () => boolean;
                d: unstable_SerializesTo<number>;
              }
            | DataWithResponseInit<{
                data: string;
                b: Date;
                c: () => boolean;
                d: unstable_SerializesTo<number>;
              }>
        >
      >,
      | { json: string; b: Date; c: undefined; d: number }
      | { data: string; b: Date; c: undefined; d: number }
    >
  >,
  Expect<Equal<ServerDataFrom<() => { a: string } | Response>, { a: string }>>,
  Expect<
    Equal<
      ServerDataFrom<
        () => {
          map: Map<string, number>;
          readonlyMap: ReadonlyMap<string, number>;
        }
      >,
      { map: Map<string, number>; readonlyMap: ReadonlyMap<string, number> }
    >
  >,
  Expect<
    Equal<
      ServerDataFrom<
        () => { set: Set<string>; readonlySet: ReadonlySet<string> }
      >,
      { set: Set<string>; readonlySet: ReadonlySet<string> }
    >
  >,

  // ClientDataFrom
  Expect<Equal<ClientDataFrom<any>, undefined>>,
  Expect<
    Equal<
      ClientDataFrom<() => { a: string; b: Date; c: () => boolean }>,
      { a: string; b: Date; c: () => boolean }
    >
  >,
  Expect<
    Equal<
      Pretty<
        ClientDataFrom<
          () =>
            | { json: string; b: Date; c: () => boolean }
            | DataWithResponseInit<{ data: string; b: Date; c: () => boolean }>
        >
      >,
      | { json: string; b: Date; c: () => boolean }
      | { data: string; b: Date; c: () => boolean }
    >
  >,
  Expect<Equal<ClientDataFrom<() => { a: string } | Response>, { a: string }>>
];
