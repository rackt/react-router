import arg from "arg";
import semver from "semver";
import colors from "picocolors";

import * as commands from "./commands";

const helpText = `
${colors.blueBright("react-router")}

  ${colors.underline("Usage")}:
    $ react-router build [${colors.yellowBright("projectDir")}]
    $ react-router dev [${colors.yellowBright("projectDir")}]
    $ react-router routes [${colors.yellowBright("projectDir")}]

  ${colors.underline("Options")}:
    --help, -h          Print this help message and exit
    --version, -v       Print the CLI version and exit
    --no-color          Disable ANSI colors in console output
  \`build\` Options:
    --assetsInlineLimit Static asset base64 inline threshold in bytes (default: 4096) (number)
    --clearScreen       Allow/disable clear screen when logging (boolean)
    --config, -c        Use specified config file (string)
    --emptyOutDir       Force empty outDir when it's outside of root (boolean)
    --logLevel, -l      Info | warn | error | silent (string)
    --minify            Enable/disable minification, or specify minifier to use (default: "esbuild") (boolean | "terser" | "esbuild")
    --mode, -m          Set env mode (string)
    --profile           Start built-in Node.js inspector
    --sourcemapClient   Output source maps for client build (default: false) (boolean | "inline" | "hidden")
    --sourcemapServer   Output source maps for server build (default: false) (boolean | "inline" | "hidden")
  \`dev\` Options:
    --clearScreen       Allow/disable clear screen when logging (boolean)
    --config, -c        Use specified config file (string)
    --cors              Enable CORS (boolean)
    --force             Force the optimizer to ignore the cache and re-bundle (boolean)
    --host              Specify hostname (string)
    --logLevel, -l      Info | warn | error | silent (string)
    --mode, -m          Set env mode (string)
    --open              Open browser on startup (boolean | string)
    --port              Specify port (number)
    --profile           Start built-in Node.js inspector
    --strictPort        Exit if specified port is already in use (boolean)
  \`routes\` Options:
    --config, -c        Use specified Vite config file (string)
    --json              Print the routes as JSON
  \`reveal\` Options:
    --config, -c        Use specified Vite config file (string)
    --no-typescript     Generate plain JavaScript files
  \`typegen\` Options:
    --watch             Automatically regenerate types whenever route config (\`routes.ts\`) or route modules change

  ${colors.underline("Build your project")}:

    $ react-router build

  ${colors.underline("Run your project locally in development")}:

    $ react-router dev

  ${colors.underline("Show all routes in your app")}:

    $ react-router routes
    $ react-router routes my-app
    $ react-router routes --json
    $ react-router routes --config vite.react-router.config.ts

  ${colors.underline("Reveal the used entry point")}:

    $ react-router reveal entry.client
    $ react-router reveal entry.server
    $ react-router reveal entry.client --no-typescript
    $ react-router reveal entry.server --no-typescript
    $ react-router reveal entry.server --config vite.react-router.config.ts

  ${colors.underline("Generate types for route modules")}:

   $ react-router typegen
   $ react-router typegen --watch
`;

/**
 * Programmatic interface for running the react-router CLI with the given command line
 * arguments.
 */
export async function run(argv: string[] = process.argv.slice(2)) {
  // Check the node version
  let versions = process.versions;
  let MINIMUM_NODE_VERSION = 20;
  if (
    versions &&
    versions.node &&
    semver.major(versions.node) < MINIMUM_NODE_VERSION
  ) {
    console.warn(
      `️⚠️ Oops, Node v${versions.node} detected. react-router requires ` +
        `a Node version greater than ${MINIMUM_NODE_VERSION}.`
    );
  }

  let isBooleanFlag = (arg: string) => {
    let index = argv.indexOf(arg);
    let nextArg = argv[index + 1];
    return !nextArg || nextArg.startsWith("-");
  };

  let args = arg(
    {
      "--force": Boolean,
      "--help": Boolean,
      "-h": "--help",
      "--json": Boolean,
      "--token": String,
      "--typescript": Boolean,
      "--no-typescript": Boolean,
      "--version": Boolean,
      "-v": "--version",
      "--port": Number,
      "-p": "--port",
      "--config": String,
      "-c": "--config",
      "--assetsInlineLimit": Number,
      "--clearScreen": Boolean,
      "--cors": Boolean,
      "--emptyOutDir": Boolean,
      "--host": isBooleanFlag("--host") ? Boolean : String,
      "--logLevel": String,
      "-l": "--logLevel",
      "--minify": String,
      "--mode": String,
      "-m": "--mode",
      "--open": isBooleanFlag("--open") ? Boolean : String,
      "--strictPort": Boolean,
      "--profile": Boolean,
      "--sourcemapClient": isBooleanFlag("--sourcemapClient")
        ? Boolean
        : String,
      "--sourcemapServer": isBooleanFlag("--sourcemapServer")
        ? Boolean
        : String,
      "--watch": Boolean,
    },
    {
      argv,
    }
  );

  let input = args._;

  let flags: any = Object.entries(args).reduce((acc, [key, value]) => {
    key = key.replace(/^--/, "");
    acc[key] = value;
    return acc;
  }, {} as any);

  if (flags.help) {
    console.log(helpText);
    return;
  }
  if (flags.version) {
    let version = require("../../package.json").version;
    console.log(version);
    return;
  }

  flags.interactive = flags.interactive ?? require.main === module;
  if (args["--no-typescript"]) {
    flags.typescript = false;
  }

  let command = input[0];

  // Note: Keep each case in this switch statement small.
  switch (command) {
    case "routes":
      await commands.routes(input[1], flags);
      break;
    case "build":
      await commands.build(input[1], flags);
      break;
    case "reveal": {
      // TODO: simplify getting started guide
      await commands.generateEntry(input[1], input[2], flags);
      break;
    }
    case "dev":
      await commands.dev(input[1], flags);
      break;
    case "typegen":
      await commands.typegen(input[1], flags);
      break;
    default:
      // `react-router ./my-project` is shorthand for `react-router dev ./my-project`
      await commands.dev(input[0], flags);
  }
}
