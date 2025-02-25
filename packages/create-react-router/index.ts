import process from "node:process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fse from "fs-extra";
import stripAnsi from "strip-ansi";
import execa from "execa";
import arg from "arg";
import * as semver from "semver";
import sortPackageJSON from "sort-package-json";

import { version as thisReactRouterVersion } from "./package.json";
import { prompt } from "./prompt";
import {
  IGNORED_TEMPLATE_DIRECTORIES,
  color,
  debug,
  ensureDirectory,
  error,
  getDirectoryFilesRecursive,
  info,
  isInteractive,
  isValidJsonObject,
  log,
  sleep,
  strip,
  stripDirectoryFromPath,
  toValidProjectName,
} from "./utils";
import { renderLoadingIndicator } from "./loading-indicator";
import { copyTemplate, CopyTemplateError } from "./copy-template";

async function createReactRouter(argv: string[]) {
  let ctx = await getContext(argv);
  if (ctx.help) {
    printHelp(ctx);
    return;
  }
  if (ctx.versionRequested) {
    log(thisReactRouterVersion);
    return;
  }

  let steps = [
    introStep,
    projectNameStep,
    copyTemplateToTempDirStep,
    copyTempDirToAppDirStep,
    gitInitQuestionStep,
    installDependenciesQuestionStep,
    installDependenciesStep,
    gitInitStep,
    doneStep,
  ];

  try {
    for (let step of steps) {
      await step(ctx);
    }
  } catch (err) {
    if (ctx.debug) {
      console.error(err);
    }
    throw err;
  }
}

async function getContext(argv: string[]): Promise<Context> {
  let flags = arg(
    {
      "--debug": Boolean,
      "--react-router-version": String,
      "-v": "--react-router-version",
      "--template": String,
      "--token": String,
      "--yes": Boolean,
      "-y": "--yes",
      "--install": Boolean,
      "--no-install": Boolean,
      "--package-manager": String,
      "--show-install-output": Boolean,
      "--git-init": Boolean,
      "--no-git-init": Boolean,
      "--help": Boolean,
      "-h": "--help",
      "--version": Boolean,
      "--V": "--version",
      "--no-color": Boolean,
      "--no-motion": Boolean,
      "--overwrite": Boolean,
    },
    { argv, permissive: true }
  );

  let {
    "--debug": debug = false,
    "--help": help = false,
    "--react-router-version": selectedReactRouterVersion,
    "--template": template,
    "--token": token,
    "--install": install,
    "--no-install": noInstall,
    "--package-manager": pkgManager,
    "--show-install-output": showInstallOutput = false,
    "--git-init": git,
    "--no-git-init": noGit,
    "--no-motion": noMotion,
    "--yes": yes,
    "--version": versionRequested,
    "--overwrite": overwrite,
  } = flags;

  let cwd = flags["_"][0] as string;
  let interactive = isInteractive();
  let projectName = cwd;

  if (!interactive) {
    yes = true;
  }

  if (selectedReactRouterVersion) {
    if (semver.valid(selectedReactRouterVersion)) {
      // do nothing, we're good
    } else if (semver.coerce(selectedReactRouterVersion)) {
      selectedReactRouterVersion = semver.coerce(
        selectedReactRouterVersion
      )!.version;
    } else {
      log(
        `\n${color.warning(
          `${selectedReactRouterVersion} is an invalid version specifier. Using React Router v${thisReactRouterVersion}.`
        )}`
      );
      selectedReactRouterVersion = undefined;
    }
  }

  let context: Context = {
    tempDir: path.join(
      await fs.promises.realpath(os.tmpdir()),
      `create-react-router--${Math.random().toString(36).substr(2, 8)}`
    ),
    cwd,
    overwrite,
    interactive,
    debug,
    git: git ?? (noGit ? false : yes),
    help,
    install: install ?? (noInstall ? false : yes),
    showInstallOutput,
    noMotion,
    pkgManager: validatePackageManager(
      pkgManager ??
        // npm, pnpm, Yarn, Bun and Deno (v2.0.5+) set the user agent environment variable that can be used
        // to determine which package manager ran the command.
        (process.env.npm_config_user_agent ?? "npm").split("/")[0]
    ),
    projectName,
    prompt,
    reactRouterVersion: selectedReactRouterVersion || thisReactRouterVersion,
    template,
    token,
    versionRequested,
  };

  return context;
}

interface Context {
  tempDir: string;
  cwd: string;
  interactive: boolean;
  debug: boolean;
  git?: boolean;
  help: boolean;
  install?: boolean;
  showInstallOutput: boolean;
  noMotion?: boolean;
  pkgManager: PackageManager;
  projectName?: string;
  prompt: typeof prompt;
  reactRouterVersion: string;
  stdin?: typeof process.stdin;
  stdout?: typeof process.stdout;
  template?: string;
  token?: string;
  versionRequested?: boolean;
  overwrite?: boolean;
}

async function introStep(ctx: Context) {
  log(
    `\n${" ".repeat(9)}${color.green(
      color.bold("create-react-router")
    )} ${color.bold(`v${ctx.reactRouterVersion}`)}`
  );

  if (!ctx.interactive) {
    log("");
    info("Shell is not interactive.", [
      `Using default options. This is equivalent to running with the `,
      color.reset("--yes"),
      ` flag.`,
    ]);
  }
}

async function projectNameStep(ctx: Context) {
  // valid cwd is required if shell isn't interactive
  if (!ctx.interactive && !ctx.cwd) {
    error("Oh no!", "No project directory provided");
    throw new Error("No project directory provided");
  }

  if (ctx.cwd) {
    await sleep(100);
    info("Directory:", [
      "Using ",
      color.reset(ctx.cwd),
      " as project directory",
    ]);
  }

  if (!ctx.cwd) {
    let { name } = await ctx.prompt({
      name: "name",
      type: "text",
      label: title("dir"),
      message: "Where should we create your new project?",
      initial: "./my-react-router-app",
    });
    ctx.cwd = name!;
    ctx.projectName = toValidProjectName(name!);
    return;
  }

  let name = ctx.cwd;
  if (name === "." || name === "./") {
    let parts = process.cwd().split(path.sep);
    name = parts[parts.length - 1];
  } else if (name.startsWith("./") || name.startsWith("../")) {
    let parts = name.split("/");
    name = parts[parts.length - 1];
  }
  ctx.projectName = toValidProjectName(name);
}

async function copyTemplateToTempDirStep(ctx: Context) {
  if (ctx.template) {
    log("");
    info("Template:", ["Using ", color.reset(ctx.template), "..."]);
  } else {
    log("");
    info("Using default template", [
      "See https://github.com/remix-run/react-router-templates for more",
    ]);
  }

  let template =
    ctx.template ??
    "https://github.com/remix-run/react-router-templates/tree/main/default";

  await loadingIndicator({
    start: "Template copying...",
    end: "Template copied",
    while: async () => {
      await ensureDirectory(ctx.tempDir);
      if (ctx.debug) {
        debug(`Extracting to: ${ctx.tempDir}`);
      }

      let result = await copyTemplate(template, ctx.tempDir, {
        debug: ctx.debug,
        token: ctx.token,
        async onError(err) {
          error(
            "Oh no!",
            err instanceof CopyTemplateError
              ? err.message
              : "Something went wrong. Run `create-react-router --debug` to see more info.\n\n" +
                  "Open an issue to report the problem at " +
                  "https://github.com/remix-run/react-router/issues/new"
          );
          throw err;
        },
        async log(message) {
          if (ctx.debug) {
            debug(message);
            await sleep(500);
          }
        },
      });

      if (result?.localTemplateDirectory) {
        ctx.tempDir = path.resolve(result.localTemplateDirectory);
      }
    },
    ctx,
  });
}

async function copyTempDirToAppDirStep(ctx: Context) {
  await ensureDirectory(ctx.cwd);

  let files1 = await getDirectoryFilesRecursive(ctx.tempDir);
  let files2 = await getDirectoryFilesRecursive(ctx.cwd);
  let collisions = files1
    .filter((f) => files2.includes(f))
    .sort((a, b) => a.localeCompare(b));

  if (collisions.length > 0) {
    let getFileList = (prefix: string) => {
      let moreFiles = collisions.length - 5;
      let lines = ["", ...collisions.slice(0, 5)];
      if (moreFiles > 0) {
        lines.push(`and ${moreFiles} more...`);
      }
      return lines.join(`\n${prefix}`);
    };

    if (ctx.overwrite) {
      info(
        "Overwrite:",
        `overwriting files due to \`--overwrite\`:${getFileList("           ")}`
      );
    } else if (!ctx.interactive) {
      error(
        "Oh no!",
        `Destination directory contains files that would be overwritten\n` +
          `         and no \`--overwrite\` flag was included in a non-interactive\n` +
          `         environment. The following files would be overwritten:` +
          getFileList("           ")
      );
      throw new Error(
        "File collisions detected in a non-interactive environment"
      );
    } else {
      if (ctx.debug) {
        debug(`Colliding files:${getFileList("          ")}`);
      }

      let { overwrite } = await ctx.prompt({
        name: "overwrite",
        type: "confirm",
        label: title("overwrite"),
        message:
          `Your project directory contains files that will be overwritten by\n` +
          `             this template (you can force with \`--overwrite\`)\n\n` +
          `             Files that would be overwritten:` +
          `${getFileList("               ")}\n\n` +
          `             Do you wish to continue?\n` +
          `             `,
        initial: false,
      });
      if (!overwrite) {
        throw new Error("Exiting to avoid overwriting files");
      }
    }
  }

  await fse.copy(ctx.tempDir, ctx.cwd, {
    filter(src, dest) {
      // We never copy .git/ or node_modules/ directories since it's highly
      // unlikely we want them copied - and because templates are primarily
      // being pulled from git tarballs which won't have .git/ and shouldn't
      // have node_modules/
      let file = stripDirectoryFromPath(ctx.tempDir, src);
      let isIgnored = IGNORED_TEMPLATE_DIRECTORIES.includes(file);
      if (isIgnored) {
        if (ctx.debug) {
          debug(`Skipping copy of ${file} directory from template`);
        }
        return false;
      }
      return true;
    },
  });

  await updatePackageJSON(ctx);
}

async function installDependenciesQuestionStep(ctx: Context) {
  if (ctx.install === undefined) {
    let { deps = true } = await ctx.prompt({
      name: "deps",
      type: "confirm",
      label: title("deps"),
      message: `Install dependencies with ${ctx.pkgManager}?`,
      hint: "recommended",
      initial: true,
    });
    ctx.install = deps;
  }
}

async function installDependenciesStep(ctx: Context) {
  let { install, pkgManager, showInstallOutput, cwd } = ctx;

  if (!install) {
    await sleep(100);
    info("Skipping install step.", [
      "Remember to install dependencies after setup with ",
      color.reset(`${pkgManager} install`),
      ".",
    ]);
    return;
  }

  function runInstall() {
    return installDependencies({
      cwd,
      pkgManager,
      showInstallOutput,
    });
  }

  if (showInstallOutput) {
    log("");
    info(`Install`, `Dependencies installing with ${pkgManager}...`);
    log("");
    await runInstall();
    log("");
    return;
  }

  log("");
  await loadingIndicator({
    start: `Dependencies installing with ${pkgManager}...`,
    end: "Dependencies installed",
    while: runInstall,
    ctx,
  });
}

async function gitInitQuestionStep(ctx: Context) {
  if (fs.existsSync(path.join(ctx.cwd, ".git"))) {
    info("Nice!", `Git has already been initialized`);
    return;
  }

  let git = ctx.git;
  if (ctx.git === undefined) {
    ({ git } = await ctx.prompt({
      name: "git",
      type: "confirm",
      label: title("git"),
      message: `Initialize a new git repository?`,
      hint: "recommended",
      initial: true,
    }));
  }

  ctx.git = git ?? false;
}

async function gitInitStep(ctx: Context) {
  if (!ctx.git) {
    return;
  }

  if (fs.existsSync(path.join(ctx.cwd, ".git"))) {
    log("");
    info("Nice!", `Git has already been initialized`);
    return;
  }

  log("");
  await loadingIndicator({
    start: "Git initializing...",
    end: "Git initialized",
    while: async () => {
      let options = { cwd: ctx.cwd, stdio: "ignore" } as const;
      let commitMsg = "Initial commit from create-react-router";
      try {
        await execa("git", ["init"], options);
        await execa("git", ["add", "."], options);
        await execa("git", ["commit", "-m", commitMsg], options);
      } catch (err) {
        error("Oh no!", "Failed to initialize git.");
        throw err;
      }
    },
    ctx,
  });
}

async function doneStep(ctx: Context) {
  let projectDir = path.relative(process.cwd(), ctx.cwd);

  let max = process.stdout.columns;
  let prefix = max < 80 ? " " : " ".repeat(9);
  await sleep(200);

  log(`\n ${color.bgWhite(color.black(" done "))}  That's it!`);
  await sleep(100);
  if (projectDir !== "") {
    let enter = [
      `\n${prefix}Enter your project directory using`,
      color.cyan(`cd .${path.sep}${projectDir}`),
    ];
    let len = enter[0].length + stripAnsi(enter[1]).length;
    log(enter.join(len > max ? "\n" + prefix : " "));
  }
  log(
    `${prefix}Check out ${color.bold(
      "README.md"
    )} for development and deploy instructions.`
  );
  await sleep(100);
  log(
    `\n${prefix}Join the community at ${color.cyan(`https://rmx.as/discord`)}\n`
  );
  await sleep(200);
}

const validPackageManagers = ["npm", "yarn", "pnpm", "bun", "deno"] as const;
type PackageManager = (typeof validPackageManagers)[number];

function validatePackageManager(pkgManager: string): PackageManager {
  return validPackageManagers.find((name) => pkgManager === name) ?? "npm";
}

async function installDependencies({
  pkgManager,
  cwd,
  showInstallOutput,
}: {
  pkgManager: PackageManager;
  cwd: string;
  showInstallOutput: boolean;
}) {
  try {
    await execa(pkgManager, ["install"], {
      cwd,
      stdio: showInstallOutput ? "inherit" : "ignore",
    });
  } catch (err) {
    error("Oh no!", "Failed to install dependencies.");
    throw err;
  }
}

async function updatePackageJSON(ctx: Context) {
  let packageJSONPath = path.join(ctx.cwd, "package.json");
  if (!fs.existsSync(packageJSONPath)) {
    let relativePath = path.relative(process.cwd(), ctx.cwd);
    error(
      "Oh no!",
      "The provided template must be a React Router project with a `package.json` " +
        `file, but that file does not exist in ${color.bold(relativePath)}.`
    );
    throw new Error(`package.json does not exist in ${ctx.cwd}`);
  }

  let contents = await fs.promises.readFile(packageJSONPath, "utf-8");
  let packageJSON: any;
  try {
    packageJSON = JSON.parse(contents);
    if (!isValidJsonObject(packageJSON)) {
      throw Error();
    }
  } catch (err) {
    error(
      "Oh no!",
      "The provided template must be a React Router project with a `package.json` " +
        `file, but that file is invalid.`
    );
    throw err;
  }

  for (let pkgKey of ["dependencies", "devDependencies"] as const) {
    let dependencies = packageJSON[pkgKey];
    if (!dependencies) continue;

    if (!isValidJsonObject(dependencies)) {
      error(
        "Oh no!",
        "The provided template must be a React Router project with a `package.json` " +
          `file, but its ${pkgKey} value is invalid.`
      );
      throw new Error(`package.json ${pkgKey} are invalid`);
    }

    for (let dependency in dependencies) {
      let version = dependencies[dependency];
      if (
        (dependency.startsWith("@react-router/") ||
          dependency === "react-router" ||
          dependency === "react-router-dom") &&
        version === "*"
      ) {
        dependencies[dependency] = semver.prerelease(ctx.reactRouterVersion)
          ? // Templates created from prereleases should pin to a specific version
            ctx.reactRouterVersion
          : "^" + ctx.reactRouterVersion;
      }
    }
  }

  packageJSON.name = ctx.projectName;

  fs.promises.writeFile(
    packageJSONPath,
    JSON.stringify(sortPackageJSON(packageJSON), null, 2),
    "utf-8"
  );
}

async function loadingIndicator(args: {
  start: string;
  end: string;
  while: (...args: any) => Promise<any>;
  ctx: Context;
}) {
  let { ctx, ...rest } = args;
  await renderLoadingIndicator({
    ...rest,
    noMotion: args.ctx.noMotion,
  });
}

function title(text: string) {
  return align(color.bgWhite(` ${color.black(text)} `), "end", 7) + " ";
}

function printHelp(ctx: Context) {
  // prettier-ignore
  let output = `
${title("create-react-router")}

${color.heading("Usage")}:

${color.dim("$")} ${color.greenBright("create-react-router")} ${color.arg("<projectDir>")} ${color.arg("<...options>")}

${color.heading("Values")}:

${color.arg("projectDir")}          ${color.dim(`The React Router project directory`)}

${color.heading("Options")}:

${color.arg("--help, -h")}          ${color.dim(`Print this help message and exit`)}
${color.arg("--version, -V")}       ${color.dim(`Print the CLI version and exit`)}
${color.arg("--no-color")}          ${color.dim(`Disable ANSI colors in console output`)}
${color.arg("--no-motion")}         ${color.dim(`Disable animations in console output`)}

${color.arg("--template <name>")}   ${color.dim(`The project template to use`)}
${color.arg("--[no-]install")}      ${color.dim(`Whether or not to install dependencies after creation`)}
${color.arg("--package-manager")}   ${color.dim(`The package manager to use`)}
${color.arg("--show-install-output")}   ${color.dim(`Whether to show the output of the install process`)}
${color.arg("--[no-]git-init")}     ${color.dim(`Whether or not to initialize a Git repository`)}
${color.arg("--yes, -y")}           ${color.dim(`Skip all option prompts and run setup`)}
${color.arg("--react-router-version, -v")}     ${color.dim(`The version of React Router to use`)}

${color.heading("Creating a new project")}:

React Router projects are created from templates. A template can be:

- a GitHub repo shorthand, :username/:repo or :username/:repo/:directory
- the URL of a GitHub repo (or directory within it)
- the URL of a tarball
- a file path to a directory of files
- a file path to a tarball
${[
  "remix-run/react-router/templates/basic",
  "remix-run/react-router/examples/basic",
  ":username/:repo",
  ":username/:repo/:directory",
  "https://github.com/:username/:repo",
  "https://github.com/:username/:repo/tree/:branch",
  "https://github.com/:username/:repo/tree/:branch/:directory",
  "https://github.com/:username/:repo/archive/refs/tags/:tag.tar.gz",
  "https://example.com/template.tar.gz",
  "./path/to/template",
  "./path/to/template.tar.gz",
].reduce((str, example) => {
  return `${str}\n${color.dim("$")} ${color.greenBright("create-react-router")} my-app ${color.arg(`--template ${example}`)}`;
}, "")}

To create a new project from a template in a private GitHub repo,
pass the \`token\` flag with a personal access token with access
to that repo.
`;

  log(output);
}

function align(text: string, dir: "start" | "end" | "center", len: number) {
  let pad = Math.max(len - strip(text).length, 0);
  switch (dir) {
    case "start":
      return text + " ".repeat(pad);
    case "end":
      return " ".repeat(pad) + text;
    case "center":
      return (
        " ".repeat(Math.floor(pad / 2)) + text + " ".repeat(Math.floor(pad / 2))
      );
    default:
      return text;
  }
}

export { createReactRouter };
export type { Context };
