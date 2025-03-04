import type {
  DataStrategyFunction,
  DataStrategyMatch,
  DataStrategyResult,
} from "../../lib/router/utils";
import { createDeferred, setup } from "./utils/data-router-setup";
import { createFormData, tick } from "./utils/utils";

describe("router dataStrategy", () => {
  function mockDataStrategy(fn: DataStrategyFunction) {
    return jest.fn<
      ReturnType<DataStrategyFunction>,
      Parameters<DataStrategyFunction>
    >(fn);
  }

  function keyedResults(
    matches: DataStrategyMatch[],
    results: DataStrategyResult[]
  ) {
    return results.reduce(
      (acc, r, i) =>
        Object.assign(
          acc,
          matches[i].shouldLoad ? { [matches[i].route.id]: r } : {}
        ),
      {}
    );
  }

  describe("loaders", () => {
    it("should allow a custom implementation to passthrough to default behavior", async () => {
      let dataStrategy = mockDataStrategy(({ matches }) =>
        Promise.all(matches.map((m) => m.resolve())).then((results) =>
          keyedResults(matches, results)
        )
      );
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "json",
            path: "/test",
            loader: true,
            children: [
              {
                id: "text",
                index: true,
                loader: true,
              },
            ],
          },
        ],
        dataStrategy,
      });

      let A = await t.navigate("/test");

      // Should be called in parallel
      expect(A.loaders.json.stub).toHaveBeenCalledTimes(1);
      expect(A.loaders.text.stub).toHaveBeenCalledTimes(1);

      await A.loaders.json.resolve({ message: "hello json" });
      await A.loaders.text.resolve(new Response("hello text"));

      expect(t.router.state.loaderData).toEqual({
        json: { message: "hello json" },
        text: "hello text",
      });
      expect(dataStrategy).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.any(Request),
          params: {},
          matches: [
            expect.objectContaining({
              route: expect.objectContaining({
                id: "json",
              }),
            }),
            expect.objectContaining({
              route: expect.objectContaining({
                id: "text",
              }),
            }),
          ],
        })
      );
    });

    it("should allow a custom implementation to passthrough to default behavior and lazy", async () => {
      let dataStrategy = mockDataStrategy(({ matches }) =>
        Promise.all(matches.map((m) => m.resolve())).then((results) =>
          keyedResults(matches, results)
        )
      );
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "json",
            path: "/test",
            lazy: true,
            children: [
              {
                id: "text",
                index: true,
                lazy: true,
              },
            ],
          },
        ],
        dataStrategy,
      });

      let A = await t.navigate("/test");
      await A.lazy.json.resolve({
        loader: () => ({ message: "hello json" }),
      });
      await A.lazy.text.resolve({
        loader: () => "hello text",
      });
      expect(t.router.state.loaderData).toEqual({
        json: { message: "hello json" },
        text: "hello text",
      });
      expect(dataStrategy).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.any(Request),
          matches: [
            expect.objectContaining({
              route: expect.objectContaining({
                id: "json",
              }),
            }),
            expect.objectContaining({
              route: expect.objectContaining({
                id: "text",
              }),
            }),
          ],
        })
      );
    });

    it("should allow custom implementations to override default behavior", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "test",
            path: "/test",
            loader: true,
          },
        ],
        async dataStrategy({ matches }) {
          return Promise.all(
            matches.map((m) =>
              m.resolve(async (handler) => {
                let result = await handler();
                return `Route ID "${m.route.id}" returned "${result}"`;
              })
            )
          ).then((results) => keyedResults(matches, results));
        },
      });

      let A = await t.navigate("/test");
      await A.loaders.test.resolve("TEST");

      expect(t.router.state.loaderData).toMatchObject({
        test: 'Route ID "test" returned "TEST"',
      });
    });

    it("should allow custom implementations to override default behavior when erroring", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "test",
            path: "/test",
            loader: true,
            hasErrorBoundary: true,
          },
        ],
        async dataStrategy({ matches }) {
          return Promise.all(
            matches.map((m) =>
              m.resolve(async () => {
                throw new Error(`Route ID "${m.route.id}" errored!`);
              })
            )
          ).then((results) => keyedResults(matches, results));
        },
      });

      let A = await t.navigate("/test");
      await A.loaders.test.resolve("TEST");

      expect(t.router.state.errors).toMatchObject({
        test: new Error('Route ID "test" errored!'),
      });
    });

    it("should allow custom implementations to override default behavior with lazy", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "test",
            path: "/test",
            lazy: true,
          },
        ],
        async dataStrategy({ matches }) {
          return Promise.all(
            matches.map((m) =>
              m.resolve(async (handler) => {
                let result = await handler();
                return `Route ID "${m.route.id}" returned "${result}"`;
              })
            )
          ).then((results) => keyedResults(matches, results));
        },
      });

      let A = await t.navigate("/test");
      await A.lazy.test.resolve({ loader: () => "TEST" });

      expect(t.router.state.loaderData).toMatchObject({
        test: 'Route ID "test" returned "TEST"',
      });
    });

    it("handles errors at the proper boundary", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            path: "/parent",
            children: [
              {
                id: "child",
                path: "child",
                hasErrorBoundary: true,
                children: [
                  {
                    id: "test",
                    index: true,
                    loader: true,
                  },
                ],
              },
            ],
          },
        ],
        dataStrategy({ matches }) {
          return Promise.all(
            matches.map(async (match) => match.resolve())
          ).then((results) => keyedResults(matches, results));
        },
      });

      let A = await t.navigate("/parent/child");
      await A.loaders.test.reject(new Error("ERROR"));

      expect(t.router.state.loaderData.test).toBeUndefined();
      expect(t.router.state.errors?.child.message).toBe("ERROR");
    });

    it("handles errors at the proper boundary with a custom implementation", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            path: "/parent",
            children: [
              {
                id: "child",
                path: "child",
                hasErrorBoundary: true,
                children: [
                  {
                    id: "test",
                    index: true,
                    loader: true,
                  },
                ],
              },
            ],
          },
        ],
        dataStrategy({ matches }) {
          return Promise.all(
            matches.map((match) => {
              return match.resolve(async (handler) => {
                return {
                  type: "data",
                  result: await handler(),
                };
              });
            })
          ).then((results) => keyedResults(matches, results));
        },
      });

      let A = await t.navigate("/parent/child");
      await A.loaders.test.reject(new Error("ERROR"));

      expect(t.router.state.loaderData.test).toBeUndefined();
      expect(t.router.state.errors?.child.message).toBe("ERROR");
    });

    it("bubbles to the root if dataStrategy throws", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "parent",
            path: "/parent",
            loader: true,
            children: [
              {
                id: "child",
                path: "child",
                loader: true,
              },
            ],
          },
        ],
        dataStrategy({ matches }) {
          throw new Error("Uh oh");
        },
      });

      let A = await t.navigate("/parent/child");
      await A.loaders.parent.resolve("PARENT");

      expect(t.router.state).toMatchObject({
        actionData: null,
        errors: {
          parent: new Error("Uh oh"),
        },
        loaderData: {},
        navigation: {
          state: "idle",
        },
      });
    });

    it("does not require resolve to be called if a match is not being loaded", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "parent",
            path: "/parent",
            loader: true,
            hasErrorBoundary: true,
            children: [
              {
                id: "child",
                path: "child",
                lazy: true,
              },
            ],
          },
        ],
        dataStrategy({ matches, request }) {
          return Promise.all(
            matches.map(async (match) => {
              if (
                request.url.endsWith("/parent/child") &&
                match.route.id === "parent"
              ) {
                return undefined;
              }
              return match.resolve();
            })
          ).then((results) =>
            // @ts-expect-error
            keyedResults(matches, results)
          );
        },
      });

      let A = await t.navigate("/parent");
      await A.loaders.parent.resolve("PARENT");
      expect(t.router.state).toMatchObject({
        errors: null,
        loaderData: {
          parent: "PARENT",
        },
        navigation: {
          state: "idle",
        },
      });

      let B = await t.navigate("/parent/child");
      await B.lazy.child.resolve({ loader: () => "CHILD" });

      // no-op
      await B.loaders.parent.resolve("XXX");

      expect(t.router.state).toMatchObject({
        errors: null,
        loaderData: {
          child: "CHILD",
          parent: "PARENT",
        },
        navigation: {
          state: "idle",
        },
      });
    });

    it("indicates which routes need to load via match.shouldLoad", async () => {
      let dataStrategy = jest.fn<
        ReturnType<DataStrategyFunction>,
        Parameters<DataStrategyFunction>
      >(({ matches }) => {
        return Promise.all(matches.map((m) => m.resolve())).then((results) =>
          keyedResults(matches, results)
        );
      });
      let t = setup({
        routes: [
          {
            id: "root",
            path: "/",
            loader: true,
            children: [
              {
                id: "parent",
                path: "parent",
                loader: true,
                action: true,
                children: [
                  {
                    id: "child",
                    path: "child",
                    lazy: true,
                  },
                ],
              },
            ],
          },
        ],
        dataStrategy,
        hydrationData: {
          // don't call dataStrategy on hydration
          loaderData: { root: null },
        },
      });

      let A = await t.navigate("/");
      expect(dataStrategy.mock.calls[0][0].matches).toEqual([
        expect.objectContaining({
          shouldLoad: true,
          route: expect.objectContaining({ id: "root" }),
        }),
      ]);
      await A.loaders.root.resolve("ROOT");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
      });

      let B = await t.navigate("/parent");
      expect(dataStrategy.mock.calls[1][0].matches).toEqual([
        expect.objectContaining({
          shouldLoad: false,
          route: expect.objectContaining({ id: "root" }),
        }),
        expect.objectContaining({
          shouldLoad: true,
          route: expect.objectContaining({ id: "parent" }),
        }),
      ]);
      await B.loaders.parent.resolve("PARENT");
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        parent: "PARENT",
      });

      let C = await t.navigate("/parent/child");
      expect(dataStrategy.mock.calls[2][0].matches).toEqual([
        expect.objectContaining({
          shouldLoad: false,
          route: expect.objectContaining({ id: "root" }),
        }),
        expect.objectContaining({
          shouldLoad: false,
          route: expect.objectContaining({ id: "parent" }),
        }),
        expect.objectContaining({
          shouldLoad: true,
          route: expect.objectContaining({ id: "child" }),
        }),
      ]);
      await C.lazy.child.resolve({
        action: () => "CHILD ACTION",
        loader: () => "CHILD",
        shouldRevalidate: () => false,
      });
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        parent: "PARENT",
        child: "CHILD",
      });

      await t.navigate("/parent/child", {
        formMethod: "post",
        formData: createFormData({}),
      });
      await tick();
      expect(dataStrategy.mock.calls[3][0].matches).toEqual([
        expect.objectContaining({
          shouldLoad: false,
          route: expect.objectContaining({ id: "root" }),
        }),
        expect.objectContaining({
          shouldLoad: false,
          route: expect.objectContaining({ id: "parent" }),
        }),
        expect.objectContaining({
          shouldLoad: true, // action
          route: expect.objectContaining({ id: "child" }),
        }),
      ]);
      expect(dataStrategy.mock.calls[4][0].matches).toEqual([
        expect.objectContaining({
          shouldLoad: true,
          route: expect.objectContaining({ id: "root" }),
        }),
        expect.objectContaining({
          shouldLoad: true,
          route: expect.objectContaining({ id: "parent" }),
        }),
        expect.objectContaining({
          shouldLoad: false, // shouldRevalidate=false
          route: expect.objectContaining({ id: "child" }),
        }),
      ]);
      expect(t.router.state.actionData).toMatchObject({
        child: "CHILD ACTION",
      });
      expect(t.router.state.loaderData).toMatchObject({
        root: "ROOT",
        parent: "PARENT",
        child: "CHILD",
      });
    });

    it("does not short circuit when there are no matchesToLoad", async () => {
      let dataStrategy = mockDataStrategy(async ({ matches }) => {
        let results = await Promise.all(
          matches.map((m) => m.resolve((handler) => handler()))
        );
        // Don't use keyedResults since it checks for shouldLoad and this test
        // is always loading
        return results.reduce(
          (acc, r, i) => Object.assign(acc, { [matches[i].route.id]: r }),
          {}
        );
      });
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "parent",
            path: "/parent",
            loader: true,
            children: [
              {
                id: "child",
                path: "child",
                loader: true,
              },
            ],
          },
        ],
        dataStrategy,
      });

      let A = await t.navigate("/parent");
      await A.loaders.parent.resolve("PARENT1");
      expect(A.loaders.parent.stub).toHaveBeenCalled();
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT1",
      });
      expect(dataStrategy.mock.calls[0][0].matches).toEqual([
        expect.objectContaining({
          route: expect.objectContaining({
            id: "parent",
          }),
        }),
      ]);

      let B = await t.navigate("/parent/child");
      await B.loaders.parent.resolve("PARENT2");
      await B.loaders.child.resolve("CHILD");
      expect(B.loaders.parent.stub).toHaveBeenCalled();
      expect(B.loaders.child.stub).toHaveBeenCalled();
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT2",
        child: "CHILD",
      });
      expect(dataStrategy.mock.calls[1][0].matches).toEqual([
        expect.objectContaining({
          route: expect.objectContaining({
            id: "parent",
          }),
        }),
        expect.objectContaining({
          route: expect.objectContaining({
            id: "child",
          }),
        }),
      ]);

      let C = await t.navigate("/parent");
      await C.loaders.parent.resolve("PARENT3");
      expect(C.loaders.parent.stub).toHaveBeenCalled();
      expect(t.router.state.loaderData).toEqual({
        parent: "PARENT3",
      });
      expect(dataStrategy.mock.calls[2][0].matches).toEqual([
        expect.objectContaining({
          route: expect.objectContaining({
            id: "parent",
          }),
        }),
      ]);

      expect(dataStrategy).toHaveBeenCalledTimes(3);
    });
  });

  describe("actions", () => {
    it("should allow a custom implementation to passthrough to default behavior", async () => {
      let dataStrategy = mockDataStrategy(({ matches }) =>
        Promise.all(matches.map((m) => m.resolve())).then((results) =>
          keyedResults(matches, results)
        )
      );
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "json",
            path: "/test",
            action: true,
          },
        ],
        dataStrategy,
      });

      let A = await t.navigate("/test", {
        formMethod: "post",
        formData: createFormData({}),
      });

      await A.actions.json.resolve({ message: "hello json" });

      expect(t.router.state.actionData).toEqual({
        json: { message: "hello json" },
      });
      expect(dataStrategy).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.any(Request),
          matches: [
            expect.objectContaining({
              route: expect.objectContaining({
                id: "json",
              }),
            }),
          ],
        })
      );
    });

    it("should allow a custom implementation to passthrough to default behavior and lazy", async () => {
      let dataStrategy = mockDataStrategy(({ matches }) =>
        Promise.all(matches.map((m) => m.resolve())).then((results) =>
          keyedResults(matches, results)
        )
      );
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "json",
            path: "/test",
            lazy: true,
          },
        ],
        dataStrategy,
      });

      let A = await t.navigate("/test", {
        formMethod: "post",
        formData: createFormData({}),
      });
      await A.lazy.json.resolve({
        action: () => ({ message: "hello json" }),
      });
      expect(t.router.state.actionData).toEqual({
        json: { message: "hello json" },
      });
      expect(dataStrategy).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.any(Request),
          matches: [
            expect.objectContaining({
              route: expect.objectContaining({
                id: "json",
              }),
            }),
          ],
        })
      );
    });
  });

  describe("fetchers", () => {
    describe("loaders", () => {
      it("should allow a custom implementation to passthrough to default behavior", async () => {
        let dataStrategy = mockDataStrategy(({ matches }) =>
          Promise.all(matches.map((m) => m.resolve())).then((results) =>
            keyedResults(matches, results)
          )
        );
        let t = setup({
          routes: [
            {
              path: "/",
            },
            {
              id: "json",
              path: "/test",
              loader: true,
            },
          ],
          dataStrategy,
        });

        let key = "key";
        let A = await t.fetch("/test", key);

        await A.loaders.json.resolve({ message: "hello json" });

        expect(t.fetchers[key].data.message).toBe("hello json");

        expect(dataStrategy).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.any(Request),
            matches: [
              expect.objectContaining({
                route: expect.objectContaining({
                  id: "json",
                }),
              }),
            ],
          })
        );
      });

      it("should allow a custom implementation to passthrough to default behavior and lazy", async () => {
        let dataStrategy = mockDataStrategy(({ matches }) =>
          Promise.all(matches.map((m) => m.resolve())).then((results) =>
            keyedResults(matches, results)
          )
        );
        let t = setup({
          routes: [
            {
              path: "/",
            },
            {
              id: "json",
              path: "/test",
              lazy: true,
            },
          ],
          dataStrategy,
        });

        let key = "key";
        let A = await t.fetch("/test", key);
        await A.lazy.json.resolve({
          loader: () => ({ message: "hello json" }),
        });
        expect(t.fetchers[key].data.message).toBe("hello json");
        expect(dataStrategy).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.any(Request),
            matches: [
              expect.objectContaining({
                route: expect.objectContaining({
                  id: "json",
                }),
              }),
            ],
          })
        );
      });
    });

    describe("actions", () => {
      it("should allow a custom implementation to passthrough to default behavior", async () => {
        let dataStrategy = mockDataStrategy(({ matches }) =>
          Promise.all(matches.map((m) => m.resolve())).then((results) =>
            keyedResults(matches, results)
          )
        );
        let t = setup({
          routes: [
            {
              path: "/",
            },
            {
              id: "json",
              path: "/test",
              action: true,
            },
          ],
          dataStrategy,
        });

        let key = "key";
        let A = await t.fetch("/test", key, {
          formMethod: "post",
          formData: createFormData({}),
        });

        await A.actions.json.resolve({ message: "hello json" });

        expect(t.fetchers[key].data.message).toBe("hello json");

        expect(dataStrategy).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.any(Request),
            matches: expect.arrayContaining([
              expect.objectContaining({
                route: expect.objectContaining({
                  id: "json",
                }),
              }),
            ]),
          })
        );
      });

      it("should allow a custom implementation to passthrough to default behavior and lazy", async () => {
        let dataStrategy = mockDataStrategy(({ matches }) =>
          Promise.all(matches.map((m) => m.resolve())).then((results) =>
            keyedResults(matches, results)
          )
        );
        let t = setup({
          routes: [
            {
              path: "/",
            },
            {
              id: "json",
              path: "/test",
              lazy: true,
            },
          ],
          dataStrategy,
        });

        let key = "key";
        let A = await t.fetch("/test", key, {
          formMethod: "post",
          formData: createFormData({}),
        });
        await A.lazy.json.resolve({
          action: () => ({ message: "hello json" }),
        });

        expect(t.fetchers[key].data.message).toBe("hello json");

        expect(dataStrategy).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.any(Request),
            matches: expect.arrayContaining([
              expect.objectContaining({
                route: expect.objectContaining({
                  id: "json",
                }),
              }),
            ]),
          })
        );
      });
    });
  });

  describe("use-cases", () => {
    it("permits users to take control over response decoding", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "json",
            path: "/test",
            loader: true,
            children: [
              {
                id: "reverse",
                index: true,
                loader: true,
              },
            ],
          },
        ],
        async dataStrategy({ matches }) {
          return Promise.all(
            matches.map(async (m) => {
              return await m.resolve(async (handler) => {
                let result = await handler();
                if (
                  result instanceof Response &&
                  result.headers.get("Content-Type") === "application/reverse"
                ) {
                  let str = await result.text();
                  return {
                    original: str,
                    reversed: str.split("").reverse().join(""),
                  };
                }
                // This will be a JSON response we expect to be decoded the normal way
                return result;
              });
            })
          ).then((results) => keyedResults(matches, results));
        },
      });

      let A = await t.navigate("/test");
      await A.loaders.json.resolve({ message: "hello json" });
      await A.loaders.reverse.resolve(
        new Response("hello text", {
          headers: { "Content-Type": "application/reverse" },
        })
      );

      expect(t.router.state.loaderData).toEqual({
        json: { message: "hello json" },
        reverse: {
          original: "hello text",
          reversed: "txet olleh",
        },
      });
    });

    it("allows a single-fetch type approach", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "parent",
            path: "/parent",
            loader: true,
            children: [
              {
                id: "child",
                path: "child",
                loader: true,
              },
            ],
          },
        ],
        async dataStrategy({ matches }) {
          // Hold a deferred for each route we need to load
          let routeDeferreds: Map<
            string,
            ReturnType<typeof createDeferred>
          > = new Map();

          // Use resolve's to create and await a deferred for each
          // route that needs to load
          let matchPromises = matches.map((m) =>
            m.resolve(() => {
              // Don't call handler, just create a deferred we can resolve from
              // the single fetch response and return it's promise
              let dfd = createDeferred();
              routeDeferreds.set(m.route.id, dfd);
              return dfd.promise as Promise<DataStrategyResult>;
            })
          );

          // Mocked single fetch call response for the routes that need loading
          let result = {
            loaderData: {
              parent: "PARENT",
              child: "CHILD",
            },
          };

          // Resolve the deferred's above and return the mapped match promises
          routeDeferreds.forEach((dfd, routeId) =>
            dfd.resolve(result.loaderData[routeId])
          );
          return Promise.all(matchPromises).then((results) =>
            keyedResults(matches, results)
          );
        },
      });

      await t.navigate("/parent/child");

      // We don't even have to resolve the loader here because it'll never
      // be called in this test
      await tick();

      expect(t.router.state.loaderData).toMatchObject({
        parent: "PARENT",
        child: "CHILD",
      });
    });

    it("allows middleware/context implementations", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "parent",
            path: "/parent",
            loader: true,
            handle: {
              context: {
                parent: () => ({ id: "parent" }),
              },
              middleware(context) {
                context.parent.whatever = "PARENT MIDDLEWARE";
              },
            },
            children: [
              {
                id: "child",
                path: "child",
                loader: true,
                handle: {
                  context: {
                    child: () => ({ id: "child" }),
                  },
                  middleware(context) {
                    context.child.whatever = "CHILD MIDDLEWARE";
                  },
                },
              },
            ],
          },
        ],
        async dataStrategy({ matches }) {
          // Run context/middleware sequentially
          let context = matches.reduce((acc, m) => {
            if (m.route.handle?.context) {
              let matchContext = Object.entries(m.route.handle.context).reduce(
                (acc, [key, value]) =>
                  Object.assign(acc, {
                    // @ts-expect-error
                    [key]: value(),
                  }),
                {}
              );
              Object.assign(acc, matchContext);
            }
            if (m.route.handle?.middleware) {
              m.route.handle.middleware(acc);
            }
            return acc;
          }, {});

          // Run loaders in parallel only exposing contexts from above
          return Promise.all(
            matches.map((m, i) =>
              m.resolve(async (handler) => {
                // Only provide context values up to this level in the matches
                let handlerCtx = matches.slice(0, i + 1).reduce((acc, m) => {
                  Object.keys(m.route.handle?.context).forEach((k) => {
                    acc[k] = context[k];
                  });
                  return acc;
                }, {});
                let result = await handler(handlerCtx);
                return result;
              })
            )
          ).then((results) => keyedResults(matches, results));
        },
      });

      let A = await t.navigate("/parent/child");

      // Loaders are called with context from their level and above, and
      // context reflects any values set by middleware
      expect(A.loaders.parent.stub).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.any(Request),
          params: expect.any(Object),
        }),
        {
          parent: {
            id: "parent",
            whatever: "PARENT MIDDLEWARE",
          },
        }
      );

      expect(A.loaders.child.stub).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.any(Request),
          params: expect.any(Object),
        }),
        {
          parent: {
            id: "parent",
            whatever: "PARENT MIDDLEWARE",
          },
          child: {
            id: "child",
            whatever: "CHILD MIDDLEWARE",
          },
        }
      );

      await A.loaders.parent.resolve("PARENT LOADER");
      expect(t.router.state.navigation.state).toBe("loading");

      await A.loaders.child.resolve("CHILD LOADER");
      expect(t.router.state.navigation.state).toBe("idle");

      expect(t.router.state.loaderData).toMatchObject({
        parent: "PARENT LOADER",
        child: "CHILD LOADER",
      });
    });

    it("allows middleware/context implementations when some routes don't need to revalidate", async () => {
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "parent",
            path: "/parent",
            loader: true,
            handle: {
              context: {
                parent: () => ({ id: "parent" }),
              },
              middleware(context) {
                context.parent.whatever = "PARENT MIDDLEWARE";
              },
            },
            children: [
              {
                id: "child",
                path: "child",
                loader: true,
                handle: {
                  context: {
                    child: () => ({ id: "child" }),
                  },
                  middleware(context) {
                    context.child.whatever = "CHILD MIDDLEWARE";
                  },
                },
              },
            ],
          },
        ],
        async dataStrategy({ matches }) {
          // Run context/middleware sequentially
          let context = matches.reduce((acc, m) => {
            if (m.route.handle?.context) {
              let matchContext = Object.entries(m.route.handle.context).reduce(
                (acc, [key, value]) =>
                  Object.assign(acc, {
                    // @ts-expect-error
                    [key]: value(),
                  }),
                {}
              );
              Object.assign(acc, matchContext);
            }
            if (m.route.handle?.middleware) {
              m.route.handle.middleware(acc);
            }
            return acc;
          }, {});

          // Run loaders in parallel only exposing contexts from above
          return Promise.all(
            matches.map((m, i) =>
              m.resolve(async (callHandler) => {
                // Only provide context values up to this level in the matches
                let handlerCtx = matches.slice(0, i + 1).reduce((acc, m) => {
                  Object.keys(m.route.handle?.context).forEach((k) => {
                    acc[k] = context[k];
                  });
                  return acc;
                }, {});
                let result = m.shouldLoad
                  ? await callHandler(handlerCtx)
                  : t.router.state.loaderData[m.route.id];
                return result;
              })
            )
          ).then((results) => keyedResults(matches, results));
        },
      });

      let A = await t.navigate("/parent");
      await A.loaders.parent.resolve("PARENT");
      expect(t.router.state.navigation.state).toBe("idle");
      expect(t.router.state.loaderData).toMatchObject({
        parent: "PARENT",
      });

      let B = await t.navigate("/parent/child");

      // Loaders are called with context from their level and above, and
      // context reflects any values set by middleware
      expect(B.loaders.child.stub).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.any(Request),
          params: expect.any(Object),
        }),
        {
          parent: {
            id: "parent",
            whatever: "PARENT MIDDLEWARE",
          },
          child: {
            id: "child",
            whatever: "CHILD MIDDLEWARE",
          },
        }
      );

      await B.loaders.child.resolve("CHILD");
      expect(t.router.state.navigation.state).toBe("idle");

      expect(t.router.state.loaderData).toMatchObject({
        parent: "PARENT",
        child: "CHILD",
      });
    });

    it("allows automatic caching of loader results", async () => {
      let cache: Record<string, unknown> = {};
      let t = setup({
        routes: [
          {
            path: "/",
          },
          {
            id: "parent",
            path: "/parent",
            loader: true,
            handle: {
              cacheKey: (url: string) => new URL(url).pathname,
            },
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
        async dataStrategy({ request, matches }) {
          const getCacheKey = (m: DataStrategyMatch) =>
            m.route.handle?.cacheKey
              ? [m.route.id, m.route.handle.cacheKey(request.url)].join("-")
              : null;

          if (request.method !== "GET") {
            // invalidate on actions
            cache = {};
          }

          let matchesToLoad = matches.filter((m) => m.shouldLoad);
          return Promise.all(
            matchesToLoad.map(async (m) => {
              return m.resolve(async (handler) => {
                let key = getCacheKey(m);
                if (key && cache[key]) {
                  return cache[key];
                }

                let dsResult = await handler();
                if (key && request.method === "GET") {
                  cache[key] = dsResult;
                }

                return dsResult;
              });
            })
          ).then((results) => keyedResults(matchesToLoad, results));
        },
      });

      let A = await t.navigate("/parent/child");
      await A.loaders.parent.resolve("PARENT");
      await A.loaders.child.resolve("CHILD");

      expect(t.router.state).toMatchObject({
        navigation: { state: "idle" },
        loaderData: {
          parent: "PARENT",
          child: "CHILD",
        },
      });

      // Changing search params should force revalidation, but pathname-based
      // cache will serve the old data
      let B = await t.navigate("/parent/child?a=b");
      await B.loaders.child.resolve("CHILD*");

      expect(t.router.state).toMatchObject({
        navigation: { state: "idle" },
        loaderData: {
          parent: "PARENT",
          child: "CHILD*",
        },
      });

      // Useless resolution - handler was never called for parent
      await B.loaders.parent.resolve("PARENT*");

      expect(t.router.state).toMatchObject({
        navigation: { state: "idle" },
        loaderData: {
          parent: "PARENT",
          child: "CHILD*",
        },
      });

      // Action to invalidate the cache
      let C = await t.navigate("/parent/child?a=b", {
        formMethod: "post",
        formData: createFormData({}),
      });
      await C.actions.child.resolve("ACTION");
      await C.loaders.parent.resolve("PARENT**");
      await C.loaders.child.resolve("CHILD**");

      expect(t.router.state).toMatchObject({
        navigation: { state: "idle" },
        actionData: {
          child: "ACTION",
        },
        loaderData: {
          parent: "PARENT**",
          child: "CHILD**",
        },
      });
    });
  });
});
