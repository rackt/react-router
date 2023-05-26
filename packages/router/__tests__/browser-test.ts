/* eslint-disable jest/expect-expect */

import { JSDOM } from "jsdom";

import type { BrowserHistory } from "@remix-run/router";
import { createBrowserHistory } from "@remix-run/router";

import InitialLocationDefaultKey from "./TestSequences/InitialLocationDefaultKey";
import Listen from "./TestSequences/Listen";
import PushNewLocation from "./TestSequences/PushNewLocation";
import PushSamePath from "./TestSequences/PushSamePath";
import PushState from "./TestSequences/PushState";
import PushStateInvalid from "./TestSequences/PushStateInvalid";
import PushMissingPathname from "./TestSequences/PushMissingPathname";
import PushRelativePathname from "./TestSequences/PushRelativePathname";
import ReplaceNewLocation from "./TestSequences/ReplaceNewLocation";
import ReplaceSamePath from "./TestSequences/ReplaceSamePath";
import ReplaceState from "./TestSequences/ReplaceState";
import EncodedReservedCharacters from "./TestSequences/EncodedReservedCharacters";
import GoBack from "./TestSequences/GoBack";
import GoForward from "./TestSequences/GoForward";
import ListenPopOnly from "./TestSequences/ListenPopOnly";

describe("a browser history", () => {
  let history: BrowserHistory;
  let dom: JSDOM;

  beforeEach(() => {
    // Need to use our own custom DOM in order to get a working history
    dom = new JSDOM(`<!DOCTYPE html><p>History Example</p>`, {
      url: "https://example.org/",
    });
    dom.window.history.replaceState(null, "", "/");
    history = createBrowserHistory({ window: dom.window as unknown as Window });
  });

  it("knows how to create hrefs from location objects", () => {
    const href = history.createHref({
      pathname: "/the/path",
      search: "?the=query",
      hash: "#the-hash",
    });

    expect(href).toEqual("/the/path?the=query#the-hash");
  });

  it("knows how to create hrefs from strings", () => {
    const href = history.createHref("/the/path?the=query#the-hash");
    expect(href).toEqual("/the/path?the=query#the-hash");
  });

  it("does not encode the generated path", () => {
    const encodedHref = history.createHref({
      pathname: "/%23abc",
    });
    expect(encodedHref).toEqual("/%23abc");

    const unencodedHref = history.createHref({
      pathname: "/#abc",
    });
    expect(unencodedHref).toEqual("/#abc");
  });

  describe("listen", () => {
    it("does not immediately call listeners", () => {
      Listen(history);
    });

    it("calls listeners only for POP actions", () => {
      ListenPopOnly(history);
    });
  });

  describe("the initial location", () => {
    it('has the "default" key', () => {
      InitialLocationDefaultKey(history);
    });
  });

  describe("push a new path", () => {
    it("calls change listeners with the new location", () => {
      PushNewLocation(history);
    });
  });

  describe("push the same path", () => {
    it("calls change listeners with the new location", async () => {
      await PushSamePath(history);
    });
  });

  describe("push state", () => {
    it("calls change listeners with the new location", () => {
      PushState(history);
    });

    it("re-throws when using non-serializable state", () => {
      PushStateInvalid(history, dom.window);
    });
  });

  describe("push with no pathname", () => {
    it("reuses the current location pathname", () => {
      PushMissingPathname(history);
    });
  });

  describe("push with a relative pathname", () => {
    it("normalizes the pathname relative to the current location", () => {
      PushRelativePathname(history);
    });
  });

  describe("replace a new path", () => {
    it("calls change listeners with the new location", () => {
      ReplaceNewLocation(history);
    });
  });

  describe("replace the same path", () => {
    it("calls change listeners with the new location", () => {
      ReplaceSamePath(history);
    });
  });

  describe("replace state", () => {
    it("calls change listeners with the new location", () => {
      ReplaceState(history);
    });
  });

  describe("location created with encoded/unencoded reserved characters", () => {
    it("produces different location objects", () => {
      EncodedReservedCharacters(history);
    });
  });

  describe("back", () => {
    it("calls change listeners with the previous location", async () => {
      await GoBack(history);
    });
  });

  describe("forward", () => {
    it("calls change listeners with the next location", async () => {
      await GoForward(history);
    });
  });
});
