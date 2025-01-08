import * as React from "react";
import {
  MemoryRouter,
  Routes,
  Route,
  useNavigate,
  BrowserRouter,
  HashRouter,
  createMemoryRouter,
  createRoutesFromElements,
  RouterProvider,
} from "../../index";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { JSDOM } from "jsdom";
import { createDeferred } from "../router/utils/utils";
import getHtml from "../utils/getHtml";

describe("Handles concurrent mode features during navigations", () => {
  function getComponents() {
    function Home() {
      let navigate = useNavigate();
      return (
        <>
          <h1>Home</h1>
          <button onClick={() => navigate("/about")}>/about</button>
          <button onClick={() => navigate("/lazy")}>/lazy</button>
        </>
      );
    }

    let resolved = false;
    let dfd = createDeferred();
    function resolve() {
      resolved = true;
      return dfd.resolve();
    }

    function About() {
      let navigate = useNavigate();
      if (!resolved) {
        throw dfd.promise;
      }
      return (
        <>
          <h1>About</h1>
          <button onClick={() => navigate(-1)}>back</button>
        </>
      );
    }

    let lazyDfd = createDeferred();

    const LazyComponent = React.lazy(async () => {
      await lazyDfd.promise;
      return import("./components/LazyComponent");
    });

    return {
      Home,
      About,
      LazyComponent,
      resolve,
      resolveLazy: lazyDfd.resolve,
    };
  }

  describe("when the destination route suspends with a boundary", () => {
    async function assertNavigation(
      container: HTMLElement,
      resolve: () => void,
      resolveLazy: () => void
    ) {
      // Start on home
      expect(getHtml(container)).toMatch("Home");

      // Click to /about and should see Suspense boundary
      await act(() => {
        fireEvent.click(screen.getByText("/about"));
      });
      await waitFor(() => screen.getByText("Loading..."));
      expect(getHtml(container)).toMatch("Loading...");

      // Resolve the destination UI to clear the boundary
      await act(() => resolve());
      await waitFor(() => screen.getByText("About"));
      expect(getHtml(container)).toMatch("About");

      // Back to home
      await act(() => {
        fireEvent.click(screen.getByText("back"));
      });
      await waitFor(() => screen.getByText("Home"));
      expect(getHtml(container)).toMatch("Home");

      // Click to /lazy and should see Suspense boundary
      await act(() => {
        fireEvent.click(screen.getByText("/lazy"));
      });
      await waitFor(() => screen.getByText("Loading Lazy Component..."));
      expect(getHtml(container)).toMatch("Loading Lazy Component...");

      // Resolve the lazy component to clear the boundary
      await act(() => resolveLazy());
      await waitFor(() => screen.getByText("Lazy"));
      expect(getHtml(container)).toMatch("Lazy");
    }

    // eslint-disable-next-line jest/expect-expect
    it("MemoryRouter", async () => {
      let { Home, About, LazyComponent, resolve, resolveLazy } =
        getComponents();

      let { container } = render(
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route
              path="/about"
              element={
                <React.Suspense fallback={<p>Loading...</p>}>
                  <About />
                </React.Suspense>
              }
            />
            <Route
              path="/lazy"
              element={
                <React.Suspense fallback={<p>Loading Lazy Component...</p>}>
                  <LazyComponent />
                </React.Suspense>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      await assertNavigation(container, resolve, resolveLazy);
    });

    // eslint-disable-next-line jest/expect-expect
    it("BrowserRouter", async () => {
      let { Home, About, LazyComponent, resolve, resolveLazy } =
        getComponents();

      let { container } = render(
        <BrowserRouter window={getWindowImpl("/", false)}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route
              path="/about"
              element={
                <React.Suspense fallback={<p>Loading...</p>}>
                  <About />
                </React.Suspense>
              }
            />
            <Route
              path="/lazy"
              element={
                <React.Suspense fallback={<p>Loading Lazy Component...</p>}>
                  <LazyComponent />
                </React.Suspense>
              }
            />
          </Routes>
        </BrowserRouter>
      );

      await assertNavigation(container, resolve, resolveLazy);
    });

    // eslint-disable-next-line jest/expect-expect
    it("HashRouter", async () => {
      let { Home, About, LazyComponent, resolve, resolveLazy } =
        getComponents();

      let { container } = render(
        <HashRouter window={getWindowImpl("/", true)}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route
              path="/about"
              element={
                <React.Suspense fallback={<p>Loading...</p>}>
                  <About />
                </React.Suspense>
              }
            />
            <Route
              path="/lazy"
              element={
                <React.Suspense fallback={<p>Loading Lazy Component...</p>}>
                  <LazyComponent />
                </React.Suspense>
              }
            />
          </Routes>
        </HashRouter>
      );

      await assertNavigation(container, resolve, resolveLazy);
    });
    // eslint-disable-next-line jest/expect-expect
    it("HashRouter with noslash", async () => {
      let { Home, About, LazyComponent, resolve, resolveLazy } =
        getComponents();

      let { container } = render(
        <HashRouter
          window={getWindowImpl("/", true)}
          hashType="noslash"
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route
              path="/about"
              element={
                <React.Suspense fallback={<p>Loading...</p>}>
                  <About />
                </React.Suspense>
              }
            />
            <Route
              path="/lazy"
              element={
                <React.Suspense fallback={<p>Loading Lazy Component...</p>}>
                  <LazyComponent />
                </React.Suspense>
              }
            />
          </Routes>
        </HashRouter>
      );

      await assertNavigation(container, resolve, resolveLazy);
    });

    // eslint-disable-next-line jest/expect-expect
    it("RouterProvider", async () => {
      let { Home, About, LazyComponent, resolve, resolveLazy } =
        getComponents();

      let router = createMemoryRouter(
        createRoutesFromElements(
          <>
            <Route path="/" element={<Home />} />
            <Route
              path="/about"
              element={
                <React.Suspense fallback={<p>Loading...</p>}>
                  <About />
                </React.Suspense>
              }
            />
            <Route
              path="/lazy"
              element={
                <React.Suspense fallback={<p>Loading Lazy Component...</p>}>
                  <LazyComponent />
                </React.Suspense>
              }
            />
          </>
        )
      );
      let { container } = render(<RouterProvider router={router} />);

      await assertNavigation(container, resolve, resolveLazy);
    });
  });

  describe("when the destination route suspends without a boundary", () => {
    async function assertNavigation(
      container: HTMLElement,
      resolve: () => void,
      resolveLazy: () => void
    ) {
      // Start on home
      expect(getHtml(container)).toMatch("Home");

      // Click to /about and should see the frozen current UI
      await act(() => {
        fireEvent.click(screen.getByText("/about"));
      });
      await waitFor(() => screen.getByText("Home"));
      expect(getHtml(container)).toMatch("Home");

      // Resolve the destination UI to clear the boundary
      await act(() => resolve());
      await waitFor(() => screen.getByText("About"));
      expect(getHtml(container)).toMatch("About");

      // Back to home
      await act(() => {
        fireEvent.click(screen.getByText("back"));
      });
      await waitFor(() => screen.getByText("Home"));
      expect(getHtml(container)).toMatch("Home");

      // Click to /lazy and should see the frozen current UI
      await act(() => {
        fireEvent.click(screen.getByText("/lazy"));
      });
      await waitFor(() => screen.getByText("Home"));
      expect(getHtml(container)).toMatch("Home");

      // Resolve the lazy component to clear the boundary
      await act(() => resolveLazy());
      await waitFor(() => screen.getByText("Lazy"));
      expect(getHtml(container)).toMatch("Lazy");
    }
    // eslint-disable-next-line jest/expect-expect
    it("MemoryRouter", async () => {
      let { Home, About, resolve, LazyComponent, resolveLazy } =
        getComponents();

      let { container } = render(
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/lazy" element={<LazyComponent />} />
          </Routes>
        </MemoryRouter>
      );

      await assertNavigation(container, resolve, resolveLazy);
    });

    // eslint-disable-next-line jest/expect-expect
    it("HashRouter with noslash", async () => {
      let { Home, About, resolve, LazyComponent, resolveLazy } =
        getComponents();

      let { container } = render(
        <HashRouter
          window={getWindowImpl("/", true)}
          hashType="noslash"
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/lazy" element={<LazyComponent />} />
          </Routes>
        </HashRouter>
      );

      await assertNavigation(container, resolve, resolveLazy);
    });

    // eslint-disable-next-line jest/expect-expect
    it("BrowserRouter", async () => {
      let { Home, About, resolve, LazyComponent, resolveLazy } =
        getComponents();

      let { container } = render(
        <BrowserRouter window-={getWindowImpl("/", true)}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/lazy" element={<LazyComponent />} />
          </Routes>
        </BrowserRouter>
      );

      await assertNavigation(container, resolve, resolveLazy);
    });

    // eslint-disable-next-line jest/expect-expect
    it("HashRouter", async () => {
      let { Home, About, resolve, LazyComponent, resolveLazy } =
        getComponents();

      let { container } = render(
        <HashRouter window-={getWindowImpl("/", true)}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/lazy" element={<LazyComponent />} />
          </Routes>
        </HashRouter>
      );

      await assertNavigation(container, resolve, resolveLazy);
    });

    // eslint-disable-next-line jest/expect-expect
    it("RouterProvider", async () => {
      let { Home, About, resolve, LazyComponent, resolveLazy } =
        getComponents();

      let router = createMemoryRouter(
        createRoutesFromElements(
          <>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/lazy" element={<LazyComponent />} />
          </>
        )
      );
      let { container } = render(<RouterProvider router={router} />);

      await assertNavigation(container, resolve, resolveLazy);
    });
  });
});

function getWindowImpl(initialUrl: string, isHash = false): Window {
  // Need to use our own custom DOM in order to get a working history
  const dom = new JSDOM(`<!DOCTYPE html>`, { url: "http://localhost/" });
  dom.window.history.replaceState(null, "", (isHash ? "#" : "") + initialUrl);
  return dom.window as unknown as Window;
}
