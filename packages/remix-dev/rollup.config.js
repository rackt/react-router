const path = require("node:path");
const babel = require("@rollup/plugin-babel").default;
const typescript = require("@rollup/plugin-typescript");
const nodeResolve = require("@rollup/plugin-node-resolve").default;
const copy = require("rollup-plugin-copy");

const {
  createBanner,
  isBareModuleId,
  getBuildDirectories,
  remixBabelConfig,
  WATCH,
} = require("../../rollup.utils");
const { name, version } = require("./package.json");

/** @returns {import("rollup").RollupOptions[]} */
module.exports = function rollup() {
  const { SOURCE_DIR, OUTPUT_DIR } = getBuildDirectories(
    name,
    // We don't live in a folder matching our package name
    "remix-dev"
  );

  return [
    {
      external(id) {
        return isBareModuleId(id);
      },
      input: [
        `${SOURCE_DIR}/index.ts`,
        // The standalone RSC runtime
        `${SOURCE_DIR}/runtime.client.ts`,
        // Since we're using a dynamic require for the Vite plugin, we
        // need to tell Rollup it's an entry point
        `${SOURCE_DIR}/vite/plugin.ts`,
      ],
      output: {
        banner: createBanner("@react-router/dev", version),
        dir: OUTPUT_DIR,
        format: "cjs",
        preserveModules: true,
        exports: "named",
      },
      plugins: [
        babel({
          babelHelpers: "bundled",
          exclude: /node_modules/,
          extensions: [".ts"],
          ...remixBabelConfig,
        }),
        typescript({
          tsconfig: path.join(__dirname, "tsconfig.json"),
          exclude: ["__tests__"],
          noEmitOnError: !WATCH,
        }),
        nodeResolve({ extensions: [".ts"] }),
        copy({
          targets: [
            { src: "LICENSE.md", dest: SOURCE_DIR },
            { src: `${SOURCE_DIR}/vite/static`, dest: `${OUTPUT_DIR}/vite` },
            {
              src: `${SOURCE_DIR}/config/defaults`,
              dest: `${OUTPUT_DIR}/config`,
            },
          ],
        }),
        // Allow dynamic imports in CJS code to allow us to utilize
        // ESM modules as part of the compiler.
        {
          name: "dynamic-import-polyfill",
          renderDynamicImport() {
            return {
              left: "import(",
              right: ")",
            };
          },
        },
      ],
    },
    {
      external() {
        return true;
      },
      input: `${SOURCE_DIR}/cli.ts`,
      output: {
        banner: createBanner(name, version, { executable: true }),
        dir: OUTPUT_DIR,
        format: "cjs",
      },
      plugins: [
        babel({
          babelHelpers: "bundled",
          exclude: /node_modules/,
          extensions: [".ts"],
          ...remixBabelConfig,
        }),
        nodeResolve({ extensions: [".ts"] }),
        {
          name: "dynamic-import-polyfill",
          renderDynamicImport() {
            return {
              left: "import(",
              right: ")",
            };
          },
        },
      ],
    },
  ];
};
