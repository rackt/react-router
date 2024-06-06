import { removeExports } from "./remove-exports";

describe("removeExports", () => {
  test("arrow function", () => {
    let result = removeExports(
      `
      export const serverExport_1 = () => {}
      export const serverExport_2 = () => {}

      export const clientExport_1 = () => {}
      export const clientExport_2 = () => {}
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "export const clientExport_1 = () => {};
    export const clientExport_2 = () => {};"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("arrow function with dependencies", () => {
    let result = removeExports(
      `
      import { serverLib } from 'server-lib'
      import { clientLib } from 'client-lib'
      import { sharedLib } from 'shared-lib'

      const SERVER_STRING = 'SERVER_STRING'

      const sharedUtil = () => sharedLib()
      const serverUtil = () => sharedUtil(serverLib(SERVER_STRING))
      const clientUtil = () => sharedUtil(clientLib())

      export const serverExport_1 = () => serverUtil()
      export const serverExport_2 = () => serverUtil()

      export const clientExport_1 = () => clientUtil()
      export const clientExport_2 = () => clientUtil()
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "import { clientLib } from 'client-lib';
    import { sharedLib } from 'shared-lib';
    const sharedUtil = () => sharedLib();
    const clientUtil = () => sharedUtil(clientLib());
    export const clientExport_1 = () => clientUtil();
    export const clientExport_2 = () => clientUtil();"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("function statement", () => {
    let result = removeExports(
      `
      export function serverExport_1(){}
      export function serverExport_2(){}

      export function clientExport_1(){}
      export function clientExport_2(){}
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "export function clientExport_1() {}
    export function clientExport_2() {}"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("function statement with dependencies", () => {
    let result = removeExports(
      `
      import { serverLib } from 'server-lib'
      import { clientLib } from 'client-lib'
      import { sharedLib } from 'shared-lib'

      const SERVER_STRING = 'SERVER_STRING'

      function sharedUtil() { return sharedLib() }
      function serverUtil() { return sharedUtil(serverLib(SERVER_STRING)) }
      function clientUtil() { return sharedUtil(clientLib()) }

      export function serverExport_1() { return serverUtil() }
      export function serverExport_2() { return serverUtil() }

      export function clientExport_1() { return clientUtil() }
      export function clientExport_2() { return clientUtil() }
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "import { clientLib } from 'client-lib';
    import { sharedLib } from 'shared-lib';
    function sharedUtil() {
      return sharedLib();
    }
    function clientUtil() {
      return sharedUtil(clientLib());
    }
    export function clientExport_1() {
      return clientUtil();
    }
    export function clientExport_2() {
      return clientUtil();
    }"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("object", () => {
    let result = removeExports(
      `
      export const serverExport_1 = {}
      export const serverExport_2 = {}

      export const clientExport_1 = {}
      export const clientExport_2 = {}
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "export const clientExport_1 = {};
    export const clientExport_2 = {};"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("object with dependencies", () => {
    let result = removeExports(
      `
      import { serverLib } from 'server-lib'
      import { clientLib } from 'client-lib'
      import { sharedLib } from 'shared-lib'

      const SERVER_STRING = 'SERVER_STRING'

      const sharedUtil = () => sharedLib()
      const serverUtil = () => sharedUtil(serverLib(SERVER_STRING))
      const clientUtil = () => sharedUtil(clientLib())

      export const serverExport_1 = { value: serverUtil() }
      export const serverExport_2 = { value: serverUtil() }

      export const clientExport_1 = { value: clientUtil() }
      export const clientExport_2 = { value: clientUtil() }
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "import { clientLib } from 'client-lib';
    import { sharedLib } from 'shared-lib';
    const sharedUtil = () => sharedLib();
    const clientUtil = () => sharedUtil(clientLib());
    export const clientExport_1 = {
      value: clientUtil()
    };
    export const clientExport_2 = {
      value: clientUtil()
    };"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("function call", () => {
    let result = removeExports(
      `
      export const serverExport_1 = globalFunction()
      export const serverExport_2 = globalFunction()

      export const clientExport_1 = globalFunction()
      export const clientExport_2 = globalFunction()
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "export const clientExport_1 = globalFunction();
    export const clientExport_2 = globalFunction();"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("function call with dependencies", () => {
    let result = removeExports(
      `
      import { serverLib } from 'server-lib'
      import { clientLib } from 'client-lib'
      import { sharedLib } from 'shared-lib'

      const SERVER_STRING = 'SERVER_STRING'

      const sharedUtil = () => sharedLib()
      const serverUtil = () => sharedUtil(serverLib(SERVER_STRING))
      const clientUtil = () => sharedUtil(clientLib())

      export const serverExport_1 = serverUtil()
      export const serverExport_2 = serverUtil()

      export const clientExport_1 = clientUtil()
      export const clientExport_2 = clientUtil()
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "import { clientLib } from 'client-lib';
    import { sharedLib } from 'shared-lib';
    const sharedUtil = () => sharedLib();
    const clientUtil = () => sharedUtil(clientLib());
    export const clientExport_1 = clientUtil();
    export const clientExport_2 = clientUtil();"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("iife", () => {
    let result = removeExports(
      `
      export const serverExport_1 = (() => {})()
      export const serverExport_2 = (() => {})()

      export const clientExport_1 = (() => {})()
      export const clientExport_2 = (() => {})()
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "export const clientExport_1 = (() => {})();
    export const clientExport_2 = (() => {})();"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("iife with dependencies", () => {
    let result = removeExports(
      `
      import { serverLib } from 'server-lib'
      import { clientLib } from 'client-lib'
      import { sharedLib } from 'shared-lib'

      const SERVER_STRING = 'SERVER_STRING'

      const sharedUtil = () => sharedLib()
      const serverUtil = () => sharedUtil(serverLib(SERVER_STRING))
      const clientUtil = () => sharedUtil(clientLib())

      export const serverExport_1 = (() => serverUtil())()
      export const serverExport_2 = (() => serverUtil())()

      export const clientExport_1 = (() => clientUtil())()
      export const clientExport_2 = (() => clientUtil())()
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "import { clientLib } from 'client-lib';
    import { sharedLib } from 'shared-lib';
    const sharedUtil = () => sharedLib();
    const clientUtil = () => sharedUtil(clientLib());
    export const clientExport_1 = (() => clientUtil())();
    export const clientExport_2 = (() => clientUtil())();"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("re-export", () => {
    let result = removeExports(
      `
      export { serverExport_1 } from './server/1'
      export { serverExport_2 } from './server/2'

      export { clientExport_1 } from './client/1'
      export { clientExport_2 } from './client/2'
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "export { clientExport_1 } from './client/1';
    export { clientExport_2 } from './client/2';"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("re-export multiple", () => {
    let result = removeExports(
      `
      export { serverExport_1, serverExport_2 } from './server'

      export { clientExport_1, clientExport_2 } from './client'
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(
      "\"export { clientExport_1, clientExport_2 } from './client';\""
    );
    expect(result.code).not.toMatch(/server/i);
  });

  test("re-export manual", () => {
    let result = removeExports(
      `
      import { serverExport_1 } from './server/1'
      import { serverExport_2 } from './server/2'
      import { clientExport_1 } from './client/1'
      import { clientExport_2 } from './client/2'

      export { serverExport_1 }
      export { serverExport_2 }

      export { clientExport_1 }
      export { clientExport_2 }
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "import { clientExport_1 } from './client/1';
    import { clientExport_2 } from './client/2';
    export { clientExport_1 };
    export { clientExport_2 };"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("number", () => {
    let result = removeExports(
      `
      export const serverExport_1 = 123
      export const serverExport_2 = 123

      export const clientExport_1 = 123
      export const clientExport_2 = 123
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "export const clientExport_1 = 123;
    export const clientExport_2 = 123;"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("string", () => {
    let result = removeExports(
      `
      export const serverExport_1 = 'string'
      export const serverExport_2 = 'string'

      export const clientExport_1 = 'string'
      export const clientExport_2 = 'string'
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "export const clientExport_1 = 'string';
    export const clientExport_2 = 'string';"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("string reference", () => {
    let result = removeExports(
      `
      const SERVER_STRING = 'SERVER_STRING';
      const CLIENT_STRING = 'CLIENT_STRING';

      export const serverExport_1 = SERVER_STRING
      export const serverExport_2 = SERVER_STRING

      export const clientExport_1 = CLIENT_STRING
      export const clientExport_2 = CLIENT_STRING
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "const CLIENT_STRING = 'CLIENT_STRING';
    export const clientExport_1 = CLIENT_STRING;
    export const clientExport_2 = CLIENT_STRING;"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("null", () => {
    let result = removeExports(
      `
      export const serverExport_1 = null
      export const serverExport_2 = null

      export const clientExport_1 = null
      export const clientExport_2 = null
    `,
      ["serverExport_1", "serverExport_2"]
    );
    expect(result.code).toMatchInlineSnapshot(`
    "export const clientExport_1 = null;
    export const clientExport_2 = null;"
  `);
    expect(result.code).not.toMatch(/server/i);
  });

  test("default function", () => {
    let result = removeExports(
      `
      export default function serverExport(){}
    `,
      ["default"]
    );
    expect(result.code).toMatchInlineSnapshot(`""`);
  });
});
