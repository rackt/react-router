import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fse from "fs-extra";
import semver from "semver";
import stripAnsi from "strip-ansi";

import { jestTimeout } from "./setupAfterEnv";
import { createReactRouter } from "../index";
import { server } from "./msw";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

// this is so we can mock "npm install" etc. in a cross-platform way
jest.mock("execa");

const DOWN = "\x1B\x5B\x42";
const ENTER = "\x0D";

const TEMP_DIR = path.join(
  fse.realpathSync(tmpdir()),
  `react-router-tests-${Math.random().toString(32).slice(2)}`
);
function maskTempDir(string: string) {
  return string.replace(TEMP_DIR, "<TEMP_DIR>");
}

jest.setTimeout(30_000);
beforeAll(async () => {
  await fse.remove(TEMP_DIR);
  await fse.ensureDir(TEMP_DIR);
});

afterAll(async () => {
  await fse.remove(TEMP_DIR);
});

describe("create-react-router CLI", () => {
  let tempDirs = new Set<string>();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    for (let dir of tempDirs) {
      await fse.remove(dir);
    }
    tempDirs = new Set<string>();
  });

  function getProjectDir(name: string) {
    let tmpDir = path.join(TEMP_DIR, name);
    tempDirs.add(tmpDir);
    return tmpDir;
  }

  it("supports the --help flag", async () => {
    let { stdout } = await execCreateReactRouter({
      args: ["--help"],
    });
    expect(stdout.trim()).toMatchInlineSnapshot(`
      "create-react-router  

      Usage:

      $ create-react-router <projectDir> <...options>

      Values:

      projectDir          The React Router project directory

      Options:

      --help, -h          Print this help message and exit
      --version, -V       Print the CLI version and exit
      --no-color          Disable ANSI colors in console output
      --no-motion         Disable animations in console output

      --template <name>   The project template to use
      --[no-]install      Whether or not to install dependencies after creation
      --package-manager   The package manager to use
      --show-install-output   Whether to show the output of the install process
      --[no-]git-init     Whether or not to initialize a Git repository
      --yes, -y           Skip all option prompts and run setup
      --react-router-version, -v     The version of React Router to use

      Creating a new project:

      React Router projects are created from templates. A template can be:

      - a GitHub repo shorthand, :username/:repo or :username/:repo/:directory
      - the URL of a GitHub repo (or directory within it)
      - the URL of a tarball
      - a file path to a directory of files
      - a file path to a tarball

      $ create-react-router my-app --template remix-run/react-router/templates/basic
      $ create-react-router my-app --template remix-run/react-router/examples/basic
      $ create-react-router my-app --template :username/:repo
      $ create-react-router my-app --template :username/:repo/:directory
      $ create-react-router my-app --template https://github.com/:username/:repo
      $ create-react-router my-app --template https://github.com/:username/:repo/tree/:branch
      $ create-react-router my-app --template https://github.com/:username/:repo/tree/:branch/:directory
      $ create-react-router my-app --template https://github.com/:username/:repo/archive/refs/tags/:tag.tar.gz
      $ create-react-router my-app --template https://example.com/template.tar.gz
      $ create-react-router my-app --template ./path/to/template
      $ create-react-router my-app --template ./path/to/template.tar.gz

      To create a new project from a template in a private GitHub repo,
      pass the \`token\` flag with a personal access token with access
      to that repo."
    `);
  });

  it("supports the --version flag", async () => {
    let { stdout } = await execCreateReactRouter({
      args: ["--version"],
    });
    expect(!!semver.valid(stdout.trim())).toBe(true);
  });

  it("allows you to go through the prompts", async () => {
    let projectDir = getProjectDir("prompts");

    let { status, stderr } = await execCreateReactRouter({
      args: [],
      interactions: [
        {
          question: /where.*create.*project/i,
          type: [projectDir, ENTER],
        },
        {
          question: /init.*git/i,
          type: ["n"],
        },
        {
          question: /install dependencies/i,
          type: ["n"],
        },
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeTruthy();
  });

  it("supports the --yes flag", async () => {
    let projectDir = getProjectDir("yes");

    let { status, stderr } = await execCreateReactRouter({
      args: [projectDir, "--yes", "--no-git-init", "--no-install"],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeTruthy();
  });

  it("errors when project directory isn't provided when shell isn't interactive", async () => {
    let projectDir = getProjectDir("non-interactive-no-project-dir");

    let { status, stderr } = await execCreateReactRouter({
      args: ["--no-install"],
      interactive: false,
    });

    expect(stderr.trim()).toMatchInlineSnapshot(
      `"▲  Oh no! No project directory provided"`
    );
    expect(status).toBe(1);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeFalsy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeFalsy();
  });

  it("works for GitHub username/repo combo", async () => {
    let projectDir = getProjectDir("github-username-repo");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        "react-router-fake-tester-username/react-router-fake-tester-repo",
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeTruthy();
  });

  it("works for GitHub username/repo/path combo", async () => {
    let projectDir = getProjectDir("github-username-repo-path");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        "fake-react-router-tester/nested-dir/stack",
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeTruthy();
  });

  it("works for GitHub username/repo/path combo (when dots exist in folder)", async () => {
    let projectDir = getProjectDir("github-username-repo-path-dots");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        "fake-react-router-tester/nested-dir/folder.with.dots",
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeTruthy();
  });

  it("fails for GitHub username/repo/path combo when path doesn't exist", async () => {
    let projectDir = getProjectDir("github-username-repo-path-missing");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        "fake-react-router-tester/nested-dir/this/path/does/not/exist",
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toMatchInlineSnapshot(
      `"▲  Oh no! The path "this/path/does/not/exist" was not found in this GitHub repo."`
    );
    expect(status).toBe(1);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeFalsy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeFalsy();
  });

  it("fails for private GitHub username/repo combo without a token", async () => {
    let projectDir = getProjectDir("private-repo-no-token");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        "private-org/private-repo",
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toMatchInlineSnapshot(
      `"▲  Oh no! There was a problem fetching the file from GitHub. The request responded with a 404 status. Please try again later."`
    );
    expect(status).toBe(1);
  });

  it("succeeds for private GitHub username/repo combo with a valid token", async () => {
    let projectDir = getProjectDir("github-username-repo-with-token");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        "private-org/private-repo",
        "--no-git-init",
        "--no-install",
        "--token",
        "valid-token",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeTruthy();
  });

  it("works for remote tarballs", async () => {
    let projectDir = getProjectDir("remote-tarball");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        "https://example.com/template.tar.gz",
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeTruthy();
  });

  it("fails for private github release tarballs", async () => {
    let projectDir = getProjectDir("private-release-tarball-no-token");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        "https://github.com/private-org/private-repo/releases/download/v0.0.1/template.tar.gz",
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toMatchInlineSnapshot(
      `"▲  Oh no! There was a problem fetching the file from GitHub. The request responded with a 404 status. Please try again later."`
    );
    expect(status).toBe(1);
  });

  it("succeeds for private github release tarballs when including token", async () => {
    let projectDir = getProjectDir("private-release-tarball-with-token");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        "https://github.com/private-org/private-repo/releases/download/v0.0.1/template.tar.gz",
        "--token",
        "valid-token",
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeTruthy();
  });

  it("works for different branches and nested paths", async () => {
    let projectDir = getProjectDir("diff-branch");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        "https://github.com/fake-react-router-tester/nested-dir/tree/dev/stack",
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeTruthy();
  });

  it("fails for different branches and nested paths when path doesn't exist", async () => {
    let projectDir = getProjectDir("diff-branch-invalid-path");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        "https://github.com/fake-react-router-tester/nested-dir/tree/dev/this/path/does/not/exist",
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toMatchInlineSnapshot(
      `"▲  Oh no! The path "this/path/does/not/exist" was not found in this GitHub repo."`
    );
    expect(status).toBe(1);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeFalsy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeFalsy();
  });

  it("works for a path to a tarball on disk", async () => {
    let projectDir = getProjectDir("local-tarball");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        path.join(__dirname, "fixtures", "template.tar.gz"),
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeTruthy();
  });

  it("works for a path to a tgz tarball on disk", async () => {
    let projectDir = getProjectDir("local-tarball");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        path.join(__dirname, "fixtures", "template.tgz"),
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(projectDir, "app/root.tsx"))).toBeTruthy();
  });

  it("works for a file URL to a tarball on disk", async () => {
    let projectDir = getProjectDir("file-url-tarball");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        pathToFileURL(
          path.join(__dirname, "fixtures", "template.tar.gz")
        ).toString(),
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
  });

  it("works for a file path to a directory on disk", async () => {
    let projectDir = getProjectDir("local-directory");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        path.join(__dirname, "fixtures", "blank"),
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
  });

  it("works for a file URL to a directory on disk", async () => {
    let projectDir = getProjectDir("file-url-directory");

    let { status, stderr } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        pathToFileURL(path.join(__dirname, "fixtures", "blank")).toString(),
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(projectDir, "package.json"))).toBeTruthy();
  });

  it("runs npm install by default", async () => {
    let originalUserAgent = process.env.npm_config_user_agent;
    process.env.npm_config_user_agent = undefined;

    let projectDir = getProjectDir("npm-install-default");

    let execa = require("execa");
    execa.mockImplementation(async () => {});

    // Suppress terminal output
    let stdoutMock = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await createReactRouter([
      projectDir,
      "--template",
      path.join(__dirname, "fixtures", "blank"),
      "--no-git-init",
      "--yes",
    ]);

    stdoutMock.mockReset();

    expect(execa).toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["install"]),
      expect.anything()
    );

    process.env.npm_config_user_agent = originalUserAgent;
  });

  it("runs npm install if package manager in user agent string is unknown", async () => {
    let originalUserAgent = process.env.npm_config_user_agent;
    process.env.npm_config_user_agent =
      "unknown_package_manager/1.0.0 npm/? node/v14.17.0 linux x64";

    let projectDir = getProjectDir("npm-install-on-unknown-package-manager");

    let execa = require("execa");
    execa.mockImplementation(async () => {});

    // Suppress terminal output
    let stdoutMock = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await createReactRouter([
      projectDir,
      "--template",
      path.join(__dirname, "fixtures", "blank"),
      "--no-git-init",
      "--yes",
    ]);

    stdoutMock.mockReset();

    expect(execa).toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["install"]),
      expect.anything()
    );

    process.env.npm_config_user_agent = originalUserAgent;
  });

  it("recognizes when npm was used to run the command", async () => {
    let originalUserAgent = process.env.npm_config_user_agent;
    process.env.npm_config_user_agent =
      "npm/8.19.4 npm/? node/v14.17.0 linux x64";

    let projectDir = getProjectDir("npm-install-from-user-agent");

    let execa = require("execa");
    execa.mockImplementation(async () => {});

    // Suppress terminal output
    let stdoutMock = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await createReactRouter([
      projectDir,
      "--template",
      path.join(__dirname, "fixtures", "blank"),
      "--no-git-init",
      "--yes",
    ]);

    stdoutMock.mockReset();

    expect(execa).toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["install"]),
      expect.anything()
    );
    process.env.npm_config_user_agent = originalUserAgent;
  });

  it("recognizes when Yarn was used to run the command", async () => {
    let originalUserAgent = process.env.npm_config_user_agent;
    process.env.npm_config_user_agent =
      "yarn/1.22.18 npm/? node/v14.17.0 linux x64";

    let projectDir = getProjectDir("yarn-create-from-user-agent");

    let execa = require("execa");
    execa.mockImplementation(async () => {});

    // Suppress terminal output
    let stdoutMock = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await createReactRouter([
      projectDir,
      "--template",
      path.join(__dirname, "fixtures", "blank"),
      "--no-git-init",
      "--yes",
    ]);

    stdoutMock.mockReset();

    expect(execa).toHaveBeenCalledWith(
      "yarn",
      expect.arrayContaining(["install"]),
      expect.anything()
    );
    process.env.npm_config_user_agent = originalUserAgent;
  });

  it("recognizes when pnpm was used to run the command", async () => {
    let originalUserAgent = process.env.npm_config_user_agent;
    process.env.npm_config_user_agent =
      "pnpm/6.32.3 npm/? node/v14.17.0 linux x64";

    let projectDir = getProjectDir("pnpm-create-from-user-agent");

    let execa = require("execa");
    execa.mockImplementation(async () => {});

    // Suppress terminal output
    let stdoutMock = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await createReactRouter([
      projectDir,
      "--template",
      path.join(__dirname, "fixtures", "blank"),
      "--no-git-init",
      "--yes",
    ]);

    stdoutMock.mockReset();

    expect(execa).toHaveBeenCalledWith(
      "pnpm",
      expect.arrayContaining(["install"]),
      expect.anything()
    );
    process.env.npm_config_user_agent = originalUserAgent;
  });

  it("recognizes when Bun was used to run the command", async () => {
    let originalUserAgent = process.env.npm_config_user_agent;
    process.env.npm_config_user_agent =
      "bun/0.7.0 npm/? node/v14.17.0 linux x64";

    let projectDir = getProjectDir("bun-create-from-user-agent");

    let execa = require("execa");
    execa.mockImplementation(async () => {});

    // Suppress terminal output
    let stdoutMock = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await createReactRouter([
      projectDir,
      "--template",
      path.join(__dirname, "fixtures", "blank"),
      "--no-git-init",
      "--yes",
    ]);

    stdoutMock.mockReset();

    expect(execa).toHaveBeenCalledWith(
      "bun",
      expect.arrayContaining(["install"]),
      expect.anything()
    );
    process.env.npm_config_user_agent = originalUserAgent;
  });

  it("recognizes when Deno was used to run the command", async () => {
    let originalUserAgent = process.env.npm_config_user_agent;
    process.env.npm_config_user_agent =
      "deno/2.0.6 npm/? deno/2.0.6 linux x86_64";

    let projectDir = getProjectDir("deno-create-from-user-agent");

    let execa = require("execa");
    execa.mockImplementation(async () => {});

    // Suppress terminal output
    let stdoutMock = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await createReactRouter([
      projectDir,
      "--template",
      path.join(__dirname, "fixtures", "blank"),
      "--no-git-init",
      "--yes",
    ]);

    stdoutMock.mockReset();

    expect(execa).toHaveBeenCalledWith(
      "deno",
      expect.arrayContaining(["install"]),
      expect.anything()
    );
    process.env.npm_config_user_agent = originalUserAgent;
  });

  it("supports specifying the package manager, regardless of user agent", async () => {
    let originalUserAgent = process.env.npm_config_user_agent;
    process.env.npm_config_user_agent =
      "yarn/1.22.18 npm/? node/v14.17.0 linux x64";

    let projectDir = getProjectDir("pnpm-create-override");

    let execa = require("execa");
    execa.mockImplementation(async () => {});

    // Suppress terminal output
    let stdoutMock = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await createReactRouter([
      projectDir,
      "--template",
      path.join(__dirname, "fixtures", "blank"),
      "--no-git-init",
      "--yes",
      "--package-manager",
      "pnpm",
    ]);

    stdoutMock.mockReset();

    expect(execa).toHaveBeenCalledWith(
      "pnpm",
      expect.arrayContaining(["install"]),
      expect.anything()
    );
    process.env.npm_config_user_agent = originalUserAgent;
  });

  it("works when creating an app in the current dir", async () => {
    let emptyDir = getProjectDir("current-dir-if-empty");
    fse.mkdirSync(emptyDir);

    let { status, stderr } = await execCreateReactRouter({
      cwd: emptyDir,
      args: [
        ".",
        "--template",
        path.join(__dirname, "fixtures", "basic"),
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(stderr.trim()).toBeFalsy();
    expect(status).toBe(0);
    expect(fse.existsSync(path.join(emptyDir, "package.json"))).toBeTruthy();
    expect(fse.existsSync(path.join(emptyDir, "app/root.tsx"))).toBeTruthy();
  });

  it("does not copy .git nor node_modules directories if they exist in the template", async () => {
    // Can't really commit this file into a git repo, so just create it as
    // part of the test and then remove it when we're done
    let templateWithIgnoredDirs = path.join(
      __dirname,
      "fixtures",
      "with-ignored-dir"
    );
    fse.mkdirSync(path.join(templateWithIgnoredDirs, ".git"));
    fse.createFileSync(
      path.join(templateWithIgnoredDirs, ".git", "some-git-file.txt")
    );
    fse.mkdirSync(path.join(templateWithIgnoredDirs, "node_modules"));
    fse.createFileSync(
      path.join(
        templateWithIgnoredDirs,
        "node_modules",
        "some-node-module-file.txt"
      )
    );

    let projectDir = getProjectDir("with-git-dir");

    try {
      let { status, stderr } = await execCreateReactRouter({
        args: [
          projectDir,
          "--template",
          templateWithIgnoredDirs,
          "--no-git-init",
          "--no-install",
        ],
      });

      expect(stderr.trim()).toBeFalsy();
      expect(status).toBe(0);
      expect(fse.existsSync(path.join(projectDir, ".git"))).toBeFalsy();
      expect(fse.existsSync(path.join(projectDir, "node_modules"))).toBeFalsy();
      expect(
        fse.existsSync(path.join(projectDir, "package.json"))
      ).toBeTruthy();
    } finally {
      fse.removeSync(path.join(templateWithIgnoredDirs, ".git"));
      fse.removeSync(path.join(templateWithIgnoredDirs, "node_modules"));
    }
  });

  it("changes star dependencies for only React Router packages", async () => {
    let projectDir = getProjectDir("local-directory");

    let { status } = await execCreateReactRouter({
      args: [
        projectDir,
        "--template",
        path.join(__dirname, "fixtures", "basic"),
        "--no-git-init",
        "--no-install",
      ],
    });

    expect(status).toBe(0);

    let packageJsonPath = path.join(projectDir, "package.json");
    let packageJson = JSON.parse(String(fse.readFileSync(packageJsonPath)));
    let dependencies = packageJson.dependencies;

    expect(dependencies).toMatchObject({
      "react-router": expect.any(String),
      "react-router-dom": expect.any(String),
      "@react-router/node": expect.any(String),
      "not-react-router": "*",
    });
  });

  describe("when project directory contains files", () => {
    describe("interactive shell", () => {
      let interactive = true;

      it("works without prompt when there are no collisions", async () => {
        let projectDir = getProjectDir("not-empty-dir-interactive");
        fse.mkdirSync(projectDir);
        fse.createFileSync(path.join(projectDir, "some-file.txt"));

        let { status, stderr } = await execCreateReactRouter({
          args: [
            projectDir,
            "--template",
            path.join(__dirname, "fixtures", "basic"),
            "--no-git-init",
            "--no-install",
          ],
          interactive,
        });

        expect(stderr.trim()).toBeFalsy();
        expect(status).toBe(0);
        expect(
          fse.existsSync(path.join(projectDir, "package.json"))
        ).toBeTruthy();
        expect(
          fse.existsSync(path.join(projectDir, "app/root.tsx"))
        ).toBeTruthy();
      });

      it("prompts for overwrite when there are collisions", async () => {
        let notEmptyDir = getProjectDir("not-empty-dir-interactive-collisions");
        fse.mkdirSync(notEmptyDir);
        fse.createFileSync(path.join(notEmptyDir, "package.json"));
        fse.createFileSync(path.join(notEmptyDir, "tsconfig.json"));

        let { status, stdout, stderr } = await execCreateReactRouter({
          args: [
            notEmptyDir,
            "--template",
            path.join(__dirname, "fixtures", "basic"),
            "--no-git-init",
            "--no-install",
          ],
          interactive,
          interactions: [
            {
              question: /contains files that will be overwritten/i,
              type: ["y"],
            },
          ],
        });

        expect(stdout).toContain("Files that would be overwritten:");
        expect(stdout).toContain("package.json");
        expect(stdout).toContain("tsconfig.json");
        expect(status).toBe(0);
        expect(stderr.trim()).toBeFalsy();
        expect(
          fse.existsSync(path.join(notEmptyDir, "package.json"))
        ).toBeTruthy();
        expect(
          fse.existsSync(path.join(notEmptyDir, "tsconfig.json"))
        ).toBeTruthy();
        expect(
          fse.existsSync(path.join(notEmptyDir, "app/root.tsx"))
        ).toBeTruthy();
      });

      it("works without prompt when --overwrite is specified", async () => {
        let projectDir = getProjectDir(
          "not-empty-dir-interactive-collisions-overwrite"
        );
        fse.mkdirSync(projectDir);
        fse.createFileSync(path.join(projectDir, "package.json"));
        fse.createFileSync(path.join(projectDir, "tsconfig.json"));

        let { status, stdout, stderr } = await execCreateReactRouter({
          args: [
            projectDir,
            "--template",
            path.join(__dirname, "fixtures", "basic"),
            "--overwrite",
            "--no-git-init",
            "--no-install",
          ],
        });

        expect(stdout).toContain(
          "Overwrite: overwriting files due to `--overwrite`"
        );
        expect(stdout).toContain("package.json");
        expect(stdout).toContain("tsconfig.json");
        expect(status).toBe(0);
        expect(stderr.trim()).toBeFalsy();
        expect(
          fse.existsSync(path.join(projectDir, "package.json"))
        ).toBeTruthy();
        expect(
          fse.existsSync(path.join(projectDir, "tsconfig.json"))
        ).toBeTruthy();
        expect(
          fse.existsSync(path.join(projectDir, "app/root.tsx"))
        ).toBeTruthy();
      });
    });

    describe("non-interactive shell", () => {
      let interactive = false;

      it("works when there are no collisions", async () => {
        let projectDir = getProjectDir("not-empty-dir-non-interactive");
        fse.mkdirSync(projectDir);
        fse.createFileSync(path.join(projectDir, "some-file.txt"));

        let { status, stderr } = await execCreateReactRouter({
          args: [
            projectDir,
            "--template",
            path.join(__dirname, "fixtures", "basic"),
            "--no-git-init",
            "--no-install",
          ],
          interactive,
        });

        expect(stderr.trim()).toBeFalsy();
        expect(status).toBe(0);
        expect(
          fse.existsSync(path.join(projectDir, "package.json"))
        ).toBeTruthy();
        expect(
          fse.existsSync(path.join(projectDir, "app/root.tsx"))
        ).toBeTruthy();
      });

      it("errors when there are collisions", async () => {
        let projectDir = getProjectDir(
          "not-empty-dir-non-interactive-collisions"
        );
        fse.mkdirSync(projectDir);
        fse.createFileSync(path.join(projectDir, "package.json"));
        fse.createFileSync(path.join(projectDir, "tsconfig.json"));

        let { status, stderr } = await execCreateReactRouter({
          args: [
            projectDir,
            "--template",
            path.join(__dirname, "fixtures", "basic"),
            "--no-git-init",
            "--no-install",
          ],
          interactive,
        });

        expect(stderr.trim()).toMatchInlineSnapshot(`
                  "▲  Oh no! Destination directory contains files that would be overwritten
                           and no \`--overwrite\` flag was included in a non-interactive
                           environment. The following files would be overwritten:
                             package.json
                             tsconfig.json"
              `);
        expect(status).toBe(1);
        expect(
          fse.existsSync(path.join(projectDir, "app/root.tsx"))
        ).toBeFalsy();
      });

      it("works when there are collisions and --overwrite is specified", async () => {
        let projectDir = getProjectDir(
          "not-empty-dir-non-interactive-collisions-overwrite"
        );
        fse.mkdirSync(projectDir);
        fse.createFileSync(path.join(projectDir, "package.json"));
        fse.createFileSync(path.join(projectDir, "tsconfig.json"));

        let { status, stdout, stderr } = await execCreateReactRouter({
          args: [
            projectDir,
            "--template",
            path.join(__dirname, "fixtures", "basic"),
            "--no-git-init",
            "--no-install",
            "--overwrite",
          ],
          interactive,
        });

        expect(stdout).toContain(
          "Overwrite: overwriting files due to `--overwrite`"
        );
        expect(stdout).toContain("package.json");
        expect(stdout).toContain("tsconfig.json");
        expect(status).toBe(0);
        expect(stderr.trim()).toBeFalsy();
        expect(
          fse.existsSync(path.join(projectDir, "package.json"))
        ).toBeTruthy();
        expect(
          fse.existsSync(path.join(projectDir, "tsconfig.json"))
        ).toBeTruthy();
        expect(
          fse.existsSync(path.join(projectDir, "app/root.tsx"))
        ).toBeTruthy();
      });
    });
  });

  describe("errors", () => {
    it("identifies when a github repo is not accessible (403)", async () => {
      let projectDir = getProjectDir("repo-403");

      let { status, stderr } = await execCreateReactRouter({
        args: [
          projectDir,
          "--template",
          "error-username/403",
          "--no-git-init",
          "--no-install",
        ],
      });

      expect(stderr.trim()).toMatchInlineSnapshot(
        `"▲  Oh no! There was a problem fetching the file from GitHub. The request responded with a 403 status. Please try again later."`
      );
      expect(status).toBe(1);
    });

    it("identifies when a github repo does not exist (404)", async () => {
      let projectDir = getProjectDir("repo-404");

      let { status, stderr } = await execCreateReactRouter({
        args: [
          projectDir,
          "--template",
          "error-username/404",
          "--no-git-init",
          "--no-install",
        ],
      });

      expect(stderr.trim()).toMatchInlineSnapshot(
        `"▲  Oh no! There was a problem fetching the file from GitHub. The request responded with a 404 status. Please try again later."`
      );
      expect(status).toBe(1);
    });

    it("identifies when something unknown goes wrong with the repo request (4xx)", async () => {
      let projectDir = getProjectDir("repo-4xx");

      let { status, stderr } = await execCreateReactRouter({
        args: [
          projectDir,
          "--template",
          "error-username/400",
          "--no-git-init",
          "--no-install",
        ],
      });

      expect(stderr.trim()).toMatchInlineSnapshot(
        `"▲  Oh no! There was a problem fetching the file from GitHub. The request responded with a 400 status. Please try again later."`
      );
      expect(status).toBe(1);
    });

    it("identifies when a remote tarball does not exist (404)", async () => {
      let projectDir = getProjectDir("remote-tarball-404");

      let { status, stderr } = await execCreateReactRouter({
        args: [
          projectDir,
          "--template",
          "https://example.com/error/404/template.tar.gz",
          "--no-git-init",
          "--no-install",
        ],
      });

      expect(stderr.trim()).toMatchInlineSnapshot(
        `"▲  Oh no! There was a problem fetching the file. The request responded with a 404 status. Please try again later."`
      );
      expect(status).toBe(1);
    });

    it("identifies when a remote tarball does not exist (4xx)", async () => {
      let projectDir = getProjectDir("remote-tarball-4xx");

      let { status, stderr } = await execCreateReactRouter({
        args: [
          projectDir,
          "--template",
          "https://example.com/error/400/template.tar.gz",
          "--no-git-init",
          "--no-install",
        ],
      });

      expect(stderr.trim()).toMatchInlineSnapshot(
        `"▲  Oh no! There was a problem fetching the file. The request responded with a 400 status. Please try again later."`
      );
      expect(status).toBe(1);
    });
  });

  describe("supports proxy usage", () => {
    beforeAll(() => {
      server.close();
    });
    afterAll(() => {
      server.listen({ onUnhandledRequest: "error" });
    });
    it("uses the proxy from env var", async () => {
      let projectDir = await getProjectDir("template");

      let { stderr } = await execCreateReactRouter({
        args: [
          projectDir,
          "--template",
          "remix-run/grunge-stack",
          "--no-install",
          "--no-git-init",
          "--debug",
        ],
        mockNetwork: false,
        env: { HTTPS_PROXY: "http://127.0.0.1:33128" },
      });

      expect(stderr.trim()).toMatch("127.0.0.1:33");
    });
  });
});

async function execCreateReactRouter({
  args = [],
  interactions = [],
  interactive = true,
  env = {},
  mockNetwork = true,
  cwd,
}: {
  args: string[];
  interactive?: boolean;
  interactions?: ShellInteractions;
  env?: Record<string, string>;
  mockNetwork?: boolean;
  cwd?: string;
}) {
  let proc = spawn(
    "node",
    [
      "--require",
      require.resolve("esbuild-register"),
      ...(mockNetwork
        ? ["--require", path.join(__dirname, "./msw-register.ts")]
        : []),
      path.resolve(__dirname, "../cli.ts"),
      ...args,
    ],
    {
      cwd,
      stdio: [null, null, null],
      env: {
        ...process.env,
        ...env,
        ...(interactive
          ? { CREATE_REACT_ROUTER_FORCE_INTERACTIVE: "true" }
          : {}),
      },
    }
  );

  return await interactWithShell(proc, interactions);
}

interface ShellResult {
  status: number | "timeout" | null;
  stdout: string;
  stderr: string;
}

type ShellInteractions = Array<
  | { question: RegExp; type: Array<String>; answer?: never }
  | { question: RegExp; answer: RegExp; type?: never }
>;

async function interactWithShell(
  proc: ChildProcessWithoutNullStreams,
  interactions: ShellInteractions
): Promise<ShellResult> {
  proc.stdin.setDefaultEncoding("utf-8");

  let deferred = defer<ShellResult>();

  let stepNumber = 0;

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (chunk: unknown) => {
    if (chunk instanceof Buffer) {
      chunk = String(chunk);
    }
    if (typeof chunk !== "string") {
      console.error({ stdoutChunk: chunk });
      throw new Error("stdout chunk is not a string");
    }
    stdout += stripAnsi(maskTempDir(chunk));
    let step = interactions[stepNumber];
    if (!step) return;
    let { question, answer, type } = step;
    if (question.test(chunk)) {
      if (answer) {
        let currentSelection = chunk
          .split("\n")
          .slice(1)
          .find(
            (line) =>
              line.includes("❯") || line.includes(">") || line.includes("●")
          );

        if (currentSelection && answer.test(currentSelection)) {
          proc.stdin.write(ENTER);
          stepNumber += 1;
        } else {
          proc.stdin.write(DOWN);
        }
      } else if (type) {
        for (let command of type) {
          proc.stdin.write(command);
        }
        stepNumber += 1;
      }
    }

    if (stepNumber === interactions.length) {
      proc.stdin.end();
    }
  });

  proc.stderr.on("data", (chunk: unknown) => {
    if (chunk instanceof Buffer) {
      chunk = String(chunk);
    }
    if (typeof chunk !== "string") {
      console.error({ stderrChunk: chunk });
      throw new Error("stderr chunk is not a string");
    }
    stderr += stripAnsi(maskTempDir(chunk));
  });

  proc.on("close", (status) => {
    deferred.resolve({ status, stdout, stderr });
  });

  // this ensures that if we do timeout we at least get as much useful
  // output as possible.
  let timeout = setTimeout(() => {
    if (deferred.state.current === "pending") {
      proc.kill();
      deferred.resolve({ status: "timeout", stdout, stderr });
    }
  }, jestTimeout);

  let result = await deferred.promise;
  clearTimeout(timeout);

  return result;
}

function defer<Value>() {
  let resolve: (value: Value) => void, reject: (reason?: any) => void;
  let state: { current: "pending" | "resolved" | "rejected" } = {
    current: "pending",
  };
  let promise = new Promise<Value>((res, rej) => {
    resolve = (value: Value) => {
      state.current = "resolved";
      return res(value);
    };
    reject = (reason?: any) => {
      state.current = "rejected";
      return rej(reason);
    };
  });
  return { promise, resolve: resolve!, reject: reject!, state };
}
