/**
 * @jest-environment node
 */

import type { StaticHandlerContext } from "react-router";

import { createRequestHandler } from "../../lib/server-runtime/server";
import { ServerMode } from "../../lib/server-runtime/mode";
import type { ServerBuild } from "../../lib/server-runtime/build";
import { mockServerBuild } from "./utils";

function spyConsole() {
  // https://github.com/facebook/react/issues/7047
  let spy: any = {};

  beforeAll(() => {
    spy.console = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    spy.console.mockRestore();
  });

  return spy;
}

describe.skip("server", () => {
  let routeId = "root";
  let build: ServerBuild = {
    entry: {
      module: {
        default: async (request) => {
          return new Response(`${request.method}, ${request.url} COMPONENT`);
        },
      },
    },
    routes: {
      [routeId]: {
        id: routeId,
        path: "",
        module: {
          action: ({ request }) =>
            new Response(`${request.method} ${request.url} ACTION`),
          loader: ({ request }) =>
            new Response(`${request.method} ${request.url} LOADER`),
          default: () => "COMPONENT",
        },
      },
    },
    assets: {
      routes: {
        [routeId]: {
          hasAction: true,
          hasErrorBoundary: false,
          hasLoader: true,
          id: routeId,
          module: routeId,
          path: "",
        },
      },
    },
    future: {},
    prerender: [],
  } as unknown as ServerBuild;

  describe("createRequestHandler", () => {
    let spy = spyConsole();

    beforeEach(() => {
      spy.console.mockClear();
    });

    let allowThrough = [
      ["GET", "/"],
      ["GET", "/?_data=root"],
      ["POST", "/"],
      ["POST", "/?_data=root"],
      ["PUT", "/"],
      ["PUT", "/?_data=root"],
      ["DELETE", "/"],
      ["DELETE", "/?_data=root"],
      ["PATCH", "/"],
      ["PATCH", "/?_data=root"],
    ];
    it.each(allowThrough)(
      `allows through %s request to %s`,
      async (method, to) => {
        let handler = createRequestHandler(build);
        let response = await handler(
          new Request(`http://localhost:3000${to}`, {
            method,
          })
        );

        expect(response.status).toBe(200);
        let text = await response.text();
        expect(text).toContain(method);
        let expected = !to.includes("?_data=root")
          ? "COMPONENT"
          : method === "GET"
          ? "LOADER"
          : "ACTION";
        expect(text).toContain(expected);
        expect(spy.console).not.toHaveBeenCalled();
      }
    );

    it("strips body for HEAD requests", async () => {
      let handler = createRequestHandler(build);
      let response = await handler(
        new Request("http://localhost:3000/", {
          method: "HEAD",
        })
      );

      expect(await response.text()).toBe("");
    });
  });
});

describe("shared server runtime", () => {
  let spy = spyConsole();

  beforeEach(() => {
    spy.console.mockClear();
  });

  let baseUrl = "http://test.com";

  describe("resource routes", () => {
    test("calls resource route loader", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let resourceLoader = jest.fn(() => {
        return Response.json("resource");
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/resource": {
          loader: resourceLoader,
          path: "resource",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/resource`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(200);
      expect(await result.json()).toBe("resource");
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(resourceLoader.mock.calls.length).toBe(1);
    });

    test("calls sub resource route loader", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let resourceLoader = jest.fn(() => {
        return Response.json("resource");
      });
      let subResourceLoader = jest.fn(() => {
        return Response.json("sub");
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/resource": {
          loader: resourceLoader,
          path: "resource",
        },
        "routes/resource.sub": {
          loader: subResourceLoader,
          path: "resource/sub",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/resource/sub`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(200);
      expect(await result.json()).toBe("sub");
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(resourceLoader.mock.calls.length).toBe(0);
      expect(subResourceLoader.mock.calls.length).toBe(1);
    });

    test("resource route loader allows thrown responses", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let resourceLoader = jest.fn(() => {
        throw new Response("resource");
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/resource": {
          loader: resourceLoader,
          path: "resource",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/resource`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(200);
      expect(await result.text()).toBe("resource");
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(resourceLoader.mock.calls.length).toBe(1);
    });

    test("resource route loader responds with generic error when thrown", async () => {
      let error = new Error("should be logged when resource loader throws");
      let loader = jest.fn(() => {
        throw error;
      });
      let build = mockServerBuild({
        "routes/resource": {
          loader,
          path: "resource",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/resource`, {
        method: "get",
      });

      let result = await handler(request);
      expect(await result.text()).toBe(
        "Unexpected Server Error\n\nError: should be logged when resource loader throws"
      );
    });

    test("resource route loader responds with detailed error when thrown in development", async () => {
      let error = new Error("should be logged when resource loader throws");
      let loader = jest.fn(() => {
        throw error;
      });
      let build = mockServerBuild({
        "routes/resource": {
          loader,
          path: "resource",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Development);

      let request = new Request(`${baseUrl}/resource`, {
        method: "get",
      });

      let result = await handler(request);
      expect((await result.text()).includes(error.message)).toBe(true);
      expect(spy.console.mock.calls.length).toBe(1);
    });

    test("calls resource route action", async () => {
      let rootAction = jest.fn(() => {
        return "root";
      });
      let resourceAction = jest.fn(() => {
        return Response.json("resource");
      });
      let build = mockServerBuild({
        root: {
          default: {},
          action: rootAction,
        },
        "routes/resource": {
          action: resourceAction,
          path: "resource",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/resource`, {
        method: "post",
      });

      let result = await handler(request);
      expect(result.status).toBe(200);
      expect(await result.json()).toBe("resource");
      expect(rootAction.mock.calls.length).toBe(0);
      expect(resourceAction.mock.calls.length).toBe(1);
    });

    test("calls sub resource route action", async () => {
      let rootAction = jest.fn(() => {
        return "root";
      });
      let resourceAction = jest.fn(() => {
        return Response.json("resource");
      });
      let subResourceAction = jest.fn(() => {
        return Response.json("sub");
      });
      let build = mockServerBuild({
        root: {
          default: {},
          action: rootAction,
        },
        "routes/resource": {
          action: resourceAction,
          path: "resource",
        },
        "routes/resource.sub": {
          action: subResourceAction,
          path: "resource/sub",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/resource/sub`, {
        method: "post",
      });

      let result = await handler(request);
      expect(result.status).toBe(200);
      expect(await result.json()).toBe("sub");
      expect(rootAction.mock.calls.length).toBe(0);
      expect(resourceAction.mock.calls.length).toBe(0);
      expect(subResourceAction.mock.calls.length).toBe(1);
    });

    test("resource route action allows thrown responses", async () => {
      let rootAction = jest.fn(() => {
        return "root";
      });
      let resourceAction = jest.fn(() => {
        throw new Response("resource");
      });
      let build = mockServerBuild({
        root: {
          default: {},
          action: rootAction,
        },
        "routes/resource": {
          action: resourceAction,
          path: "resource",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/resource`, {
        method: "post",
      });

      let result = await handler(request);
      expect(result.status).toBe(200);
      expect(await result.text()).toBe("resource");
      expect(rootAction.mock.calls.length).toBe(0);
      expect(resourceAction.mock.calls.length).toBe(1);
    });

    test("resource route action responds with generic error when thrown", async () => {
      let error = new Error("should be logged when resource loader throws");
      let action = jest.fn(() => {
        throw error;
      });
      let build = mockServerBuild({
        "routes/resource": {
          action,
          path: "resource",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/resource`, {
        method: "post",
      });

      let result = await handler(request);
      expect(await result.text()).toBe(
        "Unexpected Server Error\n\nError: should be logged when resource loader throws"
      );
    });

    test("resource route action responds with detailed error when thrown in development", async () => {
      let message = "should be logged when resource loader throws";
      let action = jest.fn(() => {
        throw new Error(message);
      });
      let build = mockServerBuild({
        "routes/resource": {
          action,
          path: "resource",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Development);

      let request = new Request(`${baseUrl}/resource`, {
        method: "post",
      });

      let result = await handler(request);
      expect((await result.text()).includes(message)).toBe(true);
      expect(spy.console.mock.calls.length).toBe(1);
    });

    test("aborts request with reason", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let resourceLoader = jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "resource";
      });
      let handleErrorSpy = jest.fn();
      let build = mockServerBuild(
        {
          root: {
            default: {},
            loader: rootLoader,
          },
          "routes/resource": {
            loader: resourceLoader,
            path: "resource",
          },
        },
        {
          handleError: handleErrorSpy,
        }
      );
      let handler = createRequestHandler(build, ServerMode.Test);

      let controller = new AbortController();
      let request = new Request(`${baseUrl}/resource`, {
        method: "get",
        signal: controller.signal,
      });

      let resultPromise = handler(request);
      controller.abort();
      let result = await resultPromise;
      expect(result.status).toBe(500);
      expect(await result.text()).toMatchInlineSnapshot(`
        "Unexpected Server Error

        AbortError: This operation was aborted"
      `);
      expect(handleErrorSpy).toHaveBeenCalledTimes(1);
      expect(handleErrorSpy.mock.calls[0][0] instanceof DOMException).toBe(
        true
      );
      expect(handleErrorSpy.mock.calls[0][0].name).toBe("AbortError");
      expect(handleErrorSpy.mock.calls[0][0].message).toBe(
        "This operation was aborted"
      );
      expect(handleErrorSpy.mock.calls[0][1].request.method).toBe("GET");
      expect(handleErrorSpy.mock.calls[0][1].request.url).toBe(
        "http://test.com/resource"
      );
    });
  });

  describe.skip("data requests", () => {
    test("data request that does not match loader surfaces 400 error for boundary", async () => {
      let build = mockServerBuild({
        root: {
          default: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/?_data=routes/_index`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(400);
      expect(result.headers.get("X-Remix-Error")).toBe("yes");
      expect((await result.json()).message).toBeTruthy();
    });

    test("data request that does not match routeId surfaces 403 error for boundary", async () => {
      let build = mockServerBuild({
        root: {
          default: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          loader: () => null,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      // This bug wasn't that the router wasn't returning a 404 (it was), but
      // that we weren't defensive when looking at match.params when we went
      // to call handleDataRequest(), - and that threw it's own uncaught
      // exception triggering a 500.  We need to ensure that this build has a
      // handleDataRequest implementation for this test to mean anything
      expect(build.entry.module.handleDataRequest).toBeDefined();

      let request = new Request(`${baseUrl}/?_data=routes/junk`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(403);
      expect(result.headers.get("X-Remix-Error")).toBe("yes");
      expect((await result.json()).message).toBeTruthy();
    });

    test("data request that does not match route surfaces 404 error for boundary", async () => {
      let build = mockServerBuild({
        root: {
          default: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          loader: () => null,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/junk?_data=routes/junk`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(404);
      expect(result.headers.get("X-Remix-Error")).toBe("yes");
      expect((await result.json()).message).toBeTruthy();
    });

    test("data request calls loader", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/_index": {
          parentId: "root",
          loader: indexLoader,
          index: true,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/?_data=routes/_index`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(200);
      expect(await result.json()).toBe("index");
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(indexLoader.mock.calls.length).toBe(1);
    });

    test("data request calls loader and responds with generic message and error header", async () => {
      let rootLoader = jest.fn(() => {
        throw new Error("test");
      });
      let testAction = jest.fn(() => {
        return "root";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/test": {
          parentId: "root",
          action: testAction,
          path: "test",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/test?_data=root`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect((await result.json()).message).toBe("Unexpected Server Error");
      expect(result.headers.get("X-Remix-Error")).toBe("yes");
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(testAction.mock.calls.length).toBe(0);
    });

    test("data request calls loader and responds with detailed info and error header in development mode", async () => {
      let message =
        "data request loader error logged to console once in dev mode";
      let rootLoader = jest.fn(() => {
        throw new Error(message);
      });
      let testAction = jest.fn(() => {
        return "root";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/test": {
          parentId: "root",
          action: testAction,
          path: "test",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Development);

      let request = new Request(`${baseUrl}/test?_data=root`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect((await result.json()).message).toBe(message);
      expect(result.headers.get("X-Remix-Error")).toBe("yes");
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(testAction.mock.calls.length).toBe(0);
      expect(spy.console.mock.calls.length).toBe(1);
    });

    test("data request calls loader and responds with catch header", async () => {
      let rootLoader = jest.fn(() => {
        throw new Response("test", { status: 400 });
      });
      let testAction = jest.fn(() => {
        return "root";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/test": {
          parentId: "root",
          action: testAction,
          path: "test",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/test?_data=root`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(400);
      expect(await result.text()).toBe("test");
      expect(result.headers.get("X-Remix-Catch")).toBe("yes");
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(testAction.mock.calls.length).toBe(0);
    });

    test("data request calls action", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let testAction = jest.fn(() => {
        return "test";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/test": {
          parentId: "root",
          action: testAction,
          path: "test",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/test?_data=routes/test`, {
        method: "post",
      });

      let result = await handler(request);
      expect(result.status).toBe(200);
      expect(await result.json()).toBe("test");
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(testAction.mock.calls.length).toBe(1);
    });

    test("data request calls action and responds with generic message and error header", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let testAction = jest.fn(() => {
        throw new Error("test");
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/test": {
          parentId: "root",
          action: testAction,
          path: "test",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/test?_data=routes/test`, {
        method: "post",
      });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect((await result.json()).message).toBe("Unexpected Server Error");
      expect(result.headers.get("X-Remix-Error")).toBe("yes");
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(testAction.mock.calls.length).toBe(1);
    });

    test("data request calls action and responds with detailed info and error header in development mode", async () => {
      let message =
        "data request action error logged to console once in dev mode";
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let testAction = jest.fn(() => {
        throw new Error(message);
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/test": {
          parentId: "root",
          action: testAction,
          path: "test",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Development);

      let request = new Request(`${baseUrl}/test?_data=routes/test`, {
        method: "post",
      });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect((await result.json()).message).toBe(message);
      expect(result.headers.get("X-Remix-Error")).toBe("yes");
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(testAction.mock.calls.length).toBe(1);
      expect(spy.console.mock.calls.length).toBe(1);
    });

    test("data request calls action and responds with catch header", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let testAction = jest.fn(() => {
        throw new Response("test", { status: 400 });
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/test": {
          parentId: "root",
          action: testAction,
          path: "test",
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/test?_data=routes/test`, {
        method: "post",
      });

      let result = await handler(request);
      expect(result.status).toBe(400);
      expect(await result.text()).toBe("test");
      expect(result.headers.get("X-Remix-Catch")).toBe("yes");
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(testAction.mock.calls.length).toBe(1);
    });

    test("data request calls layout action", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let rootAction = jest.fn(() => {
        return "root";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          action: rootAction,
        },
        "routes/_index": {
          parentId: "root",
          index: true,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/?_data=root`, {
        method: "post",
      });

      let result = await handler(request);
      expect(result.status).toBe(200);
      expect(await result.json()).toBe("root");
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(rootAction.mock.calls.length).toBe(1);
    });

    test("data request calls index action", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexAction = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/_index": {
          parentId: "root",
          action: indexAction,
          index: true,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/?index&_data=routes/_index`, {
        method: "post",
      });

      let result = await handler(request);
      expect(result.status).toBe(200);
      expect(await result.json()).toBe("index");
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(indexAction.mock.calls.length).toBe(1);
    });

    test("data request handleDataRequest redirects are handled", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
        "routes/_index": {
          parentId: "root",
          loader: indexLoader,
          index: true,
        },
      });
      build.entry.module.handleDataRequest.mockImplementation(async () => {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/redirect",
          },
        });
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/?_data=routes/_index`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(204);
      expect(result.headers.get("X-Remix-Redirect")).toBe("/redirect");
      expect(result.headers.get("X-Remix-Status")).toBe("302");
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(indexLoader.mock.calls.length).toBe(1);
    });

    test("aborts request", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let handleErrorSpy = jest.fn();
      let build = mockServerBuild(
        {
          root: {
            default: {},
            loader: rootLoader,
          },
          "routes/_index": {
            parentId: "root",
            loader: indexLoader,
            index: true,
          },
        },
        {
          handleError: handleErrorSpy,
        }
      );
      let handler = createRequestHandler(build, ServerMode.Test);

      let controller = new AbortController();
      let request = new Request(`${baseUrl}/?_data=routes/_index`, {
        method: "get",
        signal: controller.signal,
      });

      let resultPromise = handler(request);
      controller.abort();
      let result = await resultPromise;
      expect(result.status).toBe(500);
      let error = await result.json();
      expect(error.message).toBe("This operation was aborted");
      expect(
        error.stack.startsWith("AbortError: This operation was aborted")
      ).toBe(true);
      expect(handleErrorSpy).toHaveBeenCalledTimes(1);
      expect(handleErrorSpy.mock.calls[0][0] instanceof DOMException).toBe(
        true
      );
      expect(handleErrorSpy.mock.calls[0][0].name).toBe("AbortError");
      expect(handleErrorSpy.mock.calls[0][0].message).toBe(
        "This operation was aborted"
      );
      expect(handleErrorSpy.mock.calls[0][1].request.method).toBe("GET");
      expect(handleErrorSpy.mock.calls[0][1].request.url).toBe(
        "http://test.com/?_data=routes/_index"
      );
    });
  });

  describe("document requests", () => {
    test("not found document request for no matches and no ErrorBoundary", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/`, {
        method: "get",
      });

      let result = await handler(request);
      expect(result.status).toBe(404);
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!.root.status).toBe(404);
    });

    test("sets root as catch boundary for not found document request", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/`, { method: "get" });

      let result = await handler(request);
      expect(result.status).toBe(404);
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!.root.status).toBe(404);
      expect(context.loaderData).toEqual({});
    });

    test("thrown loader responses bubble up", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(() => {
        throw new Response(null, { status: 400 });
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          default: {},
          loader: indexLoader,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/`, { method: "get" });

      let result = await handler(request);
      expect(result.status).toBe(400);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(indexLoader.mock.calls.length).toBe(1);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!.root.status).toBe(400);
      expect(context.loaderData).toEqual({
        root: "root",
      });
    });

    test("thrown loader responses catch deep", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(() => {
        throw new Response(null, { status: 400 });
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          default: {},
          loader: indexLoader,
          ErrorBoundary: {},
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/`, { method: "get" });

      let result = await handler(request);
      expect(result.status).toBe(400);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(indexLoader.mock.calls.length).toBe(1);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!["routes/_index"].status).toBe(400);
      expect(context.loaderData).toEqual({
        root: "root",
      });
    });

    test("thrown action responses bubble up", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let testAction = jest.fn(() => {
        throw new Response(null, { status: 400 });
      });
      let testLoader = jest.fn(() => {
        return "test";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/test": {
          parentId: "root",
          path: "test",
          default: {},
          loader: testLoader,
          action: testAction,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/test`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(400);
      expect(testAction.mock.calls.length).toBe(1);
      // Should not call root loader since it is the boundary route
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(testLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!.root.status).toBe(400);
      expect(context.loaderData).toEqual({
        root: null,
        "routes/test": null,
      });
    });

    test("thrown action responses bubble up for index routes", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexAction = jest.fn(() => {
        throw new Response(null, { status: 400 });
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          default: {},
          loader: indexLoader,
          action: indexAction,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/?index`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(400);
      expect(indexAction.mock.calls.length).toBe(1);
      // Should not call root loader since it is the boundary route
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(indexLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!.root.status).toBe(400);
      expect(context.loaderData).toEqual({
        root: null,
        "routes/_index": null,
      });
    });

    test("thrown action responses catch deep", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let testAction = jest.fn(() => {
        throw new Response(null, { status: 400 });
      });
      let testLoader = jest.fn(() => {
        return "test";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/test": {
          parentId: "root",
          path: "test",
          default: {},
          loader: testLoader,
          action: testAction,
          ErrorBoundary: {},
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/test`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(400);
      expect(testAction.mock.calls.length).toBe(1);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(testLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!["routes/test"].status).toBe(400);
      expect(context.loaderData).toEqual({
        root: "root",
        "routes/test": null,
      });
    });

    test("thrown action responses catch deep for index routes", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexAction = jest.fn(() => {
        throw new Response(null, { status: 400 });
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          default: {},
          loader: indexLoader,
          action: indexAction,
          ErrorBoundary: {},
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/?index`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(400);
      expect(indexAction.mock.calls.length).toBe(1);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(indexLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!["routes/_index"].status).toBe(400);
      expect(context.loaderData).toEqual({
        root: "root",
        "routes/_index": null,
      });
    });

    test("thrown loader response after thrown action response bubble up action throw to deepest loader boundary", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let layoutLoader = jest.fn(() => {
        throw new Response("layout", { status: 401 });
      });
      let testAction = jest.fn(() => {
        throw new Response("action", { status: 400 });
      });
      let testLoader = jest.fn(() => {
        return "test";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/__layout": {
          parentId: "root",
          default: {},
          loader: layoutLoader,
          ErrorBoundary: {},
        },
        "routes/__layout/test": {
          parentId: "routes/__layout",
          path: "test",
          default: {},
          loader: testLoader,
          action: testAction,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/test`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(400);
      expect(testAction.mock.calls.length).toBe(1);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(testLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!["routes/__layout"].data).toBe("action");
      expect(context.loaderData).toEqual({
        root: "root",
        "routes/__layout": null,
        "routes/__layout/test": null,
      });
    });

    test("thrown loader response after thrown index action response bubble up action throw to deepest loader boundary", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let layoutLoader = jest.fn(() => {
        throw new Response("layout", { status: 401 });
      });
      let indexAction = jest.fn(() => {
        throw new Response("action", { status: 400 });
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/__layout": {
          parentId: "root",
          default: {},
          loader: layoutLoader,
          ErrorBoundary: {},
        },
        "routes/__layout/index": {
          parentId: "routes/__layout",
          index: true,
          default: {},
          loader: indexLoader,
          action: indexAction,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/?index`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(400);
      expect(indexAction.mock.calls.length).toBe(1);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(indexLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!["routes/__layout"].data).toBe("action");
      expect(context.loaderData).toEqual({
        root: "root",
        "routes/__layout": null,
        "routes/__layout/index": null,
      });
    });

    test("loader errors bubble up", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(() => {
        throw new Error("index");
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          default: {},
          loader: indexLoader,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/`, { method: "get" });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(indexLoader.mock.calls.length).toBe(1);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!.root).toBeInstanceOf(Error);
      expect(context.errors!.root.message).toBe("Unexpected Server Error");
      expect(context.errors!.root.stack).toBeUndefined();
      expect(context.loaderData).toEqual({
        root: "root",
      });
    });

    test("loader errors catch deep", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(() => {
        throw new Error("index");
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          default: {},
          loader: indexLoader,
          ErrorBoundary: {},
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/`, { method: "get" });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(indexLoader.mock.calls.length).toBe(1);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!["routes/_index"]).toBeInstanceOf(Error);
      expect(context.errors!["routes/_index"].message).toBe(
        "Unexpected Server Error"
      );
      expect(context.errors!["routes/_index"].stack).toBeUndefined();
      expect(context.loaderData).toEqual({
        root: "root",
      });
    });

    test("action errors bubble up", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let testAction = jest.fn(() => {
        throw new Error("test");
      });
      let testLoader = jest.fn(() => {
        return "test";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/test": {
          parentId: "root",
          path: "test",
          default: {},
          loader: testLoader,
          action: testAction,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/test`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect(testAction.mock.calls.length).toBe(1);
      // Should not call root loader since it is the boundary route
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(testLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!.root).toBeInstanceOf(Error);
      expect(context.errors!.root.message).toBe("Unexpected Server Error");
      expect(context.errors!.root.stack).toBeUndefined();
      expect(context.loaderData).toEqual({
        root: null,
        "routes/test": null,
      });
    });

    test("action errors bubble up for index routes", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexAction = jest.fn(() => {
        throw new Error("index");
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          default: {},
          loader: indexLoader,
          action: indexAction,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/?index`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect(indexAction.mock.calls.length).toBe(1);
      // Should not call root loader since it is the boundary route
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(indexLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!.root).toBeInstanceOf(Error);
      expect(context.errors!.root.message).toBe("Unexpected Server Error");
      expect(context.errors!.root.stack).toBeUndefined();
      expect(context.loaderData).toEqual({
        root: null,
        "routes/_index": null,
      });
    });

    test("action errors catch deep", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let testAction = jest.fn(() => {
        throw new Error("test");
      });
      let testLoader = jest.fn(() => {
        return "test";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/test": {
          parentId: "root",
          path: "test",
          default: {},
          loader: testLoader,
          action: testAction,
          ErrorBoundary: {},
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/test`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect(testAction.mock.calls.length).toBe(1);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(testLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!["routes/test"]).toBeInstanceOf(Error);
      expect(context.errors!["routes/test"].message).toBe(
        "Unexpected Server Error"
      );
      expect(context.errors!["routes/test"].stack).toBeUndefined();
      expect(context.loaderData).toEqual({
        root: "root",
        "routes/test": null,
      });
    });

    test("action errors catch deep for index routes", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexAction = jest.fn(() => {
        throw new Error("index");
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          default: {},
          loader: indexLoader,
          action: indexAction,
          ErrorBoundary: {},
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/?index`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect(indexAction.mock.calls.length).toBe(1);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(indexLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!["routes/_index"]).toBeInstanceOf(Error);
      expect(context.errors!["routes/_index"].message).toBe(
        "Unexpected Server Error"
      );
      expect(context.errors!["routes/_index"].stack).toBeUndefined();
      expect(context.loaderData).toEqual({
        root: "root",
        "routes/_index": null,
      });
    });

    test("loader errors after action error bubble up action error to deepest loader boundary", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let layoutLoader = jest.fn(() => {
        throw new Error("layout");
      });
      let testAction = jest.fn(() => {
        throw new Error("action");
      });
      let testLoader = jest.fn(() => {
        return "test";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/__layout": {
          parentId: "root",
          default: {},
          loader: layoutLoader,
          ErrorBoundary: {},
        },
        "routes/__layout/test": {
          parentId: "routes/__layout",
          path: "test",
          default: {},
          loader: testLoader,
          action: testAction,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/test`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect(testAction.mock.calls.length).toBe(1);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(testLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!["routes/__layout"]).toBeInstanceOf(Error);
      expect(context.errors!["routes/__layout"].message).toBe(
        "Unexpected Server Error"
      );
      expect(context.errors!["routes/__layout"].stack).toBeUndefined();
      expect(context.loaderData).toEqual({
        root: "root",
        "routes/__layout": null,
        "routes/__layout/test": null,
      });
    });

    test("loader errors after index action error bubble up action error to deepest loader boundary", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let layoutLoader = jest.fn(() => {
        throw new Error("layout");
      });
      let indexAction = jest.fn(() => {
        throw new Error("action");
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/__layout": {
          parentId: "root",
          default: {},
          loader: layoutLoader,
          ErrorBoundary: {},
        },
        "routes/__layout/index": {
          parentId: "routes/__layout",
          index: true,
          default: {},
          loader: indexLoader,
          action: indexAction,
        },
      });
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/?index`, { method: "post" });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect(indexAction.mock.calls.length).toBe(1);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(indexLoader.mock.calls.length).toBe(0);
      expect(build.entry.module.default.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(1);
      let context = calls[0][3].staticHandlerContext as StaticHandlerContext;
      expect(context.errors).toBeTruthy();
      expect(context.errors!["routes/__layout"]).toBeInstanceOf(Error);
      expect(context.errors!["routes/__layout"].message).toBe(
        "Unexpected Server Error"
      );
      expect(context.errors!["routes/__layout"].stack).toBeUndefined();
      expect(context.loaderData).toEqual({
        root: "root",
        "routes/__layout": null,
        "routes/__layout/index": null,
      });
    });

    test("calls handleDocumentRequest again with new error when handleDocumentRequest throws", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          default: {},
          loader: indexLoader,
        },
      });
      let calledBefore = false;
      let ogHandleDocumentRequest = build.entry.module.default;
      build.entry.module.default = jest.fn(function () {
        if (!calledBefore) {
          throw new Error("thrown");
        }
        calledBefore = true;
        return ogHandleDocumentRequest.call(null, ...arguments);
      }) as any;
      let handler = createRequestHandler(build, ServerMode.Development);

      let request = new Request(`${baseUrl}/404`, { method: "get" });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(indexLoader.mock.calls.length).toBe(0);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(2);
      let context = calls[1][3].staticHandlerContext;
      expect(context.errors.root).toBeTruthy();
      expect(context.errors!.root.message).toBe("thrown");
      expect(context.loaderData).toEqual({});
    });

    test("unwraps responses thrown from handleDocumentRequest", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          default: {},
          loader: indexLoader,
        },
      });
      let ogHandleDocumentRequest = build.entry.module.default;
      build.entry.module.default = function (
        _: Request,
        responseStatusCode: number
      ) {
        if (responseStatusCode === 200) {
          throw new Response("Uh oh!", {
            status: 400,
            statusText: "Bad Request",
          });
        }
        return ogHandleDocumentRequest.call(null, ...arguments);
      } as any;
      let handler = createRequestHandler(build, ServerMode.Development);

      let request = new Request(`${baseUrl}/`, { method: "get" });

      let result = await handler(request);
      expect(result.status).toBe(400);
    });

    test("returns generic message if handleDocumentRequest throws a second time", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          default: {},
          loader: indexLoader,
        },
      });
      let lastThrownError;
      build.entry.module.default = jest.fn(function () {
        lastThrownError = new Error("rofl");
        throw lastThrownError;
      }) as any;
      let handler = createRequestHandler(build, ServerMode.Test);

      let request = new Request(`${baseUrl}/`, { method: "get" });

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect(await result.text()).toBe(
        "Unexpected Server Error\n\nError: rofl"
      );
      expect(rootLoader.mock.calls.length).toBe(0);
      expect(indexLoader.mock.calls.length).toBe(0);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(2);
    });

    test("returns more detailed message if handleDocumentRequest throws a second time in development mode", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(() => {
        return "index";
      });
      let build = mockServerBuild({
        root: {
          path: "/",
          default: {},
          loader: rootLoader,
          ErrorBoundary: {},
        },
        "routes/_index": {
          parentId: "root",
          index: true,
          default: {},
          loader: indexLoader,
        },
      });
      let errorMessage =
        "thrown from handleDocumentRequest and expected to be logged in console only once";
      let lastThrownError;
      build.entry.module.default = jest.fn(function () {
        lastThrownError = new Error(errorMessage);
        errorMessage = "second error thrown from handleDocumentRequest";
        throw lastThrownError;
      }) as any;
      let handler = createRequestHandler(build, ServerMode.Development);

      let request = new Request(`${baseUrl}/`);

      let result = await handler(request);
      expect(result.status).toBe(500);
      expect((await result.text()).includes(errorMessage)).toBe(true);
      expect(rootLoader.mock.calls.length).toBe(1);
      expect(indexLoader.mock.calls.length).toBe(1);

      let calls = build.entry.module.default.mock.calls;
      expect(calls.length).toBe(2);
      expect(spy.console.mock.calls).toEqual([
        [
          new Error(
            "thrown from handleDocumentRequest and expected to be logged in console only once"
          ),
        ],
        [new Error("second error thrown from handleDocumentRequest")],
      ]);
    });

    test("aborts request", async () => {
      let rootLoader = jest.fn(() => {
        return "root";
      });
      let indexLoader = jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "index";
      });
      let handleErrorSpy = jest.fn();
      let build = mockServerBuild(
        {
          root: {
            default: {},
            loader: rootLoader,
          },
          "routes/resource": {
            loader: indexLoader,
            index: true,
            default: {},
          },
        },
        {
          handleError: handleErrorSpy,
        }
      );
      let handler = createRequestHandler(build, ServerMode.Test);

      let controller = new AbortController();
      let request = new Request(`${baseUrl}/`, {
        method: "get",
        signal: controller.signal,
      });

      let resultPromise = handler(request);
      controller.abort();
      let result = await resultPromise;
      expect(result.status).toBe(500);
      expect(build.entry.module.default.mock.calls.length).toBe(0);

      expect(handleErrorSpy).toHaveBeenCalledTimes(1);
      expect(handleErrorSpy.mock.calls[0][0] instanceof DOMException).toBe(
        true
      );
      expect(handleErrorSpy.mock.calls[0][0].name).toBe("AbortError");
      expect(handleErrorSpy.mock.calls[0][0].message).toBe(
        "This operation was aborted"
      );
      expect(handleErrorSpy.mock.calls[0][1].request.method).toBe("GET");
      expect(handleErrorSpy.mock.calls[0][1].request.url).toBe(
        "http://test.com/"
      );
    });
  });

  test("provides load context to server entrypoint", async () => {
    let rootLoader = jest.fn(() => {
      return "root";
    });
    let indexLoader = jest.fn(() => {
      return "index";
    });
    let build = mockServerBuild({
      root: {
        default: {},
        loader: rootLoader,
        ErrorBoundary: {},
      },
      "routes/_index": {
        parentId: "root",
        default: {},
        loader: indexLoader,
      },
    });

    build.entry.module.default = jest.fn(
      async (
        request,
        responseStatusCode,
        responseHeaders,
        entryContext,
        loadContext
      ) =>
        new Response(JSON.stringify(loadContext), {
          status: responseStatusCode,
          headers: responseHeaders,
        })
    );

    let handler = createRequestHandler(build, ServerMode.Development);
    let request = new Request(`${baseUrl}/`, { method: "get" });
    let loadContext = { "load-context": "load-value" };

    let result = await handler(request, loadContext);
    expect(await result.text()).toBe(JSON.stringify(loadContext));
  });
});
