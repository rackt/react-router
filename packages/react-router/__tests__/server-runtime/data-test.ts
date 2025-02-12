import { decodeViaTurboStream } from "../../lib/dom/ssr/single-fetch";
import type { ServerBuild } from "../../lib/server-runtime/build";
import { createRequestHandler } from "../../lib/server-runtime/server";

describe("loaders", () => {
  // so that HTML/Fetch requests are the same, and so redirects don't hang on to
  // this param for no reason
  it("removes .data from request.url", async () => {
    let loader = async ({ request }) => {
      return new URL(request.url).pathname;
    };

    let routeId = "routes/random";
    let build = {
      routes: {
        [routeId]: {
          id: routeId,
          path: "/random",
          module: {
            loader,
          },
        },
      },
      entry: { module: {} },
      prerender: [],
    } as unknown as ServerBuild;

    let handler = createRequestHandler(build);

    let request = new Request("http://example.com/random.data", {
      headers: {
        "Content-Type": "application/json",
      },
    });

    let res = await handler(request);
    if (!res.body) throw new Error("No body");
    const decoded = await decodeViaTurboStream(res.body, global);
    expect((decoded.value as any)[routeId].data).toEqual("/random");
  });
});
