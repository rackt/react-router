import type { ErrorResponse, Fetcher } from "@remix-run/router";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { JSDOM } from "jsdom";
import * as React from "react";
import type { RouteObject } from "react-router-dom";
import {
  UNSAFE_DataRouterStateContext as DataRouterStateContext,
  Form,
  Link,
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createHashRouter,
  createRoutesFromElements,
  defer,
  isRouteErrorResponse,
  matchRoutes,
  redirect,
  useActionData,
  useFetcher,
  useFetchers,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRouteError,
  useSearchParams,
  useSubmit,
} from "react-router-dom";

import getHtml from "../../react-router/__tests__/utils/getHtml";
import { createDeferred } from "../../router/__tests__/utils/utils";

testDomRouter("<DataBrowserRouter>", createBrowserRouter, (url) =>
  getWindowImpl(url, false)
);

testDomRouter("<DataHashRouter>", createHashRouter, (url) =>
  getWindowImpl(url, true)
);

function testDomRouter(
  name: string,
  createTestRouter: typeof createBrowserRouter | typeof createHashRouter,
  getWindow: (initialUrl: string, isHash?: boolean) => Window
) {
  // Utility to assert location info based on the type of router
  function assertLocation(
    testWindow: Window,
    pathname: string,
    search?: string
  ) {
    if (name === "<DataHashRouter>") {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(testWindow.location.hash).toEqual("#" + pathname + (search || ""));
    } else {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(testWindow.location.pathname).toEqual(pathname);
      if (search) {
        expect(testWindow.location.search).toEqual(search);
      }
    }
  }

  describe(`Router: ${name}`, () => {
    let consoleWarn: jest.SpyInstance;
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
      consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
      consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      window.__staticRouterHydrationData = undefined;
      consoleWarn.mockRestore();
      consoleError.mockRestore();
    });

    it("renders the first route that matches the URL", () => {
      let router = createTestRouter(
        createRoutesFromElements(<Route path="/" element={<h1>Home</h1>} />)
      );
      let { container } = render(<RouterProvider router={router} />);

      expect(getHtml(container)).toMatchInlineSnapshot(`
         "<div>
           <h1>
             Home
           </h1>
         </div>"
       `);
    });

    it("renders the first route that matches the URL when wrapped in a root Route", () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/my/base/path">
            <Route element={<Outlet />}>
              <Route path="thing" element={<h1>Heyooo</h1>} />
            </Route>
          </Route>
        ),
        {
          window: getWindow("/my/base/path/thing"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      expect(getHtml(container)).toMatchInlineSnapshot(`
         "<div>
           <h1>
             Heyooo
           </h1>
         </div>"
       `);
    });

    it("supports a basename prop", () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="thing" element={<h1>Heyooo</h1>} />
        ),
        {
          basename: "/my/base/path",
          window: getWindow("/my/base/path/thing"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <h1>
            Heyooo
          </h1>
        </div>"
      `);
    });

    it("renders with hydration data", async () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Comp />}>
            <Route path="child" element={<Comp />} />
          </Route>
        ),
        {
          window: getWindow("/child"),
          hydrationData: {
            loaderData: {
              "0": "parent data",
              "0-0": "child data",
            },
            actionData: {
              "0-0": "child action",
            },
          },
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Comp() {
        let data = useLoaderData();
        let actionData = useActionData();
        let navigation = useNavigation();
        return (
          <div>
            <>{data}</>
            <>{actionData}</>
            <>{navigation.state}</>
            <Outlet />
          </div>
        );
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            parent data
            idle
            <div>
              child data
              child action
              idle
            </div>
          </div>
        </div>"
      `);
    });

    it("handles automatic hydration from the window", async () => {
      window.__staticRouterHydrationData = {
        loaderData: {
          "0": "parent data",
          "0-0": "child data",
        },
        actionData: {
          "0-0": "child action",
        },
      };
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Comp />}>
            <Route path="child" element={<Comp />} />
          </Route>
        ),
        {
          window: getWindow("/child"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Comp() {
        let data = useLoaderData();
        let actionData = useActionData();
        let navigation = useNavigation();
        return (
          <div>
            <>{data}</>
            <>{actionData}</>
            <>{navigation.state}</>
            <Outlet />
          </div>
        );
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            parent data
            idle
            <div>
              child data
              child action
              idle
            </div>
          </div>
        </div>"
      `);
    });

    it("deserializes ErrorResponse instances from the window", async () => {
      window.__staticRouterHydrationData = {
        loaderData: {},
        actionData: null,
        errors: {
          "0": {
            status: 404,
            statusText: "Not Found",
            internal: false,
            data: { not: "found" },
            __type: "RouteErrorResponse",
          },
        },
      };
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<h1>Nope</h1>} errorElement={<Boundary />} />
        )
      );
      let { container } = render(<RouterProvider router={router} />);

      function Boundary() {
        let error = useRouteError() as unknown;
        return isRouteErrorResponse(error) ? (
          <pre>{JSON.stringify(error)}</pre>
        ) : (
          <p>No :(</p>
        );
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <pre>
            {"status":404,"statusText":"Not Found","internal":false,"data":{"not":"found"}}
          </pre>
        </div>"
      `);
    });

    it("deserializes Error instances from the window", async () => {
      window.__staticRouterHydrationData = {
        loaderData: {},
        actionData: null,
        errors: {
          "0": {
            message: "error message",
            __type: "Error",
          },
        },
      };
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<h1>Nope</h1>} errorElement={<Boundary />} />
        )
      );
      let { container } = render(<RouterProvider router={router} />);

      function Boundary() {
        let error = useRouteError() as Error;
        return error instanceof Error ? (
          <>
            <pre>{error.toString()}</pre>
            <pre>stack:{error.stack}</pre>
          </>
        ) : (
          <p>No :(</p>
        );
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <pre>
            Error: error message
          </pre>
          <pre>
            stack:
          </pre>
        </div>"
      `);
    });

    it("deserializes Error subclass instances from the window", async () => {
      window.__staticRouterHydrationData = {
        loaderData: {},
        actionData: null,
        errors: {
          "0": {
            message: "error message",
            __type: "Error",
            __subType: "ReferenceError",
          },
        },
      };
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<h1>Nope</h1>} errorElement={<Boundary />} />
        )
      );
      let { container } = render(<RouterProvider router={router} />);

      function Boundary() {
        let error = useRouteError() as Error;
        return error instanceof Error ? (
          <>
            <pre>{error.toString()}</pre>
            <pre>stack:{error.stack}</pre>
          </>
        ) : (
          <p>No :(</p>
        );
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <pre>
            ReferenceError: error message
          </pre>
          <pre>
            stack:
          </pre>
        </div>"
      `);
    });

    it("renders fallbackElement while first data fetch happens", async () => {
      let fooDefer = createDeferred();
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Outlet />}>
            <Route
              path="foo"
              loader={() => fooDefer.promise}
              element={<Foo />}
            />
            <Route path="bar" element={<Bar />} />
          </Route>
        ),
        {
          window: getWindow("/foo"),
        }
      );
      let { container } = render(
        <RouterProvider router={router} fallbackElement={<FallbackElement />} />
      );

      function FallbackElement() {
        return <p>Loading...</p>;
      }

      function Foo() {
        let data = useLoaderData() as { message: string };
        return <h1>Foo:{data.message}</h1>;
      }

      function Bar() {
        return <h1>Bar Heading</h1>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Loading...
          </p>
        </div>"
      `);

      fooDefer.resolve({ message: "From Foo Loader" });
      await waitFor(() => screen.getByText("Foo:From Foo Loader"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <h1>
            Foo:
            From Foo Loader
          </h1>
        </div>"
      `);
    });

    it("renders fallbackElement while first data fetch and lazy route load happens", async () => {
      let fooDefer = createDeferred();
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Outlet />}>
            <Route
              path="foo"
              lazy={async () => {
                return {
                  loader: () => fooDefer.promise,
                  element: <Foo />,
                };
              }}
            />
            <Route path="bar" element={<Bar />} />
          </Route>
        ),
        {
          window: getWindow("/foo"),
        }
      );
      let { container } = render(
        <RouterProvider router={router} fallbackElement={<FallbackElement />} />
      );

      function FallbackElement() {
        return <p>Loading...</p>;
      }

      function Foo() {
        let data = useLoaderData() as { message: string };
        return <h1>Foo:{data.message}</h1>;
      }

      function Bar() {
        return <h1>Bar Heading</h1>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Loading...
          </p>
        </div>"
      `);

      fooDefer.resolve({ message: "From Lazy Foo Loader" });
      await waitFor(() => screen.getByText("Foo:From Lazy Foo Loader"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <h1>
            Foo:
            From Lazy Foo Loader
          </h1>
        </div>"
      `);
    });

    it("does not render fallbackElement if no data fetch or lazy loading is required", async () => {
      let fooDefer = createDeferred();
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Outlet />}>
            <Route
              path="foo"
              loader={() => fooDefer.promise}
              element={<Foo />}
            />
            <Route path="bar" element={<Bar />} />
          </Route>
        ),
        {
          window: getWindow("/bar"),
        }
      );
      let { container } = render(
        <RouterProvider router={router} fallbackElement={<FallbackElement />} />
      );

      function FallbackElement() {
        return <p>Loading...</p>;
      }

      function Foo() {
        let data = useLoaderData() as { message: string };
        return <h1>Foo:{data.message}</h1>;
      }

      function Bar() {
        return <h1>Bar Heading</h1>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <h1>
            Bar Heading
          </h1>
        </div>"
      `);
    });

    it("renders fallbackElement within router contexts", async () => {
      let fooDefer = createDeferred();
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Outlet />}>
            <Route
              path="foo"
              loader={() => fooDefer.promise}
              element={<Foo />}
            />
          </Route>
        ),
        { window: getWindow("/foo") }
      );
      let { container } = render(
        <RouterProvider router={router} fallbackElement={<FallbackElement />} />
      );

      function FallbackElement() {
        let location = useLocation();
        return <p>Loading{location.pathname}</p>;
      }

      function Foo() {
        let data = useLoaderData() as { message: string };
        return <h1>Foo:{data.message}</h1>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Loading
            /foo
          </p>
        </div>"
      `);

      fooDefer.resolve({ message: "From Foo Loader" });
      await waitFor(() => screen.getByText("Foo:From Foo Loader"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <h1>
            Foo:
            From Foo Loader
          </h1>
        </div>"
      `);
    });

    it("handles link navigations", async () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Layout />}>
            <Route path="foo" element={<h1>Foo Heading</h1>} />
            <Route path="bar" element={<h1>Bar Heading</h1>} />
          </Route>
        ),
        { window: getWindow("/foo") }
      );
      render(<RouterProvider router={router} />);

      function Layout() {
        return (
          <div>
            <Link to="/foo">Link to Foo</Link>
            <Link to="/bar">Link to Bar</Link>
            <Outlet />
          </div>
        );
      }

      expect(screen.getByText("Foo Heading")).toBeDefined();
      fireEvent.click(screen.getByText("Link to Bar"));
      await waitFor(() => screen.getByText("Bar Heading"));

      fireEvent.click(screen.getByText("Link to Foo"));
      await waitFor(() => screen.getByText("Foo Heading"));
    });

    it("handles link navigations when using a basename", async () => {
      let testWindow = getWindow("/base/name/foo");
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Layout />}>
            <Route path="foo" element={<h1>Foo Heading</h1>} />
            <Route path="bar" element={<h1>Bar Heading</h1>} />
          </Route>
        ),
        {
          window: testWindow,
          basename: "/base/name",
        }
      );
      render(<RouterProvider router={router} />);

      function Layout() {
        return (
          <div>
            <Link to="/foo">Link to Foo</Link>
            <Link to="/bar">Link to Bar</Link>
            <div id="output">
              <Outlet />
            </div>
          </div>
        );
      }

      assertLocation(testWindow, "/base/name/foo");
      expect(screen.getByText("Foo Heading")).toBeDefined();

      fireEvent.click(screen.getByText("Link to Bar"));
      await waitFor(() => screen.getByText("Bar Heading"));
      assertLocation(testWindow, "/base/name/bar");

      fireEvent.click(screen.getByText("Link to Foo"));
      await waitFor(() => screen.getByText("Foo Heading"));
      assertLocation(testWindow, "/base/name/foo");
    });

    it("executes route loaders on navigation", async () => {
      let barDefer = createDeferred();

      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Layout />}>
            <Route path="foo" element={<Foo />} />
            <Route
              path="bar"
              loader={() => barDefer.promise}
              element={<Bar />}
            />
          </Route>
        ),
        { window: getWindow("/foo") }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigation = useNavigation();
        return (
          <div>
            <Link to="/bar">Link to Bar</Link>
            <div id="output">
              <p>{navigation.state}</p>
              <Outlet />
            </div>
          </div>
        );
      }

      function Foo() {
        return <h1>Foo</h1>;
      }
      function Bar() {
        let data = useLoaderData() as { message: string };
        return <h1>{data.message}</h1>;
      }

      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <h1>
              Foo
            </h1>
          </div>"
        `);

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              loading
            </p>
            <h1>
              Foo
            </h1>
          </div>"
        `);

      barDefer.resolve({ message: "Bar Loader" });
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <h1>
              Bar Loader
            </h1>
          </div>"
        `);
    });

    it("executes lazy route loaders on navigation", async () => {
      let barDefer = createDeferred();

      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Layout />}>
            <Route path="foo" element={<Foo />} />
            <Route
              path="bar"
              lazy={async () => ({
                loader: () => barDefer.promise,
                element: <Bar />,
              })}
            />
          </Route>
        ),
        {
          window: getWindow("/foo"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigation = useNavigation();
        return (
          <div>
            <Link to="/bar">Link to Bar</Link>
            <div id="output">
              <p>{navigation.state}</p>
              <Outlet />
            </div>
          </div>
        );
      }

      function Foo() {
        return <h1>Foo</h1>;
      }
      function Bar() {
        let data = useLoaderData() as { message: string };
        return <h1>{data.message}</h1>;
      }

      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <h1>
              Foo
            </h1>
          </div>"
        `);

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              loading
            </p>
            <h1>
              Foo
            </h1>
          </div>"
        `);

      barDefer.resolve({ message: "Bar Loader" });
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <h1>
              Bar Loader
            </h1>
          </div>"
        `);
    });

    it("handles link navigations with preventScrollReset", async () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Layout />}>
            <Route path="foo" element={<h1>Foo Heading</h1>} />
            <Route path="bar" element={<h1>Bar Heading</h1>} />
          </Route>
        ),
        { window: getWindow("/foo") }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let state = React.useContext(DataRouterStateContext);
        return (
          <div>
            <Link to="/foo" preventScrollReset>
              Link to Foo
            </Link>
            <Link to="/bar">Link to Bar</Link>
            <p id="preventScrollReset">{String(state?.preventScrollReset)}</p>
            <Outlet />
          </div>
        );
      }

      fireEvent.click(screen.getByText("Link to Bar"));
      await waitFor(() => screen.getByText("Bar Heading"));
      expect(getHtml(container.querySelector("#preventScrollReset")!))
        .toMatchInlineSnapshot(`
        "<p
          id="preventScrollReset"
        >
          false
        </p>"
      `);

      fireEvent.click(screen.getByText("Link to Foo"));
      await waitFor(() => screen.getByText("Foo Heading"));
      expect(getHtml(container.querySelector("#preventScrollReset")!))
        .toMatchInlineSnapshot(`
        "<p
          id="preventScrollReset"
        >
          true
        </p>"
      `);
    });

    it("handles link navigations with preventScrollReset={true}", async () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Layout />}>
            <Route path="foo" element={<h1>Foo Heading</h1>} />
            <Route path="bar" element={<h1>Bar Heading</h1>} />
          </Route>
        ),
        { window: getWindow("/foo") }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let state = React.useContext(DataRouterStateContext);
        return (
          <div>
            <Link to="/foo" preventScrollReset={true}>
              Link to Foo
            </Link>
            <Link to="/bar">Link to Bar</Link>
            <p id="preventScrollReset">{String(state?.preventScrollReset)}</p>
            <Outlet />
          </div>
        );
      }

      fireEvent.click(screen.getByText("Link to Bar"));
      await waitFor(() => screen.getByText("Bar Heading"));
      expect(getHtml(container.querySelector("#preventScrollReset")!))
        .toMatchInlineSnapshot(`
        "<p
          id="preventScrollReset"
        >
          false
        </p>"
      `);

      fireEvent.click(screen.getByText("Link to Foo"));
      await waitFor(() => screen.getByText("Foo Heading"));
      expect(getHtml(container.querySelector("#preventScrollReset")!))
        .toMatchInlineSnapshot(`
        "<p
          id="preventScrollReset"
        >
          true
        </p>"
      `);
    });

    it("executes route actions/loaders on useSubmit navigations", async () => {
      let loaderDefer = createDeferred();
      let actionDefer = createDeferred();

      let router = createTestRouter(
        createRoutesFromElements(
          <Route
            path="/"
            action={() => actionDefer.promise}
            loader={() => loaderDefer.promise}
            element={<Home />}
          />
        ),
        {
          window: getWindow("/"),
          hydrationData: { loaderData: { "0": null } },
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Home() {
        let data = useLoaderData() as string;
        let actionData = useActionData() as string | undefined;
        let navigation = useNavigation();
        let submit = useSubmit();
        let formRef = React.useRef<HTMLFormElement>(null);
        return (
          <div>
            <form method="post" action="/" ref={formRef}>
              <input name="test" value="value" />
            </form>
            <button onClick={() => submit(formRef.current!)}>
              Submit Form
            </button>
            <div id="output">
              <p>{navigation.state}</p>
              <p>{data}</p>
              <p>{actionData}</p>
            </div>
            <Outlet />
          </div>
        );
      }

      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <p />
          <p />
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit Form"));
      await waitFor(() => screen.getByText("submitting"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            submitting
          </p>
          <p />
          <p />
        </div>"
      `);

      actionDefer.resolve("Action Data");
      await waitFor(() => screen.getByText("loading"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            loading
          </p>
          <p />
          <p>
            Action Data
          </p>
        </div>"
      `);

      loaderDefer.resolve("Loader Data");
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <p>
            Loader Data
          </p>
          <p>
            Action Data
          </p>
        </div>"
      `);
    });

    it("executes lazy route actions/loaders on useSubmit navigations", async () => {
      let loaderDefer = createDeferred();
      let actionDefer = createDeferred();

      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Home />}>
            <Route index element={<h1>Home</h1>} />
            <Route
              path="action"
              lazy={async () => ({
                action: () => actionDefer.promise,
                loader: () => loaderDefer.promise,
                Component() {
                  let data = useLoaderData() as string;
                  let actionData = useActionData() as string | undefined;
                  return (
                    <>
                      <h1>Action</h1>
                      <p>{data}</p>
                      <p>{actionData}</p>
                    </>
                  );
                },
              })}
            />
          </Route>
        ),
        {
          window: getWindow("/"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Home() {
        let navigation = useNavigation();
        let submit = useSubmit();
        let formRef = React.useRef<HTMLFormElement>(null);
        return (
          <div>
            <form method="post" action="/action" ref={formRef}>
              <input name="test" value="value" />
            </form>
            <button onClick={() => submit(formRef.current)}>Submit Form</button>
            <div id="output">
              <p>{navigation.state}</p>
              <Outlet />
            </div>
          </div>
        );
      }

      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <h1>
            Home
          </h1>
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit Form"));
      await waitFor(() => screen.getByText("submitting"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            submitting
          </p>
          <h1>
            Home
          </h1>
        </div>"
      `);

      actionDefer.resolve("Action Data");
      await waitFor(() => screen.getByText("loading"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            loading
          </p>
          <h1>
            Home
          </h1>
        </div>"
      `);

      loaderDefer.resolve("Loader Data");
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <h1>
            Action
          </h1>
          <p>
            Loader Data
          </p>
          <p>
            Action Data
          </p>
        </div>"
      `);
    });

    it("executes route loaders on <Form method=get> navigations", async () => {
      let loaderDefer = createDeferred();
      let actionDefer = createDeferred();

      let router = createTestRouter(
        createRoutesFromElements(
          <Route
            path="/"
            action={() => actionDefer.promise}
            loader={async ({ request }) => {
              let resolvedValue = await loaderDefer.promise;
              let urlParam = new URL(
                `https://remix.run${request.url}`
              ).searchParams.get("test");
              return `${resolvedValue}:${urlParam}`;
            }}
            element={<Home />}
          />
        ),
        {
          window: getWindow("/"),
          hydrationData: { loaderData: { "0": null } },
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Home() {
        let data = useLoaderData() as string;
        let actionData = useActionData() as string | undefined;
        let navigation = useNavigation();
        return (
          <div>
            <Form method="get">
              <input name="test" value="value" />
              <button type="submit">Submit Form</button>
            </Form>
            <div id="output">
              <p>{navigation.state}</p>
              <p>{data}</p>
              <p>{actionData}</p>
            </div>
            <Outlet />
          </div>
        );
      }

      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <p />
          <p />
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit Form"));
      await waitFor(() => screen.getByText("loading"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            loading
          </p>
          <p />
          <p />
        </div>"
      `);

      loaderDefer.resolve("Loader Data");
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <p>
            Loader Data:value
          </p>
          <p />
        </div>"
      `);
    });

    it("executes lazy route loaders on <Form method=get> navigations", async () => {
      let loaderDefer = createDeferred();
      let actionDefer = createDeferred();

      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Home />}>
            <Route index element={<h1>Home</h1>} />
            <Route
              path="path"
              lazy={async () => ({
                action: () => actionDefer.promise,
                loader: async ({ request }) => {
                  let resolvedValue = await loaderDefer.promise;
                  let urlParam = new URL(
                    `https://remix.run${request.url}`
                  ).searchParams.get("test");
                  return `${resolvedValue}:${urlParam}`;
                },
                Component() {
                  let data = useLoaderData() as string;
                  let actionData = useActionData() as string | undefined;
                  return (
                    <>
                      <h1>Path</h1>
                      <p>{data}</p>
                      <p>{actionData}</p>
                    </>
                  );
                },
              })}
            />
          </Route>
        ),
        {
          window: getWindow("/"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Home() {
        let navigation = useNavigation();
        return (
          <div>
            <Form method="get" action="path">
              <input name="test" value="value" />
              <button type="submit">Submit Form</button>
            </Form>
            <div id="output">
              <p>{navigation.state}</p>
              <Outlet />
            </div>
          </div>
        );
      }

      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <h1>
            Home
          </h1>
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit Form"));
      await waitFor(() => screen.getByText("loading"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            loading
          </p>
          <h1>
            Home
          </h1>
        </div>"
      `);

      loaderDefer.resolve("Loader Data");
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <h1>
            Path
          </h1>
          <p>
            Loader Data:value
          </p>
          <p />
        </div>"
      `);
    });

    it("executes route actions/loaders on <Form method=post> navigations", async () => {
      let loaderDefer = createDeferred();
      let actionDefer = createDeferred();

      let router = createTestRouter(
        createRoutesFromElements(
          <Route
            path="/"
            action={async ({ request }) => {
              let resolvedValue = await actionDefer.promise;
              let formData = await request.formData();
              return `${resolvedValue}:${formData.get("test")}`;
            }}
            loader={() => loaderDefer.promise}
            element={<Home />}
          />
        ),
        {
          window: getWindow("/"),
          hydrationData: { loaderData: { "0": null } },
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Home() {
        let data = useLoaderData() as string;
        let actionData = useActionData() as string | undefined;
        let navigation = useNavigation();
        return (
          <div>
            <Form method="post">
              <input name="test" value="value" />
              <button type="submit">Submit Form</button>
            </Form>
            <div id="output">
              <p>{navigation.state}</p>
              <p>{data}</p>
              <p>{actionData}</p>
            </div>
            <Outlet />
          </div>
        );
      }

      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <p />
          <p />
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit Form"));
      await waitFor(() => screen.getByText("submitting"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            submitting
          </p>
          <p />
          <p />
        </div>"
      `);

      actionDefer.resolve("Action Data");
      await waitFor(() => screen.getByText("loading"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            loading
          </p>
          <p />
          <p>
            Action Data:value
          </p>
        </div>"
      `);

      loaderDefer.resolve("Loader Data");
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <p>
            Loader Data
          </p>
          <p>
            Action Data:value
          </p>
        </div>"
      `);
    });

    it("executes lazy route actions/loaders on <Form method=post> navigations", async () => {
      let loaderDefer = createDeferred();
      let actionDefer = createDeferred();

      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" element={<Home />}>
            <Route index element={<h1>Home</h1>} />
            <Route
              path="action"
              lazy={async () => ({
                action: async ({ request }) => {
                  let resolvedValue = await actionDefer.promise;
                  let formData = await request.formData();
                  return `${resolvedValue}:${formData.get("test")}`;
                },
                loader: () => loaderDefer.promise,
                Component() {
                  let data = useLoaderData() as string;
                  let actionData = useActionData() as string | undefined;
                  return (
                    <>
                      <h1>Action</h1>
                      <p>{data}</p>
                      <p>{actionData}</p>
                    </>
                  );
                },
              })}
            />
          </Route>
        ),
        {
          window: getWindow("/"),
          hydrationData: { loaderData: { "0": null } },
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Home() {
        let navigation = useNavigation();
        return (
          <div>
            <Form method="post" action="action">
              <input name="test" value="value" />
              <button type="submit">Submit Form</button>
            </Form>
            <div id="output">
              <p>{navigation.state}</p>
              <Outlet />
            </div>
          </div>
        );
      }

      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <h1>
            Home
          </h1>
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit Form"));
      await waitFor(() => screen.getByText("submitting"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            submitting
          </p>
          <h1>
            Home
          </h1>
        </div>"
      `);

      actionDefer.resolve("Action Data");
      await waitFor(() => screen.getByText("loading"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            loading
          </p>
          <h1>
            Home
          </h1>
        </div>"
      `);

      loaderDefer.resolve("Loader Data");
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <h1>
            Action
          </h1>
          <p>
            Loader Data
          </p>
          <p>
            Action Data:value
          </p>
        </div>"
      `);
    });

    it("supports <Form state>", async () => {
      let testWindow = getWindow("/");
      let router = createTestRouter(
        [
          {
            path: "/",
            Component() {
              return (
                <Form method="post" action="/action" state={{ key: "value" }}>
                  <button type="submit">Submit</button>
                </Form>
              );
            },
          },
          {
            path: "/action",
            action: () => null,
            Component() {
              let state = useLocation().state;
              return <p>{JSON.stringify(state)}</p>;
            },
          },
        ],
        { window: testWindow }
      );
      let { container } = render(<RouterProvider router={router} />);
      expect(testWindow.history.state.usr).toBeUndefined();

      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => screen.getByText('{"key":"value"}'));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            {"key":"value"}
          </p>
        </div>"
      `);
      expect(testWindow.history.state.usr).toEqual({ key: "value" });
    });

    it("supports <Form reloadDocument={true}>", async () => {
      let actionSpy = jest.fn();
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/" action={actionSpy} element={<Home />} />
        )
      );
      render(<RouterProvider router={router} />);

      let handlerCalled;
      let defaultPrevented;

      function Home() {
        return (
          <Form
            method="post"
            reloadDocument={true}
            onSubmit={(e) => {
              handlerCalled = true;
              defaultPrevented = e.defaultPrevented;
            }}
          >
            <input name="test" value="value" />
            <button type="submit">Submit Form</button>
          </Form>
        );
      }

      fireEvent.click(screen.getByText("Submit Form"));
      expect(handlerCalled).toBe(true);
      expect(defaultPrevented).toBe(false);
      expect(actionSpy).not.toHaveBeenCalled();
    });

    it('defaults <Form method="get"> to be a PUSH navigation', async () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route element={<Layout />}>
            <Route index element={<h1>index</h1>} />
            <Route path="1" element={<h1>Page 1</h1>} />
            <Route path="2" element={<h1>Page 2</h1>} />
          </Route>
        ),
        {}
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigate = useNavigate();
        return (
          <>
            <Form action="1">
              <input name="test" defaultValue="value" />
              <button type="submit">Submit Form</button>
            </Form>
            <button onClick={() => navigate(-1)}>Go back</button>
            <div className="output">
              <Outlet />
            </div>
          </>
        );
      }

      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            index
          </h1>
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit Form"));
      await waitFor(() => screen.getByText("Page 1"));
      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            Page 1
          </h1>
        </div>"
      `);

      fireEvent.click(screen.getByText("Go back"));
      await waitFor(() => screen.getByText("index"));
      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            index
          </h1>
        </div>"
      `);
    });

    it('defaults <Form method="post"> to be a REPLACE navigation', async () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route element={<Layout />}>
            <Route index element={<h1>Index Page</h1>} />
            <Route
              path="form"
              action={() => "action data"}
              element={<FormPage />}
            />
            <Route path="result" element={<h1>Result Page</h1>} />
          </Route>
        ),
        {}
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigate = useNavigate();
        return (
          <>
            <Link to="form">Go to Form</Link>
            <button onClick={() => navigate(-1)}>Go back</button>
            <div className="output">
              <Outlet />
            </div>
          </>
        );
      }

      function FormPage() {
        let data = useActionData() as string | undefined;
        return (
          <Form method="post">
            <p>Form Page</p>
            <p>{data}</p>
            <input name="test" defaultValue="value" />
            <button type="submit">Submit</button>
          </Form>
        );
      }

      let html = () => getHtml(container.querySelector(".output")!);

      // Start on index page
      expect(html()).toMatch("Index Page");

      // Navigate to form page
      fireEvent.click(screen.getByText("Go to Form"));
      await waitFor(() => screen.getByText("Form Page"));
      expect(html()).not.toMatch("action result");

      // Submit without redirect does a replace
      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => screen.getByText("action data"));
      expect(html()).toMatch("Form Page");
      expect(html()).toMatch("action data");

      // Back navigate to index page
      fireEvent.click(screen.getByText("Go back"));
      await waitFor(() => screen.getByText("Index Page"));
    });

    it('Uses a PUSH navigation on <Form method="post"> if it redirects', async () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route element={<Layout />}>
            <Route index element={<h1>Index Page</h1>} />
            <Route
              path="form"
              action={() =>
                new Response(null, {
                  status: 302,
                  headers: { Location: "/result" },
                })
              }
              element={<FormPage />}
            />
            <Route path="result" element={<h1>Result Page</h1>} />
          </Route>
        ),
        { hydrationData: {} }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigate = useNavigate();
        return (
          <>
            <Link to="form">Go to Form</Link>
            <button onClick={() => navigate(-1)}>Go back</button>
            <div className="output">
              <Outlet />
            </div>
          </>
        );
      }

      function FormPage() {
        let data = useActionData() as string | undefined;
        return (
          <Form method="post">
            <p>Form Page</p>
            <p>{data}</p>
            <input name="test" defaultValue="value" />
            <button type="submit">Submit</button>
          </Form>
        );
      }

      let html = () => getHtml(container.querySelector(".output")!);

      // Start on index page
      expect(html()).toMatch("Index Page");

      // Navigate to form page
      fireEvent.click(screen.getByText("Go to Form"));
      await waitFor(() => screen.getByText("Form Page"));

      // Submit with redirect
      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => screen.getByText("Result Page"));

      // Back navigate to form page
      fireEvent.click(screen.getByText("Go back"));
      await waitFor(() => screen.getByText("Form Page"));
    });

    it('defaults useSubmit({ method: "get" }) to be a PUSH navigation', async () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route element={<Layout />}>
            <Route index element={<h1>index</h1>} />
            <Route path="1" loader={() => "1"} element={<h1>Page 1</h1>} />
            <Route path="2" loader={() => "2"} element={<h1>Page 2</h1>} />
          </Route>
        ),
        {
          window: getWindow("/"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigate = useNavigate();
        let submit = useSubmit();
        let formData = new FormData();
        formData.append("test", "value");
        return (
          <>
            <button
              onClick={() => submit(formData, { action: "1", method: "get" })}
            >
              Submit
            </button>
            <button onClick={() => navigate(-1)}>Go back</button>
            <div className="output">
              <Outlet />
            </div>
          </>
        );
      }

      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            index
          </h1>
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => screen.getByText("Page 1"));
      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            Page 1
          </h1>
        </div>"
      `);

      fireEvent.click(screen.getByText("Go back"));
      await waitFor(() => screen.getByText("index"));
      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            index
          </h1>
        </div>"
      `);
    });

    it('defaults useSubmit({ method: "post" }) to a new location to be a PUSH navigation', async () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route element={<Layout />}>
            <Route index element={<h1>index</h1>} />
            <Route path="1" element={<h1>Page 1</h1>} />
            <Route path="2" action={() => "action"} element={<h1>Page 2</h1>} />
          </Route>
        ),
        {
          window: getWindow("/"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigate = useNavigate();
        let submit = useSubmit();
        let formData = new FormData();
        formData.append("test", "value");
        return (
          <>
            <Link to="1">Go to 1</Link>
            <button
              onClick={() => {
                submit(formData, { action: "2", method: "post" });
              }}
            >
              Submit
            </button>
            <button onClick={() => navigate(-1)}>Go back</button>
            <div className="output">
              <Outlet />
            </div>
          </>
        );
      }

      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            index
          </h1>
        </div>"
      `);

      fireEvent.click(screen.getByText("Go to 1"));
      await waitFor(() => screen.getByText("Page 1"));
      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            Page 1
          </h1>
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => screen.getByText("Page 2"));
      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            Page 2
          </h1>
        </div>"
      `);

      fireEvent.click(screen.getByText("Go back"));
      await waitFor(() => screen.getByText("Page 1"));
      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            Page 1
          </h1>
        </div>"
      `);
    });

    it('defaults useSubmit({ method: "post" }) to the same location to be a REPLACE navigation', async () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route element={<Layout />}>
            <Route index element={<h1>index</h1>} />
            <Route
              path="1"
              action={() => "action"}
              loader={() => "1"}
              element={<Page />}
            />
          </Route>
        ),
        {
          window: getWindow("/"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigate = useNavigate();
        let submit = useSubmit();
        let formData = new FormData();
        formData.append("test", "value");
        return (
          <>
            <Link to="1">Go to 1</Link>
            <button
              onClick={() => {
                submit(formData, { action: "1", method: "post" });
              }}
            >
              Submit
            </button>
            <button onClick={() => navigate(-1)}>Go back</button>
            <div className="output">
              <Outlet />
            </div>
          </>
        );
      }

      function Page() {
        let actionData = useActionData() as string | undefined;
        return (
          <>
            <h1>Page 1</h1>
            <p>{actionData}</p>
          </>
        );
      }

      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            index
          </h1>
        </div>"
      `);

      fireEvent.click(screen.getByText("Go to 1"));
      await waitFor(() => screen.getByText("Page 1"));
      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            Page 1
          </h1>
          <p />
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => screen.getByText("action"));
      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            Page 1
          </h1>
          <p>
            action
          </p>
        </div>"
      `);

      fireEvent.click(screen.getByText("Go back"));
      await waitFor(() => screen.getByText("index"));
      expect(getHtml(container.querySelector(".output")!))
        .toMatchInlineSnapshot(`
        "<div
          class="output"
        >
          <h1>
            index
          </h1>
        </div>"
      `);
    });

    it('supports a basename on <Form method="get">', async () => {
      let testWindow = getWindow("/base/path");
      let router = createTestRouter(
        createRoutesFromElements(<Route path="path" element={<Comp />} />),
        { basename: "/base", window: testWindow }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Comp() {
        let location = useLocation();
        return (
          <Form>
            <p>{location.pathname + location.search}</p>
            <input name="a" defaultValue="1" />
            <button type="submit" name="b" value="2">
              Submit
            </button>
          </Form>
        );
      }

      assertLocation(testWindow, "/base/path");
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <form
            action="/base/path"
            method="get"
          >
            <p>
              /path
            </p>
            <input
              name="a"
              value="1"
            />
            <button
              name="b"
              type="submit"
              value="2"
            >
              Submit
            </button>
          </form>
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit"));
      assertLocation(testWindow, "/base/path", "?a=1&b=2");
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <form
            action="/base/path?a=1&b=2"
            method="get"
          >
            <p>
              /path?a=1&b=2
            </p>
            <input
              name="a"
              value="1"
            />
            <button
              name="b"
              type="submit"
              value="2"
            >
              Submit
            </button>
          </form>
        </div>"
      `);
    });

    it('supports a basename on <Form method="post">', async () => {
      let testWindow = getWindow("/base/path");
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="path" action={() => "action data"} element={<Comp />} />
        ),
        {
          basename: "/base",

          window: testWindow,
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Comp() {
        let location = useLocation();
        let data = useActionData() as string | undefined;
        return (
          <Form method="post">
            <p>{location.pathname + location.search}</p>
            {data && <p>{data}</p>}
            <input name="a" defaultValue="1" />
            <button type="submit" name="b" value="2">
              Submit
            </button>
          </Form>
        );
      }

      assertLocation(testWindow, "/base/path");
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <form
            action="/base/path"
            method="post"
          >
            <p>
              /path
            </p>
            <input
              name="a"
              value="1"
            />
            <button
              name="b"
              type="submit"
              value="2"
            >
              Submit
            </button>
          </form>
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => screen.getByText("action data"));
      assertLocation(testWindow, "/base/path");
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <form
            action="/base/path"
            method="post"
          >
            <p>
              /path
            </p>
            <p>
              action data
            </p>
            <input
              name="a"
              value="1"
            />
            <button
              name="b"
              type="submit"
              value="2"
            >
              Submit
            </button>
          </form>
        </div>"
      `);
    });

    it("allows a button to override the <form method>", async () => {
      let loaderDefer = createDeferred();

      let router = createTestRouter(
        createRoutesFromElements(
          <Route
            id="index"
            path="/"
            action={async () => {
              throw new Error("Should not hit this");
            }}
            loader={() => loaderDefer.promise}
            element={<Home />}
          />
        ),
        {
          hydrationData: { loaderData: { index: "Initial Data" } },
          window: getWindow("/"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Home() {
        let data = useLoaderData() as string;
        let navigation = useNavigation();
        return (
          <div>
            <Form method="post">
              <input name="test" value="value" />
              <button type="submit" formMethod="get">
                Submit Form
              </button>
            </Form>
            <div id="output">
              <p>{navigation.state}</p>
              <p>{data}</p>
            </div>
            <Outlet />
          </div>
        );
      }

      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <p>
            Initial Data
          </p>
        </div>"
      `);

      fireEvent.click(screen.getByText("Submit Form"));
      await waitFor(() => screen.getByText("loading"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            loading
          </p>
          <p>
            Initial Data
          </p>
        </div>"
      `);

      loaderDefer.resolve("Loader Data");
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <p>
            Loader Data
          </p>
        </div>"
      `);
    });

    it("allows a button to override the <form action>", async () => {
      let router = createTestRouter(
        createRoutesFromElements(
          <Route path="/">
            <Route
              path="foo"
              action={() => {
                throw new Error("No");
              }}
            >
              <Route
                path="bar"
                action={() => "Yes"}
                Component={() => {
                  let actionData = useActionData() as string | undefined;
                  return (
                    <Form method="post" action="/foo">
                      <p>{actionData || "No"}</p>
                      <button type="submit" formAction="/foo/bar">
                        Submit
                      </button>
                    </Form>
                  );
                }}
              />
            </Route>
          </Route>
        ),
        {
          window: getWindow("/foo/bar"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      expect(container.querySelector("form")?.getAttribute("action")).toBe(
        "/foo"
      );
      expect(
        container.querySelector("button")?.getAttribute("formaction")
      ).toBe("/foo/bar");

      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => screen.getByText("Yes"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <form
              action="/foo"
              method="post"
            >
              <p>
                Yes
              </p>
              <button
                formaction="/foo/bar"
                type="submit"
              >
                Submit
              </button>
            </form>
          </div>"
        `);
    });

    it("supports uppercase form method attributes", async () => {
      let loaderDefer = createDeferred();
      let actionDefer = createDeferred();

      let router = createTestRouter(
        createRoutesFromElements(
          <Route
            id="index"
            path="/"
            action={async ({ request }) => {
              let resolvedValue = await actionDefer.promise;
              let formData = await request.formData();
              return `${resolvedValue}:${formData.get("test")}`;
            }}
            loader={() => loaderDefer.promise}
            element={<Home />}
          />
        ),
        {
          hydrationData: { loaderData: { index: "Initial Data" } },
          window: getWindow("/"),
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Home() {
        let data = useLoaderData() as string;
        let actionData = useActionData() as string | undefined;
        let navigation = useNavigation();
        return (
          <div>
            <Form method="post">
              <input name="test" value="value" />
              <button type="submit">Submit Form</button>
            </Form>
            <div id="output">
              <p>{navigation.state}</p>
              <p>{data}</p>
              <p>{actionData}</p>
            </div>
            <Outlet />
          </div>
        );
      }

      fireEvent.click(screen.getByText("Submit Form"));
      await waitFor(() => screen.getByText("submitting"));
      actionDefer.resolve("Action Data");
      await waitFor(() => screen.getByText("loading"));
      loaderDefer.resolve("Loader Data");
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container.querySelector("#output")!))
        .toMatchInlineSnapshot(`
        "<div
          id="output"
        >
          <p>
            idle
          </p>
          <p>
            Loader Data
          </p>
          <p>
            Action Data:value
          </p>
        </div>"
      `);
    });

    describe("<Form action>", () => {
      function NoActionComponent() {
        return (
          <Form method="post">
            <input name="b" value="2" />
            <button type="submit">Submit Form</button>
          </Form>
        );
      }

      function ActionDotComponent() {
        return (
          <Form method="post" action=".">
            <input name="b" value="2" />
            <button type="submit">Submit Form</button>
          </Form>
        );
      }

      function ActionEmptyComponent() {
        return (
          <Form method="post" action="">
            <input name="b" value="2" />
            <button type="submit">Submit Form</button>
          </Form>
        );
      }

      describe("static routes", () => {
        it("includes search params when no action is specified", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="bar" element={<NoActionComponent />} />
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar?a=1"
          );
        });

        it("does not include search params when action='.'", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="bar" element={<ActionDotComponent />} />
                </Route>
              </Route>
            ),
            { window: getWindow("/foo/bar?a=1#hash") }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar"
          );
        });

        it("does not include search params when action=''", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="bar" element={<ActionEmptyComponent />} />
                </Route>
              </Route>
            ),
            { window: getWindow("/foo/bar?a=1#hash") }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar"
          );
        });
      });

      describe("layout routes", () => {
        it("includes search params when no action is specified", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="bar" element={<NoActionComponent />}>
                    <Route index={true} element={<h1>Index</h1>} />
                  </Route>
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar?a=1"
          );
        });

        it("does not include search params when action='.'", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="bar" element={<ActionDotComponent />}>
                    <Route index={true} element={<h1>Index</h1>} />
                  </Route>
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar"
          );
        });

        it("does not include search params when action=''", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="bar" element={<ActionEmptyComponent />}>
                    <Route index={true} element={<h1>Index</h1>} />
                  </Route>
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar"
          );
        });

        it("does not include dynamic parameters from a parent layout route", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo" element={<ActionEmptyComponent />}>
                  <Route path=":param" element={<h1>Param</h1>} />
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo"
          );
        });

        it("does not include splat parameters from a parent layout route", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo" element={<ActionEmptyComponent />}>
                  <Route path="*" element={<h1>Splat</h1>} />
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar/baz/qux"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo"
          );
        });

        it("does not include the index parameter if we've submitted to a child index route", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="bar" element={<NoActionComponent />}>
                    <Route index={true} element={<h1>Index</h1>} />
                  </Route>
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?index&a=1"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar?a=1"
          );
        });
      });

      describe("index routes", () => {
        it("includes search params when no action is specified", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="bar">
                    <Route index={true} element={<NoActionComponent />} />
                  </Route>
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar?index&a=1"
          );
        });

        it("does not include search params action='.'", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="bar">
                    <Route index={true} element={<ActionDotComponent />} />
                  </Route>
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar?index"
          );
        });

        it("does not include search params action=''", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="bar">
                    <Route index={true} element={<ActionEmptyComponent />} />
                  </Route>
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar?index"
          );
        });

        // eslint-disable-next-line jest/expect-expect
        it("does not repeatedly add ?index params on submissions", async () => {
          let testWindow = getWindow("/form");
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="form">
                  <Route
                    index={true}
                    action={() => ({})}
                    element={
                      <Form method="post">
                        <button type="submit" name="name" value="value">
                          Submit
                        </button>
                      </Form>
                    }
                  />
                </Route>
              </Route>
            ),
            {
              window: testWindow,
            }
          );
          render(<RouterProvider router={router} />);

          assertLocation(testWindow, "/form", "");

          fireEvent.click(screen.getByText("Submit"));
          await new Promise((r) => setTimeout(r, 0));
          assertLocation(testWindow, "/form", "?index");

          fireEvent.click(screen.getByText("Submit"));
          await new Promise((r) => setTimeout(r, 0));
          assertLocation(testWindow, "/form", "?index");
        });

        it("handles index routes with a path", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route
                    index={true}
                    path="bar"
                    element={<NoActionComponent />}
                  />
                </Route>
              </Route>
            ),
            { window: getWindow("/foo/bar?a=1#hash") }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar?index&a=1"
          );
        });

        // eslint-disable-next-line jest/expect-expect
        it('does not put ?index param in final URL for <Form method="get"', async () => {
          let testWindow = getWindow("/form");
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="form">
                  <Route
                    index={true}
                    element={
                      <Form>
                        <button type="submit" name="name" value="value">
                          Submit
                        </button>
                      </Form>
                    }
                  />
                </Route>
              </Route>
            ),
            {
              window: testWindow,
            }
          );
          render(<RouterProvider router={router} />);

          assertLocation(testWindow, "/form", "");

          fireEvent.click(screen.getByText("Submit"));
          await new Promise((r) => setTimeout(r, 0));
          assertLocation(testWindow, "/form", "?name=value");
        });
      });

      describe("dynamic routes", () => {
        it("includes search params when no action is specified", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path=":param" element={<NoActionComponent />} />
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar?a=1"
          );
        });

        it("does not include search params action='.'", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path=":param" element={<ActionDotComponent />} />
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar"
          );
        });

        it("does not include search params when action=''", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path=":param" element={<ActionEmptyComponent />} />
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo/bar"
          );
        });
      });

      describe("splat routes", () => {
        it("includes search params when no action is specified", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="*" element={<NoActionComponent />} />
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo?a=1"
          );
        });

        it("does not include search params when action='.'", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="*" element={<ActionDotComponent />} />
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo"
          );
        });

        it("does not include search params when action=''", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/">
                <Route path="foo">
                  <Route path="*" element={<ActionEmptyComponent />} />
                </Route>
              </Route>
            ),
            {
              window: getWindow("/foo/bar?a=1#hash"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("form")?.getAttribute("action")).toBe(
            "/foo"
          );
        });
      });

      it("allows user to specify search params and hash", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/">
              <Route path="foo">
                <Route path="bar" element={<Form action=".?a=1#newhash" />} />
              </Route>
            </Route>
          ),
          { window: getWindow("/foo/bar?a=1#hash") }
        );
        let { container } = render(<RouterProvider router={router} />);

        expect(container.querySelector("form")?.getAttribute("action")).toBe(
          "/foo/bar?a=1#newhash"
        );
      });
    });

    describe('<Form action relative="path">', () => {
      it("navigates relative to the URL for static routes", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="inbox">
              <Route path="messages" />
              <Route
                path="messages/edit"
                element={<Form action=".." relative="path" />}
              />
            </Route>
          ),
          {
            window: getWindow("/inbox/messages/edit"),
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        expect(container.querySelector("form")?.getAttribute("action")).toBe(
          "/inbox/messages"
        );
      });

      it("navigates relative to the URL for dynamic routes", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="inbox">
              <Route path="messages" />
              <Route
                path="messages/:id"
                element={<Form action=".." relative="path" />}
              />
            </Route>
          ),
          {
            window: getWindow("/inbox/messages/1"),
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        expect(container.querySelector("form")?.getAttribute("action")).toBe(
          "/inbox/messages"
        );
      });

      it("navigates relative to the URL for layout routes", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="inbox">
              <Route path="messages" />
              <Route
                path="messages/:id"
                element={
                  <>
                    <Form action=".." relative="path" />
                    <Outlet />
                  </>
                }
              >
                <Route index element={<h1>Form</h1>} />
              </Route>
            </Route>
          ),
          {
            window: getWindow("/inbox/messages/1"),
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        expect(container.querySelector("form")?.getAttribute("action")).toBe(
          "/inbox/messages"
        );
      });

      it("navigates relative to the URL for index routes", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="inbox">
              <Route path="messages" />
              <Route path="messages/:id">
                <Route index element={<Form action=".." relative="path" />} />
              </Route>
            </Route>
          ),
          {
            window: getWindow("/inbox/messages/1"),
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        expect(container.querySelector("form")?.getAttribute("action")).toBe(
          "/inbox/messages"
        );
      });

      it("navigates relative to the URL for splat routes", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route
              path="inbox/messages/*"
              element={<Form action=".." relative="path" />}
            />
          ),
          {
            window: getWindow("/inbox/messages/1/2/3"),
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        expect(container.querySelector("form")?.getAttribute("action")).toBe(
          "/inbox"
        );
      });
    });

    describe("useSubmit/Form FormData", () => {
      it("gathers form data on <Form> submissions", async () => {
        let actionSpy = jest.fn();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          return (
            <Form method="post">
              <input name="a" defaultValue="1" />
              <input name="b" defaultValue="2" />
              <button type="submit">Submit</button>
            </Form>
          );
        }

        fireEvent.click(screen.getByText("Submit"));
        let formData = await actionSpy.mock.calls[0][0].request.formData();
        expect(formData.get("a")).toBe("1");
        expect(formData.get("b")).toBe("2");
      });

      it("gathers form data on submit(form) submissions", async () => {
        let actionSpy = jest.fn();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          let submit = useSubmit();
          let formRef = React.useRef(null);
          return (
            <>
              <Form method="post" ref={formRef}>
                <input name="a" defaultValue="1" />
                <input name="b" defaultValue="2" />
              </Form>
              <button onClick={() => submit(formRef.current)}>Submit</button>
            </>
          );
        }

        fireEvent.click(screen.getByText("Submit"));
        let formData = await actionSpy.mock.calls[0][0].request.formData();
        expect(formData.get("a")).toBe("1");
        expect(formData.get("b")).toBe("2");
      });

      it("gathers form data on submit(button) submissions", async () => {
        let actionSpy = jest.fn();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          let submit = useSubmit();
          return (
            <>
              <Form method="post">
                <input name="a" defaultValue="1" />
                <input name="b" defaultValue="2" />
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    submit(e.currentTarget);
                  }}
                >
                  Submit
                </button>
              </Form>
            </>
          );
        }

        fireEvent.click(screen.getByText("Submit"));
        let formData = await actionSpy.mock.calls[0][0].request.formData();
        expect(formData.get("a")).toBe("1");
        expect(formData.get("b")).toBe("2");
      });

      it("gathers form data on submit(input[type=submit]) submissions", async () => {
        let actionSpy = jest.fn();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          let submit = useSubmit();
          return (
            <>
              <Form method="post">
                <input name="a" defaultValue="1" />
                <input name="b" defaultValue="2" />
                <input
                  type="submit"
                  value="Submit"
                  onClick={(e) => {
                    e.preventDefault();
                    submit(e.currentTarget);
                  }}
                />
              </Form>
            </>
          );
        }

        fireEvent.click(screen.getByText("Submit"));
        let formData = await actionSpy.mock.calls[0][0].request.formData();
        expect(formData.get("a")).toBe("1");
        expect(formData.get("b")).toBe("2");
      });

      it("gathers form data on submit(FormData) submissions", async () => {
        let actionSpy = jest.fn();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          let submit = useSubmit();
          let formData = new FormData();
          formData.set("a", "1");
          formData.set("b", "2");
          return (
            <button onClick={() => submit(formData, { method: "post" })}>
              Submit
            </button>
          );
        }

        fireEvent.click(screen.getByText("Submit"));
        let formData = await actionSpy.mock.calls[0][0].request.formData();
        expect(formData.get("a")).toBe("1");
        expect(formData.get("b")).toBe("2");
      });

      it("serializes formData on submit(object) submissions", async () => {
        let actionSpy = jest.fn();
        let body = { a: "1", b: "2" };
        let navigation;
        let router = createTestRouter(
          [
            {
              path: "/",
              action: actionSpy,
              Component() {
                let submit = useSubmit();
                let n = useNavigation();
                if (n.state === "submitting") {
                  navigation = n;
                }
                return (
                  <button onClick={() => submit(body, { method: "post" })}>
                    Submit
                  </button>
                );
              },
            },
          ],
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        fireEvent.click(screen.getByText("Submit"));
        expect(navigation.formData?.get("a")).toBe("1");
        expect(navigation.formData?.get("b")).toBe("2");
        expect(navigation.text).toBeUndefined();
        expect(navigation.json).toBeUndefined();
        let { request } = actionSpy.mock.calls[0][0];
        expect(request.headers.get("Content-Type")).toMatchInlineSnapshot(
          `"application/x-www-form-urlencoded;charset=UTF-8"`
        );
        let actionFormData = await request.formData();
        expect(actionFormData.get("a")).toBe("1");
        expect(actionFormData.get("b")).toBe("2");
      });

      it("serializes formData on submit(object)/encType:application/x-www-form-urlencoded submissions", async () => {
        let actionSpy = jest.fn();
        let body = { a: "1", b: "2" };
        let navigation;
        let router = createTestRouter(
          [
            {
              path: "/",
              action: actionSpy,
              Component() {
                let submit = useSubmit();
                let n = useNavigation();
                if (n.state === "submitting") {
                  navigation = n;
                }
                return (
                  <button
                    onClick={() =>
                      submit(body, {
                        method: "post",
                        encType: "application/x-www-form-urlencoded",
                      })
                    }
                  >
                    Submit
                  </button>
                );
              },
            },
          ],
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        fireEvent.click(screen.getByText("Submit"));
        expect(navigation.formData?.get("a")).toBe("1");
        expect(navigation.formData?.get("b")).toBe("2");
        expect(navigation.text).toBeUndefined();
        expect(navigation.json).toBeUndefined();
        let { request } = actionSpy.mock.calls[0][0];
        expect(request.headers.get("Content-Type")).toMatchInlineSnapshot(
          `"application/x-www-form-urlencoded;charset=UTF-8"`
        );
        let actionFormData = await request.formData();
        expect(actionFormData.get("a")).toBe("1");
        expect(actionFormData.get("b")).toBe("2");
      });

      it("serializes JSON on submit(object)/encType:application/json submissions", async () => {
        let actionSpy = jest.fn();
        let body = { a: "1", b: "2" };
        let navigation;
        let router = createTestRouter(
          [
            {
              path: "/",
              action: actionSpy,
              Component() {
                let submit = useSubmit();
                let n = useNavigation();
                if (n.state === "submitting") {
                  navigation = n;
                }
                return (
                  <button
                    onClick={() =>
                      submit(body, {
                        method: "post",
                        encType: "application/json",
                      })
                    }
                  >
                    Submit
                  </button>
                );
              },
            },
          ],
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        fireEvent.click(screen.getByText("Submit"));
        expect(navigation.json).toBe(body);
        expect(navigation.text).toBeUndefined();
        expect(navigation.formData).toBeUndefined();
        let { request } = actionSpy.mock.calls[0][0];
        expect(request.headers.get("Content-Type")).toBe("application/json");
        expect(await request.json()).toEqual({ a: "1", b: "2" });
      });

      it("serializes text on submit(object)/encType:text/plain submissions", async () => {
        let actionSpy = jest.fn();
        let body = "look ma, no formData!";
        let navigation;
        let router = createTestRouter(
          [
            {
              path: "/",
              action: actionSpy,
              Component() {
                let submit = useSubmit();
                let n = useNavigation();
                if (n.state === "submitting") {
                  navigation = n;
                }
                return (
                  <button
                    onClick={() =>
                      submit(body, {
                        method: "post",
                        encType: "text/plain",
                      })
                    }
                  >
                    Submit
                  </button>
                );
              },
            },
          ],
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        fireEvent.click(screen.getByText("Submit"));
        expect(navigation.text).toBe(body);
        expect(navigation.formData).toBeUndefined();
        expect(navigation.json).toBeUndefined();
        let { request } = actionSpy.mock.calls[0][0];
        expect(request.headers.get("Content-Type")).toBe(
          "text/plain;charset=UTF-8"
        );
        expect(await request.text()).toEqual(body);
      });

      it('serializes into text on <Form encType="text/plain" submissions', async () => {
        let actionSpy = jest.fn();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          return (
            <Form method="post" encType="text/plain">
              <input name="a" defaultValue="1" />
              <input name="b" defaultValue="2" />
              <button type="submit">Submit</button>
            </Form>
          );
        }

        fireEvent.click(screen.getByText("Submit"));
        expect(await actionSpy.mock.calls[0][0].request.text())
          .toMatchInlineSnapshot(`
          "a=1
          b=2
          "
        `);
      });

      it("includes submit button name/value on form submission", async () => {
        let actionSpy = jest.fn();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          return (
            <Form method="post">
              <input name="a" defaultValue="1" />
              <input name="b" defaultValue="2" />
              <button name="c" value="3" type="submit">
                Submit
              </button>
            </Form>
          );
        }

        fireEvent.click(screen.getByText("Submit"));
        let formData = await actionSpy.mock.calls[0][0].request.formData();
        expect(formData.get("a")).toBe("1");
        expect(formData.get("b")).toBe("2");
        expect(formData.get("c")).toBe("3");
      });

      it("includes submit button name/value on button submission", async () => {
        let actionSpy = jest.fn();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          let submit = useSubmit();
          return (
            <Form method="post">
              <input name="a" defaultValue="1" />
              <input name="b" defaultValue="2" />
              <button
                name="c"
                value="3"
                onClick={(e) => {
                  e.preventDefault();
                  submit(e.currentTarget);
                }}
              >
                Submit
              </button>
            </Form>
          );
        }

        fireEvent.click(screen.getByText("Submit"));
        let formData = await actionSpy.mock.calls[0][0].request.formData();
        expect(formData.get("a")).toBe("1");
        expect(formData.get("b")).toBe("2");
        expect(formData.get("c")).toBe("3");
      });

      it("appends button name/value and doesn't overwrite inputs with same name (form)", async () => {
        let actionSpy = jest.fn();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          return (
            <Form method="post">
              <input name="a" defaultValue="1" />
              <input name="b" defaultValue="2" />
              <button name="b" value="3" type="submit">
                Submit
              </button>
            </Form>
          );
        }

        fireEvent.click(screen.getByText("Submit"));
        let formData = await actionSpy.mock.calls[0][0].request.formData();
        expect(formData.get("a")).toBe("1");
        expect(formData.getAll("b")).toEqual(["2", "3"]);
      });

      it("appends button name/value and doesn't overwrite inputs with same name (button)", async () => {
        let actionSpy = jest.fn();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          let submit = useSubmit();
          return (
            <Form method="post">
              <input name="a" defaultValue="1" />
              <input name="b" defaultValue="2" />
              <button
                name="b"
                value="3"
                onClick={(e) => {
                  e.preventDefault();
                  submit(e.currentTarget);
                }}
              >
                Submit
              </button>
            </Form>
          );
        }

        fireEvent.click(screen.getByText("Submit"));
        let formData = await actionSpy.mock.calls[0][0].request.formData();
        expect(formData.get("a")).toBe("1");
        expect(formData.getAll("b")).toEqual(["2", "3"]);
      });

      it("includes the correct submitter value(s) in tree order", async () => {
        let actionSpy = jest.fn();
        actionSpy.mockReturnValue({});
        async function getPayload() {
          let formData = await actionSpy.mock.calls[
            actionSpy.mock.calls.length - 1
          ][0].request.formData();
          return new URLSearchParams(formData.entries()).toString();
        }

        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          return (
            <>
              <button name="tasks" value="outside" form="myform">
                Outside
              </button>
              <Form id="myform" method="post">
                <input type="text" name="tasks" defaultValue="first" />
                <input type="text" name="tasks" defaultValue="second" />

                <button name="tasks" value="">
                  Add Task
                </button>
                <button value="">No Name</button>
                <input type="image" name="tasks" alt="Add Task" />
                <input type="image" alt="No Name" />

                <input type="text" name="tasks" defaultValue="last" />
              </Form>
            </>
          );
        }

        fireEvent.click(screen.getByText("Add Task"));
        expect(await getPayload()).toEqual(
          "tasks=first&tasks=second&tasks=&tasks=last"
        );

        fireEvent.click(screen.getByText("No Name"));
        expect(await getPayload()).toEqual(
          "tasks=first&tasks=second&tasks=last"
        );

        fireEvent.click(screen.getByAltText("Add Task"), {
          clientX: 1,
          clientY: 2,
        });
        expect(await getPayload()).toMatch(
          "tasks=first&tasks=second&tasks.x=1&tasks.y=2&tasks=last"
        );

        fireEvent.click(screen.getByAltText("No Name"), {
          clientX: 1,
          clientY: 2,
        });
        expect(await getPayload()).toMatch(
          "tasks=first&tasks=second&x=1&y=2&tasks=last"
        );

        fireEvent.click(screen.getByText("Outside"));
        expect(await getPayload()).toEqual(
          "tasks=outside&tasks=first&tasks=second&tasks=last"
        );
      });
    });

    describe("useFetcher(s)", () => {
      it("handles fetcher.load and fetcher.submit", async () => {
        let count = 0;
        let router = createTestRouter(
          createRoutesFromElements(
            <Route
              path="/"
              element={<Comp />}
              action={async ({ request }) => {
                let formData = await request.formData();
                count = count + parseInt(String(formData.get("increment")), 10);
                return { count };
              }}
              loader={async ({ request }) => {
                // Need to add a domain on here in node unit testing so it's a
                // valid URL. When running in the browser the domain is
                // automatically added in new Request()
                let increment =
                  new URL(`https://remix.test${request.url}`).searchParams.get(
                    "increment"
                  ) || "1";
                count = count + parseInt(increment, 10);
                return { count };
              }}
            />
          ),
          {
            window: getWindow("/"),
            hydrationData: { loaderData: { "0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          let fd = new FormData();
          fd.append("increment", "10");
          return (
            <>
              <p id="output">
                {fetcher.state}
                {fetcher.data ? JSON.stringify(fetcher.data) : null}
              </p>
              <button onClick={() => fetcher.load("/")}>load 1</button>
              <button onClick={() => fetcher.load("/?increment=5")}>
                load 5
              </button>
              <button onClick={() => fetcher.submit(fd, { method: "post" })}>
                submit 10
              </button>
            </>
          );
        }

        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
          </p>"
        `);

        fireEvent.click(screen.getByText("load 1"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            loading
          </p>"
        `);

        await waitFor(() => screen.getByText(/idle/));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
            {"count":1}
          </p>"
        `);

        fireEvent.click(screen.getByText("load 5"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            loading
            {"count":1}
          </p>"
        `);

        await waitFor(() => screen.getByText(/idle/));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
            {"count":6}
          </p>"
        `);

        fireEvent.click(screen.getByText("submit 10"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            submitting
            {"count":6}
          </p>"
        `);

        await waitFor(() => screen.getByText(/idle/));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
            {"count":16}
          </p>"
        `);
      });

      it("handles fetcher ?index params", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route
              id="parent"
              path="/parent"
              element={<Outlet />}
              action={() => "PARENT ACTION"}
              loader={() => "PARENT LOADER"}
            >
              <Route
                id="index"
                index
                element={<Index />}
                action={() => "INDEX ACTION"}
                loader={() => "INDEX LOADER"}
              />
            </Route>
          ),
          {
            window: getWindow("/parent"),
            hydrationData: { loaderData: { parent: null, index: null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Index() {
          let fetcher = useFetcher();

          return (
            <>
              <p id="output">{fetcher.data}</p>
              <button onClick={() => fetcher.load("/parent")}>
                Load parent
              </button>
              <button onClick={() => fetcher.load("/parent?index")}>
                Load index
              </button>
              <button onClick={() => fetcher.submit({})}>Submit empty</button>
              <button
                onClick={() =>
                  fetcher.submit({}, { method: "get", action: "/parent" })
                }
              >
                Submit parent get
              </button>
              <button
                onClick={() =>
                  fetcher.submit({}, { method: "get", action: "/parent?index" })
                }
              >
                Submit index get
              </button>
              <button
                onClick={() =>
                  fetcher.submit({}, { method: "post", action: "/parent" })
                }
              >
                Submit parent post
              </button>
              <button
                onClick={() =>
                  fetcher.submit(
                    {},
                    { method: "post", action: "/parent?index" }
                  )
                }
              >
                Submit index post
              </button>
            </>
          );
        }

        async function clickAndAssert(btnText: string, expectedOutput: string) {
          fireEvent.click(screen.getByText(btnText));
          await new Promise((r) => setTimeout(r, 1));
          await waitFor(() => screen.getByText(new RegExp(expectedOutput)));
          expect(getHtml(container.querySelector("#output")!)).toContain(
            expectedOutput
          );
        }

        await clickAndAssert("Load parent", "PARENT LOADER");
        await clickAndAssert("Load index", "INDEX LOADER");
        await clickAndAssert("Submit empty", "INDEX LOADER");
        await clickAndAssert("Submit parent get", "PARENT LOADER");
        await clickAndAssert("Submit index get", "INDEX LOADER");
        await clickAndAssert("Submit parent post", "PARENT ACTION");
        await clickAndAssert("Submit index post", "INDEX ACTION");
      });

      it("handles fetcher.load errors", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route
              path="/"
              element={<Comp />}
              errorElement={<ErrorElement />}
              loader={async () => {
                throw new Error("Kaboom!");
              }}
            />
          ),
          {
            window: getWindow("/"),
            hydrationData: { loaderData: { "0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          return (
            <>
              <p>
                {fetcher.state}
                {fetcher.data ? JSON.stringify(fetcher.data) : null}
              </p>
              <button onClick={() => fetcher.load("/")}>load</button>
            </>
          );
        }

        function ErrorElement() {
          let error = useRouteError() as Error;
          return <p>{error.message}</p>;
        }

        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              idle
            </p>
            <button>
              load
            </button>
          </div>"
        `);

        fireEvent.click(screen.getByText("load"));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              loading
            </p>
            <button>
              load
            </button>
          </div>"
        `);

        await waitFor(() => screen.getByText("Kaboom!"));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              Kaboom!
            </p>
          </div>"
        `);
      });

      it("handles fetcher.load errors (defer)", async () => {
        let dfd = createDeferred();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route
              path="/"
              element={<Comp />}
              errorElement={<ErrorElement />}
              loader={() => defer({ value: dfd.promise })}
            />
          ),
          {
            window: getWindow("/"),
            hydrationData: { loaderData: { "0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          return (
            <>
              <p>
                {fetcher.state}
                {fetcher.data ? JSON.stringify(fetcher.data.value) : null}
              </p>
              <button onClick={() => fetcher.load("/")}>load</button>
            </>
          );
        }

        function ErrorElement() {
          let error = useRouteError() as Error;
          return <p>{error.message}</p>;
        }

        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              idle
            </p>
            <button>
              load
            </button>
          </div>"
        `);

        fireEvent.click(screen.getByText("load"));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              loading
            </p>
            <button>
              load
            </button>
          </div>"
        `);

        dfd.reject(new Error("Kaboom!"));
        await waitFor(() => screen.getByText("Kaboom!"));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              Kaboom!
            </p>
          </div>"
        `);
      });

      it("handles fetcher.submit errors", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route
              path="/"
              element={<Comp />}
              errorElement={<ErrorElement />}
              action={async () => {
                throw new Error("Kaboom!");
              }}
            />
          ),
          {
            window: getWindow("/"),
            hydrationData: { loaderData: { "0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          return (
            <>
              <p>
                {fetcher.state}
                {fetcher.data ? JSON.stringify(fetcher.data) : null}
              </p>
              <button
                onClick={() =>
                  fetcher.submit(new FormData(), { method: "post" })
                }
              >
                submit
              </button>
            </>
          );
        }

        function ErrorElement() {
          let error = useRouteError() as Error;
          return <p>{error.message}</p>;
        }

        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              idle
            </p>
            <button>
              submit
            </button>
          </div>"
        `);

        fireEvent.click(screen.getByText("submit"));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              submitting
            </p>
            <button>
              submit
            </button>
          </div>"
        `);

        await waitFor(() => screen.getByText("Kaboom!"));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              Kaboom!
            </p>
          </div>"
        `);
      });

      it("handles fetcher.Form", async () => {
        let count = 0;
        let router = createTestRouter(
          createRoutesFromElements(
            <Route
              path="/"
              element={<Comp />}
              action={async ({ request }) => {
                let formData = await request.formData();
                count = count + parseInt(String(formData.get("increment")), 10);
                return { count };
              }}
              loader={async ({ request }) => {
                // Need to add a domain on here in node unit testing so it's a
                // valid URL. When running in the browser the domain is
                // automatically added in new Request()
                let increment =
                  new URL(`https://remix.test${request.url}`).searchParams.get(
                    "increment"
                  ) || "1";
                count = count + parseInt(increment, 10);
                return { count };
              }}
            />
          ),
          {
            window: getWindow("/"),
            hydrationData: { loaderData: { "0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          return (
            <>
              <p id="output">
                {fetcher.state}
                {fetcher.data ? JSON.stringify(fetcher.data) : null}
              </p>
              <fetcher.Form>
                <input name="increment" value="1" />
                <button type="submit">submit get 1</button>
              </fetcher.Form>
              <fetcher.Form method="post">
                <input name="increment" value="10" />
                <button type="submit">submit post 10</button>
              </fetcher.Form>
            </>
          );
        }

        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
          </p>"
        `);

        fireEvent.click(screen.getByText("submit get 1"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            loading
          </p>"
        `);

        await waitFor(() => screen.getByText(/idle/));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
            {"count":1}
          </p>"
        `);

        fireEvent.click(screen.getByText("submit post 10"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            submitting
            {"count":1}
          </p>"
        `);

        await waitFor(() => screen.getByText(/idle/));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
            {"count":11}
          </p>"
        `);
      });

      it("handles fetcher.Form get errors", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route
              path="/"
              element={<Comp />}
              errorElement={<ErrorElement />}
              loader={async () => {
                throw new Error("Kaboom!");
              }}
            />
          ),
          {
            window: getWindow("/"),
            hydrationData: { loaderData: { "0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          return (
            <>
              <p id="output">
                {fetcher.state}
                {fetcher.data ? JSON.stringify(fetcher.data) : null}
              </p>
              <fetcher.Form>
                <button type="submit">submit</button>
              </fetcher.Form>
            </>
          );
        }

        function ErrorElement() {
          let error = useRouteError() as Error;
          return <p>{error.message}</p>;
        }

        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
          </p>"
        `);

        fireEvent.click(screen.getByText("submit"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            loading
          </p>"
        `);

        await waitFor(() => screen.getByText("Kaboom!"));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              Kaboom!
            </p>
          </div>"
        `);
      });

      it("handles fetcher.Form post errors", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route
              path="/"
              element={<Comp />}
              errorElement={<ErrorElement />}
              action={async () => {
                throw new Error("Kaboom!");
              }}
            />
          ),
          {
            window: getWindow("/"),
            hydrationData: { loaderData: { "0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          return (
            <>
              <p id="output">
                {fetcher.state}
                {fetcher.data ? JSON.stringify(fetcher.data) : null}
              </p>
              <fetcher.Form method="post">
                <button type="submit">submit</button>
              </fetcher.Form>
            </>
          );
        }

        function ErrorElement() {
          let error = useRouteError() as Error;
          return <p>{error.message}</p>;
        }

        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
          </p>"
        `);

        fireEvent.click(screen.getByText("submit"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            submitting
          </p>"
        `);

        await waitFor(() => screen.getByText("Kaboom!"));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              Kaboom!
            </p>
          </div>"
        `);
      });

      it("serializes fetcher.submit(object) as FormData", async () => {
        let actionSpy = jest.fn();
        let body = { key: "value" };
        let fetcher: Fetcher;
        let router = createTestRouter(
          [
            {
              path: "/",
              action: actionSpy,
              Component() {
                let f = useFetcher();
                fetcher = f;
                return (
                  <button onClick={() => f.submit(body, { method: "post" })}>
                    Submit
                  </button>
                );
              },
            },
          ],
          {
            window: getWindow("/"),
          }
        );

        render(<RouterProvider router={router} />);
        fireEvent.click(screen.getByText("Submit"));
        // @ts-expect-error
        expect(fetcher.formData?.get("key")).toBe("value");
        // @ts-expect-error
        expect(fetcher.text).toBeUndefined();
        // @ts-expect-error
        expect(fetcher.json).toBeUndefined();
        let formData = await actionSpy.mock.calls[0][0].request.formData();
        expect(formData.get("key")).toBe("value");
      });

      it("serializes fetcher.submit(object, { encType:application/x-www-form-urlencoded }) as FormData", async () => {
        let actionSpy = jest.fn();
        let body = { key: "value" };
        let fetcher: Fetcher;
        let router = createTestRouter(
          [
            {
              path: "/",
              action: actionSpy,
              Component() {
                let f = useFetcher();
                fetcher = f;
                return (
                  <button
                    onClick={() =>
                      f.submit(body, {
                        method: "post",
                        encType: "application/x-www-form-urlencoded",
                      })
                    }
                  >
                    Submit
                  </button>
                );
              },
            },
          ],
          {
            window: getWindow("/"),
          }
        );

        render(<RouterProvider router={router} />);
        fireEvent.click(screen.getByText("Submit"));
        // @ts-expect-error
        expect(fetcher.formData?.get("key")).toBe("value");
        // @ts-expect-error
        expect(fetcher.text).toBeUndefined();
        // @ts-expect-error
        expect(fetcher.json).toBeUndefined();
        let formData = await actionSpy.mock.calls[0][0].request.formData();
        expect(formData.get("key")).toBe("value");
      });

      it("serializes fetcher.submit(object, { encType:application/json }) as FormData", async () => {
        let actionSpy = jest.fn();
        let body = { key: "value" };
        let fetcher: Fetcher;
        let router = createTestRouter(
          [
            {
              path: "/",
              action: actionSpy,
              Component() {
                let f = useFetcher();
                fetcher = f;
                return (
                  <button
                    onClick={() =>
                      f.submit(body, {
                        method: "post",
                        encType: "application/json",
                      })
                    }
                  >
                    Submit
                  </button>
                );
              },
            },
          ],
          {
            window: getWindow("/"),
          }
        );

        render(<RouterProvider router={router} />);
        fireEvent.click(screen.getByText("Submit"));
        // @ts-expect-error
        expect(fetcher.json).toBe(body);
        // @ts-expect-error
        expect(fetcher.text).toBeUndefined();
        // @ts-expect-error
        expect(fetcher.formData).toBeUndefined();
        let json = await actionSpy.mock.calls[0][0].request.json();
        expect(json).toEqual(body);
      });

      it("serializes fetcher.submit(object, { encType:text/plain }) as text", async () => {
        let actionSpy = jest.fn();
        let body = "Look ma, no FormData!";
        let fetcher: Fetcher;
        let router = createTestRouter(
          [
            {
              path: "/",
              action: actionSpy,
              Component() {
                let f = useFetcher();
                fetcher = f;
                return (
                  <button
                    onClick={() =>
                      f.submit(body, {
                        method: "post",
                        encType: "text/plain",
                      })
                    }
                  >
                    Submit
                  </button>
                );
              },
            },
          ],
          {
            window: getWindow("/"),
          }
        );

        render(<RouterProvider router={router} />);
        fireEvent.click(screen.getByText("Submit"));
        // @ts-expect-error
        expect(fetcher.text).toBe(body);
        // @ts-expect-error
        expect(fetcher.formData).toBeUndefined();
        // @ts-expect-error
        expect(fetcher.json).toBeUndefined();
        let text = await actionSpy.mock.calls[0][0].request.text();
        expect(text).toEqual(body);
      });

      it("show all fetchers via useFetchers and cleans up fetchers on unmount", async () => {
        let navDfd = createDeferred();
        let fetchDfd1 = createDeferred();
        let fetchDfd2 = createDeferred();
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" element={<Parent />}>
              <Route path="/1" element={<Comp1 />} />
              <Route
                path="/2"
                loader={() => navDfd.promise}
                element={<Comp2 />}
              />
              <Route path="/fetch-1" loader={() => fetchDfd1.promise} />
              <Route path="/fetch-2" loader={() => fetchDfd2.promise} />
            </Route>
          ),
          {
            window: getWindow("/1"),
            hydrationData: { loaderData: { "0": null, "0-0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Parent() {
          let fetchers = useFetchers();
          return (
            <>
              <Link to="/1">Link to 1</Link>
              <Link to="/2">Link to 2</Link>
              <div id="output">
                <p>{JSON.stringify(fetchers.map((f) => f.state))}</p>
                <Outlet />
              </div>
            </>
          );
        }

        function Comp1() {
          let fetcher = useFetcher();
          return (
            <>
              <p>
                1{fetcher.state}
                {fetcher.data || "null"}
              </p>
              <button onClick={() => fetcher.load("/fetch-1")}>load</button>
            </>
          );
        }

        function Comp2() {
          let fetcher = useFetcher();
          return (
            <>
              <p>
                2{fetcher.state}
                {fetcher.data || "null"}
              </p>
              <button onClick={() => fetcher.load("/fetch-2")}>load</button>
            </>
          );
        }

        // Initial state - no useFetchers reflected yet
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              []
            </p>
            <p>
              1
              idle
              null
            </p>
            <button>
              load
            </button>
          </div>"
        `);

        // Activate Comp1 fetcher
        fireEvent.click(screen.getByText("load"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              ["loading"]
            </p>
            <p>
              1
              loading
              null
            </p>
            <button>
              load
            </button>
          </div>"
        `);

        // Resolve Comp1 fetcher - UI updates
        fetchDfd1.resolve("data 1");
        await waitFor(() => screen.getByText(/data 1/));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              ["idle"]
            </p>
            <p>
              1
              idle
              data 1
            </p>
            <button>
              load
            </button>
          </div>"
        `);

        // Link to Comp2 - loaders run
        fireEvent.click(screen.getByText("Link to 2"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              ["idle"]
            </p>
            <p>
              1
              idle
              data 1
            </p>
            <button>
              load
            </button>
          </div>"
        `);

        // Resolve Comp2 loader and complete navigation
        navDfd.resolve("nav data");
        await waitFor(() => screen.getByText(/2.*idle/));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              []
            </p>
            <p>
              2
              idle
              null
            </p>
            <button>
              load
            </button>
          </div>"
        `);

        // Activate Comp2 fetcher
        fireEvent.click(screen.getByText("load"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              ["loading"]
            </p>
            <p>
              2
              loading
              null
            </p>
            <button>
              load
            </button>
          </div>"
        `);

        // Comp2 loader resolves with the same data, useFetchers reflects idle-done
        fetchDfd2.resolve("data 2");
        await waitFor(() => screen.getByText(/data 2/));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              ["idle"]
            </p>
            <p>
              2
              idle
              data 2
            </p>
            <button>
              load
            </button>
          </div>"
        `);
      });

      it("handles revalidating fetchers", async () => {
        let count = 0;
        let fetchCount = 0;
        let router = createTestRouter(
          createRoutesFromElements(
            <>
              <Route
                id="index"
                path="/"
                element={<Comp />}
                action={async ({ request }) => {
                  let formData = await request.formData();
                  count =
                    count + parseInt(String(formData.get("increment")), 10);
                  return { count };
                }}
                loader={async () => ({ count: ++count })}
              />
              <Route
                path="/fetch"
                loader={async () => ({ fetchCount: ++fetchCount })}
              />
            </>
          ),
          {
            window: getWindow("/"),
            hydrationData: { loaderData: { index: null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          return (
            <>
              <p id="output">
                {fetcher.state}
                {fetcher.data ? JSON.stringify(fetcher.data) : null}
              </p>
              <button onClick={() => fetcher.load("/fetch")}>
                load fetcher
              </button>
              <Form method="post">
                <button type="submit" name="increment" value="10">
                  submit
                </button>
              </Form>
            </>
          );
        }

        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
          </p>"
        `);

        await act(async () => {
          fireEvent.click(screen.getByText("load fetcher"));
          await waitFor(() => screen.getByText(/idle/));
        });
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
            {"fetchCount":1}
          </p>"
        `);

        await act(async () => {
          fireEvent.click(screen.getByText("submit"));
          await waitFor(() => screen.getByText(/idle/));
        });
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<p
            id="output"
          >
            idle
            {"fetchCount":2}
          </p>"
        `);
      });

      it("handles fetcher 404 errors at the correct spot in the route hierarchy", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" element={<Outlet />} errorElement={<p>Not I!</p>}>
              <Route
                path="child"
                element={<Comp />}
                errorElement={<ErrorElement />}
              />
            </Route>
          ),
          {
            window: getWindow("/child"),
            hydrationData: { loaderData: { "0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          return (
            <button onClick={() => fetcher.load("/not-found")}>load</button>
          );
        }

        function ErrorElement() {
          let { status, statusText } = useRouteError() as ErrorResponse;
          return <p>contextual error:{`${status} ${statusText}`}</p>;
        }

        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <button>
              load
            </button>
          </div>"
        `);

        fireEvent.click(screen.getByText("load"));
        await waitFor(() => screen.getByText(/Not Found/));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              contextual error:
              404 Not Found
            </p>
          </div>"
        `);
      });

      it("handles fetcher.load errors at the correct spot in the route hierarchy", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" element={<Outlet />} errorElement={<p>Not I!</p>}>
              <Route
                path="child"
                element={<Comp />}
                errorElement={<ErrorElement />}
              />
              <Route
                path="fetch"
                loader={() => {
                  throw new Error("Kaboom!");
                }}
                errorElement={<p>Not I!</p>}
              />
            </Route>
          ),
          {
            window: getWindow("/child"),
            hydrationData: { loaderData: { "0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          return <button onClick={() => fetcher.load("/fetch")}>load</button>;
        }

        function ErrorElement() {
          let error = useRouteError() as Error;
          return <p>contextual error:{error.message}</p>;
        }

        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <button>
              load
            </button>
          </div>"
        `);

        fireEvent.click(screen.getByText("load"));
        await waitFor(() => screen.getByText(/Kaboom!/));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              contextual error:
              Kaboom!
            </p>
          </div>"
        `);
      });

      it("handles fetcher.submit errors at the correct spot in the route hierarchy", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" element={<Outlet />} errorElement={<p>Not I!</p>}>
              <Route
                path="child"
                element={<Comp />}
                errorElement={<ErrorElement />}
              />
              <Route
                path="fetch"
                action={() => {
                  throw new Error("Kaboom!");
                }}
                errorElement={<p>Not I!</p>}
              />
            </Route>
          ),
          {
            window: getWindow("/child"),
            hydrationData: { loaderData: { "0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          return (
            <button
              onClick={() =>
                fetcher.submit(
                  { key: "value" },
                  { method: "post", action: "/fetch" }
                )
              }
            >
              submit
            </button>
          );
        }

        function ErrorElement() {
          let error = useRouteError() as Error;
          return <p>contextual error:{error.message}</p>;
        }

        expect(getHtml(container)).toMatchInlineSnapshot(`
            "<div>
              <button>
                submit
              </button>
            </div>"
          `);

        fireEvent.click(screen.getByText("submit"));
        await waitFor(() => screen.getByText(/Kaboom!/));
        expect(getHtml(container)).toMatchInlineSnapshot(`
            "<div>
              <p>
                contextual error:
                Kaboom!
              </p>
            </div>"
          `);
      });

      it("handles fetcher.Form errors at the correct spot in the route hierarchy", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" element={<Outlet />} errorElement={<p>Not I!</p>}>
              <Route
                path="child"
                element={<Comp />}
                errorElement={<ErrorElement />}
              />
              <Route
                path="fetch"
                action={() => {
                  throw new Error("Kaboom!");
                }}
                errorElement={<p>Not I!</p>}
              />
            </Route>
          ),
          {
            window: getWindow("/child"),
            hydrationData: { loaderData: { "0": null } },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let fetcher = useFetcher();
          return (
            <fetcher.Form method="post" action="/fetch">
              <button type="submit" name="key" value="value">
                submit
              </button>
            </fetcher.Form>
          );
        }

        function ErrorElement() {
          let error = useRouteError() as Error;
          return <p>contextual error:{error.message}</p>;
        }

        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <form
              action="/fetch"
              method="post"
            >
              <button
                name="key"
                type="submit"
                value="value"
              >
                submit
              </button>
            </form>
          </div>"
        `);

        fireEvent.click(screen.getByText("submit"));
        await waitFor(() => screen.getByText(/Kaboom!/));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              contextual error:
              Kaboom!
            </p>
          </div>"
        `);
      });

      it("useFetcher is stable across across location changes", async () => {
        let router = createBrowserRouter(
          [
            {
              path: "/",
              Component() {
                const [, setSearchParams] = useSearchParams();
                let [count, setCount] = React.useState(0);
                let fetcherCount = React.useRef(0);
                let fetcher = useFetcher();
                React.useEffect(() => {
                  fetcherCount.current++;
                }, [fetcher.submit]);
                return (
                  <>
                    <button
                      onClick={() => {
                        setCount(count + 1);
                        setSearchParams({
                          random: Math.random().toString(),
                        });
                      }}
                    >
                      Click
                    </button>
                    <p>
                      {`render count:${count}`}
                      {`fetcher count:${fetcherCount.current}`}
                    </p>
                  </>
                );
              },
            },
          ],
          {
            window: getWindow("/"),
          }
        );

        let { container } = render(<RouterProvider router={router} />);

        let html = getHtml(container);
        expect(html).toContain("render count:0");
        expect(html).toContain("fetcher count:0");

        fireEvent.click(screen.getByText("Click"));
        fireEvent.click(screen.getByText("Click"));
        fireEvent.click(screen.getByText("Click"));
        await waitFor(() => screen.getByText(/render count:3/));

        html = getHtml(container);
        expect(html).toContain("render count:3");
        expect(html).toContain("fetcher count:1");
      });

      describe("useFetcher({ key })", () => {
        it("generates unique keys for fetchers by default", async () => {
          let dfd1 = createDeferred();
          let dfd2 = createDeferred();
          let router = createTestRouter(
            [
              {
                path: "/",
                Component() {
                  let fetcher1 = useFetcher();
                  let fetcher2 = useFetcher();
                  let fetchers = useFetchers();
                  return (
                    <>
                      <button onClick={() => fetcher1.load("/fetch1")}>
                        Load 1
                      </button>
                      <button onClick={() => fetcher2.load("/fetch2")}>
                        Load 2
                      </button>
                      <pre>{`${fetchers.length}, ${fetcher1.state}/${fetcher1.data}, ${fetcher2.state}/${fetcher2.data}`}</pre>
                    </>
                  );
                },
              },
              {
                path: "/fetch1",
                loader: () => dfd1.promise,
              },
              {
                path: "/fetch2",
                loader: () => dfd2.promise,
              },
            ],
            { window: getWindow("/") }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("pre")!.innerHTML).toBe(
            "0, idle/undefined, idle/undefined"
          );

          fireEvent.click(screen.getByText("Load 1"));
          await waitFor(() =>
            screen.getByText("1, loading/undefined, idle/undefined")
          );

          dfd1.resolve("FETCH 1");
          await waitFor(() =>
            screen.getByText("1, idle/FETCH 1, idle/undefined")
          );

          fireEvent.click(screen.getByText("Load 2"));
          await waitFor(() =>
            screen.getByText("2, idle/FETCH 1, loading/undefined")
          );

          dfd2.resolve("FETCH 2");
          await waitFor(() =>
            screen.getByText("2, idle/FETCH 1, idle/FETCH 2")
          );
        });

        it("allows users to specify their own key to share fetchers", async () => {
          let dfd1 = createDeferred();
          let dfd2 = createDeferred();
          let router = createTestRouter(
            [
              {
                path: "/",
                Component() {
                  let fetcher1 = useFetcher({ key: "shared" });
                  let fetcher2 = useFetcher({ key: "shared" });
                  let fetchers = useFetchers();
                  return (
                    <>
                      <button onClick={() => fetcher1.load("/fetch1")}>
                        Load 1
                      </button>
                      <button onClick={() => fetcher2.load("/fetch2")}>
                        Load 2
                      </button>
                      <pre>{`${fetchers.length}, ${fetcher1.state}/${fetcher1.data}, ${fetcher2.state}/${fetcher2.data}`}</pre>
                    </>
                  );
                },
              },
              {
                path: "/fetch1",
                loader: () => dfd1.promise,
              },
              {
                path: "/fetch2",
                loader: () => dfd2.promise,
              },
            ],
            { window: getWindow("/") }
          );
          let { container } = render(<RouterProvider router={router} />);

          expect(container.querySelector("pre")!.innerHTML).toBe(
            "0, idle/undefined, idle/undefined"
          );

          fireEvent.click(screen.getByText("Load 1"));
          await waitFor(() =>
            screen.getByText("1, loading/undefined, loading/undefined")
          );

          dfd1.resolve("FETCH 1");
          await waitFor(() =>
            screen.getByText("1, idle/FETCH 1, idle/FETCH 1")
          );

          fireEvent.click(screen.getByText("Load 2"));
          await waitFor(() =>
            screen.getByText("1, loading/FETCH 1, loading/FETCH 1")
          );

          dfd2.resolve("FETCH 2");
          await waitFor(() =>
            screen.getByText("1, idle/FETCH 2, idle/FETCH 2")
          );
        });

        it("updates the key if it changes while the fetcher remains mounted", async () => {
          let router = createTestRouter(
            [
              {
                path: "/",
                Component() {
                  let fetchers = useFetchers();
                  let [fetcherKey, setFetcherKey] = React.useState("a");
                  return (
                    <>
                      <ReusedFetcher fetcherKey={fetcherKey} />
                      <button onClick={() => setFetcherKey("b")}>
                        Change Key
                      </button>
                      <p>Fetchers:</p>
                      <pre>{JSON.stringify(fetchers)}</pre>
                    </>
                  );
                },
              },
              {
                path: "/echo",
                loader: ({ request }) => request.url,
              },
            ],
            { window: getWindow("/") }
          );

          function ReusedFetcher({ fetcherKey }: { fetcherKey: string }) {
            let fetcher = useFetcher({ key: fetcherKey });

            return (
              <>
                <button
                  onClick={() => fetcher.load(`/echo?fetcherKey=${fetcherKey}`)}
                >
                  Load Fetcher
                </button>
                <p>{`fetcherKey:${fetcherKey}`}</p>
                <p>Fetcher:{JSON.stringify(fetcher)}</p>
              </>
            );
          }

          let { container } = render(<RouterProvider router={router} />);

          // Start with idle fetcher 'a'
          expect(getHtml(container)).toContain('{"Form":{},"state":"idle"}');
          expect(getHtml(container)).toContain("fetcherKey:a");

          fireEvent.click(screen.getByText("Load Fetcher"));
          await waitFor(
            () => screen.getAllByText(/\/echo\?fetcherKey=a/).length > 0
          );

          // Fetcher 'a' now has data
          expect(getHtml(container)).toContain(
            '{"Form":{},"state":"idle","data":"http://localhost/echo?fetcherKey=a"}'
          );
          expect(getHtml(container)).toContain(
            '[{"state":"idle","data":"http://localhost/echo?fetcherKey=a","key":"a"}]'
          );

          fireEvent.click(screen.getByText("Change Key"));
          await waitFor(() => screen.getByText("fetcherKey:b"));

          // We should have a new uninitialized/idle fetcher 'b'
          expect(getHtml(container)).toContain('{"Form":{},"state":"idle"');
          expect(getHtml(container)).toContain("[]");
        });

        it("exposes fetcher keys via useFetchers", async () => {
          let router = createTestRouter(
            [
              {
                path: "/",
                loader: () => "FETCH",
                Component() {
                  let fetcher1 = useFetcher();
                  let fetcher2 = useFetcher({ key: "my-key" });
                  let fetchers = useFetchers();
                  React.useEffect(() => {
                    if (fetcher1.state === "idle" && !fetcher1.data) {
                      fetcher1.load("/");
                    }
                    if (fetcher2.state === "idle" && !fetcher2.data) {
                      fetcher2.load("/");
                    }
                  }, [fetcher1, fetcher2]);
                  return <pre>{fetchers.map((f) => f.key).join(",")}</pre>;
                },
              },
            ],
            { window: getWindow("/") }
          );
          let { container } = render(<RouterProvider router={router} />);
          expect(container.innerHTML).not.toMatch(/my-key/);
          await waitFor(() =>
            // React `useId()` results in either `:r2a:` or `:rp:` depending on
            // `DataBrowserRouter`/`DataHashRouter`
            expect(container.innerHTML).toMatch(/(:r2a:|:rp:),my-key/)
          );
        });
      });

      describe("fetcher persistence", () => {
        describe("default behavior", () => {
          it("loading fetchers clean up on unmount by default", async () => {
            let dfd = createDeferred();
            let loaderRequest: Request | null = null;
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher();
                        return (
                          <button onClick={() => fetcher.load("/fetch")}>
                            {`Load (${fetcher.state})`}
                          </button>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        return <h1>Page</h1>;
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  loader: ({ request }) => {
                    loaderRequest = request;
                    return dfd.promise;
                  },
                },
              ],
              { window: getWindow("/") }
            );
            let { container } = render(<RouterProvider router={router} />);

            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Load (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Load (loading)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page"));
            expect(getHtml(container)).toMatch("Num fetchers: 0");
            expect(getHtml(container)).toMatch("Page");

            // Resolve after the navigation - no-op
            expect((loaderRequest as unknown as Request)?.signal?.aborted).toBe(
              true
            );
            dfd.resolve("FETCH");
            await waitFor(() => screen.getByText("Num fetchers: 0"));
            expect(getHtml(container)).toMatch("Page");
          });

          it("submitting fetchers persist until completion", async () => {
            let dfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher();
                        return (
                          <button
                            onClick={() =>
                              fetcher.submit(
                                {},
                                { method: "post", action: "/fetch" }
                              )
                            }
                          >
                            {`Submit (${fetcher.state})`}
                          </button>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        return <h1>Page</h1>;
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  action: () => dfd.promise,
                },
              ],
              { window: getWindow("/") }
            );
            let { container } = render(<RouterProvider router={router} />);

            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Submit (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Submit (submitting)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page"));
            expect(getHtml(container)).toMatch("Num fetchers: 0");

            // Resolve after the navigation - trigger cleanup
            dfd.resolve("FETCH");
            await waitFor(() => screen.getByText("Num fetchers: 0"));
          });
        });

        describe("v7_fetcherPersist=true", () => {
          it("loading fetchers persist until completion", async () => {
            let dfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher();
                        return (
                          <button onClick={() => fetcher.load("/fetch")}>
                            {`Load (${fetcher.state})`}
                          </button>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        return <h1>Page</h1>;
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  loader: () => dfd.promise,
                },
              ],
              { window: getWindow("/"), future: { v7_fetcherPersist: true } }
            );
            let { container } = render(<RouterProvider router={router} />);

            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Load (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Load (loading)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Page");

            // Resolve after the navigation - no-op
            dfd.resolve("FETCH");
            await waitFor(() => screen.getByText("Num fetchers: 0"));
            expect(getHtml(container)).toMatch("Page");
          });

          it("submitting fetchers persist until completion", async () => {
            let dfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher();
                        return (
                          <button
                            onClick={() =>
                              fetcher.submit(
                                {},
                                { method: "post", action: "/fetch" }
                              )
                            }
                          >
                            {`Submit (${fetcher.state})`}
                          </button>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        return <h1>Page</h1>;
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  action: () => dfd.promise,
                },
              ],
              { window: getWindow("/"), future: { v7_fetcherPersist: true } }
            );
            let { container } = render(<RouterProvider router={router} />);

            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Submit (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Submit (submitting)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");

            // Resolve after the navigation - trigger cleanup
            dfd.resolve("FETCH");
            await waitFor(() => screen.getByText("Num fetchers: 0"));
          });

          it("submitting fetchers w/revalidations are cleaned up on completion", async () => {
            let count = 0;
            let dfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher();
                        return (
                          <button
                            onClick={() =>
                              fetcher.submit(
                                {},
                                { method: "post", action: "/fetch" }
                              )
                            }
                          >
                            {`Submit (${fetcher.state})`}
                          </button>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        let data = useLoaderData() as { count: number };
                        return <h1>{`Page (${data.count})`}</h1>;
                      },
                      async loader() {
                        await new Promise((r) => setTimeout(r, 10));
                        return { count: ++count };
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  action: () => dfd.promise,
                },
              ],
              { window: getWindow("/"), future: { v7_fetcherPersist: true } }
            );
            let { container } = render(<RouterProvider router={router} />);

            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Submit (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Submit (submitting)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page (1)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");

            // Resolve action after the navigation and trigger revalidation
            dfd.resolve("FETCH");
            await waitFor(() => screen.getByText("Num fetchers: 0"));
            expect(getHtml(container)).toMatch("Page (2)");
          });

          it("submitting fetchers w/revalidations are cleaned up on completion (remounted)", async () => {
            let count = 0;
            let dfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher({ key: "me" });
                        return (
                          <button
                            onClick={() =>
                              fetcher.submit(
                                {},
                                { method: "post", action: "/fetch" }
                              )
                            }
                          >
                            {`Submit (${fetcher.state})`}
                          </button>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        let fetcher = useFetcher({ key: "me" });
                        let data = useLoaderData() as { count: number };
                        return (
                          <>
                            <h1>{`Page (${data.count})`}</h1>
                            <p>{fetcher.data}</p>
                          </>
                        );
                      },
                      async loader() {
                        await new Promise((r) => setTimeout(r, 10));
                        return { count: ++count };
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  action: () => dfd.promise,
                },
              ],
              { window: getWindow("/"), future: { v7_fetcherPersist: true } }
            );
            let { container } = render(<RouterProvider router={router} />);

            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Submit (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Submit (submitting)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page (1)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");

            // Resolve after the navigation and revalidation
            dfd.resolve("FETCH");
            await waitFor(() => screen.getByText("Num fetchers: 0"));
            expect(getHtml(container)).toMatch("Page (2)");
            expect(getHtml(container)).toMatch("FETCH");
          });

          it("submitting fetchers w/redirects are cleaned up on completion", async () => {
            let dfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher();
                        return (
                          <button
                            onClick={() =>
                              fetcher.submit(
                                {},
                                { method: "post", action: "/fetch" }
                              )
                            }
                          >
                            {`Submit (${fetcher.state})`}
                          </button>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        return <h1>Page</h1>;
                      },
                    },
                    {
                      path: "redirect",
                      Component() {
                        return <h1>Redirect</h1>;
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  action: () => dfd.promise,
                },
              ],
              { window: getWindow("/"), future: { v7_fetcherPersist: true } }
            );
            let { container } = render(<RouterProvider router={router} />);

            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Submit (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Submit (submitting)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");

            // Resolve after the navigation - trigger cleanup
            // We don't process the redirect here since it was superseded by a
            // navigation, but we assert that it gets cleaned up afterwards
            dfd.resolve(redirect("/redirect"));
            await waitFor(() => screen.getByText("Num fetchers: 0"));
            expect(getHtml(container)).toMatch("Page");
          });

          it("submitting fetcher.Form persist until completion", async () => {
            let dfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher();
                        return (
                          <fetcher.Form method="post" action="/fetch">
                            <button type="submit">
                              {`Submit (${fetcher.state})`}
                            </button>
                          </fetcher.Form>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        return <h1>Page</h1>;
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  action: () => dfd.promise,
                },
              ],
              { window: getWindow("/"), future: { v7_fetcherPersist: true } }
            );
            let { container } = render(<RouterProvider router={router} />);

            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Submit (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Submit (submitting)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");

            // Resolve after the navigation and revalidation
            dfd.resolve("FETCH");
            await waitFor(() => screen.getByText("Num fetchers: 0"));
          });

          it("unmounted fetcher.load errors should not bubble up to the UI", async () => {
            let dfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher();
                        return (
                          <button onClick={() => fetcher.load("/fetch")}>
                            {`Load (${fetcher.state})`}
                          </button>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        return <h1>Page</h1>;
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  loader: () => dfd.promise,
                },
              ],
              { window: getWindow("/"), future: { v7_fetcherPersist: true } }
            );
            let { container } = render(<RouterProvider router={router} />);

            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Load (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Load (loading)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Page");

            // Reject after the navigation - no-op because the fetcher is no longer mounted
            dfd.reject(new Error("FETCH ERROR"));
            await waitFor(() => screen.getByText("Num fetchers: 0"));
            expect(getHtml(container)).toMatch("Page");
            expect(getHtml(container)).not.toMatch(
              "Unexpected Application Error!"
            );
            expect(getHtml(container)).not.toMatch("FETCH ERROR");
          });

          it("unmounted/remounted fetcher.load errors should bubble up to the UI", async () => {
            let dfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher({ key: "me" });
                        return (
                          <>
                            <h1>Index</h1>
                            <button onClick={() => fetcher.load("/fetch")}>
                              {`Load (${fetcher.state})`}
                            </button>
                          </>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        let fetcher = useFetcher({ key: "me" });
                        return (
                          <>
                            <h1>Page</h1>
                            <pre>{fetcher.data}</pre>
                          </>
                        );
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  loader: () => dfd.promise,
                },
              ],
              { window: getWindow("/"), future: { v7_fetcherPersist: true } }
            );
            let { container } = render(<RouterProvider router={router} />);

            await waitFor(() => screen.getByText("Index"));
            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Load (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Load (loading)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Page");

            // Reject after the navigation - should trigger the error boundary
            // because the fetcher is still mounted in the new location
            dfd.reject(new Error("FETCH ERROR"));
            await waitFor(() => screen.getByText("FETCH ERROR"));
            expect(getHtml(container)).toMatch("Unexpected Application Error!");
          });

          it("unmounted fetcher.submit errors should not bubble up to the UI", async () => {
            let dfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher();
                        return (
                          <button
                            onClick={() =>
                              fetcher.submit(
                                {},
                                { method: "post", action: "/fetch" }
                              )
                            }
                          >
                            {`Submit (${fetcher.state})`}
                          </button>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        return <h1>Page</h1>;
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  action: () => dfd.promise,
                },
              ],
              { window: getWindow("/"), future: { v7_fetcherPersist: true } }
            );
            let { container } = render(<RouterProvider router={router} />);

            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Submit (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Submit (submitting)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Page");

            // Reject after the navigation - no-op because the fetcher is no longer mounted
            dfd.reject(new Error("FETCH ERROR"));
            await waitFor(() => screen.getByText("Num fetchers: 0"));
            expect(getHtml(container)).toMatch("Page");
            expect(getHtml(container)).not.toMatch(
              "Unexpected Application Error!"
            );
            expect(getHtml(container)).not.toMatch("FETCH ERROR");
          });

          it("unmounted/remounted fetcher.submit errors should bubble up to the UI", async () => {
            let dfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  Component() {
                    let fetchers = useFetchers();
                    return (
                      <>
                        <pre>{`Num fetchers: ${fetchers.length}`}</pre>
                        <Link to="/page">Go to /page</Link>
                        <Outlet />
                      </>
                    );
                  },
                  children: [
                    {
                      index: true,
                      Component() {
                        let fetcher = useFetcher({ key: "me" });
                        return (
                          <>
                            <h1>Index</h1>
                            <button
                              onClick={() =>
                                fetcher.submit(
                                  {},
                                  { method: "post", action: "/fetch" }
                                )
                              }
                            >
                              {`Submit (${fetcher.state})`}
                            </button>
                          </>
                        );
                      },
                    },
                    {
                      path: "page",
                      Component() {
                        let fetcher = useFetcher({ key: "me" });
                        return (
                          <>
                            <h1>Page</h1>
                            <pre>{fetcher.data}</pre>
                          </>
                        );
                      },
                    },
                  ],
                },
                {
                  path: "/fetch",
                  action: () => dfd.promise,
                },
              ],
              { window: getWindow("/"), future: { v7_fetcherPersist: true } }
            );
            let { container } = render(<RouterProvider router={router} />);

            await waitFor(() => screen.getByText("Index"));
            expect(getHtml(container)).toMatch("Num fetchers: 0");

            fireEvent.click(screen.getByText("Submit (idle)"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Submit (submitting)");

            fireEvent.click(screen.getByText("Go to /page"));
            await waitFor(() => screen.getByText("Page"));
            expect(getHtml(container)).toMatch("Num fetchers: 1");
            expect(getHtml(container)).toMatch("Page");

            // Reject after the navigation - should trigger the error boundary
            // because the fetcher is still mounted in the new location
            dfd.reject(new Error("FETCH ERROR"));
            await waitFor(() => screen.getByText("FETCH ERROR"));
            expect(getHtml(container)).toMatch("Unexpected Application Error!");
          });

          it("unmounted fetchers should not revalidate", async () => {
            let count = 0;
            let loaderDfd = createDeferred();
            let actionDfd = createDeferred();
            let router = createTestRouter(
              [
                {
                  path: "/",
                  action: () => actionDfd.promise,
                  Component() {
                    let [showFetcher, setShowFetcher] = React.useState(true);
                    let [fetcherData, setFetcherData] = React.useState(null);
                    let fetchers = useFetchers();
                    let actionData = useActionData();
                    let navigation = useNavigation();

                    return (
                      <>
                        <Form method="post">
                          <button type="submit">Submit Form</button>
                          <p>{`Navigation State: ${navigation.state}`}</p>
                          <p>{`Action Data: ${actionData}`}</p>
                          <p>{`Active Fetchers: ${fetchers.length}`}</p>
                        </Form>
                        {showFetcher ? (
                          <FetcherComponent
                            onClose={(data) => {
                              setFetcherData(data);
                              setShowFetcher(false);
                            }}
                          />
                        ) : (
                          <p>{fetcherData}</p>
                        )}
                      </>
                    );
                  },
                },
                {
                  path: "/fetch",
                  async loader() {
                    count++;
                    if (count === 1) return await loaderDfd.promise;
                    throw new Error("Fetcher load called too many times");
                  },
                },
              ],
              { window: getWindow("/"), future: { v7_fetcherPersist: true } }
            );

            function FetcherComponent({ onClose }) {
              let fetcher = useFetcher();

              React.useEffect(() => {
                if (fetcher.state === "idle" && fetcher.data) {
                  onClose(fetcher.data);
                }
              }, [fetcher, onClose]);

              return (
                <>
                  <button onClick={() => fetcher.load("/fetch")}>
                    Load Fetcher
                  </button>
                  <pre>{`Fetcher State: ${fetcher.state}`}</pre>
                </>
              );
            }

            render(<RouterProvider router={router} />);

            fireEvent.click(screen.getByText("Load Fetcher"));
            await waitFor(
              () =>
                screen.getByText("Active Fetchers: 1") &&
                screen.getByText("Fetcher State: loading")
            );

            loaderDfd.resolve("FETCHER DATA");
            await waitFor(
              () =>
                screen.getByText("FETCHER DATA") &&
                screen.getByText("Active Fetchers: 0")
            );

            fireEvent.click(screen.getByText("Submit Form"));
            await waitFor(() =>
              screen.getByText("Navigation State: submitting")
            );

            actionDfd.resolve("ACTION");
            await waitFor(
              () =>
                screen.getByText("Navigation State: idle") &&
                screen.getByText("Active Fetchers: 0") &&
                screen.getByText("Action Data: ACTION")
            );

            expect(count).toBe(1);
          });
        });
      });

      describe("<Form navigate={false}>", () => {
        function setupTest(
          method: "get" | "post",
          navigate: boolean,
          renderFetcher = false
        ) {
          let loaderDefer = createDeferred();
          let actionDefer = createDeferred();

          let router = createTestRouter(
            [
              {
                path: "/",
                async action({ request }) {
                  let resolvedValue = await actionDefer.promise;
                  let formData = await request.formData();
                  return `${resolvedValue}:${formData.get("test")}`;
                },
                loader: () => loaderDefer.promise,
                Component() {
                  let data = useLoaderData() as string;
                  let actionData = useActionData() as string | undefined;
                  let location = useLocation();
                  let navigation = useNavigation();
                  let fetchers = useFetchers();
                  return (
                    <div>
                      <Form
                        method={method}
                        navigate={navigate}
                        fetcherKey={renderFetcher ? "my-key" : undefined}
                      >
                        <input name="test" value="value" />
                        <button type="submit">Submit Form</button>
                      </Form>
                      <pre>
                        {[
                          location.key,
                          navigation.state,
                          data,
                          actionData,
                          fetchers.map((f) => f.state),
                        ].join(",")}
                      </pre>
                      <Outlet />
                    </div>
                  );
                },
                ...(renderFetcher
                  ? {
                      children: [
                        {
                          index: true,
                          Component() {
                            let fetcher = useFetcher({ key: "my-key" });
                            return (
                              <pre>{`fetcher:${fetcher.state}:${fetcher.data}`}</pre>
                            );
                          },
                        },
                      ],
                    }
                  : {}),
              },
            ],
            {
              window: getWindow("/"),
              hydrationData: { loaderData: { "0": "INIT" } },
            }
          );

          let { container } = render(<RouterProvider router={router} />);

          return { container, loaderDefer, actionDefer };
        }

        it('defaults to a navigation on <Form method="get">', async () => {
          let { container, loaderDefer } = setupTest("get", true);

          // location key, nav state, loader data, action data, fetcher states
          expect(getHtml(container)).toMatch("default,idle,INIT,,");

          fireEvent.click(screen.getByText("Submit Form"));
          await waitFor(() => screen.getByText("default,loading,INIT,,"));

          loaderDefer.resolve("LOADER");
          await waitFor(() => screen.getByText(/idle,LOADER,/));
          // Navigation changes the location key
          expect(getHtml(container)).not.toMatch("default");
        });

        it('defaults to a navigation on <Form method="post">', async () => {
          let { container, loaderDefer, actionDefer } = setupTest("post", true);

          // location key, nav state, loader data, action data, fetcher states
          expect(getHtml(container)).toMatch("default,idle,INIT,,");

          fireEvent.click(screen.getByText("Submit Form"));
          await waitFor(() => screen.getByText("default,submitting,INIT,,"));

          actionDefer.resolve("ACTION");
          await waitFor(() =>
            screen.getByText("default,loading,INIT,ACTION:value,")
          );

          loaderDefer.resolve("LOADER");
          await waitFor(() => screen.getByText(/idle,LOADER,ACTION:value/));
          // Navigation changes the location key
          expect(getHtml(container)).not.toMatch("default");
        });

        it('uses a fetcher for <Form method="get" navigate={false}>', async () => {
          let { container, loaderDefer } = setupTest("get", false);

          // location.key,navigation.state
          expect(getHtml(container)).toMatch("default,idle,INIT,,");

          fireEvent.click(screen.getByText("Submit Form"));
          // Fetcher does not trigger useNavigation
          await waitFor(() => screen.getByText("default,idle,INIT,,loading"));

          loaderDefer.resolve("LOADER");
          // Fetcher does not change the location key.  Because no useFetcher()
          // accessed this key, the fetcher/data doesn't stick around
          await waitFor(() => screen.getByText("default,idle,INIT,,idle"));
        });

        it('uses a fetcher for <Form method="post" navigate={false}>', async () => {
          let { container, loaderDefer, actionDefer } = setupTest(
            "post",
            false
          );

          expect(getHtml(container)).toMatch("default,idle,INIT,");

          fireEvent.click(screen.getByText("Submit Form"));
          // Fetcher does not trigger useNavigation
          await waitFor(() =>
            screen.getByText("default,idle,INIT,,submitting")
          );

          actionDefer.resolve("ACTION");
          await waitFor(() => screen.getByText("default,idle,INIT,,loading"));

          loaderDefer.resolve("LOADER");
          // Fetcher does not change the location key.  Because no useFetcher()
          // accessed this key, the fetcher/data doesn't stick around
          await waitFor(() => screen.getByText("default,idle,LOADER,,idle"));
        });

        it('uses a fetcher for <Form method="get" navigate={false} fetcherKey>', async () => {
          let { container, loaderDefer } = setupTest("get", false, true);

          expect(getHtml(container)).toMatch("default,idle,INIT,,");

          fireEvent.click(screen.getByText("Submit Form"));
          // Fetcher does not trigger useNavigation
          await waitFor(() => screen.getByText("default,idle,INIT,,loading"));
          expect(getHtml(container)).toMatch("fetcher:loading:undefined");

          loaderDefer.resolve("LOADER");
          // Fetcher does not change the location key.  Because no useFetcher()
          // accessed this key, the fetcher/data doesn't stick around
          await waitFor(() => screen.getByText("default,idle,INIT,,idle"));
          expect(getHtml(container)).toMatch("fetcher:idle:LOADER");
        });

        it('uses a fetcher for <Form method="post" navigate={false} fetcherKey>', async () => {
          let { container, loaderDefer, actionDefer } = setupTest(
            "post",
            false,
            true
          );

          expect(getHtml(container)).toMatch("default,idle,INIT,");

          fireEvent.click(screen.getByText("Submit Form"));
          // Fetcher does not trigger useNavigation
          await waitFor(() =>
            screen.getByText("default,idle,INIT,,submitting")
          );

          actionDefer.resolve("ACTION");
          await waitFor(() => screen.getByText("default,idle,INIT,,loading"));
          expect(getHtml(container)).toMatch("fetcher:loading:ACTION:value");

          loaderDefer.resolve("LOADER");
          // Fetcher does not change the location key.  Because no useFetcher()
          // accessed this key, the fetcher/data doesn't stick around
          await waitFor(() => screen.getByText("default,idle,LOADER,,idle"));
          expect(getHtml(container)).toMatch("fetcher:idle:ACTION:value");
        });
      });

      describe("with a basename", () => {
        it("prepends the basename to fetcher.load paths", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/" element={<Comp />}>
                <Route path="fetch" loader={() => "FETCH"} />
              </Route>
            ),
            {
              basename: "/base",
              window: getWindow("/base"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          function Comp() {
            let fetcher = useFetcher();
            return (
              <>
                <p>{`data:${fetcher.data}`}</p>
                <button onClick={() => fetcher.load("/fetch")}>load</button>
              </>
            );
          }

          expect(getHtml(container)).toMatchInlineSnapshot(`
            "<div>
              <p>
                data:undefined
              </p>
              <button>
                load
              </button>
            </div>"
          `);

          fireEvent.click(screen.getByText("load"));
          await waitFor(() => screen.getByText(/FETCH/));
          expect(getHtml(container)).toMatchInlineSnapshot(`
            "<div>
              <p>
                data:FETCH
              </p>
              <button>
                load
              </button>
            </div>"
          `);
        });

        it('prepends the basename to fetcher.submit({ method: "get" }) paths', async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/" element={<Comp />}>
                <Route path="fetch" loader={() => "FETCH"} />
              </Route>
            ),
            {
              basename: "/base",
              window: getWindow("/base"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          function Comp() {
            let fetcher = useFetcher();
            return (
              <>
                <p>{`data:${fetcher.data}`}</p>
                <button
                  onClick={() =>
                    fetcher.submit({}, { method: "get", action: "/fetch" })
                  }
                >
                  load
                </button>
              </>
            );
          }

          expect(getHtml(container)).toMatchInlineSnapshot(`
            "<div>
              <p>
                data:undefined
              </p>
              <button>
                load
              </button>
            </div>"
          `);

          fireEvent.click(screen.getByText("load"));
          await waitFor(() => screen.getByText(/FETCH/));
          expect(getHtml(container)).toMatchInlineSnapshot(`
            "<div>
              <p>
                data:FETCH
              </p>
              <button>
                load
              </button>
            </div>"
          `);
        });

        it('prepends the basename to fetcher.submit({ method: "post" }) paths', async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/" element={<Comp />}>
                <Route path="fetch" action={() => "FETCH"} />
              </Route>
            ),
            {
              basename: "/base",
              window: getWindow("/base"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          function Comp() {
            let fetcher = useFetcher();
            return (
              <>
                <p>{`data:${fetcher.data}`}</p>
                <button
                  onClick={() =>
                    fetcher.submit({}, { method: "post", action: "/fetch" })
                  }
                >
                  submit
                </button>
              </>
            );
          }

          expect(getHtml(container)).toMatchInlineSnapshot(`
            "<div>
              <p>
                data:undefined
              </p>
              <button>
                submit
              </button>
            </div>"
          `);

          fireEvent.click(screen.getByText("submit"));
          await waitFor(() => screen.getByText(/FETCH/));
          expect(getHtml(container)).toMatchInlineSnapshot(`
            "<div>
              <p>
                data:FETCH
              </p>
              <button>
                submit
              </button>
            </div>"
          `);
        });
        it("prepends the basename to fetcher.Form paths", async () => {
          let router = createTestRouter(
            createRoutesFromElements(
              <Route path="/" element={<Comp />}>
                <Route path="fetch" action={() => "FETCH"} />
              </Route>
            ),
            {
              basename: "/base",
              window: getWindow("/base"),
            }
          );
          let { container } = render(<RouterProvider router={router} />);

          function Comp() {
            let fetcher = useFetcher();
            return (
              <>
                <p>{`data:${fetcher.data}`}</p>
                <fetcher.Form method="post" action="/fetch">
                  <button type="submit">submit</button>
                </fetcher.Form>
              </>
            );
          }

          expect(getHtml(container)).toMatchInlineSnapshot(`
            "<div>
              <p>
                data:undefined
              </p>
              <form
                action="/base/fetch"
                method="post"
              >
                <button
                  type="submit"
                >
                  submit
                </button>
              </form>
            </div>"
          `);

          fireEvent.click(screen.getByText("submit"));
          await waitFor(() => screen.getByText(/FETCH/));
          expect(getHtml(container)).toMatchInlineSnapshot(`
            "<div>
              <p>
                data:FETCH
              </p>
              <form
                action="/base/fetch"
                method="post"
              >
                <button
                  type="submit"
                >
                  submit
                </button>
              </form>
            </div>"
          `);
        });
      });
    });

    describe("errors", () => {
      it("renders hydration errors on leaf elements", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" element={<Comp />}>
              <Route
                path="child"
                element={<Comp />}
                errorElement={<ErrorBoundary />}
              />
            </Route>
          ),
          {
            window: getWindow("/child"),
            hydrationData: {
              loaderData: {
                "0": "parent data",
              },
              actionData: {
                "0": "parent action",
              },
              errors: {
                "0-0": new Error("Kaboom 💥"),
              },
            },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let data = useLoaderData();
          let actionData = useActionData();
          let navigation = useNavigation();
          return (
            <div>
              <>{data}</>
              <>{actionData}</>
              <>{navigation.state}</>
              <Outlet />
            </div>
          );
        }

        function ErrorBoundary() {
          let error = useRouteError() as Error;
          return <p>{error.message}</p>;
        }

        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <div>
              parent data
              parent action
              idle
              <p>
                Kaboom 💥
              </p>
            </div>
          </div>"
        `);
      });

      it("renders hydration errors on lazy leaf elements with preloading", async () => {
        let routes = createRoutesFromElements(
          <Route path="/" element={<Comp />}>
            <Route
              path="child"
              lazy={async () => ({
                element: <Comp />,
                errorElement: <ErrorBoundary />,
              })}
            />
          </Route>
        );

        let lazyMatches = matchRoutes(routes, { pathname: "/child" })?.filter(
          (m) => m.route.lazy
        );

        if (lazyMatches && lazyMatches?.length > 0) {
          await Promise.all(
            lazyMatches.map(async (m) => {
              let routeModule = await m.route.lazy!();
              Object.assign(m.route, { ...routeModule, lazy: undefined });
            })
          );
        }

        let router = createTestRouter(routes, {
          window: getWindow("/child"),
          hydrationData: {
            loaderData: {
              "0": "parent data",
            },
            actionData: {
              "0": "parent action",
            },
            errors: {
              "0-0": new Error("Kaboom 💥"),
            },
          },
        });

        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let data = useLoaderData();
          let actionData = useActionData();
          let navigation = useNavigation();
          return (
            <div>
              <>{data}</>
              <>{actionData}</>
              <>{navigation.state}</>
              <Outlet />
            </div>
          );
        }

        function ErrorBoundary() {
          let error = useRouteError() as Error;
          return <p>{error.message}</p>;
        }

        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <div>
              parent data
              parent action
              idle
              <p>
                Kaboom 💥
              </p>
            </div>
          </div>"
        `);
      });

      it("renders hydration errors on parent elements", async () => {
        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" element={<Comp />} errorElement={<ErrorBoundary />}>
              <Route path="child" element={<Comp />} />
            </Route>
          ),
          {
            window: getWindow("/child"),
            hydrationData: {
              loaderData: {},
              actionData: null,
              errors: {
                "0": new Error("Kaboom 💥"),
              },
            },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let data = useLoaderData();
          let actionData = useActionData();
          let navigation = useNavigation();
          return (
            <div>
              <>{data}</>
              <>{actionData}</>
              <>{navigation.state}</>
              <Outlet />
            </div>
          );
        }

        function ErrorBoundary() {
          let error = useRouteError() as Error;
          return <p>{error.message}</p>;
        }

        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              Kaboom 💥
            </p>
          </div>"
        `);
      });

      it("renders hydration errors on lazy parent elements with preloading", async () => {
        let routes = createRoutesFromElements(
          <Route
            path="/"
            lazy={async () => ({
              element: <Comp />,
              errorElement: <ErrorBoundary />,
            })}
          >
            <Route path="child" element={<Comp />} />
          </Route>
        );

        let lazyMatches = matchRoutes(routes, { pathname: "/child" })?.filter(
          (m) => m.route.lazy
        );

        if (lazyMatches && lazyMatches?.length > 0) {
          await Promise.all(
            lazyMatches.map(async (m) => {
              let routeModule = await m.route.lazy!();
              Object.assign(m.route, { ...routeModule, lazy: undefined });
            })
          );
        }

        let router = createTestRouter(routes, {
          window: getWindow("/child"),
          hydrationData: {
            loaderData: {},
            actionData: null,
            errors: {
              "0": new Error("Kaboom 💥"),
            },
          },
        });

        let { container } = render(<RouterProvider router={router} />);

        function Comp() {
          let data = useLoaderData();
          let actionData = useActionData();
          let navigation = useNavigation();
          return (
            <div>
              <>{data}</>
              <>{actionData}</>
              <>{navigation.state}</>
              <Outlet />
            </div>
          );
        }

        function ErrorBoundary() {
          let error = useRouteError() as Error;
          return <p>{error.message}</p>;
        }

        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              Kaboom 💥
            </p>
          </div>"
        `);
      });

      it("renders navigation errors on leaf elements", async () => {
        let fooDefer = createDeferred();
        let barDefer = createDeferred();

        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" element={<Layout />}>
              <Route
                path="foo"
                loader={() => fooDefer.promise}
                element={<Foo />}
                errorElement={<FooError />}
              />
              <Route
                path="bar"
                loader={() => barDefer.promise}
                element={<Bar />}
                errorElement={<BarError />}
              />
            </Route>
          ),
          {
            window: getWindow("/foo"),
            hydrationData: {
              loaderData: {
                "0-0": {
                  message: "hydrated from foo",
                },
              },
            },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Layout() {
          let navigation = useNavigation();
          return (
            <div>
              <Link to="/foo">Link to Foo</Link>
              <Link to="/bar">Link to Bar</Link>
              <div id="output">
                <p>{navigation.state}</p>
                <Outlet />
              </div>
            </div>
          );
        }

        function Foo() {
          let data = useLoaderData() as { message: string };
          return <h1>Foo:{data.message}</h1>;
        }
        function FooError() {
          let error = useRouteError() as Error;
          return <p>Foo Error:{error.message}</p>;
        }
        function Bar() {
          let data = useLoaderData() as { message: string };
          return <h1>Bar:{data.message}</h1>;
        }
        function BarError() {
          let error = useRouteError() as Error;
          return <p>Bar Error:{error.message}</p>;
        }

        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <h1>
              Foo:
              hydrated from foo
            </h1>
          </div>"
        `);

        fireEvent.click(screen.getByText("Link to Bar"));
        barDefer.reject(new Error("Kaboom!"));
        await waitFor(() => screen.getByText("idle"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <p>
              Bar Error:
              Kaboom!
            </p>
          </div>"
        `);

        fireEvent.click(screen.getByText("Link to Foo"));
        fooDefer.reject(new Error("Kaboom!"));
        await waitFor(() => screen.getByText("idle"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <p>
              Foo Error:
              Kaboom!
            </p>
          </div>"
        `);
      });

      it("renders navigation errors on parent elements", async () => {
        let fooDefer = createDeferred();
        let barDefer = createDeferred();

        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" element={<Layout />} errorElement={<LayoutError />}>
              <Route
                path="foo"
                loader={() => fooDefer.promise}
                element={<Foo />}
                errorElement={<FooError />}
              />
              <Route
                path="bar"
                loader={() => barDefer.promise}
                element={<Bar />}
              />
            </Route>
          ),
          {
            window: getWindow("/foo"),
            hydrationData: {
              loaderData: {
                "0-0": {
                  message: "hydrated from foo",
                },
              },
            },
          }
        );
        let { container } = render(<RouterProvider router={router} />);

        function Layout() {
          let navigation = useNavigation();
          return (
            <div>
              <Link to="/foo">Link to Foo</Link>
              <Link to="/bar">Link to Bar</Link>
              <div id="output">
                <p>{navigation.state}</p>
                <Outlet />
              </div>
            </div>
          );
        }
        function LayoutError() {
          let error = useRouteError() as Error;
          return <p>Layout Error:{error.message}</p>;
        }
        function Foo() {
          let data = useLoaderData() as { message: string };
          return <h1>Foo:{data.message}</h1>;
        }
        function FooError() {
          let error = useRouteError() as Error;
          return <p>Foo Error:{error.message}</p>;
        }
        function Bar() {
          let data = useLoaderData() as { message: string };
          return <h1>Bar:{data.message}</h1>;
        }

        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <h1>
              Foo:
              hydrated from foo
            </h1>
          </div>"
        `);

        fireEvent.click(screen.getByText("Link to Bar"));
        barDefer.reject(new Error("Kaboom!"));
        await waitFor(() => screen.getByText("Layout Error:Kaboom!"));
        expect(getHtml(container)).toMatchInlineSnapshot(`
          "<div>
            <p>
              Layout Error:
              Kaboom!
            </p>
          </div>"
        `);
      });

      // This test ensures that when manual routes are used, we add hasErrorBoundary
      it("renders navigation errors on leaf elements (when using manual route objects)", async () => {
        let barDefer = createDeferred();

        let routes = [
          {
            path: "/",
            element: <Layout />,
            children: [
              {
                path: "foo",
                element: <h1>Foo</h1>,
              },
              {
                path: "bar",
                loader: () => barDefer.promise,
                element: <Bar />,
                errorElement: <BarError />,
              },
            ],
          },
        ];

        let router = createTestRouter(routes, { window: getWindow("/foo") });
        let { container } = render(<RouterProvider router={router} />);

        function Layout() {
          let navigation = useNavigation();
          return (
            <div>
              <Link to="/bar">Link to Bar</Link>
              <div id="output">
                <p>{navigation.state}</p>
                <Outlet />
              </div>
            </div>
          );
        }

        function Bar() {
          let data = useLoaderData() as { message: string };
          return <h1>Bar:{data.message}</h1>;
        }
        function BarError() {
          let error = useRouteError() as Error;
          return <p>Bar Error:{error.message}</p>;
        }

        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <h1>
              Foo
            </h1>
          </div>"
        `);

        fireEvent.click(screen.getByText("Link to Bar"));
        barDefer.reject(new Error("Kaboom!"));
        await waitFor(() => screen.getByText("idle"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <p>
              Bar Error:
              Kaboom!
            </p>
          </div>"
        `);
      });

      // This test ensures that when manual routes are used, we add hasErrorBoundary
      it("renders navigation errors on lazy leaf elements (when using manual route objects)", async () => {
        let lazyRouteModule = {
          loader: () => barDefer.promise,
          Component: Bar,
          ErrorBoundary: BarError,
        };
        let lazyDefer = createDeferred<typeof lazyRouteModule>();
        let barDefer = createDeferred();

        let routes: RouteObject[] = [
          {
            path: "/",
            element: <Layout />,
            children: [
              {
                path: "foo",
                element: <h1>Foo</h1>,
              },
              {
                path: "bar",
                lazy: () => lazyDefer.promise,
              },
            ],
          },
        ];

        let router = createTestRouter(routes, { window: getWindow("/foo") });
        let { container } = render(<RouterProvider router={router} />);

        function Layout() {
          let navigation = useNavigation();
          return (
            <div>
              <Link to="/bar">Link to Bar</Link>
              <div id="output">
                <p>{navigation.state}</p>
                <Outlet />
              </div>
            </div>
          );
        }

        function Bar() {
          let data = useLoaderData() as { message: string };
          return <h1>Bar:{data.message}</h1>;
        }
        function BarError() {
          let error = useRouteError() as Error;
          return <p>Bar Error:{error.message}</p>;
        }

        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <h1>
              Foo
            </h1>
          </div>"
        `);

        fireEvent.click(screen.getByText("Link to Bar"));
        await lazyDefer.resolve(lazyRouteModule);
        barDefer.reject(new Error("Kaboom!"));
        await waitFor(() => screen.getByText("idle"));
        expect(getHtml(container.querySelector("#output")!))
          .toMatchInlineSnapshot(`
          "<div
            id="output"
          >
            <p>
              idle
            </p>
            <p>
              Bar Error:
              Kaboom!
            </p>
          </div>"
        `);
      });
    });

    describe("view transitions", () => {
      it("applies view transitions to navigations when opted in via boolean prop", async () => {
        let testWindow = getWindow("/");
        let spy = jest.fn((cb) => {
          cb();
          return {
            ready: Promise.resolve(),
            finished: Promise.resolve(),
            updateCallbackDone: Promise.resolve(),
            skipTransition: () => {},
          };
        });
        testWindow.document.startViewTransition = spy;

        let router = createTestRouter(
          [
            {
              path: "/",
              Component() {
                return (
                  <div>
                    <Link to="/a">/a</Link>
                    <Link to="/b" unstable_viewTransition>
                      /b
                    </Link>
                    <Form action="/c">
                      <button type="submit">/c</button>
                    </Form>
                    <Form action="/d" unstable_viewTransition>
                      <button type="submit">/d</button>
                    </Form>
                    <Outlet />
                  </div>
                );
              },
              children: [
                {
                  index: true,
                  Component: () => <h1>Home</h1>,
                },
                {
                  path: "a",
                  Component: () => <h1>A</h1>,
                },
                {
                  path: "b",
                  Component: () => <h1>B</h1>,
                },
                {
                  path: "c",
                  action: () => null,
                  Component: () => <h1>C</h1>,
                },
                {
                  path: "d",
                  action: () => null,
                  Component: () => <h1>D</h1>,
                },
              ],
            },
          ],
          { window: testWindow }
        );
        render(<RouterProvider router={router} />);

        expect(screen.getByText("Home")).toBeDefined();
        fireEvent.click(screen.getByText("/a"));
        await waitFor(() => screen.getByText("A"));
        expect(spy).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText("/b"));
        await waitFor(() => screen.getByText("B"));
        expect(spy).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText("/c"));
        await waitFor(() => screen.getByText("C"));
        expect(spy).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText("/d"));
        await waitFor(() => screen.getByText("D"));
        expect(spy).toHaveBeenCalledTimes(2);
      });

      it("applies view transitions to navigations when opted in via function callback", async () => {
        let testWindow = getWindow("/");
        let spy = jest.fn((cb) => {
          cb();
          return {
            ready: Promise.resolve(),
            finished: Promise.resolve(),
            updateCallbackDone: Promise.resolve(),
            skipTransition: () => {},
          };
        });
        testWindow.document.startViewTransition = spy;

        let router = createTestRouter(
          [
            {
              path: "/",
              Component() {
                return (
                  <div>
                    <Link
                      to="/a"
                      unstable_viewTransition={({ pathname }) =>
                        pathname === "/b"
                      }
                    >
                      /a
                    </Link>
                    <Link
                      to="/b"
                      unstable_viewTransition={({ pathname }) =>
                        pathname === "/b"
                      }
                    >
                      /b
                    </Link>
                    <Form
                      action="/c"
                      unstable_viewTransition={({ pathname }) =>
                        pathname === "/d"
                      }
                    >
                      <button type="submit">/c</button>
                    </Form>
                    <Form
                      action="/d"
                      unstable_viewTransition={({ pathname }) =>
                        pathname === "/d"
                      }
                    >
                      <button type="submit">/d</button>
                    </Form>
                    <Outlet />
                  </div>
                );
              },
              children: [
                {
                  index: true,
                  Component: () => <h1>Home</h1>,
                },
                {
                  path: "a",
                  Component: () => <h1>A</h1>,
                },
                {
                  path: "b",
                  Component: () => <h1>B</h1>,
                },
                {
                  path: "c",
                  action: () => null,
                  Component: () => <h1>C</h1>,
                },
                {
                  path: "d",
                  action: () => null,
                  Component: () => <h1>D</h1>,
                },
              ],
            },
          ],
          { window: testWindow }
        );
        render(<RouterProvider router={router} />);

        expect(screen.getByText("Home")).toBeDefined();
        fireEvent.click(screen.getByText("/a"));
        await waitFor(() => screen.getByText("A"));
        expect(spy).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText("/b"));
        await waitFor(() => screen.getByText("B"));
        expect(spy).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText("/c"));
        await waitFor(() => screen.getByText("C"));
        expect(spy).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText("/d"));
        await waitFor(() => screen.getByText("D"));
        expect(spy).toHaveBeenCalledTimes(2);
      });
    });
  });
}

function getWindowImpl(initialUrl: string, isHash = false): Window {
  // Need to use our own custom DOM in order to get a working history
  const dom = new JSDOM(`<!DOCTYPE html>`, { url: "http://localhost/" });
  dom.window.history.replaceState(null, "", (isHash ? "#" : "") + initialUrl);
  return dom.window as unknown as Window;
}
