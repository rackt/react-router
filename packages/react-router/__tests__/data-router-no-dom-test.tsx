/**
 * @jest-environment node
 */

import * as React from "react";
import renderer from "react-test-renderer";
import { useFetcher } from "../lib/dom/lib";
import { RouterProvider } from "../lib/dom-export/dom-router-provider";
import { createMemoryRouter } from "../lib/components";
import { useLoaderData, useNavigate } from "../lib/hooks";

describe("RouterProvider works when no DOM APIs are available", () => {
  it("renders and navigates", async () => {
    let router = createMemoryRouter([
      {
        path: "/",
        Component: () => {
          let navigate = useNavigate();
          return <button onClick={() => navigate("/foo")}>Go to /foo</button>;
        },
      },
      {
        path: "/foo",
        loader: () => "FOO",
        Component: () => {
          let data = useLoaderData() as string;
          return <h1>{data}</h1>;
        },
      },
    ]);
    const component = renderer.create(<RouterProvider router={router} />);
    let tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <button
        onClick={[Function]}
      >
        Go to /foo
      </button>
    `);

    await renderer.act(async () => {
      // @ts-expect-error
      tree.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <h1>
        FOO
      </h1>
    `);
  });

  it("is defensive against a view transition navigation", async () => {
    let warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    let router = createMemoryRouter([
      {
        path: "/",
        Component: () => {
          let navigate = useNavigate();
          return <button onClick={() => navigate("/foo")}>Go to /foo</button>;
        },
      },
      {
        path: "/foo",
        loader: () => "FOO",
        Component: () => {
          let data = useLoaderData() as string;
          return <h1>{data}</h1>;
        },
      },
    ]);
    const component = renderer.create(<RouterProvider router={router} />);
    let tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <button
        onClick={[Function]}
      >
        Go to /foo
      </button>
    `);

    let spy = jest.fn();
    let unsubscribe = router.subscribe(spy);

    await renderer.act(async () => {
      router.navigate("/foo", {
        viewTransition: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <h1>
        FOO
      </h1>
    `);

    expect(spy.mock.calls[0][0].location.pathname).toBe("/");
    expect(spy.mock.calls[0][0].navigation.state).toBe("loading");
    expect(spy.mock.calls[0][0].navigation.location.pathname).toBe("/foo");
    expect(spy.mock.calls[0][1].viewTransitionOpts).toBeUndefined();

    expect(spy.mock.calls[1][0].location.pathname).toBe("/foo");
    expect(spy.mock.calls[1][0].navigation.state).toBe("idle");
    expect(spy.mock.calls[1][1].viewTransitionOpts).toEqual({
      currentLocation: {
        hash: "",
        key: "default",
        pathname: "/",
        search: "",
        state: null,
      },
      nextLocation: {
        hash: "",
        key: expect.any(String),
        pathname: "/foo",
        search: "",
        state: null,
      },
      opts: true,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "You provided the `viewTransition` option to a router update, but you do " +
        "not appear to be running in a DOM environment as `window.startViewTransition` " +
        "is not available."
    );
    warnSpy.mockRestore();

    unsubscribe();
  });

  it("is defensive against a flushSync navigation", async () => {
    let router = createMemoryRouter([
      {
        path: "/",
        Component: () => {
          let navigate = useNavigate();
          return <button onClick={() => navigate("/foo")}>Go to /foo</button>;
        },
      },
      {
        path: "/foo",
        loader: () => "FOO",
        Component: () => {
          let data = useLoaderData() as string;
          return <h1>{data}</h1>;
        },
      },
    ]);
    const component = renderer.create(<RouterProvider router={router} />);
    let tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <button
        onClick={[Function]}
      >
        Go to /foo
      </button>
    `);

    let spy = jest.fn();
    let unsubscribe = router.subscribe(spy);

    await renderer.act(async () => {
      router.navigate("/foo", {
        flushSync: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <h1>
        FOO
      </h1>
    `);

    expect(spy.mock.calls[0][0].location.pathname).toBe("/");
    expect(spy.mock.calls[0][0].navigation.state).toBe("loading");
    expect(spy.mock.calls[0][0].navigation.location.pathname).toBe("/foo");
    expect(spy.mock.calls[0][1].flushSync).toBe(true);

    expect(spy.mock.calls[1][0].location.pathname).toBe("/foo");
    expect(spy.mock.calls[1][0].navigation.state).toBe("idle");
    expect(spy.mock.calls[1][1].flushSync).toBe(false);

    unsubscribe();
  });

  it("supports fetcher loads", async () => {
    let router = createMemoryRouter([
      {
        path: "/",
        Component: () => {
          let fetcher = useFetcher();
          return (
            <button onClick={() => fetcher.load("/fetch")}>
              Load fetcher
              {fetcher.data || ""}
            </button>
          );
        },
      },
      {
        path: "/fetch",
        loader() {
          return "LOADER";
        },
      },
    ]);
    const component = renderer.create(<RouterProvider router={router} />);
    let tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <button
        onClick={[Function]}
      >
        Load fetcher
      </button>
    `);

    await renderer.act(async () => {
      // @ts-expect-error
      tree.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <button
        onClick={[Function]}
      >
        Load fetcher
        LOADER
      </button>
    `);
  });

  it("supports fetcher submissions", async () => {
    let router = createMemoryRouter([
      {
        path: "/",
        Component: () => {
          let fetcher = useFetcher();
          return (
            <button
              onClick={() =>
                fetcher.submit(
                  { message: "echo" },
                  {
                    method: "post",
                    action: "/fetch",
                    encType: "application/json",
                  }
                )
              }
            >
              Submit fetcher
              {fetcher.data?.message || ""}
            </button>
          );
        },
      },
      {
        path: "/fetch",
        async action({ request }) {
          let data = await request.json();
          return { message: data.message.toUpperCase() };
        },
      },
    ]);
    const component = renderer.create(<RouterProvider router={router} />);
    let tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <button
        onClick={[Function]}
      >
        Submit fetcher
      </button>
    `);

    await renderer.act(async () => {
      // @ts-expect-error
      tree.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <button
        onClick={[Function]}
      >
        Submit fetcher
        ECHO
      </button>
    `);
  });

  it("supports viewTransitionTypes navigation", async () => {
    let router = createMemoryRouter([
      {
        path: "/",
        Component: () => {
          let navigate = useNavigate();
          return <button onClick={() => navigate("/foo")}>Go to /foo</button>;
        },
      },
      {
        path: "/foo",
        loader: () => "FOO",
        Component: () => {
          let data = useLoaderData() as string;
          return <h1>{data}</h1>;
        },
      },
    ]);
    const component = renderer.create(<RouterProvider router={router} />);
    let tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <button
        onClick={[Function]}
      >
        Go to /foo
      </button>
    `);

    let spy = jest.fn();
    let unsubscribe = router.subscribe(spy);

    await renderer.act(async () => {
      router.navigate("/foo", {
        viewTransition: { types: ["fade", "slide"] },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    tree = component.toJSON();
    expect(tree).toMatchInlineSnapshot(`
      <h1>
        FOO
      </h1>
    `);

    // First subscription call reflects the loading state without viewTransitionOpts
    expect(spy.mock.calls[0][0].location.pathname).toBe("/");
    expect(spy.mock.calls[0][0].navigation.state).toBe("loading");
    expect(spy.mock.calls[0][0].navigation.location.pathname).toBe("/foo");
    expect(spy.mock.calls[0][1].viewTransitionOpts).toBeUndefined();

    // Second subscription call reflects the idle state.
    // Note: In a non-DOM environment, viewTransitionTypes are not included in viewTransitionOpts.
    expect(spy.mock.calls[1][0].location.pathname).toBe("/foo");
    expect(spy.mock.calls[1][0].navigation.state).toBe("idle");
    expect(spy.mock.calls[1][1].viewTransitionOpts).toEqual({
      currentLocation: {
        hash: "",
        key: "default",
        pathname: "/",
        search: "",
        state: null,
      },
      nextLocation: {
        hash: "",
        key: expect.any(String),
        pathname: "/foo",
        search: "",
        state: null,
      },
      opts: {
        types: ["fade", "slide"],
      },
    });

    unsubscribe();
  });
});
