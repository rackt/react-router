import { expect } from "@playwright/test";
import dedent from "dedent";

import { type Files, test, viteConfig } from "./helpers/vite.js";

const tsx = dedent;
const css = dedent;

test.describe("vite-plugin-cloudflare", () => {
  const files: Files = async ({ port }) => ({
    "vite.config.ts": tsx`
      import { defineConfig } from "vite";
      import { cloudflare } from "@cloudflare/vite-plugin";
      import { reactRouter } from "@react-router/dev/vite";

      export default defineConfig({
        ${await viteConfig.server({ port })}
        plugins: [
          cloudflare({ viteEnvironment: { name: "ssr" } }),
          reactRouter(),
        ],
      });
    `,
    "app/routes/env.tsx": tsx`
      import type { Route } from "./+types/env";
      export function loader({ context }: Route.LoaderArgs) {
        return { message: context.cloudflare.env.VALUE_FROM_CLOUDFLARE };
      }
      export default function EnvRoute({ loaderData }: Route.RouteComponentProps) {
        return <div data-loader-message>{loaderData.message}</div>;
      }
    `,
    "app/routes/css-side-effect/route.tsx": tsx`
      import "./styles.css";
      
      export default function CssSideEffectRoute() {
        return <div className="css-side-effect" data-css-side-effect>CSS Side Effect</div>;
      }
    `,
    "app/routes/css-side-effect/styles.css": css`
      .css-side-effect {
        padding: 20px;
      }
    `,
  });

  test("handles Cloudflare env", async ({ dev, page }) => {
    const { port } = await dev(files, "vite-plugin-cloudflare-template");

    await page.goto(`http://localhost:${port}/env`, {
      waitUntil: "networkidle",
    });

    // Ensure no errors on page load
    expect(page.errors).toEqual([]);

    await expect(page.locator("[data-loader-message]")).toHaveText(
      "Hello from Cloudflare"
    );
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("handles CSS side effects during SSR in dev", async ({
      dev,
      page,
    }) => {
      const { port } = await dev(files, "vite-plugin-cloudflare-template");

      await page.goto(`http://localhost:${port}/css-side-effect`, {
        waitUntil: "networkidle",
      });

      await expect(page.locator("[data-css-side-effect]")).toHaveCSS(
        "padding",
        "20px"
      );
    });
  });
});
