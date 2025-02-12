import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { expect, test } from "@playwright/test";
import dedent from "dedent";
import semver from "semver";
import fse from "fs-extra";

import { createProject } from "./helpers/vite";

const nodeBin = process.argv[0];
const reactRouterBin = "node_modules/@react-router/dev/dist/cli/index.js";

const run = (command: string[], options: Parameters<typeof spawnSync>[2]) =>
  spawnSync(nodeBin, [reactRouterBin, ...command], options);

const helpText = dedent`
  react-router

    Usage:
      $ react-router build [projectDir]
      $ react-router dev [projectDir]
      $ react-router routes [projectDir]

    Options:
      --help, -h          Print this help message and exit
      --version, -v       Print the CLI version and exit
      --no-color          Disable ANSI colors in console output
    \`build\` Options:
      --assetsInlineLimit Static asset base64 inline threshold in bytes (default: 4096) (number)
      --clearScreen       Allow/disable clear screen when logging (boolean)
      --config, -c        Use specified config file (string)
      --emptyOutDir       Force empty outDir when it's outside of root (boolean)
      --logLevel, -l      Info | warn | error | silent (string)
      --minify            Enable/disable minification, or specify minifier to use (default: "esbuild") (boolean | "terser" | "esbuild")
      --mode, -m          Set env mode (string)
      --profile           Start built-in Node.js inspector
      --sourcemapClient   Output source maps for client build (default: false) (boolean | "inline" | "hidden")
      --sourcemapServer   Output source maps for server build (default: false) (boolean | "inline" | "hidden")
    \`dev\` Options:
      --clearScreen       Allow/disable clear screen when logging (boolean)
      --config, -c        Use specified config file (string)
      --cors              Enable CORS (boolean)
      --force             Force the optimizer to ignore the cache and re-bundle (boolean)
      --host              Specify hostname (string)
      --logLevel, -l      Info | warn | error | silent (string)
      --mode, -m          Set env mode (string)
      --open              Open browser on startup (boolean | string)
      --port              Specify port (number)
      --profile           Start built-in Node.js inspector
      --strictPort        Exit if specified port is already in use (boolean)
    \`routes\` Options:
      --config, -c        Use specified Vite config file (string)
      --json              Print the routes as JSON
    \`reveal\` Options:
      --config, -c        Use specified Vite config file (string)
      --no-typescript     Generate plain JavaScript files
    \`typegen\` Options:
      --watch             Automatically regenerate types whenever route config (\`routes.ts\`) or route modules change

    Build your project:

      $ react-router build

    Run your project locally in development:

      $ react-router dev

    Show all routes in your app:

      $ react-router routes
      $ react-router routes my-app
      $ react-router routes --json
      $ react-router routes --config vite.react-router.config.ts

    Reveal the used entry point:

      $ react-router reveal entry.client
      $ react-router reveal entry.server
      $ react-router reveal entry.client --no-typescript
      $ react-router reveal entry.server --no-typescript
      $ react-router reveal entry.server --config vite.react-router.config.ts

    Generate types for route modules:

     $ react-router typegen
     $ react-router typegen --watch
`;

test.describe("cli", () => {
  test("--help", async () => {
    const cwd = await createProject();
    const { stdout, stderr, status } = run(["--help"], {
      cwd,
      env: {
        NO_COLOR: "1",
      },
    });
    expect(stdout.toString().trim()).toBe(helpText);
    expect(stderr.toString()).toBe("");
    expect(status).toBe(0);
  });

  test("--version", async () => {
    const cwd = await createProject();
    let { stdout, stderr, status } = run(["--version"], { cwd });
    expect(semver.valid(stdout.toString().trim())).not.toBeNull();
    expect(stderr.toString()).toBe("");
    expect(status).toBe(0);
  });

  test("routes", async () => {
    const cwd = await createProject();
    let { stdout, stderr, status } = run(["routes"], { cwd });
    expect(stdout.toString().trim()).toBe(dedent`
      <Routes>
        <Route file="root.tsx">
          <Route index file="routes/_index.tsx" />
        </Route>
      </Routes>
    `);
    expect(stderr.toString()).toBe("");
    expect(status).toBe(0);
  });

  test.describe("reveal", async () => {
    test("generates entry.{server,client}.tsx in the app directory", async () => {
      const cwd = await createProject();
      let entryClientFile = path.join(cwd, "app", "entry.client.tsx");
      let entryServerFile = path.join(cwd, "app", "entry.server.tsx");

      expect(fse.existsSync(entryServerFile)).toBeFalsy();
      expect(fse.existsSync(entryClientFile)).toBeFalsy();

      run(["reveal"], { cwd });

      expect(fse.existsSync(entryServerFile)).toBeTruthy();
      expect(fse.existsSync(entryClientFile)).toBeTruthy();
    });

    test("generates specified entries in the app directory", async () => {
      const cwd = await createProject();

      let entryClientFile = path.join(cwd, "app", "entry.client.tsx");
      let entryServerFile = path.join(cwd, "app", "entry.server.tsx");

      expect(fse.existsSync(entryServerFile)).toBeFalsy();
      expect(fse.existsSync(entryClientFile)).toBeFalsy();

      run(["reveal", "entry.server"], { cwd });
      expect(fse.existsSync(entryServerFile)).toBeTruthy();
      expect(fse.existsSync(entryClientFile)).toBeFalsy();
      fse.removeSync(entryServerFile);

      run(["reveal", "entry.client"], { cwd });
      expect(fse.existsSync(entryClientFile)).toBeTruthy();
      expect(fse.existsSync(entryServerFile)).toBeFalsy();
    });

    test("generates entry.{server,client}.jsx in the app directory with --no-typescript", async () => {
      const cwd = await createProject();
      let entryClientFile = path.join(cwd, "app", "entry.client.jsx");
      let entryServerFile = path.join(cwd, "app", "entry.server.jsx");

      expect(fse.existsSync(entryServerFile)).toBeFalsy();
      expect(fse.existsSync(entryClientFile)).toBeFalsy();

      run(["reveal", "--no-typescript"], { cwd });

      expect(fse.existsSync(entryServerFile)).toBeTruthy();
      expect(fse.existsSync(entryClientFile)).toBeTruthy();
    });
  });
});
