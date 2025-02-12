import { createRequestHandler } from "../../lib/server-runtime/server";

describe("createRequestHandler", () => {
  it("retains request headers when stripping body off for loaders", async () => {
    let handler = createRequestHandler({
      routes: {
        root: {
          id: "routes/test",
          path: "/test",
          module: {
            loader: ({ request }) =>
              Response.json(request.headers.get("X-Foo")),
          } as any,
        },
      },
      assets: {} as any,
      entry: { module: {} as any },
      // @ts-expect-error
      future: {},
      prerender: [],
    });

    let response = await handler(
      new Request("http://.../test", {
        headers: {
          "X-Foo": "bar",
        },
        signal: new AbortController().signal,
      })
    );

    expect(await response.json()).toBe("bar");
  });
});
