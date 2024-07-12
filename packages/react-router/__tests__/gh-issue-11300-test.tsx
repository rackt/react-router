import * as React from "react";
import type {
  Dispatch,
  ReactNode,
  SetStateAction} from "react";
import {
  createContext,
  useContext,
  useState,
} from "react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
  useLoaderData,
} from "react-router";
import {
  act,
  fireEvent,
  getByRole,
  getByText,
  render,
  waitFor,
} from "@testing-library/react";
import { createDeferred } from "../../router/__tests__/utils/utils";

type Environment = {
  id: number;
};

type Query = {
  environment: Environment;
};

type State<A> = [A, Dispatch<SetStateAction<A>>];

describe("GH Issue #11300", () => {
  it("works", async () => {
    const EnvironmentContext = createContext<State<Environment> | undefined>(
      undefined
    );

    function useEnvironment(): Environment {
      const environmentState = useContext(EnvironmentContext);
      if (environmentState === undefined)
        throw new Error("EnvironmentContext.Provider is missing");
      return environmentState[0];
    }

    let environmentId = 0;

    function createEnvironment(): Environment {
      return {
        id: ++environmentId,
      };
    }

    function useCreateNewEnvironment(): () => void {
      const environmentState = useContext(EnvironmentContext);
      if (environmentState === undefined)
        throw new Error("EnvironmentContext.Provider is missing");
      return () => environmentState[1](createEnvironment());
    }

    function MutableEnvironment({ children }: { children: ReactNode }) {
      const environmentState = useState<Environment>(createEnvironment);
      return (
        <EnvironmentContext.Provider value={environmentState}>
          {children}
        </EnvironmentContext.Provider>
      );
    }

    function loadQuery(environment: Environment): Query {
      return { environment };
    }

    function useQuery(query: Query): string {
      const environment = useEnvironment();
      if (query.environment.id !== environment.id)
        throw new Error(
          "Query environment does not match environment from the context"
        );
      return `Data... (environment.id = ${environment.id})`;
    }

    function MyPage() {
      const query = useLoaderData() as Query;
      const data = useQuery(query);
      const createNewEnvironment = useCreateNewEnvironment();
      return (
        <>
          <p>{data}</p>
          <button onClick={createNewEnvironment}>Create new environment</button>
        </>
      );
    }

    function MyRouter() {
      const environment = useEnvironment();
      let router = createMemoryRouter(
        createRoutesFromElements(
          <Route
            path="/"
            loader={() => loadQuery(environment)}
            element={<MyPage />}
          />
        )
      );
      return <RouterProvider router={router} />;
    }

    let { container } = render(
      <MutableEnvironment>
        <MyRouter />
      </MutableEnvironment>
    );

    // Somehow this avoids:
    //  Warning: An update to RouterProvider inside a test was not wrapped in act(...).
    // I suspect that it has something to do with the way completeNavigation runs
    // asynchronously and will yield to render.
    let fooDefer = createDeferred();
    await act(() => fooDefer.resolve(123));

    expect(getByText(container, "Data... (environment.id = 1)")).toBeDefined();

    fireEvent.click(getByRole(container, "button"));

    await waitFor(() => {
      expect(
        getByText(container, "Data... (environment.id = 2)")
      ).toBeDefined();
    });
  });
});
