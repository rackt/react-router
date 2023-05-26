import * as React from "react";
import * as TestRenderer from "react-test-renderer";
import {
  MemoryRouter,
  Navigate,
  Outlet,
  Routes,
  Route,
  RouterProvider,
  createMemoryRouter,
  useLocation,
} from "react-router";
import { prettyDOM, render, screen, waitFor } from "@testing-library/react";

describe("<Navigate>", () => {
  describe("with an absolute href", () => {
    it("navigates to the correct URL", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/home"]}>
            <Routes>
              <Route path="home" element={<Navigate to="/about" />} />
              <Route path="about" element={<h1>About</h1>} />
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          About
        </h1>
      `);
    });
  });

  describe("with a relative href (relative=route)", () => {
    it("navigates to the correct URL", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/home"]}>
            <Routes>
              <Route path="home" element={<Navigate to="../about" />} />
              <Route path="about" element={<h1>About</h1>} />
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          About
        </h1>
      `);
    });

    it("handles upward navigation from an index routes", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/home"]}>
            <Routes>
              <Route path="home">
                <Route index element={<Navigate to="../about" />} />
              </Route>
              <Route path="about" element={<h1>About</h1>} />
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          About
        </h1>
      `);
    });

    it("handles upward navigation from inside a pathless layout route", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/home"]}>
            <Routes>
              <Route element={<Outlet />}>
                <Route path="home" element={<Navigate to="../about" />} />
              </Route>
              <Route path="about" element={<h1>About</h1>} />
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          About
        </h1>
      `);
    });

    it("handles upward navigation from inside multiple pathless layout routes + index route", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/home"]}>
            <Routes>
              <Route path="home">
                <Route element={<Outlet />}>
                  <Route element={<Outlet />}>
                    <Route element={<Outlet />}>
                      <Route index element={<Navigate to="../about" />} />
                    </Route>
                  </Route>
                </Route>
              </Route>
              <Route path="about" element={<h1>About</h1>} />
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          About
        </h1>
      `);
    });

    it("handles upward navigation from inside multiple pathless layout routes + path route", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/home/page"]}>
            <Routes>
              <Route path="home" element={<Outlet />}>
                <Route element={<Outlet />}>
                  <Route element={<Outlet />}>
                    <Route element={<Outlet />}>
                      <Route
                        path="page"
                        element={<Navigate to="../../about" />}
                      />
                    </Route>
                  </Route>
                </Route>
              </Route>
              <Route path="about" element={<h1>About</h1>} />
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          About
        </h1>
      `);
    });

    it("handles parent navigation from inside multiple pathless layout routes", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/home/page"]}>
            <Routes>
              <Route
                path="home"
                element={
                  <>
                    <h1>Home</h1>
                    <Outlet />
                  </>
                }
              >
                <Route element={<Outlet />}>
                  <Route element={<Outlet />}>
                    <Route element={<Outlet />}>
                      <Route
                        path="page"
                        element={
                          <>
                            <h2>Page</h2>
                            <Navigate to=".." />
                          </>
                        }
                      />
                    </Route>
                  </Route>
                </Route>
              </Route>
              <Route path="about" element={<h1>About</h1>} />
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          Home
        </h1>
      `);
    });

    it("handles relative navigation from nested index route", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/layout/thing"]}>
            <Routes>
              <Route path="layout">
                <Route path=":param">
                  {/* redirect /layout/:param/ index routes to /layout/:param/dest */}
                  <Route index element={<Navigate to="dest" />} />
                  <Route path="dest" element={<h1>Destination</h1>} />
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          Destination
        </h1>
      `);
    });
  });

  describe("with a relative href (relative=path)", () => {
    it("navigates to the correct URL", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/contacts/1"]}>
            <Routes>
              <Route path="contacts" element={<h1>Contacts</h1>} />
              <Route
                path="contacts/:id"
                element={<Navigate to=".." relative="path" />}
              />
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          Contacts
        </h1>
      `);
    });

    it("handles upward navigation from an index routes", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/contacts/1"]}>
            <Routes>
              <Route path="contacts" element={<h1>Contacts</h1>} />
              <Route path="contacts/:id">
                <Route index element={<Navigate to=".." relative="path" />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          Contacts
        </h1>
      `);
    });

    it("handles upward navigation from inside a pathless layout route", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/contacts/1"]}>
            <Routes>
              <Route path="contacts" element={<h1>Contacts</h1>} />
              <Route element={<Outlet />}>
                <Route
                  path="contacts/:id"
                  element={<Navigate to=".." relative="path" />}
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          Contacts
        </h1>
      `);
    });

    it("handles upward navigation from inside multiple pathless layout routes + index route", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/contacts/1"]}>
            <Routes>
              <Route path="contacts" element={<h1>Contacts</h1>} />
              <Route path="contacts/:id">
                <Route element={<Outlet />}>
                  <Route element={<Outlet />}>
                    <Route element={<Outlet />}>
                      <Route
                        index
                        element={<Navigate to=".." relative="path" />}
                      />
                    </Route>
                  </Route>
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          Contacts
        </h1>
      `);
    });

    it("handles upward navigation from inside multiple pathless layout routes + path route", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/contacts/1"]}>
            <Routes>
              <Route path="contacts" element={<Outlet />}>
                <Route index element={<h1>Contacts</h1>} />
                <Route element={<Outlet />}>
                  <Route element={<Outlet />}>
                    <Route element={<Outlet />}>
                      <Route
                        path=":id"
                        element={<Navigate to=".." relative="path" />}
                      />
                    </Route>
                  </Route>
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          Contacts
        </h1>
      `);
    });

    it("handles relative navigation from nested index route", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/layout/thing"]}>
            <Routes>
              <Route path="layout">
                <Route path=":param">
                  {/* redirect /layout/:param/ index routes to /layout/:param/dest */}
                  <Route
                    index
                    element={<Navigate to="dest" relative="path" />}
                  />
                  <Route path="dest" element={<h1>Destination</h1>} />
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        <h1>
          Destination
        </h1>
      `);
    });

    it("preserves search params and hash", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/contacts/1"]}>
            <Routes>
              <Route path="contacts" element={<Contacts />} />
              <Route
                path="contacts/:id"
                element={<Navigate to="..?foo=bar#hash" relative="path" />}
              />
            </Routes>
          </MemoryRouter>
        );
      });

      function Contacts() {
        let { search, hash } = useLocation();
        return (
          <>
            <h1>Contacts</h1>
            <p>
              {search}
              {hash}
            </p>
          </>
        );
      }

      // @ts-expect-error
      expect(renderer.toJSON()).toMatchInlineSnapshot(`
        [
          <h1>
            Contacts
          </h1>,
          <p>
            ?foo=bar
            #hash
          </p>,
        ]
      `);
    });
  });

  it("does not cause navigation loops in data routers", async () => {
    // Note this is not the idiomatic way to do these redirects, they should
    // be done with loaders in data routers, but this is a likely scenario to
    // encounter while migrating to a data router
    let router = createMemoryRouter(
      [
        {
          path: "home",
          element: <Navigate to="/about" />,
        },
        {
          path: "about",
          element: <h1>About</h1>,
          loader: () => new Promise((r) => setTimeout(() => r("ok"), 10)),
        },
      ],
      {
        initialEntries: ["/home"],
      }
    );

    let { container } = render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>
    );

    await waitFor(() => screen.getByText("About"));

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          About
        </h1>
      </div>"
    `);
  });

  it("handles sync relative navigations in StrictMode using a data router", async () => {
    const router = createMemoryRouter([
      {
        path: "/",
        children: [
          {
            index: true,
            // This is a relative navigation from the current location of /a.
            // Ensure we don't route from / -> /b -> /b/b
            Component: () => <Navigate to={"b"} replace />,
          },
          {
            path: "b",
            element: <h1>Page B</h1>,
          },
        ],
      },
    ]);

    let { container } = render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>
    );

    await waitFor(() => screen.getByText("Page B"));

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Page B
        </h1>
      </div>"
    `);
  });

  it("handles async relative navigations in StrictMode using a data router", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/a",
          children: [
            {
              index: true,
              // This is a relative navigation from the current location of /a.
              // Ensure we don't route from /a -> /a/b -> /a/b/b
              Component: () => <Navigate to={"b"} replace />,
            },
            {
              path: "b",
              async loader() {
                await new Promise((r) => setTimeout(r, 10));
                return null;
              },
              element: <h1>Page B</h1>,
            },
          ],
        },
      ],
      { initialEntries: ["/a"] }
    );

    let { container } = render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>
    );

    await waitFor(() => screen.getByText("Page B"));

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Page B
        </h1>
      </div>"
    `);
  });

  it("handles setState in render in StrictMode using a data router (sync loader)", async () => {
    let renders: number[] = [];
    const router = createMemoryRouter([
      {
        path: "/",
        children: [
          {
            index: true,
            Component() {
              let [count, setCount] = React.useState(0);
              if (count === 0) {
                setCount(1);
              }
              return <Navigate to={"b"} replace state={{ count }} />;
            },
          },
          {
            path: "b",
            Component() {
              let { state } = useLocation() as { state: { count: number } };
              renders.push(state.count);
              return (
                <>
                  <h1>Page B</h1>
                  <p>{state.count}</p>
                </>
              );
            },
          },
        ],
      },
    ]);

    let navigateSpy = jest.spyOn(router, "navigate");

    let { container } = render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>
    );

    await waitFor(() => screen.getByText("Page B"));

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Page B
        </h1>
        <p>
          1
        </p>
      </div>"
    `);
    expect(navigateSpy).toHaveBeenCalledTimes(2);
    expect(navigateSpy.mock.calls[0]).toMatchObject([
      { pathname: "/b" },
      { state: { count: 1 } },
    ]);
    expect(navigateSpy.mock.calls[1]).toMatchObject([
      { pathname: "/b" },
      { state: { count: 1 } },
    ]);
    expect(renders).toEqual([1, 1]);
  });

  it("handles setState in effect in StrictMode using a data router (sync loader)", async () => {
    let renders: number[] = [];
    const router = createMemoryRouter([
      {
        path: "/",
        children: [
          {
            index: true,
            Component() {
              let [count, setCount] = React.useState(0);
              React.useEffect(() => {
                if (count === 0) {
                  setCount(1);
                }
              }, [count]);
              return <Navigate to={"b"} replace state={{ count }} />;
            },
          },
          {
            path: "b",
            Component() {
              let { state } = useLocation() as { state: { count: number } };
              renders.push(state.count);
              return (
                <>
                  <h1>Page B</h1>
                  <p>{state.count}</p>
                </>
              );
            },
          },
        ],
      },
    ]);

    let navigateSpy = jest.spyOn(router, "navigate");

    let { container } = render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>
    );

    await waitFor(() => screen.getByText("Page B"));

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Page B
        </h1>
        <p>
          1
        </p>
      </div>"
    `);
    expect(navigateSpy).toHaveBeenCalledTimes(3);
    expect(navigateSpy.mock.calls[0]).toMatchObject([
      { pathname: "/b" },
      { state: { count: 0 } },
    ]);
    expect(navigateSpy.mock.calls[1]).toMatchObject([
      { pathname: "/b" },
      { state: { count: 0 } },
    ]);
    expect(renders).toEqual([1, 1]);
  });

  it("handles setState in render in StrictMode using a data router (async loader)", async () => {
    let renders: number[] = [];
    const router = createMemoryRouter([
      {
        path: "/",
        children: [
          {
            index: true,
            Component() {
              let [count, setCount] = React.useState(0);
              if (count === 0) {
                setCount(1);
              }
              return <Navigate to={"b"} replace state={{ count }} />;
            },
          },
          {
            path: "b",
            async loader() {
              await new Promise((r) => setTimeout(r, 10));
              return null;
            },
            Component() {
              let { state } = useLocation() as { state: { count: number } };
              renders.push(state.count);
              return (
                <>
                  <h1>Page B</h1>
                  <p>{state.count}</p>
                </>
              );
            },
          },
        ],
      },
    ]);

    let navigateSpy = jest.spyOn(router, "navigate");

    let { container } = render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>
    );

    await waitFor(() => screen.getByText("Page B"));

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Page B
        </h1>
        <p>
          1
        </p>
      </div>"
    `);
    expect(navigateSpy).toHaveBeenCalledTimes(2);
    expect(navigateSpy.mock.calls[0]).toMatchObject([
      { pathname: "/b" },
      { state: { count: 1 } },
    ]);
    expect(navigateSpy.mock.calls[1]).toMatchObject([
      { pathname: "/b" },
      { state: { count: 1 } },
    ]);
    // /a/b rendered with the same state value both times
    expect(renders).toEqual([1, 1]);
  });

  it("handles setState in effect in StrictMode using a data router (async loader)", async () => {
    let renders: number[] = [];
    const router = createMemoryRouter([
      {
        path: "/",
        children: [
          {
            index: true,
            Component() {
              // When state managed by react and changes during render, we'll
              // only "see" the value from the first pass through here in our
              // effects
              let [count, setCount] = React.useState(0);
              React.useEffect(() => {
                if (count === 0) {
                  setCount(1);
                }
              }, [count]);
              return <Navigate to={"b"} replace state={{ count }} />;
            },
          },
          {
            path: "b",
            async loader() {
              await new Promise((r) => setTimeout(r, 10));
              return null;
            },
            Component() {
              let { state } = useLocation() as { state: { count: number } };
              renders.push(state.count);
              return (
                <>
                  <h1>Page B</h1>
                  <p>{state.count}</p>
                </>
              );
            },
          },
        ],
      },
    ]);

    let navigateSpy = jest.spyOn(router, "navigate");

    let { container } = render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>
    );

    await waitFor(() => screen.getByText("Page B"));

    expect(getHtml(container)).toMatchInlineSnapshot(`
      "<div>
        <h1>
          Page B
        </h1>
        <p>
          1
        </p>
      </div>"
    `);
    expect(navigateSpy).toHaveBeenCalledTimes(3);
    expect(navigateSpy.mock.calls[0]).toMatchObject([
      { pathname: "/b" },
      { state: { count: 0 } },
    ]);
    expect(navigateSpy.mock.calls[1]).toMatchObject([
      { pathname: "/b" },
      { state: { count: 0 } },
    ]);
    // StrictMode only applies the double-effect execution on component mount,
    // not component update
    expect(navigateSpy.mock.calls[2]).toMatchObject([
      { pathname: "/b" },
      { state: { count: 1 } },
    ]);
    // /a/b rendered with the latest state value both times
    expect(renders).toEqual([1, 1]);
  });
});

function getHtml(container: HTMLElement) {
  return prettyDOM(container, undefined, {
    highlight: false,
  });
}
