import {
  File as NodeFile,
  fetch as nodeFetch,
  FormData as NodeFormData,
  Headers as NodeHeaders,
  Request as NodeRequest,
  Response as NodeResponse,
} from "undici";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: "development" | "production" | "test";
    }

    interface Global {
      File: typeof File;

      Headers: typeof Headers;
      Request: typeof Request;
      Response: typeof Response;
      fetch: typeof fetch;
      FormData: typeof FormData;

      ReadableStream: typeof ReadableStream;
      WritableStream: typeof WritableStream;
    }
  }

  interface RequestInit {
    duplex?: "half";
  }

  var __diy_server_manifest__: {
    resolveClientReferenceMetadata(clientReference: {
      $$id: string;
    }): [string, string];
    resolveServerReference(id: string): {
      preloadModule(): Promise<void>;
      requireModule(): unknown;
    };
  };
  var __diy_client_manifest__: {
    _cache?: Map<string, unknown>;
    resolveClientReference([id, exportName]: [string, string]): {
      preloadModule(): Promise<void>;
      requireModule(): unknown;
    };
  };
}

export function installGlobals({
  clientReferences,
  clientViteDevServer,
  serverReferences,
  serverViteDevServer,
}: {
  clientReferences?: Record<string, () => Promise<unknown>>;
  clientViteDevServer?: unknown;
  serverReferences?: Record<string, () => Promise<unknown>>;
  serverViteDevServer?: unknown;
} = {}) {
  global.File = NodeFile as unknown as typeof File;

  // @ts-expect-error - overriding globals
  global.Headers = NodeHeaders;
  // @ts-expect-error - overriding globals
  global.Request = NodeRequest;
  // @ts-expect-error - overriding globals
  global.Response = NodeResponse;
  // @ts-expect-error - overriding globals
  global.fetch = nodeFetch;
  // @ts-expect-error - overriding globals
  global.FormData = NodeFormData;

  type CachedPromise<T> = Promise<T> & {
    status: "pending" | "fulfilled" | "rejected";
    value?: unknown;
    reason?: unknown;
  };
  let serverModulePromiseCache = new Map<string, CachedPromise<unknown>>();
  let clientModulePromiseCache = new Map<string, CachedPromise<unknown>>();

  if (clientViteDevServer) {
    global.__diy_client_manifest__ = {
      resolveClientReference([id, exportName]: [string, string]) {
        return {
          preloadModule() {
            if (clientModulePromiseCache.has(id)) {
              return clientModulePromiseCache.get(id) as CachedPromise<void>;
            }
            const promise =
              // eslint-disable-next-line @typescript-eslint/consistent-type-imports
              (clientViteDevServer as import("vite").ViteDevServer)
                .ssrLoadModule(id, { fixStacktrace: true })
                .then((mod) => {
                  promise.status = "fulfilled";
                  promise.value = mod;
                })
                .catch((res) => {
                  promise.status = "rejected";
                  promise.reason = res;
                  throw res;
                }) as CachedPromise<void>;
            promise.status = "pending";
            clientModulePromiseCache.set(id, promise);
            return promise;
          },
          requireModule() {
            const cached = clientModulePromiseCache.get(id);
            if (!cached) throw new Error(`Module ${id} not found`);
            if (cached.reason) throw cached.reason;
            return (cached.value as Record<string, unknown>)[exportName];
          },
        };
      },
    };
  } else if (clientReferences) {
    global.__diy_client_manifest__ = {
      resolveClientReference([id, exportName]) {
        return {
          preloadModule() {
            if (clientModulePromiseCache.has(id)) {
              return clientModulePromiseCache.get(id) as CachedPromise<void>;
            }
            const promise = clientReferences[id]()
              .then((mod) => {
                promise.status = "fulfilled";
                promise.value = mod;
              })
              .catch((res) => {
                promise.status = "rejected";
                promise.reason = res;
                throw res;
              }) as CachedPromise<void>;
            promise.status = "pending";
            clientModulePromiseCache.set(id, promise);
            return promise;
          },
          requireModule() {
            const cached = clientModulePromiseCache.get(id);
            if (!cached) throw new Error(`Module ${id} not found`);
            if (cached.reason) throw cached.reason;
            return (cached.value as Record<string, unknown>)[exportName];
          },
        };
      },
    };
  }

  if (serverViteDevServer) {
    global.__diy_server_manifest__ = {
      resolveClientReferenceMetadata(clientReference: { $$id: string }) {
        const id = clientReference.$$id;
        const idx = id.lastIndexOf("#");
        const exportName = id.slice(idx + 1);
        const fullURL = id.slice(0, idx);
        return [fullURL, exportName];
      },
      resolveServerReference(_id: string) {
        const idx = _id.lastIndexOf("#");
        const exportName = _id.slice(idx + 1);
        const id = _id.slice(0, idx);
        return {
          preloadModule() {
            if (serverModulePromiseCache.has(id)) {
              return serverModulePromiseCache.get(id) as CachedPromise<void>;
            }
            const promise = // eslint-disable-next-line @typescript-eslint/consistent-type-imports
              (clientViteDevServer as import("vite").ViteDevServer)
                .ssrLoadModule(id, { fixStacktrace: true })
                .then((mod) => {
                  promise.status = "fulfilled";
                  promise.value = mod;
                })
                .catch((res) => {
                  promise.status = "rejected";
                  promise.reason = res;
                  throw res;
                }) as CachedPromise<void>;
            promise.status = "pending";
            serverModulePromiseCache.set(id, promise);
            return promise;
          },
          requireModule() {
            const cached = serverModulePromiseCache.get(id);
            if (!cached) throw new Error(`Module ${id} not found`);
            if (cached.reason) throw cached.reason;
            return (cached.value as Record<string, unknown>)[exportName];
          },
        };
      },
    };
  } else if (serverReferences) {
    global.__diy_server_manifest__ = {
      resolveClientReferenceMetadata(clientReference) {
        const id = clientReference.$$id;
        const idx = id.lastIndexOf("#");
        const exportName = id.slice(idx + 1);
        const fullURL = id.slice(0, idx);
        return [fullURL, exportName];
      },
      resolveServerReference(_id) {
        const idx = _id.lastIndexOf("#");
        const exportName = _id.slice(idx + 1);
        const id = _id.slice(0, idx);
        return {
          preloadModule() {
            if (serverModulePromiseCache.has(id)) {
              return serverModulePromiseCache.get(id) as CachedPromise<void>;
            }
            const promise = /**
              @type {Promise<unknown> & {
                status: "pending" | "fulfilled" | "rejected";
                value?: unknown;
                reason?: unknown;
              }}
              */ serverReferences
              /** @type {keyof typeof serverReferences} */ [id]()
              .then((mod) => {
                promise.status = "fulfilled";
                promise.value = mod;
              })
              .catch((res) => {
                promise.status = "rejected";
                promise.reason = res;
                throw res;
              }) as CachedPromise<void>;
            promise.status = "pending";
            serverModulePromiseCache.set(id, promise);
            return promise;
          },
          requireModule() {
            const cached = serverModulePromiseCache.get(id);
            if (!cached) throw new Error(`Module ${id} not found`);
            if (cached.reason) throw cached.reason;
            return (cached.value as Record<string, unknown>)[exportName];
          },
        };
      },
    };
  }
}
