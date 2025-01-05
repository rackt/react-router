import { createBrowserRouter } from "react-router";
import { cleanup } from "./utils/data-router-setup";
import { useEffect } from "react";
import React from "react";
import { useFetcher } from "../../lib/dom/lib";
import { render, screen, waitFor } from "@testing-library/react";
import { RouterProvider } from "../../lib/components";
import { sleep } from "./utils/utils";

describe("cancel-loader", () => {
  afterEach(() => cleanup());

  it("checks ShouldRevalidate before cancelling and calling loader again", async () => {
    let loaderData = "";

    const Comp = () => {
      const fetch1 = useFetcher();
      const fetch2 = useFetcher();

      useEffect(() => {
        fetch1.load("/loader");
      }, []);

      useEffect(() => {
        fetch2.submit(null, { method: "POST", action: "/action" });
      }, []);

      useEffect(() => {
        loaderData = fetch1.data;
      }, [fetch1.data]);

      return <div>something: {fetch1.data}</div>;
    };

    const testingLoaderFun = jest.fn(async () => {
      await sleep(1500);
      return "good info";
    });

    let router = createBrowserRouter([
      {
        path: "/",
        element: <Comp />,
      },
      {
        path: "/loader",
        shouldRevalidate: () => false,
        loader: testingLoaderFun,
      },
      {
        path: "/action",
        action: () => null,
      },
    ]);

    render(<RouterProvider router={router} />);
    // Don't know how to properly set up tests, sorry
    // This waits for everything to run and get resolved
    await sleep(3000);
    await waitFor(() =>
      expect(screen.getByText(/something:[\S\s]*good info/)).toBeTruthy()
    );

    // Fetcher should not get cancelled nor revalidated, so just 1 call
    expect(testingLoaderFun).toHaveBeenCalledTimes(1);
    // Verify the loader data to be resolved
    expect(loaderData).toBe("good info");
  });

  it("aborts a loader if not explicitly set", async () => {
    let loaderData = "";

    const Comp = () => {
      const fetch1 = useFetcher();
      const fetch2 = useFetcher();

      useEffect(() => {
        fetch1.load("/loader");
      }, []);

      useEffect(() => {
        fetch2.submit(null, { method: "POST", action: "/action" });
      }, []);

      useEffect(() => {
        loaderData = fetch1.data;
      }, [fetch1.data]);

      return <div>something: {fetch1.data}</div>;
    };

    const testingLoaderFun = jest.fn(async () => {
      await sleep(1500);
      return "good info";
    });

    let router = createBrowserRouter([
      {
        path: "/",
        element: <Comp />,
      },
      {
        path: "/loader",
        shouldRevalidate: () => true,
        loader: testingLoaderFun,
      },
      {
        path: "/action",
        action: () => null,
      },
    ]);

    render(<RouterProvider router={router} />);

    await sleep(3000);
    await waitFor(() =>
      expect(screen.getByText(/something:[\S\s]*good info/)).toBeTruthy()
    );

    // Normal behaviour still preserved, call1 cancelled, call2 resolved
    expect(testingLoaderFun).toHaveBeenCalledTimes(2);
    expect(loaderData).toBe("good info");
  });

  it("aborts some loaders and preserves some others", async () => {
    let loaderData = "";

    const Comp = () => {
      const fetchAction = useFetcher();
      const fetchLoader1 = useFetcher();
      const fetchLoader2 = useFetcher();
      const fetchLoader3 = useFetcher();
      const fetchLoader4 = useFetcher();
      const fetchLoader5 = useFetcher();
      const fetchLoader6 = useFetcher();

      useEffect(() => {
        fetchLoader1.load("/loader1");
        fetchLoader2.load("/loader2");
        fetchLoader3.load("/loader3");
        fetchLoader4.load("/loader4");
        fetchLoader5.load("/loader5");
        fetchLoader6.load("/loader6");
      }, []);

      useEffect(() => {
        fetchAction.submit(null, { method: "POST", action: "/action" });
      }, []);

      useEffect(() => {
        loaderData = `${fetchLoader1.data}, ${fetchLoader2.data}, ${fetchLoader3.data}`;
      }, [fetchLoader1.data, fetchLoader2.data, fetchLoader3.data]);

      return <div>something: {loaderData}</div>;
    };

    const fnArray: jest.Mock<Promise<string>, [], any>[] = [];
    for (let i = 1; i <= 6; i++) {
      const testingLoaderFun = jest.fn(async () => {
        await sleep(1500);

        return "load-" + i;
      });
      fnArray.push(testingLoaderFun);
    }

    let router = createBrowserRouter([
      {
        path: "/",
        element: <Comp />,
      },
      {
        path: "/loader1",
        shouldRevalidate: () => false,
        loader: fnArray[0],
      },
      {
        path: "/loader2",
        shouldRevalidate: () => false,
        loader: fnArray[1],
      },
      {
        path: "/loader3",
        shouldRevalidate: () => false,
        loader: fnArray[2],
      },
      {
        path: "/loader4",
        shouldRevalidate: () => true,
        loader: fnArray[3],
      },
      {
        path: "/loader5",
        shouldRevalidate: () => true,
        loader: fnArray[4],
      },
      {
        path: "/loader6",
        shouldRevalidate: () => true,
        loader: fnArray[5],
      },
      {
        path: "/action",
        action: () => null,
      },
    ]);

    render(<RouterProvider router={router} />);
    await sleep(3000);

    await waitFor(() =>
      expect(
        screen.getByText(/something:[\S\s]*(load-\d(, )?){1,3}/)
      ).toBeTruthy()
    );

    for (let i = 0; i < 6; i++) {
      expect(fnArray[i]).toHaveBeenCalledTimes(i > 2 ? 2 : 1);
    }
    expect(loaderData).toBe(`load-1, load-2, load-3`);
  });

  // TODO: test with nested loaders
  // TODO: test redirections inside loader/action
  // TODO: test errors inside loader/action
});
