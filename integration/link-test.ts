import { test, expect } from "@playwright/test";

import {
  css,
  js,
  createFixture,
  createAppFixture,
} from "./helpers/create-fixture.js";
import type { Fixture, AppFixture } from "./helpers/create-fixture.js";
import { PlaywrightFixture } from "./helpers/playwright-fixture.js";

const fakeGists = [
  {
    url: "https://api.github.com/gists/610613b54e5b34f8122d1ba4a3da21a9",
    id: "610613b54e5b34f8122d1ba4a3da21a9",
    files: {
      "remix-server.jsx": {
        filename: "remix-server.jsx",
      },
    },
    owner: {
      login: "ryanflorence",
      id: 100200,
      avatar_url: "https://avatars0.githubusercontent.com/u/100200?v=4",
    },
  },
];

test.describe("route module link export", () => {
  let fixture: Fixture;
  let appFixture: AppFixture;

  test.beforeAll(async () => {
    fixture = await createFixture({
      files: {
        "app/favicon.ico": js``,

        "app/guitar.jpg": js``,

        "app/guitar-600.jpg": js``,

        "app/guitar-900.jpg": js``,

        "app/reset.css": css`
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }

          html {
            font-size: 16px;
            box-sizing: border-box;
          }
        `,

        "app/app.css": css`
          body {
            background-color: #eee;
            color: #000;
          }
        `,

        "app/gists.css": css`
          * {
            color: dodgerblue;
          }
        `,

        "app/redText.css": css`
          * {
            color: red;
          }
        `,

        "app/blueText.css": css`
          * {
            color: blue;
          }
        `,

        "app/root.tsx": js`
          import {
            Link,
            Links,
            Meta,
            Outlet,
            Scripts,
            useRouteError,
            isRouteErrorResponse
          } from "react-router";
          import resetHref from "./reset.css?url";
          import stylesHref from "./app.css?url";
          import favicon from "./favicon.ico";

          export function links() {
            return [
              { rel: "stylesheet", href: resetHref },
              { rel: "stylesheet", href: stylesHref },
              { rel: "stylesheet", href: "/resources/theme-css" },
              { rel: "shortcut icon", href: favicon },
            ];
          }

          export let handle = {
            breadcrumb: () => <Link to="/">Home</Link>,
          };

          export default function Root() {
            return (
              <html lang="en">
                <head>
                  <meta charSet="utf-8" />
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

          export function ErrorBoundary() {
            let error = useRouteError();

            if (isRouteErrorResponse()) {
              switch (error.status) {
                case 404:
                  return (
                    <html lang="en">
                      <head>
                        <meta charSet="utf-8" />
                        <title>404 Not Found</title>
                        <Links />
                      </head>
                      <body>
                        <div>
                          <h1>404 Not Found</h1>
                        </div>
                        <Scripts />
                      </body>
                    </html>
                  );
                default:
                  console.warn("Unexpected catch", error);

                  return (
                    <html lang="en">
                      <head>
                        <meta charSet="utf-8" />
                        <title>{error.status} Uh-oh!</title>
                        <Links />
                      </head>
                      <body>
                        <div>
                          <h1>
                            {error.status} {error.statusText}
                          </h1>
                          {error.data ? (
                            <pre>
                              <code>{JSON.stringify(error.data, null, 2)}</code>
                            </pre>
                          ) : null}
                        </div>
                        <Scripts />
                      </body>
                    </html>
                  );
                }
              } else {
                console.error(error);
                return (
                  <html lang="en">
                    <head>
                      <meta charSet="utf-8" />
                      <title>Oops!</title>
                      <Links />
                    </head>
                    <body>
                      <div>
                        <h1>App Error Boundary</h1>
                        <pre>{error.message}</pre>
                      </div>
                      <Scripts />
                    </body>
                  </html>
                );
              }
          }
        `,

        "app/routes/_index.tsx": js`
          import { useEffect } from "react";
          import { Link } from "react-router";

          export default function Index() {
            return (
              <div data-test-id="/">
                <header>
                  <h1>Cool App</h1>
                </header>
                <nav>
                  <ul>
                    <li>
                      <Link to="/gists">View Some gists</Link>
                    </li>
                    <li>
                      <Link to="/gists/mjackson">View Michael's gists</Link>
                    </li>
                    <li>
                      <Link to="/gists/mjijackson">Loader Redirect</Link>
                    </li>
                    <li>
                      <Link to="/resources">Resource routes</Link>
                    </li>
                    <li>
                      <Link to="/parent/child">Errored child route</Link>
                    </li>
                  </ul>
                </nav>
              </div>
            );
          }
        `,

        "app/routes/links.tsx": js`
          import { useLoaderData, Link } from "react-router";
          import redTextHref from "~/redText.css?url";
          import blueTextHref from "~/blueText.css?url";
          import guitar from "~/guitar.jpg";
          export async function loader() {
            return [
              { name: "Michael Jackson", id: "mjackson" },
              { name: "Ryan Florence", id: "ryanflorence" },
            ];
          }
          export function links()  {
            return [
              { rel: "stylesheet", href: redTextHref },
              {
                rel: "stylesheet",
                href: blueTextHref,
                media: "(prefers-color-scheme: beef)",
              },
              { page: "/gists/mjackson" },
              {
                rel: "preload",
                as: "image",
                href: guitar,
              },
            ];
          }
          export default function LinksPage() {
            let users = useLoaderData();
            return (
              <div data-test-id="/links">
                <h2>Links Page</h2>
                {users.map((user) => (
                  <li key={user.id}>
                    <Link to={"/gists/" + user.id} prefetch="none">
                      {user.name}
                    </Link>
                  </li>
                ))}
                <hr />
                <p>
                  <img alt="a guitar" src={guitar} data-test-id="blocked" /> Prefetched
                  because it's a preload.
                </p>
              </div>
            );
          }
        `,

        "app/routes/responsive-image-preload.tsx": js`
          import { Link } from "react-router";
          import guitar600 from "~/guitar-600.jpg";
          import guitar900 from "~/guitar-900.jpg";

          export function links()  {
            return [
              {
                rel: "preload",
                as: "image",
                imageSrcSet: guitar600 + " 600w, " + guitar900 + " 900w",
                imageSizes: "100vw",
              },
            ];
          }
          export default function LinksPage() {
            return (
              <div data-test-id="/responsive-image-preload">
                <h2>Responsive Guitar</h2>
                <p>
                  <img
                    alt="a guitar"
                    srcSet={guitar600 + " 600w, " + guitar900 + " 900w"}
                    sizes="100vw"
                    data-test-id="blocked"
                  />{" "}
                  Prefetched because it's a preload.
                </p>
              </div>
            );
          }
        `,

        "app/routes/gists.tsx": js`
          import { data, Link, Outlet, useLoaderData, useNavigation } from "react-router";
          import stylesHref from "~/gists.css?url";
          export function links() {
            return [{ rel: "stylesheet", href: stylesHref }];
          }
          export async function loader() {
            return data({
              users: [
                { id: "ryanflorence", name: "Ryan Florence" },
                { id: "mjackson", name: "Michael Jackson" },
              ],
            }, {
              headers: {
                "Cache-Control": "public, max-age=60",
              },
            });
          }
          export function headers({ loaderHeaders }) {
            return {
              "Cache-Control": loaderHeaders.get("Cache-Control"),
            };
          }
          export let handle = {
            breadcrumb: () => <Link to="/gists">Gists</Link>,
          };
          export default function Gists() {
            let locationPending = useNavigation().location;
            let { users } = useLoaderData();
            return (
              <div data-test-id="/gists">
                <header>
                  <h1>Gists</h1>
                  <ul>
                    {users.map((user) => (
                      <li key={user.id}>
                        <Link to={user.id}>
                          {user.name} {locationPending ? "..." : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </header>
                <Outlet />
              </div>
            );
          }
        `,

        "app/routes/gists.$username.tsx": js`
          import { data, redirect } from "react-router";
          import { Link, useLoaderData, useParams } from "react-router";
          export async function loader({ params }) {
            let { username } = params;
            if (username === "mjijackson") {
              return redirect("/gists/mjackson", 302);
            }
            if (username === "_why") {
              return data(null, { status: 404 });
            }
            return ${JSON.stringify(fakeGists)};
          }
          export function headers() {
            return {
              "Cache-Control": "public, max-age=300",
            };
          }
          export function meta({ data, params }) {
            let { username } = params;
            return [
              {
                title: data
                  ? data.length + " gists from " + username
                  : "User " + username + " not found",
              },
              { name: "description", content: "View all of the gists from " + username },
            ];
          }
          export let handle = {
            breadcrumb: ({ params }) => (
              <Link to={"gists/" + params.username}>{params.username}</Link>
            ),
          };
          export default function UserGists() {
            let { username } = useParams();
            let data = useLoaderData();
            return (
              <div data-test-id="/gists/$username">
                {data ? (
                  <>
                    <h2>All gists from {username}</h2>
                    <ul>
                      {data.map((gist) => (
                        <li key={gist.id}>
                          <a href={gist.html_url}>{Object.keys(gist.files)[0]}</a>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <h2>No gists for {username}</h2>
                )}
              </div>
            );
          }
        `,

        "app/routes/gists._index.tsx": js`
          import { useLoaderData } from "react-router";
          export async function loader() {
            return ${JSON.stringify(fakeGists)};
          }
          export function headers() {
            return {
              "Cache-Control": "public, max-age=60",
            };
          }
          export function meta() {
            return [
              { title: "Public Gists" },
              { name: "description", content: "View the latest gists from the public" },
            ];
          }
          export let handle = {
            breadcrumb: () => <span>Public</span>,
          };
          export default function GistsIndex() {
            let data = useLoaderData();
            return (
              <div data-test-id="/gists/index">
                <h2>Public Gists</h2>
                <ul>
                  {data.map((gist) => (
                    <li key={gist.id} style={{ display: "flex", alignItems: "center" }}>
                      <img
                        src={gist.owner.avatar_url}
                        style={{ height: 36, margin: "0.25rem 0.5rem 0.25rem 0" }}
                        alt="avatar"
                      />
                      <a href={gist.html_url}>{Object.keys(gist.files)[0]}</a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          }
        `,

        "app/routes/resources.theme-css.tsx": js`
          import { redirect } from "react-router";
          export async function loader({ request }) {
            return new Response(":root { --nc-tx-1: #ffffff; --nc-tx-2: #eeeeee; }",
              {
                headers: {
                  "Content-Type": "text/css; charset=UTF-8",
                  "x-has-custom": "yes",
                },
              }
            );
          }

        `,

        "app/routes/parent.tsx": js`
          import { Outlet } from "react-router";

          export function links() {
            return [
              { "data-test-id": "red" },
            ];
          }

          export default function Component() {
            return <div data-test-id="/parent"><Outlet /></div>;
          }

          export function ErrorBoundary() {
            return <h1 data-test-id="/parent:error-boundary">Error Boundary</h1>;
          }
        `,

        "app/routes/parent.child.tsx": js`
          import { Outlet } from "react-router";

          export function loader() {
            throw new Response(null, { status: 404 });
          }

          export function links() {
            return [
              { "data-test-id": "blue" },
            ];
          }

          export default function Component() {
            return <div data-test-id="/parent"><Outlet /></div>;
          }
        `,
      },
    });
    appFixture = await createAppFixture(fixture);
  });

  test.afterAll(() => {
    appFixture.close();
  });

  test("adds responsive image preload links to the document", async ({
    page,
  }) => {
    let app = new PlaywrightFixture(appFixture, page);
    await app.goto("/responsive-image-preload");
    await page.waitForSelector('[data-test-id="/responsive-image-preload"]');
    let locator = page.locator("link[rel=preload][as=image]");
    expect(await locator.getAttribute("imagesizes")).toBe("100vw");
  });

  test("waits for new styles to load before transitioning", async ({
    page,
  }) => {
    let app = new PlaywrightFixture(appFixture, page);
    await app.goto("/");

    let cssResponses = app.collectResponses((url) =>
      url.pathname.endsWith(".css")
    );

    await page.click('a[href="/gists"]');
    await page.waitForSelector('[data-test-id="/gists/index"]');

    let stylesheetResponses = cssResponses.filter((res) => {
      // ignore prefetches
      return res.request().resourceType() === "stylesheet";
    });

    expect(stylesheetResponses.length).toEqual(1);
  });

  test("does not render errored child route links", async ({ page }) => {
    let app = new PlaywrightFixture(appFixture, page);
    await app.goto("/", true);
    await page.click('a[href="/parent/child"]');
    await page.waitForSelector('[data-test-id="/parent:error-boundary"]');
    await page.waitForSelector('[data-test-id="red"]', { state: "attached" });
    await page.waitForSelector('[data-test-id="blue"]', {
      state: "detached",
    });
  });

  test.describe("no js", () => {
    test.use({ javaScriptEnabled: false });

    test("adds links to the document", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      let responses = app.collectResponses((url) =>
        url.pathname.endsWith(".css")
      );

      await app.goto("/links");
      await page.waitForSelector('[data-test-id="/links"]');
      expect(responses.length).toEqual(4);
    });

    test("adds responsive image preload links to the document", async ({
      page,
    }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/responsive-image-preload");
      await page.waitForSelector('[data-test-id="/responsive-image-preload"]');
      let locator = page.locator("link[rel=preload][as=image]");
      expect(await locator.getAttribute("imagesizes")).toBe("100vw");
    });

    test("does not render errored child route links", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent/child");
      await page.waitForSelector('[data-test-id="/parent:error-boundary"]');
      await page.waitForSelector('[data-test-id="red"]', { state: "attached" });
      await page.waitForSelector('[data-test-id="blue"]', {
        state: "detached",
      });
    });
  });

  test.describe("script imports", () => {
    // Disable JS for this test since we don't want it to hydrate and remove
    // the initial <script> tags
    test.use({ javaScriptEnabled: false });

    test("are added to the document", async ({ page }) => {
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      let scripts = await page.$$("script");
      expect(scripts.length).toEqual(7);
      expect(await scripts[0].innerText()).toContain("__reactRouterContext");
      let moduleScript = scripts[1];
      expect(await moduleScript.getAttribute("type")).toBe("module");
      let moduleScriptText = await moduleScript.innerText();
      expect(
        Array.from(moduleScriptText.matchAll(/import "\/assets\/manifest-/g)),
        "did not expect a manifest due to fog of war"
      ).toHaveLength(0);
      expect(
        Array.from(moduleScriptText.matchAll(/import \* as route0 from "/g)),
        "invalid route0"
      ).toHaveLength(1);
      expect(
        Array.from(moduleScriptText.matchAll(/import \* as route1 from "/g)),
        "invalid route1"
      ).toHaveLength(1);
      expect(
        Array.from(moduleScriptText.matchAll(/import \* as route2 from "/g)),
        "too many routes"
      ).toHaveLength(0);
    });
  });
});
