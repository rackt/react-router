let restrictedGlobalsError = `Node globals are not allowed in this package.`;

module.exports = {
  env: {
    browser: true,
    commonjs: true,
  },
  rules: {
    strict: 0,
    "no-restricted-globals": [
      "error",
      { name: "__dirname", message: restrictedGlobalsError },
      { name: "__filename", message: restrictedGlobalsError },
      { name: "Buffer", message: restrictedGlobalsError },
    ],
    "import/no-nodejs-modules": "error",
  },
};
