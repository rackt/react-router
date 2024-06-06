import { createReactServerRequestHandler } from "@react-router/express";
import { installGlobals } from "@react-router/node";
import express from "express";
import morgan from "morgan";

installGlobals();

const viteDevServer =
  process.env.NODE_ENV === "production"
    ? undefined
    : await import("vite").then((vite) =>
        vite.createServer({
          server: { middlewareMode: true, hmr: { port: 3002 } },
        })
      );

const build = viteDevServer
  ? () => viteDevServer.ssrLoadModule("virtual:react-router/react-server-build")
  : await import("./build/react-server/index.js");

installGlobals({
  serverViteDevServer: viteDevServer,
  serverReferences: typeof build !== "function" ? {} : undefined,
});

const reactRouterHandler = createReactServerRequestHandler({
  build,
});

const app = express();

app.disable("x-powered-by");

app.use(morgan("tiny"));

app.all("*", reactRouterHandler);

const port = process.env.PORT || 3001;
app.listen(port, () =>
  console.log(`Express server listening at http://localhost:${port}`)
);
