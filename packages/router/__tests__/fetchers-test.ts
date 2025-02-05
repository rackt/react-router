/* eslint-disable jest/valid-title */
import type { FutureConfig, HydrationState } from "../index";
import {
  createMemoryHistory,
  createRouter,
  IDLE_FETCHER,
  IDLE_NAVIGATION,
} from "../index";

// Private API
import { ErrorResponseImpl } from "../utils";

import {
  cleanup,
  createDeferred,
  setup,
  TASK_ROUTES,
} from "./utils/data-router-setup";
import { createFormData, sleep, tick } from "./utils/utils";

function initializeTest(init?: {
  url?: string;
  hydrationData?: HydrationState;
  future?: Partial<FutureConfig>;
}) {
  return setup({
    routes: [
      {
        path: "",
        id: "root",
        hasErrorBoundary: true,
        loader: true,
        children: [
          {
            path: "/",
            id: "index",
            loader: true,
            action: true,
          },
          {
            path: "/foo",
            id: "foo",
            loader: true,
            action: true,
          },
          {
            path: "/foo/bar",
            id: "foobar",
            loader: true,
            action: true,
          },
          {
            path: "/bar",
            id: "bar",
            loader: true,
            action: true,
          },
          {
            path: "/baz",
            id: "baz",
            loader: true,
            action: true,
          },
        ],
      },
    ],
    hydrationData: init?.hydrationData || {
      loaderData: { root: "ROOT", index: "INDEX" },
    },
    future: init?.future,
    ...(init?.url ? { initialEntries: [init.url] } : {}),
  });
}

describe("fetchers", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  // Detect any failures inside the router navigate code
  afterEach(() => {
    cleanup();

    // @ts-ignore
    console.warn.mockReset();
  });

  describe("fetcher states", () => {
    it("unabstracted loader fetch", async () => {
      let dfd = createDeferred();
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/"] }),
        routes: [
          {
            id: "root",
            path: "/",
            loader: () => dfd.promise,
          },
        ],
        hydrationData: {
          loaderData: { root: "ROOT DATA" },
        },
      });

      let key = "key";
      router.fetch(key, "root", "/");
      expect(router.state.fetchers.get(key)).toEqual({
        state: "loading",
        formMethod: undefined,
        formEncType: undefined,
        formData: undefined,
        data: undefined,
      });

      await dfd.resolve("DATA");
      expect(router.state.fetchers.get(key)).toEqual({
        state: "idle",
        formMethod: undefined,
        formEncType: undefined,
        formData: undefined,
        data: "DATA",
      });

      expect(router._internalFetchControllers.size).toBe(0);
    });

    it("loader fetch", async () => {
      let t = initializeTest({
        url: "/foo",
        hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
      });

      let A = await t.fetch("/foo");
      expect(A.fetcher.state).toBe("loading");

      await A.loaders.foo.resolve("A DATA");
      expect(A.fetcher.state).toBe("idle");
      expect(A.fetcher.data).toBe("A DATA");
    });

    it("loader re-fetch", async () => {
      let t = initializeTest({
        url: "/foo",
        hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
      });
      let key = "key";

      let A = await t.fetch("/foo", key);
      await A.loaders.foo.resolve("A DATA");
      expect(A.fetcher.state).toBe("idle");
      expect(A.fetcher.data).toBe("A DATA");

      let B = await t.fetch("/foo", key);
      expect(B.fetcher.state).toBe("loading");
      expect(B.fetcher.data).toBe("A DATA");

      await B.loaders.foo.resolve("B DATA");
      expect(B.fetcher.state).toBe("idle");
      expect(B.fetcher.data).toBe("B DATA");

      expect(A.fetcher).toBe(B.fetcher);
    });

    it("loader submission fetch", async () => {
      let t = initializeTest({
        url: "/foo",
        hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
      });

      let A = await t.fetch("/foo", {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });
      expect(A.fetcher.state).toBe("loading");
      expect(A.fetcher.formMethod).toBe("get");
      expect(A.fetcher.formAction).toBe("/foo");
      expect(A.fetcher.formData).toEqual(createFormData({ key: "value" }));
      expect(A.fetcher.formEncType).toBe("application/x-www-form-urlencoded");
      expect(
        new URL(
          A.loaders.foo.stub.mock.calls[0][0].request.url
        ).searchParams.toString()
      ).toBe("key=value");

      await A.loaders.foo.resolve("A DATA");
      expect(A.fetcher.state).toBe("idle");
      expect(A.fetcher.data).toBe("A DATA");
    });

    it("loader submission re-fetch", async () => {
      let t = initializeTest({
        url: "/foo",
        hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
      });
      let key = "key";

      let A = await t.fetch("/foo", key, {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });
      expect(A.fetcher.state).toBe("loading");
      await A.loaders.foo.resolve("A DATA");
      expect(A.fetcher.state).toBe("idle");
      expect(A.fetcher.data).toBe("A DATA");

      let B = await t.fetch("/foo", key, {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });
      expect(B.fetcher.state).toBe("loading");
      expect(B.fetcher.data).toBe("A DATA");

      await B.loaders.foo.resolve("B DATA");
      expect(A.fetcher.state).toBe("idle");
      expect(A.fetcher.data).toBe("B DATA");
    });

    it("action fetch", async () => {
      let t = initializeTest({
        url: "/foo",
        hydrationData: {
          loaderData: { root: "ROOT", foo: "FOO" },
        },
      });

      let A = await t.fetch("/foo", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(A.fetcher.state).toBe("submitting");

      await A.actions.foo.resolve("A ACTION");
      expect(A.fetcher.state).toBe("loading");
      expect(A.fetcher.data).toBe("A ACTION");

      await A.loaders.root.resolve("ROOT DATA");
      expect(A.fetcher.state).toBe("loading");
      expect(A.fetcher.data).toBe("A ACTION");

      await A.loaders.foo.resolve("A DATA");
      expect(A.fetcher.state).toBe("idle");
      expect(A.fetcher.data).toBe("A ACTION");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT DATA",
        foo: "A DATA",
      });
    });

    it("action re-fetch", async () => {
      let t = initializeTest({
        url: "/foo",
        hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
      });
      let key = "key";

      let A = await t.fetch("/foo", key, {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(A.fetcher.state).toBe("submitting");

      await A.actions.foo.resolve("A ACTION");
      expect(A.fetcher.state).toBe("loading");
      expect(A.fetcher.data).toBe("A ACTION");

      await A.loaders.root.resolve("ROOT DATA");
      await A.loaders.foo.resolve("A DATA");
      expect(A.fetcher.state).toBe("idle");
      expect(A.fetcher.data).toBe("A ACTION");

      let B = await t.fetch("/foo", key, {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(B.fetcher.state).toBe("submitting");
      expect(B.fetcher.data).toBe("A ACTION");

      await B.actions.foo.resolve("B ACTION");
      await B.loaders.root.resolve("ROOT DATA*");
      await B.loaders.foo.resolve("A DATA*");
      expect(B.fetcher.state).toBe("idle");
      expect(B.fetcher.data).toBe("B ACTION");
    });
  });

  describe("fetcher removal", () => {
    it("gives an idle fetcher before submission", async () => {
      let t = initializeTest();
      let fetcher = t.router.getFetcher("randomKey");
      expect(fetcher).toBe(IDLE_FETCHER);
    });

    it("removes fetchers", async () => {
      let t = initializeTest();
      let A = await t.fetch("/foo");
      await A.loaders.foo.resolve("A");
      expect(t.router.getFetcher(A.key).data).toBe("A");

      t.router.deleteFetcher(A.key);
      expect(t.router.getFetcher(A.key)).toBe(IDLE_FETCHER);
    });

    it("cleans up abort controllers", async () => {
      let t = initializeTest();
      let A = await t.fetch("/foo");
      expect(t.router._internalFetchControllers.size).toBe(1);
      let B = await t.fetch("/bar");
      expect(t.router._internalFetchControllers.size).toBe(2);
      await A.loaders.foo.resolve(null);
      expect(t.router._internalFetchControllers.size).toBe(1);
      await B.loaders.bar.resolve(null);
      expect(t.router._internalFetchControllers.size).toBe(0);
    });

    it("uses current page matches and URL when reloading routes after submissions", async () => {
      let pagePathname = "/foo";
      let t = initializeTest({
        url: pagePathname,
        hydrationData: {
          loaderData: { root: "ROOT", foo: "FOO" },
        },
      });

      let A = await t.fetch("/bar", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await A.actions.bar.resolve("ACTION");
      await A.loaders.root.resolve("ROOT DATA");
      await A.loaders.foo.resolve("FOO DATA");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT DATA",
        foo: "FOO DATA",
      });
      expect(A.loaders.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: new Request("http://localhost/foo", {
          signal: A.loaders.root.stub.mock.calls[0][0].request.signal,
        }),
      });
    });
  });

  describe("fetcher removal (w/v7_fetcherPersist)", () => {
    it("loading fetchers persist until completion", async () => {
      let t = initializeTest({ future: { v7_fetcherPersist: true } });

      let key = "key";
      t.router.getFetcher(key); // mount
      expect(t.router.state.fetchers.size).toBe(0);

      let A = await t.fetch("/foo", key);
      expect(t.router.state.fetchers.size).toBe(1);
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      t.router.deleteFetcher(key); // unmount
      expect(t.router.state.fetchers.size).toBe(1);
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      // Cleaned up on completion
      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.fetchers.size).toBe(0);
    });

    it("fetchers removed from data layer upon unmount", async () => {
      let t = initializeTest({ future: { v7_fetcherPersist: true } });

      let subscriber = jest.fn();
      t.router.subscribe(subscriber);

      let key = "key";
      t.router.getFetcher(key); // mount
      expect(t.router.state.fetchers.size).toBe(0);

      let A = await t.fetch("/foo", key);
      expect(t.router.state.fetchers.size).toBe(1);
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");
      expect(subscriber.mock.calls.length).toBe(1);
      expect(subscriber.mock.calls[0][0].fetchers.get("key").state).toBe(
        "loading"
      );
      subscriber.mockReset();

      await A.loaders.foo.resolve("FOO");
      expect(t.router.state.fetchers.size).toBe(0);
      expect(subscriber.mock.calls.length).toBe(1);
      // Fetcher removed from router state upon return to idle
      expect(subscriber.mock.calls[0][0].fetchers.size).toBe(0);
      // But still mounted so not deleted from data layer yet
      expect(subscriber.mock.calls[0][1].deletedFetchers.length).toBe(0);
      subscriber.mockReset();

      t.router.deleteFetcher(key); // unmount
      expect(t.router.state.fetchers.size).toBe(0);
      expect(subscriber.mock.calls.length).toBe(1);
      expect(subscriber.mock.calls[0][0].fetchers.size).toBe(0);
      // Unmounted so can be deleted from data layer
      expect(subscriber.mock.calls[0][1].deletedFetchers).toEqual(["key"]);
      subscriber.mockReset();
    });

    it("submitting fetchers persist until completion when removed during submitting phase", async () => {
      let t = initializeTest({ future: { v7_fetcherPersist: true } });

      let key = "key";
      expect(t.router.state.fetchers.size).toBe(0);

      t.router.getFetcher(key); // mount
      let A = await t.fetch("/foo", key, {
        formMethod: "post",
        formData: createFormData({}),
      });
      expect(t.router.state.fetchers.size).toBe(1);
      expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

      t.router.deleteFetcher(key); // unmount
      expect(t.router.state.fetchers.size).toBe(1);
      expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

      await A.actions.foo.resolve("FOO");
      expect(t.router.state.fetchers.size).toBe(1);
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      // Cleaned up on completion
      await A.loaders.root.resolve("ROOT*");
      expect(t.router.state.fetchers.size).toBe(1);
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      await A.loaders.index.resolve("INDEX*");
      expect(t.router.state.fetchers.size).toBe(0);
    });

    it("submitting fetchers persist until completion when removed during loading phase", async () => {
      let t = initializeTest({ future: { v7_fetcherPersist: true } });

      let key = "key";
      t.router.getFetcher(key); // mount
      expect(t.router.state.fetchers.size).toBe(0);

      let A = await t.fetch("/foo", key, {
        formMethod: "post",
        formData: createFormData({}),
      });
      expect(t.router.state.fetchers.size).toBe(1);
      expect(t.router.state.fetchers.get(key)?.state).toBe("submitting");

      await A.actions.foo.resolve("FOO");
      expect(t.router.state.fetchers.size).toBe(1);
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      t.router.deleteFetcher(key); // unmount
      expect(t.router.state.fetchers.size).toBe(1);
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      // Cleaned up on completion
      await A.loaders.root.resolve("ROOT*");
      expect(t.router.state.fetchers.size).toBe(1);
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      await A.loaders.index.resolve("INDEX*");
      expect(t.router.state.fetchers.size).toBe(0);
    });

    it("unmounted fetcher.load errors/redirects should not be processed", async () => {
      let t = initializeTest({ future: { v7_fetcherPersist: true } });

      t.router.getFetcher("a"); // mount
      let A = await t.fetch("/foo", "a");
      t.router.deleteFetcher("a"); //unmount
      await A.loaders.foo.reject("ERROR");
      expect(t.router.state.fetchers.size).toBe(0);
      expect(t.router.state.errors).toBe(null);

      t.router.getFetcher("b"); // mount
      let B = await t.fetch("/bar", "b");
      t.router.deleteFetcher("b"); //unmount
      await B.loaders.bar.redirect("/baz");
      expect(t.router.state.fetchers.size).toBe(0);
      expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);
      expect(t.router.state.location.pathname).toBe("/");
    });

    it("unmounted fetcher.submit errors/redirects should not be processed", async () => {
      let t = initializeTest({ future: { v7_fetcherPersist: true } });

      t.router.getFetcher("a"); // mount
      let A = await t.fetch("/foo", "a", {
        formMethod: "post",
        formData: createFormData({}),
      });
      t.router.deleteFetcher("a"); //unmount
      await A.actions.foo.reject("ERROR");
      expect(t.router.state.fetchers.size).toBe(0);
      expect(t.router.state.errors).toBe(null);

      t.router.getFetcher("b"); // mount
      let B = await t.fetch("/bar", "b", {
        formMethod: "post",
        formData: createFormData({}),
      });
      t.router.deleteFetcher("b"); //unmount
      await B.actions.bar.redirect("/baz");
      expect(t.router.state.fetchers.size).toBe(0);
      expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);
      expect(t.router.state.location.pathname).toBe("/");
    });
  });

  describe("fetcher error states (4xx Response)", () => {
    it("loader fetch", async () => {
      let t = initializeTest();
      let A = await t.fetch("/foo");
      await A.loaders.foo.reject(new Response(null, { status: 400 }));
      expect(A.fetcher).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponseImpl(400, undefined, ""),
      });
    });

    it("loader submission fetch", async () => {
      let t = initializeTest();
      let A = await t.fetch("/foo?key=value", {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });
      await A.loaders.foo.reject(new Response(null, { status: 400 }));
      expect(A.fetcher).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponseImpl(400, undefined, ""),
      });
    });

    it("action fetch", async () => {
      let t = initializeTest();
      let A = await t.fetch("/foo", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await A.actions.foo.reject(new Response(null, { status: 400 }));
      expect(A.fetcher).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponseImpl(400, undefined, ""),
      });
    });

    it("action fetch without action handler", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            hasErrorBoundary: true,
            children: [
              {
                id: "index",
                index: true,
              },
            ],
          },
        ],
      });
      let A = await t.fetch("/", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(A.fetcher).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponseImpl(
          405,
          "Method Not Allowed",
          new Error(
            'You made a POST request to "/" but did not provide an `action` ' +
              'for route "root", so there is no way to handle the request.'
          ),
          true
        ),
      });
    });

    it("action fetch with invalid body (json)", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            hasErrorBoundary: true,
          },
        ],
      });
      let A = await t.fetch("/", {
        formMethod: "post",
        body: "not json",
        formEncType: "application/json",
      });
      expect(A.fetcher).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponseImpl(
          400,
          "Bad Request",
          new Error("Unable to encode submission body"),
          true
        ),
      });
    });

    it("handles fetcher errors at contextual route boundaries", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            hasErrorBoundary: true,
            children: [
              {
                id: "wit",
                path: "wit",
                loader: true,
                hasErrorBoundary: true,
              },
              {
                id: "witout",
                path: "witout",
                loader: true,
              },
              {
                id: "error",
                path: "error",
                loader: true,
              },
            ],
          },
        ],
      });

      // If the routeId is not an active match, errors bubble to the root
      let A = await t.fetch("/error", "key1", "wit");
      await A.loaders.error.reject(new Error("Kaboom!"));
      expect(t.router.getFetcher("key1")).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new Error("Kaboom!"),
      });

      await t.fetch("/not-found", "key2", "wit");
      expect(t.router.getFetcher("key2")).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponseImpl(
          404,
          "Not Found",
          new Error('No route matches URL "/not-found"'),
          true
        ),
      });

      // Navigate to /wit and trigger errors, handled at the wit boundary
      let B = await t.navigate("/wit");
      await B.loaders.wit.resolve("WIT");

      let C = await t.fetch("/error", "key3", "wit");
      await C.loaders.error.reject(new Error("Kaboom!"));
      expect(t.router.getFetcher("key3")).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        wit: new Error("Kaboom!"),
      });

      await t.fetch("/not-found", "key4", "wit", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(t.router.getFetcher("key4")).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        wit: new ErrorResponseImpl(
          404,
          "Not Found",
          new Error('No route matches URL "/not-found"'),
          true
        ),
      });

      await t.fetch("/not-found", "key5", "wit");
      expect(t.router.getFetcher("key5")).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        wit: new ErrorResponseImpl(
          404,
          "Not Found",
          new Error('No route matches URL "/not-found"'),
          true
        ),
      });

      // Navigate to /witout and fetch a 404, handled at the root boundary
      let D = await t.navigate("/witout");
      await D.loaders.witout.resolve("WITOUT");

      let E = await t.fetch("/error", "key6", "witout");
      await E.loaders.error.reject(new Error("Kaboom!"));
      expect(t.router.getFetcher("key6")).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new Error("Kaboom!"),
      });

      await t.fetch("/not-found", "key7", "witout");
      expect(t.router.getFetcher("key7")).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponseImpl(
          404,
          "Not Found",
          new Error('No route matches URL "/not-found"'),
          true
        ),
      });
    });
  });

  describe("fetcher error states (Error)", () => {
    it("loader fetch", async () => {
      let t = initializeTest();
      let A = await t.fetch("/foo");
      await A.loaders.foo.reject(new Error("Kaboom!"));
      expect(A.fetcher).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new Error("Kaboom!"),
      });
    });

    it("loader submission fetch", async () => {
      let t = initializeTest();
      let A = await t.fetch("/foo?key=value", {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });
      await A.loaders.foo.reject(new Error("Kaboom!"));
      expect(A.fetcher).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new Error("Kaboom!"),
      });
    });

    it("action fetch", async () => {
      let t = initializeTest();
      let A = await t.fetch("/foo", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await A.actions.foo.reject(new Error("Kaboom!"));
      expect(A.fetcher).toBe(IDLE_FETCHER);
      expect(t.router.state.errors).toEqual({
        root: new Error("Kaboom!"),
      });
    });
  });

  describe("fetcher redirects", () => {
    it("loader fetch", async () => {
      let t = initializeTest();
      let key = t.router.state.location.key;

      let A = await t.fetch("/foo");

      let B = await A.loaders.foo.redirect("/bar");
      expect(t.router.getFetcher(A.key)).toBe(A.fetcher);
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location?.pathname).toBe("/bar");

      await B.loaders.bar.resolve("BAR");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.historyAction).toBe("PUSH");
      expect(t.router.state.location?.pathname).toBe("/bar");

      // Back button should take us back to location that triggered the fetch
      // redirect
      let C = await t.navigate(-1);
      await C.loaders.index.resolve("INDEX");
      expect(t.router.state.location.pathname).toBe("/");
      expect(t.router.state.location.key).toBe(key);
    });

    it("loader submission fetch", async () => {
      let t = initializeTest();
      let key = t.router.state.location.key;
      let A = await t.fetch("/foo?key=value", {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });

      let B = await A.loaders.foo.redirect("/bar");
      expect(t.router.getFetcher(A.key)).toBe(A.fetcher);
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location?.pathname).toBe("/bar");

      await B.loaders.bar.resolve("BAR");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.historyAction).toBe("PUSH");
      expect(t.router.state.location?.pathname).toBe("/bar");

      // Back button should take us back to location that triggered the fetch
      // redirect
      let C = await t.navigate(-1);
      await C.loaders.index.resolve("INDEX");
      expect(t.router.state.location.pathname).toBe("/");
      expect(t.router.state.location.key).toBe(key);
    });

    it("action fetch", async () => {
      let t = initializeTest();
      let key = t.router.state.location.key;

      let A = await t.fetch("/foo", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(A.fetcher.state).toBe("submitting");
      let AR = await A.actions.foo.redirect("/bar");
      expect(A.fetcher.state).toBe("loading");
      expect(t.router.state.navigation).toMatchObject({
        state: "loading",
        location: {
          pathname: "/bar",
        },
        // Fetcher action redirect should not proxy the fetcher submission
        // onto the loading navigation
        formAction: undefined,
        formData: undefined,
        formEncType: undefined,
        formMethod: undefined,
      });
      await AR.loaders.root.resolve("ROOT*");
      await AR.loaders.bar.resolve("stuff");
      expect(A.fetcher).toEqual({
        data: undefined,
        state: "idle",
        formMethod: undefined,
        formAction: undefined,
        formEncType: undefined,
        formData: undefined,
      });
      expect(t.router.state.historyAction).toBe("PUSH");
      expect(t.router.state.location.pathname).toBe("/bar");
      // Root loader should be re-called after fetchActionRedirect
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
        bar: "stuff",
      });

      // Back button should take us back to location that triggered the fetch
      // redirect
      let C = await t.navigate(-1);
      await C.loaders.index.resolve("INDEX");
      expect(t.router.state.location.pathname).toBe("/");
      expect(t.router.state.location.key).toBe(key);
    });
  });

  describe("fetcher resubmissions/re-gets", () => {
    it("aborts re-gets", async () => {
      let t = initializeTest();
      let key = "KEY";
      let A = await t.fetch("/foo", key);
      let B = await t.fetch("/foo", key);
      await A.loaders.foo.resolve(null);
      let C = await t.fetch("/foo", key);
      await B.loaders.foo.resolve(null);
      await C.loaders.foo.resolve(null);
      expect(A.loaders.foo.signal.aborted).toBe(true);
      expect(B.loaders.foo.signal.aborted).toBe(true);
      expect(C.loaders.foo.signal.aborted).toBe(false);
    });

    it("aborts re-get-submissions", async () => {
      let t = initializeTest();
      let key = "KEY";
      let A = await t.fetch("/foo", key, {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });
      let B = await t.fetch("/foo", key, {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });
      let C = await t.fetch("/foo", key);
      expect(A.loaders.foo.signal.aborted).toBe(true);
      expect(B.loaders.foo.signal.aborted).toBe(true);
      await C.loaders.foo.resolve(null);
    });

    it("aborts resubmissions action call", async () => {
      let t = initializeTest();
      let key = "KEY";
      let A = await t.fetch("/foo", key, {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      let B = await t.fetch("/foo", key, {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      let C = await t.fetch("/foo", key, {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(A.actions.foo.signal.aborted).toBe(true);
      expect(B.actions.foo.signal.aborted).toBe(true);
      await C.actions.foo.resolve(null);
      await C.loaders.root.resolve(null);
      await C.loaders.index.resolve(null);
    });

    it("aborts resubmissions loader call", async () => {
      let t = initializeTest({
        url: "/foo",
        hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
      });
      let key = "KEY";
      let A = await t.fetch("/foo", key, {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await A.actions.foo.resolve("A ACTION");
      let C = await t.fetch("/foo", key, {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(A.loaders.foo.signal.aborted).toBe(true);
      await C.actions.foo.resolve(null);
      await C.loaders.root.resolve(null);
      await C.loaders.foo.resolve(null);
    });

    describe(`
      A) POST |--|--XXX
      B) POST       |----XXX|XXX
      C) POST            |----|---O
    `, () => {
      it("aborts A load, ignores A resolve, aborts B action", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });
        let key = "KEY";

        let A = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.resolve("A ACTION");
        expect(t.router.getFetcher(key).data).toBe("A ACTION");

        let B = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        expect(A.loaders.foo.signal.aborted).toBe(true);
        expect(t.router.getFetcher(key).data).toBe("A ACTION");

        await A.loaders.root.resolve("A ROOT LOADER");
        await A.loaders.foo.resolve("A LOADER");
        expect(t.router.state.loaderData.foo).toBe("FOO");

        let C = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        expect(B.actions.foo.signal.aborted).toBe(true);

        await B.actions.foo.resolve("B ACTION");
        expect(t.router.getFetcher(key).data).toBe("A ACTION");

        await C.actions.foo.resolve("C ACTION");
        expect(t.router.getFetcher(key).data).toBe("C ACTION");

        await B.loaders.root.resolve("B ROOT LOADER");
        await B.loaders.foo.resolve("B LOADER");
        expect(t.router.state.loaderData.foo).toBe("FOO");

        await C.loaders.root.resolve("C ROOT LOADER");
        await C.loaders.foo.resolve("C LOADER");
        expect(t.router.getFetcher(key).data).toBe("C ACTION");
        expect(t.router.state.loaderData.foo).toBe("C LOADER");
      });
    });

    describe(`
      A) k1 |----|----X
      B) k2   |----|-----O
      C) k1           |-----|---O
    `, () => {
      it("aborts A load, commits B and C loads", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });
        let k1 = "1";
        let k2 = "2";

        let Ak1 = await t.fetch("/foo", k1, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let Bk2 = await t.fetch("/foo", k2, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });

        await Ak1.actions.foo.resolve("A ACTION");
        await Bk2.actions.foo.resolve("B ACTION");
        expect(t.router.getFetcher(k2).data).toBe("B ACTION");

        let Ck1 = await t.fetch("/foo", k1, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        expect(Ak1.loaders.foo.signal.aborted).toBe(true);

        await Ak1.loaders.root.resolve("A ROOT LOADER");
        await Ak1.loaders.foo.resolve("A LOADER");
        expect(t.router.state.loaderData.foo).toBe("FOO");

        await Bk2.loaders.root.resolve("B ROOT LOADER");
        await Bk2.loaders.foo.resolve("B LOADER");
        expect(Ck1.actions.foo.signal.aborted).toBe(false);
        expect(t.router.state.loaderData.foo).toBe("B LOADER");

        await Ck1.actions.foo.resolve("C ACTION");
        await Ck1.loaders.root.resolve("C ROOT LOADER");
        await Ck1.loaders.foo.resolve("C LOADER");

        expect(t.router.getFetcher(k1).data).toBe("C ACTION");
        expect(t.router.state.loaderData.foo).toBe("C LOADER");
      });
    });
  });

  describe("multiple fetcher action reloads", () => {
    describe(`
      A) POST /foo |---[A]------O
      B) POST /foo   |-----[A,B]---O
    `, () => {
      it("commits A, commits B", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let B = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.resolve("A action");
        await B.actions.foo.resolve("B action");

        await A.loaders.root.resolve("A root");
        await A.loaders.foo.resolve("A loader");
        expect(t.router.state.loaderData).toEqual({
          root: "A root",
          foo: "A loader",
        });

        await B.loaders.root.resolve("A,B root");
        await B.loaders.foo.resolve("A,B loader");
        expect(t.router.state.loaderData).toEqual({
          root: "A,B root",
          foo: "A,B loader",
        });
      });
    });

    describe(`
      A) POST /foo |----🧤
      B) POST /foo   |--X
    `, () => {
      it("catches A, persists boundary for B", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let B = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });

        await A.actions.foo.reject(new Response(null, { status: 400 }));
        expect(t.router.state.errors).toEqual({
          root: new ErrorResponseImpl(400, undefined, ""),
        });

        await B.actions.foo.resolve("B");
        expect(t.router.state.errors).toEqual({
          root: new ErrorResponseImpl(400, undefined, ""),
        });

        await B.loaders.root.resolve(null);
        await B.loaders.foo.resolve(null);
      });
    });

    describe(`
      A) POST /foo |----[A]-|
      B) POST /foo   |------🧤
    `, () => {
      it("commits A, catches B", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let B = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });

        await A.actions.foo.resolve("A action");
        await A.loaders.root.resolve("A root");
        await A.loaders.foo.resolve("A loader");
        expect(t.router.state.loaderData).toEqual({
          root: "A root",
          foo: "A loader",
        });

        await B.actions.foo.reject(new Response(null, { status: 400 }));
        expect(t.router.state.errors).toEqual({
          root: new ErrorResponseImpl(400, undefined, ""),
        });
      });
    });

    describe(`
      A) POST /foo |---[A]-------X
      B) POST /foo   |----[A,B]--O
    `, () => {
      it("aborts A, commits B, sets A done", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let B = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.resolve("A");
        await B.actions.foo.resolve("B");

        await B.loaders.root.resolve("A,B root");
        await B.loaders.foo.resolve("A,B");
        expect(t.router.state.loaderData).toEqual({
          root: "A,B root",
          foo: "A,B",
        });
        expect(A.loaders.foo.signal.aborted).toBe(true);
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("A");
      });
    });

    describe(`
      A) POST /foo |--------[B,A]---O
      B) POST /foo   |--[B]-------O
    `, () => {
      it("commits B, commits A", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let B = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });

        await B.actions.foo.resolve("B action");
        await A.actions.foo.resolve("A action");

        await B.loaders.root.resolve("B root");
        await B.loaders.foo.resolve("B");
        expect(t.router.state.loaderData).toEqual({
          root: "B root",
          foo: "B",
        });

        await A.loaders.root.resolve("B,A root");
        await A.loaders.foo.resolve("B,A");
        expect(t.router.state.loaderData).toEqual({
          root: "B,A root",
          foo: "B,A",
        });
      });
    });

    describe(`
      A) POST /foo |------|---O
      B) POST /foo   |--|-----X
    `, () => {
      it("aborts B, commits A, sets B done", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });

        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let B = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });

        await B.actions.foo.resolve("B");
        await A.actions.foo.resolve("A");

        await A.loaders.root.resolve("B,A root");
        await A.loaders.foo.resolve("B,A");
        expect(t.router.state.loaderData).toEqual({
          root: "B,A root",
          foo: "B,A",
        });
        expect(B.loaders.foo.signal.aborted).toBe(true);
        expect(B.fetcher.state).toBe("idle");
        expect(B.fetcher.data).toBe("B");
      });
    });
  });

  describe("navigating with inflight fetchers", () => {
    describe(`
      A) fetch POST |-------|--O
      B) nav GET      |---O
    `, () => {
      it("does not abort A action or data reload", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });

        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let B = await t.navigate("/foo");
        expect(A.actions.foo.signal.aborted).toBe(false);
        expect(t.router.state.navigation.state).toBe("loading");
        expect(t.router.state.navigation.location?.pathname).toBe("/foo");

        await B.loaders.root.resolve("B root");
        await B.loaders.foo.resolve("B");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.location.pathname).toBe("/foo");
        expect(t.router.state.loaderData.foo).toBe("B");
        expect(A.loaders.foo.signal).toBe(undefined); // A loaders not called yet

        await A.actions.foo.resolve("A root");
        await A.loaders.root.resolve("A root");
        await A.loaders.foo.resolve("A");
        expect(A.loaders.foo.signal.aborted).toBe(false);
        expect(t.router.state.loaderData).toEqual({
          root: "A root",
          foo: "A",
        });
      });
    });

    describe(`
      A) fetch POST |----|-----O
      B) nav GET      |-----O
    `, () => {
      it("Commits A and uses next matches", async () => {
        let t = initializeTest({ url: "/" });

        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        // This fetcher's helpers take the current locations loaders (root/index).
        // Since we know we're about to interrupt with /foo let's shim in a
        // loader helper for foo ahead of time
        t.shimHelper(A.loaders, "fetch", "loader", "foo");

        let B = await t.navigate("/foo");
        await A.actions.foo.resolve("A action");
        await B.loaders.root.resolve("B root");
        await B.loaders.foo.resolve("B");
        expect(A.actions.foo.signal.aborted).toBe(false);
        expect(A.loaders.foo.signal.aborted).toBe(false);
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.location.pathname).toBe("/foo");
        expect(t.router.state.loaderData).toEqual({
          root: "B root",
          foo: "B",
        });

        await A.loaders.root.resolve("A root");
        await A.loaders.foo.resolve("A");
        expect(t.router.state.loaderData).toEqual({
          root: "A root",
          foo: "A",
        });
      });
    });

    describe(`
      A) fetch POST |--|----X
      B) nav GET         |--O
    `, () => {
      it("aborts A, sets fetcher done", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });

        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.resolve("A");
        let B = await t.navigate("/foo");
        await B.loaders.root.resolve("ROOT*");
        await B.loaders.foo.resolve("B");
        expect(t.router.state.navigation.state).toBe("idle");
        expect(t.router.state.location.pathname).toBe("/foo");
        expect(t.router.state.loaderData).toEqual({
          root: "ROOT*",
          foo: "B",
        });
        expect(A.loaders.foo.signal.aborted).toBe(true);
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("A");
      });
    });

    describe(`
      A) fetch POST |--|---O
      B) nav GET         |---O
    `, () => {
      it("commits both", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });

        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.resolve("A action");
        let B = await t.navigate("/foo");
        await A.loaders.root.resolve("A ROOT");
        await A.loaders.foo.resolve("A");
        expect(t.router.state.loaderData).toEqual({
          root: "A ROOT",
          foo: "A",
        });

        await B.loaders.root.resolve("B ROOT");
        await B.loaders.foo.resolve("B");
        expect(t.router.state.loaderData).toEqual({
          root: "B ROOT",
          foo: "B",
        });
      });
    });

    describe(`
      A) fetch POST |---[A]---O
      B) nav POST           |---[A,B]--O
    `, () => {
      it("keeps both", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.resolve("A action");
        let B = await t.navigate("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.loaders.root.resolve("A ROOT");
        await A.loaders.foo.resolve("A");
        expect(t.router.state.loaderData).toEqual({
          root: "A ROOT",
          foo: "A",
        });

        await B.actions.foo.resolve("A,B");
        await B.loaders.root.resolve("A,B ROOT");
        await B.loaders.foo.resolve("A,B");
        expect(t.router.state.loaderData).toEqual({
          root: "A,B ROOT",
          foo: "A,B",
        });
      });
    });

    describe(`
      A) fetch POST |---[A]--------X
      B) nav POST     |-----[A,B]--O
    `, () => {
      it("aborts A, commits B, marks fetcher done", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let B = await t.navigate("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.resolve("A");
        await B.actions.foo.resolve("A,B");
        await B.loaders.root.resolve("A,B ROOT");
        await B.loaders.foo.resolve("A,B");
        expect(t.router.state.loaderData).toEqual({
          root: "A,B ROOT",
          foo: "A,B",
        });
        expect(A.loaders.foo.signal.aborted).toBe(true);
        expect(A.fetcher.state).toBe("idle");
        expect(A.fetcher.data).toBe("A");
      });
    });

    describe(`
      A) fetch POST |-----------[B,A]--O
      B) nav POST     |--[B]--O
    `, () => {
      it("commits both, uses the nav's href", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        t.shimHelper(A.loaders, "fetch", "loader", "bar");
        let B = await t.navigate("/bar", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await B.actions.bar.resolve("B");
        await B.loaders.root.resolve("B");
        await B.loaders.bar.resolve("B");
        await A.actions.foo.resolve("B,A");
        await A.loaders.root.resolve("B,A ROOT");
        await A.loaders.bar.resolve("B,A");
        expect(t.router.state.loaderData).toEqual({
          root: "B,A ROOT",
          bar: "B,A",
        });
      });
    });

    describe(`
      A) fetch POST |-------[B,A]--O
      B) nav POST     |--[B]-------X
    `, () => {
      it("aborts B, commits A, uses the nav's href", async () => {
        let t = initializeTest({
          url: "/foo",
          hydrationData: { loaderData: { root: "ROOT", foo: "FOO" } },
        });
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        t.shimHelper(A.loaders, "fetch", "loader", "bar");
        let B = await t.navigate("/bar", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await B.actions.bar.resolve("B");
        await A.actions.foo.resolve("B,A");
        await A.loaders.root.resolve("B,A ROOT");
        await A.loaders.bar.resolve("B,A");
        expect(B.loaders.bar.signal.aborted).toBe(true);
        expect(t.router.state.loaderData).toEqual({
          root: "B,A ROOT",
          bar: "B,A",
        });
        expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);
      });
    });

    describe(`
      A) fetch POST /foo |--X
      B) nav   GET  /bar    |-----O
    `, () => {
      it("forces all loaders to revalidate on interrupted fetcher submission", async () => {
        let t = initializeTest();
        let A = await t.fetch("/foo", {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        t.shimHelper(A.loaders, "fetch", "loader", "bar");

        // Interrupting the submission should cause the next load to call all loaders
        let B = await t.navigate("/bar");
        await A.actions.foo.resolve("A ACTION");
        await B.loaders.root.resolve("ROOT*");
        await B.loaders.bar.resolve("BAR");
        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/bar" },
          actionData: null,
          loaderData: {
            root: "ROOT*",
            bar: "BAR",
          },
        });

        await A.loaders.root.resolve("ROOT**");
        await A.loaders.bar.resolve("BAR*");
        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/bar" },
          actionData: null,
          loaderData: {
            root: "ROOT**",
            bar: "BAR*",
          },
        });
      });
    });

    describe(`
      A) fetch POST /foo |--|--X
      B) nav   GET  /bar       |-----O
    `, () => {
      it("forces all loaders to revalidate on interrupted fetcher actionReload", async () => {
        let key = "key";
        let t = initializeTest();
        let A = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.resolve("A ACTION");
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");
        expect(t.router.state.fetchers.get(key)?.data).toBe("A ACTION");
        // Interrupting the actionReload should cause the next load to call all loaders
        let B = await t.navigate("/bar");
        await B.loaders.root.resolve("ROOT*");
        await B.loaders.bar.resolve("BAR");
        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/bar" },
          actionData: null,
          loaderData: {
            root: "ROOT*",
            bar: "BAR",
          },
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBe("A ACTION");
      });

      it("forces all loaders to revalidate on interrupted fetcher submissionRedirect", async () => {
        let key = "key";
        let t = initializeTest();
        let A = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await A.actions.foo.redirect("/baz");
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");
        // Interrupting the actionReload should cause the next load to call all loaders
        let B = await t.navigate("/bar");
        await B.loaders.root.resolve("ROOT*");
        await B.loaders.bar.resolve("BAR");
        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/bar" },
          loaderData: {
            root: "ROOT*",
            bar: "BAR",
          },
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBeUndefined();
      });
    });

    describe(`
      A) fetch GET /foo |--R
      B) nav   GET /bar   |---O
    `, () => {
      it("ignores loader redirect navigation if preceded by a normal GET navigation", async () => {
        let key = "key";
        let t = initializeTest();

        // Start a fetch load and interrupt with a navigation
        let A = await t.fetch("/foo", key);
        let B = await t.navigate("/bar");

        // The fetcher loader redirect should be ignored
        await A.loaders.foo.redirect("/baz");
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");

        await B.loaders.bar.resolve("BAR");
        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/bar" },
          loaderData: {
            root: "ROOT",
            bar: "BAR",
          },
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBeUndefined();
      });
    });

    describe(`
      A) fetch POST /foo |--R
      B) nav   GET  /bar   |---O
    `, () => {
      it("ignores submission redirect navigation if preceded by a normal GET navigation", async () => {
        let key = "key";
        let t = initializeTest();
        let A = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        let B = await t.navigate("/bar");

        // This redirect should be ignored
        await A.actions.foo.redirect("/baz");
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");

        await B.loaders.root.resolve("ROOT*");
        await B.loaders.bar.resolve("BAR");
        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/bar" },
          loaderData: {
            root: "ROOT*",
            bar: "BAR",
          },
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBeUndefined();
      });

      it("ignores submission redirect navigation if preceded by a normal GET navigation (w/o loaders)", async () => {
        let key = "key";
        let t = setup({
          routes: [
            {
              path: "",
              id: "root",
              children: [
                {
                  path: "/",
                  id: "index",
                },
                {
                  path: "/foo",
                  id: "foo",
                  action: true,
                },
                {
                  path: "/bar",
                  id: "bar",
                },
                {
                  path: "/baz",
                  id: "baz",
                },
              ],
            },
          ],
        });
        let A = await t.fetch("/foo", key, {
          formMethod: "post",
          formData: createFormData({ key: "value" }),
        });
        await t.navigate("/bar");

        // This redirect should be ignored
        await A.actions.foo.redirect("/baz");
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");

        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/bar" },
          loaderData: {},
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBeUndefined();
      });
    });

    describe(`
      A) fetch GET /foo |--R     |---O
      B) nav   POST /bar   |--|--|---O
    `, () => {
      it("ignores loader redirect navigation if preceded by a normal POST navigation", async () => {
        let key = "key";
        let t = initializeTest();

        // Start a fetch load and interrupt with a POST navigation
        let A = await t.fetch("/foo", key);
        let B = await t.navigate(
          "/bar",
          { formMethod: "post", formData: createFormData({}) },
          ["foo"]
        );

        // The fetcher loader redirect should be ignored
        await A.loaders.foo.redirect("/baz");
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        // The navigation should trigger the fetcher to revalidate since it's
        // not yet "completed".  If it returns data this time that should be
        // reflected
        await B.actions.bar.resolve("ACTION");
        await B.loaders.root.resolve("ROOT*");
        await B.loaders.bar.resolve("BAR");
        await B.loaders.foo.resolve("FOO");

        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/bar" },
          loaderData: {
            root: "ROOT*",
            bar: "BAR",
          },
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBe("FOO");
      });

      it("processes second fetcher load redirect after interruption by normal POST navigation", async () => {
        let key = "key";
        let t = initializeTest();

        // Start a fetch load and interrupt with a POST navigation
        let A = await t.fetch("/foo", key, "root");
        let B = await t.navigate(
          "/bar",
          { formMethod: "post", formData: createFormData({}) },
          ["foo"]
        );
        expect(A.loaders.foo.signal.aborted).toBe(true);

        // The fetcher loader redirect should be ignored
        await A.loaders.foo.redirect("/baz");
        expect(t.router.state).toMatchObject({
          navigation: { location: { pathname: "/bar" } },
          location: { pathname: "/" },
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        // The navigation should trigger the fetcher to revalidate since it's
        // not yet "completed".  If it redirects again we should follow that
        await B.actions.bar.resolve("ACTION");
        await B.loaders.root.resolve("ROOT*");
        await B.loaders.bar.resolve("BAR");
        let C = await B.loaders.foo.redirect("/foo/bar", undefined, undefined, [
          "foo",
        ]);
        expect(t.router.state).toMatchObject({
          navigation: { location: { pathname: "/foo/bar" } },
          location: { pathname: "/" },
          loaderData: {
            root: "ROOT",
          },
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

        // The fetcher should not revalidate here since it triggered the redirect
        await C.loaders.root.resolve("ROOT**");
        await C.loaders.foobar.resolve("FOOBAR");
        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/foo/bar" },
          loaderData: {
            root: "ROOT**",
            foobar: "FOOBAR",
          },
        });
        expect(t.router.state.fetchers.get(key)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(key)?.data).toBe(undefined);
      });
    });

    describe(`
      A) fetch GET /foo |-----X
      B) fetch GET /bar  |---R
    `, () => {
      it("handles racing fetcher loader redirects", async () => {
        let keyA = "a";
        let keyB = "b";
        let t = initializeTest();

        // Start 2 fetch loads
        let A = await t.fetch("/foo", keyA, "root");
        let B = await t.fetch("/bar", keyB, "root");

        // Return a redirect from the second fetcher.load
        let C = await B.loaders.bar.redirect("/baz");
        expect(t.router.state).toMatchObject({
          navigation: { location: { pathname: "/baz" } },
          location: { pathname: "/" },
        });
        expect(t.router.state.fetchers.get(keyA)?.state).toBe("loading");
        expect(t.router.state.fetchers.get(keyB)?.state).toBe("loading");

        // The original fetch load redirect should be ignored
        await A.loaders.foo.redirect("/foo/bar");
        expect(t.router.state).toMatchObject({
          navigation: { location: { pathname: "/baz" } },
          location: { pathname: "/" },
        });
        expect(t.router.state.fetchers.get(keyA)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(keyB)?.state).toBe("loading");

        // Resolve the navigation loader
        await C.loaders.baz.resolve("BAZ");
        expect(t.router.state).toMatchObject({
          navigation: IDLE_NAVIGATION,
          location: { pathname: "/baz" },
          loaderData: {
            root: "ROOT",
            baz: "BAZ",
          },
        });
        expect(t.router.state.fetchers.get(keyA)?.state).toBe("idle");
        expect(t.router.state.fetchers.get(keyB)?.state).toBe("idle");
      });
    });
  });

  describe("fetcher revalidation", () => {
    it("revalidates fetchers on action submissions", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
      });
      expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

      let key1 = "key1";
      let A = await t.fetch("/tasks/1", key1);
      await A.loaders.tasksId.resolve("TASKS 1");
      expect(A.fetcher.state).toBe("idle");
      expect(A.fetcher.data).toBe("TASKS 1");

      let C = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({}),
      });
      // Add a helper for the fetcher that will be revalidating
      t.shimHelper(C.loaders, "navigation", "loader", "tasksId");

      // Resolve the action
      await C.actions.tasks.resolve("TASKS ACTION");

      // Fetcher should go back into a loading state
      expect(t.router.state.fetchers.get(key1)?.state).toBe("loading");

      // Resolve navigation loaders + fetcher loader
      await C.loaders.root.resolve("ROOT*");
      await C.loaders.tasks.resolve("TASKS LOADER");
      await C.loaders.tasksId.resolve("TASKS ID*");
      expect(t.router.state.fetchers.get(key1)).toMatchObject({
        state: "idle",
        data: "TASKS ID*",
      });

      // If a fetcher does a submission, it unsets the revalidation aspect
      let D = await t.fetch("/tasks/3", key1, {
        formMethod: "post",
        formData: createFormData({}),
      });
      await D.actions.tasksId.resolve("TASKS 3");
      await D.loaders.root.resolve("ROOT**");
      await D.loaders.tasks.resolve("TASKS**");
      expect(t.router.state.fetchers.get(key1)).toMatchObject({
        state: "idle",
        data: "TASKS 3",
      });

      let E = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({}),
      });
      await E.actions.tasks.resolve("TASKS ACTION");
      await E.loaders.root.resolve("ROOT***");
      await E.actions.tasks.resolve("TASKS***");

      // Remains the same state as it was after the submission
      expect(t.router.state.fetchers.get(key1)).toMatchObject({
        state: "idle",
        data: "TASKS 3",
      });
    });

    it("revalidates fetchers on action redirects", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
      });
      expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

      let key = "key";
      let A = await t.fetch("/tasks/1", key);
      await A.loaders.tasksId.resolve("TASKS ID");
      expect(A.fetcher.state).toBe("idle");
      expect(A.fetcher.data).toBe("TASKS ID");

      let C = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({}),
      });

      // Redirect the action
      let D = await C.actions.tasks.redirect("/", undefined, undefined, [
        "tasksId",
      ]);
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      // Resolve navigation loaders + fetcher loader
      await D.loaders.root.resolve("ROOT*");
      await D.loaders.index.resolve("INDEX*");
      await D.loaders.tasksId.resolve("TASKS ID*");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "TASKS ID*",
      });
    });

    it("revalidates fetchers on action errors", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
      });
      expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

      let key = "key";
      let A = await t.fetch("/tasks/1", key);
      await A.loaders.tasksId.resolve("TASKS ID");
      expect(A.fetcher.state).toBe("idle");
      expect(A.fetcher.data).toBe("TASKS ID");

      let C = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({}),
      });
      t.shimHelper(C.loaders, "navigation", "loader", "tasksId");

      // Reject the action
      await C.actions.tasks.reject(new Error("Kaboom!"));
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      // Resolve navigation loaders + fetcher loader
      await C.loaders.root.resolve("ROOT*");
      await C.loaders.tasksId.resolve("TASKS ID*");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "TASKS ID*",
      });
    });

    it("does not revalidate fetchers on searchParams changes", async () => {
      let key = "key";
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/tasks/1"],
        hydrationData: {
          loaderData: {
            root: "ROOT",
            taskId: "TASK 1",
          },
        },
      });

      let A = await t.fetch("/?index", key);
      await A.loaders.index.resolve("FETCH 1");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH 1",
      });

      let B = await t.navigate("/tasks/1?key=value", undefined, ["index"]);
      await B.loaders.root.resolve("ROOT 2");
      await B.loaders.tasksId.resolve("TASK 2");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT 2",
        tasksId: "TASK 2",
      });
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH 1",
      });
      expect(B.loaders.index.stub).not.toHaveBeenCalled();
    });

    it("revalidates fetchers on links to the current location", async () => {
      let key = "key";
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/tasks/1"],
        hydrationData: {
          loaderData: {
            root: "ROOT",
            taskId: "TASK 1",
          },
        },
      });

      let A = await t.fetch("/?index", key);
      await A.loaders.index.resolve("FETCH 1");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH 1",
      });

      let B = await t.navigate("/tasks/1", undefined, ["index"]);
      await B.loaders.root.resolve("ROOT 2");
      await B.loaders.tasksId.resolve("TASK 2");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT 2",
        tasksId: "TASK 2",
      });
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH 1",
      });
      expect(B.loaders.index.stub).not.toHaveBeenCalled();
    });

    it("does not revalidate idle fetchers when a loader navigation is performed", async () => {
      let key = "key";
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
      });

      let A = await t.fetch("/", key);
      await A.loaders.root.resolve("ROOT FETCH");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "ROOT FETCH",
      });

      let B = await t.navigate("/tasks");
      await B.loaders.tasks.resolve("TASKS");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        tasks: "TASKS",
      });
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "ROOT FETCH",
      });
    });

    it("respects shouldRevalidate for the fetcher route", async () => {
      let key = "key";
      let count = 0;
      let shouldRevalidate = jest.fn((args) => false);
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/one"] }),
        routes: [
          {
            id: "root",
            path: "/",
            loader: () => Promise.resolve(++count),
            children: [
              {
                path: ":a",
                children: [
                  {
                    path: ":b",
                    action: () => Promise.resolve(null),
                  },
                ],
              },
            ],
          },
          {
            id: "fetch",
            path: "/fetch",
            loader: () => Promise.resolve(++count),
            shouldRevalidate,
          },
        ],
        hydrationData: {
          loaderData: { root: count },
        },
      });

      expect(router.state.loaderData).toMatchObject({
        root: 0,
      });
      expect(router.getFetcher(key)).toBe(IDLE_FETCHER);

      // Fetch from a different route
      router.fetch(key, "root", "/fetch");
      await tick();
      expect(router.getFetcher(key)).toMatchObject({
        state: "idle",
        data: 1,
      });

      // Post to the current route
      router.navigate("/two/three", {
        formMethod: "post",
        formData: createFormData({}),
      });
      await tick();
      expect(router.state.loaderData).toMatchObject({
        root: 2,
      });
      expect(router.getFetcher(key)).toMatchObject({
        state: "idle",
        data: 1,
      });
      expect(shouldRevalidate.mock.calls[0][0]).toMatchInlineSnapshot(`
        {
          "actionResult": null,
          "actionStatus": undefined,
          "currentParams": {
            "a": "one",
          },
          "currentUrl": "http://localhost/one",
          "defaultShouldRevalidate": true,
          "formAction": "/two/three",
          "formData": FormData {},
          "formEncType": "application/x-www-form-urlencoded",
          "formMethod": "post",
          "json": undefined,
          "nextParams": {
            "a": "two",
            "b": "three",
          },
          "nextUrl": "http://localhost/two/three",
          "text": undefined,
        }
      `);

      expect(router._internalFetchControllers.size).toBe(0);
      router.dispose();
    });

    it("handles fetcher revalidation errors", async () => {
      let key = "key";
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
      });

      expect(t.router.state).toMatchObject({
        loaderData: {
          root: "ROOT",
          index: "INDEX",
        },
        errors: null,
      });

      let A = await t.fetch("/tasks/1", key);
      await A.loaders.tasksId.resolve("ROOT FETCH");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "ROOT FETCH",
      });

      let B = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({}),
      });
      t.shimHelper(B.loaders, "navigation", "loader", "tasksId");
      await B.actions.tasks.resolve("TASKS ACTION");
      await B.loaders.root.resolve("ROOT*");
      await B.loaders.tasks.resolve("TASKS*");
      await B.loaders.tasksId.reject(new Error("Fetcher error"));
      expect(t.router.state).toMatchObject({
        loaderData: {
          root: "ROOT*",
          tasks: "TASKS*",
        },
        errors: {
          // Even though tasksId has an error boundary, this bubbles up to
          // the root since it's the closest "active" rendered route with an
          // error boundary
          root: new Error("Fetcher error"),
        },
      });
      expect(t.router.state.fetchers.get(key)).toBe(undefined);
    });

    it("revalidates fetchers on fetcher action submissions", async () => {
      let key = "key";
      let actionKey = "actionKey";
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
      });

      // Load a fetcher
      let A = await t.fetch("/tasks/1", key);
      await A.loaders.tasksId.resolve("TASKS ID");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "TASKS ID",
      });

      // Submit a fetcher, leaves loaded fetcher untouched
      let C = await t.fetch("/tasks", actionKey, {
        formMethod: "post",
        formData: createFormData({}),
      });
      t.shimHelper(C.loaders, "fetch", "loader", "tasksId");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "TASKS ID",
      });
      expect(t.router.state.fetchers.get(actionKey)).toMatchObject({
        state: "submitting",
      });

      // After action resolves, both fetchers go into a loading state, with
      // the load fetcher still reflecting it's stale data
      await C.actions.tasks.resolve("TASKS ACTION");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "loading",
        data: "TASKS ID",
      });
      expect(t.router.state.fetchers.get(actionKey)).toMatchObject({
        state: "loading",
        data: "TASKS ACTION",
      });

      // All go back to idle on resolutions
      await C.loaders.root.resolve("ROOT*");
      await C.loaders.index.resolve("INDEX*");
      await C.loaders.tasksId.resolve("TASKS ID*");

      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT*",
        index: "INDEX*",
      });
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "TASKS ID*",
      });
      expect(t.router.state.fetchers.get(actionKey)).toMatchObject({
        state: "idle",
        data: "TASKS ACTION",
      });
    });

    it("does not revalidate fetchers initiated from removed routes", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
      });

      let key = "key";

      // Trigger a fetch from the index route
      let A = await t.fetch("/tasks/1", key, "index");
      await A.loaders.tasksId.resolve("TASKS");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "TASKS",
      });

      // Navigate such that the index route will be removed
      let B = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({}),
      });

      // Resolve the action
      await B.actions.tasks.resolve("TASKS ACTION");

      // Fetcher should remain in an idle state since it's calling route is
      // being removed
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "TASKS",
      });

      // Resolve navigation loaders
      await B.loaders.root.resolve("ROOT*");
      await B.loaders.tasks.resolve("TASKS LOADER");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.location.pathname).toBe("/tasks");

      // Fetcher never got called
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "TASKS",
      });
    });

    it("cancels in-flight fetcher.loads on action submission and forces reload", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            children: [
              {
                id: "index",
                index: true,
              },
              {
                id: "action",
                path: "action",
                action: true,
              },
              // fetch A will resolve before the action and will be able to opt-out
              {
                id: "fetchA",
                path: "fetch-a",
                loader: true,
                shouldRevalidate: () => false,
              },
              // fetch B will resolve before the action but then issue a second
              // load that gets cancelled.  It will not be able to opt out because
              // of the cancellation
              {
                id: "fetchB",
                path: "fetch-b",
                loader: true,
                shouldRevalidate: () => false,
              },
              // fetch C will not resolve before the action, and will not be able to opt
              // out because it has no data
              {
                id: "fetchC",
                path: "fetch-c",
                loader: true,
                shouldRevalidate: () => false,
              },
            ],
          },
        ],
        initialEntries: ["/"],
        hydrationData: { loaderData: { index: "INDEX" } },
      });
      expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

      let keyA = "a";
      let A = await t.fetch("/fetch-a", keyA);
      await A.loaders.fetchA.resolve("A");
      expect(t.router.state.fetchers.get(keyA)).toMatchObject({
        state: "idle",
        data: "A",
      });

      let keyB = "b";
      let B = await t.fetch("/fetch-b", keyB);
      await B.loaders.fetchB.resolve("B");
      expect(t.router.state.fetchers.get(keyB)).toMatchObject({
        state: "idle",
        data: "B",
      });

      // Fetch again for B
      let B2 = await t.fetch("/fetch-b", keyB);
      expect(t.router.state.fetchers.get(keyB)?.state).toBe("loading");

      // Start another fetcher which will not resolve prior to the action
      let keyC = "c";
      let C = await t.fetch("/fetch-c", keyC);
      expect(t.router.state.fetchers.get(keyC)?.state).toBe("loading");

      // Navigation should cancel fetcher and since it has no data
      // shouldRevalidate should be ignored on subsequent fetch
      let D = await t.navigate("/action", {
        formMethod: "post",
        formData: createFormData({}),
      });
      // Add a helper for the fetcher that will be revalidating
      t.shimHelper(D.loaders, "navigation", "loader", "fetchA");
      t.shimHelper(D.loaders, "navigation", "loader", "fetchB");
      t.shimHelper(D.loaders, "navigation", "loader", "fetchC");

      // Fetcher load aborted and still in a loading state
      expect(t.router.state.navigation.state).toBe("submitting");
      expect(A.loaders.fetchA.signal.aborted).toBe(false);
      expect(B.loaders.fetchB.signal.aborted).toBe(false);
      expect(B2.loaders.fetchB.signal.aborted).toBe(true);
      expect(C.loaders.fetchC.signal.aborted).toBe(true);
      expect(t.router.state.fetchers.get(keyA)?.state).toBe("idle");
      expect(t.router.state.fetchers.get(keyB)?.state).toBe("loading");
      expect(t.router.state.fetchers.get(keyC)?.state).toBe("loading");
      await B.loaders.fetchB.resolve("B"); // ignored due to abort
      await C.loaders.fetchC.resolve("C"); // ignored due to abort

      // Resolve the action
      await D.actions.action.resolve("ACTION");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.fetchers.get(keyA)?.state).toBe("idle");
      expect(t.router.state.fetchers.get(keyB)?.state).toBe("loading");
      expect(t.router.state.fetchers.get(keyC)?.state).toBe("loading");

      // Resolve fetcher loader
      await D.loaders.fetchB.resolve("B2");
      await D.loaders.fetchC.resolve("C");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.fetchers.get(keyA)).toMatchObject({
        state: "idle",
        data: "A",
      });
      expect(t.router.state.fetchers.get(keyB)).toMatchObject({
        state: "idle",
        data: "B2",
      });
      expect(t.router.state.fetchers.get(keyC)).toMatchObject({
        state: "idle",
        data: "C",
      });
    });

    it("cancels in-flight fetcher.loads on fetcher.action submission and forces reload (one time)", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            children: [
              {
                id: "index",
                index: true,
              },
              {
                id: "page",
                path: "page",
                action: true,
              },
              {
                id: "action",
                path: "action",
                action: true,
              },
              {
                id: "fetch",
                path: "fetch",
                loader: true,
                shouldRevalidate: () => false,
              },
            ],
          },
        ],
      });
      expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

      // Kick off a fetch from the root route
      let keyA = "a";
      let A = await t.fetch("/fetch", keyA, "root");
      expect(t.router.state.fetchers.get(keyA)).toMatchObject({
        state: "loading",
        data: undefined,
      });

      // Interrupt with a fetcher submission which will trigger a forced
      // revalidation, ignoring shouldRevalidate=false since the prior load
      // was interrupted
      let keyB = "b";
      let B = await t.fetch("/action", keyB, {
        formMethod: "post",
        formData: createFormData({}),
      });
      t.shimHelper(B.loaders, "fetch", "loader", "fetch");
      expect(t.router.state.fetchers.get(keyB)).toMatchObject({
        state: "submitting",
        data: undefined,
      });

      // Resolving the first load is a no-op since it would have been aborted
      await A.loaders.fetch.resolve("A LOADER");
      expect(t.router.state.fetchers.get(keyA)).toMatchObject({
        state: "loading",
        data: undefined,
      });

      // Resolve the action, kicking off revalidations which will force the
      // fetcher "a" load to run again even through shouldRevalidate=false
      await B.actions.action.resolve("B ACTION");
      expect(t.router.state.fetchers.get(keyB)).toMatchObject({
        state: "loading",
        data: "B ACTION",
      });
      expect(t.router.state.fetchers.get(keyA)).toMatchObject({
        state: "loading",
        data: undefined,
      });

      // Resolve the second loader kicked off after the action
      await B.loaders.fetch.resolve("B LOADER");
      expect(t.router.state.fetchers.get(keyA)).toMatchObject({
        state: "idle",
        data: "B LOADER",
      });

      // submitting to another route
      let C = await t.navigate("/page", {
        formMethod: "post",
        formData: createFormData({}),
      });
      t.shimHelper(C.loaders, "navigation", "loader", "fetch");
      expect(t.router.state.navigation.location?.pathname).toBe("/page");

      // should not trigger a fetcher reload due to shouldRevalidate=false
      // This fixes a prior bug where we didn't remove the fetcher from
      // cancelledFetcherLoaders upon the forced revalidation
      await C.actions.page.resolve("PAGE ACTION");
      expect(t.router.state.location.pathname).toBe("/page");
      expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);
      expect(t.router.state.fetchers.get(keyA)).toMatchObject({
        state: "idle",
        data: "B LOADER",
      });
      expect(C.loaders.fetch.stub).not.toHaveBeenCalled();
    });

    // This is another example of the above bug where cancelled fetchers were not
    // cleaned up correctly (https://github.com/remix-run/remix/issues/8298).
    // It was also fixed by https://github.com/remix-run/react-router/pull/11839
    it("Remix Github Issue 8298", async () => {
      let loaderCount = 0;
      let router = createRouter({
        history: createMemoryHistory(),
        routes: [
          {
            id: "index",
            path: "/",
          },
          {
            id: "loader",
            path: "/loader",
            async loader() {
              let count = ++loaderCount;
              await sleep(100);
              return count;
            },
          },
          {
            id: "action",
            path: "/action",
            async action() {
              await sleep(100);
              return "ACTION";
            },
          },
        ],
      });
      router.initialize();

      router.fetch("a", "index", "/loader");
      expect(router.getFetcher("a")).toMatchObject({ state: "loading" });

      await sleep(250);
      router.revalidate();

      await sleep(250);
      router.fetch("b", "index", "/action", {
        formMethod: "post",
        body: createFormData({}),
      });
      expect(router.getFetcher("b")).toMatchObject({ state: "submitting" });

      await sleep(250);

      expect(router.getFetcher("b")).toMatchObject({
        state: "idle",
        data: "ACTION",
      });

      // fetcher load, router revalidation, action revalidation
      expect(router.getFetcher("a")).toMatchObject({
        state: "idle",
        data: 3,
      });
    });

    it("does not cancel pending action navigation on deletion of revalidating fetcher", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
      });
      expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

      let key1 = "key1";
      let A = await t.fetch("/tasks/1", key1);
      await A.loaders.tasksId.resolve("TASKS 1");

      let C = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({}),
      });
      // Add a helper for the fetcher that will be revalidating
      t.shimHelper(C.loaders, "navigation", "loader", "tasksId");

      // Resolve the action
      await C.actions.tasks.resolve("TASKS ACTION");

      // Fetcher should go back into a loading state
      expect(t.router.state.fetchers.get(key1)).toMatchObject({
        state: "loading",
        data: "TASKS 1",
      });

      // Delete fetcher in the middle of the revalidation
      t.router.deleteFetcher(key1);
      expect(t.router.state.fetchers.get(key1)).toBeUndefined();

      // Resolve navigation loaders
      await C.loaders.root.resolve("ROOT*");
      await C.loaders.tasks.resolve("TASKS LOADER");

      expect(t.router.state).toMatchObject({
        actionData: {
          tasks: "TASKS ACTION",
        },
        errors: null,
        loaderData: {
          tasks: "TASKS LOADER",
          root: "ROOT*",
        },
      });
      expect(t.router.state.fetchers.size).toBe(0);
    });

    it("does not cancel pending loader navigation on deletion of revalidating fetcher", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
      });
      expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

      let key1 = "key1";
      let A = await t.fetch("/tasks/1", key1);
      await A.loaders.tasksId.resolve("TASKS 1");

      // Submission navigation to trigger revalidations
      let C = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({}),
      });
      await C.actions.tasks.resolve("TASKS ACTION");

      // Fetcher should go back into a loading state
      expect(t.router.state.fetchers.get(key1)).toMatchObject({
        state: "loading",
        data: "TASKS 1",
      });

      // Delete fetcher in the middle of the revalidation
      t.router.deleteFetcher(key1);
      expect(t.router.state.fetchers.get(key1)).toBeUndefined();

      // Resolve navigation action/loaders
      await C.loaders.root.resolve("ROOT*");
      await C.loaders.tasks.resolve("TASKS LOADER");

      expect(t.router.state).toMatchObject({
        errors: null,
        navigation: IDLE_NAVIGATION,
        actionData: {
          tasks: "TASKS ACTION",
        },
        loaderData: {
          tasks: "TASKS LOADER",
          root: "ROOT*",
        },
      });
      expect(t.router.state.fetchers.size).toBe(0);
    });

    it("does not cancel pending router.revalidate() on deletion of revalidating fetcher", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
      });
      expect(t.router.state.navigation).toBe(IDLE_NAVIGATION);

      let key1 = "key1";
      let A = await t.fetch("/tasks/1", key1);
      await A.loaders.tasksId.resolve("TASKS 1");

      // Trigger revalidations
      let C = await t.revalidate();

      // Fetcher should not go back into a loading state since it's a revalidation
      expect(t.router.state.fetchers.get(key1)).toMatchObject({
        state: "idle",
        data: "TASKS 1",
      });

      // Delete fetcher in the middle of the revalidation
      t.router.deleteFetcher(key1);
      expect(t.router.state.fetchers.get(key1)).toBeUndefined();

      // Resolve navigation loaders
      await C.loaders.root.resolve("ROOT*");
      await C.loaders.index.resolve("INDEX*");

      expect(t.router.state).toMatchObject({
        errors: null,
        loaderData: {
          root: "ROOT*",
          index: "INDEX*",
        },
      });
      expect(t.router.state.fetchers.size).toBe(0);
    });

    it("does not cancel pending fetcher submission on deletion of revalidating fetcher", async () => {
      let key = "key";
      let actionKey = "actionKey";
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: { loaderData: { root: "ROOT", index: "INDEX" } },
      });

      // Load a fetcher
      let A = await t.fetch("/tasks/1", key);
      await A.loaders.tasksId.resolve("TASKS ID");

      // Submit a fetcher, leaves loaded fetcher untouched
      let C = await t.fetch("/tasks", actionKey, {
        formMethod: "post",
        formData: createFormData({}),
      });

      // After action resolves, both fetchers go into a loading state, with
      // the load fetcher still reflecting it's stale data
      await C.actions.tasks.resolve("TASKS ACTION");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "loading",
        data: "TASKS ID",
      });
      expect(t.router.state.fetchers.get(actionKey)).toMatchObject({
        state: "loading",
        data: "TASKS ACTION",
      });

      // Delete fetcher in the middle of the revalidation
      t.router.deleteFetcher(key);
      expect(t.router.state.fetchers.get(key)).toBeUndefined();

      // Resolve only active route loaders since fetcher was deleted
      await C.loaders.root.resolve("ROOT*");
      await C.loaders.index.resolve("INDEX*");

      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT*",
        index: "INDEX*",
      });
      expect(t.router.state.fetchers.get(key)).toBe(undefined);
      expect(t.router.state.fetchers.get(actionKey)).toMatchObject({
        state: "idle",
        data: "TASKS ACTION",
      });
    });

    it("handles revalidating fetcher when the triggering fetcher is deleted", async () => {
      let key = "key";
      let actionKey = "actionKey";
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            children: [
              {
                id: "home",
                index: true,
                loader: true,
              },
              {
                id: "action",
                path: "action",
                action: true,
              },
              {
                id: "fetch",
                path: "fetch",
                loader: true,
              },
            ],
          },
        ],
        hydrationData: { loaderData: { home: "HOME" } },
      });

      // Load a fetcher
      let A = await t.fetch("/fetch", key);
      await A.loaders.fetch.resolve("FETCH");

      // Submit a different fetcher, which will trigger revalidation
      let B = await t.fetch("/action", actionKey, {
        formMethod: "post",
        formData: createFormData({}),
      });
      t.shimHelper(B.loaders, "fetch", "loader", "fetch");

      // After action resolves, both fetchers go into a loading state
      await B.actions.action.resolve("ACTION");
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");
      expect(t.router.state.fetchers.get(actionKey)?.state).toBe("loading");

      // Remove the submitting fetcher (assume it's component unmounts)
      t.router.deleteFetcher(actionKey);

      await B.loaders.home.resolve("HOME*");
      await B.loaders.fetch.resolve("FETCH*");

      expect(t.router.state.loaderData).toEqual({ home: "HOME*" });
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "FETCH*",
      });
      expect(t.router.state.fetchers.get(actionKey)).toBeUndefined();
    });

    it("does not call shouldRevalidate on POST navigation if fetcher has not yet loaded", async () => {
      // This is specifically for a Remix use case where the initial fetcher.load
      // call hasn't completed (and hasn't even loaded the route module yet), so
      // there isn't even a shouldRevalidate implementation to access yet.  If
      // there's no data it should just interrupt the existing load and load again,
      // it's not a "revalidation"
      let spy = jest.fn(() => true);
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            children: [
              {
                index: true,
              },
              {
                id: "page",
                path: "page",
                action: true,
              },
            ],
          },
          {
            id: "fetch",
            path: "/fetch",
            loader: true,
            shouldRevalidate: spy,
          },
        ],
      });

      let key = "key";
      let A = await t.fetch("/fetch", key, "root");
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      // This should trigger an automatic revalidation of the fetcher since it
      // hasn't loaded yet
      let B = await t.navigate(
        "/page",
        { formMethod: "post", body: createFormData({}) },
        ["fetch"]
      );
      await B.actions.page.resolve("ACTION");
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");
      expect(A.loaders.fetch.signal.aborted).toBe(true);
      expect(B.loaders.fetch.signal.aborted).toBe(false);

      // No-op since the original call was aborted
      await A.loaders.fetch.resolve("A");
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      // Complete the navigation
      await B.loaders.fetch.resolve("B");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "B",
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it("does not trigger revalidation on GET navigation if fetcher has not yet loaded", async () => {
      let spy = jest.fn(() => true);
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            children: [
              {
                index: true,
              },
              {
                id: "page",
                path: "page",
                loader: true,
              },
            ],
          },
          {
            id: "fetch",
            path: "/fetch",
            loader: true,
            shouldRevalidate: spy,
          },
        ],
      });

      let key = "key";
      let A = await t.fetch("/fetch", key, "root");
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");

      let B = await t.navigate("/page");
      expect(t.router.state.fetchers.get(key)?.state).toBe("loading");
      expect(A.loaders.fetch.signal.aborted).toBe(false);

      await A.loaders.fetch.resolve("A");
      expect(t.router.state.fetchers.get(key)?.state).toBe("idle");

      // Complete the navigation
      await B.loaders.page.resolve("PAGE");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.fetchers.get(key)).toMatchObject({
        state: "idle",
        data: "A",
      });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("fetcher ?index params", () => {
    it("hits the proper Routes when ?index params are present", async () => {
      let t = setup({
        routes: [
          {
            id: "parent",
            path: "parent",
            action: true,
            loader: true,
            // Turn off revalidation after fetcher action submission for this test
            shouldRevalidate: () => false,
            children: [
              {
                id: "index",
                index: true,
                action: true,
                loader: true,
                // Turn off revalidation after fetcher action submission for this test
                shouldRevalidate: () => false,
              },
            ],
          },
        ],
        initialEntries: ["/parent"],
        hydrationData: { loaderData: { parent: "PARENT", index: "INDEX" } },
      });

      let key = "KEY";

      // fetcher.load()
      let A = await t.fetch("/parent", key);
      await A.loaders.parent.resolve("PARENT LOADER");
      expect(t.router.getFetcher(key).data).toBe("PARENT LOADER");

      let B = await t.fetch("/parent?index", key);
      await B.loaders.index.resolve("INDEX LOADER");
      expect(t.router.getFetcher(key).data).toBe("INDEX LOADER");

      // fetcher.submit({}, { method: 'get' })
      let C = await t.fetch("/parent", key, {
        formMethod: "get",
        formData: createFormData({}),
      });
      await C.loaders.parent.resolve("PARENT LOADER");
      expect(t.router.getFetcher(key).data).toBe("PARENT LOADER");

      let D = await t.fetch("/parent?index", key, {
        formMethod: "get",
        formData: createFormData({}),
      });
      await D.loaders.index.resolve("INDEX LOADER");
      expect(t.router.getFetcher(key).data).toBe("INDEX LOADER");

      // fetcher.submit({}, { method: 'post' })
      let E = await t.fetch("/parent", key, {
        formMethod: "post",
        formData: createFormData({}),
      });
      await E.actions.parent.resolve("PARENT ACTION");
      expect(t.router.getFetcher(key).data).toBe("PARENT ACTION");

      let F = await t.fetch("/parent?index", key, {
        formMethod: "post",
        formData: createFormData({}),
      });
      await F.actions.index.resolve("INDEX ACTION");
      expect(t.router.getFetcher(key).data).toBe("INDEX ACTION");
    });

    it("throws a 404 ErrorResponse without ?index and parent route has no loader", async () => {
      let t = setup({
        routes: [
          {
            id: "parent",
            path: "parent",
            children: [
              {
                id: "index",
                index: true,
                loader: true,
              },
            ],
          },
        ],
        initialEntries: ["/parent"],
        hydrationData: { loaderData: { index: "INDEX" } },
      });

      let key = "KEY";
      await t.fetch("/parent");
      await tick();
      expect(t.router.state.errors).toMatchInlineSnapshot(`
        {
          "parent": ErrorResponseImpl {
            "data": "Error: No route matches URL "/parent"",
            "error": [Error: No route matches URL "/parent"],
            "internal": true,
            "status": 404,
            "statusText": "Not Found",
          },
        }
      `);
      expect(t.router.getFetcher(key).data).toBe(undefined);
    });

    it("throws a 404 ErrorResponse with ?index and index route has no loader", async () => {
      let t = setup({
        routes: [
          {
            id: "parent",
            path: "parent",
            loader: true,
            children: [
              {
                id: "index",
                index: true,
              },
            ],
          },
        ],
        initialEntries: ["/parent"],
        hydrationData: { loaderData: { parent: "PARENT" } },
      });

      let key = "KEY";
      await t.fetch("/parent?index");
      await tick();
      expect(t.router.state.errors).toMatchInlineSnapshot(`
        {
          "parent": ErrorResponseImpl {
            "data": "Error: No route matches URL "/parent?index"",
            "error": [Error: No route matches URL "/parent?index"],
            "internal": true,
            "status": 404,
            "statusText": "Not Found",
          },
        }
      `);
      expect(t.router.getFetcher(key).data).toBe(undefined);
    });

    it("throws a 405 ErrorResponse without ?index and parent route has no action", async () => {
      let t = setup({
        routes: [
          {
            id: "parent",
            path: "parent",
            children: [
              {
                id: "index",
                index: true,
                action: true,
              },
            ],
          },
        ],
        initialEntries: ["/parent"],
      });

      let key = "KEY";
      await t.fetch("/parent", {
        formMethod: "post",
        formData: createFormData({}),
      });
      expect(t.router.state.errors).toMatchInlineSnapshot(`
        {
          "parent": ErrorResponseImpl {
            "data": "Error: You made a POST request to "/parent" but did not provide an \`action\` for route "parent", so there is no way to handle the request.",
            "error": [Error: You made a POST request to "/parent" but did not provide an \`action\` for route "parent", so there is no way to handle the request.],
            "internal": true,
            "status": 405,
            "statusText": "Method Not Allowed",
          },
        }
      `);
      expect(t.router.getFetcher(key).data).toBe(undefined);
    });

    it("throws a 405 ErrorResponse with ?index and index route has no action", async () => {
      let t = setup({
        routes: [
          {
            id: "parent",
            path: "parent",
            action: true,
            children: [
              {
                id: "index",
                index: true,
              },
            ],
          },
        ],
        initialEntries: ["/parent"],
      });

      let key = "KEY";
      await t.fetch("/parent?index", {
        formMethod: "post",
        formData: createFormData({}),
      });
      expect(t.router.state.errors).toMatchInlineSnapshot(`
        {
          "parent": ErrorResponseImpl {
            "data": "Error: You made a POST request to "/parent?index" but did not provide an \`action\` for route "parent", so there is no way to handle the request.",
            "error": [Error: You made a POST request to "/parent?index" but did not provide an \`action\` for route "parent", so there is no way to handle the request.],
            "internal": true,
            "status": 405,
            "statusText": "Method Not Allowed",
          },
        }
      `);
      expect(t.router.getFetcher(key).data).toBe(undefined);
    });
  });

  describe("fetcher submissions", () => {
    it("serializes body as application/x-www-form-urlencoded", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let body = { a: "1" };
      let F = await t.fetch("/", "key", {
        formMethod: "post",
        formEncType: "application/x-www-form-urlencoded",
        body,
      });
      expect(t.router.state.fetchers.get("key")?.formData?.get("a")).toBe("1");

      await F.actions.root.resolve("ACTION");

      expect(F.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = F.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
      expect((await request.formData()).get("a")).toBe("1");
    });

    it("serializes body as application/json if specified (object)", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let body = { a: "1" };
      let F = await t.fetch("/", "key", {
        formMethod: "post",
        formEncType: "application/json",
        body,
      });
      expect(t.router.state.fetchers.get("key")?.json).toBe(body);
      await F.actions.root.resolve("ACTION");

      expect(F.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = F.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe("application/json");
      expect(await request.json()).toEqual(body);
    });

    it("serializes body as application/json if specified (array)", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let body = [1, 2, 3];
      let F = await t.fetch("/", "key", {
        formMethod: "post",
        formEncType: "application/json",
        body,
      });
      expect(t.router.state.fetchers.get("key")?.json).toBe(body);
      await F.actions.root.resolve("ACTION");

      expect(F.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = F.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe("application/json");
      expect(await request.json()).toEqual(body);
    });

    it("serializes body as application/json if specified (null)", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let body = null;
      let F = await t.fetch("/", "key", {
        formMethod: "post",
        formEncType: "application/json",
        body,
      });
      expect(t.router.state.fetchers.get("key")?.json).toBe(body);
      await F.actions.root.resolve("ACTION");

      expect(F.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = F.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe("application/json");
      expect(await request.json()).toEqual(body);
    });

    it("serializes body as text/plain if specified", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let body = "plain text";
      let F = await t.fetch("/", "key", {
        formMethod: "post",
        formEncType: "text/plain",
        body,
      });
      expect(t.router.state.fetchers.get("key")?.text).toBe(body);

      await F.actions.root.resolve("ACTION");

      expect(F.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = F.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe(
        "text/plain;charset=UTF-8"
      );
      expect(await request.text()).toEqual(body);
    });

    it("serializes body as text/plain if specified (empty string)", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let body = "";
      let F = await t.fetch("/", "key", {
        formMethod: "post",
        formEncType: "text/plain",
        body,
      });
      expect(t.router.state.fetchers.get("key")?.text).toBe(body);

      await F.actions.root.resolve("ACTION");

      expect(F.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = F.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe(
        "text/plain;charset=UTF-8"
      );
      expect(await request.text()).toEqual(body);
    });

    it("serializes body when encType=undefined", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let body = { a: "1" };
      let F = await t.fetch("/", "key", {
        formMethod: "post",
        body,
      });
      expect(t.router.state.fetchers.get("key")?.formData?.get("a")).toBe("1");

      await F.actions.root.resolve("ACTION");

      expect(F.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = F.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
      expect((await request.formData()).get("a")).toBe("1");
    });
  });
});
