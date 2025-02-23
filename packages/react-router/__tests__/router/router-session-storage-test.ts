// viewTransitionRegistry.test.ts
import type { ViewTransitionOptions } from "../../lib/dom/global";
import type { AppliedViewTransitionMap } from "../../lib/router/router";
import {
  restoreAppliedTransitions,
  persistAppliedTransitions,
  ROUTER_TRANSITIONS_STORAGE_KEY,
} from "../../lib/router/router";

describe("View Transition Registry persistence", () => {
  let fakeStorage: Record<string, string>;
  let localFakeWindow: Window;

  // Create a fresh fakeStorage and fakeWindow before each test.
  beforeEach(() => {
    fakeStorage = {};
    localFakeWindow = {
      sessionStorage: {
        getItem: jest.fn((key: string) => fakeStorage[key] || null),
        setItem: jest.fn((key: string, value: string) => {
          fakeStorage[key] = value;
        }),
        clear: jest.fn(() => {
          fakeStorage = {};
        }),
      },
    } as unknown as Window;
    jest.clearAllMocks();
  });

  it("persists applied view transitions to sessionStorage", () => {
    const transitions: AppliedViewTransitionMap = new Map();
    const innerMap = new Map<string, ViewTransitionOptions>();
    // Use a sample option that matches the expected type.
    innerMap.set("/to", { types: ["fade"] });
    transitions.set("/from", innerMap);

    persistAppliedTransitions(localFakeWindow, transitions);

    // Verify that setItem was called using our expected key.
    const setItemCalls = (localFakeWindow.sessionStorage.setItem as jest.Mock)
      .mock.calls;
    expect(setItemCalls.length).toBeGreaterThan(0);
    const [keyUsed, valueUsed] = setItemCalls[0];
    const expected = JSON.stringify({
      "/from": { "/to": { types: ["fade"] } },
    });
    expect(keyUsed).toEqual(ROUTER_TRANSITIONS_STORAGE_KEY);
    expect(valueUsed).toEqual(expected);
    // Verify our fake storage was updated.
    expect(fakeStorage[keyUsed]).toEqual(expected);
  });

  it("restores applied view transitions from sessionStorage", () => {
    // Prepopulate fakeStorage using the module's key.
    const jsonData = { "/from": { "/to": { types: ["fade"] } } };
    fakeStorage[ROUTER_TRANSITIONS_STORAGE_KEY] = JSON.stringify(jsonData);

    const transitions: AppliedViewTransitionMap = new Map();
    restoreAppliedTransitions(localFakeWindow, transitions);

    expect(transitions.size).toBe(1);
    const inner = transitions.get("/from");
    expect(inner).toBeDefined();
    expect(inner?.size).toBe(1);
    expect(inner?.get("/to")).toEqual({ types: ["fade"] });
  });

  it("does nothing if sessionStorage is empty", () => {
    (localFakeWindow.sessionStorage.getItem as jest.Mock).mockReturnValue(null);
    const transitions: AppliedViewTransitionMap = new Map();
    restoreAppliedTransitions(localFakeWindow, transitions);
    expect(transitions.size).toBe(0);
  });

  it("logs an error when sessionStorage.setItem fails", () => {
    const error = new Error("Failed to set");
    (localFakeWindow.sessionStorage.setItem as jest.Mock).mockImplementation(
      () => {
        throw error;
      }
    );

    const transitions: AppliedViewTransitionMap = new Map();
    const innerMap = new Map<string, ViewTransitionOptions>();
    innerMap.set("/to", { types: ["fade"] });
    transitions.set("/from", innerMap);

    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    persistAppliedTransitions(localFakeWindow, transitions);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to save applied view transitions in sessionStorage"
      )
    );
    consoleWarnSpy.mockRestore();
  });

  describe("complex cases", () => {
    // Persist test cases: an array where each item is [description, transitions, expected JSON string].
    const persistCases: [string, AppliedViewTransitionMap, string][] = [
      [
        "Single mapping",
        new Map([["/from", new Map([["/to", { types: ["fade"] }]])]]),
        JSON.stringify({ "/from": { "/to": { types: ["fade"] } } }),
      ],
      [
        "Multiple mappings for one 'from' key",
        new Map([
          [
            "/from",
            new Map([
              ["/to1", { types: ["slide"] }],
              ["/to2", { types: ["fade"] }],
            ]),
          ],
        ]),
        JSON.stringify({
          "/from": {
            "/to1": { types: ["slide"] },
            "/to2": { types: ["fade"] },
          },
        }),
      ],
      [
        "Multiple 'from' keys",
        new Map([
          ["/from1", new Map([["/to", { types: ["fade"] }]])],
          ["/from2", new Map([["/to", { types: ["slide"] }]])],
        ]),
        JSON.stringify({
          "/from1": { "/to": { types: ["fade"] } },
          "/from2": { "/to": { types: ["slide"] } },
        }),
      ],
    ];

    test.each(persistCases)(
      "persists applied view transitions correctly: %s",
      (description, transitions, expected) => {
        fakeStorage = {};
        jest.clearAllMocks();
        persistAppliedTransitions(localFakeWindow, transitions);
        const stored = localFakeWindow.sessionStorage.getItem(
          ROUTER_TRANSITIONS_STORAGE_KEY
        );
        expect(stored).toEqual(expected);
      }
    );

    // Restore test cases: an array where each item is [description, jsonData, expected transitions map].
    const restoreCases: [string, any, AppliedViewTransitionMap][] = [
      [
        "Single mapping",
        { "/from": { "/to": { types: ["fade"] } } },
        new Map([["/from", new Map([["/to", { types: ["fade"] }]])]]),
      ],
      [
        "Multiple mappings for one 'from' key",
        {
          "/from": {
            "/to1": { types: ["slide"] },
            "/to2": { types: ["fade"] },
          },
        },
        new Map([
          [
            "/from",
            new Map([
              ["/to1", { types: ["slide"] }],
              ["/to2", { types: ["fade"] }],
            ]),
          ],
        ]),
      ],
      [
        "Multiple 'from' keys",
        {
          "/from1": { "/to": { types: ["fade"] } },
          "/from2": { "/to": { types: ["slide"] } },
        },
        new Map([
          ["/from1", new Map([["/to", { types: ["fade"] }]])],
          ["/from2", new Map([["/to", { types: ["slide"] }]])],
        ]),
      ],
    ];

    test.each(restoreCases)(
      "restores applied view transitions correctly: %s",
      (description, jsonData, expected) => {
        fakeStorage = {};
        // Prepopulate fakeStorage using the module's key.
        fakeStorage[ROUTER_TRANSITIONS_STORAGE_KEY] = JSON.stringify(jsonData);

        const transitions: AppliedViewTransitionMap = new Map();
        restoreAppliedTransitions(localFakeWindow, transitions);

        expect(transitions.size).toEqual(expected.size);
        expected.forEach((innerExpected, from) => {
          const innerRestored = transitions.get(from);
          expect(innerRestored).toBeDefined();
          expect(innerRestored?.size).toEqual(innerExpected.size);
          innerExpected.forEach((opts, to) => {
            expect(innerRestored?.get(to)).toEqual(opts);
          });
        });
      }
    );
  });
});
