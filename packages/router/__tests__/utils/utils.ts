import type { AgnosticDataRouteObject } from "../../utils";

export async function sleep(n: number) {
  await new Promise((r) => setTimeout(r, n));
}

export async function tick() {
  await sleep(0);
}

export function invariant(value: boolean, message?: string): asserts value;
export function invariant<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T;
export function invariant(value: any, message?: string) {
  if (value === false || value === null || typeof value === "undefined") {
    console.warn("Test invariant failed:", message);
    throw new Error(message);
  }
}

export function createFormData(obj: Record<string, string>): FormData {
  let formData = new FormData();
  Object.entries(obj).forEach((e) => formData.append(e[0], e[1]));
  return formData;
}

export function isRedirect(result: any) {
  return (
    result instanceof Response && result.status >= 300 && result.status <= 399
  );
}

export function createDeferred<T = unknown>() {
  let resolve: (val?: any) => Promise<void>;
  let reject: (error?: Error) => Promise<void>;
  let promise = new Promise<T>((res, rej) => {
    resolve = async (val: T) => {
      res(val);
      try {
        await promise;
      } catch (e) {}
    };
    reject = async (error?: Error) => {
      rej(error);
      try {
        await promise;
      } catch (e) {}
    };
  });
  return {
    promise,
    //@ts-ignore
    resolve,
    //@ts-ignore
    reject,
  };
}

export function findRouteById(
  routes: AgnosticDataRouteObject[],
  id: string
): AgnosticDataRouteObject {
  let foundRoute: AgnosticDataRouteObject | null = null;
  for (const route of routes) {
    if (route.id === id) {
      foundRoute = route;
      break;
    }
    if (route.children) {
      foundRoute = findRouteById(route.children, id);
      if (foundRoute) {
        break;
      }
    }
  }

  invariant(foundRoute, `Route not found with id "${id}".`);

  return foundRoute;
}

export function createRequest(path: string, opts?: RequestInit) {
  return new Request(`http://localhost${path}`, opts);
}

export function createSubmitRequest(path: string, opts?: RequestInit) {
  let searchParams = new URLSearchParams();
  searchParams.append("key", "value");

  return createRequest(path, {
    method: "post",
    body: searchParams,
    ...opts,
  });
}

// See https://www.totaltypescript.com/how-to-test-your-types
export type Expect<T extends true> = T;
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <
  T
>() => T extends Y ? 1 : 2
  ? true
  : false;
