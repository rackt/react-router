/**
 * @jest-environment node
 */

import { createSession, isSession } from "../../lib/server-runtime/sessions";
import { createCookieSessionStorage } from "../../lib/server-runtime/sessions/cookieStorage";
import { createMemorySessionStorage } from "../../lib/server-runtime/sessions/memoryStorage";

function getCookieFromSetCookie(setCookie: string): string {
  return setCookie.split(/;\s*/)[0];
}

describe("Session", () => {
  it("has an empty id by default", () => {
    expect(createSession().id).toEqual("");
  });

  it("correctly stores and retrieves values", () => {
    let session = createSession();

    session.set("user", "mjackson");
    session.flash("error", "boom");

    expect(session.has("user")).toBe(true);
    expect(session.get("user")).toBe("mjackson");
    // Normal values should remain in the session after get()
    expect(session.has("user")).toBe(true);
    expect(session.get("user")).toBe("mjackson");

    expect(session.has("error")).toBe(true);
    expect(session.get("error")).toBe("boom");
    // Flash values disappear after the first get()
    expect(session.has("error")).toBe(false);
    expect(session.get("error")).toBeUndefined();

    session.unset("user");

    expect(session.has("user")).toBe(false);
    expect(session.get("user")).toBeUndefined();
  });
});

describe("isSession", () => {
  it("returns `true` for Session objects", () => {
    expect(isSession(createSession())).toBe(true);
  });

  it("returns `false` for non-Session objects", () => {
    expect(isSession({})).toBe(false);
    expect(isSession([])).toBe(false);
    expect(isSession("")).toBe(false);
    expect(isSession(true)).toBe(false);
  });
});

describe("In-memory session storage", () => {
  it("persists session data across requests", async () => {
    let { getSession, commitSession } = createMemorySessionStorage({
      cookie: { secrets: ["secret1"] },
    });
    let session = await getSession();
    session.set("user", "mjackson");
    let setCookie = await commitSession(session);
    session = await getSession(getCookieFromSetCookie(setCookie));

    expect(session.get("user")).toEqual("mjackson");
  });

  it("uses random hash keys as session ids", async () => {
    let { getSession, commitSession } = createMemorySessionStorage({
      cookie: { secrets: ["secret1"] },
    });
    let session = await getSession();
    session.set("user", "mjackson");
    let setCookie = await commitSession(session);
    session = await getSession(getCookieFromSetCookie(setCookie));
    expect(session.id).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("Cookie session storage", () => {
  it("persists session data across requests", async () => {
    let { getSession, commitSession } = createCookieSessionStorage({
      cookie: { secrets: ["secret1"] },
    });
    let session = await getSession();
    session.set("user", "mjackson");
    let setCookie = await commitSession(session);
    session = await getSession(getCookieFromSetCookie(setCookie));

    expect(session.get("user")).toEqual("mjackson");
  });

  it("returns an empty session for cookies that are not signed properly", async () => {
    let { getSession, commitSession } = createCookieSessionStorage({
      cookie: { secrets: ["secret1"] },
    });
    let session = await getSession();
    session.set("user", "mjackson");

    expect(session.get("user")).toEqual("mjackson");

    let setCookie = await commitSession(session);
    session = await getSession(
      // Tamper with the session cookie...
      getCookieFromSetCookie(setCookie).slice(0, -1)
    );

    expect(session.get("user")).toBeUndefined();
  });

  it("returns an empty session for cookies that have been tampered with", async () => {
    let { getSession, commitSession } = createCookieSessionStorage({
      cookie: {
        secrets: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        encrypt: true,
      },
    });
    let session = await getSession();
    session.set("user", "mjackson");

    expect(session.get("user")).toEqual("mjackson");

    let setCookie = await commitSession(session);
    session = await getSession(
      // Tamper with the session cookie...
      getCookieFromSetCookie(setCookie).slice(0, -1)
    );

    expect(session.get("user")).toBeUndefined();
  });

  it('"makes the default path of cookies to be /', async () => {
    let { getSession, commitSession } = createCookieSessionStorage({
      cookie: { secrets: ["secret1"] },
    });
    let session = await getSession();
    session.set("user", "mjackson");
    let setCookie = await commitSession(session);
    expect(setCookie).toContain("Path=/");
  });

  it("throws an error when the cookie size exceeds 4096 bytes", async () => {
    let { getSession, commitSession } = createCookieSessionStorage({
      cookie: { secrets: ["secret1"] },
    });
    let session = await getSession();
    let longString = new Array(4097).fill("a").join("");
    session.set("over4096bytes", longString);
    await expect(() => commitSession(session)).rejects.toThrow();
  });

  it("destroys sessions using a past date", async () => {
    let spy = jest.spyOn(console, "warn").mockImplementation(() => {});
    let { getSession, destroySession } = createCookieSessionStorage({
      cookie: {
        secrets: ["secret1"],
      },
    });
    let session = await getSession();
    let setCookie = await destroySession(session);
    expect(setCookie).toMatchInlineSnapshot(
      `"__session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax"`
    );
    spy.mockRestore();
  });

  it("destroys sessions that leverage maxAge", async () => {
    let spy = jest.spyOn(console, "warn").mockImplementation(() => {});
    let { getSession, destroySession } = createCookieSessionStorage({
      cookie: {
        maxAge: 60 * 60, // 1 hour
        secrets: ["secret1"],
      },
    });
    let session = await getSession();
    let setCookie = await destroySession(session);
    expect(setCookie).toMatchInlineSnapshot(
      `"__session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax"`
    );
    spy.mockRestore();
  });

  describe("warnings when providing options you may not want to", () => {
    let spy = spyConsole();

    it("warns against using `expires` when creating the session", async () => {
      createCookieSessionStorage({
        cookie: {
          secrets: ["secret1"],
          expires: new Date(Date.now() + 60_000),
        },
      });

      expect(spy.console).toHaveBeenCalledTimes(1);
      expect(spy.console).toHaveBeenCalledWith(
        'The "__session" cookie has an "expires" property set. This will cause the expires value to not be updated when the session is committed. Instead, you should set the expires value when serializing the cookie. You can use `commitSession(session, { expires })` if using a session storage object, or `cookie.serialize("value", { expires })` if you\'re using the cookie directly.'
      );
    });

    it("warns when not passing secrets when creating the session", async () => {
      createCookieSessionStorage({ cookie: {} });

      expect(spy.console).toHaveBeenCalledTimes(1);
      expect(spy.console).toHaveBeenCalledWith(
        'The "__session" cookie is not signed, but session cookies should be signed to prevent tampering on the client before they are sent back to the server. See https://remix.run/utils/cookies#signing-cookies for more information.'
      );
    });
  });

  describe("when a new secret shows up in the rotation", () => {
    it("unsigns old session cookies using the old secret and encodes new cookies using the new secret", async () => {
      let { getSession, commitSession } = createCookieSessionStorage({
        cookie: { secrets: ["secret1"] },
      });
      let session = await getSession();
      session.set("user", "mjackson");
      let setCookie = await commitSession(session);
      session = await getSession(getCookieFromSetCookie(setCookie));

      expect(session.get("user")).toEqual("mjackson");

      // A new secret enters the rotation...
      let storage = createCookieSessionStorage({
        cookie: { secrets: ["secret2", "secret1"] },
      });
      getSession = storage.getSession;
      commitSession = storage.commitSession;

      // Old cookies should still work with the old secret.
      session = await storage.getSession(getCookieFromSetCookie(setCookie));
      expect(session.get("user")).toEqual("mjackson");

      // New cookies should be signed using the new secret.
      let setCookie2 = await storage.commitSession(session);
      expect(setCookie2).not.toEqual(setCookie);
    });

    it("decrypts old session cookies using the old key and encrypts new cookies using the new key", async () => {
      let { getSession, commitSession } = createCookieSessionStorage({
        cookie: { secrets: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
      });
      let session = await getSession();
      session.set("user", "mjackson");
      let setCookie = await commitSession(session);
      session = await getSession(getCookieFromSetCookie(setCookie));

      expect(session.get("user")).toEqual("mjackson");

      // A new secret enters the rotation...
      let storage = createCookieSessionStorage({
        cookie: {
          secrets: [
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          ],
        },
      });
      getSession = storage.getSession;
      commitSession = storage.commitSession;

      // Old cookies should still work with the old key.
      session = await storage.getSession(getCookieFromSetCookie(setCookie));
      expect(session.get("user")).toEqual("mjackson");

      // New cookies should be encrypted using the new key.
      let setCookie2 = await storage.commitSession(session);
      expect(setCookie2).not.toEqual(setCookie);
    });
  });
});

function spyConsole() {
  // https://github.com/facebook/react/issues/7047
  let spy: any = {};

  beforeAll(() => {
    spy.console = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  beforeEach(() => {
    spy.console.mockClear();
  });

  afterAll(() => {
    spy.console.mockRestore();
  });

  return spy;
}
