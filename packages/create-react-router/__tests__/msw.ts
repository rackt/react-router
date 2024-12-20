import path from "node:path";
import fsp from "node:fs/promises";
import { setupServer } from "msw/node";
import { http, type RequestHandler } from "msw";

import { githubHandlers } from "./github-mocks";

let miscHandlers: Array<RequestHandler> = [
  http.get("https://registry.npmjs.org/react-router/latest", () => {
    return Response.json({ version: "123.0.0" });
  }),
  http.head<{ status: string }>(
    "https://example.com/error/:status/template.tar.gz",
    ({ params }) => {
      return new Response(null, { status: Number(params.status) });
    }
  ),
  http.get<{ status: string }>(
    "https://example.com/error/:status/template.tar.gz",
    ({ params }) => {
      return new Response(null, { status: Number(params.status) });
    }
  ),
  http.head("https://example.com/template.tar.gz", () => {
    return new Response();
  }),
  http.get("https://example.com/template.tar.gz", async () => {
    let fileBuffer = await fsp.readFile(
      path.join(__dirname, "fixtures", "template.tar.gz")
    );

    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "application/x-gzip",
      },
    });
  }),
];

let server = setupServer(...githubHandlers, ...miscHandlers);
export { server };
