import type { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

import { UNSAFE_ServerMode as ServerMode } from "react-router";
import {
  createAppFixture,
  createFixture,
  js,
} from "./helpers/create-fixture.js";
import type { Fixture, AppFixture } from "./helpers/create-fixture.js";
import { PlaywrightFixture } from "./helpers/playwright-fixture.js";

test.describe("ErrorBoundary", () => {
  let fixture: Fixture;
  let appFixture: AppFixture;
  let oldConsoleError: () => void;

  test.beforeAll(async () => {
    fixture = await createFixture({
      files: {
        "app/root.tsx": js`
          import { Links, Meta, Outlet, Scripts } from "react-router";

          export default function Root() {
            return (
              <html lang="en">
                <head>
                  <Meta />
                  <Links />
                </head>
                <body>
                  <main>
                    <Outlet />
                  </main>
                  <Scripts />
                </body>
              </html>
            );
          }
        `,

        "app/routes/parent.tsx": js`
          import { useEffect } from "react";
          import {
            Link,
            Outlet,
            isRouteErrorResponse,
            useLoaderData,
            useRouteError,
          } from "react-router";

          export function loader({ request }) {
            const url = new URL(request.url);
            return {message: "PARENT LOADER", error: url.searchParams.has('error') };
          }

          export default function Component({ loaderData }) {
            useEffect(() => {
              let ogFetch = window.fetch;
              if (loaderData.error) {
                window.fetch = async (...args) => {
                  return new Response('CDN Error!', { status: 500 });
                };

                return () => {
                  window.fetch = ogFetch;
                };
              }
            }, [loaderData.error]);

            return (
              <div>
                <nav>
                  <ul>
                    <li><Link to="/parent/child-with-boundary">Link</Link></li>
                    <li><Link to="/parent/child-with-boundary?type=error">Link</Link></li>
                    <li><Link to="/parent/child-with-boundary?type=response">Link</Link></li>
                    <li><Link to="/parent/child-with-boundary?type=render">Link</Link></li>
                    <li><Link to="/parent/child-without-boundary?type=error">Link</Link></li>
                    <li><Link to="/parent/child-without-boundary?type=response">Link</Link></li>
                    <li><Link to="/parent/child-without-boundary?type=render">Link</Link></li>
                  </ul>
                </nav>
                <p id="parent-data">{loaderData.message}</p>
                <Outlet />
              </div>
            )
          }

          export function ErrorBoundary() {
            let error = useRouteError();
            return isRouteErrorResponse(error) ?
              <p id="parent-error-response">{error.status + ' ' + error.data}</p> :
              <p id="parent-error">{error.message}</p>;
          }
        `,

        "app/routes/parent.child-with-boundary.tsx": js`
          import {
            isRouteErrorResponse,
            useLoaderData,
            useLocation,
            useRouteError,
          } from "react-router";

          export function loader({ request }) {
            let errorType = new URL(request.url).searchParams.get('type');
            if (errorType === 'response') {
              throw new Response('Loader Response', { status: 418 });
            } else if (errorType === 'error') {
              throw new Error('Loader Error');
            }
            return "CHILD LOADER";
          }

          export default function Component() {;
            let data = useLoaderData();
            if (new URLSearchParams(useLocation().search).get('type') === "render") {
              throw new Error("Render Error");
            }
            return <p id="child-data">{data}</p>;
          }

          export function ErrorBoundary() {
            let error = useRouteError();
            return isRouteErrorResponse(error) ?
              <p id="child-error-response">{error.status + ' ' + error.data}</p> :
              <p id="child-error">{error.message}</p>;
          }
        `,

        "app/routes/parent.child-without-boundary.tsx": js`
          import { useLoaderData, useLocation } from "react-router";

          export function loader({ request }) {
            let errorType = new URL(request.url).searchParams.get('type');
            if (errorType === 'response') {
              throw new Response('Loader Response', { status: 418 });
            } else if (errorType === 'error') {
              throw new Error('Loader Error');
            }
            return "CHILD LOADER";
          }

          export default function Component() {;
            let data = useLoaderData();
            if (new URLSearchParams(useLocation().search).get('type') === "render") {
              throw new Error("Render Error");
            }
            return <p id="child-data">{data}</p>;
          }
        `,
      },
    });

    appFixture = await createAppFixture(fixture, ServerMode.Development);
  });

  test.afterAll(() => {
    appFixture.close();
  });

  test.beforeEach(({ page }) => {
    oldConsoleError = console.error;
    console.error = () => {};
  });

  test.afterEach(() => {
    console.error = oldConsoleError;
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    runBoundaryTests();
  });

  test.describe("with JavaScript", () => {
    test.use({ javaScriptEnabled: true });
    runBoundaryTests();

    test("Network errors that never reach the Remix server", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      // Cause a .data request to trigger an HTTP error that never reaches the
      // Remix server, and ensure we properly handle it at the ErrorBoundary
      await app.goto("/parent?error");
      await app.clickLink("/parent/child-with-boundary");
      await waitForAndAssert(page, app, "#parent-error", "500");
    });
  });

  function runBoundaryTests() {
    test("No errors", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-with-boundary");
      await waitForAndAssert(page, app, "#child-data", "CHILD LOADER");
    });

    test("Throwing a Response to own boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-with-boundary?type=response");
      await waitForAndAssert(
        page,
        app,
        "#child-error-response",
        "418 Loader Response"
      );
    });

    test("Throwing an Error to own boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-with-boundary?type=error");
      await waitForAndAssert(page, app, "#child-error", "Loader Error");
    });

    test("Throwing a render error to own boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-with-boundary?type=render");
      await waitForAndAssert(page, app, "#child-error", "Render Error");
    });

    test("Throwing a Response to parent boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-without-boundary?type=response");
      await waitForAndAssert(
        page,
        app,
        "#parent-error-response",
        "418 Loader Response"
      );
    });

    test("Throwing an Error to parent boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-without-boundary?type=error");
      await waitForAndAssert(page, app, "#parent-error", "Loader Error");
    });

    test("Throwing a render error to parent boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-without-boundary?type=render");
      await waitForAndAssert(page, app, "#parent-error", "Render Error");
    });
  }
});

test.describe("ErrorBoundary turboV3", () => {
  let fixture: Fixture;
  let appFixture: AppFixture;
  let oldConsoleError: () => void;

  test.beforeAll(async () => {
    fixture = await createFixture({
      turboV3: true,
      files: {
        "app/root.tsx": js`
          import { Links, Meta, Outlet, Scripts } from "react-router";

          export default function Root() {
            return (
              <html lang="en">
                <head>
                  <Meta />
                  <Links />
                </head>
                <body>
                  <main>
                    <Outlet />
                  </main>
                  <Scripts />
                </body>
              </html>
            );
          }
        `,

        "app/routes/parent.tsx": js`
          import { useEffect } from "react";
          import {
            Link,
            Outlet,
            isRouteErrorResponse,
            useLoaderData,
            useRouteError,
          } from "react-router";

          export function loader({ request }) {
            const url = new URL(request.url);
            return {message: "PARENT LOADER", error: url.searchParams.has('error') };
          }

          export default function Component({ loaderData }) {
            useEffect(() => {
              let ogFetch = window.fetch;
              if (loaderData.error) {
                window.fetch = async (...args) => {
                  return new Response('CDN Error!', { status: 500 });
                };

                return () => {
                  window.fetch = ogFetch;
                };
              }
            }, [loaderData.error]);

            return (
              <div>
                <nav>
                  <ul>
                    <li><Link to="/parent/child-with-boundary">Link</Link></li>
                    <li><Link to="/parent/child-with-boundary?type=error">Link</Link></li>
                    <li><Link to="/parent/child-with-boundary?type=response">Link</Link></li>
                    <li><Link to="/parent/child-with-boundary?type=render">Link</Link></li>
                    <li><Link to="/parent/child-without-boundary?type=error">Link</Link></li>
                    <li><Link to="/parent/child-without-boundary?type=response">Link</Link></li>
                    <li><Link to="/parent/child-without-boundary?type=render">Link</Link></li>
                  </ul>
                </nav>
                <p id="parent-data">{loaderData.message}</p>
                <Outlet />
              </div>
            )
          }

          export function ErrorBoundary() {
            let error = useRouteError();
            return isRouteErrorResponse(error) ?
              <p id="parent-error-response">{error.status + ' ' + error.data}</p> :
              <p id="parent-error">{error.message}</p>;
          }
        `,

        "app/routes/parent.child-with-boundary.tsx": js`
          import {
            isRouteErrorResponse,
            useLoaderData,
            useLocation,
            useRouteError,
          } from "react-router";

          export function loader({ request }) {
            let errorType = new URL(request.url).searchParams.get('type');
            if (errorType === 'response') {
              throw new Response('Loader Response', { status: 418 });
            } else if (errorType === 'error') {
              throw new Error('Loader Error');
            }
            return "CHILD LOADER";
          }

          export default function Component() {;
            let data = useLoaderData();
            if (new URLSearchParams(useLocation().search).get('type') === "render") {
              throw new Error("Render Error");
            }
            return <p id="child-data">{data}</p>;
          }

          export function ErrorBoundary() {
            let error = useRouteError();
            return isRouteErrorResponse(error) ?
              <p id="child-error-response">{error.status + ' ' + error.data}</p> :
              <p id="child-error">{error.message}</p>;
          }
        `,

        "app/routes/parent.child-without-boundary.tsx": js`
          import { useLoaderData, useLocation } from "react-router";

          export function loader({ request }) {
            let errorType = new URL(request.url).searchParams.get('type');
            if (errorType === 'response') {
              throw new Response('Loader Response', { status: 418 });
            } else if (errorType === 'error') {
              throw new Error('Loader Error');
            }
            return "CHILD LOADER";
          }

          export default function Component() {;
            let data = useLoaderData();
            if (new URLSearchParams(useLocation().search).get('type') === "render") {
              throw new Error("Render Error");
            }
            return <p id="child-data">{data}</p>;
          }
        `,
      },
    });

    appFixture = await createAppFixture(fixture, ServerMode.Development);
  });

  test.afterAll(() => {
    appFixture.close();
  });

  test.beforeEach(({ page }) => {
    oldConsoleError = console.error;
    console.error = () => {};
  });

  test.afterEach(() => {
    console.error = oldConsoleError;
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    runBoundaryTests();
  });

  test.describe("with JavaScript", () => {
    test.use({ javaScriptEnabled: true });
    runBoundaryTests();

    test("Network errors that never reach the Remix server", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      // Cause a .data request to trigger an HTTP error that never reaches the
      // Remix server, and ensure we properly handle it at the ErrorBoundary
      await app.goto("/parent?error");
      await app.clickLink("/parent/child-with-boundary");
      await waitForAndAssert(page, app, "#parent-error", "500");
    });
  });

  function runBoundaryTests() {
    test("No errors", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-with-boundary");
      await waitForAndAssert(page, app, "#child-data", "CHILD LOADER");
    });

    test("Throwing a Response to own boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-with-boundary?type=response");
      await waitForAndAssert(
        page,
        app,
        "#child-error-response",
        "418 Loader Response"
      );
    });

    test("Throwing an Error to own boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-with-boundary?type=error");
      await waitForAndAssert(page, app, "#child-error", "Loader Error");
    });

    test("Throwing a render error to own boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-with-boundary?type=render");
      await waitForAndAssert(page, app, "#child-error", "Render Error");
    });

    test("Throwing a Response to parent boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-without-boundary?type=response");
      await waitForAndAssert(
        page,
        app,
        "#parent-error-response",
        "418 Loader Response"
      );
    });

    test("Throwing an Error to parent boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-without-boundary?type=error");
      await waitForAndAssert(page, app, "#parent-error", "Loader Error");
    });

    test("Throwing a render error to parent boundary", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent");
      await app.clickLink("/parent/child-without-boundary?type=render");
      await waitForAndAssert(page, app, "#parent-error", "Render Error");
    });
  }
});

// Shorthand util to wait for an element to appear before asserting it
async function waitForAndAssert(
  page: Page,
  app: PlaywrightFixture,
  selector: string,
  match: string
) {
  await page.waitForSelector(selector);
  expect(await app.getHtml(selector)).toMatch(match);
}
