import { test, expect } from "@playwright/test";

import {
  createFixture,
  js,
  createAppFixture,
} from "./helpers/create-fixture.js";
import { PlaywrightFixture } from "./helpers/playwright-fixture.js";

test(
  "expect to be able to browse backward out of a remix app, then forward " +
    "twice in history and have pages render correctly",
  async ({ page, browserName }) => {
    test.skip(
      browserName === "firefox",
      "FireFox doesn't support browsing to an empty page (aka about:blank)"
    );

    let fixture = await createFixture({
      files: {
        "app/routes/_index.tsx": js`
          import { Link } from "react-router";

          export default function Index() {
            return (
              <div>
                <div id="pizza">pizza</div>
                <Link to="/burgers">burger link</Link>
              </div>
            )
          }
        `,

        "app/routes/burgers.tsx": js`
          export default function Index() {
            return <div id="cheeseburger">cheeseburger</div>;
          }
        `,
      },
    });

    // This creates an interactive app using puppeteer.
    let appFixture = await createAppFixture(fixture);

    let app = new PlaywrightFixture(appFixture, page);

    // Slow down the entry chunk on the second load so the bug surfaces
    let isSecondLoad = false;
    await page.route(/entry/, async (route) => {
      if (isSecondLoad) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      route.continue();
    });

    // This sets up the Remix modules cache in memory, priming the error case.
    await app.goto("/");
    await app.clickLink("/burgers");
    expect(await page.content()).toContain("cheeseburger");
    await page.goBack();
    await page.waitForSelector("#pizza");
    expect(await app.getHtml()).toContain("pizza");

    // Takes the browser out of the Remix app
    await page.goBack();
    expect(page.url()).toContain("about:blank");

    // Forward to / and immediately again to /burgers.  This will trigger the
    // error since we'll load __routeModules for / but then try to hydrate /burgers
    isSecondLoad = true;
    await page.goForward();
    await page.goForward();
    await page.waitForSelector("#cheeseburger");

    // If we resolve the error, we should hard reload and eventually
    // successfully render /burgers
    await page.waitForSelector("#cheeseburger");
    expect(await app.getHtml()).toContain("cheeseburger");

    appFixture.close();
  }
);

test("allows users to pass a client side context to HydratedRouter", async ({
  page,
}) => {
  let fixture = await createFixture({
    files: {
      "app/entry.client.tsx": js`
        import { HydratedRouter } from "react-router/dom";
        import { startTransition, StrictMode } from "react";
        import { hydrateRoot } from "react-dom/client";

        startTransition(() => {
          hydrateRoot(
            document,
            <StrictMode>
              <HydratedRouter context={{ foo: 'bar' }} />
            </StrictMode>
          );
        });
      `,
      "app/routes/_index.tsx": js`
        export function clientLoader({ context }) {
          return context;
        }
        export default function Index({ loaderData }) {
          return <h1>Hello, {loaderData.foo}</h1>
        }
      `,
    },
  });

  let appFixture = await createAppFixture(fixture);
  let app = new PlaywrightFixture(appFixture, page);
  await app.goto("/", true);
  expect(await app.getHtml()).toContain("Hello, bar");

  appFixture.close();
});
