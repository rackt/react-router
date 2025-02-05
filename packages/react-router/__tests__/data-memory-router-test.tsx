import type { ErrorResponse } from "@remix-run/router";
import "@testing-library/jest-dom";
import {
  fireEvent,
  queryByText,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import {
  Await,
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
  createRoutesFromElements,
  defer,
  redirect,
  useActionData,
  useAsyncError,
  useAsyncValue,
  useLoaderData,
  useLocation,
  useMatches,
  useNavigation,
  useRouteError,
  useRouteLoaderData,
} from "react-router";

import urlDataStrategy from "../../router/__tests__/utils/urlDataStrategy";
import { createDeferred } from "../../router/__tests__/utils/utils";
import MemoryNavigate from "./utils/MemoryNavigate";
import getHtml from "./utils/getHtml";

describe("createMemoryRouter", () => {
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it("renders the first route that matches the URL (element)", () => {
    let router = createMemoryRouter(
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

  it("renders the first route that matches the URL (Component)", () => {
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" Component={() => <h1>Home</h1>} />
      )
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

  it("supports a `routes` prop instead of <Route /> children", () => {
    let router = createMemoryRouter([
      {
        path: "/",
        element: <h1>Home</h1>,
      },
    ]);
    let { container } = render(<RouterProvider router={router} />);

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home
        </h1>
      </div>"
    `);
  });

  it("renders the first route that matches the URL when wrapped in a root route", () => {
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/my/base/path">
          <Route path="thing" element={<h1>Heyooo</h1>} />
        </Route>
      ),
      {
        initialEntries: ["/my/base/path/thing"],
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
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="thing" element={<h1>Heyooo</h1>} />
      ),
      {
        basename: "/my/base/path",
        initialEntries: ["/my/base/path/thing"],
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

  it("prepends basename to loader/action redirects", async () => {
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Root />}>
          <Route path="thing" loader={() => redirect("/other")} />
          <Route path="other" element={<h1>Other</h1>} />
        </Route>
      ),
      {
        basename: "/my/base/path",
        initialEntries: ["/my/base/path"],
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    function Root() {
      return (
        <>
          <MemoryNavigate to="/thing">Link to thing</MemoryNavigate>
          <Outlet />
        </>
      );
    }

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <a
          href="/my/base/path/thing"
        >
          Link to thing
        </a>
      </div>"
    `);

    fireEvent.click(screen.getByText("Link to thing"));
    await waitFor(() => screen.getByText("Other"));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <a
          href="/my/base/path/thing"
        >
          Link to thing
        </a>
        <h1>
          Other
        </h1>
      </div>"
    `);
  });

  it("supports relative routing in loader/action redirects", async () => {
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Root />}>
          <Route path="parent" element={<Parent />}>
            <Route path="child" loader={() => redirect("../other")} />
            <Route path="other" element={<h2>Other</h2>} />
          </Route>
        </Route>
      ),
      {
        basename: "/my/base/path",
        initialEntries: ["/my/base/path"],
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    function Root() {
      return (
        <>
          <MemoryNavigate to="/parent/child">Link to child</MemoryNavigate>
          <Outlet />
        </>
      );
    }

    function Parent() {
      return (
        <>
          <h1>Parent</h1>
          <Outlet />
        </>
      );
    }

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <a
          href="/my/base/path/parent/child"
        >
          Link to child
        </a>
      </div>"
    `);

    fireEvent.click(screen.getByText("Link to child"));
    await waitFor(() => screen.getByText("Parent"));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <a
          href="/my/base/path/parent/child"
        >
          Link to child
        </a>
        <h1>
          Parent
        </h1>
        <h2>
          Other
        </h2>
      </div>"
    `);
  });

  it("renders with hydration data", async () => {
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Comp />}>
          <Route path="child" element={<Comp />} />
        </Route>
      ),
      {
        initialEntries: ["/child"],
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
      let data = useLoaderData() as { message: string };
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

  it("renders fallbackElement while first data fetch happens", async () => {
    let fooDefer = createDeferred();
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Outlet />}>
          <Route path="foo" loader={() => fooDefer.promise} element={<Foo />} />
          <Route path="bar" element={<Bar />} />
        </Route>
      ),
      {
        initialEntries: ["/foo"],
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
      return <h1>Foo:{data?.message}</h1>;
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

  it("renders a null fallbackElement if none is provided", async () => {
    let fooDefer = createDeferred();
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Outlet />}>
          <Route path="foo" loader={() => fooDefer.promise} element={<Foo />} />
          <Route path="bar" element={<Bar />} />
        </Route>
      ),
      {
        initialEntries: ["/foo"],
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    function Foo() {
      let data = useLoaderData() as { message: string };
      return <h1>Foo:{data?.message}</h1>;
    }

    function Bar() {
      return <h1>Bar Heading</h1>;
    }

    expect(getHtml(container)).toMatchInlineSnapshot(`"<div />"`);

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

  it("does not render fallbackElement if no data fetch is required", async () => {
    let fooDefer = createDeferred();

    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Outlet />}>
          <Route path="foo" loader={() => fooDefer.promise} element={<Foo />} />
          <Route path="bar" element={<Bar />} />
        </Route>
      ),
      {
        initialEntries: ["/bar"],
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
      return <h1>Foo:{data?.message}</h1>;
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
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Outlet />}>
          <Route path="foo" loader={() => fooDefer.promise} element={<Foo />} />
        </Route>
      ),
      { initialEntries: ["/foo"] }
    );
    let { container } = render(
      <RouterProvider router={router} fallbackElement={<FallbackElement />} />
    );

    function FallbackElement() {
      let location = useLocation();
      return (
        <>
          <p>Loading{location.pathname}</p>
        </>
      );
    }

    function Foo() {
      let data = useLoaderData() as { message: string };
      return <h1>Foo:{data?.message}</h1>;
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
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Layout />}>
          <Route path="foo" element={<Foo />} />
          <Route path="bar" element={<Bar />} />
        </Route>
      ),
      { initialEntries: ["/foo"] }
    );
    render(<RouterProvider router={router} />);

    function Layout() {
      return (
        <div>
          <MemoryNavigate to="/foo">Link to Foo</MemoryNavigate>
          <MemoryNavigate to="/bar">Link to Bar</MemoryNavigate>
          <Outlet />
        </div>
      );
    }

    function Foo() {
      return <h1>Foo Heading</h1>;
    }

    function Bar() {
      return <h1>Bar Heading</h1>;
    }

    expect(screen.getByText("Foo Heading")).toBeDefined();
    fireEvent.click(screen.getByText("Link to Bar"));
    await waitFor(() => screen.getByText("Bar Heading"));

    fireEvent.click(screen.getByText("Link to Foo"));
    await waitFor(() => screen.getByText("Foo Heading"));
  });

  it("executes route loaders on navigation", async () => {
    let barDefer = createDeferred();
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Layout />}>
          <Route path="foo" element={<Foo />} />
          <Route path="bar" loader={() => barDefer.promise} element={<Bar />} />
        </Route>
      ),
      { initialEntries: ["/foo"] }
    );
    let { container } = render(<RouterProvider router={router} />);

    function Layout() {
      let navigation = useNavigation();
      return (
        <div>
          <MemoryNavigate to="/bar">Link to Bar</MemoryNavigate>
          <p>{navigation.state}</p>
          <Outlet />
        </div>
      );
    }

    function Foo() {
      return <h1>Foo</h1>;
    }
    function Bar() {
      let data = useLoaderData() as { message: string };
      return <h1>{data?.message}</h1>;
    }

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          <a
            href="/bar"
          >
            Link to Bar
          </a>
          <p>
            idle
          </p>
          <h1>
            Foo
          </h1>
        </div>
      </div>"
    `);

    fireEvent.click(screen.getByText("Link to Bar"));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          <a
            href="/bar"
          >
            Link to Bar
          </a>
          <p>
            loading
          </p>
          <h1>
            Foo
          </h1>
        </div>
      </div>"
    `);

    barDefer.resolve({ message: "Bar Loader" });
    await waitFor(() => screen.getByText("idle"));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          <a
            href="/bar"
          >
            Link to Bar
          </a>
          <p>
            idle
          </p>
          <h1>
            Bar Loader
          </h1>
        </div>
      </div>"
    `);
  });

  it("executes route actions/loaders on submission navigations", async () => {
    let barDefer = createDeferred();
    let barActionDefer = createDeferred();
    let formData = new FormData();
    formData.append("test", "value");

    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Layout />}>
          <Route path="foo" element={<Foo />} />
          <Route
            path="bar"
            action={() => barActionDefer.promise}
            loader={() => barDefer.promise}
            element={<Bar />}
          />
        </Route>
      ),
      { initialEntries: ["/foo"] }
    );
    let { container } = render(<RouterProvider router={router} />);

    function Layout() {
      let navigation = useNavigation();
      return (
        <div>
          <MemoryNavigate to="/bar" formMethod="post" formData={formData}>
            Post to Bar
          </MemoryNavigate>
          <p>{navigation.state}</p>
          <Outlet />
        </div>
      );
    }

    function Foo() {
      return <h1>Foo</h1>;
    }
    function Bar() {
      let data = useLoaderData() as { message: string };
      let actionData = useActionData();
      return (
        <h1>
          <>{data}</>
          <>{actionData}</>
        </h1>
      );
    }

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          <form>
            Post to Bar
          </form>
          <p>
            idle
          </p>
          <h1>
            Foo
          </h1>
        </div>
      </div>"
    `);

    fireEvent.click(screen.getByText("Post to Bar"));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          <form>
            Post to Bar
          </form>
          <p>
            submitting
          </p>
          <h1>
            Foo
          </h1>
        </div>
      </div>"
    `);

    barActionDefer.resolve("Bar Action");
    await waitFor(() => screen.getByText("loading"));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          <form>
            Post to Bar
          </form>
          <p>
            loading
          </p>
          <h1>
            Foo
          </h1>
        </div>
      </div>"
    `);

    barDefer.resolve("Bar Loader");
    await waitFor(() => screen.getByText("idle"));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          <form>
            Post to Bar
          </form>
          <p>
            idle
          </p>
          <h1>
            Bar Loader
            Bar Action
          </h1>
        </div>
      </div>"
    `);
  });

  it("provides useMatches", async () => {
    let spy = jest.fn();

    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Layout />}>
          <Route
            path="foo"
            loader={async () => "FOO LOADER"}
            element={<Foo />}
          />
          <Route
            path="bar"
            loader={async () => "BAR LOADER"}
            element={<Bar />}
            handle={{ key: "value" }}
          />
        </Route>
      )
    );
    render(<RouterProvider router={router} />);

    function Layout() {
      spy("Layout", useMatches());
      return (
        <>
          <MemoryNavigate to="/bar">Link to Bar</MemoryNavigate>
          <Outlet />
        </>
      );
    }

    function Foo() {
      spy("Foo", useMatches());
      return <h1>Foo</h1>;
    }

    function Bar() {
      spy("Bar", useMatches());
      return <h1>Bar</h1>;
    }

    expect(spy).toHaveBeenCalledWith("Layout", [
      {
        data: undefined,
        handle: undefined,
        id: "0",
        params: {},
        pathname: "/",
      },
    ]);

    spy.mockClear();
    fireEvent.click(screen.getByText("Link to Bar"));
    expect(spy).toHaveBeenCalledWith("Layout", [
      {
        data: undefined,
        handle: undefined,
        id: "0",
        params: {},
        pathname: "/",
      },
    ]);

    spy.mockClear();
    await waitFor(() => screen.getByText("Bar"));
    expect(spy).toHaveBeenCalledWith("Layout", [
      {
        data: undefined,
        handle: undefined,
        id: "0",
        params: {},
        pathname: "/",
      },
      {
        data: "BAR LOADER",
        handle: {
          key: "value",
        },
        id: "0-1",
        params: {},
        pathname: "/bar",
      },
    ]);
  });

  it("provides useRouteLoaderData", async () => {
    let spy = jest.fn();

    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route id="layout" path="/" element={<Layout />}>
          <Route
            id="foo"
            path="foo"
            loader={async () => "FOO2"}
            element={<h2>Foo</h2>}
          />
          <Route id="bar" path="bar" element={<Outlet />}>
            <Route
              id="child"
              path="child"
              loader={async () => "CHILD"}
              element={<h2>Child</h2>}
            />
          </Route>
        </Route>
      ),
      {
        initialEntries: ["/foo"],
        hydrationData: {
          loaderData: {
            foo: "FOO",
          },
        },
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    function Layout() {
      spy({
        layout: useRouteLoaderData("layout"),
        foo: useRouteLoaderData("foo"),
        bar: useRouteLoaderData("bar"),
        child: useRouteLoaderData("child"),
      });
      return (
        <>
          <MemoryNavigate to="/bar/child">Link to Child</MemoryNavigate>
          <Outlet />
        </>
      );
    }

    expect(spy).toHaveBeenCalledWith({
      layout: undefined,
      foo: "FOO",
      bar: undefined,
      child: undefined,
    });
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <a
          href="/bar/child"
        >
          Link to Child
        </a>
        <h2>
          Foo
        </h2>
      </div>"
    `);

    spy.mockClear();
    fireEvent.click(screen.getByText("Link to Child"));
    await waitFor(() => screen.getByText("Child"));

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <a
          href="/bar/child"
        >
          Link to Child
        </a>
        <h2>
          Child
        </h2>
      </div>"
    `);
    expect(spy).toHaveBeenCalledWith({
      layout: undefined,
      foo: undefined,
      bar: undefined,
      child: "CHILD",
    });
  });

  it("renders descendent routes inside a data router", () => {
    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/deep">
          <Route path="path/*" element={<Child />} />
        </Route>
      ),
      {
        initialEntries: ["/deep/path/to/descendant/routes"],
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    function GrandChild() {
      return (
        <Routes>
          <Route path="descendant">
            <Route
              path="routes"
              element={<h1>👋 Hello from the other side!</h1>}
            />
          </Route>
        </Routes>
      );
    }

    function Child() {
      return (
        <Routes>
          <Route path="to/*" element={<GrandChild />} />
        </Routes>
      );
    }

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          👋 Hello from the other side!
        </h1>
      </div>"
    `);
  });

  it("renders <Routes> alongside a data router ErrorBoundary", () => {
    let router = createMemoryRouter(
      [
        {
          path: "*",
          Component() {
            return (
              <>
                <Outlet />
                <Routes>
                  <Route index element={<h1>Descendant</h1>} />
                </Routes>
              </>
            );
          },
          children: [
            {
              id: "index",
              index: true,
              Component: () => <h1>Child</h1>,
              ErrorBoundary() {
                return <p>{(useRouteError() as Error).message}</p>;
              },
            },
          ],
        },
      ],
      {
        initialEntries: ["/"],
        hydrationData: {
          errors: {
            index: new Error("Broken!"),
          },
        },
      }
    );
    let { container } = render(<RouterProvider router={router} />);

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <p>
          Broken!
        </p>
        <h1>
          Descendant
        </h1>
      </div>"
    `);
  });

  it("provides location and matches to actions/loaders", async () => {
    let rootLoaderSpy = jest.fn(() => "ROOT LOADER");
    let loaderSpy = jest.fn(() => "LOADER");
    let actionSpy = jest.fn(() => "ACTION");

    let router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/" element={<Layout />} loader={rootLoaderSpy}>
          <Route path="foo" element={<Foo />} />
          <Route
            path="bar"
            loader={loaderSpy}
            action={actionSpy}
            element={<Bar />}
          />
        </Route>
      ),
      { initialEntries: ["/foo"] }
    );

    render(<RouterProvider router={router} />);

    function Layout() {
      return (
        <>
          <MemoryNavigate to="/bar">Link to Bar</MemoryNavigate>
          <MemoryNavigate to="/bar" formMethod="post">
            Post to Bar
          </MemoryNavigate>
          <Outlet />
        </>
      );
    }

    function Foo() {
      return <h1>Foo</h1>;
    }

    function Bar() {
      return <h1>Bar</h1>;
    }

    expect(rootLoaderSpy).toHaveBeenCalledTimes(1);
    expect(loaderSpy).not.toHaveBeenCalled();
    expect(actionSpy).not.toHaveBeenCalled();

    await waitFor(() => screen.getByText("Link to Bar"));
    fireEvent.click(screen.getByText("Link to Bar"));
    await waitFor(() => screen.getByText("Bar"));

    expect(rootLoaderSpy).toHaveBeenCalledTimes(1);
    expect(rootLoaderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        location: expect.objectContaining({
          pathname: "/foo",
        }),
        matches: [
          expect.objectContaining({
            pathname: "/",
            route: expect.objectContaining({
              loader: rootLoaderSpy,
            }),
          }),
          expect.objectContaining({
            pathname: "/foo",
          }),
        ],
      })
    );
    expect(actionSpy).not.toHaveBeenCalled();
    expect(loaderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        location: expect.objectContaining({
          pathname: "/bar",
        }),
        matches: [
          expect.objectContaining({
            pathname: "/",
            route: expect.objectContaining({
              loader: rootLoaderSpy,
            }),
          }),
          expect.objectContaining({
            pathname: "/bar",
            route: expect.objectContaining({
              action: actionSpy,
              loader: loaderSpy,
            }),
          }),
        ],
      })
    );

    fireEvent.click(screen.getByText("Post to Bar"));
    waitFor(() => expect(actionSpy).toHaveBeenCalled());
    expect(rootLoaderSpy).toHaveBeenCalledTimes(2);
    expect(loaderSpy).toHaveBeenCalledTimes(2);
  });

  describe("errors", () => {
    it("renders hydration errors on leaf elements using errorElement", async () => {
      let router = createMemoryRouter(
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
          initialEntries: ["/child"],
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
        let data = useLoaderData() as { message: string };
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

    it("renders hydration errors on leaf elements using ErrorBoundary", async () => {
      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route path="/" element={<Comp />}>
            <Route
              path="child"
              element={<Comp />}
              ErrorBoundary={() => <p>{(useRouteError() as Error).message}</p>}
            />
          </Route>
        ),
        {
          initialEntries: ["/child"],
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
        let data = useLoaderData() as { message: string };
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
      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route path="/" element={<Comp />} errorElement={<ErrorBoundary />}>
            <Route path="child" element={<Comp />} />
          </Route>
        ),
        {
          initialEntries: ["/child"],
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
        let data = useLoaderData() as { message: string };
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

    it("renders navigation errors on leaf elements using errorElement", async () => {
      let fooDefer = createDeferred();
      let barDefer = createDeferred();

      let router = createMemoryRouter(
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
          initialEntries: ["/foo"],
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
            <MemoryNavigate to="/foo">Link to Foo</MemoryNavigate>
            <MemoryNavigate to="/bar">Link to Bar</MemoryNavigate>
            <p>{navigation.state}</p>
            <Outlet />
          </div>
        );
      }

      function Foo() {
        let data = useLoaderData() as { message: string };
        return <h1>Foo:{data?.message}</h1>;
      }
      function FooError() {
        let error = useRouteError() as Error;
        return <p>Foo Error:{error.message}</p>;
      }
      function Bar() {
        let data = useLoaderData() as { message: string };
        return <h1>Bar:{data?.message}</h1>;
      }
      function BarError() {
        let error = useRouteError() as Error;
        return <p>Bar Error:{error.message}</p>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/foo"
            >
              Link to Foo
            </a>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <h1>
              Foo:
              hydrated from foo
            </h1>
          </div>
        </div>"
      `);

      fireEvent.click(screen.getByText("Link to Bar"));
      barDefer.reject(new Error("Kaboom!"));
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/foo"
            >
              Link to Foo
            </a>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              Bar Error:
              Kaboom!
            </p>
          </div>
        </div>"
      `);

      fireEvent.click(screen.getByText("Link to Foo"));
      fooDefer.reject(new Error("Kaboom!"));
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/foo"
            >
              Link to Foo
            </a>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              Foo Error:
              Kaboom!
            </p>
          </div>
        </div>"
      `);
    });

    it("renders navigation errors on leaf elements using ErrorBoundary", async () => {
      let fooDefer = createDeferred();
      let barDefer = createDeferred();

      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route path="/" element={<Layout />}>
            <Route
              path="foo"
              loader={() => fooDefer.promise}
              element={<Foo />}
              ErrorBoundary={FooError}
            />
            <Route
              path="bar"
              loader={() => barDefer.promise}
              element={<Bar />}
              ErrorBoundary={BarError}
            />
          </Route>
        ),
        {
          initialEntries: ["/foo"],
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
            <MemoryNavigate to="/foo">Link to Foo</MemoryNavigate>
            <MemoryNavigate to="/bar">Link to Bar</MemoryNavigate>
            <p>{navigation.state}</p>
            <Outlet />
          </div>
        );
      }

      function Foo() {
        let data = useLoaderData() as { message: string };
        return <h1>Foo:{data?.message}</h1>;
      }
      function FooError() {
        let error = useRouteError() as Error;
        return <p>Foo Error:{error.message}</p>;
      }
      function Bar() {
        let data = useLoaderData() as { message: string };
        return <h1>Bar:{data?.message}</h1>;
      }
      function BarError() {
        let error = useRouteError() as Error;
        return <p>Bar Error:{error.message}</p>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/foo"
            >
              Link to Foo
            </a>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <h1>
              Foo:
              hydrated from foo
            </h1>
          </div>
        </div>"
      `);

      fireEvent.click(screen.getByText("Link to Bar"));
      barDefer.reject(new Error("Kaboom!"));
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/foo"
            >
              Link to Foo
            </a>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              Bar Error:
              Kaboom!
            </p>
          </div>
        </div>"
      `);

      fireEvent.click(screen.getByText("Link to Foo"));
      fooDefer.reject(new Error("Kaboom!"));
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/foo"
            >
              Link to Foo
            </a>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              Foo Error:
              Kaboom!
            </p>
          </div>
        </div>"
      `);
    });

    it("renders navigation errors on parent elements", async () => {
      let fooDefer = createDeferred();
      let barDefer = createDeferred();

      let router = createMemoryRouter(
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
          initialEntries: ["/foo"],
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
            <MemoryNavigate to="/foo">Link to Foo</MemoryNavigate>
            <MemoryNavigate to="/bar">Link to Bar</MemoryNavigate>
            <p>{navigation.state}</p>
            <Outlet />
          </div>
        );
      }
      function LayoutError() {
        let error = useRouteError() as Error;
        return <p>Layout Error:{error.message}</p>;
      }
      function Foo() {
        let data = useLoaderData() as { message: string };
        return <h1>Foo:{data?.message}</h1>;
      }
      function FooError() {
        let error = useRouteError() as Error;
        return <p>Foo Error:{error.message}</p>;
      }
      function Bar() {
        let data = useLoaderData() as { message: string };
        return <h1>Bar:{data?.message}</h1>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/foo"
            >
              Link to Foo
            </a>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <h1>
              Foo:
              hydrated from foo
            </h1>
          </div>
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

    it("renders 404 errors using path='/' error boundary", async () => {
      let router = createMemoryRouter(
        createRoutesFromElements(
          <>
            <Route
              path="/thing"
              element={<h1>Thing 1</h1>}
              errorElement={<p>Not I!</p>}
            />
            <Route
              path="/"
              element={
                <div>
                  <h1>Hello</h1>
                  <Outlet />
                </div>
              }
              errorElement={<Boundary />}
            />
          </>
        ),
        {
          initialEntries: ["/foo"],
          hydrationData: {
            loaderData: {
              "0": {
                message: "hydrated from foo",
              },
            },
          },
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Boundary() {
        let error = useRouteError() as ErrorResponse;
        return (
          <p>
            Error:
            <>{error.status}</>
            <>{error.statusText}</>
          </p>
        );
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Error:
            404
            Not Found
          </p>
        </div>"
      `);
    });

    it("renders 404 errors using index error boundary", async () => {
      let router = createMemoryRouter(
        createRoutesFromElements(
          <>
            <Route
              path="/thing"
              element={<h1>Thing 1</h1>}
              errorElement={<p>Not I!</p>}
            />
            <Route
              index
              element={
                <div>
                  <h1>Hello</h1>
                  <Outlet />
                </div>
              }
              errorElement={<Boundary />}
            />
          </>
        ),
        {
          initialEntries: ["/foo"],
          hydrationData: {
            loaderData: {
              "0": {
                message: "hydrated from foo",
              },
            },
          },
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Boundary() {
        let error = useRouteError() as ErrorResponse;
        return (
          <p>
            Error:
            <>{error.status}</>
            <>{error.statusText}</>
          </p>
        );
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Error:
            404
            Not Found
          </p>
        </div>"
      `);
    });

    it("renders 404 errors using fallback boundary if no root layout route exists", async () => {
      let router = createMemoryRouter(
        createRoutesFromElements(
          <>
            <Route
              path="/thing1"
              element={<h1>Thing 1</h1>}
              errorElement={<p>Not I!</p>}
            />
            <Route
              path="/thing2"
              element={<h1>Thing 2</h1>}
              errorElement={<p>Not I!</p>}
            />
          </>
        ),
        {
          initialEntries: ["/foo"],
          hydrationData: {
            loaderData: {
              "0": {
                message: "hydrated from foo",
              },
            },
          },
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      let html = getHtml(container);
      expect(html).toMatch("Unexpected Application Error!");
      expect(html).toMatch("404 Not Found");
      expect(html).toMatch("💿 Hey developer 👋");
      expect(html).not.toMatch(/stack/i);
    });

    it("renders navigation errors with a default if no errorElements are provided", async () => {
      let fooDefer = createDeferred();
      let barDefer = createDeferred();

      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route path="/" element={<Layout />}>
            <Route
              path="foo"
              loader={() => fooDefer.promise}
              element={<Foo />}
            />
            <Route
              path="bar"
              loader={() => barDefer.promise}
              element={<Bar />}
            />
          </Route>
        ),
        {
          initialEntries: ["/foo"],
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
            <MemoryNavigate to="/foo">Link to Foo</MemoryNavigate>
            <MemoryNavigate to="/bar">Link to Bar</MemoryNavigate>
            <p>{navigation.state}</p>
            <Outlet />
          </div>
        );
      }
      function Foo() {
        let data = useLoaderData() as { message: string };
        return <h1>Foo:{data?.message}</h1>;
      }
      function Bar() {
        let data = useLoaderData() as { message: string };
        return <h1>Bar:{data?.message}</h1>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/foo"
            >
              Link to Foo
            </a>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <h1>
              Foo:
              hydrated from foo
            </h1>
          </div>
        </div>"
      `);

      fireEvent.click(screen.getByText("Link to Bar"));
      let error = new Error("Kaboom!");
      error.stack = "FAKE STACK TRACE";
      barDefer.reject(error);
      await waitFor(() => screen.getByText("Kaboom!"));
      let html = getHtml(container);
      expect(html).toMatch("Unexpected Application Error!");
      expect(html).toMatch("Kaboom!");
      expect(html).toMatch("FAKE STACK TRACE");
      expect(html).toMatch("💿 Hey developer 👋");
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

      let router = createMemoryRouter(routes, { initialEntries: ["/foo"] });
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigation = useNavigation();
        return (
          <div>
            <MemoryNavigate to="/bar">Link to Bar</MemoryNavigate>
            <p>{navigation.state}</p>
            <Outlet />
          </div>
        );
      }
      function Bar() {
        let data = useLoaderData() as { message: string };
        return <h1>Bar:{data?.message}</h1>;
      }
      function BarError() {
        let error = useRouteError() as Error;
        return <p>Bar Error:{error.message}</p>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <h1>
              Foo
            </h1>
          </div>
        </div>"
      `);

      fireEvent.click(screen.getByText("Link to Bar"));
      barDefer.reject(new Error("Kaboom!"));
      await waitFor(() => screen.getByText("Bar Error:Kaboom!"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              Bar Error:
              Kaboom!
            </p>
          </div>
        </div>"
      `);
    });

    it("handles render errors in parent errorElement", async () => {
      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route
            path="/"
            element={
              <div>
                <h1>This should not show</h1>
                <Outlet />
              </div>
            }
            errorElement={<ErrorBoundary />}
          >
            <Route path="child" element={<ChildComp />} />
          </Route>
        ),
        { initialEntries: ["/child"] }
      );
      let { container } = render(<RouterProvider router={router} />);

      function ChildComp(): React.ReactElement {
        throw new Error("Kaboom!");
      }

      function ErrorBoundary() {
        let error = useRouteError() as Error;
        return <p>{error.message}</p>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Kaboom!
          </p>
        </div>"
      `);
    });

    it("handles render errors in child errorElement", async () => {
      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route
            path="/"
            element={
              <div>
                <h1>Parent</h1>
                <Outlet />
              </div>
            }
            errorElement={<p>Don't show this</p>}
          >
            <Route
              path="child"
              element={<ChildComp />}
              errorElement={<ErrorBoundary />}
            />
          </Route>
        ),
        { initialEntries: ["/child"] }
      );
      let { container } = render(<RouterProvider router={router} />);

      function ChildComp(): React.ReactElement {
        throw new Error("Kaboom!");
      }

      function ErrorBoundary() {
        let error = useRouteError() as Error;
        return <p>{error.message}</p>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <h1>
              Parent
            </h1>
            <p>
              Kaboom!
            </p>
          </div>
        </div>"
      `);
    });

    it("handles render errors in default errorElement", async () => {
      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route
            path="/"
            element={
              <div>
                <h1>Parent</h1>
                <Outlet />
              </div>
            }
          >
            <Route path="child" element={<ChildComp />} />
          </Route>
        ),
        { initialEntries: ["/child"] }
      );
      let { container } = render(<RouterProvider router={router} />);

      function ChildComp(): React.ReactElement {
        let error = new Error("Kaboom!");
        error.stack = "FAKE STACK TRACE";
        throw error;
      }

      let html = getHtml(container);
      expect(html).toMatch("Unexpected Application Error!");
      expect(html).toMatch("Kaboom!");
      expect(html).toMatch("FAKE STACK TRACE");
      expect(html).toMatch("💿 Hey developer 👋");
    });

    it("does not handle render errors for non-data routers", async () => {
      expect(() =>
        render(
          <MemoryRouter initialEntries={["/child"]}>
            <Routes>
              <Route
                path="/"
                element={
                  <div>
                    <h1>Parent</h1>
                    <Outlet />
                  </div>
                }
              >
                <Route path="child" element={<ChildComp />} />
              </Route>
            </Routes>
          </MemoryRouter>
        )
      ).toThrowErrorMatchingInlineSnapshot(`"Kaboom!"`);

      function ChildComp(): React.ReactElement {
        throw new Error("Kaboom!");
      }
    });

    it("handles a `null` render-error", async () => {
      let router = createMemoryRouter([
        {
          path: "/",
          Component() {
            // eslint-disable-next-line no-throw-literal
            throw null;
          },
          ErrorBoundary() {
            return <pre>{useRouteError() === null ? "Yes" : "No"}</pre>;
          },
        },
      ]);
      let { container } = render(<RouterProvider router={router} />);

      await waitFor(() => screen.getByText("Yes"));
      expect(getHtml(container)).toMatch("Yes");
    });

    it("handles a `null` render-error from a defer() call", async () => {
      let router = createMemoryRouter([
        {
          path: "/",
          loader() {
            return defer({ lazy: Promise.reject(null) });
          },
          Component() {
            let data = useLoaderData() as { lazy: Promise<unknown> };
            return (
              <React.Suspense>
                <Await resolve={data.lazy}>No</Await>
              </React.Suspense>
            );
          },
          ErrorBoundary() {
            return <pre>{useRouteError() === null ? "Yes" : "No"}</pre>;
          },
        },
      ]);
      let { container } = render(<RouterProvider router={router} />);

      await waitFor(() => screen.getByText("Yes"));
      expect(getHtml(container)).toMatch("Yes");
    });

    it("handles back button routing away from a child error boundary", async () => {
      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route
            path="/"
            element={<Parent />}
            errorElement={<p>Don't show this</p>}
          >
            <Route
              path="child"
              element={<Child />}
              errorElement={<ErrorBoundary />}
            />
          </Route>
        )
      );

      let { container } = render(
        <div>
          <RouterProvider router={router} />
        </div>
      );

      function Parent() {
        return (
          <>
            <h1>Parent</h1>
            <Outlet />
          </>
        );
      }
      function Child(): React.ReactElement {
        throw new Error("Kaboom!");
      }

      function ErrorBoundary() {
        let error = useRouteError() as Error;
        return <p>{error.message}</p>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <h1>
              Parent
            </h1>
          </div>
        </div>"
      `);

      router.navigate("/child");
      await waitFor(() => screen.getByText("Kaboom!"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <h1>
              Parent
            </h1>
            <p>
              Kaboom!
            </p>
          </div>
        </div>"
      `);

      router.navigate(-1);
      await waitFor(() => {
        expect(queryByText(container, "Kaboom!")).not.toBeInTheDocument();
      });
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <h1>
              Parent
            </h1>
          </div>
        </div>"
      `);
    });

    it("handles back button routing away from a default error boundary", async () => {
      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route path="/" element={<Parent />}>
            <Route path="child" element={<Child />} />
          </Route>
        )
      );
      let { container } = render(
        <div>
          <RouterProvider router={router} />
        </div>
      );

      function Parent() {
        return (
          <>
            <h1>Parent</h1>
            <Outlet />
          </>
        );
      }

      function Child(): React.ReactElement {
        let error = new Error("Kaboom!");
        error.stack = "FAKE STACK TRACE";
        throw error;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <h1>
              Parent
            </h1>
          </div>
        </div>"
      `);

      router.navigate("/child");
      await waitFor(() => screen.getByText("Kaboom!"));
      let html = getHtml(container);
      expect(html).toMatch("Unexpected Application Error!");
      expect(html).toMatch("Kaboom!");
      expect(html).toMatch("FAKE STACK TRACE");
      expect(html).toMatch("💿 Hey developer 👋");

      router.navigate(-1);
      await waitFor(() => {
        expect(queryByText(container, "Kaboom!")).not.toBeInTheDocument();
      });
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <h1>
              Parent
            </h1>
          </div>
        </div>"
      `);
    });

    it("does not allow loaderData usage in self-caught error boundaries", async () => {
      let errorSpy = jest.spyOn(console, "error");

      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route path="/" element={<Layout />}>
            <Route
              path="foo"
              loader={() => Promise.reject(new Error("Kaboom!"))}
              element={<h1>Foo</h1>}
              errorElement={<FooError />}
            />
          </Route>
        )
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigation = useNavigation();
        return (
          <div>
            <MemoryNavigate to="/foo">Link to Foo</MemoryNavigate>
            <p>{navigation.state}</p>
            <Outlet />
          </div>
        );
      }

      function FooError() {
        let error = useRouteError() as Error;
        let data = useLoaderData() as { message: string };
        return (
          <>
            <p>
              Foo Data:{data === undefined ? "undefined" : JSON.stringify(data)}
            </p>
            <p>Foo Error:{error.message}</p>
          </>
        );
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/foo"
            >
              Link to Foo
            </a>
            <p>
              idle
            </p>
          </div>
        </div>"
      `);

      fireEvent.click(screen.getByText("Link to Foo"));
      await waitFor(() => screen.getByText("Foo Error:Kaboom!"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/foo"
            >
              Link to Foo
            </a>
            <p>
              idle
            </p>
            <p>
              Foo Data:
              undefined
            </p>
            <p>
              Foo Error:
              Kaboom!
            </p>
          </div>
        </div>"
      `);

      expect(errorSpy).toHaveBeenCalledWith(
        "You cannot `useLoaderData` in an errorElement (routeId: 0-0)"
      );
      errorSpy.mockRestore();
    });

    it("does not allow useLoaderData usage in bubbled error boundaries", async () => {
      let errorSpy = jest.spyOn(console, "error");

      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route
            path="/"
            element={<Layout />}
            loader={() => "ROOT"}
            errorElement={<LayoutError />}
          >
            <Route
              path="foo"
              loader={() => Promise.reject(new Error("Kaboom!"))}
              element={<h1>Foo</h1>}
            />
          </Route>
        ),
        {
          hydrationData: {
            loaderData: {
              "0": "ROOT",
            },
          },
        }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigation = useNavigation();
        return (
          <div>
            <MemoryNavigate to="/foo">Link to Foo</MemoryNavigate>
            <p>{navigation.state}</p>
            <Outlet />
          </div>
        );
      }
      function LayoutError() {
        let data = useLoaderData() as { message: string };
        let error = useRouteError() as Error;
        return (
          <>
            <p>
              Layout Data:
              {data === undefined ? "undefined" : JSON.stringify(data)}
            </p>
            <p>Layout Error:{error.message}</p>
          </>
        );
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/foo"
            >
              Link to Foo
            </a>
            <p>
              idle
            </p>
          </div>
        </div>"
      `);

      fireEvent.click(screen.getByText("Link to Foo"));
      await waitFor(() => screen.getByText("Layout Error:Kaboom!"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Layout Data:
            undefined
          </p>
          <p>
            Layout Error:
            Kaboom!
          </p>
        </div>"
      `);

      expect(errorSpy).toHaveBeenCalledWith(
        "You cannot `useLoaderData` in an errorElement (routeId: 0)"
      );
      errorSpy.mockRestore();
    });
  });

  describe("defer", () => {
    function setupDeferredTest({
      useRenderProp = false,
      hasRouteErrorElement = false,
      hasAwaitErrorElement = false,
      triggerRenderError = false,
      triggerFallbackError = false,
    } = {}) {
      let awaitRenderCount = 0;
      let barDefer = createDeferred();
      let bazDefer = createDeferred();

      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route path="/" element={<Layout />}>
            <Route path="foo" element={<h1>Foo</h1>} />
            <Route
              path="bar"
              loader={() => barDefer.promise}
              element={<Bar />}
              errorElement={hasRouteErrorElement ? <RouteError /> : null}
            />
            <Route
              path="baz"
              loader={() => bazDefer.promise}
              element={<h1>Baz</h1>}
            />
          </Route>
        ),
        { initialEntries: ["/foo"] }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigation = useNavigation();
        return (
          <>
            <MemoryNavigate to="/bar">Link to Bar</MemoryNavigate>
            <MemoryNavigate to="/baz">Link to Baz</MemoryNavigate>
            <div id="content">
              <p>{navigation.state}</p>
              <Outlet />
            </div>
          </>
        );
      }

      function Bar() {
        let data = useLoaderData() as { critical: string };
        return (
          <>
            <p>{data.critical}</p>
            <React.Suspense fallback={<LazyFallback />}>
              <AwaitCounter data={data} />
            </React.Suspense>
          </>
        );
      }

      function AwaitCounter({ data }) {
        awaitRenderCount++;
        return (
          <>
            <Await
              resolve={data.lazy}
              errorElement={hasAwaitErrorElement ? <LazyError /> : null}
            >
              {useRenderProp ? (value) => <p>{value}</p> : <LazyData />}
            </Await>
          </>
        );
      }

      function RouteError() {
        let error = useRouteError() as Error;
        return <p>Route Error:{error.message}</p>;
      }

      function LazyFallback() {
        return triggerFallbackError ? (
          // @ts-expect-error
          <p>{oops.i.did.it}</p>
        ) : (
          <p>Loading...</p>
        );
      }

      function LazyData() {
        let data = useAsyncValue() as string;
        return triggerRenderError ? (
          // @ts-expect-error
          <p>{oops.i.did.it.again}</p>
        ) : (
          <p>{data}</p>
        );
      }

      function LazyError() {
        let data = useAsyncError() as Error;
        return <p>Await Error:{data.message}</p>;
      }

      return {
        container: container.querySelector("#content") as HTMLElement,
        barDefer,
        bazDefer,
        getAwaitRenderCount() {
          return awaitRenderCount;
        },
      };
    }

    it("allows loaders to returned deferred data (child component)", async () => {
      let { barDefer, container } = setupDeferredTest();
      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            loading
          </p>
          <h1>
            Foo
          </h1>
        </div>"
      `);

      let barValueDfd = createDeferred();
      barDefer.resolve(
        defer({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            Loading...
          </p>
        </div>"
      `);

      barValueDfd.resolve("LAZY");
      await waitFor(() => screen.getByText("LAZY"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            LAZY
          </p>
        </div>"
      `);
    });

    it("allows loaders to returned deferred data (render prop)", async () => {
      let { barDefer, container } = setupDeferredTest({ useRenderProp: true });

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            loading
          </p>
          <h1>
            Foo
          </h1>
        </div>"
      `);

      let barValueDfd = createDeferred();
      barDefer.resolve(
        defer({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            Loading...
          </p>
        </div>"
      `);

      barValueDfd.resolve("LAZY");
      await waitFor(() => screen.getByText("LAZY"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            LAZY
          </p>
        </div>"
      `);
    });

    it("sends data errors to the provided errorElement", async () => {
      let { barDefer, container } = setupDeferredTest({
        hasRouteErrorElement: true,
        hasAwaitErrorElement: true,
      });

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            loading
          </p>
          <h1>
            Foo
          </h1>
        </div>"
      `);

      let barValueDfd = createDeferred();
      barDefer.resolve(
        defer({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            Loading...
          </p>
        </div>"
      `);

      barValueDfd.reject(new Error("Kaboom!"));
      await waitFor(() => screen.getByText(/Kaboom!/));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            Await Error:
            Kaboom!
          </p>
        </div>"
      `);
    });

    it("sends unhandled data errors to the nearest route error boundary", async () => {
      let { barDefer, container } = setupDeferredTest({
        hasRouteErrorElement: true,
        hasAwaitErrorElement: false,
      });

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            loading
          </p>
          <h1>
            Foo
          </h1>
        </div>"
      `);

      let barValueDfd = createDeferred();
      barDefer.resolve(
        defer({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            Loading...
          </p>
        </div>"
      `);

      barValueDfd.reject(new Error("Kaboom!"));
      await waitFor(() => screen.getByText(/Kaboom!/));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            Route Error:
            Kaboom!
          </p>
        </div>"
      `);
    });

    it("sends render errors to the provided errorElement", async () => {
      let { barDefer, container } = setupDeferredTest({
        hasRouteErrorElement: true,
        hasAwaitErrorElement: true,
        triggerRenderError: true,
      });

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            loading
          </p>
          <h1>
            Foo
          </h1>
        </div>"
      `);

      let barValueDfd = createDeferred();
      barDefer.resolve(
        defer({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            Loading...
          </p>
        </div>"
      `);

      barValueDfd.resolve("LAZY");
      await waitFor(() => screen.getByText(/oops is not defined/));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            Await Error:
            oops is not defined
          </p>
        </div>"
      `);
    });

    it("sends unhandled render errors to the nearest route error boundary", async () => {
      let { barDefer, container } = setupDeferredTest({
        hasRouteErrorElement: true,
        hasAwaitErrorElement: false,
        triggerRenderError: true,
      });

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            loading
          </p>
          <h1>
            Foo
          </h1>
        </div>"
      `);

      let barValueDfd = createDeferred();
      barDefer.resolve(
        defer({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            Loading...
          </p>
        </div>"
      `);

      barValueDfd.resolve("LAZY");
      await waitFor(() => screen.getByText(/oops is not defined/));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            Route Error:
            oops is not defined
          </p>
        </div>"
      `);
    });

    it("does not handle fallback render errors in the Deferred errorElement", async () => {
      let { barDefer, container } = setupDeferredTest({
        hasRouteErrorElement: true,
        hasAwaitErrorElement: true,
        triggerRenderError: true,
        triggerFallbackError: true,
      });

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            loading
          </p>
          <h1>
            Foo
          </h1>
        </div>"
      `);

      let barValueDfd = createDeferred();
      barDefer.resolve(
        defer({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            Route Error:
            oops is not defined
          </p>
        </div>"
      `);

      // Resolving doesn't do anything
      barValueDfd.resolve("LAZY");
      await new Promise((r) => setTimeout(r, 1));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            Route Error:
            oops is not defined
          </p>
        </div>"
      `);
    });

    it("freezes the UI for aborted deferreds", async () => {
      let { barDefer, bazDefer, container, getAwaitRenderCount } =
        setupDeferredTest();
      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            loading
          </p>
          <h1>
            Foo
          </h1>
        </div>"
      `);
      expect(getAwaitRenderCount()).toBe(0);

      let barValueDfd = createDeferred();
      barDefer.resolve(
        defer({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            Loading...
          </p>
        </div>"
      `);
      expect(getAwaitRenderCount()).toBe(1);

      // Abort the deferred by navigating to /baz
      fireEvent.click(screen.getByText("Link to Baz"));
      await new Promise((r) => setTimeout(r, 50));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            loading
          </p>
          <p>
            CRITICAL
          </p>
          <p>
            Loading...
          </p>
        </div>"
      `);
      // 2 more renders by now - once for the navigation and once for the
      // promise abort rejection
      expect(getAwaitRenderCount()).toBe(3);

      // complete /baz navigation
      bazDefer.resolve(null);
      await waitFor(() => screen.getByText("Baz"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <h1>
            Baz
          </h1>
        </div>"
      `);

      // Does nothing now
      barValueDfd.resolve("LAZY");
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div
          id="content"
        >
          <p>
            idle
          </p>
          <h1>
            Baz
          </h1>
        </div>"
      `);
      expect(getAwaitRenderCount()).toBe(3);
    });

    it("should permit direct access to resolved values", async () => {
      let barDefer = createDeferred();

      let router = createMemoryRouter(
        createRoutesFromElements(
          <>
            <Route
              path="foo"
              element={
                <>
                  <h1>Foo</h1>
                  <MemoryNavigate to="/bar">Link to bar</MemoryNavigate>
                </>
              }
            />
            <Route
              path="bar"
              loader={() => barDefer.promise}
              element={<Bar />}
            />
          </>
        ),
        { initialEntries: ["/foo"] }
      );
      let { container } = render(<RouterProvider router={router} />);

      let count = 0;
      function Bar() {
        let { bar } = useLoaderData() as { bar: Promise<string> };

        React.useEffect(() => {
          bar.then((data) => {
            container.querySelector("#content")!.innerHTML =
              data + " " + ++count;
          });
        }, [bar]);

        return <div id="content">Waiting for data...</div>;
      }

      fireEvent.click(screen.getByText("Link to bar"));
      let barValueDefer = createDeferred();
      await barDefer.resolve({ bar: barValueDefer.promise });
      await waitFor(() => screen.getByText("Waiting for data..."));

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div
            id="content"
          >
            Waiting for data...
          </div>
        </div>"
      `);

      await barValueDefer.resolve("BAR");

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div
            id="content"
          >
            BAR 1
          </div>
        </div>"
      `);
    });

    it("can render raw resolved to undefined promises with <Await>", async () => {
      let dfd = createDeferred();

      let { container } = render(
        <React.Suspense fallback={<p>Loading...</p>}>
          <Await resolve={dfd.promise}>{(data) => <p>{String(data)}</p>}</Await>
        </React.Suspense>
      );

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Loading...
          </p>
        </div>"
      `);

      dfd.resolve(undefined);
      await waitFor(() => screen.getByText("undefined"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            undefined
          </p>
        </div>"
      `);
    });

    it("can render raw resolved promises with <Await>", async () => {
      let dfd = createDeferred();

      let { container } = render(
        <React.Suspense fallback={<p>Loading...</p>}>
          <Await resolve={dfd.promise}>{(data) => <p>{data}</p>}</Await>
        </React.Suspense>
      );

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Loading...
          </p>
        </div>"
      `);

      dfd.resolve("RESOLVED");
      await waitFor(() => screen.getByText("RESOLVED"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            RESOLVED
          </p>
        </div>"
      `);
    });

    it("can render raw rejected promises with <Await>", async () => {
      let dfd = createDeferred();

      let { container } = render(
        <React.Suspense fallback={<p>Loading...</p>}>
          <Await resolve={dfd.promise} errorElement={<ErrorElement />}>
            {(data) => <p>{data}</p>}
          </Await>
        </React.Suspense>
      );

      function ErrorElement() {
        let error = useAsyncError() as Error;
        return <p>Error:{error.message}</p>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Loading...
          </p>
        </div>"
      `);

      await dfd.reject(new Error("REJECTED"));
      await waitFor(() => screen.getByText("Error:REJECTED"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            Error:
            REJECTED
          </p>
        </div>"
      `);
    });

    it("can render raw values with <Await>", async () => {
      let { container } = render(
        <Await resolve={"VALUE"}>{(data) => <p>{data}</p>}</Await>
      );

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <p>
            VALUE
          </p>
        </div>"
      `);
    });
  });

  describe("router dataStrategy", () => {
    it("executes route loaders on navigation", async () => {
      let barDefer = createDeferred();
      let router = createMemoryRouter(
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
        { initialEntries: ["/foo"], dataStrategy: urlDataStrategy }
      );
      let { container } = render(<RouterProvider router={router} />);

      function Layout() {
        let navigation = useNavigation();
        return (
          <div>
            <MemoryNavigate to="/bar">Link to Bar</MemoryNavigate>
            <p>{navigation.state}</p>
            <Outlet />
          </div>
        );
      }

      function Foo() {
        return <h1>Foo</h1>;
      }
      function Bar() {
        let data = useLoaderData() as URLSearchParams;
        return <h1>{data?.get("message")}</h1>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <h1>
              Foo
            </h1>
          </div>
        </div>"
      `);

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              loading
            </p>
            <h1>
              Foo
            </h1>
          </div>
        </div>"
      `);

      // barDefer.resolve({ message: "Bar Loader" });
      barDefer.resolve(
        new Response(
          new URLSearchParams([["message", "Bar Loader"]]).toString(),
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
          }
        )
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href="/bar"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <h1>
              Bar Loader
            </h1>
          </div>
        </div>"
      `);
    });
  });
});
