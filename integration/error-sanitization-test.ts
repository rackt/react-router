import { test, expect } from "@playwright/test";
import {
  UNSAFE_ErrorResponseImpl as ErrorResponseImpl,
  UNSAFE_ServerMode as ServerMode,
} from "react-router";

import type { Fixture } from "./helpers/create-fixture.js";
import {
  createAppFixture,
  createFixture,
  js,
} from "./helpers/create-fixture.js";
import { PlaywrightFixture } from "./helpers/playwright-fixture.js";

const routeFiles = {
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

  "app/routes/_index.tsx": js`
    import { useLoaderData, useLocation, useRouteError } from "react-router";

    export function loader({ request }) {
      if (new URL(request.url).searchParams.has('loader')) {
        throw new Error("Loader Error");
      }
      if (new URL(request.url).searchParams.has('subclass')) {
        // This will throw a ReferenceError
        console.log(thisisnotathing);
      }
      return "LOADER"
    }

    export default function Component() {
      let data = useLoaderData();
      let location = useLocation();

      if (location.search.includes('render')) {
        throw new Error("Render Error");
      }

      return (
        <>
          <h1>Index Route</h1>
          <p>{JSON.stringify(data)}</p>
        </>
      );
    }

    export function ErrorBoundary() {
      let error = useRouteError();
      return (
        <>
          <h1>Index Error</h1>
          <p>{"MESSAGE:" + error.message}</p>
          <p>{"NAME:" + error.name}</p>
          {error.stack ? <p>{"STACK:" + error.stack}</p> : null}
        </>
      );
    }
  `,

  "app/routes/defer.tsx": js`
    import * as React from 'react';
    import { Await, useAsyncError, useLoaderData, useRouteError } from "react-router";

    export function loader({ request }) {
      if (new URL(request.url).searchParams.has('loader')) {
        return {
          lazy: Promise.reject(new Error("REJECTED")),
        };
      }
      return {
        lazy: Promise.resolve("RESOLVED"),
      };
    }

    export default function Component() {
      let data = useLoaderData();

      return (
        <>
          <h1>Defer Route</h1>
          <React.Suspense fallback={<p>Loading...</p>}>
            <Await resolve={data.lazy} errorElement={<AwaitError />}>
              {(val) => <p>{val}</p>}
            </Await>
          </React.Suspense>
        </>
      );
    }

    function AwaitError() {
      let error = useAsyncError();
      return (
        <>
          <h2>Defer Error</h2>
          <p>{error.message}</p>
        </>
      );
    }

    export function ErrorBoundary() {
      let error = useRouteError();
      return (
        <>
          <h1>Defer Error</h1>
          <p>{"MESSAGE:" + error.message}</p>
          {error.stack ? <p>{"STACK:" + error.stack}</p> : null}
        </>
      );
    }
  `,

  "app/routes/resource.tsx": js`
    export function loader({ request }) {
      if (new URL(request.url).searchParams.has('loader')) {
        throw new Error("Loader Error");
      }
      return "RESOURCE LOADER"
    }
  `,
};

test.describe("Error Sanitization", () => {
  let fixture: Fixture;
  let oldConsoleError: () => void;
  let errorLogs: any[] = [];

  test.beforeEach(() => {
    oldConsoleError = console.error;
    errorLogs = [];
    console.error = (...args) => errorLogs.push(args);
  });

  test.afterEach(() => {
    console.error = oldConsoleError;
  });

  test.describe("serverMode=production", () => {
    test.beforeAll(async () => {
      fixture = await createFixture(
        {
          files: routeFiles,
        },
        ServerMode.Production
      );
    });

    test("renders document without errors", async () => {
      let response = await fixture.requestDocument("/");
      let html = await response.text();
      expect(html).toMatch("Index Route");
      expect(html).toMatch("LOADER");
      expect(html).not.toMatch("MESSAGE:");
      expect(html).not.toMatch(/stack/i);
    });

    test("sanitizes loader errors in document requests", async () => {
      let response = await fixture.requestDocument("/?loader");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).not.toMatch("LOADER");
      expect(html).toMatch("MESSAGE:Unexpected Server Error");
      // This is the turbo-stream encoding - the fact that stack goes right
      // into __type means it has no value
      expect(html).toMatch(
        '\\"message\\",\\"Unexpected Server Error\\",\\"stack\\",\\"__type\\",\\"Error\\"'
      );
      expect(html).not.toMatch(/ at /i);
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("sanitizes render errors in document requests", async () => {
      let response = await fixture.requestDocument("/?render");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).toMatch("MESSAGE:Unexpected Server Error");
      // This is the turbo-stream encoding - the fact that stack goes right
      // into __type means it has no value
      expect(html).toMatch(
        '\\"message\\",\\"Unexpected Server Error\\",\\"stack\\",\\"__type\\",\\"Error\\"'
      );
      expect(html).not.toMatch(/ at /i);
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Render Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("renders deferred document without errors", async () => {
      let response = await fixture.requestDocument("/defer");
      let html = await response.text();
      expect(html).toMatch("Defer Route");
      expect(html).toMatch("RESOLVED");
      expect(html).not.toMatch("MESSAGE:");
      // Defer errors are not not part of the JSON blob but rather rejected
      // against a pending promise and therefore are inlined JS.
      expect(html).not.toMatch("x.stack=e.stack;");
    });

    test("sanitizes defer errors in document requests", async () => {
      let response = await fixture.requestDocument("/defer?loader");
      let html = await response.text();
      expect(html).toMatch("Defer Error");
      expect(html).not.toMatch("RESOLVED");
      expect(html).toMatch("Unexpected Server Error");
      expect(html).not.toMatch("stack");
      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("returns data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data");
      expect(data).toEqual({
        root: {
          data: null,
        },
        "routes/_index": {
          data: "LOADER",
        },
      });
    });

    test("sanitizes loader errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data?loader");
      expect(data).toEqual({
        root: {
          data: null,
        },
        "routes/_index": {
          error: new Error("Unexpected Server Error"),
        },
      });
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("returns deferred data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data");
      expect(await data["routes/defer"].data.lazy).toEqual("RESOLVED");
    });

    test("sanitizes loader errors in deferred data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data?loader");
      try {
        await data["routes/defer"].data.lazy;
        expect(true).toBe(false);
      } catch (e) {
        expect((e as Error).message).toBe("Unexpected Server Error");
        expect((e as Error).stack).toBeUndefined();
      }
      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("sanitizes loader errors in resource requests", async () => {
      let response = await fixture.requestResource("/resource?loader");
      let text = await response.text();
      expect(text).toBe("Unexpected Server Error");
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("does not sanitize mismatched route errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/not-a-route.data");
      expect(data).toEqual({
        root: {
          error: new ErrorResponseImpl(
            404,
            "Not Found",
            'Error: No route matches URL "/not-a-route"'
          ),
        },
      });
      expect(errorLogs).toEqual([
        [new Error('No route matches URL "/not-a-route"')],
      ]);
    });

    test("does not support hydration of Error subclasses", async ({ page }) => {
      let response = await fixture.requestDocument("/?subclass");
      let html = await response.text();
      expect(html).toMatch("<p>MESSAGE:Unexpected Server Error");
      expect(html).toMatch("<p>NAME:Error");

      // Hydration
      let appFixture = await createAppFixture(fixture);
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/?subclass", true);
      html = await app.getHtml();
      expect(html).toMatch("<p>MESSAGE:Unexpected Server Error");
      expect(html).toMatch("<p>NAME:Error");
    });
  });

  test.describe("serverMode=development", () => {
    test.beforeAll(async () => {
      fixture = await createFixture(
        {
          files: routeFiles,
        },
        ServerMode.Development
      );
    });
    let ogEnv = process.env.NODE_ENV;
    test.beforeEach(() => {
      ogEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
    });
    test.afterEach(() => {
      process.env.NODE_ENV = ogEnv;
    });

    test("renders document without errors", async () => {
      let response = await fixture.requestDocument("/");
      let html = await response.text();
      expect(html).toMatch("Index Route");
      expect(html).toMatch("LOADER");
      expect(html).not.toMatch("MESSAGE:");
      expect(html).not.toMatch(/stack/i);
    });

    test("does not sanitize loader errors in document requests", async () => {
      let response = await fixture.requestDocument("/?loader");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).not.toMatch("LOADER");
      expect(html).toMatch("<p>MESSAGE:Loader Error");
      expect(html).toMatch("<p>STACK:Error: Loader Error");
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("does not sanitize render errors in document requests", async () => {
      let response = await fixture.requestDocument("/?render");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).toMatch("<p>MESSAGE:Render Error");
      expect(html).toMatch("<p>STACK:Error: Render Error");
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Render Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("renders deferred document without errors", async () => {
      let response = await fixture.requestDocument("/defer");
      let html = await response.text();
      expect(html).toMatch("Defer Route");
      expect(html).toMatch("RESOLVED");
      expect(html).not.toMatch("MESSAGE:");
      expect(html).not.toMatch(/"stack":/i);
    });

    test("does not sanitize defer errors in document requests", async () => {
      let response = await fixture.requestDocument("/defer?loader");
      let html = await response.text();
      expect(html).toMatch("Defer Error");
      expect(html).not.toMatch("RESOLVED");
      expect(html).toMatch("<p>REJECTED</p>");
      expect(html).toMatch("Error: REJECTED\\\\n    at ");
      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("returns data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data");
      expect(data).toEqual({
        root: {
          data: null,
        },
        "routes/_index": {
          data: "LOADER",
        },
      });
    });

    test("does not sanitize loader errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data?loader");
      expect(data).toEqual({
        root: {
          data: null,
        },
        "routes/_index": {
          error: new Error("Loader Error"),
        },
      });
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("returns deferred data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data");
      expect(await data["routes/defer"].data.lazy).toEqual("RESOLVED");
    });

    test("does not sanitize loader errors in deferred data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data?loader");
      try {
        await data["routes/defer"].data.lazy;
        expect(true).toBe(false);
      } catch (e) {
        expect((e as Error).message).toBe("REJECTED");
        expect((e as Error).stack).not.toBeUndefined();
      }

      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("does not sanitize loader errors in resource requests", async () => {
      let response = await fixture.requestResource("/resource?loader");
      let text = await response.text();
      expect(text).toBe("Unexpected Server Error\n\nError: Loader Error");
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("does not sanitize mismatched route errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/not-a-route.data");
      expect(data).toEqual({
        root: {
          error: new ErrorResponseImpl(
            404,
            "Not Found",
            'Error: No route matches URL "/not-a-route"'
          ),
        },
      });
      expect(errorLogs).toEqual([
        [new Error('No route matches URL "/not-a-route"')],
      ]);
    });

    test("supports hydration of Error subclasses", async ({ page }) => {
      let response = await fixture.requestDocument("/?subclass");
      let html = await response.text();
      expect(html).toMatch("<p>MESSAGE:thisisnotathing is not defined");
      expect(html).toMatch("<p>NAME:ReferenceError");
      expect(html).toMatch(
        "<p>STACK:ReferenceError: thisisnotathing is not defined"
      );

      // Hydration
      let appFixture = await createAppFixture(fixture, ServerMode.Development);
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/?subclass", true);
      html = await app.getHtml();
      expect(html).toMatch("<p>MESSAGE:thisisnotathing is not defined");
      expect(html).toMatch("<p>NAME:ReferenceError");
      expect(html).toMatch(
        "STACK:ReferenceError: thisisnotathing is not defined"
      );
    });
  });

  test.describe("serverMode=production (user-provided handleError)", () => {
    test.beforeAll(async () => {
      fixture = await createFixture(
        {
          files: {
            "app/entry.server.tsx": js`
              import { PassThrough } from "node:stream";

              import { createReadableStreamFromReadable } from "@react-router/node";
              import { ServerRouter, isRouteErrorResponse } from "react-router";
              import { renderToPipeableStream } from "react-dom/server";

              export default function handleRequest(
                request,
                responseStatusCode,
                responseHeaders,
                remixContext
              ) {
                return new Promise((resolve, reject) => {
                  let shellRendered = false;
                  const { pipe, abort } = renderToPipeableStream(
                    <ServerRouter context={remixContext} url={request.url} />,
                    {
                      onShellReady() {
                        shellRendered = true;
                        const body = new PassThrough();
                        const stream = createReadableStreamFromReadable(body);

                        responseHeaders.set("Content-Type", "text/html");

                        resolve(
                          new Response(stream, {
                            headers: responseHeaders,
                            status: responseStatusCode,
                          })
                        );

                        pipe(body);
                      },
                      onShellError(error) {
                        reject(error);
                      },
                      onError(error) {
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

                  setTimeout(abort, 5000);
                });
              }

              export function handleError(
                error: unknown,
                { request }: { request: Request },
              ) {
                console.error("App Specific Error Logging:");
                console.error("  Request: " + request.method + " " + request.url);
                if (isRouteErrorResponse(error)) {
                  console.error("  Status: " + error.status + " " + error.statusText);
                  console.error("  Error: " + error.error.message);
                  console.error("  Stack: " + error.error.stack);
                } else if (error instanceof Error) {
                  console.error("  Error: " + error.message);
                  console.error("  Stack: " + error.stack);
                } else {
                  console.error("Dunno what this is");
                }
              }
            `,
            ...routeFiles,
          },
        },
        ServerMode.Production
      );
    });

    test("renders document without errors", async () => {
      let response = await fixture.requestDocument("/");
      let html = await response.text();
      expect(html).toMatch("Index Route");
      expect(html).toMatch("LOADER");
      expect(html).not.toMatch("MESSAGE:");
      expect(html).not.toMatch(/stack/i);
    });

    test("sanitizes loader errors in document requests", async () => {
      let response = await fixture.requestDocument("/?loader");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).not.toMatch("LOADER");
      expect(html).toMatch("MESSAGE:Unexpected Server Error");
      // This is the turbo-stream encoding - the fact that stack goes right
      // into __type means it has no value
      expect(html).toMatch(
        '\\"message\\",\\"Unexpected Server Error\\",\\"stack\\",\\"__type\\",\\"Error\\"'
      );
      expect(html).not.toMatch(/ at /i);
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[1][0]).toEqual("  Request: GET test://test/?loader");
      expect(errorLogs[2][0]).toEqual("  Error: Loader Error");
      expect(errorLogs[3][0]).toMatch(" at ");
      expect(errorLogs.length).toBe(4);
    });

    test("sanitizes render errors in document requests", async () => {
      let response = await fixture.requestDocument("/?render");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).toMatch("MESSAGE:Unexpected Server Error");
      // This is the turbo-stream encoding - the fact that stack goes right
      // into __type means it has no value
      expect(html).toMatch(
        '\\"message\\",\\"Unexpected Server Error\\",\\"stack\\",\\"__type\\",\\"Error\\"'
      );
      expect(html).not.toMatch(/ at /i);
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[1][0]).toEqual("  Request: GET test://test/?render");
      expect(errorLogs[2][0]).toEqual("  Error: Render Error");
      expect(errorLogs[3][0]).toMatch(" at ");
      expect(errorLogs.length).toBe(4);
    });

    test("renders deferred document without errors", async () => {
      let response = await fixture.requestDocument("/defer");
      let html = await response.text();
      expect(html).toMatch("Defer Route");
      expect(html).toMatch("RESOLVED");
      expect(html).not.toMatch("MESSAGE:");
      // Defer errors are not not part of the JSON blob but rather rejected
      // against a pending promise and therefore are inlined JS.
      expect(html).not.toMatch("x.stack=e.stack;");
    });

    test("sanitizes defer errors in document requests", async () => {
      let response = await fixture.requestDocument("/defer?loader");
      let html = await response.text();
      expect(html).toMatch("Defer Error");
      expect(html).not.toMatch("RESOLVED");
      expect(html).toMatch("Unexpected Server Error");
      expect(html).not.toMatch("stack");
      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("returns data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data");
      expect(data).toEqual({
        root: {
          data: null,
        },
        "routes/_index": {
          data: "LOADER",
        },
      });
    });

    test("sanitizes loader errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data?loader");
      expect(data).toEqual({
        root: { data: null },
        "routes/_index": { error: new Error("Unexpected Server Error") },
      });
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[1][0]).toEqual(
        "  Request: GET test://test/_root.data?loader"
      );
      expect(errorLogs[2][0]).toEqual("  Error: Loader Error");
      expect(errorLogs[3][0]).toMatch(" at ");
      expect(errorLogs.length).toBe(4);
    });

    test("returns deferred data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data");
      expect(await data["routes/defer"].data.lazy).toBe("RESOLVED");
    });

    test("sanitizes loader errors in deferred data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data?loader");
      try {
        await data["routes/defer"].data.lazy;
        expect(true).toBe(false);
      } catch (e) {
        expect((e as Error).message).toBe("Unexpected Server Error");
        expect((e as Error).stack).toBeUndefined();
      }
      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("sanitizes loader errors in resource requests", async () => {
      let response = await fixture.requestResource("/resource?loader");
      let text = await response.text();
      expect(text).toBe("Unexpected Server Error");
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[1][0]).toEqual(
        "  Request: GET test://test/resource?loader"
      );
      expect(errorLogs[2][0]).toEqual("  Error: Loader Error");
      expect(errorLogs[3][0]).toMatch(" at ");
      expect(errorLogs.length).toBe(4);
    });

    test("does not sanitize mismatched route errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/not-a-route.data");
      expect(data).toEqual({
        root: {
          error: new ErrorResponseImpl(
            404,
            "Not Found",
            'Error: No route matches URL "/not-a-route"'
          ),
        },
      });
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[1][0]).toEqual(
        "  Request: GET test://test/not-a-route.data"
      );
      expect(errorLogs[2][0]).toEqual("  Status: 404 Not Found");
      expect(errorLogs[3][0]).toEqual(
        '  Error: No route matches URL "/not-a-route"'
      );
      expect(errorLogs[4][0]).toMatch(" at ");
      expect(errorLogs.length).toBe(5);
    });
  });
});

test.describe("Error Sanitization turboV3", () => {
  let fixture: Fixture;
  let oldConsoleError: () => void;
  let errorLogs: any[] = [];

  test.beforeEach(() => {
    oldConsoleError = console.error;
    errorLogs = [];
    console.error = (...args) => errorLogs.push(args);
  });

  test.afterEach(() => {
    console.error = oldConsoleError;
  });

  test.describe("serverMode=production", () => {
    test.beforeAll(async () => {
      fixture = await createFixture(
        {
          turboV3: true,
          files: routeFiles,
        },
        ServerMode.Production
      );
    });

    test("renders document without errors", async () => {
      let response = await fixture.requestDocument("/");
      let html = await response.text();
      expect(html).toMatch("Index Route");
      expect(html).toMatch("LOADER");
      expect(html).not.toMatch("MESSAGE:");
      expect(html).not.toMatch(/stack/i);
    });

    test("sanitizes loader errors in document requests", async () => {
      let response = await fixture.requestDocument("/?loader");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).not.toMatch("LOADER");
      expect(html).toMatch("MESSAGE:Unexpected Server Error");
      // This is the turbo-stream encoding - the fact that stack goes right
      // into __type means it has no value
      expect(html).toMatch(
        '{\\"message\\":\\"Unexpected Server Error\\",\\"stack\\":u,\\"__type\\":\\"Error\\"}'
      );
      expect(html).not.toMatch(/ at /i);
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("sanitizes render errors in document requests", async () => {
      let response = await fixture.requestDocument("/?render");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).toMatch("MESSAGE:Unexpected Server Error");
      // This is the turbo-stream encoding - the fact that stack goes right
      // into __type means it has no value
      expect(html).toMatch(
        '{\\"message\\":\\"Unexpected Server Error\\",\\"stack\\":u,\\"__type\\":\\"Error\\"}'
      );
      expect(html).not.toMatch(/ at /i);
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Render Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("renders deferred document without errors", async () => {
      let response = await fixture.requestDocument("/defer");
      let html = await response.text();
      expect(html).toMatch("Defer Route");
      expect(html).toMatch("RESOLVED");
      expect(html).not.toMatch("MESSAGE:");
      // Defer errors are not not part of the JSON blob but rather rejected
      // against a pending promise and therefore are inlined JS.
      expect(html).not.toMatch("x.stack=e.stack;");
    });

    test("sanitizes defer errors in document requests", async () => {
      let response = await fixture.requestDocument("/defer?loader");
      let html = await response.text();
      expect(html).toMatch("Defer Error");
      expect(html).not.toMatch("RESOLVED");
      expect(html).toMatch("Unexpected Server Error");
      expect(html).toMatch('\\"stack\\":u,');
      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("returns data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data");
      expect(data).toEqual({
        root: {
          data: null,
        },
        "routes/_index": {
          data: "LOADER",
        },
      });
    });

    test("sanitizes loader errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data?loader");
      expect(data).toEqual({
        root: {
          data: null,
        },
        "routes/_index": {
          error: new Error("Unexpected Server Error"),
        },
      });
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("returns deferred data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data");
      expect(await data["routes/defer"].data.lazy).toEqual("RESOLVED");
    });

    test("sanitizes loader errors in deferred data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data?loader");
      try {
        await data["routes/defer"].data.lazy;
        expect(true).toBe(false);
      } catch (e) {
        expect((e as Error).message).toBe("Unexpected Server Error");
        expect((e as Error).stack).toBeUndefined();
      }
      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("sanitizes loader errors in resource requests", async () => {
      let response = await fixture.requestResource("/resource?loader");
      let text = await response.text();
      expect(text).toBe("Unexpected Server Error");
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("does not sanitize mismatched route errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/not-a-route.data");
      expect(data).toEqual({
        root: {
          error: new ErrorResponseImpl(
            404,
            "Not Found",
            'Error: No route matches URL "/not-a-route"'
          ),
        },
      });
      expect(errorLogs).toEqual([
        [new Error('No route matches URL "/not-a-route"')],
      ]);
    });

    test("does not support hydration of Error subclasses", async ({ page }) => {
      let response = await fixture.requestDocument("/?subclass");
      let html = await response.text();
      expect(html).toMatch("<p>MESSAGE:Unexpected Server Error");
      expect(html).toMatch("<p>NAME:Error");

      // Hydration
      let appFixture = await createAppFixture(fixture);
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/?subclass", true);
      html = await app.getHtml();
      expect(html).toMatch("<p>MESSAGE:Unexpected Server Error");
      expect(html).toMatch("<p>NAME:Error");
    });
  });

  test.describe("serverMode=development", () => {
    test.beforeAll(async () => {
      fixture = await createFixture(
        {
          turboV3: true,
          files: routeFiles,
        },
        ServerMode.Development
      );
    });
    let ogEnv = process.env.NODE_ENV;
    test.beforeEach(() => {
      ogEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
    });
    test.afterEach(() => {
      process.env.NODE_ENV = ogEnv;
    });

    test("renders document without errors", async () => {
      let response = await fixture.requestDocument("/");
      let html = await response.text();
      expect(html).toMatch("Index Route");
      expect(html).toMatch("LOADER");
      expect(html).not.toMatch("MESSAGE:");
      expect(html).not.toMatch(/stack/i);
    });

    test("does not sanitize loader errors in document requests", async () => {
      let response = await fixture.requestDocument("/?loader");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).not.toMatch("LOADER");
      expect(html).toMatch("<p>MESSAGE:Loader Error");
      expect(html).toMatch("<p>STACK:Error: Loader Error");
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("does not sanitize render errors in document requests", async () => {
      let response = await fixture.requestDocument("/?render");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).toMatch("<p>MESSAGE:Render Error");
      expect(html).toMatch("<p>STACK:Error: Render Error");
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Render Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("renders deferred document without errors", async () => {
      let response = await fixture.requestDocument("/defer");
      let html = await response.text();
      expect(html).toMatch("Defer Route");
      expect(html).toMatch("RESOLVED");
      expect(html).not.toMatch("MESSAGE:");
      expect(html).not.toMatch(/"stack":/i);
    });

    test("does not sanitize defer errors in document requests", async () => {
      let response = await fixture.requestDocument("/defer?loader");
      let html = await response.text();
      expect(html).toMatch("Defer Error");
      expect(html).not.toMatch("RESOLVED");
      expect(html).toMatch("<p>REJECTED</p>");
      expect(html).toMatch("Error: REJECTED\\\\n    at ");
      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("returns data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data");
      expect(data).toEqual({
        root: {
          data: null,
        },
        "routes/_index": {
          data: "LOADER",
        },
      });
    });

    test("does not sanitize loader errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data?loader");
      expect(data).toEqual({
        root: {
          data: null,
        },
        "routes/_index": {
          error: new Error("Loader Error"),
        },
      });
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("returns deferred data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data");
      expect(await data["routes/defer"].data.lazy).toEqual("RESOLVED");
    });

    test("does not sanitize loader errors in deferred data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data?loader");
      try {
        await data["routes/defer"].data.lazy;
        expect(true).toBe(false);
      } catch (e) {
        expect((e as Error).message).toBe("REJECTED");
        expect((e as Error).stack).not.toBeUndefined();
      }

      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("does not sanitize loader errors in resource requests", async () => {
      let response = await fixture.requestResource("/resource?loader");
      let text = await response.text();
      expect(text).toBe("Unexpected Server Error\n\nError: Loader Error");
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0][0].message).toMatch("Loader Error");
      expect(errorLogs[0][0].stack).toMatch(" at ");
    });

    test("does not sanitize mismatched route errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/not-a-route.data");
      expect(data).toEqual({
        root: {
          error: new ErrorResponseImpl(
            404,
            "Not Found",
            'Error: No route matches URL "/not-a-route"'
          ),
        },
      });
      expect(errorLogs).toEqual([
        [new Error('No route matches URL "/not-a-route"')],
      ]);
    });

    test("supports hydration of Error subclasses", async ({ page }) => {
      let response = await fixture.requestDocument("/?subclass");
      let html = await response.text();
      expect(html).toMatch("<p>MESSAGE:thisisnotathing is not defined");
      expect(html).toMatch("<p>NAME:ReferenceError");
      expect(html).toMatch(
        "<p>STACK:ReferenceError: thisisnotathing is not defined"
      );

      // Hydration
      let appFixture = await createAppFixture(fixture, ServerMode.Development);
      let app = new PlaywrightFixture(appFixture, page);
      await app.goto("/?subclass", true);
      html = await app.getHtml();
      expect(html).toMatch("<p>MESSAGE:thisisnotathing is not defined");
      expect(html).toMatch("<p>NAME:ReferenceError");
      expect(html).toMatch(
        "STACK:ReferenceError: thisisnotathing is not defined"
      );
    });
  });

  test.describe("serverMode=production (user-provided handleError)", () => {
    test.beforeAll(async () => {
      fixture = await createFixture(
        {
          turboV3: true,
          files: {
            "app/entry.server.tsx": js`
              import { PassThrough } from "node:stream";

              import { createReadableStreamFromReadable } from "@react-router/node";
              import { ServerRouter, isRouteErrorResponse } from "react-router";
              import { renderToPipeableStream } from "react-dom/server";

              export default function handleRequest(
                request,
                responseStatusCode,
                responseHeaders,
                remixContext
              ) {
                return new Promise((resolve, reject) => {
                  let shellRendered = false;
                  const { pipe, abort } = renderToPipeableStream(
                    <ServerRouter context={remixContext} url={request.url} />,
                    {
                      onShellReady() {
                        shellRendered = true;
                        const body = new PassThrough();
                        const stream = createReadableStreamFromReadable(body);

                        responseHeaders.set("Content-Type", "text/html");

                        resolve(
                          new Response(stream, {
                            headers: responseHeaders,
                            status: responseStatusCode,
                          })
                        );

                        pipe(body);
                      },
                      onShellError(error) {
                        reject(error);
                      },
                      onError(error) {
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

                  setTimeout(abort, 5000);
                });
              }

              export function handleError(
                error: unknown,
                { request }: { request: Request },
              ) {
                console.error("App Specific Error Logging:");
                console.error("  Request: " + request.method + " " + request.url);
                if (isRouteErrorResponse(error)) {
                  console.error("  Status: " + error.status + " " + error.statusText);
                  console.error("  Error: " + error.error.message);
                  console.error("  Stack: " + error.error.stack);
                } else if (error instanceof Error) {
                  console.error("  Error: " + error.message);
                  console.error("  Stack: " + error.stack);
                } else {
                  console.error("Dunno what this is");
                }
              }
            `,
            ...routeFiles,
          },
        },
        ServerMode.Production
      );
    });

    test("renders document without errors", async () => {
      let response = await fixture.requestDocument("/");
      let html = await response.text();
      expect(html).toMatch("Index Route");
      expect(html).toMatch("LOADER");
      expect(html).not.toMatch("MESSAGE:");
      expect(html).not.toMatch(/stack/i);
    });

    test("sanitizes loader errors in document requests", async () => {
      let response = await fixture.requestDocument("/?loader");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).not.toMatch("LOADER");
      expect(html).toMatch("MESSAGE:Unexpected Server Error");
      // This is the turbo-stream encoding - the fact that stack goes right
      // into __type means it has no value
      expect(html).toMatch(
        '{\\"message\\":\\"Unexpected Server Error\\",\\"stack\\":u,\\"__type\\":\\"Error\\"}'
      );
      expect(html).not.toMatch(/ at /i);
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[1][0]).toEqual("  Request: GET test://test/?loader");
      expect(errorLogs[2][0]).toEqual("  Error: Loader Error");
      expect(errorLogs[3][0]).toMatch(" at ");
      expect(errorLogs.length).toBe(4);
    });

    test("sanitizes render errors in document requests", async () => {
      let response = await fixture.requestDocument("/?render");
      let html = await response.text();
      expect(html).toMatch("Index Error");
      expect(html).toMatch("MESSAGE:Unexpected Server Error");
      // This is the turbo-stream encoding - the fact that stack goes right
      // into __type means it has no value
      expect(html).toMatch(
        '{\\"message\\":\\"Unexpected Server Error\\",\\"stack\\":u,\\"__type\\":\\"Error\\"}'
      );
      expect(html).not.toMatch(/ at /i);
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[1][0]).toEqual("  Request: GET test://test/?render");
      expect(errorLogs[2][0]).toEqual("  Error: Render Error");
      expect(errorLogs[3][0]).toMatch(" at ");
      expect(errorLogs.length).toBe(4);
    });

    test("renders deferred document without errors", async () => {
      let response = await fixture.requestDocument("/defer");
      let html = await response.text();
      expect(html).toMatch("Defer Route");
      expect(html).toMatch("RESOLVED");
      expect(html).not.toMatch("MESSAGE:");
      // Defer errors are not not part of the JSON blob but rather rejected
      // against a pending promise and therefore are inlined JS.
      expect(html).not.toMatch("x.stack=e.stack;");
    });

    test("sanitizes defer errors in document requests", async () => {
      let response = await fixture.requestDocument("/defer?loader");
      let html = await response.text();
      expect(html).toMatch("Defer Error");
      expect(html).not.toMatch("RESOLVED");
      expect(html).toMatch("Unexpected Server Error");
      expect(html).toMatch('\\"stack\\":u,');
      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("returns data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data");
      expect(data).toEqual({
        root: {
          data: null,
        },
        "routes/_index": {
          data: "LOADER",
        },
      });
    });

    test("sanitizes loader errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/_root.data?loader");
      expect(data).toEqual({
        root: { data: null },
        "routes/_index": { error: new Error("Unexpected Server Error") },
      });
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[1][0]).toEqual(
        "  Request: GET test://test/_root.data?loader"
      );
      expect(errorLogs[2][0]).toEqual("  Error: Loader Error");
      expect(errorLogs[3][0]).toMatch(" at ");
      expect(errorLogs.length).toBe(4);
    });

    test("returns deferred data without errors", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data");
      expect(await data["routes/defer"].data.lazy).toBe("RESOLVED");
    });

    test("sanitizes loader errors in deferred data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/defer.data?loader");
      try {
        await data["routes/defer"].data.lazy;
        expect(true).toBe(false);
      } catch (e) {
        expect((e as Error).message).toBe("Unexpected Server Error");
        expect((e as Error).stack).toBeUndefined();
      }
      // defer errors are not logged to the server console since the request
      // has "succeeded"
      expect(errorLogs.length).toBe(0);
    });

    test("sanitizes loader errors in resource requests", async () => {
      let response = await fixture.requestResource("/resource?loader");
      let text = await response.text();
      expect(text).toBe("Unexpected Server Error");
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[1][0]).toEqual(
        "  Request: GET test://test/resource?loader"
      );
      expect(errorLogs[2][0]).toEqual("  Error: Loader Error");
      expect(errorLogs[3][0]).toMatch(" at ");
      expect(errorLogs.length).toBe(4);
    });

    test("does not sanitize mismatched route errors in data requests", async () => {
      let { data } = await fixture.requestSingleFetchData("/not-a-route.data");
      expect(data).toEqual({
        root: {
          error: new ErrorResponseImpl(
            404,
            "Not Found",
            'Error: No route matches URL "/not-a-route"'
          ),
        },
      });
      expect(errorLogs[0][0]).toEqual("App Specific Error Logging:");
      expect(errorLogs[1][0]).toEqual(
        "  Request: GET test://test/not-a-route.data"
      );
      expect(errorLogs[2][0]).toEqual("  Status: 404 Not Found");
      expect(errorLogs[3][0]).toEqual(
        '  Error: No route matches URL "/not-a-route"'
      );
      expect(errorLogs[4][0]).toMatch(" at ");
      expect(errorLogs.length).toBe(5);
    });
  });
});
