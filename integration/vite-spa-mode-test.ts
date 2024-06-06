import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

import {
  createAppFixture,
  createFixture,
  css,
  js,
} from "./helpers/create-fixture.js";
import type { Fixture, AppFixture } from "./helpers/create-fixture.js";
import { PlaywrightFixture } from "./helpers/playwright-fixture.js";
import { createProject, build } from "./helpers/vite.js";

test.describe("SPA Mode", () => {
  let fixture: Fixture;
  let appFixture: AppFixture;

  test.describe("custom builds", () => {
    test.describe("build errors", () => {
      test("errors on server-only exports", async () => {
        let cwd = await createProject({
          "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { vitePlugin as reactRouter } from "@react-router/dev";

          export default defineConfig({
            plugins: [reactRouter({ ssr: false })],
          });
        `,
          "app/routes/invalid-exports.tsx": String.raw`
          // Invalid exports
          export function headers() {}
          export function loader() {}
          export function action() {}

          // Valid exports
          export function clientLoader() {}
          export function clientAction() {}
          export default function Component() {}
        `,
        });
        let result = build({ cwd });
        let stderr = result.stderr.toString("utf8");
        expect(stderr).toMatch(
          "SPA Mode: 3 invalid route export(s) in `routes/invalid-exports.tsx`: " +
            "`headers`, `loader`, `action`. See https://remix.run/guides/spa-mode " +
            "for more information."
        );
      });

      test("errors on HydrateFallback export from non-root route", async () => {
        let cwd = await createProject({
          "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { vitePlugin as reactRouter } from "@react-router/dev";

          export default defineConfig({
            plugins: [reactRouter({ ssr: false })],
          });
        `,
          "app/routes/invalid-exports.tsx": String.raw`
          // Invalid exports
          export function HydrateFallback() {}

          // Valid exports
          export function clientLoader() {}
          export function clientAction() {}
          export default function Component() {}
        `,
        });
        let result = build({ cwd });
        let stderr = result.stderr.toString("utf8");
        expect(stderr).toMatch(
          "SPA Mode: Invalid `HydrateFallback` export found in `routes/invalid-exports.tsx`. " +
            "`HydrateFallback` is only permitted on the root route in SPA Mode. " +
            "See https://remix.run/guides/spa-mode for more information."
        );
      });

      test("errors on a non-200 status from entry.server.tsx", async () => {
        let cwd = await createProject({
          "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { vitePlugin as reactRouter } from "@react-router/dev";

          export default defineConfig({
            plugins: [reactRouter({ ssr: false })],
          });
        `,
          "app/entry.server.tsx": js`
          import { RemixServer } from "react-router";
          import { renderToString } from "react-dom/server";

          export default function handleRequest(
            request,
            responseStatusCode,
            responseHeaders,
            remixContext
          ) {
            const html = renderToString(
              <RemixServer context={remixContext} url={request.url} />
            );
            return new Response(html, {
              headers: { "Content-Type": "text/html" },
              status: 500,
            });
          }
        `,
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
                  <Outlet />
                  <Scripts />
                </body>
              </html>
            );
          }

          export function HydrateFallback() {
            return (
              <html lang="en">
                <head>
                  <Meta />
                  <Links />
                </head>
                <body>
                  <h1>Loading...</h1>
                  <Scripts />
                </body>
              </html>
            );
          }
        `,
        });
        let result = build({ cwd });
        let stderr = result.stderr.toString("utf8");
        expect(stderr).toMatch(
          "SPA Mode: Received a 500 status code from `entry.server.tsx` while " +
            "prerendering the `/` path."
        );
        expect(stderr).toMatch("<h1>Loading...</h1>");
      });

      test("errors if you do not include <Scripts> in your root <HydrateFallback>", async () => {
        let cwd = await createProject({
          "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { vitePlugin as reactRouter } from "@react-router/dev";

          export default defineConfig({
            plugins: [reactRouter({ ssr: false })],
          });
        `,
          "app/root.tsx": String.raw`
          export function HydrateFallback() {
            return <h1>Loading</h1>
          }
        `,
        });
        let result = build({ cwd });
        let stderr = result.stderr.toString("utf8");
        expect(stderr).toMatch(
          "SPA Mode: Did you forget to include <Scripts/> in your root route? " +
            "Your pre-rendered HTML files cannot hydrate without `<Scripts />`."
        );
      });
    });

    test("prepends DOCTYPE to HTML in the default entry.server.tsx", async () => {
      let fixture = await createFixture({
        spaMode: true,
        files: {
          "vite.config.ts": js`
            import { defineConfig } from "vite";
            import { vitePlugin as reactRouter } from "@react-router/dev";

            export default defineConfig({
              plugins: [reactRouter({ ssr: false })],
            });
          `,
          "app/root.tsx": js`
            import { Outlet, Scripts } from "react-router";

            export default function Root() {
              return (
                <html lang="en">
                  <head></head>
                  <body>
                    <h1 data-root>Root</h1>
                    <Scripts />
                  </body>
                </html>
              );
            }

            export function HydrateFallback() {
              return (
                <html lang="en">
                  <head></head>
                  <body>
                    <h1 data-loading>Loading SPA...</h1>
                    <Scripts />
                  </body>
                </html>
              );
            }
          `,
        },
      });
      let res = await fixture.requestDocument("/");
      expect(await res.text()).toMatch(/^<!DOCTYPE html><html lang="en">/);
    });

    test("works when combined with a basename", async ({ page }) => {
      fixture = await createFixture({
        spaMode: true,
        files: {
          "vite.config.ts": js`
            import { defineConfig } from "vite";
            import { vitePlugin as reactRouter } from "@react-router/dev";

            export default defineConfig({
              plugins: [reactRouter({
                basename: "/base/",
                ssr: false
              })],
            });
          `,
          "app/root.tsx": js`
            import { Outlet, Scripts } from "react-router";

            export default function Root() {
              return (
                <html lang="en">
                  <head></head>
                  <body>
                    <h1 data-root>Root</h1>
                    <Outlet />
                    <Scripts />
                  </body>
                </html>
              );
            }

            export function HydrateFallback() {
              return (
                <html lang="en">
                  <head></head>
                  <body>
                    <h1 data-loading>Loading SPA...</h1>
                    <Scripts />
                  </body>
                </html>
              );
            }
          `,
          "app/routes/_index.tsx": js`
            import * as React  from "react";
            import { useLoaderData } from "react-router";

            export async function clientLoader({ request }) {
              return "Index Loader Data";
            }

            export default function Component() {
              let data = useLoaderData();
              const [mounted, setMounted] = React.useState(false);
              React.useEffect(() => setMounted(true), []);

              return (
                <>
                  <h2 data-route>Index</h2>
                  <p data-loader-data>{data}</p>
                  {!mounted ? <h3>Unmounted</h3> : <h3 data-mounted>Mounted</h3>}
                </>
              );
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/base/");
      await page.waitForSelector("[data-mounted]");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");
      expect(await page.locator("[data-loader-data]").textContent()).toBe(
        "Index Loader Data"
      );
    });

    test("can be used to hydrate only a div", async ({ page }) => {
      fixture = await createFixture({
        spaMode: true,
        files: {
          "vite.config.ts": js`
            import { defineConfig } from "vite";
            import { vitePlugin as reactRouter } from "@react-router/dev";

            export default defineConfig({
              plugins: [reactRouter({ ssr: false })],
            });
          `,
          "app/index.html": String.raw`
            <!DOCTYPE html>
            <html lang="en">
              <head>
                <title>Not from Remix!</title>
              </head>
              <body>
                <div id="app"><!-- Remix SPA --></div>
              </body>
            </html>
          `,
          "app/entry.client.tsx": js`
            import { HydratedRouter } from "react-router";
            import { startTransition, StrictMode } from "react";
            import { hydrateRoot } from "react-dom/client";

            startTransition(() => {
              hydrateRoot(
                document.querySelector("#app"),
                <StrictMode>
                  <HydratedRouter />
                </StrictMode>
              );
            });
          `,
          "app/entry.server.tsx": js`
            import * as fs from "node:fs";
            import * as path from "node:path";
            import { PassThrough } from "node:stream";

            import type { AppLoadContext, EntryContext } from "@react-router/node";
            import { createReadableStreamFromReadable } from "@react-router/node";
            import { RemixServer } from "react-router";
            import { renderToPipeableStream } from "react-dom/server";

            const ABORT_DELAY = 5_000;
            
            export default function handleRequest(
              request: Request,
              responseStatusCode: number,
              responseHeaders: Headers,
              remixContext: EntryContext,
              loadContext: AppLoadContext
            ) {
              return handleBotRequest(
                request,
                responseStatusCode,
                responseHeaders,
                remixContext
              );
            }
            

            async function handleBotRequest(
              request: Request,
              responseStatusCode: number,
              responseHeaders: Headers,
              remixContext: EntryContext
            ) {
              const html = await new Promise((resolve, reject) => {
                let shellRendered = false;
                const { pipe, abort } = renderToPipeableStream(
                  <RemixServer
                    context={remixContext}
                    url={request.url}
                    abortDelay={ABORT_DELAY}
                  />,
                  {
                    onAllReady() {
                      shellRendered = true;
                      const body = new PassThrough();
                      const stream = createReadableStreamFromReadable(body);
            
                      responseHeaders.set("Content-Type", "text/html");

                      resolve(
                        new Response(stream, {
                          headers: responseHeaders,
                          status: responseStatusCode,
                        }).text()
                      );
            
                      pipe(body);
                    },
                    onShellError(error: unknown) {
                      reject(error);
                    },
                    onError(error: unknown) {
                      responseStatusCode = 500;
                      // Log streaming rendering errors from inside the shell.  Don't log
                      // errors encountered during initial shell rendering since they'll
                      // reject and get logged in handleDocumentRequest.
                      if (shellRendered) {
                        console.error(error);
                      }
                    },
                  }
                );

                setTimeout(abort, ABORT_DELAY);
              });

              const shellHtml = fs
                .readFileSync(
                  path.join(process.cwd(), "app/index.html")
                )
                .toString();

              const finalHTML = shellHtml.replace("<!-- Remix SPA -->", html);
              return new Response(finalHTML, {
                headers: responseHeaders,
                status: responseStatusCode,
              });
            }          
          `,
          "app/root.tsx": js`
            import { Outlet, Scripts } from "react-router";

            export default function Root() {
              return (
                <>
                  <h1 data-root>Root</h1>
                  <Outlet />
                  <Scripts />
                </>
              );
            }

            export function HydrateFallback() {
              return (
                <>
                  <h1 data-loading>Loading SPA...</h1>
                  <Scripts />
                </>
              );
            }
          `,
          "app/routes/_index.tsx": js`
            import * as React  from "react";
            import { useLoaderData } from "react-router";

            export async function clientLoader({ request }) {
              return "Index Loader Data";
            }

            export default function Component() {
              let data = useLoaderData();
              const [mounted, setMounted] = React.useState(false);
              React.useEffect(() => setMounted(true), []);

              return (
                <>
                  <h2 data-route>Index</h2>
                  <p data-loader-data>{data}</p>
                  {!mounted ? <h3>Unmounted</h3> : <h3 data-mounted>Mounted</h3>}
                </>
              );
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("title").textContent()).toBe("Not from Remix!");
      await page.waitForSelector("[data-mounted]");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");
      expect(await page.locator("[data-loader-data]").textContent()).toBe(
        "Index Loader Data"
      );
    });

    test("works for migration apps with only a root route and no loader", async ({
      page,
    }) => {
      fixture = await createFixture({
        spaMode: true,
        files: {
          "vite.config.ts": js`
            import { defineConfig } from "vite";
            import { vitePlugin as reactRouter } from "@react-router/dev";

            export default defineConfig({
              plugins: [reactRouter({
                // We don't want to pick up the app/routes/_index.tsx file from
                // the template and instead want to use only the src/root.tsx
                // file below
                appDirectory: "src",
                ssr: false,
              })],
            });
          `,
          "src/root.tsx": js`
            import {
              Meta,
              Links,
              Outlet,
              Routes,
              Route,
              Scripts,
              ScrollRestoration,
            } from "react-router";

            export function Layout({ children }: { children: React.ReactNode }) {
              return (
                <html>
                  <head>
                    <Meta />
                    <Links />
                  </head>
                  <body>
                    {children}
                    <ScrollRestoration />
                    <Scripts />
                  </body>
                </html>
              );
            }

            export default function Root() {
              return (
                <>
                  <h1 data-root>Root</h1>
                  <Routes>
                    <Route path="/" element={<h2 data-index>Index</h2>} />
                  </Routes>
                </>
              );
            }

            export function HydrateFallback() {
              return <h1 data-loading>Loading SPA...</h1>;
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let res = await fixture.requestDocument("/");
      let html = await res.text();
      expect(html).toMatch('<h1 data-loading="true">Loading SPA...</h1>');

      let logs: string[] = [];
      page.on("console", (msg) => logs.push(msg.text()));

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await page.waitForSelector("[data-root]");
      expect(await page.locator("[data-root]").textContent()).toBe("Root");
      expect(await page.locator("[data-index]").textContent()).toBe("Index");

      // Hydrates without issues
      expect(logs).toEqual([]);
    });

    test("wraps default root HydrateFallback in user-provided Layout", async ({
      page,
    }) => {
      fixture = await createFixture({
        spaMode: true,
        files: {
          "vite.config.ts": js`
            import { defineConfig } from "vite";
            import { vitePlugin as reactRouter } from "@react-router/dev";

            export default defineConfig({
              plugins: [reactRouter({
                // We don't want to pick up the app/routes/_index.tsx file from
                // the template and instead want to use only the src/root.tsx
                // file below
                appDirectory: "src",
                ssr: false,
              })],
            });
          `,
          "src/root.tsx": js`
            import {
              Meta,
              Links,
              Outlet,
              Routes,
              Route,
              Scripts,
              ScrollRestoration,
            } from "react-router";

            export function Layout({ children }: { children: React.ReactNode }) {
              return (
                <html>
                  <head>
                    <Meta />
                    <Links />
                  </head>
                  <body>
                    {children}
                    <ScrollRestoration />
                    <Scripts />
                  </body>
                </html>
              );
            }

            export default function Root() {
              return (
                <>
                  <h1 data-root>Root</h1>
                  <Routes>
                    <Route path="/" element={<h2 data-index>Index</h2>} />
                  </Routes>
                </>
              );
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let res = await fixture.requestDocument("/");
      let html = await res.text();
      expect(html.match(/<html/g)?.length).toBe(1);
      expect(html.match(/<\/html/g)?.length).toBe(1);
      expect(html.match(/window.__remixContext =/g)?.length).toBe(1);
      expect(html.match(/💿 Hey developer 👋/g)?.length).toBe(1);
    });
  });

  test.describe("normal apps", () => {
    test.beforeAll(async () => {
      fixture = await createFixture({
        spaMode: true,
        files: {
          "vite.config.ts": js`
            import { defineConfig } from "vite";
            import { vitePlugin as reactRouter } from "@react-router/dev";

            export default defineConfig({
              build: { manifest: true },
              plugins: [reactRouter({ ssr: false })],
            });
          `,
          "public/styles-root.css": css`
            body {
              background-color: rgba(255, 0, 0, 0.25);
            }
          `,
          "public/styles-index.css": css`
            body {
              background-color: rgba(0, 255, 0, 0.25);
            }
          `,
          "app/root.tsx": js`
            import * as React from "react";
            import { Form, Link, Links, Meta, Outlet, Scripts } from "react-router";

            export function meta({ data }) {
              return [{
                title: "Root Title"
              }];
            }

            export function links() {
              return [{
                rel: "stylesheet",
                href: "styles-root.css"
              }];
            }

            export default function Root() {
              let id = React.useId();
              return (
                <html lang="en">
                  <head>
                    <Meta />
                    <Links />
                  </head>
                  <body>
                      <h1 data-root>Root</h1>
                      <pre data-use-id>{id}</pre>
                      <nav>
                        <Link to="/about">/about</Link>
                        <br/>

                        <Form method="post" action="/about">
                          <button type="submit">
                            Submit /about
                          </button>
                        </Form>
                        <br/>

                        <Link to="/error">/error</Link>
                        <br/>

                        <Form method="post" action="/error">
                          <button type="submit">
                            Submit /error
                          </button>
                        </Form>
                        <br/>
                       </nav>
                      <Outlet />
                    <Scripts />
                  </body>
                </html>
              );
            }

            export function HydrateFallback() {
              const id = React.useId();
              const [hydrated, setHydrated] = React.useState(false);
              React.useEffect(() => setHydrated(true), []);

              return (
                <html lang="en">
                  <head>
                    <Meta />
                    <Links />
                  </head>
                  <body>
                    <h1 data-loading>Loading SPA...</h1>
                    <pre data-use-id>{id}</pre>
                    {hydrated ? <h3 data-hydrated>Hydrated</h3> : null}
                    <Scripts />
                  </body>
                </html>
              );
            }
          `,
          "app/routes/_index.tsx": js`
            import * as React  from "react";
            import { useLoaderData } from "react-router";

            export function meta({ data }) {
              return [{
                title: "Index Title: " + data
              }];
            }

            export function links() {
              return [{
                rel: "stylesheet",
                href: "styles-index.css"
              }];
            }

            export async function clientLoader({ request }) {
              if (new URL(request.url).searchParams.has('slow')) {
                await new Promise(r => setTimeout(r, 500));
              }
              return "Index Loader Data";
            }

            export default function Component() {
              let data = useLoaderData();
              const [mounted, setMounted] = React.useState(false);
              React.useEffect(() => setMounted(true), []);

              return (
                <>
                  <h2 data-route>Index</h2>
                  <p data-loader-data>{data}</p>
                  {!mounted ? <h3>Unmounted</h3> : <h3 data-mounted>Mounted</h3>}
                </>
              );
            }
          `,
          "app/routes/about.tsx": js`
            import { useActionData, useLoaderData } from "react-router";

            export function meta({ data }) {
              return [{
                title: "About Title: " + data
              }];
            }

            export function clientLoader() {
              return "About Loader Data";
            }

            export function clientAction() {
              return "About Action Data";
            }

            export default function Component() {
              let data = useLoaderData();
              let actionData = useActionData();

              return (
                <>
                  <h2 data-route>About</h2>
                  <p data-loader-data>{data}</p>
                  <p data-action-data>{actionData}</p>
                </>
              );
            }
          `,
          "app/routes/error.tsx": js`
            import { useRouteError } from "react-router";

            export async function clientLoader({ serverLoader }) {
              await serverLoader();
              return null;
            }

            export async function clientAction({ serverAction }) {
              await serverAction();
              return null;
            }

            export default function Component() {
              return <h2>Error</h2>;
            }

            export function ErrorBoundary() {
              let error = useRouteError();
              return <pre data-error>{error.data}</pre>
            }
          `,
        },
      });

      appFixture = await createAppFixture(fixture);
    });

    test.afterAll(() => {
      appFixture.close();
    });

    test("renders the root HydrateFallback initially", async ({ page }) => {
      let res = await fixture.requestDocument("/");
      let html = await res.text();
      expect(html).toMatch('<h1 data-loading="true">Loading SPA...</h1>');
    });

    test("does not include Meta/Links from routes below the root", async ({
      page,
    }) => {
      let res = await fixture.requestDocument("/");
      let html = await res.text();
      expect(html).toMatch("<title>Root Title</title>");
      expect(html).toMatch('<link rel="stylesheet" href="styles-root.css"/>');
      expect(html).not.toMatch("Index Title");
      expect(html).not.toMatch("styles-index.css");

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await page.waitForSelector("[data-mounted]");
      expect(await page.locator('link[href="styles-index.css"]')).toBeDefined();
      expect(await page.locator("[data-route]").textContent()).toBe("Index");
      expect(await page.locator("title").textContent()).toBe(
        "Index Title: Index Loader Data"
      );
    });

    test("hydrates", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");
      expect(await page.locator("[data-loader-data]").textContent()).toBe(
        "Index Loader Data"
      );
      expect(await page.locator("[data-mounted]").textContent()).toBe(
        "Mounted"
      );
      expect(await page.locator("title").textContent()).toBe(
        "Index Title: Index Loader Data"
      );
    });

    test("hydrates a proper useId value", async ({ page }) => {
      // SSR'd useId value we can assert against pre- and post-hydration
      let USE_ID_VALUE = ":R5:";

      // Ensure we SSR a proper useId value
      let res = await fixture.requestDocument("/");
      let html = await res.text();
      expect(html).toMatch(`<pre data-use-id="true">${USE_ID_VALUE}</pre>`);

      // We should hydrate the same useId value in HydrateFallback
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/?slow");
      await page.waitForSelector("[data-hydrated]");
      expect(await page.locator("[data-use-id]").textContent()).toBe(
        USE_ID_VALUE
      );

      // Once hydrated, we should get a different useId value from the root Component
      await page.waitForSelector("[data-route]");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");
      expect(await page.locator("[data-use-id]").textContent()).not.toBe(
        USE_ID_VALUE
      );
    });

    test("navigates and calls loaders", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");

      await app.clickLink("/about");
      await page.waitForSelector('[data-route]:has-text("About")');
      expect(await page.locator("[data-route]").textContent()).toBe("About");
      expect(await page.locator("[data-loader-data]").textContent()).toBe(
        "About Loader Data"
      );
      expect(await page.locator("title").textContent()).toBe(
        "About Title: About Loader Data"
      );
    });

    test("navigates and calls actions/loaders", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");

      await app.clickSubmitButton("/about");
      await page.waitForSelector('[data-route]:has-text("About")');
      expect(await page.locator("[data-route]").textContent()).toBe("About");
      expect(await page.locator("[data-action-data]").textContent()).toBe(
        "About Action Data"
      );
      expect(await page.locator("[data-loader-data]").textContent()).toBe(
        "About Loader Data"
      );
      expect(await page.locator("title").textContent()).toBe(
        "About Title: About Loader Data"
      );
    });

    test("errors if you call serverLoader", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");

      await app.clickLink("/error");
      await page.waitForSelector("[data-error]");
      expect(await page.locator("[data-error]").textContent()).toBe(
        'Error: You cannot call serverLoader() in SPA Mode (routeId: "routes/error")'
      );
    });

    test("errors if you call serverAction", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      expect(await page.locator("[data-route]").textContent()).toBe("Index");

      await app.clickSubmitButton("/error");
      await page.waitForSelector("[data-error]");
      expect(await page.locator("[data-error]").textContent()).toBe(
        'Error: You cannot call serverAction() in SPA Mode (routeId: "routes/error")'
      );
    });

    test("only generates client Vite manifest", () => {
      let viteManifestFiles = fs.readdirSync(
        path.join(fixture.projectDir, "build", "client", ".vite")
      );

      expect(viteManifestFiles).toEqual(["manifest.json"]);
    });
  });
});
