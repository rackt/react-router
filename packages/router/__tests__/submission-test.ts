import type { HydrationState } from "../index";
import { ErrorResponseImpl } from "../utils";
import { cleanup, setup } from "./utils/data-router-setup";
import { createFormData } from "./utils/utils";

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
    ...(init?.url ? { initialEntries: [init.url] } : {}),
  });
}

describe("submissions", () => {
  // Detect any failures inside the router navigate code
  afterEach(() => cleanup());

  describe("submission navigations", () => {
    it("reloads all routes when a loader during an actionReload redirects", async () => {
      let t = initializeTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);

      await A.actions.foo.resolve("FOO ACTION");
      expect(A.loaders.root.stub.mock.calls.length).toBe(1);
      expect(t.router.state.actionData).toEqual({
        foo: "FOO ACTION",
      });

      let B = await A.loaders.foo.redirect("/bar");
      await A.loaders.root.reject("ROOT ERROR");
      await B.loaders.root.resolve("ROOT LOADER 2");
      await B.loaders.bar.resolve("BAR LOADER");
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);
      expect(t.router.state).toMatchObject({
        actionData: null,
        loaderData: {
          root: "ROOT LOADER 2",
          bar: "BAR LOADER",
        },
        errors: {},
      });
    });

    it("commits action data as soon as it lands", async () => {
      let t = initializeTest();

      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(t.router.state.actionData).toBeNull();

      await A.actions.foo.resolve("A");
      expect(t.router.state.actionData).toEqual({
        foo: "A",
      });
    });

    it("reloads all routes after the action", async () => {
      let t = initializeTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);

      await A.actions.foo.resolve("FOO ACTION");
      expect(A.loaders.root.stub.mock.calls.length).toBe(1);
      expect(t.router.state.actionData).toEqual({
        foo: "FOO ACTION",
      });

      await A.loaders.foo.resolve("A LOADER");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT", // old data
        index: "INDEX", // old data
      });

      await A.loaders.root.resolve("ROOT LOADER");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.actionData).toEqual({
        foo: "FOO ACTION", // kept around on action reload
      });
      expect(t.router.state.loaderData).toEqual({
        foo: "A LOADER",
        root: "ROOT LOADER",
      });
    });

    it("reloads all routes after action redirect (throw)", async () => {
      let t = initializeTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);

      let B = await A.actions.foo.redirect("/bar");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);

      await B.loaders.root.resolve("ROOT LOADER");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT", // old data
        index: "INDEX", // old data
      });

      await B.loaders.bar.resolve("B LOADER");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.loaderData).toEqual({
        bar: "B LOADER",
        root: "ROOT LOADER",
      });
    });

    it("reloads all routes after action redirect (return)", async () => {
      let t = initializeTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);

      let B = await A.actions.foo.redirectReturn("/bar");
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);

      await B.loaders.root.resolve("ROOT LOADER");
      expect(t.router.state.navigation.state).toBe("loading");
      expect(t.router.state.loaderData).toEqual({
        root: "ROOT", // old data
        index: "INDEX", // old data
      });

      await B.loaders.bar.resolve("B LOADER");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.loaderData).toEqual({
        bar: "B LOADER",
        root: "ROOT LOADER",
      });
    });

    it("reloads all routes after action redirect (chained redirects)", async () => {
      let t = initializeTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      expect(A.loaders.root.stub.mock.calls.length).toBe(0);

      let B = await A.actions.foo.redirectReturn("/bar");
      expect(B.loaders.root.stub.mock.calls.length).toBe(1);

      await B.loaders.root.resolve("ROOT*");
      let C = await B.loaders.bar.redirectReturn("/baz");
      expect(C.loaders.root.stub.mock.calls.length).toBe(1);

      await C.loaders.root.resolve("ROOT**");
      await C.loaders.baz.resolve("BAZ");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.loaderData).toEqual({
        baz: "BAZ",
        root: "ROOT**",
      });
    });

    it("removes action data at new locations", async () => {
      let t = initializeTest();
      let A = await t.navigate("/foo", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await A.actions.foo.resolve("A ACTION");
      await A.loaders.root.resolve("A ROOT");
      await A.loaders.foo.resolve("A LOADER");
      expect(t.router.state.actionData).toEqual({ foo: "A ACTION" });

      let B = await t.navigate("/bar");
      await B.loaders.bar.resolve("B LOADER");
      expect(t.router.state.actionData).toBeNull();
    });

    it("removes action data after action redirect (w/o loaders to run)", async () => {
      let t = setup({
        routes: [
          {
            index: true,
            id: "index",
            action: true,
          },
          {
            path: "/other",
            id: "other",
          },
        ],
      });
      let A = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "" }),
      });
      await A.actions.index.resolve({ error: "invalid" });
      expect(t.router.state.actionData).toEqual({
        index: { error: "invalid" },
      });

      let B = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await B.actions.index.redirectReturn("/other");

      expect(t.router.state.actionData).toBeNull();
    });

    it("removes action data after action redirect (w/ loaders to run)", async () => {
      let t = setup({
        routes: [
          {
            index: true,
            id: "index",
            action: true,
          },
          {
            path: "/other",
            id: "other",
            loader: true,
          },
        ],
      });
      let A = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "" }),
      });
      await A.actions.index.resolve({ error: "invalid" });
      expect(t.router.state.actionData).toEqual({
        index: { error: "invalid" },
      });

      let B = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });

      let C = await B.actions.index.redirectReturn("/other");
      expect(t.router.state.actionData).toEqual({
        index: { error: "invalid" },
      });
      expect(t.router.state.loaderData).toEqual({});

      await C.loaders.other.resolve("OTHER");

      expect(t.router.state.actionData).toBeNull();
      expect(t.router.state.loaderData).toEqual({
        other: "OTHER",
      });
    });

    it("removes action data after action redirect to current location", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            id: "index",
            action: true,
            loader: true,
          },
        ],
      });
      let A = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "" }),
      });
      await A.actions.index.resolve({ error: "invalid" });
      expect(t.router.state.actionData).toEqual({
        index: { error: "invalid" },
      });

      let B = await t.navigate("/", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });

      let C = await B.actions.index.redirectReturn("/");
      expect(t.router.state.actionData).toEqual({
        index: { error: "invalid" },
      });
      expect(t.router.state.loaderData).toEqual({});

      await C.loaders.index.resolve("NEW");

      expect(t.router.state.actionData).toBeNull();
      expect(t.router.state.loaderData).toEqual({
        index: "NEW",
      });
    });

    it("uses the proper action for index routes", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            id: "parent",
            children: [
              {
                path: "/child",
                id: "child",
                hasErrorBoundary: true,
                action: true,
                children: [
                  {
                    index: true,
                    id: "childIndex",
                    hasErrorBoundary: true,
                    action: true,
                  },
                ],
              },
            ],
          },
        ],
      });
      let A = await t.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await A.actions.child.resolve("CHILD");
      expect(t.router.state.actionData).toEqual({
        child: "CHILD",
      });

      let B = await t.navigate("/child?index", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await B.actions.childIndex.resolve("CHILD INDEX");
      expect(t.router.state.actionData).toEqual({
        childIndex: "CHILD INDEX",
      });
    });

    it("uses the proper action for pathless layout routes", async () => {
      let t = setup({
        routes: [
          {
            id: "parent",
            path: "/parent",
            action: true,
            children: [
              {
                hasErrorBoundary: true,
                children: [
                  {
                    id: "index",
                    index: true,
                    action: true,
                  },
                ],
              },
            ],
          },
        ],
      });
      let A = await t.navigate("/parent", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await A.actions.parent.resolve("PARENT");
      expect(t.router.state).toMatchObject({
        location: { pathname: "/parent" },
        actionData: {
          parent: "PARENT",
        },
        errors: null,
      });

      let B = await t.navigate("/parent?index", {
        formMethod: "post",
        formData: createFormData({ gosh: "dang" }),
      });
      await B.actions.index.resolve("INDEX");
      expect(t.router.state).toMatchObject({
        location: { pathname: "/parent", search: "?index" },
        actionData: {
          index: "INDEX",
        },
        errors: null,
      });
    });

    it("retains the index match when submitting to a layout route", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            id: "parent",
            loader: true,
            action: true,
            children: [
              {
                path: "/child",
                id: "child",
                loader: true,
                action: true,
                children: [
                  {
                    index: true,
                    id: "childIndex",
                    loader: true,
                    action: true,
                  },
                ],
              },
            ],
          },
        ],
      });
      let A = await t.navigate("/child", {
        formMethod: "post",
        formData: new FormData(),
      });
      await A.actions.child.resolve("CHILD ACTION");
      await A.loaders.parent.resolve("PARENT LOADER");
      await A.loaders.child.resolve("CHILD LOADER");
      await A.loaders.childIndex.resolve("CHILD INDEX LOADER");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT LOADER",
        child: "CHILD LOADER",
        childIndex: "CHILD INDEX LOADER",
      });
      expect(t.router.state.actionData).toEqual({
        child: "CHILD ACTION",
      });
      expect(t.router.state.matches.map((m) => m.route.id)).toEqual([
        "parent",
        "child",
        "childIndex",
      ]);
    });

    describe("formMethod casing", () => {
      it("normalizes to lowercase in v6", async () => {
        let t = setup({
          routes: [
            {
              id: "root",
              path: "/",
              children: [
                {
                  id: "child",
                  path: "child",
                  loader: true,
                  action: true,
                },
              ],
            },
          ],
        });
        let A = await t.navigate("/child", {
          formMethod: "get",
          formData: createFormData({}),
        });
        expect(t.router.state.navigation.formMethod).toBe("get");
        await A.loaders.child.resolve("LOADER");
        expect(t.router.state.navigation.formMethod).toBeUndefined();
        await t.router.navigate("/");

        let B = await t.navigate("/child", {
          formMethod: "POST",
          formData: createFormData({}),
        });
        expect(t.router.state.navigation.formMethod).toBe("post");
        await B.actions.child.resolve("ACTION");
        await B.loaders.child.resolve("LOADER");
        expect(t.router.state.navigation.formMethod).toBeUndefined();
        await t.router.navigate("/");

        let C = await t.fetch("/child", "key", {
          formMethod: "GET",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get("key")?.formMethod).toBe("get");
        await C.loaders.child.resolve("LOADER FETCH");
        expect(t.router.state.fetchers.get("key")?.formMethod).toBeUndefined();

        let D = await t.fetch("/child", "key", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get("key")?.formMethod).toBe("post");
        await D.actions.child.resolve("ACTION FETCH");
        expect(t.router.state.fetchers.get("key")?.formMethod).toBeUndefined();
      });

      it("normalizes to uppercase in v7 via v7_normalizeFormMethod", async () => {
        let t = setup({
          routes: [
            {
              id: "root",
              path: "/",
              children: [
                {
                  id: "child",
                  path: "child",
                  loader: true,
                  action: true,
                },
              ],
            },
          ],
          future: {
            v7_normalizeFormMethod: true,
            v7_prependBasename: false,
          },
        });
        let A = await t.navigate("/child", {
          formMethod: "get",
          formData: createFormData({}),
        });
        expect(t.router.state.navigation.formMethod).toBe("GET");
        await A.loaders.child.resolve("LOADER");
        expect(t.router.state.navigation.formMethod).toBeUndefined();
        await t.router.navigate("/");

        let B = await t.navigate("/child", {
          formMethod: "POST",
          formData: createFormData({}),
        });
        expect(t.router.state.navigation.formMethod).toBe("POST");
        await B.actions.child.resolve("ACTION");
        await B.loaders.child.resolve("LOADER");
        expect(t.router.state.navigation.formMethod).toBeUndefined();
        await t.router.navigate("/");

        let C = await t.fetch("/child", "key", {
          formMethod: "GET",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get("key")?.formMethod).toBe("GET");
        await C.loaders.child.resolve("LOADER FETCH");
        expect(t.router.state.fetchers.get("key")?.formMethod).toBeUndefined();

        let D = await t.fetch("/child", "key", {
          formMethod: "post",
          formData: createFormData({}),
        });
        expect(t.router.state.fetchers.get("key")?.formMethod).toBe("POST");
        await D.actions.child.resolve("ACTION FETCH");
        expect(t.router.state.fetchers.get("key")?.formMethod).toBeUndefined();
      });
    });
  });

  describe("action errors", () => {
    describe("with an error boundary in the action route", () => {
      it("uses the action route's error boundary", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              children: [
                {
                  path: "/child",
                  id: "child",
                  hasErrorBoundary: true,
                  action: true,
                },
              ],
            },
          ],
        });
        let A = await t.navigate("/child", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        await A.actions.child.reject(new Error("Kaboom!"));
        expect(t.router.state.errors).toEqual({
          child: new Error("Kaboom!"),
        });
      });

      it("loads parent data, but not action data", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              loader: true,
              children: [
                {
                  path: "/child",
                  id: "child",
                  hasErrorBoundary: true,
                  loader: true,
                  action: true,
                },
              ],
            },
          ],
        });
        let A = await t.navigate("/child", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        await A.actions.child.reject(new Error("Kaboom!"));
        expect(A.loaders.parent.stub.mock.calls.length).toBe(1);
        expect(A.loaders.child.stub.mock.calls.length).toBe(0);
        await A.loaders.parent.resolve("PARENT LOADER");
        expect(t.router.state).toMatchObject({
          loaderData: {
            parent: "PARENT LOADER",
          },
          actionData: null,
          errors: {
            child: new Error("Kaboom!"),
          },
        });
      });
    });

    describe("with an error boundary above the action route", () => {
      it("uses the nearest error boundary", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              hasErrorBoundary: true,
              children: [
                {
                  path: "/child",
                  id: "child",
                  action: true,
                },
              ],
            },
          ],
        });
        let A = await t.navigate("/child", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        await A.actions.child.reject(new Error("Kaboom!"));
        expect(t.router.state.errors).toEqual({
          parent: new Error("Kaboom!"),
        });
      });
    });

    describe("with a parent loader that throws also, good grief!", () => {
      it("uses action error but nearest errorBoundary to parent", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "root",
              hasErrorBoundary: true,
              children: [
                {
                  path: "/parent",
                  id: "parent",
                  loader: true,
                  children: [
                    {
                      path: "/parent/child",
                      id: "child",
                      action: true,
                      hasErrorBoundary: true,
                    },
                  ],
                },
              ],
            },
          ],
        });

        let A = await t.navigate("/parent/child", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        await A.actions.child.reject(new Error("Kaboom!"));
        await A.loaders.parent.reject(new Error("Should not see this!"));
        expect(t.router.state).toMatchObject({
          loaderData: {},
          actionData: {},
          errors: {
            root: new Error("Kaboom!"),
          },
        });
      });
    });

    describe("with no corresponding action", () => {
      it("throws a 405 ErrorResponse", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              children: [
                {
                  path: "/child",
                  id: "child",
                  hasErrorBoundary: true,
                },
              ],
            },
          ],
        });
        let spy = jest.spyOn(console, "warn").mockImplementation(() => {});
        await t.navigate("/child", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        expect(t.router.state.errors).toEqual({
          child: new ErrorResponseImpl(
            405,
            "Method Not Allowed",
            new Error(
              'You made a POST request to "/child" but did not provide an ' +
                '`action` for route "child", so there is no way to handle the request.'
            ),
            true
          ),
        });
        spy.mockReset();
      });

      it("still calls appropriate loaders after 405 ErrorResponse", async () => {
        let t = setup({
          routes: [
            {
              path: "/",
              id: "parent",
              loader: true,
              children: [
                {
                  path: "child",
                  id: "child",
                  loader: true,
                  children: [
                    {
                      path: "grandchild",
                      id: "grandchild",
                      loader: true,
                      // no action to post to
                      hasErrorBoundary: true,
                    },
                  ],
                },
              ],
            },
          ],
          hydrationData: {
            loaderData: {
              parent: "PARENT DATA",
            },
          },
        });
        let A = await t.navigate("/child/grandchild", {
          formMethod: "post",
          formData: createFormData({ gosh: "dang" }),
        });
        expect(t.router.state.errors).toBe(null);
        expect(A.loaders.parent.stub.mock.calls.length).toBe(1); // called again for revalidation
        expect(A.loaders.child.stub.mock.calls.length).toBe(1); // called because it's above error
        expect(A.loaders.grandchild.stub.mock.calls.length).toBe(0); // don't call due to error
        await A.loaders.parent.resolve("PARENT DATA*");
        await A.loaders.child.resolve("CHILD DATA");
        expect(t.router.state.loaderData).toEqual({
          parent: "PARENT DATA*",
          child: "CHILD DATA",
        });
        expect(t.router.state.actionData).toBe(null);
        expect(t.router.state.errors).toEqual({
          grandchild: new ErrorResponseImpl(
            405,
            "Method Not Allowed",
            new Error(
              'You made a POST request to "/child/grandchild" but did not ' +
                'provide an `action` for route "grandchild", so there is no way ' +
                "to handle the request."
            ),
            true
          ),
        });
      });
    });

    it("clears previous actionData at the throwing route", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            id: "parent",
            loader: true,
            children: [
              {
                path: "/child",
                id: "child",
                hasErrorBoundary: true,
                action: true,
                loader: true,
              },
            ],
          },
        ],
      });
      let nav = await t.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ key: "value" }),
      });
      await nav.actions.child.resolve("ACTION");
      await nav.loaders.parent.resolve("PARENT");
      await nav.loaders.child.resolve("CHILD");
      expect(t.router.state.actionData).toEqual({
        child: "ACTION",
      });
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT",
        child: "CHILD",
      });
      expect(t.router.state.errors).toEqual(null);

      let nav2 = await t.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ key2: "value2" }),
      });
      await nav2.actions.child.reject(new Error("Kaboom!"));
      await nav2.loaders.parent.resolve("PARENT2");
      expect(t.router.state.actionData).toEqual(null);
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT2",
      });
      expect(t.router.state.errors).toEqual({
        child: new Error("Kaboom!"),
      });
    });

    it("does not clear previous loaderData at the handling route", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
            id: "parent",
            loader: true,
            hasErrorBoundary: true,
            children: [
              {
                path: "/child",
                id: "child",
                action: true,
                loader: true,
              },
            ],
          },
        ],
      });
      let nav = await t.navigate("/child");
      await nav.loaders.parent.resolve("PARENT");
      await nav.loaders.child.resolve("CHILD");
      expect(t.router.state.actionData).toEqual(null);
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT",
        child: "CHILD",
      });
      expect(t.router.state.errors).toEqual(null);

      let nav2 = await t.navigate("/child", {
        formMethod: "post",
        formData: createFormData({ key2: "value2" }),
      });
      await nav2.actions.child.reject(new Error("Kaboom!"));
      expect(t.router.state.actionData).toEqual(null);
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT",
      });
      expect(t.router.state.errors).toEqual({
        parent: new Error("Kaboom!"),
      });
    });
  });

  describe("submission encTypes", () => {
    async function validateFormDataSubmission(
      body: any,
      includeFormEncType: boolean
    ) {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let nav = await t.navigate("/", {
        formMethod: "post",
        ...(includeFormEncType
          ? { formEncType: "application/x-www-form-urlencoded" }
          : {}),
        body,
      });
      expect(t.router.state.navigation.text).toBeUndefined();
      expect(t.router.state.navigation.formData?.get("a")).toBe("1");
      expect(t.router.state.navigation.formData?.get("b")).toBe("2");
      expect(t.router.state.navigation.json).toBeUndefined();

      await nav.actions.root.resolve("ACTION");

      expect(nav.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = nav.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
      let fd = await request.formData();
      expect(fd.get("a")).toBe("1");
      expect(fd.get("b")).toBe("2");
    }

    async function validateJsonObjectSubmission(body: any) {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let nav = await t.navigate("/", {
        formMethod: "post",
        formEncType: "application/json",
        body,
      });
      expect(t.router.state.navigation.text).toBeUndefined();
      expect(t.router.state.navigation.json?.["a"]).toBe(1);
      expect(t.router.state.navigation.json?.["b"]).toBe(2);
      expect(t.router.state.navigation.formData).toBeUndefined();

      await nav.actions.root.resolve("ACTION");

      expect(nav.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = nav.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe("application/json");
      let json = await request.json();
      expect(json["a"]).toBe(1);
      expect(json["b"]).toBe(2);
    }

    async function validateJsonArraySubmission(body: any) {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let nav = await t.navigate("/", {
        formMethod: "post",
        formEncType: "application/json",
        body,
      });
      expect(t.router.state.navigation.text).toBeUndefined();
      expect(t.router.state.navigation.json?.[0]).toBe(1);
      expect(t.router.state.navigation.json?.[1]).toBe(2);
      expect(t.router.state.navigation.formData).toBeUndefined();

      await nav.actions.root.resolve("ACTION");

      expect(nav.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = nav.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe("application/json");
      let json = await request.json();
      expect(json[0]).toBe(1);
      expect(json[1]).toBe(2);
    }

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as implicit application/x-www-form-urlencoded (object)", async () => {
      await validateFormDataSubmission({ a: "1", b: "2" }, false);
    });

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as implicit application/x-www-form-urlencoded (string)", async () => {
      await validateFormDataSubmission("a=1&b=2", false);
    });

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as implicit application/x-www-form-urlencoded (string with leading ?)", async () => {
      await validateFormDataSubmission("?a=1&b=2", false);
    });

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as implicit application/x-www-form-urlencoded (entries array)", async () => {
      await validateFormDataSubmission(
        [
          ["a", "1"],
          ["b", "2"],
        ],
        false
      );
    });

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as explicit application/x-www-form-urlencoded (object)", async () => {
      await validateFormDataSubmission({ a: "1", b: "2" }, true);
    });

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as explicit application/x-www-form-urlencoded (string)", async () => {
      await validateFormDataSubmission("a=1&b=2", true);
    });

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as explicit application/x-www-form-urlencoded (string with leading ?)", async () => {
      await validateFormDataSubmission("?a=1&b=2", true);
    });

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as explicit application/x-www-form-urlencoded (entries array)", async () => {
      await validateFormDataSubmission(
        [
          ["a", "1"],
          ["b", "2"],
        ],
        true
      );
    });

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as application/json (object)", async () => {
      await validateJsonObjectSubmission({ a: 1, b: 2 });
    });

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as application/json (object string)", async () => {
      await validateJsonObjectSubmission('{"a":1,"b":2}');
    });

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as application/json (array)", async () => {
      await validateJsonArraySubmission([1, 2]);
    });

    // eslint-disable-next-line jest/expect-expect
    it("serializes body as application/json (array string)", async () => {
      await validateJsonArraySubmission("[1,2]");
    });

    it("serializes body as text/plain (string)", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let body = "plain text";
      let nav = await t.navigate("/", {
        formMethod: "post",
        formEncType: "text/plain",
        body,
      });
      expect(t.router.state.navigation.text).toBe(body);
      expect(t.router.state.navigation.formData).toBeUndefined();
      expect(t.router.state.navigation.json).toBeUndefined();

      await nav.actions.root.resolve("ACTION");

      expect(nav.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = nav.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe(
        "text/plain;charset=UTF-8"
      );
      expect(await request.text()).toEqual(body);
    });

    it("serializes body as text/plain (FormData)", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let body = new FormData();
      body.append("a", "1");
      body.append("b", "2");
      let nav = await t.navigate("/", {
        formMethod: "post",
        formEncType: "text/plain",
        body,
      });
      expect(t.router.state.navigation.text).toMatchInlineSnapshot(`
      "a=1
      b=2
      "
    `);
      expect(t.router.state.navigation.formData).toBeUndefined();
      expect(t.router.state.navigation.json).toBeUndefined();

      await nav.actions.root.resolve("ACTION");

      expect(nav.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = nav.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/");
      expect(request.headers.get("Content-Type")).toBe(
        "text/plain;charset=UTF-8"
      );
      expect(await request.text()).toMatchInlineSnapshot(`
      "a=1
      b=2
      "
    `);
    });

    it("serializes body as FormData when encType=undefined", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      let body = { a: "1" };
      let nav = await t.navigate("/", {
        formMethod: "post",
        body,
      });
      expect(t.router.state.navigation.text).toBeUndefined();
      expect(t.router.state.navigation.formData?.get("a")).toBe("1");
      expect(t.router.state.navigation.json).toBeUndefined();

      await nav.actions.root.resolve("ACTION");

      expect(nav.actions.root.stub).toHaveBeenCalledWith({
        location: expect.anything(),
        matches: expect.anything(),
        params: {},
        request: expect.any(Request),
      });

      let request = nav.actions.root.stub.mock.calls[0][0].request;
      expect(request.method).toBe("POST");
      expect((await request.formData()).get("a")).toBe("1");
      expect(request.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded;charset=UTF-8"
      );
    });

    it("throws on invalid URLSearchParams submissions", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      await t.navigate("/", {
        formMethod: "post",
        formEncType: "application/x-www-form-urlencoded",
        body: ["you", "cant", "do", "this"],
      });
      expect(t.router.state.errors).toMatchInlineSnapshot(`
      {
        "root": ErrorResponseImpl {
          "data": "Error: Unable to encode submission body",
          "error": [Error: Unable to encode submission body],
          "internal": true,
          "status": 400,
          "statusText": "Bad Request",
        },
      }
    `);
    });

    it("throws on invalid JSON submissions", async () => {
      let t = setup({
        routes: [{ id: "root", path: "/", action: true }],
      });

      await t.navigate("/", {
        formMethod: "post",
        formEncType: "application/json",
        body: '{ not: "valid }',
      });
      expect(t.router.state.errors).toMatchInlineSnapshot(`
      {
        "root": ErrorResponseImpl {
          "data": "Error: Unable to encode submission body",
          "error": [Error: Unable to encode submission body],
          "internal": true,
          "status": 400,
          "statusText": "Bad Request",
        },
      }
    `);
    });
  });
});
