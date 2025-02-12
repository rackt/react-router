import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test, expect } from "@playwright/test";

import {
  createAppFixture,
  createFixture,
  js,
} from "./helpers/create-fixture.js";
import type { Fixture, AppFixture } from "./helpers/create-fixture.js";
import { PlaywrightFixture } from "./helpers/playwright-fixture.js";
import { build, createProject, reactRouterConfig } from "./helpers/vite.js";

let files = {
  "react-router.config.ts": reactRouterConfig({
    prerender: true,
  }),
  "vite.config.ts": js`
    import { defineConfig } from "vite";
    import { reactRouter } from "@react-router/dev/vite";

    export default defineConfig({
      build: { manifest: true },
      plugins: [
        reactRouter()
      ],
    });
  `,
  "app/root.tsx": js`
    import * as React from "react";
    import { Link, Links, Meta, Outlet, Scripts, useRouteError } from "react-router";

    export function meta({ data }) {
      return [{
        title: "Root Title"
      }];
    }

    export function Layout({ children }) {
      const [mounted, setMounted] = React.useState(false);
      React.useEffect(() => setMounted(true), []);
      return (
        <html lang="en">
          <head>
            <Meta />
            <Links />
          </head>
          <body>
            <h1>Root</h1>
            {!mounted ? <h3>Unmounted</h3> : <h3 data-mounted>Mounted</h3>}
            <nav>
            <Link to="/">Home</Link><br/>
            <Link to="/about">About</Link><br/>
            <Link to="/not-found">Not Found</Link><br/>
            </nav>
            {children}
            <Scripts />
          </body>
        </html>
      );
    }

    export default function Root() {
      return <Outlet />
    }

    export function ErrorBoundary() {
      let error = useRouteError();
      let msg = 'status' in error ?
        error.status + " " + error.statusText :
        error.message;
      return <p data-error>{msg}</p>;
    }

    export function HydrateFallback() {
      return <p>Loading...</p>;
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

    export async function loader() {
      return "Index Loader Data";
    }

    export default function Component() {
      let data = useLoaderData();

      return (
        <>
          <h2 data-route>Index</h2>
          <p data-loader-data>{data}</p>
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

    export async function loader() {
      return "About Loader Data";
    }

    export default function Component() {
      let data = useLoaderData();

      return (
        <>
          <h2 data-route>About</h2>
          <p data-loader-data>{data}</p>
        </>
      );
    }
  `,
};

function listAllFiles(_dir: string) {
  let files: string[] = [];

  function recurse(dir: string) {
    fs.readdirSync(dir).forEach((file) => {
      // Join with posix separator for consistency
      const absolute = dir + "/" + file;
      if (fs.statSync(absolute).isDirectory()) {
        if (![".vite", "assets"].includes(file)) {
          return recurse(absolute);
        }
      } else {
        return files.push(absolute);
      }
    });
  }

  recurse(_dir);

  // Normalize *nix/windows paths
  return files.map((f) => f.replace(_dir, "").replace(/^\//, ""));
}

test.describe("Prerendering", () => {
  let fixture: Fixture;
  let appFixture: AppFixture;

  test.afterAll(() => {
    appFixture?.close();
  });

  test.describe("prerendered file behavior (agnostic of ssr flag)", () => {
    test("Prerenders known static routes when true is specified", async () => {
      let buildStdio = new PassThrough();
      fixture = await createFixture({
        buildStdio,
        prerender: true,
        files: {
          ...files,
          "app/routes/parent.tsx": js`
          import { Outlet } from 'react-router'
          export default function Component() {
            return <Outlet/>
          }
        `,
          "app/routes/parent.child.tsx": js`
          import { Outlet } from 'react-router'
          export function loader() {
            return null;
          }
          export default function Component() {
            return <Outlet/>
          }
        `,
          "app/routes/$slug.tsx": js`
          import { Outlet } from 'react-router'
          export function loader() {
            return null;
          }
          export default function Component() {
            return <Outlet/>
          }
        `,
          "app/routes/$.tsx": js`
          import { Outlet } from 'react-router'
          export function loader() {
            return null;
          }
          export default function Component() {
            return <Outlet/>
          }
        `,
        },
      });

      appFixture = await createAppFixture(fixture);

      let clientDir = path.join(fixture.projectDir, "build", "client");
      expect(listAllFiles(clientDir).sort()).toEqual([
        "_root.data",
        "about.data",
        "about/index.html",
        "favicon.ico",
        "index.html",
        "parent/child.data",
        "parent/child/index.html",
        "parent/index.html",
      ]);

      let res = await fixture.requestDocument("/");
      let html = await res.text();
      expect(html).toMatch("<title>Index Title: Index Loader Data</title>");
      expect(html).toMatch("<h1>Root</h1>");
      expect(html).toMatch('<h2 data-route="true">Index</h2>');
      expect(html).toMatch('<p data-loader-data="true">Index Loader Data</p>');

      res = await fixture.requestDocument("/about");
      html = await res.text();
      expect(html).toMatch("<title>About Title: About Loader Data</title>");
      expect(html).toMatch("<h1>Root</h1>");
      expect(html).toMatch('<h2 data-route="true">About</h2>');
      expect(html).toMatch('<p data-loader-data="true">About Loader Data</p>');
    });

    test("Prerenders a static array of routes", async () => {
      fixture = await createFixture({
        prerender: true,
        files: {
          ...files,
          "react-router.config.ts": js`
          export default {
            async prerender() {
              await new Promise(r => setTimeout(r, 1));
              return ['/', '/about'];
            },
          }
        `,
          "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { reactRouter } from "@react-router/dev/vite";

          export default defineConfig({
            build: { manifest: true },
            plugins: [
              reactRouter()
            ],
          });
        `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let clientDir = path.join(fixture.projectDir, "build", "client");
      expect(listAllFiles(clientDir).sort()).toEqual([
        "_root.data",
        "about.data",
        "about/index.html",
        "favicon.ico",
        "index.html",
      ]);

      let res = await fixture.requestDocument("/");
      let html = await res.text();
      expect(html).toMatch("<title>Index Title: Index Loader Data</title>");
      expect(html).toMatch("<h1>Root</h1>");
      expect(html).toMatch('<h2 data-route="true">Index</h2>');
      expect(html).toMatch('<p data-loader-data="true">Index Loader Data</p>');

      res = await fixture.requestDocument("/about");
      html = await res.text();
      expect(html).toMatch("<title>About Title: About Loader Data</title>");
      expect(html).toMatch("<h1>Root</h1>");
      expect(html).toMatch('<h2 data-route="true">About</h2>');
      expect(html).toMatch('<p data-loader-data="true">About Loader Data</p>');
    });

    test("Prerenders a dynamic array of routes based on the static routes", async () => {
      fixture = await createFixture({
        files: {
          ...files,
          "react-router.config.ts": js`
          export default {
            async prerender({ getStaticPaths }) {
              return [...getStaticPaths(), "/a", "/b"];
            },
          }
        `,
          "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { reactRouter } from "@react-router/dev/vite";

          export default defineConfig({
            build: { manifest: true },
            plugins: [reactRouter()],
          });
        `,
          "app/routes/$slug.tsx": js`
          export function loader() {
            return null
          }
          export default function component() {
            return null;
          }
        `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let clientDir = path.join(fixture.projectDir, "build", "client");
      expect(listAllFiles(clientDir).sort()).toEqual([
        "_root.data",
        "a.data",
        "a/index.html",
        "about.data",
        "about/index.html",
        "b.data",
        "b/index.html",
        "favicon.ico",
        "index.html",
      ]);

      let res = await fixture.requestDocument("/");
      let html = await res.text();
      expect(html).toMatch("<title>Index Title: Index Loader Data</title>");
      expect(html).toMatch("<h1>Root</h1>");
      expect(html).toMatch('<h2 data-route="true">Index</h2>');
      expect(html).toMatch('<p data-loader-data="true">Index Loader Data</p>');

      res = await fixture.requestDocument("/about");
      html = await res.text();
      expect(html).toMatch("<title>About Title: About Loader Data</title>");
      expect(html).toMatch("<h1>Root</h1>");
      expect(html).toMatch('<h2 data-route="true">About</h2>');
      expect(html).toMatch('<p data-loader-data="true">About Loader Data</p>');
    });

    test("Skips action-only resource routes prerender:true", async () => {
      let buildStdio = new PassThrough();
      fixture = await createFixture({
        buildStdio,
        files: {
          "react-router.config.ts": reactRouterConfig({
            prerender: true,
          }),
          "vite.config.ts": files["vite.config.ts"],
          "app/root.tsx": files["app/root.tsx"],
          "app/routes/_index.tsx": files["app/routes/_index.tsx"],
          "app/routes/action.tsx": js`
            export function action() {
              return null
            }
          `,
        },
      });

      let buildOutput: string;
      let chunks: Buffer[] = [];
      buildOutput = await new Promise<string>((resolve, reject) => {
        buildStdio.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        buildStdio.on("error", (err) => reject(err));
        buildStdio.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8"))
        );
      });

      expect(buildOutput).toContain(
        "⚠️ Skipping prerendering for resource route without a loader: routes/action"
      );
      // Only logs once
      expect(buildOutput.match(/routes\/action/g)?.length).toBe(1);
    });

    test("Pre-renders resource routes with file extensions", async () => {
      fixture = await createFixture({
        prerender: true,
        files: {
          ...files,
          "app/routes/text[.txt].tsx": js`
          export function loader() {
            return new Response("Hello, world");
          }
        `,
          "app/routes/json[.json].tsx": js`
          export function loader() {
            return new Response(JSON.stringify({ hello: 'world' }), {
              headers: {
                'Content-Type': 'application/json',
              }
            });
          }
        `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let clientDir = path.join(fixture.projectDir, "build", "client");
      expect(listAllFiles(clientDir).sort()).toEqual([
        "_root.data",
        "about.data",
        "about/index.html",
        "favicon.ico",
        "index.html",
        "json.json",
        "json.json.data",
        "text.txt",
        "text.txt.data",
      ]);

      let res = await fixture.requestResource("/json.json");
      expect(await res.json()).toEqual({ hello: "world" });

      let dataRes = await fixture.requestSingleFetchData("/json.json.data");
      expect(dataRes.data).toEqual({
        "routes/json[.json]": {
          data: {
            hello: "world",
          },
        },
      });

      res = await fixture.requestResource("/text.txt");
      expect(await res.text()).toBe("Hello, world");

      dataRes = await fixture.requestSingleFetchData("/text.txt.data");
      expect(dataRes.data).toEqual({
        "routes/text[.txt]": {
          data: "Hello, world",
        },
      });
    });

    test("Adds leading slashes if omitted in config", async () => {
      fixture = await createFixture({
        prerender: true,
        files: {
          ...files,
          "react-router.config.ts": js`
          export default {
            async prerender() {
              await new Promise(r => setTimeout(r, 1));
              return ['/', 'about'];
            },
          }
        `,
          "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { reactRouter } from "@react-router/dev/vite";

          export default defineConfig({
            build: { manifest: true },
            plugins: [
              reactRouter()
            ],
          });
        `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let clientDir = path.join(fixture.projectDir, "build", "client");
      expect(listAllFiles(clientDir).sort()).toEqual([
        "_root.data",
        "about.data",
        "about/index.html",
        "favicon.ico",
        "index.html",
      ]);

      let res = await fixture.requestDocument("/");
      let html = await res.text();
      expect(html).toMatch("<title>Index Title: Index Loader Data</title>");
      expect(html).toMatch("<h1>Root</h1>");
      expect(html).toMatch('<h2 data-route="true">Index</h2>');
      expect(html).toMatch('<p data-loader-data="true">Index Loader Data</p>');

      res = await fixture.requestDocument("/about");
      html = await res.text();
      expect(html).toMatch("<title>About Title: About Loader Data</title>");
      expect(html).toMatch("<h1>Root</h1>");
      expect(html).toMatch('<h2 data-route="true">About</h2>');
      expect(html).toMatch('<p data-loader-data="true">About Loader Data</p>');
    });
  });

  test.describe("ssr: true", () => {
    test("Serves the prerendered HTML file alongside runtime routes", async ({
      page,
    }) => {
      fixture = await createFixture({
        files: {
          ...files,
          "react-router.config.ts": reactRouterConfig({
            // Don't prerender the /not-prerendered route
            prerender: ["/", "/about"],
          }),
          "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { reactRouter } from "@react-router/dev/vite";

          export default defineConfig({
            build: { manifest: true },
            plugins: [reactRouter()],
          });
        `,
          "app/routes/about.tsx": js`
          import { useLoaderData } from 'react-router';
          export function loader({ request }) {
            return "ABOUT-" + request.headers.has('X-React-Router-Prerender');
          }

          export default function Comp() {
            let data = useLoaderData();
            return <h1>About: <span>{data}</span></h1>
          }
        `,
          "app/routes/not-prerendered.tsx": js`
          import { useLoaderData } from 'react-router';
          export function loader({ request }) {
            return "NOT-PRERENDERED-" + request.headers.has('X-React-Router-Prerender');
          }

          export default function Comp() {
            let data = useLoaderData();
            return <h1>Not-Prerendered: <span>{data}</span></h1>
          }
        `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/about");
      await page.waitForSelector("[data-mounted]");
      expect(await app.getHtml()).toContain("<span>ABOUT-true</span>");

      await app.goto("/not-prerendered");
      await page.waitForSelector("[data-mounted]");
      expect(await app.getHtml()).toContain(
        "<span>NOT-PRERENDERED-false</span>"
      );
    });

    test("Does not encounter header limits on large prerendered data", async ({
      page,
    }) => {
      fixture = await createFixture({
        files: {
          ...files,
          "react-router.config.ts": reactRouterConfig({
            prerender: ["/", "/about"],
          }),
          "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { reactRouter } from "@react-router/dev/vite";

          export default defineConfig({
            build: { manifest: true },
            plugins: [reactRouter()],
          });
        `,
          "app/routes/about.tsx": js`
          import { useLoaderData } from 'react-router';
          export function loader({ request }) {
            return {
              prerendered: request.headers.has('X-React-Router-Prerender') ? 'yes' : 'no',
              // 24999 characters
              data: new Array(5000).fill('test').join('-'),
            };
          }

          export default function Comp() {
            let data = useLoaderData();
            return (
              <>
                <h1 data-title>Large loader</h1>
                <p data-prerendered>{data.prerendered}</p>
                <p data-length>{data.data.length}</p>
              </>
            );
          }
        `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/about");
      await page.waitForSelector("[data-mounted]");
      expect(await app.getHtml("[data-title]")).toContain("Large loader");
      expect(await app.getHtml("[data-prerendered]")).toContain("yes");
      expect(await app.getHtml("[data-length]")).toBe(
        '<p data-length="true">24999</p>'
      );
    });

    test("Handles UTF-8 characters in prerendered and non-prerendered routes", async ({
      page,
    }) => {
      fixture = await createFixture({
        files: {
          ...files,
          "react-router.config.ts": reactRouterConfig({
            prerender: ["/", "/utf8-prerendered"],
          }),
          "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { reactRouter } from "@react-router/dev/vite";

          export default defineConfig({
            build: { manifest: true },
            plugins: [reactRouter()],
          });
        `,
          "app/routes/utf8-prerendered.tsx": js`
          import { useLoaderData } from 'react-router';
          export function loader({ request }) {
            return {
              prerendered: request.headers.has('X-React-Router-Prerender') ? 'yes' : 'no',
              data: "한글 데이터 - UTF-8 문자",
            };
          }

          export default function Comp() {
            let data = useLoaderData();
            return (
              <>
                <h1 data-title>UTF-8 Prerendered</h1>
                <p data-prerendered>{data.prerendered}</p>
                <p data-content>{data.data}</p>
              </>
            );
          }
        `,
          "app/routes/utf8-not-prerendered.tsx": js`
          import { useLoaderData } from 'react-router';
          export function loader({ request }) {
            return {
              prerendered: request.headers.has('X-React-Router-Prerender') ? 'yes' : 'no',
              data: "非プリレンダリングデータ - UTF-8文字",
            };
          }

          export default function Comp() {
            let data = useLoaderData();
            return (
              <>
                <h1 data-title>UTF-8 Not Prerendered</h1>
                <p data-prerendered>{data.prerendered}</p>
                <p data-content>{data.data}</p>
              </>
            );
          }
        `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let app = new PlaywrightFixture(appFixture, page);

      // Test prerendered route with UTF-8 characters
      await app.goto("/utf8-prerendered");
      await page.waitForSelector("[data-mounted]");
      expect(await app.getHtml("[data-title]")).toContain("UTF-8 Prerendered");
      expect(await app.getHtml("[data-prerendered]")).toContain("yes");
      expect(await app.getHtml("[data-content]")).toContain(
        "한글 데이터 - UTF-8 문자"
      );

      // Test non-prerendered route with UTF-8 characters
      await app.goto("/utf8-not-prerendered");
      await page.waitForSelector("[data-mounted]");
      expect(await app.getHtml("[data-title]")).toContain(
        "UTF-8 Not Prerendered"
      );
      expect(await app.getHtml("[data-prerendered]")).toContain("no");
      expect(await app.getHtml("[data-content]")).toContain(
        "非プリレンダリングデータ - UTF-8文字"
      );
    });

    test("Renders down to the proper HydrateFallback", async ({ page }) => {
      fixture = await createFixture({
        files: {
          ...files,
          "react-router.config.ts": reactRouterConfig({
            prerender: ["/", "/parent", "/parent/child"],
          }),
          "vite.config.ts": js`
          import { defineConfig } from "vite";
          import { reactRouter } from "@react-router/dev/vite";

          export default defineConfig({
            build: { manifest: true },
            plugins: [reactRouter()],
          });
        `,
          "app/routes/parent.tsx": js`
          import { Outlet, useLoaderData } from 'react-router';
          export function loader() {
            return "PARENT";
          }
          export default function Comp() {
            let data = useLoaderData();
            return <><p>Parent: {data}</p><Outlet/></>
          }
        `,
          "app/routes/parent.child.tsx": js`
          import { Outlet, useLoaderData } from 'react-router';
          export function loader() {
            return "CHILD";
          }
          export function HydrateFallback() {
            return <p>Child loading...</p>
          }
          export default function Comp() {
            let data = useLoaderData();
            return <><p>Child: {data}</p><Outlet/></>
          }
        `,
          "app/routes/parent.child._index.tsx": js`
          import { Outlet, useLoaderData } from 'react-router';
          export function clientLoader() {
            return "INDEX";
          }
          export default function Comp() {
            let data = useLoaderData();
            return <><p>Index: {data}</p><Outlet/></>
          }
        `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let res = await fixture.requestDocument("/parent/child");
      let html = await res.text();
      expect(html).toContain("<p>Child loading...</p>");

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/parent/child");
      await page.waitForSelector("[data-mounted]");
      expect(await app.getHtml()).toMatch("Index: INDEX");
    });
  });

  test.describe("ssr: false", () => {
    test("Errors on headers/action functions in any route", async () => {
      let cwd = await createProject({
        "react-router.config.ts": reactRouterConfig({
          ssr: false,
          prerender: ["/", "/a"],
        }),
        "app/routes/a.tsx": String.raw`
          // Invalid exports
          export function headers() {}
          export function action() {}

          // Valid exports
          export function loader() {}
          export function clientLoader() {}
          export function clientAction() {}
          export default function Component() {}
        `,
      });
      let result = build({ cwd });
      let stderr = result.stderr.toString("utf8");
      expect(stderr).toMatch(
        "Prerender: 2 invalid route export(s) in `routes/a` when prerendering " +
          "with `ssr:false`: headers, action.  " +
          "See https://reactrouter.com/how-to/pre-rendering for more information."
      );
    });

    test("Errors on loader functions in non-prerendered routes", async () => {
      let cwd = await createProject({
        "react-router.config.ts": reactRouterConfig({
          ssr: false,
          prerender: ["/", "/a"],
        }),
        "app/routes/a.tsx": String.raw`
          export function loader() {}
          export function clientLoader() {}
          export function clientAction() {}
          export default function Component() {}
        `,
        "app/routes/b.tsx": String.raw`
          export function loader() {}
          export function clientLoader() {}
          export function clientAction() {}
          export default function Component() {}
        `,
      });
      let result = build({ cwd });
      let stderr = result.stderr.toString("utf8");
      expect(stderr).toMatch(
        "Prerender: 1 invalid route export in `routes/b` when using `ssr:false` " +
          "with `prerender` because the route is never prerendered so the loader " +
          "will never be called.  See https://reactrouter.com/how-to/pre-rendering " +
          "for more information."
      );
    });

    test("Warns on parameterized routes with prerender:true + ssr:false", async () => {
      let buildStdio = new PassThrough();
      fixture = await createFixture({
        buildStdio,
        prerender: true,
        files: {
          "react-router.config.ts": reactRouterConfig({
            ssr: false,
            prerender: true,
          }),
          "vite.config.ts": files["vite.config.ts"],
          "app/root.tsx": files["app/root.tsx"],
          "app/routes/_index.tsx": files["app/routes/_index.tsx"],
          "app/routes/$slug.tsx": js`
            import { Outlet } from 'react-router'
            export default function Component() {
              return <Outlet/>
            }
          `,
          "app/routes/$.tsx": js`
            import { Outlet } from 'react-router'
            export default function Component() {
              return <Outlet/>
            }
          `,
        },
      });

      let buildOutput: string;
      let chunks: Buffer[] = [];
      buildOutput = await new Promise<string>((resolve, reject) => {
        buildStdio.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        buildStdio.on("error", (err) => reject(err));
        buildStdio.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8"))
        );
      });

      expect(buildOutput).toContain(
        [
          "⚠️ Paths with dynamic/splat params cannot be prerendered when using `prerender: true`. " +
            "You may want to use the `prerender()` API to prerender the following paths:",
          "  - :slug",
          "  - *",
        ].join("\n")
      );
      // Only logs once
      expect(buildOutput.match(/with dynamic\/splat params/g)?.length).toBe(1);
    });

    test("Prerenders a spa fallback with prerender:['/'] + ssr:false", async () => {
      let buildStdio = new PassThrough();
      fixture = await createFixture({
        buildStdio,
        prerender: true,
        files: {
          "react-router.config.ts": reactRouterConfig({
            ssr: false,
            prerender: ["/"],
          }),
          "vite.config.ts": files["vite.config.ts"],
          "app/root.tsx": files["app/root.tsx"],
          "app/routes/_index.tsx": files["app/routes/_index.tsx"],
          "app/routes/page.tsx": js`
            export function clientLoader() {
              return "PAGE DATA"
            }
            export default function Page({ loaderData }) {
              return <p>{loaderData}</p>
            }
          `,
        },
      });

      appFixture = await createAppFixture(fixture);

      let clientDir = path.join(fixture.projectDir, "build", "client");
      expect(listAllFiles(clientDir).sort()).toEqual([
        "__spa-fallback.html",
        "_root.data",
        "favicon.ico",
        "index.html",
      ]);

      let res = await fixture.requestDocument("/");
      let html = await res.text();
      expect(html).toMatch("<title>Index Title: Index Loader Data</title>");
      expect(html).toMatch("<h1>Root</h1>");
      expect(html).toMatch('<h2 data-route="true">Index</h2>');
      expect(html).toMatch('<p data-loader-data="true">Index Loader Data</p>');
      expect(html).not.toMatch("<p>Loading...</p>");

      res = await fixture.requestDocument("/page");
      html = await res.text();
      expect(html).toMatch("<p>Loading...</p>");
    });

    test("Hydrates into a navigable app", async ({ page }) => {
      fixture = await createFixture({
        prerender: true,
        files: {
          ...files,
          "react-router.config.ts": reactRouterConfig({
            ssr: false, // turn off fog of war since we're serving with a static server
            prerender: true,
          }),
        },
      });
      appFixture = await createAppFixture(fixture);

      let requests: string[] = [];
      page.on("request", (request) => {
        let pathname = new URL(request.url()).pathname;
        if (pathname.endsWith(".data") || pathname.endsWith("__manifest")) {
          requests.push(pathname);
        }
      });

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await page.waitForSelector("[data-mounted]");
      await app.clickLink("/about");
      await page.waitForSelector("[data-route]:has-text('About')");
      expect(requests).toEqual(["/about.data"]);
    });

    test("Hydrates into a navigable app from the spa fallback", async ({
      page,
    }) => {
      fixture = await createFixture({
        prerender: true,
        files: {
          "react-router.config.ts": reactRouterConfig({
            ssr: false, // turn off fog of war since we're serving with a static server
            prerender: ["/"],
          }),
          "vite.config.ts": files["vite.config.ts"],
          "app/root.tsx": files["app/root.tsx"],
          "app/routes/_index.tsx": files["app/routes/_index.tsx"],
          "app/routes/page.tsx": js`
            import { Link } from 'react-router';
            export async function clientLoader() {
              await new Promise(r => setTimeout(r, 1000));
              return "PAGE DATA"
            }
            export default function Page({ loaderData }) {
              return (
                <>
                  <p data-page>{loaderData}</p>
                  <Link to="/page2">Go to page2</Link>
                </>
              );
            }
          `,
          "app/routes/page2.tsx": js`
            export function clientLoader() {
              return "PAGE2 DATA"
            }
            export default function Page({ loaderData }) {
              return <p data-page2>{loaderData}</p>
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let app = new PlaywrightFixture(appFixture, page);
      // Load a path we didn't prerender, ensure it starts with the root fallback,
      // hydrates, and then lets you navigate
      await app.goto("/page");
      expect(await page.getByText("Loading...")).toBeVisible();
      await page.waitForSelector("[data-page]");
      await app.clickLink("/page2");
      await page.waitForSelector("[data-page2]");
      expect(await (await page.$("[data-page2]"))?.innerText()).toBe(
        "PAGE2 DATA"
      );
    });

    test("Properly navigates across SPA/prerender pages when starting from a prerendered page and a root loader exists", async ({
      page,
    }) => {
      fixture = await createFixture({
        prerender: true,
        files: {
          "react-router.config.ts": reactRouterConfig({
            ssr: false, // turn off fog of war since we're serving with a static server
            prerender: ["/", "/page"],
          }),
          "vite.config.ts": files["vite.config.ts"],
          "app/root.tsx": js`
            import * as React from "react";
            import { Outlet, Scripts } from "react-router";

            export function loader() {
              return "ROOT DATA";
            }

            export function Layout({ children }) {
              return (
                <html lang="en">
                  <head />
                  <body>
                    {children}
                    <Scripts />
                  </body>
                </html>
              );
            }

            export default function Root({ loaderData }) {
              return (
                <>
                  <p data-root>{loaderData}</p>
                  <Outlet />
                </>
              );
            }
          `,
          "app/routes/_index.tsx": js`
            import { Link } from 'react-router';
            export default function Index() {
              return <Link to="/page">Go to page</Link>
            }
          `,
          "app/routes/page.tsx": js`
            import { Link, Form } from 'react-router';
            export async function loader() {
              return "PAGE DATA"
            }
            let count = 0;
            export function clientAction() {
              return "PAGE ACTION " + (++count)
            }
            export default function Page({ loaderData, actionData }) {
              return (
                <>
                  <p data-page>{loaderData}</p>
                  {actionData ? <p data-page-action>{actionData}</p> : null}
                  <Link to="/page2">Go to page2</Link>
                  <Form method="post" action="/page">
                    <button type="submit">Submit</button>
                  </Form>
                  <Form method="post" action="/page2">
                    <button type="submit">Submit /page2</button>
                  </Form>
                </>
              );
            }
          `,
          "app/routes/page2.tsx": js`
            import { Form } from 'react-router';
            export function clientLoader() {
              return "PAGE2 DATA"
            }
            let count = 0;
            export function clientAction() {
              return "PAGE2 ACTION " + (++count)
            }
            export default function Page({ loaderData, actionData }) {
              return (
                <>
                  <p data-page2>{loaderData}</p>
                  {actionData ? <p data-page2-action>{actionData}</p> : null}
                  <Form method="post" action="/page">
                    <button type="submit">Submit</button>
                  </Form>
                  <Form method="post" action="/page2">
                    <button type="submit">Submit /page2</button>
                  </Form>
                </>
              );
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let requests: string[] = [];
      page.on("request", (request) => {
        let pathname = new URL(request.url()).pathname;
        if (pathname.endsWith(".data") || pathname.endsWith("__manifest")) {
          requests.push(pathname);
        }
      });

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/", true);
      await page.waitForSelector("[data-root]");
      expect(await (await page.$("[data-root]"))?.innerText()).toBe(
        "ROOT DATA"
      );

      await app.clickLink("/page");
      await page.waitForSelector("[data-page]");
      expect(await (await page.$("[data-page]"))?.innerText()).toBe(
        "PAGE DATA"
      );

      await app.clickSubmitButton("/page");
      await page.waitForSelector("[data-page-action]");
      expect(await (await page.$("[data-page-action]"))?.innerText()).toBe(
        "PAGE ACTION 1"
      );

      await app.clickLink("/page2");
      await page.waitForSelector("[data-page2]");
      expect(await (await page.$("[data-page2]"))?.innerText()).toBe(
        "PAGE2 DATA"
      );

      await app.clickSubmitButton("/page2");
      await page.waitForSelector("[data-page2-action]");
      expect(await (await page.$("[data-page2-action]"))?.innerText()).toBe(
        "PAGE2 ACTION 1"
      );

      await app.clickSubmitButton("/page");
      await page.waitForSelector("[data-page-action]");
      expect(await (await page.$("[data-page-action]"))?.innerText()).toBe(
        "PAGE ACTION 2"
      );

      await app.clickSubmitButton("/page2");
      await page.waitForSelector("[data-page2-action]");
      expect(await (await page.$("[data-page2-action]"))?.innerText()).toBe(
        "PAGE2 ACTION 2"
      );

      // We should only make this call when navigating to the prerendered route
      // 3 calls:
      // - Initial navigation
      // - Revalidation on submission to self
      // - Revalidation after submission back from /page
      expect(requests).toEqual(["/page.data", "/page.data", "/page.data"]);
    });

    test("Properly navigates across SPA/prerender pages when starting from a SPA page", async ({
      page,
    }) => {
      fixture = await createFixture({
        prerender: true,
        files: {
          "react-router.config.ts": reactRouterConfig({
            ssr: false, // turn off fog of war since we're serving with a static server
            prerender: ["/page"],
          }),
          "vite.config.ts": files["vite.config.ts"],
          "app/root.tsx": js`
            import * as React from "react";
            import { Outlet, Scripts } from "react-router";

            export function Layout({ children }) {
              return (
                <html lang="en">
                  <head />
                  <body>
                    {children}
                    <Scripts />
                  </body>
                </html>
              );
            }

            export default function Root({ loaderData }) {
              return <Outlet />
            }
          `,
          "app/routes/_index.tsx": js`
            import { Link } from 'react-router';
            export default function Index() {
              return <Link to="/page">Go to page</Link>
            }
          `,
          "app/routes/page.tsx": js`
            import { Link, Form } from 'react-router';
            export async function loader() {
              return "PAGE DATA"
            }
            let count = 0;
            export function clientAction() {
              return "PAGE ACTION " + (++count)
            }
            export default function Page({ loaderData, actionData }) {
              return (
                <>
                  <p data-page>{loaderData}</p>
                  {actionData ? <p data-page-action>{actionData}</p> : null}
                  <Link to="/page2">Go to page2</Link>
                  <Form method="post" action="/page">
                    <button type="submit">Submit</button>
                  </Form>
                  <Form method="post" action="/page2">
                    <button type="submit">Submit /page2</button>
                  </Form>
                </>
              );
            }
          `,
          "app/routes/page2.tsx": js`
            import { Form } from 'react-router';
            export function clientLoader() {
              return "PAGE2 DATA"
            }
            let count = 0;
            export function clientAction() {
              return "PAGE2 ACTION " + (++count)
            }
            export default function Page({ loaderData, actionData }) {
              return (
                <>
                  <p data-page2>{loaderData}</p>
                  {actionData ? <p data-page2-action>{actionData}</p> : null}
                  <Form method="post" action="/page">
                    <button type="submit">Submit</button>
                  </Form>
                  <Form method="post" action="/page2">
                    <button type="submit">Submit /page2</button>
                  </Form>
                </>
              );
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let requests: string[] = [];
      page.on("request", (request) => {
        let pathname = new URL(request.url()).pathname;
        if (pathname.endsWith(".data") || pathname.endsWith("__manifest")) {
          requests.push(pathname);
        }
      });

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/", true);
      await page.waitForSelector('a[href="/page"]');

      await app.clickLink("/page");
      await page.waitForSelector("[data-page]");
      expect(await (await page.$("[data-page]"))?.innerText()).toBe(
        "PAGE DATA"
      );

      await app.clickSubmitButton("/page");
      await page.waitForSelector("[data-page-action]");
      expect(await (await page.$("[data-page-action]"))?.innerText()).toBe(
        "PAGE ACTION 1"
      );

      await app.clickLink("/page2");
      await page.waitForSelector("[data-page2]");
      expect(await (await page.$("[data-page2]"))?.innerText()).toBe(
        "PAGE2 DATA"
      );

      await app.clickSubmitButton("/page2");
      await page.waitForSelector("[data-page2-action]");
      expect(await (await page.$("[data-page2-action]"))?.innerText()).toBe(
        "PAGE2 ACTION 1"
      );

      await app.clickSubmitButton("/page");
      await page.waitForSelector("[data-page-action]");
      expect(await (await page.$("[data-page-action]"))?.innerText()).toBe(
        "PAGE ACTION 2"
      );

      await app.clickSubmitButton("/page2");
      await page.waitForSelector("[data-page2-action]");
      expect(await (await page.$("[data-page2-action]"))?.innerText()).toBe(
        "PAGE2 ACTION 2"
      );

      // We should only make this call when navigating to the prerendered route
      // 3 calls:
      // - Initial navigation
      // - Revalidation on submission to self
      // - Revalidation after submission back from /page
      expect(requests).toEqual(["/page.data", "/page.data", "/page.data"]);
    });

    test("Properly navigates across SPA/prerender pages when starting from a prerendered page", async ({
      page,
    }) => {
      fixture = await createFixture({
        prerender: true,
        files: {
          "react-router.config.ts": reactRouterConfig({
            ssr: false, // turn off fog of war since we're serving with a static server
            prerender: ["/", "/page"],
          }),
          "vite.config.ts": files["vite.config.ts"],
          "app/root.tsx": js`
            import * as React from "react";
            import { Outlet, Scripts } from "react-router";

            export function Layout({ children }) {
              return (
                <html lang="en">
                  <head />
                  <body>
                    {children}
                    <Scripts />
                  </body>
                </html>
              );
            }

            export default function Root({ loaderData }) {
              return <Outlet />;
            }
          `,
          "app/routes/_index.tsx": js`
            import { Link } from 'react-router';
            export default function Index() {
              return <Link to="/page">Go to page</Link>
            }
          `,
          "app/routes/page.tsx": js`
            import { Link, Form } from 'react-router';
            export async function loader() {
              return "PAGE DATA"
            }
            let count = 0;
            export function clientAction() {
              return "PAGE ACTION " + (++count)
            }
            export default function Page({ loaderData, actionData }) {
              return (
                <>
                  <p data-page>{loaderData}</p>
                  {actionData ? <p data-page-action>{actionData}</p> : null}
                  <Link to="/page2">Go to page2</Link>
                  <Form method="post" action="/page">
                    <button type="submit">Submit</button>
                  </Form>
                  <Form method="post" action="/page2">
                    <button type="submit">Submit /page2</button>
                  </Form>
                </>
              );
            }
          `,
          "app/routes/page2.tsx": js`
            import { Form } from 'react-router';
            export function clientLoader() {
              return "PAGE2 DATA"
            }
            let count = 0;
            export function clientAction() {
              return "PAGE2 ACTION " + (++count)
            }
            export default function Page({ loaderData, actionData }) {
              return (
                <>
                  <p data-page2>{loaderData}</p>
                  {actionData ? <p data-page2-action>{actionData}</p> : null}
                  <Form method="post" action="/page">
                    <button type="submit">Submit</button>
                  </Form>
                  <Form method="post" action="/page2">
                    <button type="submit">Submit /page2</button>
                  </Form>
                </>
              );
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let requests: string[] = [];
      page.on("request", (request) => {
        let pathname = new URL(request.url()).pathname;
        if (pathname.endsWith(".data") || pathname.endsWith("__manifest")) {
          requests.push(pathname);
        }
      });

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/", true);
      await page.waitForSelector('a[href="/page"]');

      await app.clickLink("/page");
      await page.waitForSelector("[data-page]");
      expect(await (await page.$("[data-page]"))?.innerText()).toBe(
        "PAGE DATA"
      );

      await app.clickSubmitButton("/page");
      await page.waitForSelector("[data-page-action]");
      expect(await (await page.$("[data-page-action]"))?.innerText()).toBe(
        "PAGE ACTION 1"
      );

      await app.clickLink("/page2");
      await page.waitForSelector("[data-page2]");
      expect(await (await page.$("[data-page2]"))?.innerText()).toBe(
        "PAGE2 DATA"
      );

      await app.clickSubmitButton("/page2");
      await page.waitForSelector("[data-page2-action]");
      expect(await (await page.$("[data-page2-action]"))?.innerText()).toBe(
        "PAGE2 ACTION 1"
      );

      await app.clickSubmitButton("/page");
      await page.waitForSelector("[data-page-action]");
      expect(await (await page.$("[data-page-action]"))?.innerText()).toBe(
        "PAGE ACTION 2"
      );

      await app.clickSubmitButton("/page2");
      await page.waitForSelector("[data-page2-action]");
      expect(await (await page.$("[data-page2-action]"))?.innerText()).toBe(
        "PAGE2 ACTION 2"
      );

      // We should only make this call when navigating to the prerendered route
      // 3 calls:
      // - Initial navigation
      // - Revalidation on submission to self
      // - Revalidation after submission back from /page
      expect(requests).toEqual(["/page.data", "/page.data", "/page.data"]);
    });

    test("Properly navigates across SPA/prerender pages when starting from a SPA page and a root loader exists", async ({
      page,
    }) => {
      fixture = await createFixture({
        prerender: true,
        files: {
          "react-router.config.ts": reactRouterConfig({
            ssr: false, // turn off fog of war since we're serving with a static server
            prerender: ["/page"],
          }),
          "vite.config.ts": files["vite.config.ts"],
          "app/root.tsx": js`
            import * as React from "react";
            import { Outlet, Scripts } from "react-router";

            export function loader() {
              return "ROOT DATA";
            }

            export function Layout({ children }) {
              return (
                <html lang="en">
                  <head />
                  <body>
                    {children}
                    <Scripts />
                  </body>
                </html>
              );
            }

            export default function Root({ loaderData }) {
              return (
                <>
                  <p data-root>{loaderData}</p>
                  <Outlet />
                </>
              );
            }
          `,
          "app/routes/_index.tsx": js`
            import { Link } from 'react-router';
            export default function Index() {
              return <Link to="/page">Go to page</Link>
            }
          `,
          "app/routes/page.tsx": js`
            import { Link, Form } from 'react-router';
            export async function loader() {
              return "PAGE DATA"
            }
            let count = 0;
            export function clientAction() {
              return "PAGE ACTION " + (++count)
            }
            export default function Page({ loaderData, actionData }) {
              return (
                <>
                  <p data-page>{loaderData}</p>
                  {actionData ? <p data-page-action>{actionData}</p> : null}
                  <Link to="/page2">Go to page2</Link>
                  <Form method="post" action="/page">
                    <button type="submit">Submit</button>
                  </Form>
                  <Form method="post" action="/page2">
                    <button type="submit">Submit /page2</button>
                  </Form>
                </>
              );
            }
          `,
          "app/routes/page2.tsx": js`
            import { Form } from 'react-router';
            export function clientLoader() {
              return "PAGE2 DATA"
            }
            let count = 0;
            export function clientAction() {
              return "PAGE2 ACTION " + (++count)
            }
            export default function Page({ loaderData, actionData }) {
              return (
                <>
                  <p data-page2>{loaderData}</p>
                  {actionData ? <p data-page2-action>{actionData}</p> : null}
                  <Form method="post" action="/page">
                    <button type="submit">Submit</button>
                  </Form>
                  <Form method="post" action="/page2">
                    <button type="submit">Submit /page2</button>
                  </Form>
                </>
              );
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let requests: string[] = [];
      page.on("request", (request) => {
        let pathname = new URL(request.url()).pathname;
        if (pathname.endsWith(".data") || pathname.endsWith("__manifest")) {
          requests.push(pathname);
        }
      });

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/", true);
      await page.waitForSelector("[data-root]");
      expect(await (await page.$("[data-root]"))?.innerText()).toBe(
        "ROOT DATA"
      );

      await app.clickLink("/page");
      await page.waitForSelector("[data-page]");
      expect(await (await page.$("[data-page]"))?.innerText()).toBe(
        "PAGE DATA"
      );

      await app.clickSubmitButton("/page");
      await page.waitForSelector("[data-page-action]");
      expect(await (await page.$("[data-page-action]"))?.innerText()).toBe(
        "PAGE ACTION 1"
      );

      await app.clickLink("/page2");
      await page.waitForSelector("[data-page2]");
      expect(await (await page.$("[data-page2]"))?.innerText()).toBe(
        "PAGE2 DATA"
      );

      await app.clickSubmitButton("/page2");
      await page.waitForSelector("[data-page2-action]");
      expect(await (await page.$("[data-page2-action]"))?.innerText()).toBe(
        "PAGE2 ACTION 1"
      );

      await app.clickSubmitButton("/page");
      await page.waitForSelector("[data-page-action]");
      expect(await (await page.$("[data-page-action]"))?.innerText()).toBe(
        "PAGE ACTION 2"
      );

      await app.clickSubmitButton("/page2");
      await page.waitForSelector("[data-page2-action]");
      expect(await (await page.$("[data-page2-action]"))?.innerText()).toBe(
        "PAGE2 ACTION 2"
      );

      // We should only make this call when navigating to the prerendered route
      // 3 calls:
      // - Initial navigation
      // - Revalidation on submission to self
      // - Revalidation after submission back from /page
      expect(requests).toEqual(["/page.data", "/page.data", "/page.data"]);
    });

    test("Handles 404s on data requests", async ({ page }) => {
      fixture = await createFixture({
        prerender: true,
        files: {
          "react-router.config.ts": reactRouterConfig({
            ssr: false, // turn off fog of war since we're serving with a static server
            prerender: ["/", "/slug"],
          }),
          // Just bring in the root instead of all `files` since we can't have
          // loaders in non-prerendered routes
          "app/root.tsx": files["app/root.tsx"],
          "app/routes/$slug.tsx": js`
            import * as React  from "react";
            import { useLoaderData } from "react-router";

            export async function loader() {
              return null;
            }

            export default function Component() {
              return <h2>Slug</h2>
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);

      let requests: string[] = [];
      page.on("request", (request) => {
        let pathname = new URL(request.url()).pathname;
        if (pathname.endsWith(".data")) {
          requests.push(pathname);
        }
      });

      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/");
      await page.waitForSelector("[data-mounted]");
      await app.clickLink("/not-found");
      await page.waitForSelector("[data-error]:has-text('404 Not Found')");
      expect(requests).toEqual(["/not-found.data"]);
    });
  });
});
