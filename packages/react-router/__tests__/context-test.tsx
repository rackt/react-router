/* eslint-disable @typescript-eslint/no-unused-vars -- type tests */
/* eslint-disable jest/expect-expect -- type tests */
import * as React from "react";
import {
  UNSAFE_LocationContext as LocationContext,
  NavigationType,
} from "react-router";

const location = {
  pathname: "",
  search: "",
  hash: "",
  state: null,
  key: "default",
} as const;

describe("LocationContext", () => {
  it("accepts an object with the correct `pathname`", () => {
    const validCases = [
      <LocationContext.Provider
        value={{
          location: { ...location, pathname: "/" },
          navigationType: NavigationType.Pop,
        }}
      />,
      <LocationContext.Provider
        value={{
          location: { ...location, pathname: "/something" },
          navigationType: NavigationType.Pop,
        }}
      />,
      <LocationContext.Provider
        value={{
          location: { ...location, pathname: "" },
          navigationType: NavigationType.Pop,
        }}
      />,
    ];
  });

  it("accepts an object with the correct `hash`", () => {
    const validCases = [
      <LocationContext.Provider
        value={{
          location: { ...location, hash: "#" },
          navigationType: NavigationType.Pop,
        }}
      />,
      <LocationContext.Provider
        value={{
          location: { ...location, hash: "#something" },
          navigationType: NavigationType.Pop,
        }}
      />,
      <LocationContext.Provider
        value={{
          location: { ...location, hash: "" },
          navigationType: NavigationType.Pop,
        }}
      />,
    ];
  });

  it("accepts an object with the correct `search`", () => {
    const validCases = [
      <LocationContext.Provider
        value={{
          location: { ...location, search: "?" },
          navigationType: NavigationType.Pop,
        }}
      />,
      <LocationContext.Provider
        value={{
          location: { ...location, search: "?something" },
          navigationType: NavigationType.Pop,
        }}
      />,
      <LocationContext.Provider
        value={{
          location: { ...location, search: "" },
          navigationType: NavigationType.Pop,
        }}
      />,
    ];
  });

  it("rejects an object with the wrong `pathname`", () => {
    const invalidCases = [
      <LocationContext.Provider
        value={{
          location: {
            ...location,
            // @ts-expect-error
            pathname: "something",
          },
          navigationType: NavigationType.Pop,
        }}
      />,
      <LocationContext.Provider
        value={{
          location: {
            ...location,
            // @ts-expect-error
            pathname: "some/thing",
          },
          navigationType: NavigationType.Pop,
        }}
      />,
    ];
  });

  it("rejects an object with the wrong `hash`", () => {
    const invalidCases = [
      <LocationContext.Provider
        value={{
          location: {
            ...location,
            // @ts-expect-error
            hash: "something",
          },
          navigationType: NavigationType.Pop,
        }}
      />,
      <LocationContext.Provider
        value={{
          location: {
            ...location,
            // @ts-expect-error
            hash: "some#thing",
          },
          navigationType: NavigationType.Pop,
        }}
      />,
    ];
  });

  it("rejects an object with the wrong `search`", () => {
    const invalidCases = [
      <LocationContext.Provider
        value={{
          location: {
            ...location,
            // @ts-expect-error
            search: "something",
          },
          navigationType: NavigationType.Pop,
        }}
      />,
      <LocationContext.Provider
        value={{
          location: {
            ...location,
            // @ts-expect-error
            search: "some?thing",
          },
          navigationType: NavigationType.Pop,
        }}
      />,
    ];
  });
});
