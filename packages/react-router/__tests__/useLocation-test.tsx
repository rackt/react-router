import * as React from "react";
import * as TestRenderer from "react-test-renderer";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import type { Equal, Expect } from "@remix-run/router/__tests__/utils/utils";

function ShowLocation() {
  let location = useLocation();
  return <pre>{JSON.stringify(location)}</pre>;
}

describe("useLocation", () => {
  it("returns the current location object", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <MemoryRouter initialEntries={["/home?the=search#the-hash"]}>
          <Routes>
            <Route path="/home" element={<ShowLocation />} />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(renderer.toJSON()).toMatchInlineSnapshot(`
      <pre>
        {"pathname":"/home","search":"?the=search","hash":"#the-hash","state":null,"key":"default"}
      </pre>
    `);
  });

  it("returns the scoped location object when nested in <Routes location>", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <MemoryRouter initialEntries={["/home?the=search#the-hash"]}>
          <App />
        </MemoryRouter>
      );
    });

    function App() {
      return (
        <div>
          <Routes>
            <Route path="/home" element={<ShowLocation />} />
          </Routes>
          <Routes location="/scoped?scoped=search#scoped-hash">
            <Route path="/scoped" element={<ShowLocation />} />
          </Routes>
        </div>
      );
    }

    expect(renderer.toJSON()).toMatchInlineSnapshot(`
      <div>
        <pre>
          {"pathname":"/home","search":"?the=search","hash":"#the-hash","state":null,"key":"default"}
        </pre>
        <pre>
          {"pathname":"/scoped","search":"?scoped=search","hash":"#scoped-hash","state":null,"key":"default"}
        </pre>
      </div>
    `);
  });

  it("preserves state from initialEntries", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <MemoryRouter
          initialEntries={[
            { pathname: "/example", state: { my: "state" }, key: "my-key" },
          ]}
        >
          <Routes>
            <Route path={"/example"} element={<ShowLocation />} />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(renderer.toJSON()).toMatchInlineSnapshot(`
      <pre>
        {"pathname":"/example","search":"","hash":"","state":{"my":"state"},"key":"my-key"}
      </pre>
    `);
  });

  // eslint-disable-next-line jest/expect-expect -- type tests
  it("returns an object with the correct type", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used for type tests
    function TestUseLocationReturnType() {
      let location = useLocation();

      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- type test
      type Test1 = Expect<Equal<typeof location.hash, "" | `#${string}`>>;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- type test
      type Test2 = Expect<Equal<typeof location.pathname, "" | `/${string}`>>;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- type test
      type Test3 = Expect<Equal<typeof location.search, "" | `?${string}`>>;

      return null;
    }
  });
});
