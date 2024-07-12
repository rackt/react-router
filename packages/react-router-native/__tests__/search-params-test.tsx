import * as React from "react";
import { View, Text, TextInput } from "react-native";
import type {
  SetURLSearchParams} from "react-router-native";
import {
  NativeRouter,
  Routes,
  Route,
  useSearchParams
} from "react-router-native";
import * as TestRenderer from "react-test-renderer";

describe("useSearchParams", () => {
  function SearchForm({
    children,
  }: {
    children: React.ReactNode;
    onSubmit?: any;
  }) {
    return <View>{children}</View>;
  }

  function Button({ children }: { children: React.ReactNode; onClick?: any }) {
    return <View>{children}</View>;
  }

  it("reads and writes the search string", async () => {
    function SearchPage() {
      let [searchParams, setSearchParams] = useSearchParams({ q: "" });
      let [query, setQuery] = React.useState(searchParams.get("q")!);

      function handleSubmit() {
        setSearchParams({ q: query });
      }

      return (
        <View>
          <Text>The current query is "{searchParams.get("q")}".</Text>

          <SearchForm onSubmit={handleSubmit}>
            <TextInput value={query} onChangeText={setQuery} />
          </SearchForm>
        </View>
      );
    }

    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <NativeRouter initialEntries={["/search?q=Michael+Jackson"]}>
          <Routes>
            <Route path="search" element={<SearchPage />} />
          </Routes>
        </NativeRouter>
      );
    });

    expect(renderer!.toJSON()).toMatchSnapshot();

    await TestRenderer.act(() => {
      let textInput = renderer.root.findByType(TextInput);
      textInput.props.onChangeText("Ryan Florence");
    });

    await TestRenderer.act(() => {
      let searchForm = renderer.root.findByType(SearchForm);
      searchForm.props.onSubmit();
    });

    expect(renderer!.toJSON()).toMatchSnapshot();
  });

  it("reads and writes the search string (functional update)", async () => {
    function SearchPage() {
      let [searchParams, setSearchParams] = useSearchParams({ q: "" });
      let [query, setQuery] = React.useState(searchParams.get("q")!);

      function handleSubmit() {
        setSearchParams((cur) => {
          cur.set("q", `${cur.get("q")} - appended`);
          cur.set("new", "Ryan Florence");
          return cur;
        });
      }

      return (
        <View>
          <Text>The current query is "{searchParams.get("q")}".</Text>
          <Text>The new query is "{searchParams.get("new")}".</Text>

          <SearchForm onSubmit={handleSubmit}>
            <TextInput value={query} onChangeText={setQuery} />
          </SearchForm>
        </View>
      );
    }

    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <NativeRouter initialEntries={["/search?q=Michael+Jackson"]}>
          <Routes>
            <Route path="search" element={<SearchPage />} />
          </Routes>
        </NativeRouter>
      );
    });

    expect(renderer!.toJSON()).toMatchSnapshot();

    TestRenderer.act(() => {
      let searchForm = renderer.root.findByType(SearchForm);
      searchForm.props.onSubmit();
    });

    expect(renderer!.toJSON()).toMatchSnapshot();
  });

  it("allows removal of search params when a default is provided", async () => {
    function SearchPage() {
      let [searchParams, setSearchParams] = useSearchParams({
        value: "initial",
      });

      return (
        <View>
          <Text>The current query is "{searchParams.get("value")}".</Text>
          <Button onClick={() => setSearchParams({})}>Click</Button>
        </View>
      );
    }

    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <NativeRouter initialEntries={["/search?value=initial"]}>
          <Routes>
            <Route path="search" element={<SearchPage />} />
          </Routes>
        </NativeRouter>
      );
    });

    expect(renderer!.toJSON()).toMatchSnapshot();

    await TestRenderer.act(() => {
      let button = renderer.root.findByType(Button);
      button.props.onClick();
    });

    expect(renderer!.toJSON()).toMatchSnapshot();
  });

  it("does not modify the setSearchParams reference when the searchParams change", async () => {
    interface TestParams {
      incrementParamsUpdateCount: () => number;
      incrementSetterUpdateCount: () => number;
    }

    function TestComponent(params: Readonly<TestParams>) {
      const { incrementParamsUpdateCount, incrementSetterUpdateCount } = params;
      const lastParamsRef = React.useRef<URLSearchParams>();
      const lastSetterRef = React.useRef<SetURLSearchParams>();
      const [searchParams, setSearchParams] = useSearchParams({ q: "" });
      const [query] = React.useState(searchParams.get("q")!);

      React.useEffect(() => {
        lastParamsRef.current = searchParams;
        incrementParamsUpdateCount();
      }, [searchParams, incrementParamsUpdateCount]);

      React.useEffect(() => {
        lastSetterRef.current = setSearchParams;
        incrementSetterUpdateCount();
      }, [setSearchParams, incrementSetterUpdateCount]);

      function handleSubmit() {
        setSearchParams(cur => {
          cur.set("q", `${cur.get("q")} - appended`);
          return cur;
        });
      }

      return (
        <View>
          <SearchForm onSubmit={handleSubmit}>
            <TextInput value={query} /*onChangeText={setQuery}*/ />
          </SearchForm>
        </View>
      );
    }

    function TestApp(params: TestParams) {
      return (
        <NativeRouter initialEntries={["/search?q=Michael+Jackson"]}>
          <Routes>
            <Route path="search" element={<TestComponent {...params} />} />
          </Routes>
        </NativeRouter>
      );
    }

    const state = {
      paramsUpdateCount: 0,
      setterUpdateCount: 0
    };

    const params: TestParams = {
      incrementParamsUpdateCount: () => ++state.paramsUpdateCount,
      incrementSetterUpdateCount: () => ++state.setterUpdateCount
    };

    // Initial Rendering of the TestApp
    // The TestComponent should increment both the paramsUpdateCount and setterUpdateCount to 1
    let renderer: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(<TestApp {...params}/>);
    });

    expect(state.paramsUpdateCount).toEqual(1);
    expect(state.setterUpdateCount).toEqual(1);

    // Modify the search params via the form in the TestComponent.
    // This should trigger a re-render of the component and update the paramsUpdateCount (only)
    const searchForm = renderer!.root.findByType(SearchForm);
    TestRenderer.act(() => {
      searchForm.props.onSubmit();
    });

    expect(state.paramsUpdateCount).toEqual(2);
    expect(state.setterUpdateCount).toEqual(1);

    // Third Times The Charm 
    // Verifies that the setter is still valid now that we aren't regenerating each time the
    // searchParams reference changes
    TestRenderer.act(() => {
      searchForm.props.onSubmit();
    });

    expect(state.paramsUpdateCount).toEqual(3);
    expect(state.setterUpdateCount).toEqual(1);
  });
});
