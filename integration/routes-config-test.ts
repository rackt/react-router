import { expect } from "@playwright/test";

import {
  type Files,
  createProject,
  build,
  test,
  viteConfig,
  createEditor,
} from "./helpers/vite.js";

const js = String.raw;

test.describe("routes config", () => {
  test("fails the build if config is invalid", async () => {
    let cwd = await createProject({
      "app/routes.ts": `export default INVALID(`,
    });
    let buildResult = build({ cwd });
    expect(buildResult.status).toBe(1);
    expect(buildResult.stderr.toString()).toContain("Route config is invalid");
  });

  test("fails the dev process if config is initially invalid", async ({
    dev,
  }) => {
    let files: Files = async ({ port }) => ({
      "vite.config.js": await viteConfig.basic({ port }),
      "app/routes.ts": `export default INVALID(`,
    });
    let devError: Error | undefined;
    try {
      await dev(files);
    } catch (error: any) {
      devError = error;
    }
    expect(devError?.toString()).toContain("Route config is invalid");
  });

  test("supports correcting an invalid config", async ({ page, dev }) => {
    let files: Files = async ({ port }) => ({
      "vite.config.js": await viteConfig.basic({ port }),
      "app/routes.ts": js`
        import { routes } from "@react-router/dev/routes";

        export default routes([
          {
            file: "test-route-1.tsx",
            index: true,
          },
        ]);
      `,
      "app/test-route-1.tsx": `
        export default () => <div data-test-route>Test route 1</div>
      `,
      "app/test-route-2.tsx": `
        export default () => <div data-test-route>Test route 2</div>
      `,
    });
    let { cwd, port } = await dev(files);

    await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
    await expect(page.locator("[data-test-route]")).toHaveText("Test route 1");

    let edit = createEditor(cwd);

    // Make config invalid
    await edit("app/routes.ts", (contents) => contents + "INVALID");

    // Ensure dev server is still running with old config + HMR
    await edit("app/test-route-1.tsx", (contents) =>
      contents.replace("Test route 1", "Test route 1 updated")
    );
    await expect(page.locator("[data-test-route]")).toHaveText(
      "Test route 1 updated"
    );

    // Fix config with new route
    await edit("app/routes.ts", (contents) =>
      contents.replace("INVALID", "").replace("test-route-1", "test-route-2")
    );

    await expect(async () => {
      // Reload to pick up new route for current path
      await page.reload();
      await expect(page.locator("[data-test-route]")).toHaveText(
        "Test route 2"
      );
    }).toPass();
  });

  test("supports correcting an invalid config module graph", async ({
    page,
    dev,
  }) => {
    let files: Files = async ({ port }) => ({
      "vite.config.js": await viteConfig.basic({ port }),
      "app/routes.ts": js`
        export { default } from "./actual-routes";
      `,
      "app/actual-routes.ts": js`
        import { routes } from "@react-router/dev/routes";

        export default routes([
          {
            file: "test-route-1.tsx",
            index: true,
          },
        ]);
      `,
      "app/test-route-1.tsx": `
        export default () => <div data-test-route>Test route 1</div>
      `,
      "app/test-route-2.tsx": `
        export default () => <div data-test-route>Test route 2</div>
      `,
    });
    let { cwd, port } = await dev(files);

    await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
    await expect(page.locator("[data-test-route]")).toHaveText("Test route 1");

    let edit = createEditor(cwd);

    // Make config invalid
    await edit("app/actual-routes.ts", (contents) => contents + "INVALID");

    // Ensure dev server is still running with old config + HMR
    await edit("app/test-route-1.tsx", (contents) =>
      contents.replace("Test route 1", "Test route 1 updated")
    );
    await expect(page.locator("[data-test-route]")).toHaveText(
      "Test route 1 updated"
    );

    // Fix config with new route
    await edit("app/actual-routes.ts", (contents) =>
      contents.replace("INVALID", "").replace("test-route-1", "test-route-2")
    );

    await expect(async () => {
      // Reload to pick up new route for current path
      await page.reload();
      await expect(page.locator("[data-test-route]")).toHaveText(
        "Test route 2"
      );
    }).toPass();
  });
});
