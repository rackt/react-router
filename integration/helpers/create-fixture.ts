import type { Writable } from "node:stream";
import { Readable } from "node:stream";
import path from "node:path";
import url from "node:url";
import fse from "fs-extra";
import express from "express";
import getPort from "get-port";
import stripIndent from "strip-indent";
import { sync as spawnSync, spawn } from "cross-spawn";
import type { JsonObject } from "type-fest";

import {
  type ServerBuild,
  createRequestHandler,
  UNSAFE_ServerMode as ServerMode,
  UNSAFE_decodeViaTurboStream as decodeViaTurboStream,
} from "react-router";
import { createRequestHandler as createExpressHandler } from "@react-router/express";
import { createReadableStreamFromReadable } from "@react-router/node";

import { viteConfig, reactRouterConfig } from "./vite.js";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const root = path.join(__dirname, "../..");
const TMP_DIR = path.join(root, ".tmp", "integration");

export interface FixtureInit {
  buildStdio?: Writable;
  files?: { [filename: string]: string };
  useReactRouterServe?: boolean;
  spaMode?: boolean;
  prerender?: boolean;
  port?: number;
  turboV3?: boolean;
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;
export type AppFixture = Awaited<ReturnType<typeof createAppFixture>>;

export const js = String.raw;
export const mdx = String.raw;
export const css = String.raw;
export function json(value: JsonObject) {
  return JSON.stringify(value, null, 2);
}

export async function createFixture(init: FixtureInit, mode?: ServerMode) {
  let projectDir = await createFixtureProject(init, mode);
  let buildPath = url.pathToFileURL(
    path.join(projectDir, "build/server/index.js")
  ).href;

  const turboV3 = init.turboV3 ?? false;

  let getBrowserAsset = async (asset: string) => {
    return fse.readFile(
      path.join(projectDir, "public", asset.replace(/^\//, "")),
      "utf8"
    );
  };

  if (init.spaMode) {
    return {
      projectDir,
      build: null,
      isSpaMode: init.spaMode,
      prerender: init.prerender,
      requestDocument() {
        let html = fse.readFileSync(
          path.join(projectDir, "build/client/index.html")
        );
        return new Response(html, {
          headers: {
            "Content-Type": "text/html",
          },
        });
      },
      requestResource() {
        throw new Error("Cannot requestResource in SPA Mode tests");
      },
      requestSingleFetchData: () => {
        throw new Error("Cannot requestSingleFetchData in SPA Mode tests");
      },
      postDocument: () => {
        throw new Error("Cannot postDocument in SPA Mode tests");
      },
      getBrowserAsset,
      useReactRouterServe: init.useReactRouterServe,
    };
  }

  if (init.prerender) {
    return {
      projectDir,
      build: null,
      isSpaMode: init.spaMode,
      prerender: init.prerender,
      requestDocument(href: string) {
        let file = new URL(href, "test://test").pathname + "/index.html";
        let mainPath = path.join(projectDir, "build", "client", file);
        let fallbackPath = path.join(
          projectDir,
          "build",
          "client",
          "__spa-fallback.html"
        );
        let html = fse.existsSync(mainPath)
          ? fse.readFileSync(mainPath)
          : fse.readFileSync(fallbackPath);
        return new Response(html, {
          headers: {
            "Content-Type": "text/html",
          },
        });
      },
      requestResource(href: string) {
        let data = fse.readFileSync(
          path.join(projectDir, "build/client", href)
        );
        return new Response(data);
      },
      async requestSingleFetchData(href: string) {
        let data = fse.readFileSync(
          path.join(projectDir, "build/client", href)
        );
        let stream = createReadableStreamFromReadable(Readable.from(data));
        return {
          status: 200,
          statusText: "OK",
          headers: new Headers(),
          data: await decodeViaTurboStream(stream, global, turboV3),
        };
      },
      postDocument: () => {
        throw new Error("Cannot postDocument in Prerender tests");
      },
      getBrowserAsset,
      useReactRouterServe: init.useReactRouterServe,
    };
  }

  let app: ServerBuild = await import(buildPath);
  let handler = createRequestHandler(app, mode || ServerMode.Production);

  let requestDocument = async (href: string, init?: RequestInit) => {
    let url = new URL(href, "test://test");
    let request = new Request(url.toString(), {
      ...init,
      signal: init?.signal || new AbortController().signal,
    });
    return handler(request);
  };

  let requestResource = async (href: string, init?: RequestInit) => {
    init = init || {};
    init.signal = init.signal || new AbortController().signal;
    let url = new URL(href, "test://test");
    let request = new Request(url.toString(), init);
    return handler(request);
  };

  let requestSingleFetchData = async (href: string, init?: RequestInit) => {
    init = init || {};
    init.signal = init.signal || new AbortController().signal;
    let url = new URL(href, "test://test");
    let request = new Request(url.toString(), init);
    let response = await handler(request);
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.body
        ? await decodeViaTurboStream(response.body!, global, turboV3)
        : null,
    };
  };

  let postDocument = async (href: string, data: URLSearchParams | FormData) => {
    return requestDocument(href, {
      method: "POST",
      body: data,
      headers: {
        "Content-Type":
          data instanceof URLSearchParams
            ? "application/x-www-form-urlencoded"
            : "multipart/form-data",
      },
    });
  };

  return {
    projectDir,
    build: app,
    isSpaMode: init.spaMode,
    prerender: init.prerender,
    requestDocument,
    requestResource,
    requestSingleFetchData,
    postDocument,
    getBrowserAsset,
    useReactRouterServe: init.useReactRouterServe,
  };
}

/**
 * @deprecated Use `integration/helpers/vite.ts`'s `test` instead
 *
 * This implementation sometimes runs a request handler in memory, forcing tests to manually manage stdout/stderr
 * which has caused many integration tests to leak noisy logs for expected errors.
 * It also means that sometimes the CLI is skipped over in those tests, missing out on code paths that should be tested.
 */
export async function createAppFixture(fixture: Fixture, mode?: ServerMode) {
  let startAppServer = async (): Promise<{
    port: number;
    stop: VoidFunction;
  }> => {
    if (fixture.useReactRouterServe) {
      return new Promise(async (accept, reject) => {
        let port = await getPort();

        let nodebin = process.argv[0];
        let serveProcess = spawn(
          nodebin,
          [
            "node_modules/@react-router/serve/dist/cli.js",
            "build/server/index.js",
          ],
          {
            env: {
              ...process.env,
              NODE_ENV: mode || "production",
              PORT: port.toFixed(0),
            },
            cwd: fixture.projectDir,
            stdio: "pipe",
          }
        );
        // Wait for `started at http://localhost:${port}` to be printed
        // and extract the port from it.
        let started = false;
        let stdout = "";
        let rejectTimeout = setTimeout(() => {
          reject(
            new Error("Timed out waiting for react-router-serve to start")
          );
        }, 20000);
        serveProcess.stderr.pipe(process.stderr);
        serveProcess.stdout.on("data", (chunk) => {
          if (started) return;
          let newChunk = chunk.toString();
          stdout += newChunk;
          let match: RegExpMatchArray | null = stdout.match(
            /\[react-router-serve\] http:\/\/localhost:(\d+)\s/
          );
          if (match) {
            clearTimeout(rejectTimeout);
            started = true;
            let parsedPort = parseInt(match[1], 10);

            if (port !== parsedPort) {
              reject(
                new Error(
                  `Expected react-router-serve to start on port ${port}, but it started on port ${parsedPort}`
                )
              );
              return;
            }

            accept({
              stop: () => {
                serveProcess.kill();
              },
              port,
            });
          }
        });
      });
    }

    if (fixture.isSpaMode) {
      return new Promise(async (accept) => {
        let port = await getPort();
        let app = express();
        app.use(express.static(path.join(fixture.projectDir, "build/client")));
        app.get("*", (_, res, next) =>
          res.sendFile(path.join(fixture.projectDir, "build/client/index.html"))
        );
        let server = app.listen(port);
        accept({ stop: server.close.bind(server), port });
      });
    }

    if (fixture.prerender) {
      return new Promise(async (accept) => {
        let port = await getPort();
        let app = express();
        app.use(
          express.static(path.join(fixture.projectDir, "build", "client"))
        );
        app.get("*", (req, res, next) => {
          let dir = path.join(fixture.projectDir, "build", "client");
          let file = req.path.endsWith(".data")
            ? req.path
            : req.path + "/index.html";
          if (file.endsWith(".html") && !fse.existsSync(path.join(dir, file))) {
            file = "__spa-fallback.html";
          }
          res.sendFile(path.join(dir, file), next);
        });
        let server = app.listen(port);
        accept({ stop: server.close.bind(server), port });
      });
    }

    if (!fixture.build) {
      return Promise.reject(
        new Error("Cannot start app server without a build")
      );
    }

    return new Promise(async (accept) => {
      let port = await getPort();
      let app = express();
      app.use(express.static(path.join(fixture.projectDir, "build/client")));

      app.all(
        "*",
        createExpressHandler({
          build: fixture.build,
          mode: mode || ServerMode.Production,
        })
      );

      let server = app.listen(port);

      accept({ stop: server.close.bind(server), port });
    });
  };

  let start = async () => {
    let { stop, port } = await startAppServer();

    let serverUrl = `http://localhost:${port}`;

    return {
      serverUrl,
      /**
       * Shuts down the fixture app, **you need to call this
       * at the end of a test** or `afterAll` if the fixture is initialized in a
       * `beforeAll` block. Also make sure to `app.close()` or else you'll
       * have memory leaks.
       */
      close: () => {
        return stop();
      },
    };
  };

  return start();
}

////////////////////////////////////////////////////////////////////////////////

export async function createFixtureProject(
  init: FixtureInit = {},
  mode?: ServerMode
): Promise<string> {
  let template = "vite-5-template";
  let integrationTemplateDir = path.resolve(__dirname, template);
  let projectName = `rr-${template}-${Math.random().toString(32).slice(2)}`;
  let projectDir = path.join(TMP_DIR, projectName);
  let port = init.port ?? (await getPort());

  await fse.ensureDir(projectDir);
  await fse.copy(integrationTemplateDir, projectDir);

  let hasViteConfig = Object.keys(init.files ?? {}).some((filename) =>
    filename.startsWith("vite.config.")
  );

  let hasReactRouterConfig = Object.keys(init.files ?? {}).some((filename) =>
    filename.startsWith("react-router.config.")
  );

  let { spaMode } = init;

  await writeTestFiles(
    {
      ...(hasViteConfig
        ? {}
        : {
            "vite.config.js": await viteConfig.basic({
              port,
            }),
          }),
      ...(hasReactRouterConfig
        ? {}
        : {
            "react-router.config.ts": reactRouterConfig({
              ssr: !spaMode,
              turboV3: init.turboV3,
            }),
          }),
      ...init.files,
    },
    projectDir
  );

  build(projectDir, init.buildStdio, mode);

  return projectDir;
}

function build(projectDir: string, buildStdio?: Writable, mode?: ServerMode) {
  // We have a "require" instead of a dynamic import in readConfig gated
  // behind mode === ServerMode.Test to make jest happy, but that doesn't
  // work for ESM configs, those MUST be dynamic imports. So we need to
  // force the mode to be production for ESM configs when runtime mode is
  // tested.
  mode = mode === ServerMode.Test ? ServerMode.Production : mode;

  let reactRouterBin = "node_modules/@react-router/dev/dist/cli/index.js";

  let buildArgs: string[] = [reactRouterBin, "build"];

  let buildSpawn = spawnSync("node", buildArgs, {
    cwd: projectDir,
    env: {
      ...process.env,
      NODE_ENV: mode || ServerMode.Production,
    },
  });

  // These logs are helpful for debugging. Remove comments if needed.
  // console.log("spawning node " + buildArgs.join(" ") + ":\n");
  // console.log("  STDOUT:");
  // console.log("  " + buildSpawn.stdout.toString("utf-8"));
  // console.log("  STDERR:");
  // console.log("  " + buildSpawn.stderr.toString("utf-8"));

  if (buildStdio) {
    buildStdio.write(buildSpawn.stdout.toString("utf-8"));
    buildStdio.write(buildSpawn.stderr.toString("utf-8"));
    buildStdio.end();
  }

  if (buildSpawn.error || buildSpawn.status) {
    console.error(buildSpawn.stderr.toString("utf-8"));
    throw buildSpawn.error || new Error(`Build failed, check the output above`);
  }
}

async function writeTestFiles(
  files: Record<string, string> | undefined,
  dir: string
) {
  await Promise.all(
    Object.keys(files ?? {}).map(async (filename) => {
      let filePath = path.join(dir, filename);
      await fse.ensureDir(path.dirname(filePath));
      let file = files![filename];

      await fse.writeFile(filePath, stripIndent(file));
    })
  );
}
