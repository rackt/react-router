import { test, expect } from "@playwright/test";

import {
  createAppFixture,
  createFixture,
  js,
} from "./helpers/create-fixture.js";
import type { Fixture, AppFixture } from "./helpers/create-fixture.js";
import { PlaywrightFixture } from "./helpers/playwright-fixture.js";

test.describe("`useFetcher()` updates state properly when there are loaders with redirects", () => {
  let fixture: Fixture;
  let appFixture: AppFixture;

  test.beforeAll(async () => {
    fixture = await createFixture({
      files: {
        "app/data.ts": js`          
          export let dataList = ["one", "two", "three", "four"];
          export let getItemById = (id: string) => dataList.find((i) => i === id);
          export let deleteItemById = (id: string) => {
            dataList = dataList.filter((i) => i !== id);
          }
        `,
        "app/routes/list.tsx": js`
          import { useLoaderData, useFetcher, Link, Outlet } from "react-router";
          import { dataList } from "../data";

          export function loader() {
            return dataList;
          }

          export default function Component() {
            const list = useLoaderData() as string[];
            const deleteFetcher = useFetcher();

            const deleteCurrentItem = async () => {
              await deleteFetcher.submit(null, {
                method: "POST",
                action: '/list/one',
              });
            };

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <button
                  disabled={deleteFetcher.state !== "idle"}
                  onClick={() => deleteCurrentItem()}
                  id="delete"
                >
                  Delete item that is currently active{" "}
                </button>
                <span data-testid="fetcher_state">
                  {deleteFetcher.state}
                </span>
                <div style={{ display: "flex", gap: "1rem" }}>
                  <ul>
                    {list.map((item) => (
                      <li
                        key={item}
                        style={{ display: "flex", gap: "1rem", padding: "0.5rem" }}
                      >
                        <Link to={"/list/" + item}>{item}</Link>
                      </li>
                    ))}
                  </ul>
                  <div>
                    <Outlet />
                  </div>
                </div>
              </div>
            );
          }
        `,
        "app/routes/list.$id.tsx": js`
          import { useLoaderData, redirect } from "react-router";
          import { getItemById, deleteItemById } from "../data";
          export async function action({ params }) {
            deleteItemById(params.id);

            return null;
          }

          export async function loader({ params }) {
            const item = getItemById(params.id);

            if (!item) {
              throw redirect("/list");
            }

            return item;
          }

          export default function Component() {
            let item = useLoaderData();
            return <div>ITEM {item}</div>;
          }
        `,
      },
    });

    appFixture = await createAppFixture(fixture);
  });

  test.afterAll(() => {
    appFixture.close();
  });

  test("after the action is called and the loader redirects the fetcher state is set to idle", async ({
    page,
  }) => {
    let app = new PlaywrightFixture(appFixture, page);
    await app.goto("/list/one");
    await page.waitForLoadState("load");
    expect(page.getByTestId('fetcher_state')).toHaveText('idle')
    await app.clickElement("#delete");
    expect(page.getByTestId('fetcher_state')).toHaveText('idle')
  });
});
