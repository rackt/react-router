import * as React from "react";
import {
  BrowserRouter,
  HashRouter,
  Link,
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  createBrowserRouter,
  createHashRouter,
} from "../../index";
import * as TestRenderer from "react-test-renderer";

describe("<Link> href", () => {
  describe("in a static route", () => {
    test("absolute <Link to> resolves relative to the root URL", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox"]}>
            <Routes>
              <Route path="inbox" element={<Link to="/about" />} />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/about");
    });

    test('<Link to="."> resolves relative to the current route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox"]}>
            <Routes>
              <Route path="inbox" element={<Link to="." />} />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/inbox");
    });

    test('<Link to=".."> resolves relative to the parent route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route path="messages" element={<Link to=".." />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/inbox");
    });

    test('<Link to=".."> with more .. segments than parent routes resolves to the root URL', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  path="messages"
                  element={
                    <>
                      <Link to="../../about" />
                      {/* traverse past the root */}
                      <Link to="../../../about" />
                    </>
                  }
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findAllByType("a").map((a) => a.props.href)).toEqual(
        ["/about", "/about"]
      );
    });

    test('<Link to="https://remix.run"> is treated as external link', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  path="messages"
                  element={<Link to="https://remix.run" />}
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual(
        "https://remix.run"
      );
    });

    test('<Link to="//remix.run"> is treated as external link', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route path="messages" element={<Link to="//remix.run" />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("//remix.run");
    });

    test('<Link to="mailto:remix@example.com"> is treated as external link', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  path="messages"
                  element={<Link to="mailto:remix@example.com" />}
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual(
        "mailto:remix@example.com"
      );
    });

    test('<Link to="web+remix://somepath"> is treated as external link', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  path="messages"
                  element={<Link to="web+remix://somepath" />}
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual(
        "web+remix://somepath"
      );
    });

    test('<Link to="http://localhost/inbox"> is treated as an absolute link', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  path="messages"
                  element={<Link to="http://localhost/inbox" />}
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual(
        "http://localhost/inbox"
      );
    });

    test("<Link to=\"{ search: 'key=value'\"> is handled with the current pathname", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  path="messages"
                  element={<Link to={{ search: "key=value" }} />}
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual(
        "/inbox/messages?key=value"
      );
    });

    test("<Link to=\"{ hash: 'hash'\"> is handled with the current pathname", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  path="messages"
                  element={<Link to={{ hash: "hash" }} />}
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual(
        "/inbox/messages#hash"
      );
    });
  });

  describe("in a dynamic route", () => {
    test("absolute <Link to> resolves relative to the root URL", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages/abc"]}>
            <Routes>
              <Route path="inbox">
                <Route path="messages/:id" element={<Link to="/about" />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/about");
    });

    test('<Link to="."> resolves relative to the current route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages/abc"]}>
            <Routes>
              <Route path="inbox">
                <Route path="messages/:id" element={<Link to="." />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual(
        "/inbox/messages/abc"
      );
    });

    test('<Link to=".."> resolves relative to the parent route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages/abc"]}>
            <Routes>
              <Route path="inbox">
                <Route path="messages/:id" element={<Link to=".." />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/inbox");
    });

    test('<Link to=".."> with more .. segments than parent routes resolves to the root URL', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages/abc"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  path="messages/:id"
                  element={<Link to="../../about" />}
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/about");
    });
  });

  describe("in an index route", () => {
    test("absolute <Link to> resolves relative to the root URL", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox"]}>
            <Routes>
              <Route path="inbox">
                <Route index element={<Link to="/home" />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/home");
    });

    test('<Link to="."> resolves relative to the current route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox"]}>
            <Routes>
              <Route path="inbox">
                <Route index element={<Link to="." />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/inbox");
    });

    test('<Link to=".."> resolves relative to the parent route (ignoring the index route)', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox"]}>
            <Routes>
              <Route path="inbox">
                <Route index element={<Link to=".." />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/");
    });

    test('<Link to=".."> with more .. segments than parent routes resolves to the root URL', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  index
                  element={
                    <>
                      <Link to="../../about" />
                      {/* traverse past the root */}
                      <Link to="../../../about" />
                    </>
                  }
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findAllByType("a").map((a) => a.props.href)).toEqual(
        ["/about", "/about"]
      );
    });
  });

  describe("in a layout route", () => {
    function MessagesLayout({ link }: { link: React.ReactElement }) {
      return (
        <div>
          {link}
          <Outlet />
        </div>
      );
    }

    test("absolute <Link to> resolves relative to the root URL", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route element={<MessagesLayout link={<Link to="/home" />} />}>
                  <Route path="messages" element={<h1>Messages</h1>} />
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/home");
    });

    test('<Link to="."> resolves relative to the current route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route element={<MessagesLayout link={<Link to="." />} />}>
                  <Route path="messages" element={<h1>Messages</h1>} />
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/inbox");
    });

    test('<Link to=".."> resolves relative to the parent route (ignoring the pathless route)', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route element={<MessagesLayout link={<Link to=".." />} />}>
                  <Route path="messages" element={<h1>Messages</h1>} />
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/");
    });

    test('<Link to=".."> with more .. segments than parent routes resolves to the root URL', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  element={
                    <MessagesLayout
                      link={
                        <>
                          <Link to="../../about" />
                          {/* traverse past the root */}
                          <Link to="../../../about" />
                        </>
                      }
                    />
                  }
                >
                  <Route path="messages" element={<h1>Messages</h1>} />
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findAllByType("a").map((a) => a.props.href)).toEqual(
        ["/about", "/about"]
      );
    });
  });

  describe("in a splat route", () => {
    test("absolute <Link to> resolves relative to the root URL", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages/123"]}>
            <Routes>
              <Route path="inbox">
                <Route path="messages/*" element={<Link to="/about" />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/about");
    });

    test('<Link to="."> resolves relative to the current route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages/abc"]}>
            <Routes>
              <Route path="inbox">
                <Route path="messages/*" element={<Link to="." />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual(
        "/inbox/messages/abc"
      );
    });

    test('<Link to=".."> resolves relative to the parent route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages/abc"]}>
            <Routes>
              <Route path="inbox">
                <Route path="messages/*" element={<Link to=".." />} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/inbox");
    });

    test("<Link to> pointing to a sibling route resolves relative to its parent route", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages/abc"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  path="messages/*"
                  element={<Link to="../messages/def" />}
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual(
        "/inbox/messages/def"
      );
    });

    test('<Link to=".."> with more .. segments than parent routes resolves to the root URL', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  path="messages/*"
                  element={
                    <>
                      <Link to="../../about" />
                      {/* traverse past the root */}
                      <Link to="../../../about" />
                    </>
                  }
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findAllByType("a").map((a) => a.props.href)).toEqual(
        ["/about", "/about"]
      );
    });
  });

  describe("under a <Router basename>", () => {
    test("absolute <Link to> resolves relative to the basename", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter basename="/app" initialEntries={["/app/inbox"]}>
            <Routes>
              <Route path="inbox" element={<Link to="/about" />} />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/app/about");
    });

    test('<Link to="."> resolves relative to the current route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter basename="/app" initialEntries={["/app/inbox"]}>
            <Routes>
              <Route path="inbox" element={<Link to="." />} />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/app/inbox");
    });

    test('<Link to=".."> with no parent route resolves relative to the basename', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter basename="/app" initialEntries={["/app/inbox"]}>
            <Routes>
              <Route path="inbox" element={<Link to="../about" />} />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/app/about");
    });
  });

  describe("in a descendant <Routes>", () => {
    test("absolute <Link to> resolves relative to the root URL", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/auth/login"]}>
            <Routes>
              <Route
                path="auth/*"
                element={
                  <Routes>
                    <Route
                      path="login"
                      element={<Link to="/auth/forgot-password" />}
                    />
                  </Routes>
                }
              />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual(
        "/auth/forgot-password"
      );
    });

    test('<Link to="."> resolves relative to the current route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/auth/login"]}>
            <Routes>
              <Route
                path="auth/*"
                element={
                  <Routes>
                    <Route path="login" element={<Link to="." />} />
                  </Routes>
                }
              />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/auth/login");
    });

    test('<Link to=".."> resolves relative to the ancestor route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/auth/login"]}>
            <Routes>
              <Route
                path="auth/*"
                element={
                  <Routes>
                    <Route path="login" element={<Link to=".." />} />
                  </Routes>
                }
              />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/auth");
    });

    test('<Link to=".."> with more .. segments than ancestor routes resolves relative to the root URL', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/auth/login"]}>
            <Routes>
              <Route
                path="auth/*"
                element={
                  <Routes>
                    <Route
                      path="login"
                      element={
                        <>
                          <Link to="../../about" />
                          {/* traverse past the root */}
                          <Link to="../../../about" />
                        </>
                      }
                    />
                  </Routes>
                }
              />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findAllByType("a").map((a) => a.props.href)).toEqual(
        ["/about", "/about"]
      );
    });
  });

  describe("when using relative=path", () => {
    test("absolute <Link to> resolves relative to the root URL", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox"]}>
            <Routes>
              <Route
                path="inbox"
                element={<Link to="/about" relative="path" />}
              />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/about");
    });

    test('<Link to="."> resolves relative to the current route', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox"]}>
            <Routes>
              <Route path="inbox" element={<Link to="." relative="path" />} />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual("/inbox");
    });

    test('<Link to=".."> resolves relative to the parent URL segment', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages/1"]}>
            <Routes>
              <Route path="inbox" />
              <Route path="inbox/messages" />
              <Route
                path="inbox/messages/:id"
                element={<Link to=".." relative="path" />}
              />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findByType("a").props.href).toEqual(
        "/inbox/messages"
      );
    });

    test('<Link to=".."> with more .. segments than parent routes resolves to the root URL', () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <MemoryRouter initialEntries={["/inbox/messages"]}>
            <Routes>
              <Route path="inbox">
                <Route
                  path="messages"
                  element={
                    <>
                      <Link to="../../about" relative="path" />
                      {/* traverse past the root */}
                      <Link to="../../../about" relative="path" />
                    </>
                  }
                />
              </Route>
            </Routes>
          </MemoryRouter>
        );
      });

      expect(renderer.root.findAllByType("a").map((a) => a.props.href)).toEqual(
        ["/about", "/about"]
      );
    });
  });

  describe("when using a browser router", () => {
    it("renders proper <a href> for BrowserRouter", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Link to="/path?search=value#hash" />} />
            </Routes>
          </BrowserRouter>
        );
      });
      expect(renderer.root.findByType("a").props.href).toEqual(
        "/path?search=value#hash"
      );
    });

    it("renders proper <a href> for createBrowserRouter", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        let router = createBrowserRouter([
          {
            path: "/",
            element: <Link to="/path?search=value#hash">Link</Link>,
          },
        ]);
        renderer = TestRenderer.create(<RouterProvider router={router} />);
      });
      expect(renderer.root.findByType("a").props.href).toEqual(
        "/path?search=value#hash"
      );
    });
  });

  describe("when using a hash router", () => {
    it("renders proper <a href> for HashRouter", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          <HashRouter>
            <Routes>
              <Route path="/" element={<Link to="/path?search=value#hash" />} />
            </Routes>
          </HashRouter>
        );
      });
      expect(renderer.root.findByType("a").props.href).toEqual(
        "#/path?search=value#hash"
      );
    });

    describe("when using a hash router with noslash", () => {
      it("renders proper <a href> for HashRouter", () => {
        let renderer: TestRenderer.ReactTestRenderer;
        TestRenderer.act(() => {
          renderer = TestRenderer.create(
            <HashRouter hashType="noslash">
              <Routes>
                <Route path="/" element={<Link to="/path?search=value#hash" />} />
              </Routes>
            </HashRouter>
          );
        });
        expect(renderer.root.findByType("a").props.href).toEqual(
          "#path?search=value#hash"
        );
      });

    it("renders proper <a href> for createHashRouter", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        let router = createHashRouter([
          {
            path: "/",
            element: <Link to="/path?search=value#hash">Link</Link>,
          },
        ]);
        renderer = TestRenderer.create(<RouterProvider router={router} />);
      });
      expect(renderer.root.findByType("a").props.href).toEqual(
        "#/path?search=value#hash"
      );
    });

    it("renders proper <a href> for createHashRouter with noslash", () => {
      let renderer: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        let router = createHashRouter([
          {
            path: "/",
            element: <Link to="/path?search=value#hash">Link</Link>,
          },
        ],
        {hashType: 'noslash'});
        renderer = TestRenderer.create(<RouterProvider router={router} />);
      });
      expect(renderer.root.findByType("a").props.href).toEqual(
        "#path?search=value#hash"
      );
    });
  });
});

  test("fails gracefully on invalid `to` values", () => {
    let warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    let renderer: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<Link to="//" />} />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(renderer.root.findByType("a").props.href).toEqual("//");
    expect(warnSpy).toHaveBeenCalledWith(
      '<Link to="//"> contains an invalid URL which will probably break when clicked - please update to a valid URL path.'
    );
    warnSpy.mockRestore();
  });

  test("renders fine when used outside a route context", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <MemoryRouter>
          <Link to="route">Route</Link>
          <Link to="path" relative="path">
            Path
          </Link>
        </MemoryRouter>
      );
    });

    let anchors = renderer.root.findAllByType("a");
    expect(anchors.map((a) => ({ href: a.props.href, text: a.children })))
      .toMatchInlineSnapshot(`
      [
        {
          "href": "/route",
          "text": [
            "Route",
          ],
        },
        {
          "href": "/path",
          "text": [
            "Path",
          ],
        },
      ]
    `);
  });
});
