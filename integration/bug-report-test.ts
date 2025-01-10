import { test, expect } from "@playwright/test";

import { PlaywrightFixture } from "./helpers/playwright-fixture.js";
import type { Fixture, AppFixture } from "./helpers/create-fixture.js";
import {
  createAppFixture,
  createFixture,
  js,
} from "./helpers/create-fixture.js";
import { build, createProject, reactRouterConfig } from "./helpers/vite.js";

let fixture: Fixture;
let appFixture: AppFixture;

////////////////////////////////////////////////////////////////////////////////
// 💿 👋 Hola! It's me, Dora the Remix Disc, I'm here to help you write a great
// bug report pull request.
//
// You don't need to fix the bug, this is just to report one.
//
// The pull request you are submitting is supposed to fail when created, to let
// the team see the erroneous behavior, and understand what's going wrong.
//
// If you happen to have a fix as well, it will have to be applied in a subsequent
// commit to this pull request, and your now-succeeding test will have to be moved
// to the appropriate file.
//
// First, make sure to install dependencies and build Remix. From the root of
// the project, run this:
//
//    ```
//    pnpm install && pnpm build
//    ```
//
// Now try running this test:
//
//    ```
//    pnpm test:integration integration/bug-report-test.ts
//    ```
//
// You can add `--ui` to the end to explore, watch, and debug the test:
//
//    ```
//    pnpm test:integration integration/bug-report-test.ts --ui
//    ```
////////////////////////////////////////////////////////////////////////////////

test.beforeEach(async ({ context }) => {
  await context.route(/\.data$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    route.continue();
  });
});

////////////////////////////////////////////////////////////////////////////////
// 💿 Almost done, now write your failing test case(s) down here Make sure to
// add a good description for what you expect Remix to do 👇🏽
////////////////////////////////////////////////////////////////////////////////

test("allows route loader for pre-rendered routes in SPA mode", async () => {
  const cwd = await createProject({
    "react-router.config.ts": reactRouterConfig({
      prerender: true,
      ssr: false,
    }),
    "app/routes/invalid-exports.tsx": String.raw`
    // Valid exports
    export function loader() {}
    export function clientLoader() {}
    export function clientAction() {}
    export default function Component() {}
  `,
  });
  const result = build({ cwd });
  const stderr = result.stderr.toString("utf8");
  expect(stderr).toBe("");
});

////////////////////////////////////////////////////////////////////////////////
// 💿 Finally, push your changes to your fork of Remix and open a pull request!
////////////////////////////////////////////////////////////////////////////////
