import { generatePath } from "react-router";

describe("generatePath", () => {
  describe("with no params", () => {
    it("returns the unmodified path", () => {
      expect(generatePath("/")).toBe("/");
      expect(generatePath("/courses")).toBe("/courses");
    });
  });

  describe("with params", () => {
    it("returns the path without those params interpolated", () => {
      expect(generatePath("/courses/:id", { id: "routing" })).toBe(
        "/courses/routing"
      );
      expect(
        generatePath("/courses/:id/student/:studentId", {
          id: "routing",
          studentId: "matt",
        })
      ).toBe("/courses/routing/student/matt");
      expect(generatePath("/courses/*", { "*": "routing/grades" })).toBe(
        "/courses/routing/grades"
      );
      expect(generatePath("*", { "*": "routing/grades" })).toBe(
        "routing/grades"
      );
      expect(generatePath("/*", {})).toBe("/");
    });
    it("handles * in parameter values", () => {
      expect(generatePath("/courses/:name", { name: "foo*" })).toBe(
        "/courses/foo*"
      );
      expect(generatePath("/courses/:name", { name: "*foo" })).toBe(
        "/courses/*foo"
      );
      expect(generatePath("/courses/:name", { name: "*f*oo*" })).toBe(
        "/courses/*f*oo*"
      );
      expect(
        generatePath("/courses/:name", {
          name: "foo*",
          "*": "splat_should_not_be_added",
        })
      ).toBe("/courses/foo*");
    });
    it("handles a 0 parameter", () => {
      // @ts-expect-error
      // incorrect usage but worked in 6.3.0 so keep it to avoid the regression
      expect(generatePath("/courses/:id", { id: 0 })).toBe("/courses/0");
      // @ts-expect-error
      // incorrect usage but worked in 6.3.0 so keep it to avoid the regression
      expect(generatePath("/courses/*", { "*": 0 })).toBe("/courses/0");
    });

    it("handles dashes in dynamic params", () => {
      expect(generatePath("/courses/:foo-bar", { "foo-bar": "baz" })).toBe(
        "/courses/baz"
      );
    });
    it("handles slashes in dynamic params", () => {
      expect(generatePath("/courses/:id", { id: "foo/bar" })).toBe(
        "/courses/foo%2Fbar"
      );
    });
  });

  describe("with extraneous params", () => {
    it("ignores them", () => {
      expect(generatePath("/", { course: "routing" })).toBe("/");
      expect(generatePath("/courses", { course: "routing" })).toBe("/courses");
    });
  });

  describe("with missing params", () => {
    it("throws an error", () => {
      expect(() => {
        generatePath("/:lang/login", {});
      }).toThrow(/Missing ":lang" param/);
    });
  });

  describe("with a missing splat", () => {
    it("omits the splat and trims the trailing slash", () => {
      expect(generatePath("/courses/*", {})).toBe("/courses");
    });
  });

  describe("with optional params", () => {
    it("adds optional dynamic params where appropriate", () => {
      let path = "/:one?/:two?/:three?";
      expect(generatePath(path, { one: "uno" })).toBe("/uno");
      expect(generatePath(path, { one: "uno", two: "dos" })).toBe("/uno/dos");
      expect(
        generatePath(path, {
          one: "uno",
          two: "dos",
          three: "tres",
        })
      ).toBe("/uno/dos/tres");
      expect(generatePath(path, { one: "uno", three: "tres" })).toBe(
        "/uno/tres"
      );
      expect(generatePath(path, { two: "dos" })).toBe("/dos");
      expect(generatePath(path, { two: "dos", three: "tres" })).toBe(
        "/dos/tres"
      );
    });

    it("strips optional aspects of static segments", () => {
      expect(generatePath("/one?/two?/:three?", {})).toBe("/one/two");
      expect(generatePath("/one?/two?/:three?", { three: "tres" })).toBe(
        "/one/two/tres"
      );
    });

    it("handles intermixed segments", () => {
      let path = "/one?/:two?/three/:four/*";
      expect(generatePath(path, { four: "cuatro" })).toBe("/one/three/cuatro");
      expect(
        generatePath(path, {
          two: "dos",
          four: "cuatro",
        })
      ).toBe("/one/dos/three/cuatro");
      expect(
        generatePath(path, {
          two: "dos",
          four: "cuatro",
          "*": "splat",
        })
      ).toBe("/one/dos/three/cuatro/splat");
      expect(
        generatePath(path, {
          two: "dos",
          four: "cuatro",
          "*": "splat/and/then/some",
        })
      ).toBe("/one/dos/three/cuatro/splat/and/then/some");
    });
  });

  it("throws only on on missing named parameters, but not missing splat params", () => {
    expect(() => generatePath(":foo")).toThrow();
    expect(() => generatePath("/:foo")).toThrow();
    expect(() => generatePath("*")).not.toThrow();
    expect(() => generatePath("/*")).not.toThrow();
  });

  it("only interpolates and does not add slashes", () => {
    let consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    expect(generatePath("*")).toBe("");
    expect(generatePath("/*")).toBe("/");

    expect(generatePath("foo*")).toBe("foo");
    expect(generatePath("/foo*")).toBe("/foo");

    expect(generatePath(":foo", { foo: "bar" })).toBe("bar");
    expect(generatePath("/:foo", { foo: "bar" })).toBe("/bar");

    expect(generatePath("*", { "*": "bar" })).toBe("bar");
    expect(generatePath("/*", { "*": "bar" })).toBe("/bar");

    // No support for partial dynamic params
    expect(generatePath("foo:bar", { bar: "baz" })).toBe("foo:bar");
    expect(generatePath("/foo:bar", { bar: "baz" })).toBe("/foo:bar");

    // Partial splats are treated as independent path segments
    expect(generatePath("foo*", { "*": "bar" })).toBe("foo/bar");
    expect(generatePath("/foo*", { "*": "bar" })).toBe("/foo/bar");

    // Ensure we warn on partial splat usages
    expect(consoleWarn.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "Route path "foo*" will be treated as if it were "foo/*" because the \`*\` character must always follow a \`/\` in the pattern. To get rid of this warning, please change the route path to "foo/*".",
        ],
        [
          "Route path "/foo*" will be treated as if it were "/foo/*" because the \`*\` character must always follow a \`/\` in the pattern. To get rid of this warning, please change the route path to "/foo/*".",
        ],
        [
          "Route path "foo*" will be treated as if it were "foo/*" because the \`*\` character must always follow a \`/\` in the pattern. To get rid of this warning, please change the route path to "foo/*".",
        ],
        [
          "Route path "/foo*" will be treated as if it were "/foo/*" because the \`*\` character must always follow a \`/\` in the pattern. To get rid of this warning, please change the route path to "/foo/*".",
        ],
      ]
    `);

    consoleWarn.mockRestore();
  });
});
