const path = require("path");
const babel = require("@rollup/plugin-babel").default;
const copy = require("rollup-plugin-copy");
const extensions = require("rollup-plugin-extensions");
const prettier = require("rollup-plugin-prettier");
const replace = require("@rollup/plugin-replace");
const { terser } = require("rollup-plugin-terser");
const typescript = require("@rollup/plugin-typescript");
const {
  createBanner,
  getBuildDirectories,
  PRETTY,
} = require("../../rollup.utils");
const { name, version } = require("./package.json");

module.exports = function rollup() {
  const { ROOT_DIR, SOURCE_DIR, OUTPUT_DIR } = getBuildDirectories(name);
  const ROUTER_DOM_FOLDER = path.relative(
    process.cwd(),
    path.join(__dirname, "../react-router-dom")
  );
  const ROUTER_DOM_COPY_DEST = `${SOURCE_DIR}/react-router-dom`;

  // JS modules for bundlers
  let modules = [
    {
      input: `${SOURCE_DIR}/index.ts`,
      output: {
        file: `${OUTPUT_DIR}/index.js`,
        format: "esm",
        sourcemap: !PRETTY,
        banner: createBanner("React Router DOM v5 Compat", version),
      },
      external: [
        "history",
        "@remix-run/router",
        "react",
        "react-dom",
        "react-router",
        "react-router-dom",
      ],
      plugins: [
        copy({
          targets: [
            {
              src: path.join(ROUTER_DOM_FOLDER, "index.tsx"),
              dest: ROUTER_DOM_COPY_DEST,
            },
            {
              src: path.join(ROUTER_DOM_FOLDER, "dom.ts"),
              dest: ROUTER_DOM_COPY_DEST,
            },
          ],
          hook: "buildStart",
        }),
        extensions({ extensions: [".tsx", ".ts"] }),
        babel({
          babelHelpers: "bundled",
          exclude: /node_modules/,
          presets: [
            ["@babel/preset-env", { loose: true }],
            "@babel/preset-react",
            "@babel/preset-typescript",
          ],
          plugins: ["babel-plugin-dev-expression"],
          extensions: [".ts", ".tsx"],
        }),
        typescript({
          tsconfig: path.join(__dirname, "tsconfig.json"),
          exclude: ["__tests__"],
          noEmitOnError: true,
        }),
        copy({
          targets: [
            { src: path.join(ROOT_DIR, "LICENSE.md"), dest: OUTPUT_DIR },
          ],
          verbose: true,
        }),
      ].concat(PRETTY ? prettier({ parser: "babel" }) : []),
    },
  ];

  // UMD modules for <script> tags and CommonJS (node)
  let globals = [
    {
      input: `${SOURCE_DIR}/index.ts`,
      output: {
        file: `${OUTPUT_DIR}/umd/react-router-dom-v5-compat.development.js`,
        format: "umd",
        sourcemap: !PRETTY,
        banner: createBanner("React Router DOM v5 Compat", version),
        globals: {
          history: "HistoryLibrary",
          "@remix-run/router": "Router",
          react: "React",
          "react-router": "ReactRouter",
          "react-router-dom": "ReactRouterDOM",
        },
        name: "ReactRouterDOMv5Compat",
      },
      external: [
        "history",
        "@remix-run/router",
        "react",
        "react-router",
        "react-router-dom",
      ],
      plugins: [
        extensions({ extensions: [".tsx", ".ts"] }),
        babel({
          babelHelpers: "bundled",
          exclude: /node_modules/,
          presets: [
            ["@babel/preset-env", { loose: true }],
            "@babel/preset-react",
            "@babel/preset-typescript",
          ],
          plugins: ["babel-plugin-dev-expression"],
          extensions: [".ts", ".tsx"],
        }),
        replace({
          preventAssignment: true,
          values: { "process.env.NODE_ENV": JSON.stringify("development") },
        }),
      ].concat(PRETTY ? prettier({ parser: "babel" }) : []),
    },
    {
      input: `${SOURCE_DIR}/index.ts`,
      output: {
        file: `${OUTPUT_DIR}/umd/react-router-dom-v5-compat.production.min.js`,
        format: "umd",
        sourcemap: !PRETTY,
        banner: createBanner("React Router DOM v5 Compat", version),
        globals: {
          history: "HistoryLibrary",
          "@remix-run/router": "Router",
          react: "React",
          "react-router": "ReactRouter",
          "react-router-dom": "ReactRouterDOM",
        },
        name: "ReactRouterDOMv5Compat",
      },
      external: [
        "history",
        "@remix-run/router",
        "react",
        "react-router",
        "react-router-dom",
      ],
      plugins: [
        extensions({ extensions: [".tsx", ".ts"] }),
        babel({
          babelHelpers: "bundled",
          exclude: /node_modules/,
          presets: [
            ["@babel/preset-env", { loose: true }],
            "@babel/preset-react",
            "@babel/preset-typescript",
          ],
          plugins: ["babel-plugin-dev-expression"],
          extensions: [".ts", ".tsx"],
        }),
        replace({
          preventAssignment: true,
          values: { "process.env.NODE_ENV": JSON.stringify("production") },
        }),
        terser(),
      ].concat(PRETTY ? prettier({ parser: "babel" }) : []),
    },
  ];

  // Node entry points
  let node = [
    {
      input: `${SOURCE_DIR}/node-main.js`,
      output: {
        file: `${OUTPUT_DIR}/main.js`,
        format: "cjs",
        banner: createBanner("React Router DOM v5 Compat", version),
      },
      plugins: [].concat(PRETTY ? prettier({ parser: "babel" }) : []),
    },
  ];

  return [...modules, ...globals, ...node];
};
