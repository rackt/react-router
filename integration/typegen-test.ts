import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { expect, test } from "@playwright/test";
import dedent from "dedent";
import fse from "fs-extra";

import {
  createProject,
  createWorkspaceProject,
} from "./helpers/vite";
import { getAllFilesInDir } from "./helpers/filesystem";

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

  export default {
    plugins: [reactRouter()],
  };
`;

const expectType = tsx`
  export type Expect<T extends true> = T

  export type Equal<X, Y> =
    (<T>() => T extends X ? 1 : 2) extends
    (<T>() => T extends Y ? 1 : 2) ? true : false
`;

test.describe("typegen", () => {
  test("basic", async () => {
    const cwd = await createProject({
      "vite.config.ts": viteConfig,
      "app/expect-type.ts": expectType,
      "app/routes.ts": tsx`
        import { type RouteConfig, route } from "@react-router/dev/routes";

        export default [
          route("products/:id", "routes/product.tsx")
        ] satisfies RouteConfig;
      `,
      "app/routes/product.tsx": tsx`
        import type { Expect, Equal } from "../expect-type"
        import type { Route } from "./+types/product"

        export function loader({ params }: Route.LoaderArgs) {
          type Test1 = Expect<Equal<typeof params.id, string>>
          type Test2 = Expect<Equal<typeof params.asdf, string | undefined>>
          return { planet: "world" }
        }

        export default function Component({ loaderData }: Route.ComponentProps) {
          type Test = Expect<Equal<typeof loaderData.planet, string>>
          return <h1>Hello, {loaderData.planet}!</h1>
        }
      `,
    });

    const proc = typecheck(cwd);
    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("");
    expect(proc.status).toBe(0);
  });

  test.describe("params", () => {
    test("repeated", async () => {
      const cwd = await createProject({
        "vite.config.ts": viteConfig,
        "app/expect-type.ts": expectType,
        "app/routes.ts": tsx`
          import { type RouteConfig, route } from "@react-router/dev/routes";

          export default [
            route("only-required/:id/:id", "routes/only-required.tsx"),
            route("only-optional/:id?/:id?", "routes/only-optional.tsx"),
            route("optional-then-required/:id?/:id", "routes/optional-then-required.tsx"),
            route("required-then-optional/:id/:id?", "routes/required-then-optional.tsx"),
          ] satisfies RouteConfig;
        `,
        "app/routes/only-required.tsx": tsx`
          import type { Expect, Equal } from "../expect-type"
          import type { Route } from "./+types/only-required"
          export function loader({ params }: Route.LoaderArgs) {
            type Test = Expect<Equal<typeof params.id, string>>
            return null
          }
        `,
        "app/routes/only-optional.tsx": tsx`
          import type { Expect, Equal } from "../expect-type"
          import type { Route } from "./+types/only-optional"
          export function loader({ params }: Route.LoaderArgs) {
            type Test = Expect<Equal<typeof params.id, string | undefined>>
            return null
          }
        `,
        "app/routes/optional-then-required.tsx": tsx`
          import type { Expect, Equal } from "../expect-type"
          import type { Route } from "./+types/optional-then-required"
          export function loader({ params }: Route.LoaderArgs) {
            type Test = Expect<Equal<typeof params.id, string>>
            return null
          }
        `,
        "app/routes/required-then-optional.tsx": tsx`
          import type { Expect, Equal } from "../expect-type"
          import type { Route } from "./+types/required-then-optional"

          export function loader({ params }: Route.LoaderArgs) {
            type Test = Expect<Equal<typeof params.id, string>>
            return null
          }
        `,
      });
      const proc = typecheck(cwd);
      expect(proc.stdout.toString()).toBe("");
      expect(proc.stderr.toString()).toBe("");
      expect(proc.status).toBe(0);
    });

    test("splat", async () => {
      const cwd = await createProject({
        "vite.config.ts": viteConfig,
        "app/expect-type.ts": expectType,
        "app/routes.ts": tsx`
          import { type RouteConfig, route } from "@react-router/dev/routes";

          export default [
            route("splat/*", "routes/splat.tsx")
          ] satisfies RouteConfig;
        `,
        "app/routes/splat.tsx": tsx`
          import type { Expect, Equal } from "../expect-type"
          import type { Route } from "./+types/splat"

          export function loader({ params }: Route.LoaderArgs) {
            type Test = Expect<Equal<typeof params["*"], string>>
            return null
          }
        `,
      });
      const proc = typecheck(cwd);
      expect(proc.stdout.toString()).toBe("");
      expect(proc.stderr.toString()).toBe("");
      expect(proc.status).toBe(0);
    });

    test("with extension", async () => {
      const cwd = await createProject({
        "vite.config.ts": viteConfig,
        "app/expect-type.ts": expectType,
        "app/routes.ts": tsx`
          import { type RouteConfig, route } from "@react-router/dev/routes";

          export default [
            route(":lang.xml", "routes/param-with-ext.tsx"),
            route(":user?.pdf", "routes/optional-param-with-ext.tsx"),
          ] satisfies RouteConfig;
        `,
        "app/routes/param-with-ext.tsx": tsx`
          import type { Expect, Equal } from "../expect-type"
          import type { Route } from "./+types/param-with-ext"

          export function loader({ params }: Route.LoaderArgs) {
            type Test = Expect<Equal<typeof params["lang"], string>>
            return null
          }
        `,
        "app/routes/optional-param-with-ext.tsx": tsx`
          import type { Expect, Equal } from "../expect-type"
          import type { Route } from "./+types/optional-param-with-ext"

          export function loader({ params }: Route.LoaderArgs) {
            type Test = Expect<Equal<typeof params["user"], string | undefined>>
            return null
          }
        `,
      });
      const proc = typecheck(cwd);
      expect(proc.stdout.toString()).toBe("");
      expect(proc.stderr.toString()).toBe("");
      expect(proc.status).toBe(0);
    });
  });

  test("clientLoader.hydrate = true", async () => {
    const cwd = await createProject({
      "vite.config.ts": viteConfig,
      "app/expect-type.ts": expectType,
      "app/routes/_index.tsx": tsx`
        import type { Expect, Equal } from "../expect-type"
        import type { Route } from "./+types/_index"

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
          type Test = Expect<Equal<typeof loaderData, { client: string }>>
          return <h1>Hello from {loaderData.client}!</h1>
        }
      `,
    });
    const proc = typecheck(cwd);
    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("");
    expect(proc.status).toBe(0);
  });

  test("custom app dir", async () => {
    const cwd = await createProject({
      "vite.config.ts": viteConfig,
      "react-router.config.ts": tsx`
        export default {
          appDirectory: "src/myapp",
        }
      `,
      "app/expect-type.ts": expectType,
      "app/routes/products.$id.tsx": tsx`
        import type { Expect, Equal } from "../expect-type"
        import type { Route } from "./+types/products.$id"

        export function loader({ params }: Route.LoaderArgs) {
          type Test = Expect<Equal<typeof params.id, string>>
          return { planet: "world" }
        }

        export default function Component({ loaderData }: Route.ComponentProps) {
          type Test = Expect<Equal<typeof loaderData.planet, string>>
          return <h1>Hello, {loaderData.planet}!</h1>
        }
      `,
    });
    fse.moveSync(path.join(cwd, "app"), path.join(cwd, "src/myapp"));

    const proc = typecheck(cwd);
    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("");
    expect(proc.status).toBe(0);
  });

  test("matches", async () => {
    const cwd = await createProject({
      "vite.config.ts": viteConfig,
      "app/expect-type.ts": expectType,
      "app/routes.ts": tsx`
        import { type RouteConfig, route } from "@react-router/dev/routes";

        export default [
          route("parent1/:parent1", "routes/parent1.tsx", [
            route("parent2/:parent2", "routes/parent2.tsx", [
              route("current", "routes/current.tsx")
            ])
          ])
        ] satisfies RouteConfig;
      `,
      "app/routes/parent1.tsx": tsx`
        import { Outlet } from "react-router"

        export function loader() {
          return { parent1: 1 }
        }

        export default function Component() {
          return (
            <section>
              <h1>Parent1</h1>
              <Outlet />
            </section>
          )
        }
      `,
      "app/routes/parent2.tsx": tsx`
        import { Outlet } from "react-router"

        export function loader() {
          return { parent2: 2 }
        }

        export default function Component() {
          return (
            <section>
              <h2>Parent2</h2>
              <Outlet />
            </section>
          )
        }
      `,
      "app/routes/current.tsx": tsx`
        import type { Expect, Equal } from "../expect-type"
        import type { Route } from "./+types/current"

        export function loader() {
          return { current: 3 }
        }

        export function meta({ matches }: Route.MetaArgs) {
          const parent1 = matches[1]
          type Test1 = Expect<Equal<typeof parent1.data, { parent1: number }>>

          const parent2 = matches[2]
          type Test2 = Expect<Equal<typeof parent2.data, { parent2: number }>>

          const current = matches[3]
          type Test3 = Expect<Equal<typeof current.data, { current: number }>>

          const child1 = matches[4]
          type Test4a = Expect<undefined extends typeof child1 ? true : false>
          if (child1) {
            type Test4b = Expect<Equal<typeof child1.data, unknown>>
          }
          return []
        }

        export default function Component({ matches }: Route.ComponentProps) {
          const parent1 = matches[1]
          type Test1 = Expect<Equal<typeof parent1.data, { parent1: number }>>

          const parent2 = matches[2]
          type Test2 = Expect<Equal<typeof parent2.data, { parent2: number }>>

          const current = matches[3]
          type Test3 = Expect<Equal<typeof current.data, { current: number }>>

          const child1 = matches[4]
          type Test4a = Expect<undefined extends typeof child1 ? true : false>
          if (child1) {
            type Test4b = Expect<Equal<typeof child1.data, unknown>>
          }
        }
      `,
    });
    const proc = typecheck(cwd);
    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("");
    expect(proc.status).toBe(0);
  });

  test("route files with absolute paths", async () => {
    const cwd = await createProject({
      "vite.config.ts": viteConfig,
      "app/expect-type.ts": expectType,
      "app/routes.ts": tsx`
        import path from "node:path";
        import { type RouteConfig, route } from "@react-router/dev/routes";

        export default [
          route("absolute/:id", path.resolve(__dirname, "routes/absolute.tsx")),
        ] satisfies RouteConfig;
      `,
      "app/routes/absolute.tsx": tsx`
        import type { Expect, Equal } from "../expect-type"
        import type { Route } from "./+types/absolute"

        export function loader({ params }: Route.LoaderArgs) {
          type Test = Expect<Equal<typeof params.id, string>>
          return { planet: "world" }
        }

        export default function Component({ loaderData }: Route.ComponentProps) {
          type Test = Expect<Equal<typeof loaderData.planet, string>>
          return <h1>Hello, {loaderData.planet}!</h1>
        }
      `,
    });

    const proc = typecheck(cwd);
    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("");
    expect(proc.status).toBe(0);
  });

  test("href", async () => {
    const cwd = await createProject({
      "vite.config.ts": viteConfig,
      "app/expect-type.ts": expectType,
      "app/routes.ts": tsx`
        import path from "node:path";
        import { type RouteConfig, route } from "@react-router/dev/routes";

        export default [
          route("no-params", "routes/no-params.tsx"),
          route("required-param/:req", "routes/required-param.tsx"),
          route("optional-param/:opt?", "routes/optional-param.tsx"),
          route("/leading-and-trailing-slash/", "routes/leading-and-trailing-slash.tsx"),
          route("some-other-route", "routes/some-other-route.tsx"),
        ] satisfies RouteConfig;
      `,
      "app/routes/no-params.tsx": tsx`
        export default function Component() {}
      `,
      "app/routes/required-param.tsx": tsx`
        export default function Component() {}
      `,
      "app/routes/optional-param.tsx": tsx`
        export default function Component() {}
      `,
      "app/routes/leading-and-trailing-slash.tsx": tsx`
        export default function Component() {}
      `,
      "app/routes/some-other-route.tsx": tsx`
        import { href } from "react-router"

        // @ts-expect-error
        href("/does-not-exist")

        href("/no-params")

        // @ts-expect-error
        href("/required-param/:req")
        href("/required-param/:req", { req: "hello" })

        href("/optional-param/:opt?")
        href("/optional-param/:opt?", { opt: "hello" })

        href("/leading-and-trailing-slash")
        // @ts-expect-error
        href("/leading-and-trailing-slash/")

        export default function Component() {}
      `,
    });
    const proc = typecheck(cwd);
    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("");
    expect(proc.status).toBe(0);
  });

  test("route files from workspace packages", async () => {
    const { appProjectDir } = await createWorkspaceProject((libDir) => ({
      appFiles: {
        "app/routes.ts": tsx`
          import type { RouteConfig } from "@react-router/dev/routes";
          export default [
            { path: 'lib-route', file: "${libDir}/my-route.jsx" }
          ] satisfies RouteConfig;
        `,
      },
      libFiles: {
        "my-route.jsx": tsx`
          export default function MyRoute() {
            return <h1>My Route</h1>;
          }
        `,
      },
    }));

    const proc = typecheck(appProjectDir);

    expect(proc.stdout.toString()).toBe("");
    expect(proc.stderr.toString()).toBe("");
    expect(proc.status).toBe(0);

    // Expect that the route library's typing is not generated into the app project
    const files = await getAllFilesInDir(appProjectDir);
    const appProjectFiles = files.filter(
      (name) => !name.includes("node_modules")
    );
    expect(
      appProjectFiles.some((name) => name.includes("my-route"))
    ).toBeFalsy();
  });
});
