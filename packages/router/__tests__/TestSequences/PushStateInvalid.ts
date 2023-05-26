import type { DOMWindow } from "jsdom";
import type { History } from "../../history";

export default function PushState(history: History, window: DOMWindow) {
  let err = new DOMException("ERROR", "DataCloneError");
  jest.spyOn(window.history, "pushState").mockImplementation(() => {
    throw err;
  });

  expect(history.location).toMatchObject({
    pathname: "/",
  });

  expect(() =>
    history.push("/home?the=query#the-hash", { invalid: () => {} })
  ).toThrow(err);

  expect(history.location.pathname).toBe("/");
}
