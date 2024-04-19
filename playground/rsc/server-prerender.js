import * as dns from "node:dns";

import { createRequestHandler } from "@react-router/express";
import rrnode from "@react-router/node";
// import compression from "compression";
import express from "express";

const { installGlobals } = rrnode;
// import morgan from "morgan";

installGlobals();

dns.setDefaultResultOrder("ipv4first");

// function createFetchReactServer()

const viteDevServer =
  process.env.NODE_ENV === "production"
    ? undefined
    : await import("vite").then((vite) =>
        vite.createServer({
          server: { middlewareMode: true },
        })
      );

const remixHandler = createRequestHandler({
  build: viteDevServer
    ? () => viteDevServer.ssrLoadModule("virtual:react-router/server-build")
    : await import("./build/server/index.js"),
  // TODO: Make _url a real URL
  async callReactServer(_url, init) {
    const url = new URL(_url);
    return await fetch(
      "http://localhost:3001" + url.pathname + url.search,
      init
    );
  },
});

const app = express();

// app.use(compression());

// http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
app.disable("x-powered-by");

// handle asset requests
if (viteDevServer) {
  app.use(viteDevServer.middlewares);
} else {
  // Vite fingerprints its assets so we can cache forever.
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" })
  );
}

// Everything else (like favicon.ico) is cached for an hour. You may want to be
// more aggressive with this caching.
app.use(express.static("build/client", { maxAge: "1h" }));

// app.use(morgan("tiny"));

// handle SSR requests
app.all("*", remixHandler);

const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`Express ssr server listening at http://localhost:${port}`)
);
