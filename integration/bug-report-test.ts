import { expect, test } from "@playwright/test";

import type { AppFixture, Fixture } from "./helpers/create-fixture.js";
import {
  createAppFixture,
  createFixture,
  js,
} from "./helpers/create-fixture.js";
import { PlaywrightFixture } from "./helpers/playwright-fixture.js";

let fixture: Fixture;
let appFixture: AppFixture;

////////////////////////////////////////////////////////////////////////////////
// 👋 Hola! I'm here to help you write a great bug report pull request.
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
// First, make sure to install dependencies and build React Router. From the root of
// the project, run this:
//
//    ```
//    pnpm install && pnpm build
//    ```
//
// If you have never installed playwright on your system before, you may also need
// to install a browser engine:
//
//    ```
//    pnpm exec playwright install chromium
//    ```
//
// Now try running this test:
//
//    ```
//    pnpm test:integration bug-report --project chromium
//    ```
//
// You can add `--watch` to the end to have it re-run on file changes:
//
//    ```
//    pnpm test:integration bug-report --project chromium --watch
//    ```
////////////////////////////////////////////////////////////////////////////////

test.beforeEach(async ({ context }) => {
  await context.route(/\.data$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    route.continue();
  });
});

test.beforeAll(async () => {
  fixture = await createFixture({
    ////////////////////////////////////////////////////////////////////////////
    // 💿 Next, add files to this object, just like files in a real app,
    // `createFixture` will make an app and run your tests against it.
    ////////////////////////////////////////////////////////////////////////////
    files: {
      "app/routes/action-redirect.tsx": js`
        import { redirect, Form } from "react-router";

        export function action({ request }) {
          const headers = new Headers(request.headers);
          return redirect("https://remix.run/", { headers });
        }

        export default function Index() {
          return (
            <Form method="post">
              <button type="submit">
                Redirect
              </button>
            </Form>
          )
        }
      `,
      "app/routes/action-redirect-working.tsx": js`
        import { redirect, Form } from "react-router";

        export function action() {
          return redirect("https://remix.run/");
        }

        export default function Index() {
          return (
            <Form method="post">
              <button type="submit">
                Redirect
              </button>
            </Form>
          )
        }
      `,
    },
  });

  // This creates an interactive app using playwright.
  appFixture = await createAppFixture(fixture);
});

test.afterAll(() => {
  appFixture.close();
});

////////////////////////////////////////////////////////////////////////////////
// 💿 Almost done, now write your failing test case(s) down here Make sure to
// add a good description for what you expect React Router to do 👇🏽
////////////////////////////////////////////////////////////////////////////////

test("redirects to external url while preserving original request headers", async ({
  page,
}) => {
  let app = new PlaywrightFixture(appFixture, page);

  await app.waitForNetworkAfter(() => app.goto("/action-redirect"));
  await app.clickElement("button");
  expect(app.page.url()).toBe("https://remix.run/");
});

test("redirects to external url", async ({ page }) => {
  let app = new PlaywrightFixture(appFixture, page);

  await app.waitForNetworkAfter(() => app.goto("/action-redirect-working"));
  await app.clickElement("button");
  expect(app.page.url()).toBe("https://remix.run/");
});

////////////////////////////////////////////////////////////////////////////////
// 💿 Finally, push your changes to your fork of React Router
// and open a pull request!
////////////////////////////////////////////////////////////////////////////////
