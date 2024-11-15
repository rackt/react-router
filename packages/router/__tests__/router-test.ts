import type { HydrationState } from "../index";
import { createMemoryHistory, createRouter, IDLE_NAVIGATION } from "../index";
import type { AgnosticDataRouteObject, AgnosticRouteObject } from "../utils";
import { ErrorResponseImpl } from "../utils";

import {
  deferredData,
  trackedPromise,
  urlMatch,
} from "./utils/custom-matchers";
import {
  cleanup,
  createDeferred,
  setup,
  TASK_ROUTES,
} from "./utils/data-router-setup";
import { createFormData, tick } from "./utils/utils";

interface CustomMatchers<R = jest.Expect> {
  urlMatch(url: string);
  trackedPromise(data?: any, error?: any, aborted?: boolean): R;
  deferredData(
    done: boolean,
    status?: number,
    headers?: Record<string, string>
  ): R;
}

declare global {
  namespace jest {
    interface Expect extends CustomMatchers {}
    interface Matchers<R> extends CustomMatchers<R> {}
    interface InverseAsymmetricMatchers extends CustomMatchers {}
  }
}

expect.extend({
  deferredData,
  trackedPromise,
  urlMatch,
});

function initializeTest(init?: {
  url?: string;
  hydrationData?: HydrationState;
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
            path: "/bar",
            id: "bar",
            loader: true,
            action: true,
          },
          {
            path: "/no-loader",
            id: "noLoader",
          },
        ],
      },
    ],
    hydrationData: init?.hydrationData || {
      loaderData: { root: "ROOT", index: "INDEX" },
    },
    ...(init?.url ? { initialEntries: [init.url] } : {}),
  });
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

// Detect any failures inside the router navigate code
afterEach(() => {
  cleanup();

  // @ts-ignore
  console.warn.mockReset();
});

describe("a router", () => {
  describe("init", () => {
    it("requires routes", async () => {
      let history = createMemoryHistory({ initialEntries: ["/"] });
      expect(() =>
        createRouter({
          routes: [],
          history,
          hydrationData: {},
        })
      ).toThrowErrorMatchingInlineSnapshot(
        `"You must provide a non-empty routes array to createRouter"`
      );
    });

    it("converts routes to data routes", async () => {
      let history = createMemoryHistory({
        initialEntries: ["/child/grandchild"],
      });
      let routes = [
        {
          path: "/",
          children: [
            {
              id: "child-keep-me",
              path: "child",
              children: [
                {
                  path: "grandchild",
                },
              ],
            },
          ],
        },
      ];
      let originalRoutes = JSON.parse(JSON.stringify(routes));
      let router = createRouter({
        routes,
        history,
        hydrationData: {},
      });
      // routes are not mutated in place
      expect(routes).toEqual(originalRoutes);
      expect(router.state.matches).toMatchObject([
        {
          route: {
            id: "0",
          },
        },
        {
          route: {
            id: "child-keep-me",
          },
        },
        {
          route: {
            id: "0-0-0",
          },
        },
      ]);
    });

    it("throws if it finds duplicate route ids", async () => {
      let history = createMemoryHistory({
        initialEntries: ["/child/grandchild"],
      });
      let routes = [
        {
          path: "/",
          children: [
            {
              id: "child",
              path: "child",
              children: [
                {
                  id: "child",
                  path: "grandchild",
                },
              ],
            },
          ],
        },
      ];
      expect(() =>
        createRouter({
          routes,
          history,
          hydrationData: {},
        })
      ).toThrowErrorMatchingInlineSnapshot(
        `"Found a route id collision on id "child".  Route id's must be globally unique within Data Router usages"`
      );
    });

    it("throws if it finds index routes with children", async () => {
      let routes: AgnosticRouteObject[] = [
        // @ts-expect-error
        {
          index: true,
          children: [
            {
              path: "nope",
            },
          ],
        },
      ];
      expect(() =>
        createRouter({
          routes,
          history: createMemoryHistory(),
        })
      ).toThrowErrorMatchingInlineSnapshot(
        `"Cannot specify children on an index route"`
      );
    });

    it("supports a basename prop for route matching", async () => {
      let history = createMemoryHistory({
        initialEntries: ["/base/name/path"],
      });
      let router = createRouter({
        basename: "/base/name",
        routes: [{ path: "path" }],
        history,
      });
      expect(router.state).toMatchObject({
        location: {
          hash: "",
          key: expect.any(String),
          pathname: "/base/name/path",
          search: "",
          state: null,
        },
        matches: [
          {
            params: {},
            pathname: "/path",
            pathnameBase: "/path",
            route: {
              id: "0",
              path: "path",
            },
          },
        ],
        initialized: true,
      });
    });

    it("supports a basename prop for route matching and make sure it has a leading /", async () => {
      let history = createMemoryHistory({
        initialEntries: ["/base/name/path"],
      });
      let router = createRouter({
        basename: "base/name",
        routes: [{ path: "path" }],
        history,
      });
      expect(router.state).toMatchObject({
        location: {
          hash: "",
          key: expect.any(String),
          pathname: "/base/name/path",
          search: "",
          state: null,
        },
        matches: [
          {
            params: {},
            pathname: "/path",
            pathnameBase: "/path",
            route: {
              id: "0",
              path: "path",
            },
          },
        ],
        initialized: true,
      });
    });

    it("supports subscribers", async () => {
      let history = createMemoryHistory({ initialEntries: ["/"] });
      let count = 0;
      let router = createRouter({
        routes: [
          {
            id: "root",
            path: "/",
            hasErrorBoundary: true,
            loader: () => ++count,
          },
        ],
        history,
        hydrationData: {
          loaderData: { root: 0 },
        },
      }).initialize();
      expect(router.state.loaderData).toEqual({
        root: 0,
      });

      let subscriber = jest.fn();
      let unsubscribe = router.subscribe(subscriber);
      let subscriber2 = jest.fn();
      let unsubscribe2 = router.subscribe(subscriber2);

      await router.navigate("/?key=a");
      expect(subscriber.mock.calls[0][0].navigation.state).toBe("loading");
      expect(subscriber.mock.calls[0][0].navigation.location.search).toBe(
        "?key=a"
      );
      expect(subscriber.mock.calls[1][0].navigation.state).toBe("idle");
      expect(subscriber.mock.calls[1][0].location.search).toBe("?key=a");
      expect(subscriber2.mock.calls[0][0].navigation.state).toBe("loading");
      expect(subscriber2.mock.calls[0][0].navigation.location.search).toBe(
        "?key=a"
      );
      expect(subscriber2.mock.calls[1][0].navigation.state).toBe("idle");
      expect(subscriber2.mock.calls[1][0].location.search).toBe("?key=a");

      unsubscribe2();
      await router.navigate("/?key=b");
      expect(subscriber.mock.calls[2][0].navigation.state).toBe("loading");
      expect(subscriber.mock.calls[2][0].navigation.location.search).toBe(
        "?key=b"
      );
      expect(subscriber.mock.calls[3][0].navigation.state).toBe("idle");
      expect(subscriber.mock.calls[3][0].location.search).toBe("?key=b");

      unsubscribe();
      await router.navigate("/?key=c");
      expect(subscriber).toHaveBeenCalledTimes(4);
      expect(subscriber2).toHaveBeenCalledTimes(2);
    });
  });

  describe("no route match", () => {
    it("navigations to root catch", () => {
      let t = initializeTest();
      t.navigate("/not-found");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT",
      });
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponseImpl(
          404,
          "Not Found",
          new Error('No route matches URL "/not-found"'),
          true
        ),
      });
      expect(t.router.state.matches).toMatchObject([
        {
          params: {},
          pathname: "",
          route: {
            hasErrorBoundary: true,
            children: expect.any(Array),
            id: "root",
            loader: expect.any(Function),
            path: "",
          },
        },
      ]);
    });

    it("matches root pathless route", () => {
      let t = setup({
        routes: [{ id: "root", children: [{ path: "foo" }] }],
      });

      t.navigate("/not-found");
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponseImpl(
          404,
          "Not Found",
          new Error('No route matches URL "/not-found"'),
          true
        ),
      });
      expect(t.router.state.matches).toMatchObject([
        {
          params: {},
          pathname: "",
          route: {
            id: "root",
            children: expect.any(Array),
          },
        },
      ]);
    });

    it("clears prior loader/action data", async () => {
      let t = initializeTest();
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT",
        index: "INDEX",
      });

      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await A.actions.foo.resolve("ACTION");
      await A.loaders.root.resolve("ROOT*");
      await A.loaders.foo.resolve("LOADER");
      expect(t.router.state.actionData).toEqual({
        foo: "ACTION",
      });
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
        foo: "LOADER",
      });

      t.navigate("/not-found");
      expect(t.router.state.actionData).toBe(null);
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
      });
      expect(t.router.state.errors).toEqual({
        root: new ErrorResponseImpl(
          404,
          "Not Found",
          new Error('No route matches URL "/not-found"'),
          true
        ),
      });
      expect(t.router.state.matches).toMatchObject([
        {
          params: {},
          pathname: "",
          route: {
            hasErrorBoundary: true,
            children: expect.any(Array),
            id: "root",
            loader: expect.any(Function),
            path: "",
          },
        },
      ]);
    });
  });

  describe("navigation (new)", () => {
    it("navigates through a history stack without data loading", async () => {
      let t = setup({
        routes: [
          {
            id: "index",
            index: true,
          },
          {
            id: "tasks",
            path: "tasks",
          },
          {
            id: "tasksId",
            path: "tasks/:id",
          },
        ],
        initialEntries: ["/"],
      });

      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
          search: "",
          hash: "",
          state: null,
          key: expect.any(String),
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        matches: [expect.objectContaining({ pathname: "/" })],
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await t.navigate("/tasks");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks",
          search: "",
          hash: "",
          state: null,
          key: expect.any(String),
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        matches: [expect.objectContaining({ pathname: "/tasks" })],
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks");

      await t.navigate("/tasks/1", { replace: true });
      expect(t.router.state).toMatchObject({
        historyAction: "REPLACE",
        location: {
          pathname: "/tasks/1",
          search: "",
          hash: "",
          state: null,
          key: expect.any(String),
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        matches: [expect.objectContaining({ pathname: "/tasks/1" })],
      });
      expect(t.history.action).toEqual("REPLACE");
      expect(t.history.location.pathname).toEqual("/tasks/1");

      t.router.navigate(-1);
      await tick();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
          search: "",
          hash: "",
          state: null,
          key: expect.any(String),
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        matches: [expect.objectContaining({ pathname: "/" })],
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await t.navigate("/tasks?foo=bar#hash");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks",
          search: "?foo=bar",
          hash: "#hash",
          state: null,
          key: expect.any(String),
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        matches: [expect.objectContaining({ pathname: "/tasks" })],
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location).toEqual({
        pathname: "/tasks",
        search: "?foo=bar",
        hash: "#hash",
        state: null,
        key: expect.any(String),
      });
    });

    it("navigates through a history stack without data loading (with a basename)", async () => {
      let t = setup({
        basename: "/base/name",
        routes: [
          {
            id: "index",
            index: true,
          },
          {
            id: "tasks",
            path: "tasks",
          },
          {
            id: "tasksId",
            path: "tasks/:id",
          },
        ],
        initialEntries: ["/base/name"],
      });

      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/base/name",
        },
        matches: [{ route: { id: "index" } }],
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/base/name");

      await t.navigate("/base/name/tasks");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/base/name/tasks",
        },
        matches: [{ route: { id: "tasks" } }],
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/base/name/tasks");

      await t.navigate("/base/name/tasks/1");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/base/name/tasks/1",
        },
        matches: [{ route: { id: "tasksId" } }],
      });
      expect(t.history.location.pathname).toEqual("/base/name/tasks/1");
    });

    it("handles 404 routes", () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
      });
      t.navigate("/junk");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/junk",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {},
        errors: {
          root: new ErrorResponseImpl(
            404,
            "Not Found",
            new Error('No route matches URL "/junk"'),
            true
          ),
        },
      });
    });

    it("handles 404 routes when the root route contains a path (initialization)", () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/path",
            children: [
              {
                index: true,
              },
            ],
          },
        ],
        initialEntries: ["/junk"],
      });
      expect(t.router.state).toMatchObject({
        errors: {
          root: new ErrorResponseImpl(
            404,
            "Not Found",
            new Error('No route matches URL "/junk"'),
            true
          ),
        },
        initialized: true,
        location: {
          pathname: "/junk",
        },
        matches: [
          {
            route: {
              id: "root",
            },
          },
        ],
      });
    });

    it("handles 404 routes when the root route contains a path (navigation)", () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/path",
            children: [
              {
                index: true,
              },
            ],
          },
        ],
        initialEntries: ["/path"],
      });
      expect(t.router.state).toMatchObject({
        errors: null,
      });
      t.navigate("/junk");
      expect(t.router.state).toMatchObject({
        errors: {
          root: new ErrorResponseImpl(
            404,
            "Not Found",
            new Error('No route matches URL "/junk"'),
            true
          ),
        },
        location: {
          pathname: "/junk",
        },
        matches: [
          {
            route: {
              id: "root",
            },
          },
        ],
      });
    });

    it("converts formData to URLSearchParams for unspecified formMethod", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
      });
      await t.navigate("/tasks", {
        formData: createFormData({ key: "value" }),
      });
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location).toMatchObject({
        pathname: "/tasks",
        search: "?key=value",
      });
      expect(t.router.state.navigation.formMethod).toBe("get");
      expect(t.router.state.navigation.formData).toEqual(
        createFormData({ key: "value" })
      );
    });

    it("converts formData to URLSearchParams for formMethod=get", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
      });
      await t.navigate("/tasks", {
        formMethod: "get",
        formData: createFormData({ key: "value" }),
      });
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location).toMatchObject({
        pathname: "/tasks",
        search: "?key=value",
      });
      expect(t.router.state.navigation.formMethod).toBe("get");
      expect(t.router.state.navigation.formData).toEqual(
        createFormData({ key: "value" })
      );
    });

    it("does not preserve existing 'action' URLSearchParams for formMethod='get'", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
      });
      await t.navigate("/tasks?key=1", {
        formMethod: "get",
        formData: createFormData({ key: "2" }),
      });
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.navigation.location).toMatchObject({
        pathname: "/tasks",
        search: "?key=2",
      });
      expect(t.router.state.navigation.formMethod).toBe("get");
      expect(t.router.state.navigation.formData).toEqual(
        createFormData({ key: "2" })
      );
    });

    it("preserves existing 'action' URLSearchParams for formMethod='post'", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
      });
      await t.navigate("/tasks?key=1", {
        formMethod: "post",
        formData: createFormData({ key: "2" }),
      });
      expect(t.router.state.navigation.state).toBe("submitting");
      expect(t.router.state.navigation.location).toMatchObject({
        pathname: "/tasks",
        search: "?key=1",
      });
      expect(t.router.state.navigation.formMethod).toBe("post");
      expect(t.router.state.navigation.formData).toEqual(
        createFormData({ key: "2" })
      );
    });

    it("url-encodes File names on GET submissions", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      let formData = new FormData();
      formData.append(
        "blob",
        new Blob(["<h1>Some html file contents</h1>"], {
          type: "text/html",
        }),
        "blob.html"
      );

      let A = await t.navigate("/tasks", {
        formMethod: "get",
        formData: formData,
      });
      let params = new URL(A.loaders.tasks.stub.mock.calls[0][0].request.url)
        .searchParams;
      expect(params.get("blob")).toEqual("blob.html");
    });

    it("returns a 405 error if attempting to submit with method=HEAD", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      let formData = new FormData();
      formData.append(
        "blob",
        new Blob(["<h1>Some html file contents</h1>"], {
          type: "text/html",
        })
      );

      await t.navigate("/tasks", {
        // @ts-expect-error
        formMethod: "head",
        formData,
      });
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.location).toMatchObject({
        pathname: "/tasks",
        search: "",
      });
      expect(t.router.state.errors).toEqual({
        tasks: new ErrorResponseImpl(
          405,
          "Method Not Allowed",
          new Error('Invalid request method "HEAD"'),
          true
        ),
      });
    });

    it("returns a 405 error if attempting to submit with method=OPTIONS", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      let formData = new FormData();
      formData.append(
        "blob",
        new Blob(["<h1>Some html file contents</h1>"], {
          type: "text/html",
        })
      );

      await t.navigate("/tasks", {
        // @ts-expect-error
        formMethod: "options",
        formData: formData,
      });
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.location).toMatchObject({
        pathname: "/tasks",
        search: "",
      });
      expect(t.router.state.errors).toEqual({
        tasks: new ErrorResponseImpl(
          405,
          "Method Not Allowed",
          new Error('Invalid request method "OPTIONS"'),
          true
        ),
      });
    });
  });

  describe("data loading (new)", () => {
    it("marks as initialized immediately when no loaders are present", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
          },
        ],
        initialEntries: ["/"],
      });

      expect(console.warn).not.toHaveBeenCalled();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {},
      });
    });

    it("hydrates initial data", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      expect(console.warn).not.toHaveBeenCalled();
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT DATA",
          index: "INDEX DATA",
        },
      });
    });

    it("kicks off initial data load if no hydration data is provided", async () => {
      let parentDfd = createDeferred();
      let parentSpy = jest.fn(() => parentDfd.promise);
      let childDfd = createDeferred();
      let childSpy = jest.fn(() => childDfd.promise);
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/child"] }),
        routes: [
          {
            path: "/",
            loader: parentSpy,
            children: [
              {
                path: "child",
                loader: childSpy,
              },
            ],
          },
        ],
      });
      router.initialize();

      expect(console.warn).not.toHaveBeenCalled();
      expect(parentSpy.mock.calls.length).toBe(1);
      expect(childSpy.mock.calls.length).toBe(1);
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/child" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      await parentDfd.resolve("PARENT DATA");
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/child" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      await childDfd.resolve("CHILD DATA");
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {
          "0": "PARENT DATA",
          "0-0": "CHILD DATA",
        },
      });

      router.dispose();
    });

    it("handles interruptions of initial data load", async () => {
      let parentDfd = createDeferred();
      let parentSpy = jest.fn(() => parentDfd.promise);
      let childDfd = createDeferred();
      let childSpy = jest.fn(() => childDfd.promise);
      let child2Dfd = createDeferred();
      let child2Spy = jest.fn(() => child2Dfd.promise);
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/child"] }),
        routes: [
          {
            path: "/",
            loader: parentSpy,
            children: [
              {
                path: "child",
                loader: childSpy,
              },
              {
                path: "child2",
                loader: child2Spy,
              },
            ],
          },
        ],
      });
      router.initialize();

      expect(console.warn).not.toHaveBeenCalled();
      expect(parentSpy.mock.calls.length).toBe(1);
      expect(childSpy.mock.calls.length).toBe(1);
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/child" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      await parentDfd.resolve("PARENT DATA");
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/child" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      router.navigate("/child2");
      await childDfd.resolve("CHILD DATA");
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/child2" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      await child2Dfd.resolve("CHILD2 DATA");
      expect(router.state).toMatchObject({
        historyAction: "PUSH",
        location: expect.objectContaining({ pathname: "/child2" }),
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {
          "0": "PARENT DATA",
          "0-1": "CHILD2 DATA",
        },
      });

      router.dispose();
    });

    it("handles errors in initial data load", async () => {
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/child"] }),
        routes: [
          {
            path: "/",
            loader: () => Promise.reject("Kaboom!"),
            children: [
              {
                path: "child",
                loader: () => Promise.resolve("child"),
              },
            ],
          },
        ],
      });
      router.initialize();

      await tick();
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/child" }),
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {
          "0-0": "child",
        },
        errors: {
          "0": "Kaboom!",
        },
      });

      router.dispose();
    });

    it("kicks off initial data load when hash is present", async () => {
      let loaderDfd = createDeferred();
      let loaderSpy = jest.fn(() => loaderDfd.promise);
      let router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/#hash"] }),
        routes: [
          {
            path: "/",
            loader: loaderSpy,
          },
        ],
      });
      router.initialize();

      expect(console.warn).not.toHaveBeenCalled();
      expect(loaderSpy.mock.calls.length).toBe(1);
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/", hash: "#hash" }),
        initialized: false,
        navigation: {
          state: "loading",
          location: { pathname: "/", hash: "#hash" },
        },
      });
      expect(router.state.loaderData).toEqual({});

      await loaderDfd.resolve("DATA");
      expect(router.state).toMatchObject({
        historyAction: "POP",
        location: expect.objectContaining({ pathname: "/", hash: "#hash" }),
        initialized: true,
        navigation: IDLE_NAVIGATION,
        loaderData: {
          "0": "DATA",
        },
      });

      router.dispose();
    });

    it("executes loaders on push navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let nav1 = await t.navigate("/tasks");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await nav1.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasks: "TASKS_DATA",
        },
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks");

      let nav2 = await t.navigate("/tasks/1");
      await nav2.loaders.tasksId.resolve("TASKS_ID_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks/1",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasksId: "TASKS_ID_DATA",
        },
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks/1");
    });

    it("executes loaders on replace navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let nav = await t.navigate("/tasks", { replace: true });
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await nav.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "REPLACE",
        location: {
          pathname: "/tasks",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasks: "TASKS_DATA",
        },
      });
      expect(t.history.action).toEqual("REPLACE");
      expect(t.history.location.pathname).toEqual("/tasks");
    });

    it("executes loaders on go navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/", "/tasks"],
        initialIndex: 0,
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      // pop forward to /tasks
      let nav2 = await t.navigate(1);
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
          index: "INDEX_DATA",
        },
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/tasks");

      await nav2.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/tasks",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasks: "TASKS_DATA",
        },
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/tasks");
    });

    it("persists location keys throughout navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      expect(t.router.state.location.key).toBe("default");

      let A = await t.navigate("/tasks");
      let navigationKey = t.router.state.navigation.location?.key;
      expect(t.router.state.location.key).toBe("default");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(navigationKey).not.toBe("default");
      expect(Number(navigationKey?.length) > 0).toBe(true);

      await A.loaders.tasks.resolve("TASKS");
      expect(t.router.state.navigation.state).toBe("idle");

      // Make sure we keep the same location.key throughout the navigation and
      // history isn't creating a new one in history.push
      expect(t.router.state.location.key).toBe(navigationKey);
      expect(t.history.location.key).toBe(navigationKey);
    });

    it("sends proper arguments to loaders", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let nav = await t.navigate("/tasks");
      expect(nav.loaders.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: new Request("http://localhost/tasks", {
          signal: nav.loaders.tasks.stub.mock.calls[0][0].request.signal,
        }),
      });

      let nav2 = await t.navigate("/tasks/1");
      expect(nav2.loaders.tasksId.stub).toHaveBeenCalledWith({
        params: { id: "1" },
        request: new Request("http://localhost/tasks/1", {
          signal: nav2.loaders.tasksId.stub.mock.calls[0][0].request.signal,
        }),
      });

      let nav3 = await t.navigate("/tasks?foo=bar#hash");
      expect(nav3.loaders.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: new Request("http://localhost/tasks?foo=bar", {
          signal: nav3.loaders.tasks.stub.mock.calls[0][0].request.signal,
        }),
      });

      let nav4 = await t.navigate("/tasks#hash", {
        formData: createFormData({ foo: "bar" }),
      });
      expect(nav4.loaders.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: new Request("http://localhost/tasks?foo=bar", {
          signal: nav4.loaders.tasks.stub.mock.calls[0][0].request.signal,
        }),
      });

      expect(t.router.state.navigation.formAction).toBe("/tasks");
      expect(t.router.state.navigation?.location?.pathname).toBe("/tasks");
      expect(t.router.state.navigation?.location?.search).toBe("?foo=bar");
    });

    it("handles errors thrown from loaders", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      // Throw from tasks, handled by tasks
      let nav = await t.navigate("/tasks");
      await nav.loaders.tasks.reject("TASKS_ERROR");
      expect(t.router.state.navigation).toEqual(IDLE_NAVIGATION);
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT_DATA",
      });
      expect(t.router.state.errors).toEqual({
        tasks: "TASKS_ERROR",
      });

      // Throw from index, handled by root
      let nav2 = await t.navigate("/");
      await nav2.loaders.index.reject("INDEX_ERROR");
      expect(t.router.state.navigation).toEqual(IDLE_NAVIGATION);
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT_DATA",
      });
      expect(t.router.state.errors).toEqual({
        root: "INDEX_ERROR",
      });
    });

    it("re-runs loaders on post-error navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          errors: {
            root: "ROOT_ERROR",
          },
        },
      });

      // If a route has an error, we should call the loader if that route is
      // re-used on a navigation
      let nav = await t.navigate("/tasks");
      await nav.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state.navigation.state).toEqual("loading");
      expect(t.router.state.loaderData).toEqual({});
      expect(t.router.state.errors).toEqual({
        root: "ROOT_ERROR",
      });

      await nav.loaders.root.resolve("ROOT_DATA");
      expect(t.router.state.navigation).toEqual(IDLE_NAVIGATION);
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT_DATA",
        tasks: "TASKS_DATA",
      });
      expect(t.router.state.errors).toBe(null);
    });

    it("handles interruptions during navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let historySpy = jest.spyOn(t.history, "push");

      let nav = await t.navigate("/tasks");
      expect(t.router.state.navigation.state).toEqual("loading");
      expect(t.router.state.location.pathname).toEqual("/");
      expect(nav.loaders.tasks.signal.aborted).toBe(false);
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      // Interrupt and confirm prior loader was aborted
      let nav2 = await t.navigate("/tasks/1");
      expect(t.router.state.navigation.state).toEqual("loading");
      expect(t.router.state.location.pathname).toEqual("/");
      expect(nav.loaders.tasks.signal.aborted).toBe(true);
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      // Complete second navigation
      await nav2.loaders.tasksId.resolve("TASKS_ID_DATA");
      expect(t.router.state.navigation).toEqual(IDLE_NAVIGATION);
      expect(t.router.state.location.pathname).toEqual("/tasks/1");
      expect(t.history.location.pathname).toEqual("/tasks/1");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT_DATA",
        tasksId: "TASKS_ID_DATA",
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks/1");

      // Resolve first navigation - should no-op
      await nav.loaders.tasks.resolve("TASKS_DATA");
      expect(t.router.state.navigation).toEqual(IDLE_NAVIGATION);
      expect(t.router.state.location.pathname).toEqual("/tasks/1");
      expect(t.history.location.pathname).toEqual("/tasks/1");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT_DATA",
        tasksId: "TASKS_ID_DATA",
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks/1");

      expect(historySpy.mock.calls).toEqual([
        [
          expect.objectContaining({
            pathname: "/tasks/1",
          }),
          null,
        ],
      ]);
    });

    it("handles redirects thrown from loaders", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let nav1 = await t.navigate("/tasks");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      let nav2 = await nav1.loaders.tasks.redirect("/tasks/1");

      // Should not abort if it redirected
      expect(nav1.loaders.tasks.signal.aborted).toBe(false);
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks/1",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await nav2.loaders.tasksId.resolve("TASKS_ID_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks/1",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasksId: "TASKS_ID_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks/1");
    });

    it("handles redirects returned from loaders", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let nav1 = await t.navigate("/tasks");
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      let nav2 = await nav1.loaders.tasks.redirectReturn("/tasks/1");

      // Should not abort if it redirected
      expect(nav1.loaders.tasks.signal.aborted).toBe(false);
      expect(t.router.state).toMatchObject({
        historyAction: "POP",
        location: {
          pathname: "/",
        },
        navigation: {
          location: {
            pathname: "/tasks/1",
          },
          state: "loading",
        },
        loaderData: {
          root: "ROOT_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("POP");
      expect(t.history.location.pathname).toEqual("/");

      await nav2.loaders.tasksId.resolve("TASKS_ID_DATA");
      expect(t.router.state).toMatchObject({
        historyAction: "PUSH",
        location: {
          pathname: "/tasks/1",
        },
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
          tasksId: "TASKS_ID_DATA",
        },
        errors: null,
      });
      expect(t.history.action).toEqual("PUSH");
      expect(t.history.location.pathname).toEqual("/tasks/1");
    });

    it("handles thrown non-redirect Responses as ErrorResponse's (text)", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      // Throw from tasks, handled by tasks
      let nav = await t.navigate("/tasks");
      await nav.loaders.tasks.reject(
        new Response("broken", { status: 400, statusText: "Bad Request" })
      );
      expect(t.router.state).toMatchObject({
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
        },
        actionData: null,
        errors: {
          tasks: new ErrorResponseImpl(400, "Bad Request", "broken"),
        },
      });
    });

    it("handles thrown non-redirect Responses as ErrorResponse's (json)", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      // Throw from tasks, handled by tasks
      let nav = await t.navigate("/tasks");
      await nav.loaders.tasks.reject(
        new Response(JSON.stringify({ key: "value" }), {
          status: 400,
          statusText: "Bad Request",
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
      expect(t.router.state).toMatchObject({
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
        },
        actionData: null,
        errors: {
          tasks: new ErrorResponseImpl(400, "Bad Request", { key: "value" }),
        },
      });
    });

    it("handles thrown non-redirect Responses as ErrorResponse's (json utf8)", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      // Throw from tasks, handled by tasks
      let nav = await t.navigate("/tasks");
      await nav.loaders.tasks.reject(
        new Response(JSON.stringify({ key: "value" }), {
          status: 400,
          statusText: "Bad Request",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        })
      );
      expect(t.router.state).toMatchObject({
        navigation: IDLE_NAVIGATION,
        loaderData: {
          root: "ROOT_DATA",
        },
        actionData: null,
        errors: {
          tasks: new ErrorResponseImpl(400, "Bad Request", { key: "value" }),
        },
      });
    });

    it("sends proper arguments to actions", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let nav = await t.navigate("/tasks", {
        formMethod: "post",
        formData: createFormData({ query: "params" }),
      });
      expect(nav.actions.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: expect.any(Request),
      });

      // Assert request internals, cannot do a deep comparison above since some
      // internals aren't the same on separate creations
      let request = nav.actions.tasks.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/tasks");
      expect(request.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
      expect((await request.formData()).get("query")).toBe("params");

      await nav.actions.tasks.resolve("TASKS ACTION");
      let rootLoaderRequest = nav.loaders.root.stub.mock.calls[0][0].request;
      expect(rootLoaderRequest.method).toBe("GET");
      expect(rootLoaderRequest.url).toBe("http://localhost/tasks");

      let tasksLoaderRequest = nav.loaders.tasks.stub.mock.calls[0][0].request;
      expect(tasksLoaderRequest.method).toBe("GET");
      expect(tasksLoaderRequest.url).toBe("http://localhost/tasks");
    });

    it("sends proper arguments to actions (using query string)", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let formData = createFormData({ query: "params" });

      let nav = await t.navigate("/tasks?foo=bar", {
        formMethod: "post",
        formData,
      });
      expect(nav.actions.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: expect.any(Request),
      });
      // Assert request internals, cannot do a deep comparison above since some
      // internals aren't the same on separate creations
      let request = nav.actions.tasks.stub.mock.calls[0][0].request;
      expect(request.url).toBe("http://localhost/tasks?foo=bar");
      expect(request.method).toBe("POST");
      expect(request.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
      expect((await request.formData()).get("query")).toBe("params");
    });

    // https://fetch.spec.whatwg.org/#concept-method
    it("properly handles method=PATCH weirdness", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
            index: "INDEX_DATA",
          },
        },
      });

      let nav = await t.navigate("/tasks", {
        formMethod: "patch",
        formData: createFormData({ query: "params" }),
      });
      expect(nav.actions.tasks.stub).toHaveBeenCalledWith({
        params: {},
        request: expect.any(Request),
      });

      // Assert request internals, cannot do a deep comparison above since some
      // internals aren't the same on separate creations
      let request = nav.actions.tasks.stub.mock.calls[0][0].request;
      expect(request.method).toBe("PATCH");
      expect(request.url).toBe("http://localhost/tasks");
      expect(request.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
      expect((await request.formData()).get("query")).toBe("params");

      await nav.actions.tasks.resolve("TASKS ACTION");
      let rootLoaderRequest = nav.loaders.root.stub.mock.calls[0][0].request;
      expect(rootLoaderRequest.method).toBe("GET");
      expect(rootLoaderRequest.url).toBe("http://localhost/tasks");

      let tasksLoaderRequest = nav.loaders.tasks.stub.mock.calls[0][0].request;
      expect(tasksLoaderRequest.method).toBe("GET");
      expect(tasksLoaderRequest.url).toBe("http://localhost/tasks");
    });

    it("handles multipart/form-data submissions", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            action: true,
          },
        ],
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
          },
        },
      });

      let fd = new FormData();
      fd.append("key", "value");
      fd.append("file", new Blob(["1", "2", "3"]), "file.txt");

      let A = await t.navigate("/", {
        formMethod: "post",
        formEncType: "multipart/form-data",
        formData: fd,
      });

      expect(
        A.actions.root.stub.mock.calls[0][0].request.headers.get("Content-Type")
      ).toMatch(
        /^multipart\/form-data; boundary=NodeFetchFormDataBoundary[a-z0-9]+/
      );
    });

    it("url-encodes File names on x-www-form-urlencoded submissions", async () => {
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            action: true,
          },
        ],
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT_DATA",
          },
        },
      });

      let fd = new FormData();
      fd.append("key", "value");
      fd.append("file", new Blob(["1", "2", "3"]), "file.txt");

      let A = await t.navigate("/", {
        formMethod: "post",
        formEncType: "application/x-www-form-urlencoded",
        formData: fd,
      });

      let req = A.actions.root.stub.mock.calls[0][0].request.clone();
      expect((await req.formData()).get("file")).toEqual("file.txt");
    });

    it("races actions and loaders against abort signals", async () => {
      let loaderDfd = createDeferred();
      let actionDfd = createDeferred();
      let router = createRouter({
        routes: [
          {
            index: true,
          },
          {
            path: "foo",
            loader: () => loaderDfd.promise,
            action: () => actionDfd.promise,
          },
          {
            path: "bar",
          },
        ],
        hydrationData: { loaderData: { "0": null } },
        history: createMemoryHistory(),
      });

      expect(router.state.initialized).toBe(true);

      let fooPromise = router.navigate("/foo");
      expect(router.state.navigation.state).toBe("loading");

      let barPromise = router.navigate("/bar");

      // This should resolve _without_ us resolving the loader
      await fooPromise;
      await barPromise;

      expect(router.state.navigation.state).toBe("idle");
      expect(router.state.location.pathname).toBe("/bar");

      let fooPromise2 = router.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      expect(router.state.navigation.state).toBe("submitting");

      let barPromise2 = router.navigate("/bar");

      // This should resolve _without_ us resolving the action
      await fooPromise2;
      await barPromise2;

      expect(router.state.navigation.state).toBe("idle");
      expect(router.state.location.pathname).toBe("/bar");

      router.dispose();
    });

    it("throws an error if actions/loaders return undefined", async () => {
      let t = setup({
        routes: [
          {
            index: true,
          },
          {
            id: "path",
            path: "/path",
            loader: true,
            action: true,
          },
        ],
      });

      let nav1 = await t.navigate("/path");
      await nav1.loaders.path.resolve(undefined);
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/path",
        },
        errors: {
          path: new Error(
            'You defined a loader for route "path" but didn\'t return anything ' +
              "from your `loader` function. Please return a value or `null`."
          ),
        },
      });

      await t.navigate("/");
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/",
        },
        errors: {},
      });

      let nav3 = await t.navigate("/path", {
        formMethod: "post",
        formData: createFormData({}),
      });
      await nav3.actions.path.resolve(undefined);
      expect(t.router.state).toMatchObject({
        location: {
          pathname: "/path",
        },
        errors: {
          path: new Error(
            'You defined an action for route "path" but didn\'t return anything ' +
              "from your `action` function. Please return a value or `null`."
          ),
        },
      });
    });
  });

  describe("router.enhanceRoutes", () => {
    // Detect any failures inside the router navigate code
    afterEach(() => cleanup());

    it("should retain existing routes until revalidation completes on loader removal", async () => {
      let t = initializeTest();
      let ogRoutes = t.router.routes;
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("foo");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        foo: "foo",
      });

      let newRoutes = t.enhanceRoutes([
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
              hasErrorBoundary: false,
            },
            {
              path: "/foo",
              id: "foo",
              loader: false,
              action: true,
              hasErrorBoundary: false,
            },
          ],
        },
      ]);
      t._internalSetRoutes(newRoutes);

      // Get a new revalidation helper that should use the updated routes
      let R = await t.revalidate();
      expect(t.router.state.revalidation).toBe("loading");

      // Should still expose be the og routes until revalidation completes
      expect(t.router.routes).toBe(ogRoutes);

      // Resolve any loaders that should have ran (foo's loader has been removed)
      await R.loaders.root.resolve("ROOT*");
      expect(t.router.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(t.router.routes).not.toBe(ogRoutes);
      expect(t.router.routes).toEqual(newRoutes);

      // Loader data should be updated and foo removed
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
      });
      expect(t.router.state.errors).toEqual(null);
    });

    it("should retain existing routes until revalidation completes on loader addition", async () => {
      let t = initializeTest();
      let ogRoutes = t.router.routes;
      await t.navigate("/no-loader");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
      });

      let newRoutes = t.enhanceRoutes([
        {
          path: "",
          id: "root",
          hasErrorBoundary: true,
          loader: true,
          children: [
            {
              path: "/no-loader",
              id: "noLoader",
              loader: true,
              action: true,
              hasErrorBoundary: false,
            },
          ],
        },
      ]);
      t._internalSetRoutes(newRoutes);
      // Get a new revalidation helper that should use the updated routes
      let R = await t.revalidate();
      expect(t.router.state.revalidation).toBe("loading");
      expect(t.router.routes).toBe(ogRoutes);

      // Should still expose be the og routes until revalidation completes
      expect(t.router.routes).toBe(ogRoutes);

      // Resolve any loaders that should have ran
      await R.loaders.root.resolve("ROOT*");
      await R.loaders.noLoader.resolve("NO_LOADER*");
      expect(t.router.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(t.router.routes).not.toBe(ogRoutes);
      expect(t.router.routes).toEqual(newRoutes);

      // Loader data should be updated
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
        noLoader: "NO_LOADER*",
      });
      expect(t.router.state.errors).toEqual(null);
    });

    it("should retain existing routes until interrupting navigation completes", async () => {
      let t = initializeTest();
      let ogRoutes = t.router.routes;
      let A = await t.navigate("/foo");
      await A.loaders.foo.resolve("foo");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        foo: "foo",
      });

      let newRoutes = t.enhanceRoutes([
        {
          path: "",
          id: "root",
          hasErrorBoundary: true,
          loader: true,
          children: [
            {
              path: "/",
              id: "index",
              loader: false,
              action: true,
              hasErrorBoundary: false,
            },
            {
              path: "/foo",
              id: "foo",
              loader: false,
              action: true,
              hasErrorBoundary: false,
            },
          ],
        },
      ]);
      t._internalSetRoutes(newRoutes);

      // Revalidate and interrupt with a navigation
      let R = await t.revalidate();
      let N = await t.navigate("/?revalidate");

      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.revalidation).toBe("loading");

      // Should still expose be the og routes until navigation completes
      expect(t.router.routes).toBe(ogRoutes);

      // Revalidation cancelled so this shouldn't make it through
      await R.loaders.root.resolve("ROOT STALE");

      // Resolve any loaders that should have ran (foo's loader has been removed)
      await N.loaders.root.resolve("ROOT*");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(t.router.routes).not.toBe(ogRoutes);
      expect(t.router.routes).toEqual(newRoutes);

      // Loader data should be updated
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
      });
      expect(t.router.state.errors).toEqual(null);
    });

    it("should retain existing routes until interrupted navigation completes", async () => {
      let t = initializeTest();
      let ogRoutes = t.router.routes;

      let N = await t.navigate("/foo");

      let newRoutes = t.enhanceRoutes([
        {
          path: "",
          id: "root",
          hasErrorBoundary: true,
          loader: true,
          children: [
            {
              path: "/",
              id: "index",
              loader: false,
              action: true,
              hasErrorBoundary: false,
            },
            {
              path: "/foo",
              id: "foo",
              loader: false,
              action: true,
              hasErrorBoundary: false,
            },
          ],
        },
      ]);
      t._internalSetRoutes(newRoutes);

      // Interrupt /foo navigation with a revalidation
      let R = await t.revalidate();

      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.revalidation).toBe("loading");

      // Should still expose be the og routes until navigation completes
      expect(t.router.routes).toBe(ogRoutes);

      // NAvigation interrupted so this shouldn't make it through
      await N.loaders.root.resolve("ROOT STALE");

      // Resolve any loaders that should have ran (foo's loader has been removed)
      await R.loaders.root.resolve("ROOT*");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(t.router.routes).not.toBe(ogRoutes);
      expect(t.router.routes).toEqual(newRoutes);

      // Loader data should be updated
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT*",
      });
      expect(t.router.state.errors).toEqual(null);
    });

    it("should retain existing routes until revalidation completes on loader removal (fetch)", async () => {
      let rootDfd = createDeferred();
      let fooDfd = createDeferred();
      let ogRoutes: AgnosticDataRouteObject[] = [
        {
          path: "/",
          id: "root",
          hasErrorBoundary: true,
          loader: () => rootDfd.promise,
          children: [
            {
              index: true,
              id: "index",
              hasErrorBoundary: false,
            },
            {
              path: "foo",
              id: "foo",
              loader: () => fooDfd.promise,
              children: undefined,
              hasErrorBoundary: false,
            },
          ],
        },
      ];
      let router = createRouter({
        routes: ogRoutes,
        history: createMemoryHistory(),
        hydrationData: {
          loaderData: {
            root: "ROOT INITIAL",
          },
        },
      });
      router.initialize();

      let key = "key";
      router.fetch(key, "root", "/foo");
      await fooDfd.resolve("FOO");
      expect(router.state.fetchers.get("key")?.data).toBe("FOO");

      let rootDfd2 = createDeferred();
      let newRoutes: AgnosticDataRouteObject[] = [
        {
          path: "/",
          id: "root",
          loader: () => rootDfd2.promise,
          hasErrorBoundary: true,
          children: [
            {
              index: true,
              id: "index",
              hasErrorBoundary: false,
            },
            {
              path: "foo",
              id: "foo",
              children: undefined,
              hasErrorBoundary: false,
            },
          ],
        },
      ];

      router._internalSetRoutes(newRoutes);

      // Interrupt /foo navigation with a revalidation
      router.revalidate();

      expect(router.state.revalidation).toBe("loading");

      // Should still expose be the og routes until navigation completes
      expect(router.routes).toEqual(ogRoutes);

      // Resolve any loaders that should have ran (foo's loader has been removed)
      await rootDfd2.resolve("ROOT*");
      expect(router.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(router.routes).not.toEqual(ogRoutes);
      expect(router.routes).toEqual(newRoutes);

      // Loader data should be updated
      expect(router.state.loaderData).toEqual({
        root: "ROOT*",
      });
      // Fetcher should have been revalidated but throw an error since the
      // loader was removed
      expect(router.state.fetchers.get("key")?.data).toBe(undefined);
      expect(router.state.errors).toMatchInlineSnapshot(`
        {
          "root": ErrorResponseImpl {
            "data": "Error: No route matches URL "/foo"",
            "error": [Error: No route matches URL "/foo"],
            "internal": true,
            "status": 404,
            "statusText": "Not Found",
          },
        }
      `);

      cleanup(router);
    });

    it("should retain existing routes until revalidation completes on route removal (fetch)", async () => {
      let rootDfd = createDeferred();
      let fooDfd = createDeferred();
      let ogRoutes: AgnosticDataRouteObject[] = [
        {
          path: "/",
          id: "root",
          hasErrorBoundary: true,
          loader: () => rootDfd.promise,
          children: [
            {
              index: true,
              id: "index",
              hasErrorBoundary: false,
            },
            {
              path: "foo",
              id: "foo",
              loader: () => fooDfd.promise,
              children: undefined,
              hasErrorBoundary: false,
            },
          ],
        },
      ];
      let router = createRouter({
        routes: ogRoutes,
        history: createMemoryHistory(),
        hydrationData: {
          loaderData: {
            root: "ROOT INITIAL",
          },
        },
      });
      router.initialize();

      let key = "key";
      router.fetch(key, "root", "/foo");
      await fooDfd.resolve("FOO");
      expect(router.state.fetchers.get("key")?.data).toBe("FOO");

      let rootDfd2 = createDeferred();
      let newRoutes: AgnosticDataRouteObject[] = [
        {
          path: "/",
          id: "root",
          loader: () => rootDfd2.promise,
          hasErrorBoundary: true,
          children: [
            {
              index: true,
              id: "index",
              hasErrorBoundary: false,
            },
          ],
        },
      ];

      router._internalSetRoutes(newRoutes);

      // Interrupt /foo navigation with a revalidation
      router.revalidate();

      expect(router.state.revalidation).toBe("loading");

      // Should still expose be the og routes until navigation completes
      expect(router.routes).toEqual(ogRoutes);

      // Resolve any loaders that should have ran (foo's loader has been removed)
      await rootDfd2.resolve("ROOT*");
      expect(router.state.revalidation).toBe("idle");

      // Routes should be updated
      expect(router.routes).not.toEqual(ogRoutes);
      expect(router.routes).toEqual(newRoutes);

      // Loader data should be updated
      expect(router.state.loaderData).toEqual({
        root: "ROOT*",
      });
      // Fetcher should have been revalidated but theown a 404 wince the route was removed
      expect(router.state.fetchers.get("key")?.data).toBe(undefined);
      expect(router.state.errors).toEqual({
        root: new ErrorResponseImpl(
          404,
          "Not Found",
          new Error('No route matches URL "/foo"'),
          true
        ),
      });

      cleanup(router);
    });
  });

  describe("router.dispose", () => {
    it("should cancel pending navigations", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      let A = await t.navigate("/tasks");
      expect(t.router.state.navigation.state).toBe("loading");

      t.router.dispose();
      expect(A.loaders.tasks.signal.aborted).toBe(true);
    });

    it("should cancel pending fetchers", async () => {
      let t = setup({
        routes: TASK_ROUTES,
        initialEntries: ["/"],
        hydrationData: {
          loaderData: {
            root: "ROOT DATA",
            index: "INDEX DATA",
          },
        },
      });

      let A = await t.fetch("/tasks");
      let B = await t.fetch("/tasks");

      t.router.dispose();
      expect(A.loaders.tasks.signal.aborted).toBe(true);
      expect(B.loaders.tasks.signal.aborted).toBe(true);
    });
  });
});
