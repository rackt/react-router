import { JSDOM } from "jsdom";
// Drop support for the submitter parameter, as in a legacy browser. This
// needs to be done before react-router-dom is required, since it does some
// FormData detection.
import "./polyfills/drop-FormData-submitter";
import * as React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  Form,
  Route,
  RouterProvider,
  createBrowserRouter,
  createHashRouter,
  createRoutesFromElements,
} from "../../index";

testDomRouter("<DataBrowserRouter>", createBrowserRouter, (url) =>
  getWindowImpl(url, false)
);

testDomRouter("<DataHashRouter>", createHashRouter, (url) =>
  getWindowImpl(url, true)
);

testDomRouter("<DataHashRouterNoSlash>", (routes, opts) => createHashRouter(routes, { ...opts, hashType: 'noslash' }), (url) =>
  getWindowImpl(url, true)
);

function testDomRouter(
  name: string,
  createTestRouter: typeof createBrowserRouter | typeof createHashRouter,
  getWindow: (initialUrl: string, isHash?: boolean) => Window
) {
  describe(`Router: ${name} with a legacy FormData implementation`, () => {
    let consoleWarn: jest.SpyInstance;
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
      consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => { });
      consoleError = jest.spyOn(console, "error").mockImplementation(() => { });
    });

    afterEach(() => {
      window.__staticRouterHydrationData = undefined;
      consoleWarn.mockRestore();
      consoleError.mockRestore();
    });

    describe("useSubmit/Form FormData", () => {
      it("appends basic submitter value(s)", async () => {
        let actionSpy = jest.fn();
        actionSpy.mockReturnValue({});
        async function getPayload() {
          let formData = await actionSpy.mock.calls[
            actionSpy.mock.calls.length - 1
          ][0].request.formData();
          return new URLSearchParams(formData.entries()).toString();
        }

        let router = createTestRouter(
          createRoutesFromElements(
            <Route path="/" action={actionSpy} element={<FormPage />} />
          ),
          { window: getWindow("/") }
        );
        render(<RouterProvider router={router} />);

        function FormPage() {
          return (
            <>
              <button name="tasks" value="outside" form="myform">
                Outside
              </button>
              <Form id="myform" method="post">
                <input type="text" name="tasks" defaultValue="first" />
                <input type="text" name="tasks" defaultValue="second" />

                <button name="tasks" value="">
                  Add Task
                </button>
                <button value="">No Name</button>
                <input type="image" name="tasks" alt="Add Task" />
                <input type="image" alt="No Name" />

                <input type="text" name="tasks" defaultValue="last" />
              </Form>
            </>
          );
        }

        fireEvent.click(screen.getByText("Add Task"));
        expect(await getPayload()).toEqual(
          "tasks=first&tasks=second&tasks=last&tasks="
        );

        fireEvent.click(screen.getByText("No Name"));
        expect(await getPayload()).toEqual(
          "tasks=first&tasks=second&tasks=last"
        );

        fireEvent.click(screen.getByAltText("Add Task"), {
          clientX: 1,
          clientY: 2,
        });
        expect(await getPayload()).toEqual(
          "tasks=first&tasks=second&tasks=last&tasks.x=0&tasks.y=0"
        );

        fireEvent.click(screen.getByAltText("No Name"), {
          clientX: 1,
          clientY: 2,
        });
        expect(await getPayload()).toEqual(
          "tasks=first&tasks=second&tasks=last&x=0&y=0"
        );

        fireEvent.click(screen.getByText("Outside"));
        expect(await getPayload()).toEqual(
          "tasks=first&tasks=second&tasks=last&tasks=outside"
        );
      });
    });
  });
}

function getWindowImpl(initialUrl: string, isHash = false): Window {
  // Need to use our own custom DOM in order to get a working history
  const dom = new JSDOM(`<!DOCTYPE html>`, { url: "http://localhost/" });
  dom.window.history.replaceState(null, "", (isHash ? "#" : "") + initialUrl);
  return dom.window as unknown as Window;
}
