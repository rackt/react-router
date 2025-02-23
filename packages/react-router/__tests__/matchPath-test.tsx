import { matchPath } from "react-router";

describe("matchPath", () => {
  it("matches the root / URL", () => {
    expect(matchPath("/", "/")).toMatchObject({
      pathname: "/",
      pathnameBase: "/",
    });
  });

  describe("when the pattern has no leading slash", () => {
    it("fails to match a pathname that does not match", () => {
      expect(matchPath("users", "/usersblah")).toBeNull();
    });

    it("matches a pathname", () => {
      expect(matchPath("users", "/users")).toMatchObject({
        pathname: "/users",
        pathnameBase: "/users",
      });
    });

    it("matches a pathname with multiple segments", () => {
      expect(matchPath("users/mj", "/users/mj")).toMatchObject({
        pathname: "/users/mj",
        pathnameBase: "/users/mj",
      });
    });

    it("matches a pathname with a trailing slash", () => {
      expect(matchPath("users", "/users/")).toMatchObject({
        pathname: "/users/",
        pathnameBase: "/users",
      });
    });

    it("matches a pathname with multiple segments and a trailing slash", () => {
      expect(matchPath("users/mj", "/users/mj/")).toMatchObject({
        pathname: "/users/mj/",
        pathnameBase: "/users/mj",
      });
    });
  });

  describe("when the pattern has a leading slash", () => {
    it("fails to match a pathname that does not match", () => {
      expect(matchPath("/users", "/usersblah")).toBeNull();
    });

    it("matches a pathname", () => {
      expect(matchPath("/users", "/users")).toMatchObject({
        pathname: "/users",
        pathnameBase: "/users",
      });
    });

    it("matches a pathname with multiple segments", () => {
      expect(matchPath("/users/mj", "/users/mj")).toMatchObject({
        pathname: "/users/mj",
        pathnameBase: "/users/mj",
      });
    });

    it("matches a pathname with a trailing slash", () => {
      expect(matchPath("/users", "/users/")).toMatchObject({
        pathname: "/users/",
        pathnameBase: "/users",
      });
    });

    it("matches a pathname with multiple segments and a trailing slash", () => {
      expect(matchPath("/users/mj", "/users/mj/")).toMatchObject({
        pathname: "/users/mj/",
        pathnameBase: "/users/mj",
      });
    });
  });

  describe("when the pattern has a trailing slash", () => {
    it("fails to match a pathname that does not match", () => {
      expect(matchPath("users/", "/usersblah")).toBeNull();
    });

    it("matches a pathname", () => {
      expect(matchPath("users/", "/users")).toMatchObject({
        pathname: "/users",
        pathnameBase: "/users",
      });
    });

    it("matches a pathname with multiple segments", () => {
      expect(matchPath("users/mj/", "/users/mj")).toMatchObject({
        pathname: "/users/mj",
        pathnameBase: "/users/mj",
      });
    });

    it("matches a pathname with a trailing slash", () => {
      expect(matchPath("users/", "/users/")).toMatchObject({
        pathname: "/users/",
        pathnameBase: "/users",
      });
    });

    it("matches a pathname with multiple segments and a trailing slash", () => {
      expect(matchPath("users/mj/", "/users/mj/")).toMatchObject({
        pathname: "/users/mj/",
        pathnameBase: "/users/mj",
      });
    });
  });

  describe("with { end: false }", () => {
    it("matches the beginning of a pathname", () => {
      expect(matchPath({ path: "/users", end: false }, "/users")).toMatchObject(
        { pathname: "/users", pathnameBase: "/users" }
      );
      expect(
        matchPath({ path: "/users/", end: false }, "/users")
      ).toMatchObject({
        pathname: "/users",
        pathnameBase: "/users",
      });
    });

    it("matches the beginning of a pathname with a trailing slash", () => {
      expect(
        matchPath({ path: "/users", end: false }, "/users/")
      ).toMatchObject({ pathname: "/users", pathnameBase: "/users" });
      expect(
        matchPath({ path: "/users/", end: false }, "/users/")
      ).toMatchObject({
        pathname: "/users",
        pathnameBase: "/users",
      });
    });

    it("matches the beginning of a pathname with multiple segments", () => {
      expect(
        matchPath({ path: "/users", end: false }, "/users/mj")
      ).toMatchObject({ pathname: "/users", pathnameBase: "/users" });
      expect(
        matchPath({ path: "/users/", end: false }, "/users/mj")
      ).toMatchObject({ pathname: "/users", pathnameBase: "/users" });
    });

    it("matches the beginning of a pathname with multiple segments and a trailing slash", () => {
      expect(
        matchPath({ path: "/users", end: false }, "/users/mj/")
      ).toMatchObject({ pathname: "/users", pathnameBase: "/users" });
      expect(
        matchPath({ path: "/users/", end: false }, "/users/mj/")
      ).toMatchObject({ pathname: "/users", pathnameBase: "/users" });
    });

    it("fails to match a pathname where the segments do not match", () => {
      expect(matchPath({ path: "/users", end: false }, "/")).toBeNull();
      expect(matchPath({ path: "/users", end: false }, "/users2")).toBeNull();
      expect(matchPath({ path: "/users", end: false }, "/users-2")).toBeNull();
      expect(matchPath({ path: "/users", end: false }, "/users~2")).toBeNull();
      expect(matchPath({ path: "/users", end: false }, "/users@2")).toBeNull();
      expect(matchPath({ path: "/users", end: false }, "/users.2")).toBeNull();
      expect(
        matchPath({ path: "/users/mj", end: false }, "/users/mj2")
      ).toBeNull();
    });
  });

  describe("with { end: false } and a / pattern", () => {
    it("matches a pathname", () => {
      expect(matchPath({ path: "/", end: false }, "/users")).toMatchObject({
        pathname: "/",
        pathnameBase: "/",
      });
    });

    it("matches a pathname with multiple segments", () => {
      expect(matchPath({ path: "/", end: false }, "/users/mj")).toMatchObject({
        pathname: "/",
        pathnameBase: "/",
      });
    });

    it("matches a pathname with a trailing slash", () => {
      expect(matchPath({ path: "/", end: false }, "/users/")).toMatchObject({
        pathname: "/",
        pathnameBase: "/",
      });
    });

    it("matches a pathname with multiple segments and a trailing slash", () => {
      expect(matchPath({ path: "/", end: false }, "/users/mj/")).toMatchObject({
        pathname: "/",
        pathnameBase: "/",
      });
    });
  });

  it("is not case-sensitive by default", () => {
    expect(matchPath("/SystemDashboard", "/systemdashboard")).toMatchObject({
      pathname: "/systemdashboard",
      pathnameBase: "/systemdashboard",
    });
  });

  it("matches a case-sensitive pathname", () => {
    expect(
      matchPath(
        { path: "/SystemDashboard", caseSensitive: true },
        "/SystemDashboard"
      )
    ).toMatchObject({
      pathname: "/SystemDashboard",
      pathnameBase: "/SystemDashboard",
    });
  });

  it("does not match a case-sensitive pathname with the wrong case", () => {
    expect(
      matchPath(
        { path: "/SystemDashboard", caseSensitive: true },
        "/systemDashboard"
      )
    ).toBeNull();
  });

  describe("when the pattern has a trailing /*", () => {
    it("matches the remaining portion of the pathname", () => {
      expect(matchPath("/files/*", "/files/mj.jpg")).toMatchObject({
        params: { "*": "mj.jpg" },
        pathname: "/files/mj.jpg",
        pathnameBase: "/files",
      });
      expect(matchPath("/files/*", "/files/")).toMatchObject({
        params: { "*": "" },
        pathname: "/files/",
        pathnameBase: "/files",
      });
      expect(matchPath("/files/*", "/files")).toMatchObject({
        params: { "*": "" },
        pathname: "/files",
        pathnameBase: "/files",
      });
    });
  });
});

describe("matchPath optional dynamic segments", () => {
  it("should match when optional segment is provided", () => {
    const match = matchPath("/:lang?/user/:id", "/en/user/123");
    expect(match).toMatchObject({ params: { lang: "en", id: "123" } });
  });

  it("should match when optional segment is *not* provided", () => {
    const match = matchPath("/:lang?/user/:id", "/user/123");
    expect(match).toMatchObject({ params: { lang: undefined, id: "123" } });
  });

  it("should match when middle optional segment is provided", () => {
    const match = matchPath("/user/:lang?/:id", "/user/en/123");
    expect(match).toMatchObject({ params: { lang: "en", id: "123" } });
  });

  it("should match when middle optional segment is *not* provided", () => {
    const match = matchPath("/user/:lang?/:id", "/user/123");
    expect(match).toMatchObject({ params: { lang: undefined, id: "123" } });
  });

  it("should match when end optional segment is provided", () => {
    const match = matchPath("/user/:id/:lang?", "/user/123/en");
    expect(match).toMatchObject({ params: { lang: "en", id: "123" } });
  });

  it("should match when end optional segment is *not* provided", () => {
    const match = matchPath("/user/:id/:lang?", "/user/123");
    expect(match).toMatchObject({ params: { lang: undefined, id: "123" } });
  });

  it("should match multiple optional segments and none are provided", () => {
    const match = matchPath("/:lang?/user/:id?", "/user");
    expect(match).toMatchObject({ params: { lang: undefined, id: undefined } });
  });

  it("should match multiple optional segments and one is provided", () => {
    const match = matchPath("/:lang?/user/:id?", "/en/user");
    expect(match).toMatchObject({ params: { lang: "en", id: undefined } });
  });

  it("should match multiple optional segments and all are provided", () => {
    const match = matchPath("/:lang?/user/:id?", "/en/user/123");
    expect(match).toMatchObject({ params: { lang: "en", id: "123" } });
  });
});

describe("matchPath optional static segments", () => {
  it("should match when optional segment is provided", () => {
    const match = matchPath("/school?/user/:id", "/school/user/123");
    expect(match).toMatchObject({
      pathname: "/school/user/123",
      pathnameBase: "/school/user/123",
    });
  });

  it("should match when optional segment is *not* provided", () => {
    const match = matchPath("/school?/user/:id", "/user/123");
    expect(match).toMatchObject({
      pathname: "/user/123",
      pathnameBase: "/user/123",
    });
  });

  it("should match when middle optional segment is provided", () => {
    const match = matchPath("/school/user?/:id", "/school/user/123");
    expect(match).toMatchObject({
      pathname: "/school/user/123",
      pathnameBase: "/school/user/123",
    });
  });

  it("should match when middle optional segment is *not* provided", () => {
    const match = matchPath("/school/user?/:id", "/school/123");
    expect(match).toMatchObject({
      pathname: "/school/123",
      pathnameBase: "/school/123",
    });
  });

  it("should match when end optional segment is provided", () => {
    const match = matchPath("/school/user/admin?", "/school/user/admin");
    expect(match).toMatchObject({
      pathname: "/school/user/admin",
      pathnameBase: "/school/user/admin",
    });
  });

  it("should match when end optional segment is *not* provided", () => {
    const match = matchPath("/school/user/admin?", "/school/user");
    expect(match).toMatchObject({
      pathname: "/school/user",
      pathnameBase: "/school/user",
    });
  });

  it("should match multiple optional segments and none are provided", () => {
    const match = matchPath("/school?/user/admin?", "/user");
    expect(match).toMatchObject({
      pathname: "/user",
      pathnameBase: "/user",
    });
  });

  it("should match multiple optional segments and one is provided", () => {
    const match = matchPath("/school?/user/admin?", "/user/admin");
    expect(match).toMatchObject({
      pathname: "/user/admin",
      pathnameBase: "/user/admin",
    });
  });

  it("should match multiple optional segments and all are provided", () => {
    const match = matchPath("/school?/user/admin?", "/school/user/admin");
    expect(match).toMatchObject({
      pathname: "/school/user/admin",
      pathnameBase: "/school/user/admin",
    });
  });
});

describe("matchPath *", () => {
  it("matches the root URL", () => {
    expect(matchPath("*", "/")).toMatchObject({
      pathname: "/",
      pathnameBase: "/",
    });
    expect(matchPath("/*", "/")).toMatchObject({
      pathname: "/",
      pathnameBase: "/",
    });
  });

  it("matches a URL with a segment", () => {
    expect(matchPath("*", "/users")).toMatchObject({
      pathname: "/users",
      pathnameBase: "/",
    });
    expect(matchPath("/*", "/users")).toMatchObject({
      pathname: "/users",
      pathnameBase: "/",
    });
  });

  it("matches a URL with a segment and a trailing slash", () => {
    expect(matchPath("*", "/users/")).toMatchObject({
      pathname: "/users/",
      pathnameBase: "/",
    });
    expect(matchPath("/*", "/users/")).toMatchObject({
      pathname: "/users/",
      pathnameBase: "/",
    });
  });

  it("matches a URL with multiple segments", () => {
    expect(matchPath("*", "/users/mj")).toMatchObject({
      pathname: "/users/mj",
      pathnameBase: "/",
    });
    expect(matchPath("/*", "/users/mj")).toMatchObject({
      pathname: "/users/mj",
      pathnameBase: "/",
    });
  });

  it("matches a URL with multiple segments and a trailing slash", () => {
    expect(matchPath("*", "/users/mj/")).toMatchObject({
      pathname: "/users/mj/",
      pathnameBase: "/",
    });
    expect(matchPath("/*", "/users/mj/")).toMatchObject({
      pathname: "/users/mj/",
      pathnameBase: "/",
    });
  });

  it("resolves params containing '*' correctly", () => {
    expect(matchPath("/users/:name/*", "/users/foo*/splat")).toMatchObject({
      params: { name: "foo*", "*": "splat" },
      pathname: "/users/foo*/splat",
      pathnameBase: "/users/foo*",
    });
  });
});

describe("matchPath warnings", () => {
  let consoleWarn: jest.SpyInstance<void, any>;
  beforeEach(() => {
    consoleWarn = jest.spyOn(console, "warn").mockImplementation();
  });

  afterEach(() => {
    consoleWarn.mockRestore();
  });

  describe("when the pattern has a trailing *", () => {
    it("issues a warning and matches the remaining portion of the pathname", () => {
      expect(matchPath("/files*", "/files/mj.jpg")).toMatchObject({
        params: { "*": "mj.jpg" },
        pathname: "/files/mj.jpg",
        pathnameBase: "/files",
      });
      expect(consoleWarn).toHaveBeenCalledTimes(1);

      expect(matchPath("/files*", "/files/")).toMatchObject({
        params: { "*": "" },
        pathname: "/files/",
        pathnameBase: "/files",
      });
      expect(consoleWarn).toHaveBeenCalledTimes(2);

      expect(matchPath("/files*", "/files")).toMatchObject({
        params: { "*": "" },
        pathname: "/files",
        pathnameBase: "/files",
      });
      expect(consoleWarn).toHaveBeenCalledTimes(3);
    });
  });
});
