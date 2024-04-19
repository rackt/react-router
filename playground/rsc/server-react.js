import { createReactServerRequestHandler } from "@react-router/express";
import { installGlobals } from "@react-router/node";
// import compression from "compression";
import express from "express";
// import morgan from "morgan";

process.env.RSC = "1";

installGlobals();

const viteDevServer =
  process.env.NODE_ENV === "production"
    ? undefined
    : await import("vite").then((vite) =>
        vite.createServer({
          server: { middlewareMode: true, hmr: { port: 3003 } },
        })
      );

// console.log(await import("./build/react-server/index.js"));
const remixHandler = createReactServerRequestHandler({
  build: viteDevServer
    ? () => viteDevServer.ssrLoadModule("virtual:react-router/server-build")
    : await import("./build/react-server/index.js"),
});

const app = express();

// app.use(compression());

// app.use(morgan("tiny"));

// handle RSC requests
app.all("*", remixHandler);

const port = process.env.PORT || 3001;
app.listen(port, () =>
  console.log(`Express server listening at http://localhost:${port}`)
);
