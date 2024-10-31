import { spawnSync } from "node:child_process";

import { expect, test } from "@playwright/test";
import dedent from "dedent";

import { createProject } from "./helpers/vite";

const tsx = dedent;

const nodeBin = process.argv[0];
const reactRouterBin = "node_modules/@react-router/dev/dist/cli/index.js";
const tscBin = "node_modules/typescript/bin/tsc";

function typecheck(cwd: string) {
  const typegen = spawnSync(nodeBin, [reactRouterBin, "typegen"], { cwd });
  expect(typegen.stdout.toString()).toBe("");
  expect(typegen.stderr.toString()).toBe("");
  expect(typegen.status).toBe(0);

  return spawnSync(nodeBin, [tscBin], { cwd });
}

const viteConfig = tsx`
  import { reactRouter } from "@react-router/dev/vite";
  import tsconfigPaths from "vite-tsconfig-paths";

  export default {
    plugins: [
      reactRouter(),
      tsconfigPaths()
    ],
  };
`;

test.describe("typegen", () => {
  test("basic", async () => {
    const cwd = await createProject({
      "vite.config.ts": viteConfig,
      "app/routes/products.$id.tsx": tsx`
        import type { Route } from "./+types.products.$id"

        function assertType<T>(t: T) {}

        export function loader({ params }: Route.LoaderArgs) {
          assertType<string>(params.id)
          return { planet: "world" }
        }

        export default function Component({ loaderData }: Route.ComponentProps) {
          assertType<string>(loaderData.planet)
          return <h1>Hello, {loaderData.planet}!</h1>
        }
      `,
    });

    const proc = typecheck(cwd);
    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("");
    expect(proc.status).toBe(0);
  });

  test("repeated param", async () => {
    const cwd = await createProject({
      "vite.config.ts": viteConfig,
      "app/routes/repeated.$id.$id?.$id.tsx": tsx`
        import type { Route } from "./+types.repeated.$id.$id?.$id"

        function assertType<T>(t: T) {}

        export function loader({ params }: Route.LoaderArgs) {
          assertType<[string, string | undefined, string]>(params.id)
          return null
        }
      `,
    });
    const proc = typecheck(cwd);
    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("");
    expect(proc.status).toBe(0);
  });

  test("clientLoader.hydrate = true", async () => {
    const cwd = await createProject({
      "vite.config.ts": viteConfig,
      "app/routes/_index.tsx": tsx`
        import type { Route } from "./+types._index"

        function assertType<T>(t: T) {}

        export function loader() {
          return { server: "server" }
        }

        export function clientLoader() {
          return { client: "client" }
        }
        clientLoader.hydrate = true as const

        export function HydrateFallback() {
          return <h1>Loading...</h1>
        }

        export default function Component({ loaderData }: Route.ComponentProps) {
          assertType<{ client: string }>(loaderData)
          return <h1>Hello from {loaderData.client}!</h1>
        }
      `,
    });
    const proc = typecheck(cwd);
    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("");
    expect(proc.status).toBe(0);
  });
});
