import * as React from "react";
import {
  render,
  fireEvent,
  waitFor,
  screen,
  prettyDOM,
  queryByText,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import type { FormMethod, Router } from "@remix-run/router";
import { createMemoryRouter } from "@remix-run/router";

import type { DataMemoryRouterProps } from "react-router";
import {
  DataMemoryRouter,
  Deferred,
  Route,
  Outlet,
  deferred,
  useActionData,
  useDeferredData,
  useLoaderData,
  useMatches,
  useRouteLoaderData,
  useRouteError,
  useNavigation,
  useRenderDataRouter,
  useRevalidator,
  UNSAFE_DataRouterContext,
  MemoryRouter,
  Routes,
} from "react-router";

// Private API
import { _resetModuleScope } from "../lib/components";

describe("<DataMemoryRouter>", () => {
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    _resetModuleScope();
  });

  it("renders the first route that matches the URL", () => {
    let { container } = render(
      <DataMemoryRouter initialEntries={["/"]} hydrationData={{}}>
        <Route path="/" element={<h1>Home</h1>} />
      </DataMemoryRouter>
    );

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home
        </h1>
      </div>"
    `);
  });

  it("supports a `routes` prop instead of <Route /> children", () => {
    let routes = [
      {
        path: "/",
        element: <h1>Home</h1>,
      },
    ];
    let { container } = render(
      <DataMemoryRouter
        initialEntries={["/"]}
        hydrationData={{}}
        routes={routes}
      />
    );

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Home
        </h1>
      </div>"
    `);
  });

  it("renders the first route that matches the URL when wrapped in a root route", () => {
    let { container } = render(
      <DataMemoryRouter
        initialEntries={["/my/base/path/thing"]}
        hydrationData={{}}
      >
        <Route path="/my/base/path">
          <Route path="thing" element={<h1>Heyooo</h1>} />
        </Route>
      </DataMemoryRouter>
    );

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Heyooo
        </h1>
      </div>"
    `);
  });

  it("supports a basename prop", () => {
    let { container } = render(
      <DataMemoryRouter
        basename="/my/base/path"
        initialEntries={["/my/base/path/thing"]}
        hydrationData={{}}
      >
        <Route path="thing" element={<h1>Heyooo</h1>} />
      </DataMemoryRouter>
    );

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Heyooo
        </h1>
      </div>"
    `);
  });

  it("renders with hydration data", async () => {
    let { container } = render(
      <DataMemoryRouter
        initialEntries={["/child"]}
        hydrationData={{
          loaderData: {
            "0": "parent data",
            "0-0": "child data",
          },
          actionData: {
            "0-0": "child action",
          },
        }}
      >
        <Route path="/" element={<Comp />}>
          <Route path="child" element={<Comp />} />
        </Route>
      </DataMemoryRouter>
    );

    function Comp() {
      let data = useLoaderData();
      let actionData = useActionData();
      let navigation = useNavigation();
      return (
        <div>
          {data}
          {actionData}
          {navigation.state}
          <Outlet />
        </div>
      );
    }

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          parent data
          child action
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
    let fooDefer = defer();
    let { container } = render(
      <DataMemoryRouter
        fallbackElement={<FallbackElement />}
        initialEntries={["/foo"]}
      >
        <Route path="/" element={<Outlet />}>
          <Route path="foo" loader={() => fooDefer.promise} element={<Foo />} />
          <Route path="bar" element={<Bar />} />
        </Route>
      </DataMemoryRouter>
    );

    function FallbackElement() {
      return <p>Loading...</p>;
    }

    function Foo() {
      let data = useLoaderData();
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
    let fooDefer = defer();
    let { container } = render(
      <DataMemoryRouter initialEntries={["/foo"]}>
        <Route path="/" element={<Outlet />}>
          <Route path="foo" loader={() => fooDefer.promise} element={<Foo />} />
          <Route path="bar" element={<Bar />} />
        </Route>
      </DataMemoryRouter>
    );

    function Foo() {
      let data = useLoaderData();
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
    let fooDefer = defer();
    let { container } = render(
      <DataMemoryRouter
        fallbackElement={<FallbackElement />}
        initialEntries={["/bar"]}
      >
        <Route path="/" element={<Outlet />}>
          <Route path="foo" loader={() => fooDefer.promise} element={<Foo />} />
          <Route path="bar" element={<Bar />} />
        </Route>
      </DataMemoryRouter>
    );

    function FallbackElement() {
      return <p>Loading...</p>;
    }

    function Foo() {
      let data = useLoaderData();
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

  it("handles link navigations", async () => {
    render(
      <DataMemoryRouter initialEntries={["/foo"]} hydrationData={{}}>
        <Route path="/" element={<Layout />}>
          <Route path="foo" element={<Foo />} />
          <Route path="bar" element={<Bar />} />
        </Route>
      </DataMemoryRouter>
    );

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
    let barDefer = defer();

    let { container } = render(
      <DataMemoryRouter initialEntries={["/foo"]} hydrationData={{}}>
        <Route path="/" element={<Layout />}>
          <Route path="foo" element={<Foo />} />
          <Route path="bar" loader={() => barDefer.promise} element={<Bar />} />
        </Route>
      </DataMemoryRouter>
    );

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
      let data = useLoaderData();
      return <h1>{data?.message}</h1>;
    }

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          <a
            href=\\"/bar\\"
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
            href=\\"/bar\\"
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
            href=\\"/bar\\"
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
    let barDefer = defer();
    let barActionDefer = defer();
    let formData = new FormData();
    formData.append("test", "value");

    let { container } = render(
      <DataMemoryRouter initialEntries={["/foo"]} hydrationData={{}}>
        <Route path="/" element={<Layout />}>
          <Route path="foo" element={<Foo />} />
          <Route
            path="bar"
            action={() => barActionDefer.promise}
            loader={() => barDefer.promise}
            element={<Bar />}
          />
        </Route>
      </DataMemoryRouter>
    );

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
      let data = useLoaderData();
      let actionData = useActionData();
      return (
        <h1>
          {data}
          {actionData}
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

    render(
      <DataMemoryRouter initialEntries={["/"]} hydrationData={{}}>
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
      </DataMemoryRouter>
    );

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

    let { container } = render(
      <DataMemoryRouter
        initialEntries={["/foo"]}
        hydrationData={{
          loaderData: {
            layout: null,
            foo: "FOO",
          },
        }}
      >
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
      </DataMemoryRouter>
    );

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
      layout: null,
      foo: "FOO",
      bar: undefined,
      child: undefined,
    });
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <a
          href=\\"/bar/child\\"
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
    await new Promise((r) => setImmediate(r));

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <a
          href=\\"/bar/child\\"
        >
          Link to Child
        </a>
        <h2>
          Child
        </h2>
      </div>"
    `);
    expect(spy).toHaveBeenCalledWith({
      layout: null,
      foo: undefined,
      bar: undefined,
      child: "CHILD",
    });
  });

  it("reloads data using useRevalidate", async () => {
    let count = 1;

    let { container } = render(
      <DataMemoryRouter
        initialEntries={["/foo"]}
        hydrationData={{
          loaderData: {
            "0-0": "count=1",
          },
        }}
      >
        <Route path="/" element={<Layout />}>
          <Route
            path="foo"
            loader={async () => `count=${++count}`}
            element={<Foo />}
          />
        </Route>
      </DataMemoryRouter>
    );

    function Layout() {
      let navigation = useNavigation();
      let { revalidate, state } = useRevalidator();
      return (
        <div>
          <button onClick={() => revalidate()}>Revalidate</button>
          <p>{navigation.state}</p>
          <p>{state}</p>
          <Outlet />
        </div>
      );
    }

    function Foo() {
      let data = useLoaderData();
      return <p>{data}</p>;
    }

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          <button>
            Revalidate
          </button>
          <p>
            idle
          </p>
          <p>
            idle
          </p>
          <p>
            count=1
          </p>
        </div>
      </div>"
    `);

    fireEvent.click(screen.getByText("Revalidate"));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          <button>
            Revalidate
          </button>
          <p>
            idle
          </p>
          <p>
            loading
          </p>
          <p>
            count=1
          </p>
        </div>
      </div>"
    `);

    await waitFor(() => screen.getByText("count=2"));
    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <div>
          <button>
            Revalidate
          </button>
          <p>
            idle
          </p>
          <p>
            idle
          </p>
          <p>
            count=2
          </p>
        </div>
      </div>"
    `);
  });

  it("renders descendent routes inside a data router", () => {
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

    let { container } = render(
      <DataMemoryRouter
        initialEntries={["/deep/path/to/descendant/routes"]}
        hydrationData={{}}
      >
        <Route path="/deep">
          <Route path="path/*" element={<Child />} />
        </Route>
      </DataMemoryRouter>
    );

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          👋 Hello from the other side!
        </h1>
      </div>"
    `);
  });

  describe("errors", () => {
    it("renders hydration errors on leaf elements", async () => {
      let { container } = render(
        <DataMemoryRouter
          initialEntries={["/child"]}
          hydrationData={{
            loaderData: {
              "0": "parent data",
            },
            actionData: {
              "0": "parent action",
            },
            errors: {
              "0-0": new Error("Kaboom 💥"),
            },
          }}
        >
          <Route path="/" element={<Comp />}>
            <Route
              path="child"
              element={<Comp />}
              errorElement={<ErrorBoundary />}
            />
          </Route>
        </DataMemoryRouter>
      );

      function Comp() {
        let data = useLoaderData();
        let actionData = useActionData();
        let navigation = useNavigation();
        return (
          <div>
            {data}
            {actionData}
            {navigation.state}
            <Outlet />
          </div>
        );
      }

      function ErrorBoundary() {
        let error = useRouteError();
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
      let { container } = render(
        <DataMemoryRouter
          initialEntries={["/child"]}
          hydrationData={{
            loaderData: {},
            actionData: null,
            errors: {
              "0": new Error("Kaboom 💥"),
            },
          }}
        >
          <Route path="/" element={<Comp />} errorElement={<ErrorBoundary />}>
            <Route path="child" element={<Comp />} />
          </Route>
        </DataMemoryRouter>
      );

      function Comp() {
        let data = useLoaderData();
        let actionData = useActionData();
        let navigation = useNavigation();
        return (
          <div>
            {data}
            {actionData}
            {navigation.state}
            <Outlet />
          </div>
        );
      }

      function ErrorBoundary() {
        let error = useRouteError();
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
      let fooDefer = defer();
      let barDefer = defer();

      let { container } = render(
        <DataMemoryRouter
          initialEntries={["/foo"]}
          hydrationData={{
            loaderData: {
              "0-0": {
                message: "hydrated from foo",
              },
            },
          }}
        >
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
        </DataMemoryRouter>
      );

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
        let data = useLoaderData();
        return <h1>Foo:{data?.message}</h1>;
      }
      function FooError() {
        let error = useRouteError();
        return <p>Foo Error:{error.message}</p>;
      }
      function Bar() {
        let data = useLoaderData();
        return <h1>Bar:{data?.message}</h1>;
      }
      function BarError() {
        let error = useRouteError();
        return <p>Bar Error:{error.message}</p>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/foo\\"
            >
              Link to Foo
            </a>
            <a
              href=\\"/bar\\"
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
              href=\\"/foo\\"
            >
              Link to Foo
            </a>
            <a
              href=\\"/bar\\"
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
              href=\\"/foo\\"
            >
              Link to Foo
            </a>
            <a
              href=\\"/bar\\"
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
      let fooDefer = defer();
      let barDefer = defer();

      let { container } = render(
        <DataMemoryRouter
          initialEntries={["/foo"]}
          hydrationData={{
            loaderData: {
              "0-0": {
                message: "hydrated from foo",
              },
            },
          }}
        >
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
        </DataMemoryRouter>
      );

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
        let error = useRouteError();
        return <p>Layout Error:{error.message}</p>;
      }
      function Foo() {
        let data = useLoaderData();
        return <h1>Foo:{data?.message}</h1>;
      }
      function FooError() {
        let error = useRouteError();
        return <p>Foo Error:{error.message}</p>;
      }
      function Bar() {
        let data = useLoaderData();
        return <h1>Bar:{data?.message}</h1>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/foo\\"
            >
              Link to Foo
            </a>
            <a
              href=\\"/bar\\"
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
      let { container } = render(
        <DataMemoryRouter
          initialEntries={["/foo"]}
          hydrationData={{
            loaderData: {
              "0": {
                message: "hydrated from foo",
              },
            },
          }}
        >
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
        </DataMemoryRouter>
      );

      function Boundary() {
        let error = useRouteError();
        return (
          <p>
            Error:
            {error.status}
            {error.statusText}
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
      let { container } = render(
        <DataMemoryRouter
          initialEntries={["/foo"]}
          hydrationData={{
            loaderData: {
              "0": {
                message: "hydrated from foo",
              },
            },
          }}
        >
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
        </DataMemoryRouter>
      );

      function Boundary() {
        let error = useRouteError();
        return (
          <p>
            Error:
            {error.status}
            {error.statusText}
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
      let { container } = render(
        <DataMemoryRouter
          initialEntries={["/foo"]}
          hydrationData={{
            loaderData: {
              "0": {
                message: "hydrated from foo",
              },
            },
          }}
        >
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
        </DataMemoryRouter>
      );

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <h2>
            Unhandled Thrown Error!
          </h2>
          <h3
            style=\\"font-style: italic;\\"
          >
            404 Not Found
          </h3>
          <p>
            💿 Hey developer 👋
          </p>
          <p>
            You can provide a way better UX than this when your app throws errors by providing your own 
            <code
              style=\\"padding: 2px 4px; background-color: rgba(200, 200, 200, 0.5);\\"
            >
              errorElement
            </code>
             props on 
            <code
              style=\\"padding: 2px 4px; background-color: rgba(200, 200, 200, 0.5);\\"
            >
              &lt;Route&gt;
            </code>
          </p>
        </div>"
      `);
    });

    it("renders navigation errors with a default if no errorElements are provided", async () => {
      let fooDefer = defer();
      let barDefer = defer();

      let { container } = render(
        <DataMemoryRouter
          initialEntries={["/foo"]}
          hydrationData={{
            loaderData: {
              "0-0": {
                message: "hydrated from foo",
              },
            },
          }}
        >
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
        </DataMemoryRouter>
      );

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
        let data = useLoaderData();
        return <h1>Foo:{data?.message}</h1>;
      }
      function Bar() {
        let data = useLoaderData();
        return <h1>Bar:{data?.message}</h1>;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/foo\\"
            >
              Link to Foo
            </a>
            <a
              href=\\"/bar\\"
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
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <h2>
            Unhandled Thrown Error!
          </h2>
          <h3
            style=\\"font-style: italic;\\"
          >
            Kaboom!
          </h3>
          <pre
            style=\\"padding: 0.5rem; background-color: rgba(200, 200, 200, 0.5);\\"
          >
            FAKE STACK TRACE
          </pre>
          <p>
            💿 Hey developer 👋
          </p>
          <p>
            You can provide a way better UX than this when your app throws errors by providing your own 
            <code
              style=\\"padding: 2px 4px; background-color: rgba(200, 200, 200, 0.5);\\"
            >
              errorElement
            </code>
             props on 
            <code
              style=\\"padding: 2px 4px; background-color: rgba(200, 200, 200, 0.5);\\"
            >
              &lt;Route&gt;
            </code>
          </p>
        </div>"
      `);
    });

    it("handles render errors in parent errorElement", async () => {
      let { container } = render(
        <DataMemoryRouter
          initialEntries={["/child"]}
          hydrationData={{
            loaderData: {},
            actionData: null,
          }}
        >
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
        </DataMemoryRouter>
      );

      function ChildComp(): React.ReactElement {
        throw new Error("Kaboom!");
      }

      function ErrorBoundary() {
        let error = useRouteError();
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
      let { container } = render(
        <DataMemoryRouter
          initialEntries={["/child"]}
          hydrationData={{
            loaderData: {},
            actionData: null,
          }}
        >
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
        </DataMemoryRouter>
      );

      function ChildComp(): React.ReactElement {
        throw new Error("Kaboom!");
      }

      function ErrorBoundary() {
        let error = useRouteError();
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
      let { container } = render(
        <DataMemoryRouter
          initialEntries={["/child"]}
          hydrationData={{
            loaderData: {},
            actionData: null,
          }}
        >
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
        </DataMemoryRouter>
      );

      function ChildComp(): React.ReactElement {
        let error = new Error("Kaboom!");
        error.stack = "FAKE STACK TRACE";
        throw error;
      }

      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <h2>
            Unhandled Thrown Error!
          </h2>
          <h3
            style=\\"font-style: italic;\\"
          >
            Kaboom!
          </h3>
          <pre
            style=\\"padding: 0.5rem; background-color: rgba(200, 200, 200, 0.5);\\"
          >
            FAKE STACK TRACE
          </pre>
          <p>
            💿 Hey developer 👋
          </p>
          <p>
            You can provide a way better UX than this when your app throws errors by providing your own 
            <code
              style=\\"padding: 2px 4px; background-color: rgba(200, 200, 200, 0.5);\\"
            >
              errorElement
            </code>
             props on 
            <code
              style=\\"padding: 2px 4px; background-color: rgba(200, 200, 200, 0.5);\\"
            >
              &lt;Route&gt;
            </code>
          </p>
        </div>"
      `);
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

    it("handles back button routing away from a child error boundary", async () => {
      let router: Router;

      // Need this to capture a copy of the router so we can trigger a back
      // navigation from _outside_ the DataMemoryRouter scope to most closely
      // resemble a browser back button
      function LocalDataMemoryRouter({
        children,
        initialEntries,
        initialIndex,
        hydrationData,
        fallbackElement,
      }: DataMemoryRouterProps): React.ReactElement {
        return useRenderDataRouter({
          children,
          fallbackElement,
          createRouter: (routes) => {
            router = createMemoryRouter({
              initialEntries,
              initialIndex,
              routes,
              hydrationData,
            });
            return router;
          },
        });
      }

      let { container } = render(
        <div>
          <LocalDataMemoryRouter
            initialEntries={["/"]}
            hydrationData={{ loaderData: {} }}
          >
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
          </LocalDataMemoryRouter>
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
        let error = useRouteError();
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

      // @ts-expect-error
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

      // @ts-expect-error
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
      let router: Router;

      // Need this to capture a copy of the router so we can trigger a back
      // navigation from _outside_ the DataMemoryRouter scope to most closely
      // resemble a browser back button
      function LocalDataMemoryRouter({
        children,
        initialEntries,
        initialIndex,
        hydrationData,
        fallbackElement,
      }: DataMemoryRouterProps): React.ReactElement {
        return useRenderDataRouter({
          children,
          fallbackElement,
          createRouter: (routes) => {
            router = createMemoryRouter({
              initialEntries,
              initialIndex,
              routes,
              hydrationData,
            });
            return router;
          },
        });
      }

      let { container } = render(
        <div>
          <LocalDataMemoryRouter
            initialEntries={["/"]}
            hydrationData={{ loaderData: {} }}
          >
            <Route path="/" element={<Parent />}>
              <Route path="child" element={<Child />} />
            </Route>
          </LocalDataMemoryRouter>
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

      // @ts-expect-error
      router.navigate("/child");
      await waitFor(() => screen.getByText("Kaboom!"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <h2>
              Unhandled Thrown Error!
            </h2>
            <h3
              style=\\"font-style: italic;\\"
            >
              Kaboom!
            </h3>
            <pre
              style=\\"padding: 0.5rem; background-color: rgba(200, 200, 200, 0.5);\\"
            >
              FAKE STACK TRACE
            </pre>
            <p>
              💿 Hey developer 👋
            </p>
            <p>
              You can provide a way better UX than this when your app throws errors by providing your own 
              <code
                style=\\"padding: 2px 4px; background-color: rgba(200, 200, 200, 0.5);\\"
              >
                errorElement
              </code>
               props on 
              <code
                style=\\"padding: 2px 4px; background-color: rgba(200, 200, 200, 0.5);\\"
              >
                &lt;Route&gt;
              </code>
            </p>
          </div>
        </div>"
      `);

      // @ts-expect-error
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
  });

  describe("deferred", () => {
    function setupDeferredTest(
      hasRouteErrorElement = false,
      hasDeferredErrorElement = false,
      triggerRenderError = false,
      triggerFallbackError = false
    ) {
      let barDefer = defer();
      let { container } = render(
        <DataMemoryRouter initialEntries={["/foo"]} hydrationData={{}}>
          <Route path="/" element={<Layout />}>
            <Route path="foo" element={<Foo />} />
            <Route
              path="bar"
              loader={() => barDefer.promise}
              element={<Bar />}
              errorElement={hasRouteErrorElement ? <RouteError /> : null}
            />
          </Route>
        </DataMemoryRouter>
      );

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
        let data = useLoaderData();
        return (
          <>
            <p>{data.critical}</p>
            <Deferred
              value={data.lazy}
              fallback={<LazyFallback />}
              errorElement={hasDeferredErrorElement ? <LazyError /> : null}
            >
              <LazyData />
            </Deferred>
          </>
        );
      }

      function RouteError() {
        let error = useRouteError();
        return <p>Route Error:{error.message}</p>;
      }

      function LazyFallback() {
        return triggerFallbackError ? (
          <p>{oops.i.did.it}</p>
        ) : (
          <p>Loading...</p>
        );
      }

      function LazyData() {
        let data = useDeferredData();
        return triggerRenderError ? (
          <p>{oops.i.did.it.again}</p>
        ) : (
          <p>{data}</p>
        );
      }

      function LazyError() {
        let data = useRouteError();
        return <p>Handled Error:{data.message}</p>;
      }

      return { container, barDefer };
    }

    it("allows loaders to returned deferred data (child component)", async () => {
      let { barDefer, container } = setupDeferredTest();
      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
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

      let barValueDfd = defer();
      barDefer.resolve(
        deferred({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              CRITICAL
            </p>
            <p>
              Loading...
            </p>
          </div>
        </div>"
      `);

      barValueDfd.resolve("LAZY");
      await waitFor(() => screen.getByText("LAZY"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              CRITICAL
            </p>
            <p>
              LAZY
            </p>
          </div>
        </div>"
      `);
    });

    it("allows loaders to returned deferred data (render prop)", async () => {
      let { barDefer, container } = setupDeferredTest();

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
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

      let barValueDfd = defer();
      barDefer.resolve(
        deferred({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              CRITICAL
            </p>
            <p>
              Loading...
            </p>
          </div>
        </div>"
      `);

      barValueDfd.resolve("LAZY");
      await waitFor(() => screen.getByText("LAZY"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              CRITICAL
            </p>
            <p>
              LAZY
            </p>
          </div>
        </div>"
      `);
    });

    it("sends data errors to the provided errorElement", async () => {
      let { barDefer, container } = setupDeferredTest(true, true, false);

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
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

      let barValueDfd = defer();
      barDefer.resolve(
        deferred({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              CRITICAL
            </p>
            <p>
              Loading...
            </p>
          </div>
        </div>"
      `);

      barValueDfd.reject(new Error("Kaboom!"));
      await waitFor(() => screen.getByText(/Kaboom!/));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              CRITICAL
            </p>
            <p>
              Handled Error:
              Error: Kaboom!
            </p>
          </div>
        </div>"
      `);
    });

    it("sends unhandled data errors to the nearest route error boundary", async () => {
      let { barDefer, container } = setupDeferredTest(true, false, false);

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
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

      let barValueDfd = defer();
      barDefer.resolve(
        deferred({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              CRITICAL
            </p>
            <p>
              Loading...
            </p>
          </div>
        </div>"
      `);

      barValueDfd.reject(new Error("Kaboom!"));
      await waitFor(() => screen.getByText(/Kaboom!/));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              Route Error:
              Error: Kaboom!
            </p>
          </div>
        </div>"
      `);
    });

    it("sends render errors to the provided errorElement", async () => {
      let { barDefer, container } = setupDeferredTest(true, true, true);

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
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

      let barValueDfd = defer();
      barDefer.resolve(
        deferred({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              CRITICAL
            </p>
            <p>
              Loading...
            </p>
          </div>
        </div>"
      `);

      barValueDfd.resolve("LAZY");
      await waitFor(() => !screen.getByText(/Loading.../));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              CRITICAL
            </p>
            <p>
              Handled Error:
              oops is not defined
            </p>
          </div>
        </div>"
      `);
    });

    it("sends unhandled render errors to the nearest route error boundary", async () => {
      let { barDefer, container } = setupDeferredTest(true, false, true);

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
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

      let barValueDfd = defer();
      barDefer.resolve(
        deferred({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              CRITICAL
            </p>
            <p>
              Loading...
            </p>
          </div>
        </div>"
      `);

      barValueDfd.resolve("LAZY");
      await waitFor(() => !screen.getByText(/Loading.../));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              Route Error:
              oops is not defined
            </p>
          </div>
        </div>"
      `);
    });

    it("does not handle fallback render errors in the Deferred errorElement", async () => {
      let { barDefer, container } = setupDeferredTest(true, true, true, true);

      fireEvent.click(screen.getByText("Link to Bar"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
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

      let barValueDfd = defer();
      barDefer.resolve(
        deferred({
          critical: "CRITICAL",
          lazy: barValueDfd.promise,
        })
      );
      await waitFor(() => screen.getByText("idle"));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              Route Error:
              oops is not defined
            </p>
          </div>
        </div>"
      `);

      // Resolving doesn't do anything
      barValueDfd.resolve("LAZY");
      await new Promise((r) => setTimeout(r, 1));
      expect(getHtml(container)).toMatchInlineSnapshot(`
        "<div>
          <div>
            <a
              href=\\"/bar\\"
            >
              Link to Bar
            </a>
            <p>
              idle
            </p>
            <p>
              Route Error:
              oops is not defined
            </p>
          </div>
        </div>"
      `);
    });
  });
});

function defer() {
  let resolve: (val?: any) => Promise<void>;
  let reject: (error?: Error) => Promise<void>;
  let promise = new Promise((res, rej) => {
    resolve = async (val: any) => {
      res(val);
      try {
        await promise;
      } catch (e) {}
    };
    reject = async (error?: Error) => {
      rej(error);
      try {
        await promise;
      } catch (e) {}
    };
  });
  return {
    promise,
    //@ts-ignore
    resolve,
    //@ts-ignore
    reject,
  };
}

function getHtml(container: HTMLElement) {
  return prettyDOM(container, undefined, {
    highlight: false,
  });
}

function MemoryNavigate({
  to,
  formMethod,
  formData,
  children,
}: {
  to: string;
  formMethod?: FormMethod;
  formData?: FormData;
  children: React.ReactNode;
}) {
  let router = React.useContext(UNSAFE_DataRouterContext);

  let onClickHandler = React.useCallback(
    async (event: React.MouseEvent) => {
      event.preventDefault();
      if (formMethod && formData) {
        router!.navigate(to, { formMethod, formData });
      } else {
        router!.navigate(to);
      }
    },
    [router, to, formMethod, formData]
  );

  return formData ? (
    <form onClick={onClickHandler} children={children} />
  ) : (
    <a href={to} onClick={onClickHandler} children={children} />
  );
}
