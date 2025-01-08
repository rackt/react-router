import { createMemoryHistory } from "../../lib/router/history";
import { createRouter } from "../../lib/router/router";
import type { DataStrategyResult } from "../../lib/router/utils";
import { cleanup } from "./utils/data-router-setup";
import { createFormData, tick } from "./utils/utils";

describe("router context", () => {
  it("provides context to loaders and actions", async () => {
    let context = { count: 1 };
    let router = createRouter({
      history: createMemoryHistory(),
      context,
      routes: [
        {
          path: "/",
        },
        {
          id: "a",
          path: "/a",
          loader({ context }) {
            return ++context.count;
          },
        },
        {
          id: "b",
          path: "/b",
          action({ context }) {
            return ++context.count;
          },
          loader({ context }) {
            return ++context.count;
          },
        },
      ],
    });

    await router.navigate("/a");
    expect(router.state.loaderData.a).toBe(2);
    expect(context.count).toBe(2);

    await router.navigate("/b", {
      formMethod: "post",
      formData: createFormData({}),
    });
    expect(router.state.actionData?.b).toBe(3);
    expect(router.state.loaderData.b).toBe(4);
    expect(context.count).toBe(4);

    cleanup(router);
  });

  it("works with dataStrategy for a sequential implementation", async () => {
    let context = {};
    let router = createRouter({
      history: createMemoryHistory(),
      context,
      routes: [
        {
          path: "/",
        },
        {
          id: "parent",
          path: "/parent",
          async loader({ context }) {
            // Ensure these actually run sequentially :)
            await tick();
            context.parent = "PARENT MIDDLEWARE";
            return "PARENT";
          },
          children: [
            {
              id: "child",
              path: "child",
              loader({ context }) {
                context.parent += " (amended from child)";
                context.child = "CHILD MIDDLEWARE";
                return "CHILD";
              },
            },
          ],
        },
      ],
      async dataStrategy({ matches }) {
        let keyedResults: Record<string, DataStrategyResult> = {};
        for (let m of matches) {
          keyedResults[m.route.id] = await m.resolve();
        }
        return keyedResults;
      },
    });

    await router.navigate("/parent/child");

    expect(router.state.loaderData).toEqual({
      child: "CHILD",
      parent: "PARENT",
    });
    expect(context).toEqual({
      child: "CHILD MIDDLEWARE",
      parent: "PARENT MIDDLEWARE (amended from child)",
    });

    cleanup(router);
  });

  it("works with dataStrategy for an easy middleware implementation", async () => {
    let context = {};
    let router = createRouter({
      history: createMemoryHistory(),
      context,
      routes: [
        {
          path: "/",
        },
        {
          id: "parent",
          path: "/parent",
          loader: ({ context }) => ({ contextSnapshot: { ...context } }),
          handle: {
            middleware(context) {
              context.parent = "PARENT MIDDLEWARE";
            },
          },
          children: [
            {
              id: "child",
              path: "child",
              loader: ({ context }) => ({ contextSnapshot: { ...context } }),
              handle: {
                middleware(context) {
                  context.parent += " (amended from child)";
                  context.child = "CHILD MIDDLEWARE";
                },
              },
            },
          ],
        },
      ],
      async dataStrategy({ context, matches }) {
        // Run middleware sequentially
        for (let m of matches) {
          await m.route.handle.middleware(context);
        }

        // Run loaders in parallel
        let keyedResults: Record<string, DataStrategyResult> = {};
        await Promise.all(
          matches.map(async (m) => {
            keyedResults[m.route.id] = await m.resolve();
          })
        );
        return keyedResults;
      },
    });

    await router.navigate("/parent/child");

    expect(router.state.loaderData).toEqual({
      child: {
        contextSnapshot: {
          child: "CHILD MIDDLEWARE",
          parent: "PARENT MIDDLEWARE (amended from child)",
        },
      },
      parent: {
        contextSnapshot: {
          child: "CHILD MIDDLEWARE",
          parent: "PARENT MIDDLEWARE (amended from child)",
        },
      },
    });
    expect(context).toEqual({
      child: "CHILD MIDDLEWARE",
      parent: "PARENT MIDDLEWARE (amended from child)",
    });

    cleanup(router);
  });
});
