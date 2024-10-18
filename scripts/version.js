{
  "name": "react-router",
  "version": "5.1.2",
  "private": true,
  "scripts": {
    "build": "node ./scripts/build.js",
    "clean": "git clean -e '!/website-deploy-key' -e '!/website-deploy-key.pub' -fdX .",
    "lint": "eslint .",
    "size": "filesize",
    "start": "node ./scripts/start.js",
    "test": "node ./scripts/test.js",
    "watch": "node ./scripts/watch.js"
  },
  "dependencies": {
    "@ampproject/filesize": "^1.0.1",
    "@ampproject/rollup-plugin-closure-compiler": "^0.13.0",
    "@babel/core": "^7.7.4",
    "@babel/preset-env": "^7.7.4",
    "@babel/preset-modules": "^0.1.2",
    "@babel/preset-react": "^7.7.4",
    "@rollup/plugin-commonjs": "^11.0.1",
    "@rollup/plugin-node-resolve": "^7.0.0",
    "@rollup/plugin-replace": "^2.2.1",
    "@typescript-eslint/eslint-plugin": "2.x",
    "@typescript-eslint/parser": "2.x",
    "babel-eslint": "10.x",
    "babel-plugin-dev-expression": "^0.2.2",
    "chalk": "^3.0.0",
    "eslint": "6.x",
    "eslint-config-react-app": "^5.1.0",
    "eslint-plugin-flowtype": "3.x",
    "eslint-plugin-import": "2.x",
    "eslint-plugin-jsx-a11y": "6.x",
    "eslint-plugin-react": "7.x",
    "eslint-plugin-react-hooks": "1.x",
    "history": "^5.0.0-beta.4",
    "jest": "^24.9.0",
    "jsonfile": "^5.0.0",
    "lerna": "^3.13.4",
    "lerna-changelog": "^0.8.2",
    "metro-react-native-babel-preset": "^0.57.0",
    "prettier": "^1.14.3",
    "prompt-confirm": "^2.0.4",
    "react": "^16.12.0",
    "react-dom": "^16.12.0",
    "react-test-renderer": "^16.12.0",
    "rollup": "^1.27.9",
    "rollup-plugin-babel": "^4.3.3",
    "rollup-plugin-copy": "^3.1.0",
    "rollup-plugin-ignore": "^1.0.5",
    "rollup-plugin-prettier": "^0.6.0",
    "rollup-plugin-terser": "^5.1.2",
    "semver": "^7.1.2"
  },
  "workspaces": {
    "packages": [
      "packages/react-router",
      "packages/react-router-dom",
      "packages/react-router-native"
    ],
    "nohoist": [
      "**/react-native",
      "**/react-native/**"
    ]
  },
  "filesize": [
    {
      "path": "build/react-router/react-router.production.min.js",
      "compression": "none",
      "maxSize": "5.5 kB"
    },
    {
      "path": "build/react-router/umd/react-router.production.min.js",
      "compression": "none",
      "maxSize": "6 kB"
    },
    {
      "path": "build/react-router-dom/react-router-dom.production.min.js",
      "compression": "none",
      "maxSize": "2 kB"
    },
    {
      "path": "build/react-router-dom/umd/react-router-dom.production.min.js",
      "compression": "none",
      "maxSize": "4.5 kB"
    }
  ]
}
