/**
 * @jest-environment node
 */

import { parse } from "cookie";
import { createCookie, isCookie } from "../../lib/server-runtime/cookies";

function getCookieFromSetCookie(setCookie: string): string {
  return setCookie.split(/;\s*/)[0];
}

describe("isCookie", () => {
  it("returns `true` for Cookie objects", () => {
    expect(isCookie(createCookie("my-cookie"))).toBe(true);
  });

  it("returns `false` for non-Cookie objects", () => {
    expect(isCookie({})).toBe(false);
    expect(isCookie([])).toBe(false);
    expect(isCookie("")).toBe(false);
    expect(isCookie(true)).toBe(false);
  });
});

describe("cookies", () => {
  it("parses/serializes empty string values", async () => {
    let cookie = createCookie("my-cookie");
    let setCookie = await cookie.serialize("");
    let value = await cookie.parse(getCookieFromSetCookie(setCookie));

    expect(value).toMatchInlineSnapshot(`""`);
  });

  it("parses/serializes unsigned string values", async () => {
    let cookie = createCookie("my-cookie");
    let setCookie = await cookie.serialize("hello world");
    let value = await cookie.parse(getCookieFromSetCookie(setCookie));

    expect(value).toEqual("hello world");
  });

  it("parses/serializes unsigned boolean values", async () => {
    let cookie = createCookie("my-cookie");
    let setCookie = await cookie.serialize(true);
    let value = await cookie.parse(getCookieFromSetCookie(setCookie));

    expect(value).toBe(true);
  });

  it("parses/serializes signed string values", async () => {
    let cookie = createCookie("my-cookie", {
      secrets: ["secret1"],
    });
    let setCookie = await cookie.serialize("hello michael");
    let value = await cookie.parse(getCookieFromSetCookie(setCookie));

    expect(value).toMatchInlineSnapshot(`"hello michael"`);
  });

  it("parses/serializes string values containing utf8 characters", async () => {
    let cookie = createCookie("my-cookie");
    let setCookie = await cookie.serialize("日本語");
    let value = await cookie.parse(getCookieFromSetCookie(setCookie));

    expect(value).toBe("日本語");
  });

  it("fails to parses signed string values with invalid signature", async () => {
    let cookie = createCookie("my-cookie", {
      secrets: ["secret1"],
    });
    let setCookie = await cookie.serialize("hello michael");
    let cookie2 = createCookie("my-cookie", {
      secrets: ["secret2"],
    });
    let value = await cookie2.parse(getCookieFromSetCookie(setCookie));

    expect(value).toBe(null);
  });

  it("parses/serializes signed object values", async () => {
    let cookie = createCookie("my-cookie", {
      secrets: ["secret1"],
    });
    let setCookie = await cookie.serialize({ hello: "mjackson" });
    let value = await cookie.parse(getCookieFromSetCookie(setCookie));

    expect(value).toMatchInlineSnapshot(`
      {
        "hello": "mjackson",
      }
    `);
  });

  it("parses/serializes encrypted object values", async () => {
    let encryptedCookie = createCookie("my-cookie", {
      secrets: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      encrypt: true,
    });
    let setCookie = await encryptedCookie.serialize({ hello: "mjackson" });
    let value = await encryptedCookie.parse(getCookieFromSetCookie(setCookie));

    expect(value).toMatchInlineSnapshot(`
      {
        "hello": "mjackson",
      }
    `);
  });

  it("serializes with encryption to prevent exposure of cookie data", async () => {
    // signed cookies allow cookie contents to be easily exfiltrated
    const exfiltrateCookieData = (cookie: string) => {
      let parsedCookie = parse(cookie);
      let signedCookieValue = parsedCookie["my-cookie"];
      let cookieValue = signedCookieValue?.split(".")[0];
      let decodedCookieValue = atob(cookieValue || "");

      return decodedCookieValue;
    };

    let cookie = createCookie("my-cookie", {
      secrets: ["secret1"],
    });
    let setCookie = await cookie.serialize({ hello: "mjackson" });

    expect(exfiltrateCookieData(setCookie)).toContain("mjackson");

    let encryptedCookie = createCookie("my-cookie", {
      // Must be 32 bytes (256 bits) long
      secrets: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      encrypt: true,
    });
    let setCookie2 = await encryptedCookie.serialize({ hello: "mjackson" });

    expect(exfiltrateCookieData(setCookie2)).not.toContain("mjackson");
  });

  it("fails to parse signed object values with invalid signature", async () => {
    let cookie = createCookie("my-cookie", {
      secrets: ["secret1"],
    });
    let setCookie = await cookie.serialize({ hello: "mjackson" });
    let cookie2 = createCookie("my-cookie", {
      secrets: ["secret2"],
    });
    let value = await cookie2.parse(getCookieFromSetCookie(setCookie));

    expect(value).toBeNull();
  });

  it("fails to parse encrypted object values with incorrect key", async () => {
    let cookie = createCookie("my-cookie", {
      secrets: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      encrypt: true,
    });
    let setCookie = await cookie.serialize({ hello: "mjackson" });
    let cookie2 = createCookie("my-cookie", {
      secrets: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      encrypt: true,
    });
    let value = await cookie2.parse(getCookieFromSetCookie(setCookie));

    expect(value).toBeNull();

    let cookie3 = createCookie("my-cookie", {
      secrets: ["secret1"],
    });
    let value2 = await cookie3.parse(getCookieFromSetCookie(setCookie));

    expect(value2).toBeNull();
  });

  it("fails to create encrypted cookies without a secret", async () => {
    expect(() =>
      // @ts-expect-error missing secrets
      createCookie("my-cookie", {
        encrypt: true,
      })
    ).toThrow();
  });

  it("supports secret rotation", async () => {
    let cookie = createCookie("my-cookie", {
      secrets: ["secret1"],
    });
    let setCookie = await cookie.serialize({ hello: "mjackson" });
    let value = await cookie.parse(getCookieFromSetCookie(setCookie));

    expect(value).toMatchInlineSnapshot(`
      {
        "hello": "mjackson",
      }
    `);

    // A new secret enters the rotation...
    cookie = createCookie("my-cookie", {
      secrets: ["secret2", "secret1"],
    });

    // cookie should still be able to parse old cookies.
    let oldValue = await cookie.parse(getCookieFromSetCookie(setCookie));
    expect(oldValue).toMatchObject(value);

    // New Set-Cookie should be different, it uses a differet secret.
    let setCookie2 = await cookie.serialize(value);
    expect(setCookie).not.toEqual(setCookie2);
  });

  it("supports encryption key rotation", async () => {
    let cookie = createCookie("my-cookie", {
      secrets: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      encrypt: true,
    });
    let setCookie = await cookie.serialize({ hello: "mjackson" });
    let value = await cookie.parse(getCookieFromSetCookie(setCookie));

    expect(value).toMatchInlineSnapshot(`
      {
        "hello": "mjackson",
      }
    `);

    // A new secret enters the rotation...
    cookie = createCookie("my-cookie", {
      secrets: [
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ],
      encrypt: true,
    });

    // cookie should still be able to parse old cookies.
    let oldValue = await cookie.parse(getCookieFromSetCookie(setCookie));
    expect(oldValue).toMatchObject(value);

    // New Set-Cookie should be different, it uses a differet secret.
    let setCookie2 = await cookie.serialize(value);
    expect(setCookie).not.toEqual(setCookie2);
  });

  it("makes the default secrets to be an empty array", async () => {
    let cookie = createCookie("my-cookie");

    expect(cookie.isSigned).toBe(false);

    let cookie2 = createCookie("my-cookie2", {
      secrets: undefined,
    });

    expect(cookie2.isSigned).toBe(false);
  });

  it("makes the default path of cookies to be /", async () => {
    let cookie = createCookie("my-cookie");

    let setCookie = await cookie.serialize("hello world");
    expect(setCookie).toContain("Path=/");

    let cookie2 = createCookie("my-cookie2");

    let setCookie2 = await cookie2.serialize("hello world", {
      path: "/about",
    });
    expect(setCookie2).toContain("Path=/about");
  });

  it("supports the Priority attribute", async () => {
    let cookie = createCookie("my-cookie");

    let setCookie = await cookie.serialize("hello world");
    expect(setCookie).not.toContain("Priority");

    let cookie2 = createCookie("my-cookie2");

    let setCookie2 = await cookie2.serialize("hello world", {
      priority: "high",
    });
    expect(setCookie2).toContain("Priority=High");
  });

  describe("warnings when providing options you may not want to", () => {
    let spy = spyConsole();

    it("warns against using `expires` when creating the cookie instance", async () => {
      createCookie("my-cookie", { expires: new Date(Date.now() + 60_000) });
      expect(spy.console).toHaveBeenCalledTimes(1);
      expect(spy.console).toHaveBeenCalledWith(
        'The "my-cookie" cookie has an "expires" property set. This will cause the expires value to not be updated when the session is committed. Instead, you should set the expires value when serializing the cookie. You can use `commitSession(session, { expires })` if using a session storage object, or `cookie.serialize("value", { expires })` if you\'re using the cookie directly.'
      );
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
