import * as dns from "node:dns";

import { createRequestHandler } from "@react-router/express";
import { installGlobals } from "@react-router/node";
import compression from "compression";
import express from "express";
import morgan from "morgan";

dns.setDefaultResultOrder("ipv4first");

const viteDevServer =
  process.env.NODE_ENV === "production"
    ? undefined
    : await import("vite").then((vite) =>
        vite.createServer({
          server: { middlewareMode: true },
        })
      );

const build = viteDevServer
  ? () => viteDevServer.ssrLoadModule("virtual:react-router/server-build")
  : await import("./build/server/index.js");

installGlobals({
  clientViteDevServer: viteDevServer,
  clientReferences:
    typeof build !== "function" ? build?.clientReferences : undefined,
});

const reactRouterHandler = createRequestHandler({
  build,
  callServer: async (_url, init) => {
    const url = new URL(_url);
    const response = await fetch(
      "http://localhost:3001" + url.pathname + url.search,
      init
    );
    const cloned = response.clone();
    const body = await response.text();
    console.log({ body });
    return cloned;
  },
});

const app = express();

app.use(compression());
app.disable("x-powered-by");

if (viteDevServer) {
  app.use(viteDevServer.middlewares);
} else {
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" })
  );
}

app.use(express.static("build/client", { maxAge: "1h" }));
app.use(morgan("tiny"));

app.all("*", reactRouterHandler);

const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`Express server listening at http://localhost:${port}`)
);
