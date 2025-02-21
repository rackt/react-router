import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import type { LoaderFunction } from "../../index";
import {
  Outlet,
  RouterProvider as ReactRouter_RouterProvider,
  createBrowserRouter,
  createHashRouter,
  createMemoryRouter,
  useLoaderData,
  useRouteError,
} from "../../index";
import { RouterProvider as ReactRouterDom_RouterProvider } from "../../dom-export";

import getHtml from "../utils/getHtml";
import { createDeferred, tick } from "../router/utils/utils";

let didAssertMissingHydrateFallback = false;

describe("Partial Hydration Behavior", () => {
  describe("createBrowserRouter", () => {
    testPartialHydration(createBrowserRouter, ReactRouterDom_RouterProvider);
  });

  describe("createHashRouter", () => {
    testPartialHydration(createHashRouter, ReactRouterDom_RouterProvider);
  });
  describe("createHashRouter with noslash", () => {
    testPartialHydration((routes, opts) => createHashRouter(routes, {...opts, hashType:'noslash'}), ReactRouterDom_RouterProvider);
  });

  describe("createMemoryRouter", () => {
    testPartialHydration(createMemoryRouter, ReactRouter_RouterProvider);

    // these tests only run for memory since we just need to set initialEntries
    it("supports partial hydration w/patchRoutesOnNavigation (leaf fallback)", async () => {
      let parentDfd = createDeferred();
      let childDfd = createDeferred();
      let router = createMemoryRouter(
        [
          {
            path: "/",
            Component() {
              return (
                <>
                  <h1>Root</h1>
                  <Outlet />
                </>
              );
            },
            children: [
              {
                id: "parent",
                path: "parent",
                HydrateFallback: () => <p>Parent Loading...</p>,
                loader: () => parentDfd.promise,
                Component() {
                  let data = useLoaderData() as string;
                  return (
                    <>
                      <h2>{`Parent - ${data}`}</h2>
                      <Outlet />
                    </>
                  );
                },
              },
            ],
          },
        ],
        {
          future: {
            v7_partialHydration: true,
          },
          patchRoutesOnNavigation({ path, patch }) {
            if (path === "/parent/child") {
              patch("parent", [
                {
                  path: "child",
                  loader: () => childDfd.promise,
                  Component() {
                    let data = useLoaderData() as string;
                    return <h3>{`Child - ${data}`}</h3>;
                  },
                },
              ]);
            }
          },
          initialEntries: ["/parent/child"],
        }
      );
      let { container } = render(
        // eslint-disable-next-line react/jsx-pascal-case
        <ReactRouter_RouterProvider router={router} />
      );

      parentDfd.resolve("PARENT DATA");
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <h1>
            Root
          </h1>
          <p>
            Parent Loading...
          </p>
        </div>"
      `);

      childDfd.resolve("CHILD DATA");
      await waitFor(() => screen.getByText(/CHILD DATA/));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <h1>
            Root
          </h1>
          <h2>
            Parent - PARENT DATA
          </h2>
          <h3>
            Child - CHILD DATA
          </h3>
        </div>"
      `);
    });

    it("supports partial hydration w/patchRoutesOnNavigation (root fallback)", async () => {
      let parentDfd = createDeferred();
      let childDfd = createDeferred();
      let router = createMemoryRouter(
        [
          {
            path: "/",
            HydrateFallback: () => <p>Root Loading...</p>,
            Component() {
              return (
                <>
                  <h1>Root</h1>
                  <Outlet />
                </>
              );
            },
            children: [
              {
                id: "parent",
                path: "parent",
                loader: () => parentDfd.promise,
                Component() {
                  let data = useLoaderData() as string;
                  return (
                    <>
                      <h2>{`Parent - ${data}`}</h2>
                      <Outlet />
                    </>
                  );
                },
              },
            ],
          },
        ],
        {
          future: {
            v7_partialHydration: true,
          },
          patchRoutesOnNavigation({ path, patch }) {
            if (path === "/parent/child") {
              patch("parent", [
                {
                  path: "child",
                  loader: () => childDfd.promise,
                  Component() {
                    let data = useLoaderData() as string;
                    return <h3>{`Child - ${data}`}</h3>;
                  },
                },
              ]);
            }
          },
          initialEntries: ["/parent/child"],
        }
      );
      let { container } = render(
        // eslint-disable-next-line react/jsx-pascal-case
        <ReactRouter_RouterProvider router={router} />
      );

      parentDfd.resolve("PARENT DATA");
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Root Loading...
          </p>
        </div>"
      `);

      childDfd.resolve("CHILD DATA");
      await waitFor(() => screen.getByText(/CHILD DATA/));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <h1>
            Root
          </h1>
          <h2>
            Parent - PARENT DATA
          </h2>
          <h3>
            Child - CHILD DATA
          </h3>
        </div>"
      `);
    });
  });
});

function testPartialHydration(
  createTestRouter:
    | typeof createBrowserRouter
    | typeof createHashRouter
    | typeof createMemoryRouter,
  RouterProvider:
    | typeof ReactRouterDom_RouterProvider
    | typeof ReactRouter_RouterProvider
) {
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarn.mockRestore();
  });

  it("supports partial hydration w/leaf fallback", async () => {
    let dfd = createDeferred();
    let router = createTestRouter(
      [
        {
          id: "root",
          path: "/",
          loader: () => "ROOT",
          Component() {
            let data = useLoaderData() as string;
            return (
              <>
                <h1>{`Home - ${data}`}</h1>
                <Outlet />
              </>
            );
          },
          children: [
            {
              id: "index",
              index: true,
              loader: () => dfd.promise,
              HydrateFallback: () => <p>Index Loading...</p>,
              Component() {
                let data = useLoaderData() as string;
                return <h2>{`Index - ${data}`}</h2>;
              },
            },
          ],
        },
      ],
      {
        hydrationData: {
          loaderData: {
            root: "HYDRATED ROOT",
          },
        },
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home - HYDRATED ROOT
        </h1>
        <p>
          Index Loading...
        </p>
      </div>"
    `);

    dfd.resolve("INDEX DATA");
    await waitFor(() => screen.getByText(/INDEX DATA/));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home - HYDRATED ROOT
        </h1>
        <h2>
          Index - INDEX DATA
        </h2>
      </div>"
    `);
  });

  it("supports partial hydration w/root fallback", async () => {
    let dfd = createDeferred();
    let router = createTestRouter(
      [
        {
          id: "root",
          path: "/",
          loader: () => "ROOT",
          HydrateFallback: () => <p>Root Loading...</p>,
          Component() {
            let data = useLoaderData() as string;
            return (
              <>
                <h1>{`Home - ${data}`}</h1>
                <Outlet />
              </>
            );
          },
          children: [
            {
              id: "index",
              index: true,
              loader: () => dfd.promise,
              Component() {
                let data = useLoaderData() as string;
                return <h2>{`Index - ${data}`}</h2>;
              },
            },
          ],
        },
      ],
      {
        hydrationData: {
          loaderData: {
            root: "HYDRATED ROOT",
          },
        },
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <p>
          Root Loading...
        </p>
      </div>"
    `);

    dfd.resolve("INDEX DATA");
    await waitFor(() => screen.getByText(/INDEX DATA/));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home - HYDRATED ROOT
        </h1>
        <h2>
          Index - INDEX DATA
        </h2>
      </div>"
    `);
  });

  it("supports partial hydration w/no fallback", async () => {
    let dfd = createDeferred();
    let router = createTestRouter(
      [
        {
          id: "root",
          path: "/",
          loader: () => "ROOT",
          Component() {
            let data = useLoaderData() as string;
            return (
              <>
                <h1>{`Home - ${data}`}</h1>
                <Outlet />
              </>
            );
          },
          children: [
            {
              id: "index",
              index: true,
              loader: () => dfd.promise,
              Component() {
                let data = useLoaderData() as string;
                return <h2>{`Index - ${data}`}</h2>;
              },
            },
          ],
        },
      ],
      {
        hydrationData: {
          loaderData: {
            root: "HYDRATED ROOT",
          },
        },
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    expect(getHtml(container)).toMatchInlineSnapshot(`"<div />"`);

    // We can't assert this in all 3 test executions because we use `warningOnce`
    // internally to avoid logging on every render
    if (!didAssertMissingHydrateFallback) {
      didAssertMissingHydrateFallback = true;
      // eslint-disable-next-line jest/no-conditional-expect
      expect(consoleWarn).toHaveBeenCalledWith(
        "No `HydrateFallback` element provided to render during initial hydration"
      );
    }

    dfd.resolve("INDEX DATA");
    await waitFor(() => screen.getByText(/INDEX DATA/));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home - HYDRATED ROOT
        </h1>
        <h2>
          Index - INDEX DATA
        </h2>
      </div>"
    `);
  });

  it("does not re-run loaders that don't have loader data due to errors", async () => {
    let spy = jest.fn();
    let router = createTestRouter(
      [
        {
          id: "root",
          path: "/",
          loader: () => "ROOT",
          Component() {
            let data = useLoaderData() as string;
            return (
              <>
                <h1>{`Home - ${data}`}</h1>
                <Outlet />
              </>
            );
          },
          children: [
            {
              id: "index",
              index: true,
              loader: spy,
              HydrateFallback: () => <p>Index Loading...</p>,
              Component() {
                let data = useLoaderData() as string;
                return <h2>{`Index - ${data}`}</h2>;
              },
              ErrorBoundary() {
                let error = useRouteError() as string;
                return <p>{error}</p>;
              },
            },
          ],
        },
      ],
      {
        hydrationData: {
          loaderData: {
            root: "HYDRATED ROOT",
          },
          errors: {
            index: "INDEX ERROR",
          },
        },
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home - HYDRATED ROOT
        </h1>
        <p>
          INDEX ERROR
        </p>
      </div>"
    `);

    expect(spy).not.toHaveBeenCalled();
  });

  it("lets users force hydration loader execution with loader.hydrate=true", async () => {
    let dfd = createDeferred();
    let indexLoader: LoaderFunction = () => dfd.promise;
    indexLoader.hydrate = true;
    let router = createTestRouter(
      [
        {
          id: "root",
          path: "/",
          loader: () => "ROOT",
          Component() {
            let data = useLoaderData() as string;
            return (
              <>
                <h1>{`Home - ${data}`}</h1>
                <Outlet />
              </>
            );
          },
          children: [
            {
              id: "index",
              index: true,
              loader: indexLoader,
              HydrateFallback: () => <p>Index Loading...</p>,
              Component() {
                let data = useLoaderData() as string;
                return <h2>{`Index - ${data}`}</h2>;
              },
            },
          ],
        },
      ],
      {
        hydrationData: {
          loaderData: {
            root: "HYDRATED ROOT",
            index: "INDEX INITIAL",
          },
        },
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home - HYDRATED ROOT
        </h1>
        <h2>
          Index - INDEX INITIAL
        </h2>
      </div>"
    `);

    dfd.resolve("INDEX UPDATED");
    await waitFor(() => screen.getByText(/INDEX UPDATED/));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home - HYDRATED ROOT
        </h1>
        <h2>
          Index - INDEX UPDATED
        </h2>
      </div>"
    `);
  });

  it("supports partial hydration w/lazy initial routes (leaf fallback)", async () => {
    let dfd = createDeferred();
    let router = createTestRouter([
      {
        path: "/",
        Component() {
          return (
            <>
              <h1>Root</h1>
              <Outlet />
            </>
          );
        },
        children: [
          {
            id: "index",
            index: true,
            HydrateFallback: () => <p>Index Loading...</p>,
            async lazy() {
              await tick();
              return {
                loader: () => dfd.promise,
                Component() {
                  let data = useLoaderData() as string;
                  return <h2>{`Index - ${data}`}</h2>;
                },
              };
            },
          },
        ],
      },
    ]);
    let { container } = render(<RouterProvider router={router} />);

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Root
        </h1>
        <p>
          Index Loading...
        </p>
      </div>"
    `);

    dfd.resolve("INDEX DATA");
    await waitFor(() => screen.getByText(/INDEX DATA/));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Root
        </h1>
        <h2>
          Index - INDEX DATA
        </h2>
      </div>"
    `);
  });

  it("supports partial hydration w/lazy initial routes (root fallback)", async () => {
    let dfd = createDeferred();
    let router = createTestRouter([
      {
        path: "/",
        Component() {
          return (
            <>
              <h1>Root</h1>
              <Outlet />
            </>
          );
        },
        HydrateFallback: () => <p>Loading...</p>,
        children: [
          {
            id: "index",
            index: true,
            async lazy() {
              await tick();
              return {
                loader: () => dfd.promise,
                Component() {
                  let data = useLoaderData() as string;
                  return <h2>{`Index - ${data}`}</h2>;
                },
              };
            },
          },
        ],
      },
    ]);
    let { container } = render(<RouterProvider router={router} />);

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <p>
          Loading...
        </p>
      </div>"
    `);

    dfd.resolve("INDEX DATA");
    await waitFor(() => screen.getByText(/INDEX DATA/));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Root
        </h1>
        <h2>
          Index - INDEX DATA
        </h2>
      </div>"
    `);
  });

  it("preserves hydrated errors for non-hydrating loaders", async () => {
    let dfd = createDeferred();
    let rootSpy: LoaderFunction = jest.fn(() => dfd.promise);
    rootSpy.hydrate = true;

    let indexSpy = jest.fn();

    let router = createTestRouter(
      [
        {
          id: "root",
          path: "/",
          loader: rootSpy,
          Component() {
            let data = useLoaderData() as string;
            return (
              <>
                <h1>{`Home - ${data}`}</h1>
                <Outlet />
              </>
            );
          },
          children: [
            {
              id: "index",
              index: true,
              loader: indexSpy,
              Component() {
                let data = useLoaderData() as string;
                return <h2>{`Index - ${data}`}</h2>;
              },
              ErrorBoundary() {
                let error = useRouteError() as string;
                return <p>{error}</p>;
              },
            },
          ],
        },
      ],
      {
        hydrationData: {
          loaderData: {
            root: "HYDRATED ROOT",
          },
          errors: {
            index: "INDEX ERROR",
          },
        },
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home - HYDRATED ROOT
        </h1>
        <p>
          INDEX ERROR
        </p>
      </div>"
    `);

    expect(router.state.initialized).toBe(false);

    await act(() => dfd.resolve("UPDATED ROOT"));

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home - UPDATED ROOT
        </h1>
        <p>
          INDEX ERROR
        </p>
      </div>"
    `);

    expect(rootSpy).toHaveBeenCalledTimes(1);
    expect(indexSpy).not.toHaveBeenCalled();
  });
}
