import { test, expect } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";

import { PlaywrightFixture } from "./helpers/playwright-fixture.js";
import type { Fixture, AppFixture } from "./helpers/create-fixture.js";
import {
  createAppFixture,
  createFixture,
  js,
} from "./helpers/create-fixture.js";

const ROOT_ID = "ROOT_ID";
const INDEX_ID = "INDEX_ID";
const DEFERRED_ID = "DEFERRED_ID";
const RESOLVED_DEFERRED_ID = "RESOLVED_DEFERRED_ID";
const FALLBACK_ID = "FALLBACK_ID";
const ERROR_ID = "ERROR_ID";
const ERROR_BOUNDARY_ID = "ERROR_BOUNDARY_ID";
const MANUAL_RESOLVED_ID = "MANUAL_RESOLVED_ID";
const MANUAL_FALLBACK_ID = "MANUAL_FALLBACK_ID";
const MANUAL_ERROR_ID = "MANUAL_ERROR_ID";

let originalConsoleError: typeof console.error;

declare global {
  var __deferredManualResolveCache: {
    nextId: number;
    deferreds: Record<
      string,
      { resolve: (value: any) => void; reject: (error: Error) => void }
    >;
  };
}

test.describe("turbo-stream-v2", () => {
  test.describe("non-aborted", () => {
    let fixture: Fixture;
    let appFixture: AppFixture;

    test.beforeEach(async ({ context }) => {
      await context.route(/.data/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        route.continue();
      });
    });

    test.beforeAll(async () => {
      fixture = await createFixture({
        files: {
          "app/components/counter.tsx": js`
          import { useState } from "react";

          export default function Counter({ id }) {
            let [count, setCount] = useState(0);
            return (
              <div>
                <button id={"increment-"+id} onClick={() => setCount((c) => c+1)}>Increment</button>
                <p id={"count-"+id}>{count}</p>
              </div>
            )
          }
        `,
          "app/components/interactive.tsx": js`
          import { useEffect, useState } from "react";

          export default function Interactive() {
            let [interactive, setInteractive] = useState(false);
            useEffect(() => {
              setInteractive(true);
            }, []);
            return interactive ? (
              <div id="interactive">
                <p>interactive</p>
              </div>
            ) : null;
          }
        `,
          "app/root.tsx": js`
          import { Links, Meta, Outlet, Scripts, useLoaderData } from "react-router";
          import Counter from "~/components/counter";
          import Interactive from "~/components/interactive";

          export const meta: MetaFunction = () => {
            return [{ title: "New Remix App" }];
          };

          export const loader = () => ({
            id: "${ROOT_ID}",
          });

          export default function Root() {
            let { id } = useLoaderData();
            return (
              <html lang="en">
                <head>
                  <meta charSet="utf-8" />
                  <meta name="viewport" content="width=device-width,initial-scale=1" />
                  <Meta />
                  <Links />
                </head>
                <body>
                  <div id={id}>
                    <p>{id}</p>
                    <Counter id={id} />
                    <Outlet />
                    <Interactive />
                  </div>
                  <Scripts />
                  {/* Send arbitrary data so safari renders the initial shell before
                      the document finishes downloading. */}
                  {Array(10000).fill(null).map((_, i)=><p key={i}>YOOOOOOOOOO   {i}</p>)}
                </body>
              </html>
            );
          }
        `,

          "app/routes/_index.tsx": js`
          import { Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              id: "${INDEX_ID}",
            };
          }

          export default function Index() {
            let { id } = useLoaderData();
            return (
              <div id={id}>
                <p>{id}</p>
                <Counter id={id} />

                <ul>
                  <li><Link to="/deferred-script-resolved">deferred-script-resolved</Link></li>
                  <li><Link to="/deferred-script-unresolved">deferred-script-unresolved</Link></li>
                  <li><Link to="/deferred-script-rejected">deferred-script-rejected</Link></li>
                  <li><Link to="/deferred-script-unrejected">deferred-script-unrejected</Link></li>
                  <li><Link to="/deferred-script-rejected-no-error-element">deferred-script-rejected-no-error-element</Link></li>
                  <li><Link to="/deferred-script-unrejected-no-error-element">deferred-script-unrejected-no-error-element</Link></li>
                </ul>
              </div>
            );
          }
        `,

          "app/routes/deferred-noscript-resolved.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: Promise.resolve("${RESOLVED_DEFERRED_ID}"),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-noscript-unresolved.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (resolve) => setTimeout(() => {
                  resolve("${RESOLVED_DEFERRED_ID}");
                }, 10)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-script-resolved.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: Promise.resolve("${RESOLVED_DEFERRED_ID}"),
              deferredUndefined: Promise.resolve(undefined),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-script-unresolved.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (resolve) => setTimeout(() => {
                  resolve("${RESOLVED_DEFERRED_ID}");
                }, 10)
              ),
              deferredUndefined: new Promise(
                (resolve) => setTimeout(() => {
                  resolve(undefined);
                }, 10)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-script-rejected.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: Promise.reject(new Error("${RESOLVED_DEFERRED_ID}")),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    errorElement={
                      <div id="${ERROR_ID}">
                        error
                        <Counter id="${ERROR_ID}" />
                      </div>
                    }
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-script-unrejected.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (_, reject) => setTimeout(() => {
                  reject(new Error("${RESOLVED_DEFERRED_ID}"));
                }, 10)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId, resolvedUndefined } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    errorElement={
                      <div id="${ERROR_ID}">
                        error
                        <Counter id="${ERROR_ID}" />
                      </div>
                    }
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-script-rejected-no-error-element.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: Promise.reject(new Error("${RESOLVED_DEFERRED_ID}")),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }

          export function ErrorBoundary() {
            return (
              <div id="${ERROR_BOUNDARY_ID}">
                error
                <Counter id="${ERROR_BOUNDARY_ID}" />
              </div>
            );
          }
        `,

          "app/routes/deferred-script-unrejected-no-error-element.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (_, reject) => setTimeout(() => {
                  reject(new Error("${RESOLVED_DEFERRED_ID}"));
                }, 10)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }

          export function ErrorBoundary() {
            return (
              <div id="${ERROR_BOUNDARY_ID}">
                error
                <Counter id="${ERROR_BOUNDARY_ID}" />
              </div>
            );
          }
        `,

          "app/routes/deferred-manual-resolve.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            global.__deferredManualResolveCache = global.__deferredManualResolveCache || {
              nextId: 1,
              deferreds: {},
            };

            let id = "" + global.__deferredManualResolveCache.nextId++;
            let promise = new Promise((resolve, reject) => {
              global.__deferredManualResolveCache.deferreds[id] = { resolve, reject };
            });

            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (resolve) => setTimeout(() => {
                  resolve("${RESOLVED_DEFERRED_ID}");
                }, 10)
              ),
              id,
              manualValue: promise,
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId, id, manualValue } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div>
                        <p id={resolvedDeferredId}>{id}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
                <Suspense fallback={<div id="${MANUAL_FALLBACK_ID}">manual fallback</div>}>
                  <Await
                    resolve={manualValue}
                    errorElement={
                      <div id="${MANUAL_ERROR_ID}">
                        error
                        <Counter id="${MANUAL_ERROR_ID}" />
                      </div>
                    }
                    children={(value) => (
                      <div>
                        <pre><code id="${MANUAL_RESOLVED_ID}">{JSON.stringify(value)}</code></pre>
                        <Counter id="${MANUAL_RESOLVED_ID}" />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,
        },
      });

      // This creates an interactive app using playwright.
      appFixture = await createAppFixture(fixture);
      originalConsoleError = console.error;
      console.error = () => {};
    });

    test.afterAll(() => {
      console.error = originalConsoleError;
      appFixture.close();
    });

    function counterHtml(id: string, val: number) {
      return `<p id="count-${id}">${val}</p>`;
    }

    test("works with critical JSON like data", async ({ page }) => {
      let response = await fixture.requestDocument("/");
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(INDEX_ID, 0));
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).not.toBe("");
      expect(deferredHTML).not.toContain('<p id="count-');

      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/");
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${INDEX_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await assertConsole();
    });

    test("resolved promises do not render in initial payload", async ({
      page,
    }) => {
      let response = await fixture.requestDocument(
        "/deferred-noscript-resolved"
      );
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(FALLBACK_ID);
      expect(criticalHTML).not.toContain(counterHtml(RESOLVED_DEFERRED_ID, 0));
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(RESOLVED_DEFERRED_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-noscript-resolved");
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);
    });

    test("slow promises render in subsequent payload", async ({ page }) => {
      let response = await fixture.requestDocument(
        "/deferred-noscript-unresolved"
      );
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(`<div id="${FALLBACK_ID}">`);
      expect(criticalHTML).not.toContain(RESOLVED_DEFERRED_ID);
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(RESOLVED_DEFERRED_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-noscript-unresolved");
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);
    });

    test("resolved promises render in initial payload and hydrates", async ({
      page,
    }) => {
      let response = await fixture.requestDocument("/deferred-script-resolved");
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(FALLBACK_ID);
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(RESOLVED_DEFERRED_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/deferred-script-resolved", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      await assertConsole();
    });

    test("slow to resolve promises render in subsequent payload and hydrates", async ({
      page,
    }) => {
      let response = await fixture.requestDocument(
        "/deferred-script-unresolved"
      );
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(`<div id="${FALLBACK_ID}">`);
      expect(criticalHTML).not.toContain(RESOLVED_DEFERRED_ID);
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(RESOLVED_DEFERRED_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/deferred-script-unresolved", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      await assertConsole();
    });

    test("rejected promises render in initial payload and hydrates", async ({
      page,
    }) => {
      let response = await fixture.requestDocument("/deferred-script-rejected");
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(FALLBACK_ID);
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(ERROR_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/deferred-script-rejected", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${ERROR_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, ERROR_ID);

      await assertConsole();
    });

    test("slow to reject promises render in subsequent payload and hydrates", async ({
      page,
    }) => {
      let response = await fixture.requestDocument(
        "/deferred-script-unrejected"
      );
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(`<div id="${FALLBACK_ID}">`);
      expect(criticalHTML).not.toContain(ERROR_ID);
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(ERROR_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/deferred-script-unrejected", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${ERROR_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, ERROR_ID);

      await assertConsole();
    });

    test("rejected promises bubble to ErrorBoundary on hydrate", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-script-rejected-no-error-element", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${ERROR_BOUNDARY_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, ERROR_BOUNDARY_ID);
    });

    test("slow to reject promises bubble to ErrorBoundary on hydrate", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-script-unrejected-no-error-element", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${ERROR_BOUNDARY_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, ERROR_BOUNDARY_ID);
    });

    test("routes are interactive when deferred promises are suspended and after resolve in subsequent payload", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      app.goto("/deferred-manual-resolve", false);

      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${MANUAL_FALLBACK_ID}`);
      let idElement = await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);
      let id = await idElement.innerText();
      expect(id).toBeTruthy();

      // Ensure the deferred promise is suspended
      await page.waitForSelector(`#${MANUAL_RESOLVED_ID}`, { state: "hidden" });

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      global.__deferredManualResolveCache.deferreds[id].resolve("value");

      await ensureInteractivity(page, MANUAL_RESOLVED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID, 2);
      await ensureInteractivity(page, DEFERRED_ID, 2);
      await ensureInteractivity(page, ROOT_ID, 2);

      await assertConsole();
    });

    test("routes are interactive when deferred promises are suspended and after rejection in subsequent payload", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/deferred-manual-resolve", false);

      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${MANUAL_FALLBACK_ID}`);
      let idElement = await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);
      let id = await idElement.innerText();
      expect(id).toBeTruthy();

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      global.__deferredManualResolveCache.deferreds[id].reject(
        new Error("error")
      );

      await ensureInteractivity(page, ROOT_ID, 2);
      await ensureInteractivity(page, DEFERRED_ID, 2);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID, 2);
      await ensureInteractivity(page, MANUAL_ERROR_ID);

      await assertConsole();
    });

    test("client transition with resolved promises work", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await app.clickLink("/deferred-script-resolved");

      await ensureInteractivity(page, ROOT_ID, 2);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      await assertConsole();
    });

    test("client transition with unresolved promises work", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await app.clickLink("/deferred-script-unresolved");

      await ensureInteractivity(page, ROOT_ID, 2);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      await assertConsole();
    });

    test("client transition with rejected promises work", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      app.clickLink("/deferred-script-rejected");

      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, ERROR_ID);
      await ensureInteractivity(page, DEFERRED_ID, 2);
      await ensureInteractivity(page, ROOT_ID, 2);

      await assertConsole();
    });

    test("client transition with unrejected promises work", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await app.clickLink("/deferred-script-unrejected");

      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, ERROR_ID);
      await ensureInteractivity(page, DEFERRED_ID, 2);
      await ensureInteractivity(page, ROOT_ID, 2);

      await assertConsole();
    });

    test("client transition with rejected promises bubble to ErrorBoundary", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await app.clickLink("/deferred-script-rejected-no-error-element");

      await ensureInteractivity(page, ERROR_BOUNDARY_ID);
      await ensureInteractivity(page, ROOT_ID, 2);
    });

    test("client transition with unrejected promises bubble to ErrorBoundary", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await app.clickLink("/deferred-script-unrejected-no-error-element");

      await ensureInteractivity(page, ERROR_BOUNDARY_ID);
      await ensureInteractivity(page, ROOT_ID, 2);
    });
  });

  test.describe("aborted", () => {
    let fixture: Fixture;
    let appFixture: AppFixture;

    test.beforeEach(async ({ context }) => {
      await context.route(/\.data$/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        route.continue();
      });
    });

    test.beforeAll(async () => {
      fixture = await createFixture({
        files: {
          "app/entry.server.tsx": js`
          import { PassThrough } from "node:stream";
          import type { AppLoadContext, EntryContext } from "react-router";
          import { createReadableStreamFromReadable } from "@react-router/node";
          import { ServerRouter } from "react-router";
          import { isbot } from "isbot";
          import { renderToPipeableStream } from "react-dom/server";

          // Exported for use by the server runtime so we can abort the
          // turbo-stream encode() call
          export const streamTimeout = 250;
          const renderTimeout = streamTimeout + 250;

          export default function handleRequest(
            request: Request,
            responseStatusCode: number,
            responseHeaders: Headers,
            remixContext: EntryContext,
            loadContext: AppLoadContext,
          ) {
            return isbot(request.headers.get("user-agent") || "")
              ? handleBotRequest(
                  request,
                  responseStatusCode,
                  responseHeaders,
                  remixContext
                )
              : handleBrowserRequest(
                  request,
                  responseStatusCode,
                  responseHeaders,
                  remixContext
                );
          }

          function handleBotRequest(
            request: Request,
            responseStatusCode: number,
            responseHeaders: Headers,
            remixContext: EntryContext
          ) {
            return new Promise((resolve, reject) => {
              let didError = false;

              let { pipe, abort } = renderToPipeableStream(
                <ServerRouter context={remixContext} url={request.url} />,
                {
                  onAllReady() {
                    let body = new PassThrough();
                    let stream = createReadableStreamFromReadable(body);

                    responseHeaders.set("Content-Type", "text/html");

                    resolve(
                      new Response(stream, {
                        headers: responseHeaders,
                        status: didError ? 500 : responseStatusCode,
                      })
                    );

                    pipe(body);
                  },
                  onShellError(error: unknown) {
                    reject(error);
                  },
                  onError(error: unknown) {
                    didError = true;

                    console.error(error);
                  },
                }
              );

              setTimeout(abort, renderTimeout);
            });
          }

          function handleBrowserRequest(
            request: Request,
            responseStatusCode: number,
            responseHeaders: Headers,
            remixContext: EntryContext
          ) {
            return new Promise((resolve, reject) => {
              let didError = false;

              let { pipe, abort } = renderToPipeableStream(
                <ServerRouter context={remixContext} url={request.url} />,
                {
                  onShellReady() {
                    let body = new PassThrough();
                    let stream = createReadableStreamFromReadable(body);

                    responseHeaders.set("Content-Type", "text/html");

                    resolve(
                      new Response(stream, {
                        headers: responseHeaders,
                        status: didError ? 500 : responseStatusCode,
                      })
                    );

                    pipe(body);
                  },
                  onShellError(err: unknown) {
                    reject(err);
                  },
                  onError(error: unknown) {
                    didError = true;

                    console.error(error);
                  },
                }
              );

              setTimeout(abort, renderTimeout);
            });
          }
        `,
          "app/components/counter.tsx": js`
          import { useState } from "react";

          export default function Counter({ id }) {
            let [count, setCount] = useState(0);
            return (
              <div>
                <button id={"increment-"+id} onClick={() => setCount((c) => c+1)}>Increment</button>
                <p id={"count-"+id}>{count}</p>
              </div>
            )
          }
        `,
          "app/components/interactive.tsx": js`
          import { useEffect, useState } from "react";

          export default function Interactive() {
            let [interactive, setInteractive] = useState(false);
            useEffect(() => {
              setInteractive(true);
            }, []);
            return interactive ? (
              <div id="interactive">
                <p>interactive</p>
              </div>
            ) : null;
          }
        `,
          "app/root.tsx": js`
          import { Links, Meta, Outlet, Scripts, useLoaderData } from "react-router";
          import Counter from "~/components/counter";
          import Interactive from "~/components/interactive";

          export const meta: MetaFunction = () => {
            return [{ title: "New Remix App" }];
          };

          export const loader = () => ({
            id: "${ROOT_ID}",
          });

          export default function Root() {
            let { id } = useLoaderData();
            return (
              <html lang="en">
                <head>
                  <meta charSet="utf-8" />
                  <meta name="viewport" content="width=device-width,initial-scale=1" />
                  <Meta />
                  <Links />
                </head>
                <body>
                  <div id={id}>
                    <p>{id}</p>
                    <Counter id={id} />
                    <Outlet />
                    <Interactive />
                  </div>
                  <Scripts />
                  {/* Send arbitrary data so safari renders the initial shell before
                      the document finishes downloading. */}
                  {Array(6000).fill(null).map((_, i)=><p key={i}>YOOOOOOOOOO   {i}</p>)}
                </body>
              </html>
            );
          }
        `,

          "app/routes/deferred-server-aborted.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (resolve) => setTimeout(() => {
                  resolve("${RESOLVED_DEFERRED_ID}");
                }, 10000)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    errorElement={
                      <div id="${ERROR_ID}">
                        error
                        <Counter id="${ERROR_ID}" />
                      </div>
                    }
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-server-aborted-no-error-element.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (resolve) => setTimeout(() => {
                  resolve("${RESOLVED_DEFERRED_ID}");
                }, 10000)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }

          export function ErrorBoundary() {
            return (
              <div id="${ERROR_BOUNDARY_ID}">
                error
                <Counter id="${ERROR_BOUNDARY_ID}" />
              </div>
            );
          }
        `,
        },
      });

      // This creates an interactive app using playwright.
      appFixture = await createAppFixture(fixture);

      originalConsoleError = console.error;
      console.error = () => {};
    });

    test.afterAll(() => {
      console.error = originalConsoleError;
      appFixture.close();
    });

    test("server aborts render the errorElement", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-server-aborted");
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${ERROR_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, ERROR_ID);
    });

    test("server aborts render the ErrorBoundary when no errorElement", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-server-aborted-no-error-element");
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${ERROR_BOUNDARY_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, ERROR_BOUNDARY_ID);
    });
  });
});

test.describe("turbo-stream-v3", () => {
  test.describe("non-aborted", () => {
    let fixture: Fixture;
    let appFixture: AppFixture;

    test.beforeEach(async ({ context }) => {
      await context.route(/.data/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        route.continue();
      });
    });

    test.beforeAll(async () => {
      fixture = await createFixture({
        turboV3: true,
        files: {
          "app/components/counter.tsx": js`
          import { useState } from "react";

          export default function Counter({ id }) {
            let [count, setCount] = useState(0);
            return (
              <div>
                <button id={"increment-"+id} onClick={() => setCount((c) => c+1)}>Increment</button>
                <p id={"count-"+id}>{count}</p>
              </div>
            )
          }
        `,
          "app/components/interactive.tsx": js`
          import { useEffect, useState } from "react";

          export default function Interactive() {
            let [interactive, setInteractive] = useState(false);
            useEffect(() => {
              setInteractive(true);
            }, []);
            return interactive ? (
              <div id="interactive">
                <p>interactive</p>
              </div>
            ) : null;
          }
        `,
          "app/root.tsx": js`
          import { Links, Meta, Outlet, Scripts, useLoaderData } from "react-router";
          import Counter from "~/components/counter";
          import Interactive from "~/components/interactive";

          export const meta: MetaFunction = () => {
            return [{ title: "New Remix App" }];
          };

          export const loader = () => ({
            id: "${ROOT_ID}",
          });

          export default function Root() {
            let { id } = useLoaderData();
            return (
              <html lang="en">
                <head>
                  <meta charSet="utf-8" />
                  <meta name="viewport" content="width=device-width,initial-scale=1" />
                  <Meta />
                  <Links />
                </head>
                <body>
                  <div id={id}>
                    <p>{id}</p>
                    <Counter id={id} />
                    <Outlet />
                    <Interactive />
                  </div>
                  <Scripts />
                  {/* Send arbitrary data so safari renders the initial shell before
                      the document finishes downloading. */}
                  {Array(10000).fill(null).map((_, i)=><p key={i}>YOOOOOOOOOO   {i}</p>)}
                </body>
              </html>
            );
          }
        `,

          "app/routes/_index.tsx": js`
          import { Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              id: "${INDEX_ID}",
            };
          }

          export default function Index() {
            let { id } = useLoaderData();
            return (
              <div id={id}>
                <p>{id}</p>
                <Counter id={id} />

                <ul>
                  <li><Link to="/deferred-script-resolved">deferred-script-resolved</Link></li>
                  <li><Link to="/deferred-script-unresolved">deferred-script-unresolved</Link></li>
                  <li><Link to="/deferred-script-rejected">deferred-script-rejected</Link></li>
                  <li><Link to="/deferred-script-unrejected">deferred-script-unrejected</Link></li>
                  <li><Link to="/deferred-script-rejected-no-error-element">deferred-script-rejected-no-error-element</Link></li>
                  <li><Link to="/deferred-script-unrejected-no-error-element">deferred-script-unrejected-no-error-element</Link></li>
                </ul>
              </div>
            );
          }
        `,

          "app/routes/deferred-noscript-resolved.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: Promise.resolve("${RESOLVED_DEFERRED_ID}"),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-noscript-unresolved.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (resolve) => setTimeout(() => {
                  resolve("${RESOLVED_DEFERRED_ID}");
                }, 10)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-script-resolved.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: Promise.resolve("${RESOLVED_DEFERRED_ID}"),
              deferredUndefined: Promise.resolve(undefined),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-script-unresolved.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (resolve) => setTimeout(() => {
                  resolve("${RESOLVED_DEFERRED_ID}");
                }, 10)
              ),
              deferredUndefined: new Promise(
                (resolve) => setTimeout(() => {
                  resolve(undefined);
                }, 10)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-script-rejected.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: Promise.reject(new Error("${RESOLVED_DEFERRED_ID}")),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    errorElement={
                      <div id="${ERROR_ID}">
                        error
                        <Counter id="${ERROR_ID}" />
                      </div>
                    }
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-script-unrejected.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (_, reject) => setTimeout(() => {
                  reject(new Error("${RESOLVED_DEFERRED_ID}"));
                }, 10)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId, resolvedUndefined } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    errorElement={
                      <div id="${ERROR_ID}">
                        error
                        <Counter id="${ERROR_ID}" />
                      </div>
                    }
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-script-rejected-no-error-element.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: Promise.reject(new Error("${RESOLVED_DEFERRED_ID}")),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }

          export function ErrorBoundary() {
            return (
              <div id="${ERROR_BOUNDARY_ID}">
                error
                <Counter id="${ERROR_BOUNDARY_ID}" />
              </div>
            );
          }
        `,

          "app/routes/deferred-script-unrejected-no-error-element.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (_, reject) => setTimeout(() => {
                  reject(new Error("${RESOLVED_DEFERRED_ID}"));
                }, 10)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }

          export function ErrorBoundary() {
            return (
              <div id="${ERROR_BOUNDARY_ID}">
                error
                <Counter id="${ERROR_BOUNDARY_ID}" />
              </div>
            );
          }
        `,

          "app/routes/deferred-manual-resolve.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            global.__deferredManualResolveCache = global.__deferredManualResolveCache || {
              nextId: 1,
              deferreds: {},
            };

            let id = "" + global.__deferredManualResolveCache.nextId++;
            let promise = new Promise((resolve, reject) => {
              global.__deferredManualResolveCache.deferreds[id] = { resolve, reject };
            });

            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (resolve) => setTimeout(() => {
                  resolve("${RESOLVED_DEFERRED_ID}");
                }, 10)
              ),
              id,
              manualValue: promise,
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId, id, manualValue } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div>
                        <p id={resolvedDeferredId}>{id}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
                <Suspense fallback={<div id="${MANUAL_FALLBACK_ID}">manual fallback</div>}>
                  <Await
                    resolve={manualValue}
                    errorElement={
                      <div id="${MANUAL_ERROR_ID}">
                        error
                        <Counter id="${MANUAL_ERROR_ID}" />
                      </div>
                    }
                    children={(value) => (
                      <div>
                        <pre><code id="${MANUAL_RESOLVED_ID}">{JSON.stringify(value)}</code></pre>
                        <Counter id="${MANUAL_RESOLVED_ID}" />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,
        },
      });

      // This creates an interactive app using playwright.
      appFixture = await createAppFixture(fixture);
      originalConsoleError = console.error;
      console.error = () => {};
    });

    test.afterAll(() => {
      console.error = originalConsoleError;
      appFixture.close();
    });

    function counterHtml(id: string, val: number) {
      return `<p id="count-${id}">${val}</p>`;
    }

    test("works with critical JSON like data", async ({ page }) => {
      let response = await fixture.requestDocument("/");
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(INDEX_ID, 0));
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).not.toBe("");
      expect(deferredHTML).not.toContain('<p id="count-');

      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/");
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${INDEX_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await assertConsole();
    });

    test("resolved promises do not render in initial payload", async ({
      page,
    }) => {
      let response = await fixture.requestDocument(
        "/deferred-noscript-resolved"
      );
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(FALLBACK_ID);
      expect(criticalHTML).not.toContain(counterHtml(RESOLVED_DEFERRED_ID, 0));
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(RESOLVED_DEFERRED_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-noscript-resolved");
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);
    });

    test("slow promises render in subsequent payload", async ({ page }) => {
      let response = await fixture.requestDocument(
        "/deferred-noscript-unresolved"
      );
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(`<div id="${FALLBACK_ID}">`);
      expect(criticalHTML).not.toContain(RESOLVED_DEFERRED_ID);
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(RESOLVED_DEFERRED_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-noscript-unresolved");
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);
    });

    test("resolved promises render in initial payload and hydrates", async ({
      page,
    }) => {
      let response = await fixture.requestDocument("/deferred-script-resolved");
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(FALLBACK_ID);
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(RESOLVED_DEFERRED_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/deferred-script-resolved", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      await assertConsole();
    });

    test("slow to resolve promises render in subsequent payload and hydrates", async ({
      page,
    }) => {
      let response = await fixture.requestDocument(
        "/deferred-script-unresolved"
      );
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(`<div id="${FALLBACK_ID}">`);
      expect(criticalHTML).not.toContain(RESOLVED_DEFERRED_ID);
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(RESOLVED_DEFERRED_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/deferred-script-unresolved", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      await assertConsole();
    });

    test("rejected promises render in initial payload and hydrates", async ({
      page,
    }) => {
      let response = await fixture.requestDocument("/deferred-script-rejected");
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(FALLBACK_ID);
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(ERROR_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/deferred-script-rejected", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${ERROR_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, ERROR_ID);

      await assertConsole();
    });

    test("slow to reject promises render in subsequent payload and hydrates", async ({
      page,
    }) => {
      let response = await fixture.requestDocument(
        "/deferred-script-unrejected"
      );
      let html = await response.text();
      let criticalHTML = html.slice(0, html.indexOf("</html>") + 7);
      expect(criticalHTML).toContain(counterHtml(ROOT_ID, 0));
      expect(criticalHTML).toContain(counterHtml(DEFERRED_ID, 0));
      expect(criticalHTML).toContain(`<div id="${FALLBACK_ID}">`);
      expect(criticalHTML).not.toContain(ERROR_ID);
      let deferredHTML = html.slice(html.indexOf("</html>") + 7);
      expect(deferredHTML).toContain(counterHtml(ERROR_ID, 0));

      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/deferred-script-unrejected", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${ERROR_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, ERROR_ID);

      await assertConsole();
    });

    test("rejected promises bubble to ErrorBoundary on hydrate", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-script-rejected-no-error-element", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${ERROR_BOUNDARY_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, ERROR_BOUNDARY_ID);
    });

    test("slow to reject promises bubble to ErrorBoundary on hydrate", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-script-unrejected-no-error-element", true);
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${ERROR_BOUNDARY_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, ERROR_BOUNDARY_ID);
    });

    test("routes are interactive when deferred promises are suspended and after resolve in subsequent payload", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      app.goto("/deferred-manual-resolve", false);

      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${MANUAL_FALLBACK_ID}`);
      let idElement = await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);
      let id = await idElement.innerText();
      expect(id).toBeTruthy();

      // Ensure the deferred promise is suspended
      await page.waitForSelector(`#${MANUAL_RESOLVED_ID}`, { state: "hidden" });

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      global.__deferredManualResolveCache.deferreds[id].resolve("value");

      await ensureInteractivity(page, MANUAL_RESOLVED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID, 2);
      await ensureInteractivity(page, DEFERRED_ID, 2);
      await ensureInteractivity(page, ROOT_ID, 2);

      await assertConsole();
    });

    test("routes are interactive when deferred promises are suspended and after rejection in subsequent payload", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/deferred-manual-resolve", false);

      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${MANUAL_FALLBACK_ID}`);
      let idElement = await page.waitForSelector(`#${RESOLVED_DEFERRED_ID}`);
      let id = await idElement.innerText();
      expect(id).toBeTruthy();

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      global.__deferredManualResolveCache.deferreds[id].reject(
        new Error("error")
      );

      await ensureInteractivity(page, ROOT_ID, 2);
      await ensureInteractivity(page, DEFERRED_ID, 2);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID, 2);
      await ensureInteractivity(page, MANUAL_ERROR_ID);

      await assertConsole();
    });

    test("client transition with resolved promises work", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await app.clickLink("/deferred-script-resolved");

      await ensureInteractivity(page, ROOT_ID, 2);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      await assertConsole();
    });

    test("client transition with unresolved promises work", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await app.clickLink("/deferred-script-unresolved");

      await ensureInteractivity(page, ROOT_ID, 2);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, RESOLVED_DEFERRED_ID);

      await assertConsole();
    });

    test("client transition with rejected promises work", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      app.clickLink("/deferred-script-rejected");

      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, ERROR_ID);
      await ensureInteractivity(page, DEFERRED_ID, 2);
      await ensureInteractivity(page, ROOT_ID, 2);

      await assertConsole();
    });

    test("client transition with unrejected promises work", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let assertConsole = monitorConsole(page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await app.clickLink("/deferred-script-unrejected");

      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, ERROR_ID);
      await ensureInteractivity(page, DEFERRED_ID, 2);
      await ensureInteractivity(page, ROOT_ID, 2);

      await assertConsole();
    });

    test("client transition with rejected promises bubble to ErrorBoundary", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await app.clickLink("/deferred-script-rejected-no-error-element");

      await ensureInteractivity(page, ERROR_BOUNDARY_ID);
      await ensureInteractivity(page, ROOT_ID, 2);
    });

    test("client transition with unrejected promises bubble to ErrorBoundary", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");

      await page.waitForSelector("#interactive");
      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, INDEX_ID);

      await app.clickLink("/deferred-script-unrejected-no-error-element");

      await ensureInteractivity(page, ERROR_BOUNDARY_ID);
      await ensureInteractivity(page, ROOT_ID, 2);
    });
  });

  test.describe("aborted", () => {
    let fixture: Fixture;
    let appFixture: AppFixture;

    test.beforeEach(async ({ context }) => {
      await context.route(/\.data$/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        route.continue();
      });
    });

    test.beforeAll(async () => {
      fixture = await createFixture({
        turboV3: true,
        files: {
          "app/entry.server.tsx": js`
          import { PassThrough } from "node:stream";
          import type { AppLoadContext, EntryContext } from "react-router";
          import { createReadableStreamFromReadable } from "@react-router/node";
          import { ServerRouter } from "react-router";
          import { isbot } from "isbot";
          import { renderToPipeableStream } from "react-dom/server";

          // Exported for use by the server runtime so we can abort the
          // turbo-stream encode() call
          export const streamTimeout = 250;
          const renderTimeout = streamTimeout + 250;

          export default function handleRequest(
            request: Request,
            responseStatusCode: number,
            responseHeaders: Headers,
            remixContext: EntryContext,
            loadContext: AppLoadContext,
          ) {
            return isbot(request.headers.get("user-agent") || "")
              ? handleBotRequest(
                  request,
                  responseStatusCode,
                  responseHeaders,
                  remixContext
                )
              : handleBrowserRequest(
                  request,
                  responseStatusCode,
                  responseHeaders,
                  remixContext
                );
          }

          function handleBotRequest(
            request: Request,
            responseStatusCode: number,
            responseHeaders: Headers,
            remixContext: EntryContext
          ) {
            return new Promise((resolve, reject) => {
              let didError = false;

              let { pipe, abort } = renderToPipeableStream(
                <ServerRouter context={remixContext} url={request.url} />,
                {
                  onAllReady() {
                    let body = new PassThrough();
                    let stream = createReadableStreamFromReadable(body);

                    responseHeaders.set("Content-Type", "text/html");

                    resolve(
                      new Response(stream, {
                        headers: responseHeaders,
                        status: didError ? 500 : responseStatusCode,
                      })
                    );

                    pipe(body);
                  },
                  onShellError(error: unknown) {
                    reject(error);
                  },
                  onError(error: unknown) {
                    didError = true;

                    console.error(error);
                  },
                }
              );

              setTimeout(abort, renderTimeout);
            });
          }

          function handleBrowserRequest(
            request: Request,
            responseStatusCode: number,
            responseHeaders: Headers,
            remixContext: EntryContext
          ) {
            return new Promise((resolve, reject) => {
              let didError = false;

              let { pipe, abort } = renderToPipeableStream(
                <ServerRouter context={remixContext} url={request.url} />,
                {
                  onShellReady() {
                    let body = new PassThrough();
                    let stream = createReadableStreamFromReadable(body);

                    responseHeaders.set("Content-Type", "text/html");

                    resolve(
                      new Response(stream, {
                        headers: responseHeaders,
                        status: didError ? 500 : responseStatusCode,
                      })
                    );

                    pipe(body);
                  },
                  onShellError(err: unknown) {
                    reject(err);
                  },
                  onError(error: unknown) {
                    didError = true;

                    console.error(error);
                  },
                }
              );

              setTimeout(abort, renderTimeout);
            });
          }
        `,
          "app/components/counter.tsx": js`
          import { useState } from "react";

          export default function Counter({ id }) {
            let [count, setCount] = useState(0);
            return (
              <div>
                <button id={"increment-"+id} onClick={() => setCount((c) => c+1)}>Increment</button>
                <p id={"count-"+id}>{count}</p>
              </div>
            )
          }
        `,
          "app/components/interactive.tsx": js`
          import { useEffect, useState } from "react";

          export default function Interactive() {
            let [interactive, setInteractive] = useState(false);
            useEffect(() => {
              setInteractive(true);
            }, []);
            return interactive ? (
              <div id="interactive">
                <p>interactive</p>
              </div>
            ) : null;
          }
        `,
          "app/root.tsx": js`
          import { Links, Meta, Outlet, Scripts, useLoaderData } from "react-router";
          import Counter from "~/components/counter";
          import Interactive from "~/components/interactive";

          export const meta: MetaFunction = () => {
            return [{ title: "New Remix App" }];
          };

          export const loader = () => ({
            id: "${ROOT_ID}",
          });

          export default function Root() {
            let { id } = useLoaderData();
            return (
              <html lang="en">
                <head>
                  <meta charSet="utf-8" />
                  <meta name="viewport" content="width=device-width,initial-scale=1" />
                  <Meta />
                  <Links />
                </head>
                <body>
                  <div id={id}>
                    <p>{id}</p>
                    <Counter id={id} />
                    <Outlet />
                    <Interactive />
                  </div>
                  <Scripts />
                  {/* Send arbitrary data so safari renders the initial shell before
                      the document finishes downloading. */}
                  {Array(6000).fill(null).map((_, i)=><p key={i}>YOOOOOOOOOO   {i}</p>)}
                </body>
              </html>
            );
          }
        `,

          "app/routes/deferred-server-aborted.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (resolve) => setTimeout(() => {
                  resolve("${RESOLVED_DEFERRED_ID}");
                }, 10000)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    errorElement={
                      <div id="${ERROR_ID}">
                        error
                        <Counter id="${ERROR_ID}" />
                      </div>
                    }
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }
        `,

          "app/routes/deferred-server-aborted-no-error-element.tsx": js`
          import { Suspense } from "react";
          import { Await, Link, useLoaderData } from "react-router";
          import Counter from "~/components/counter";

          export function loader() {
            return {
              deferredId: "${DEFERRED_ID}",
              resolvedId: new Promise(
                (resolve) => setTimeout(() => {
                  resolve("${RESOLVED_DEFERRED_ID}");
                }, 10000)
              ),
            };
          }

          export default function Deferred() {
            let { deferredId, resolvedId } = useLoaderData();
            return (
              <div id={deferredId}>
                <p>{deferredId}</p>
                <Counter id={deferredId} />
                <Suspense fallback={<div id="${FALLBACK_ID}">fallback</div>}>
                  <Await
                    resolve={resolvedId}
                    children={(resolvedDeferredId) => (
                      <div id={resolvedDeferredId}>
                        <p>{resolvedDeferredId}</p>
                        <Counter id={resolvedDeferredId} />
                      </div>
                    )}
                  />
                </Suspense>
              </div>
            );
          }

          export function ErrorBoundary() {
            return (
              <div id="${ERROR_BOUNDARY_ID}">
                error
                <Counter id="${ERROR_BOUNDARY_ID}" />
              </div>
            );
          }
        `,
        },
      });

      // This creates an interactive app using playwright.
      appFixture = await createAppFixture(fixture);

      originalConsoleError = console.error;
      console.error = () => {};
    });

    test.afterAll(() => {
      console.error = originalConsoleError;
      appFixture.close();
    });

    test("server aborts render the errorElement", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-server-aborted");
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${DEFERRED_ID}`);
      await page.waitForSelector(`#${ERROR_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, DEFERRED_ID);
      await ensureInteractivity(page, ERROR_ID);
    });

    test("server aborts render the ErrorBoundary when no errorElement", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/deferred-server-aborted-no-error-element");
      await page.waitForSelector(`#${ROOT_ID}`);
      await page.waitForSelector(`#${ERROR_BOUNDARY_ID}`);

      await ensureInteractivity(page, ROOT_ID);
      await ensureInteractivity(page, ERROR_BOUNDARY_ID);
    });
  });
});

async function ensureInteractivity(page: Page, id: string, expect: number = 1) {
  await page.waitForSelector("#interactive");
  let increment = await page.waitForSelector("#increment-" + id);
  await increment.click();
  await page.waitForSelector(`#count-${id}:has-text('${expect}')`);
}

function monitorConsole(page: Page) {
  let messages: ConsoleMessage[] = [];
  page.on("console", (message) => {
    messages.push(message);
  });

  return async () => {
    if (!messages.length) return;
    let errors: string[] = [];
    for (let message of messages) {
      let logs = [];
      let args = message.args();
      if (args[0]) {
        let arg0 = await args[0].jsonValue();
        if (
          typeof arg0 === "string" &&
          arg0.includes("Download the React DevTools")
        ) {
          continue;
        }
        logs.push(arg0);
      }
      errors.push(
        `Unexpected console.log(${JSON.stringify(logs).slice(1, -1)})`
      );
    }
    if (errors.length) {
      throw new Error(`Unexpected console.log's:\n` + errors.join("\n") + "\n");
    }
  };
}
