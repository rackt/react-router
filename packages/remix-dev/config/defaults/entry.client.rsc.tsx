import { HydratedRouter } from "react-router";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
// @ts-expect-error - no types
import ReactServerDOM from "react-server-dom-diy/client";

if (import.meta.env.PROD) {
  window.__diy_client_manifest__ = {
    _cache: new Map(),
    resolveClientReference([id, exportName]) {
      return {
        preloadModule() {
          if (window.__diy_client_manifest__._cache.has(id)) {
            return window.__diy_client_manifest__._cache.get(id);
          }
          const promise = import("virtual:react-router/client-references")
            .then(({ default: mods }) => mods[id]())
            .then((mod) => {
              promise.status = "fulfilled";
              promise.value = mod;
            })
            .catch((res) => {
              promise.status = "rejected";
              promise.reason = res;
              throw res;
            });
          promise.status = "pending";
          window.__diy_client_manifest__._cache.set(id, promise);
          return promise;
        },
        requireModule() {
          const cached = window.__diy_client_manifest__._cache.get(id);
          if (!cached) throw new Error(`Module ${id} not found`);
          if (cached.reason) throw cached.reason;
          return cached.value[exportName];
        },
      };
    },
  };
} else {
  window.__diy_client_manifest__ = {
    _cache: new Map(),
    resolveClientReference([id, exportName]) {
      return {
        preloadModule() {
          if (window.__diy_client_manifest__._cache.has(id)) {
            return window.__diy_client_manifest__._cache.get(id);
          }
          const promise = import(id)
            .then((mod) => {
              promise.status = "fulfilled";
              promise.value = mod;
            })
            .catch((res) => {
              promise.status = "rejected";
              promise.reason = res;
              throw res;
            });
          promise.status = "pending";
          window.__diy_client_manifest__._cache.set(id, promise);
          return promise;
        },
        requireModule() {
          const cached = window.__diy_client_manifest__._cache.get(id);
          if (!cached) throw new Error(`Module ${id} not found`);
          if (cached.reason) throw cached.reason;
          return cached.value[exportName];
        },
      };
    },
  };
}

window.__diy_client_manifest__.callServer = async (id, args) => {
  const href = window.location.href;
  const headers = new Headers({
    Accept: "text/x-component",
    "rsc-action": id,
  });
  const responsePromise = fetch(href, {
    method: "POST",
    headers,
    body: await ReactServerDOM.encodeReply(args),
  });

  const result = await ReactServerDOM.createFromFetch(
    responsePromise,
    window.__diy_client_manifest__
  );

  window.__remixRouter.revalidate();

  return result;
};

window.createFromReadableStream = function createFromReadableStream(
  body: ReadableStream<Uint8Array>
) {
  return ReactServerDOM.createFromReadableStream(
    body,
    window.__diy_client_manifest__
  );
};

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});

if (import.meta.hot) {
  console.log("ACCEPTING HMR");
  import.meta.hot.on("react-router:hmr", () => {
    window.__remixRouter.revalidate();
  });
}
