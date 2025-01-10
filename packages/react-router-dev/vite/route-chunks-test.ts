import dedent from "dedent";

import type { Cache } from "./cache";
import {
  hasChunkableExport,
  getChunkedExport,
  omitChunkedExports,
} from "./route-chunks";

let cache: [Cache, string] = [new Map(), "cacheKey"];

describe("route chunks", () => {
  describe("chunkable", () => {
    test("functions with no identifiers", () => {
      const code = dedent`
        export default function () { return null; }
        export function target1() { return null; }
        export function other1() { return null; }
        export const target2 = () => null;
        export const other2 = () => null;
      `;
      expect(hasChunkableExport(code, "default", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "target1", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "target2", ...cache)).toBe(true);
      expect(getChunkedExport(code, "default", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "export default function () {
          return null;
        }"
      `);
      expect(getChunkedExport(code, "target1", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "export function target1() {
          return null;
        }"
      `);
      expect(
        getChunkedExport(code, "target2", {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const target2 = () => null;"`);
      expect(
        omitChunkedExports(
          code,
          ["default", "target1", "target2"],
          {},
          ...cache
        )?.code
      ).toMatchInlineSnapshot(`
        "export function other1() {
          return null;
        }
        export const other2 = () => null;"
      `);
    });

    test("functions referencing their own identifiers", () => {
      const code = dedent`
        import defaultMessage, {
          targetMessage1,
          targetMessage2,
          otherMessage1,
          otherMessage2,
        } from "./messages";
        import * as messages from "./messages"; 

        const getDefaultMessage = () => defaultMessage;
        const getTargetMessage1 = () => targetMessage1;
        const getOtherMessage1 = () => otherMessage1;
        function getTargetMessage2() { return targetMessage2; }
        function getOtherMessage2() { return otherMessage2; }
        function getNamespacedMessage() { return messages.namespacedMessage; }

        export default function() { return getDefaultMessage(); }
        export function namespaced() { getNamespacedMessage(); }
        export function target1() { return getTargetMessage1(); }
        export function other1() { return getOtherMessage1(); }
        export const target2 = () => getTargetMessage2();
        export const other2 = () => getOtherMessage2();
      `;
      expect(hasChunkableExport(code, "default", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "namespaced", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "target1", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "target2", ...cache)).toBe(true);
      expect(getChunkedExport(code, "default", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import defaultMessage from "./messages";
        const getDefaultMessage = () => defaultMessage;
        export default function () {
          return getDefaultMessage();
        }"
      `);
      expect(getChunkedExport(code, "namespaced", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import * as messages from "./messages";
        function getNamespacedMessage() {
          return messages.namespacedMessage;
        }
        export function namespaced() {
          getNamespacedMessage();
        }"
      `);
      expect(getChunkedExport(code, "target1", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { targetMessage1 } from "./messages";
        const getTargetMessage1 = () => targetMessage1;
        export function target1() {
          return getTargetMessage1();
        }"
      `);
      expect(getChunkedExport(code, "target2", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { targetMessage2 } from "./messages";
        function getTargetMessage2() {
          return targetMessage2;
        }
        export const target2 = () => getTargetMessage2();"
      `);
      expect(
        omitChunkedExports(
          code,
          ["default", "target1", "target2", "namespaced"],
          {},
          ...cache
        )?.code
      ).toMatchInlineSnapshot(`
        "import { otherMessage1, otherMessage2 } from "./messages";
        const getOtherMessage1 = () => otherMessage1;
        function getOtherMessage2() {
          return otherMessage2;
        }
        export function other1() {
          return getOtherMessage1();
        }
        export const other2 = () => getOtherMessage2();"
      `);
    });

    test("imports and exports using shared statements", () => {
      const code = dedent`
        import { chunk1Import, chunk2Import, mainImport } from "./shared";
        const chunk1 = () => chunk1Import;
        const chunk2 = () => chunk2Import;
        const main = () => mainImport;
        export { chunk1, chunk2, main };
      `;
      expect(hasChunkableExport(code, "chunk1", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "chunk2", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk1", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunk1Import } from "./shared";
        const chunk1 = () => chunk1Import;
        export { chunk1 };"
      `);
      expect(getChunkedExport(code, "chunk2", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunk2Import } from "./shared";
        const chunk2 = () => chunk2Import;
        export { chunk2 };"
      `);
      expect(omitChunkedExports(code, ["chunk1", "chunk2"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { mainImport } from "./shared";
        const main = () => mainImport;
        export { main };"
      `);
    });

    test("shared imports", () => {
      const code = dedent`
        import { shared } from "./shared";
        export const chunk = shared("chunk");
        export const main = shared("main");
      `;
      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { shared } from "./shared";
        export const chunk = shared("chunk");"
      `);
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { shared } from "./shared";
        export const main = shared("main");"
      `);
    });

    test("shared imports across chunks but not main chunk", () => {
      const code = dedent`
        import { shared } from "./shared";
        export const chunk1 = shared("chunk1");
        export const chunk2 = shared("chunk2");
        export const main = "main";
      `;
      expect(hasChunkableExport(code, "chunk1", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "chunk2", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk1", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { shared } from "./shared";
        export const chunk1 = shared("chunk1");"
      `);
      expect(getChunkedExport(code, "chunk2", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { shared } from "./shared";
        export const chunk2 = shared("chunk2");"
      `);
      expect(
        omitChunkedExports(code, ["chunk1", "chunk2"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("import with side effect usage", () => {
      const code = dedent`
        import { sideEffect } from "./side-effect";
        sideEffect();
        export const chunk = "chunk";
        export const main = "main";
      `;
      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(
        getChunkedExport(code, "chunk", {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const chunk = "chunk";"`);
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { sideEffect } from "./side-effect";
        sideEffect();
        export const main = "main";"
      `);
    });

    test("re-exports using shared statement", () => {
      const code = dedent`
        export { chunk1, chunk2, main } from "./shared";
      `;
      expect(hasChunkableExport(code, "chunk1", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "chunk2", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(
        getChunkedExport(code, "chunk1", {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export { chunk1 } from "./shared";"`);
      expect(
        getChunkedExport(code, "chunk2", {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export { chunk2 } from "./shared";"`);
      expect(
        omitChunkedExports(code, ["chunk1", "chunk2"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export { main } from "./shared";"`);
    });

    test("aliased re-exports using shared statement", () => {
      const code = dedent`
        export {
          foo as chunk1,
          bar as chunk2,
          baz as main,
        } from "./shared";
      `;
      expect(hasChunkableExport(code, "chunk1", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "chunk2", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(
        getChunkedExport(code, "chunk1", {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export { foo as chunk1 } from "./shared";"`);
      expect(
        getChunkedExport(code, "chunk2", {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export { bar as chunk2 } from "./shared";"`);
      expect(
        omitChunkedExports(code, ["chunk1", "chunk2"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export { baz as main } from "./shared";"`);
    });

    test("isolated exported variable declarations sharing an export statement", () => {
      const code = dedent`
        import { chunkMessage, mainMessage } from "./messages";
        export const chunk = chunkMessage,
          main = mainMessage;
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage } from "./messages";
        export const chunk = chunkMessage;"
      `);
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { mainMessage } from "./messages";
        export const main = mainMessage;"
      `);
    });

    test("isolated exported destructured array variable declarations sharing an export statement", () => {
      const code = dedent`
        import { chunkMessage, mainMessage } from "./messages";
        export const [chunk] = [chunkMessage],
          [main] = [mainMessage];
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage } from "./messages";
        export const [chunk] = [chunkMessage];"
      `);
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { mainMessage } from "./messages";
        export const [main] = [mainMessage];"
      `);
    });

    test("isolated exported destructured array spread variable declarations sharing an export statement", () => {
      const code = dedent`
        import { chunkMessage, mainMessage } from "./messages";
        export const [...chunk] = [...chunkMessage],
          [...main] = [...mainMessage];
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage } from "./messages";
        export const [...chunk] = [...chunkMessage];"
      `);
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { mainMessage } from "./messages";
        export const [...main] = [...mainMessage];"
      `);
    });

    test("isolated exported destructured object variable declarations sharing an export statement", () => {
      const code = dedent`
        import { chunkMessage, mainMessage } from "./messages";
        export const { chunkMessage: chunk } = { chunkMessage },
          { mainMessage: main } = { mainMessage };
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage } from "./messages";
        export const {
          chunkMessage: chunk
        } = {
          chunkMessage
        };"
      `);
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { mainMessage } from "./messages";
        export const {
          mainMessage: main
        } = {
          mainMessage
        };"
      `);
    });

    test("isolated exported destructured object spread variable declarations sharing an export statement", () => {
      const code = dedent`
        import { chunkMessage, mainMessage } from "./messages";
        export const { ...chunk } = { ...chunkMessage },
          { ...main } = { ...mainMessage };
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage } from "./messages";
        export const {
          ...chunk
        } = {
          ...chunkMessage
        };"
      `);
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { mainMessage } from "./messages";
        export const {
          ...main
        } = {
          ...mainMessage
        };"
      `);
    });

    test("isolated exported nested destructured variable declarations sharing an export statement", () => {
      const code = dedent`
        import { chunkMessage, mainMessage } from "./messages";
        export const [, { nested: { ...chunk } }] = [null, { nested: { ...chunkMessage } }],
          [, { nested: { ...main } }] = [null, { nested: { ...mainMessage } }];
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage } from "./messages";
        export const [, {
          nested: {
            ...chunk
          }
        }] = [null, {
          nested: {
            ...chunkMessage
          }
        }];"
      `);
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { mainMessage } from "./messages";
        export const [, {
          nested: {
            ...main
          }
        }] = [null, {
          nested: {
            ...mainMessage
          }
        }];"
      `);
    });

    test("empty imports are placed in main chunk", () => {
      const code = dedent`
        export const chunk = "chunk";
        export {};
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(
        getChunkedExport(code, "chunk", {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const chunk = "chunk";"`);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export {};"`);
    });

    test("side effect imports are placed in main chunk", () => {
      const code = dedent`
        import "./side-effect";
        export const chunk = "chunk";
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(
        getChunkedExport(code, "chunk", {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const chunk = "chunk";"`);
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import "./side-effect";
        export const main = "main";"
      `);
    });

    test("unused imports are placed in main chunk", () => {
      const code = dedent`
        import { unused } from "./unused";
        export const chunk = "chunk";
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(
        getChunkedExport(code, "chunk", {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const chunk = "chunk";"`);
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { unused } from "./unused";
        export const main = "main";"
      `);
    });
  });

  describe("partially chunkable", () => {
    test("function with no identifiers, one with shared identifiers", () => {
      const code = dedent`
      import defaultMessage, { target1Message } from "./messages";
      import { sharedMessage } from "./sharedMessage";

      const getDefaultMessage = () => defaultMessage;
      const getTarget1Message = () => target1Message;
      const getSharedMessage = () => sharedMessage;

      export default function () { return getDefaultMessage(); }
      export function target1() { return getTarget1Message(); }
      export const target2 = () => getSharedMessage();
      export const other1 = () => getSharedMessage();
      export const other2 = () => getSharedMessage();
    `;
      expect(hasChunkableExport(code, "default", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "target1", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "target2", ...cache)).toBe(false);
      expect(getChunkedExport(code, "default", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import defaultMessage from "./messages";
        const getDefaultMessage = () => defaultMessage;
        export default function () {
          return getDefaultMessage();
        }"
      `);
      expect(getChunkedExport(code, "target1", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { target1Message } from "./messages";
        const getTarget1Message = () => target1Message;
        export function target1() {
          return getTarget1Message();
        }"
      `);
      expect(getChunkedExport(code, "target2", {}, ...cache)).toBeUndefined();
      expect(
        omitChunkedExports(
          code,
          ["default", "target1", "target2"],
          {},
          ...cache
        )?.code
      ).toMatchInlineSnapshot(`
        "import { sharedMessage } from "./sharedMessage";
        const getSharedMessage = () => sharedMessage;
        export const target2 = () => getSharedMessage();
        export const other1 = () => getSharedMessage();
        export const other2 = () => getSharedMessage();"
      `);
    });

    test("function referencing its own identifiers, another one sharing an identifier", () => {
      const code = dedent`
        import { targetMessage1 } from "./targetMessage1";
        import { sharedMessage } from "./sharedMessage";

        const getTargetMessage1 = () => targetMessage1;
        const getOtherMessage1 = () => sharedMessage;
        function getTargetMessage2() { return sharedMessage; }
        function getOtherMessage2() { return sharedMessage; }

        export function target1() { return getTargetMessage1(); }
        export function other1() { return getOtherMessage1(); }
        export const target2 = () => getTargetMessage2();
        export const other2 = () => getOtherMessage2();
      `;
      expect(hasChunkableExport(code, "target1", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "target2", ...cache)).toBe(false);
      expect(getChunkedExport(code, "target1", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { targetMessage1 } from "./targetMessage1";
        const getTargetMessage1 = () => targetMessage1;
        export function target1() {
          return getTargetMessage1();
        }"
      `);
      expect(getChunkedExport(code, "target2", {}, ...cache)).toBeUndefined();
      expect(
        omitChunkedExports(code, ["target1", "target2"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`
        "import { sharedMessage } from "./sharedMessage";
        const getOtherMessage1 = () => sharedMessage;
        function getTargetMessage2() {
          return sharedMessage;
        }
        function getOtherMessage2() {
          return sharedMessage;
        }
        export function other1() {
          return getOtherMessage1();
        }
        export const target2 = () => getTargetMessage2();
        export const other2 = () => getOtherMessage2();"
      `);
    });

    test("isolated exported variable declarations sharing an export statement, another one with shared variable declaration", () => {
      const code = dedent`
      import { chunkableMessage, unchunkableMessage } from "./messages";
        export const chunkable = chunkableMessage,
          unchunkable = unchunkableMessage,
          main = unchunkable;
      `;

      expect(hasChunkableExport(code, "chunkable", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "unchunkable", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(false);
      expect(getChunkedExport(code, "chunkable", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkableMessage } from "./messages";
        export const chunkable = chunkableMessage;"
      `);
      expect(
        getChunkedExport(code, "unchunkable", {}, ...cache)
      ).toBeUndefined();
      expect(
        omitChunkedExports(code, ["chunkable", "unchunkable"], {}, ...cache)
          ?.code
      ).toMatchInlineSnapshot(`
        "import { unchunkableMessage } from "./messages";
        export const unchunkable = unchunkableMessage,
          main = unchunkable;"
      `);
    });

    test("isolated exported destructured variable declarations sharing an export statement, another one with shared variable declaration", () => {
      const code = dedent`
      import { chunkableMessage, unchunkableMessage } from "./messages";
        export const { chunkableMessage: chunkable } = { chunkableMessage },
          [unchunkable] = [unchunkableMessage],
          { unchunkable: main } = { unchunkable };
      `;

      expect(hasChunkableExport(code, "chunkable", ...cache)).toBe(true);
      expect(hasChunkableExport(code, "unchunkable", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(false);
      expect(getChunkedExport(code, "chunkable", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkableMessage } from "./messages";
        export const {
          chunkableMessage: chunkable
        } = {
          chunkableMessage
        };"
      `);
      expect(
        getChunkedExport(code, "unchunkable", {}, ...cache)
      ).toBeUndefined();
      expect(
        omitChunkedExports(code, ["chunkable", "unchunkable"], {}, ...cache)
          ?.code
      ).toMatchInlineSnapshot(`
        "import { unchunkableMessage } from "./messages";
        export const [unchunkable] = [unchunkableMessage],
          {
            unchunkable: main
          } = {
            unchunkable
          };"
      `);
    });
  });

  describe("not chunkable", () => {
    test("exports not present", () => {
      const code = dedent`
        export default function () {}
      `;
      expect(hasChunkableExport(code, "target1", ...cache)).toBe(false);
      expect(getChunkedExport(code, "target1", {}, ...cache)).toBeUndefined();
      expect(hasChunkableExport(code, "target2", ...cache)).toBe(false);
      expect(getChunkedExport(code, "target2", {}, ...cache)).toBeUndefined();
      expect(
        omitChunkedExports(code, ["target1", "target2"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export default function () {}"`);
    });

    test("functions sharing a variable", () => {
      const code = dedent`
        const sharedMessage = "shared";
        const getTargetMessage1 = () => sharedMessage;
        const getTargetMessage2 = () => sharedMessage;
        const getOtherMessage1 = () => sharedMessage;
        const getOtherMessage2 = () => sharedMessage;
        export const target1 = () => getTargetMessage1();
        export const target2 = () => getTargetMessage2();
        export const other1 = () => getOtherMessage1();
        export const other2 = () => getOtherMessage2();
      `;
      expect(hasChunkableExport(code, "target1", ...cache)).toBe(false);
      expect(getChunkedExport(code, "target1", {}, ...cache)).toBeUndefined();
      expect(hasChunkableExport(code, "target2", ...cache)).toBe(false);
      expect(getChunkedExport(code, "target2", {}, ...cache)).toBeUndefined();
      expect(
        omitChunkedExports(code, ["target1", "target2"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`
        "const sharedMessage = "shared";
        const getTargetMessage1 = () => sharedMessage;
        const getTargetMessage2 = () => sharedMessage;
        const getOtherMessage1 = () => sharedMessage;
        const getOtherMessage2 = () => sharedMessage;
        export const target1 = () => getTargetMessage1();
        export const target2 = () => getTargetMessage2();
        export const other1 = () => getOtherMessage1();
        export const other2 = () => getOtherMessage2();"
      `);
    });

    test("functions sharing an imported identifier", () => {
      const code = dedent`
        import { sharedMessage } from "./messages";
        const getTargetMessage1 = () => sharedMessage;
        const getTargetMessage2 = () => sharedMessage;
        const getOtherMessage1 = () => sharedMessage;
        const getOtherMessage2 = () => sharedMessage;
        export const target1 = () => getTargetMessage1();
        export const target2 = () => getTargetMessage2();
        export const other1 = () => getOtherMessage1();
        export const other2 = () => getOtherMessage2();
      `;
      expect(hasChunkableExport(code, "target1", ...cache)).toBe(false);
      expect(getChunkedExport(code, "target1", {}, ...cache)).toBeUndefined();
      expect(hasChunkableExport(code, "target2", ...cache)).toBe(false);
      expect(getChunkedExport(code, "target2", {}, ...cache)).toBeUndefined();
      expect(
        omitChunkedExports(code, ["target1", "target2"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`
        "import { sharedMessage } from "./messages";
        const getTargetMessage1 = () => sharedMessage;
        const getTargetMessage2 = () => sharedMessage;
        const getOtherMessage1 = () => sharedMessage;
        const getOtherMessage2 = () => sharedMessage;
        export const target1 = () => getTargetMessage1();
        export const target2 = () => getTargetMessage2();
        export const other1 = () => getOtherMessage1();
        export const other2 = () => getOtherMessage2();"
      `);
    });

    test("functions sharing a default import", () => {
      const code = dedent`
        import sharedMessage from "./messages";
        const getTargetMessage1 = () => sharedMessage;
        const getTargetMessage2 = () => sharedMessage;
        const getOtherMessage1 = () => sharedMessage;
        const getOtherMessage2 = () => sharedMessage;
        export const target1 = () => getTargetMessage1();
        export const target2 = () => getTargetMessage2();
        export const other1 = () => getOtherMessage1();
        export const other2 = () => getOtherMessage2();
      `;
      expect(hasChunkableExport(code, "target1", ...cache)).toBe(false);
      expect(getChunkedExport(code, "target1", {}, ...cache)).toBeUndefined();
      expect(hasChunkableExport(code, "target2", ...cache)).toBe(false);
      expect(getChunkedExport(code, "target2", {}, ...cache)).toBeUndefined();
      expect(
        omitChunkedExports(code, ["target1", "target2"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`
        "import sharedMessage from "./messages";
        const getTargetMessage1 = () => sharedMessage;
        const getTargetMessage2 = () => sharedMessage;
        const getOtherMessage1 = () => sharedMessage;
        const getOtherMessage2 = () => sharedMessage;
        export const target1 = () => getTargetMessage1();
        export const target2 = () => getTargetMessage2();
        export const other1 = () => getOtherMessage1();
        export const other2 = () => getOtherMessage2();"
      `);
    });

    test("functions sharing a namespace import", () => {
      const code = dedent`
        import * as messages from "./messages";
        const getTargetMessage1 = () => messages.targetMessage1;
        const getTargetMessage2 = () => messages.targetMessage2;
        const getOtherMessage1 = () => messages.otherMessage1;
        const getOtherMessage2 = () => messages.otherMessage2;
        export const target1 = () => getTargetMessage1();
        export const target2 = () => getTargetMessage2();
        export const other1 = () => getOtherMessage1();
        export const other2 = () => getOtherMessage2();
      `;
      expect(hasChunkableExport(code, "target1", ...cache)).toBe(false);
      expect(getChunkedExport(code, "target1", {}, ...cache)).toBeUndefined();
      expect(hasChunkableExport(code, "target2", ...cache)).toBe(false);
      expect(getChunkedExport(code, "target2", {}, ...cache)).toBeUndefined();
      expect(
        omitChunkedExports(code, ["target1", "target2"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`
        "import * as messages from "./messages";
        const getTargetMessage1 = () => messages.targetMessage1;
        const getTargetMessage2 = () => messages.targetMessage2;
        const getOtherMessage1 = () => messages.otherMessage1;
        const getOtherMessage2 = () => messages.otherMessage2;
        export const target1 = () => getTargetMessage1();
        export const target2 = () => getTargetMessage2();
        export const other1 = () => getOtherMessage1();
        export const other2 = () => getOtherMessage2();"
      `);
    });

    test("exported variable declarations sharing an export statement", () => {
      const code = dedent`
        import { sharedMessage } from "./messages";
        export const chunk = sharedMessage,
          main = chunk;
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(false);
      expect(getChunkedExport(code, "chunk", {}, ...cache)).toBeUndefined();
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { sharedMessage } from "./messages";
        export const chunk = sharedMessage,
          main = chunk;"
      `);
    });

    test("exported destructured array variable declarations sharing an export statement", () => {
      const code = dedent`
        import { sharedMessage } from "./messages";
        export const [chunk] = [sharedMessage],
          [main] = [chunk];
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(false);
      expect(getChunkedExport(code, "chunk", {}, ...cache)).toBeUndefined();
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { sharedMessage } from "./messages";
        export const [chunk] = [sharedMessage],
          [main] = [chunk];"
      `);
    });

    test("exported destructured array variable declarations sharing an assignment", () => {
      const code = dedent`
        import { chunkMessage, mainMessage } from "./messages";
        export const [chunk, main] = [chunkMessage, mainMessage];
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(false);
      expect(getChunkedExport(code, "chunk", {}, ...cache)).toBeUndefined();
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage, mainMessage } from "./messages";
        export const [chunk, main] = [chunkMessage, mainMessage];"
      `);
    });

    test("exported destructured object variable declarations sharing an export statement", () => {
      const code = dedent`
        import { sharedMessage } from "./messages";
        export const { sharedMessage: chunk } = { sharedMessage },
          { chunk: main } = { chunk };
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(false);
      expect(getChunkedExport(code, "chunk", {}, ...cache)).toBeUndefined();
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { sharedMessage } from "./messages";
        export const {
            sharedMessage: chunk
          } = {
            sharedMessage
          },
          {
            chunk: main
          } = {
            chunk
          };"
      `);
    });

    test("exported destructured object variable declarations sharing an assignment", () => {
      const code = dedent`
        import { chunkMessage, mainMessage } from "./messages";
        export const { chunkMessage: chunk, mainMessage: main } = { chunkMessage, mainMessage };
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(false);
      expect(getChunkedExport(code, "chunk", {}, ...cache)).toBeUndefined();
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage, mainMessage } from "./messages";
        export const {
          chunkMessage: chunk,
          mainMessage: main
        } = {
          chunkMessage,
          mainMessage
        };"
      `);
    });

    test("exported destructured object spread variable declarations sharing an export statement", () => {
      const code = dedent`
        import { sharedMessage } from "./messages";
        export const { ...chunk } = { ...sharedMessage },
          { ...main } = { ...chunk };
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(false);
      expect(getChunkedExport(code, "chunk", {}, ...cache)).toBeUndefined();
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { sharedMessage } from "./messages";
        export const {
            ...chunk
          } = {
            ...sharedMessage
          },
          {
            ...main
          } = {
            ...chunk
          };"
      `);
    });

    test("exported destructured object spread variable declarations sharing an assignment", () => {
      const code = dedent`
        import { chunkMessage, mainMessage } from "./messages";
        export const {
          chunkMessage: { ...chunk },
          mainMessage: { ...main }
        } = {
          chunkMessage: { ...chunkMessage },
          mainMessage: { ...mainMessage }
        };
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(false);
      expect(getChunkedExport(code, "chunk", {}, ...cache)).toBeUndefined();
      expect(omitChunkedExports(code, ["chunk"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage, mainMessage } from "./messages";
        export const {
          chunkMessage: {
            ...chunk
          },
          mainMessage: {
            ...main
          }
        } = {
          chunkMessage: {
            ...chunkMessage
          },
          mainMessage: {
            ...mainMessage
          }
        };"
      `);
    });

    test("circular dependencies between exports", () => {
      const code = dedent`
        export const getChunkMessage = (recurse = true) => {
          return "chunk " + (recurse ? getMainMessage(false) : "");
        };
        export const getMainMessage = (recurse = true) => {
          return "main " + (recurse ? getChunkMessage(false) : "");
        };
        export const chunk = getChunkMessage();
        export const main = getMainMessage();
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(false);
      expect(getChunkedExport(code, "chunk", {}, ...cache)).toBeUndefined();
      expect(getChunkedExport(code, "main", {}, ...cache)).toBeUndefined();
      expect(omitChunkedExports(code, ["chunk", "main"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "export const getChunkMessage = (recurse = true) => {
          return "chunk " + (recurse ? getMainMessage(false) : "");
        };
        export const getMainMessage = (recurse = true) => {
          return "main " + (recurse ? getChunkMessage(false) : "");
        };
        export const chunk = getChunkMessage();
        export const main = getMainMessage();"
      `);
    });

    test("shared imports across chunks but not main chunk with shared side effect usage", () => {
      const code = dedent`
        import { shared } from "./shared";
        shared("side-effect");
        export const chunk1 = shared("chunk1");
        export const chunk2 = shared("chunk2");
        export const main = "main";
      `;
      expect(hasChunkableExport(code, "chunk1", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "chunk2", ...cache)).toBe(false);
      expect(hasChunkableExport(code, "main", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk1", {}, ...cache)).toBeUndefined();
      expect(getChunkedExport(code, "chunk2", {}, ...cache)).toBeUndefined();
      expect(omitChunkedExports(code, ["chunk1", "chunk2"], {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { shared } from "./shared";
        shared("side-effect");
        export const chunk1 = shared("chunk1");
        export const chunk2 = shared("chunk2");
        export const main = "main";"
      `);
    });
  });

  describe("export dependency analysis", () => {
    test("top level await", () => {
      const code = dedent`
        import { getMessage } from "./messages";
        let messages = [];
        await getMessage().then((message) => {
          messages.push(message);
        });
        export const chunk = messages;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { getMessage } from "./messages";
        let messages = [];
        await getMessage().then(message => {
          messages.push(message);
        });
        export const chunk = messages;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("if else", () => {
      const code = dedent`
        import { check } from "./check";
        import { chunkMessage1, chunkMessage2 } from "./messages";
        let messages = [];
        if (check()) {
          messages.push(chunkMessage1);
        } else {
          messages.push(chunkMessage2);
        }
        export const chunk = messages;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { check } from "./check";
        import { chunkMessage1, chunkMessage2 } from "./messages";
        let messages = [];
        if (check()) {
          messages.push(chunkMessage1);
        } else {
          messages.push(chunkMessage2);
        }
        export const chunk = messages;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("try catch", () => {
      const code = dedent`
        import { chunkMessage1, errorMessage } from "./messages";
        let messages = [];
        try {
          messages.push(chunkMessage1);
        } catch (error) {
          messages.push(errorMessage(error));
        }
        export const chunk = messages;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage1, errorMessage } from "./messages";
        let messages = [];
        try {
          messages.push(chunkMessage1);
        } catch (error) {
          messages.push(errorMessage(error));
        }
        export const chunk = messages;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("for...of", () => {
      const code = dedent`
        import { messages } from "./messages";
        let chunkMessages = [];
        for (let message of messages) {
          chunkMessages.push(message);
        }
        export const chunk = chunkMessages;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { messages } from "./messages";
        let chunkMessages = [];
        for (let message of messages) {
          chunkMessages.push(message);
        }
        export const chunk = chunkMessages;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("for...of with destructuring and default value", () => {
      const code = dedent`
        import { messages, defaultMessage } from "./messages";
        let chunkMessages = [];
        for (let { key, value = defaultMessage } of messages) {
          chunkMessages.push([key, value]);
        }
        export const chunk = chunkMessages;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { messages, defaultMessage } from "./messages";
        let chunkMessages = [];
        for (let {
          key,
          value = defaultMessage
        } of messages) {
          chunkMessages.push([key, value]);
        }
        export const chunk = chunkMessages;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("block", () => {
      const code = dedent`
        import { chunkMessage } from "./messages";
        let messages = [];
        {
          messages.push(chunkMessage);
        }
        export const chunk = messages;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage } from "./messages";
        let messages = [];
        {
          messages.push(chunkMessage);
        }
        export const chunk = messages;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("default argument", () => {
      const code = dedent`
        import { defaultMessage } from "./defaultMessage";
        const getChunkMessage = (message = defaultMessage) => message.toUpperCase();
        export const chunk = getChunkMessage();
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { defaultMessage } from "./defaultMessage";
        const getChunkMessage = (message = defaultMessage) => message.toUpperCase();
        export const chunk = getChunkMessage();"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("destructured argument with default value", () => {
      const code = dedent`
        import { defaultMessage } from "./defaultMessage";
        const getChunkMessage = ([{ defaultMessage: message }] = [{ defaultMessage }]) => message.toUpperCase();
        export const chunk = getChunkMessage();
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { defaultMessage } from "./defaultMessage";
        const getChunkMessage = ([{
          defaultMessage: message
        }] = [{
          defaultMessage
        }]) => message.toUpperCase();
        export const chunk = getChunkMessage();"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("reassignment", () => {
      const code = dedent`
        import { reassignedMessage } from "./messages";  
        let chunkMessage = "chunk";
        chunkMessage = reassignedMessage;
        export const chunk = chunkMessage;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { reassignedMessage } from "./messages";
        let chunkMessage = "chunk";
        chunkMessage = reassignedMessage;
        export const chunk = chunkMessage;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("constant reassignment", () => {
      const code = dedent`
        const chunkMessage = "chunk";
        chunkMessage = reassignedMessage;
        export const chunk = chunkMessage;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "const chunkMessage = "chunk";
        chunkMessage = reassignedMessage;
        export const chunk = chunkMessage;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("reassignment with nullish coalescing", () => {
      const code = dedent`
        import { reassignedMessage } from "./messages";  
        let chunkMessage = "chunk";
        chunkMessage ??= reassignedMessage;
        export const chunk = chunkMessage;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { reassignedMessage } from "./messages";
        let chunkMessage = "chunk";
        chunkMessage ??= reassignedMessage;
        export const chunk = chunkMessage;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("destructured reassignment", () => {
      const code = dedent`
        let chunkMessage = "chunk";
        [chunkMessage] = [reassignedMessage];
        export const chunk = chunkMessage;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "let chunkMessage = "chunk";
        [chunkMessage] = [reassignedMessage];
        export const chunk = chunkMessage;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("function argument reassignment", () => {
      const code = dedent`
        const reassignedMessage = "reassigned";
        const getChunkMessage = (message) => {
          message = reassignedMessage;
          return message;
        };
        export const chunk = getChunkMessage("chunk");
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "const reassignedMessage = "reassigned";
        const getChunkMessage = message => {
          message = reassignedMessage;
          return message;
        };
        export const chunk = getChunkMessage("chunk");"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("destructuring assignment", () => {
      const code = dedent`
        import { getChunkMessage } from "./messages";
        let [chunkMessage] = [getChunkMessage()];
        export const chunk = chunkMessage;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { getChunkMessage } from "./messages";
        let [chunkMessage] = [getChunkMessage()];
        export const chunk = chunkMessage;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("object property usage", () => {
      const code = dedent`
        let messages = { chunkMessage: "chunk" };
        export const chunk = messages.chunkMessage;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "let messages = {
          chunkMessage: "chunk"
        };
        export const chunk = messages.chunkMessage;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("object property mutation", () => {
      const code = dedent`
        import { mutatedMessage } from "./messages";
        let messages = { chunkMessage: "chunk" };
        messages.chunkMessage = mutatedMessage;
        export const chunk = messages.chunkMessage;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { mutatedMessage } from "./messages";
        let messages = {
          chunkMessage: "chunk"
        };
        messages.chunkMessage = mutatedMessage;
        export const chunk = messages.chunkMessage;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("computed object property", () => {
      const code = dedent`
        import { keyName } from "./messages";
        let getKey = () => keyName;
        let messages = { [getKey()]: "chunk" };
        export const chunk = messages;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { keyName } from "./messages";
        let getKey = () => keyName;
        let messages = {
          [getKey()]: "chunk"
        };
        export const chunk = messages;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("generator function", () => {
      const code = dedent`
        import { chunkMessage1, chunkMessage2 } from "./messages";
        function* chunkGenerator() {
          yield chunkMessage1;
          yield chunkMessage2;
        }
        export const chunk = [...chunkGenerator()].join(" ");
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage1, chunkMessage2 } from "./messages";
        function* chunkGenerator() {
          yield chunkMessage1;
          yield chunkMessage2;
        }
        export const chunk = [...chunkGenerator()].join(" ");"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("class static property usage", () => {
      const code = dedent`
        import { chunkMessage } from "./messages";
        class Chunk {
          static message = chunkMessage;
        }
        export const chunk = new Chunk();
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage } from "./messages";
        class Chunk {
          static message = chunkMessage;
        }
        export const chunk = new Chunk();"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("class static property mutation", () => {
      const code = dedent`
        import { mutatedMessage } from "./messages";
        class Chunk {
          static message = "chunk";
        }
        let chunkInstance = new Chunk();
        chunkInstance.message = mutatedMessage;
        export const chunk = chunkInstance;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { mutatedMessage } from "./messages";
        class Chunk {
          static message = "chunk";
        }
        let chunkInstance = new Chunk();
        chunkInstance.message = mutatedMessage;
        export const chunk = chunkInstance;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("class method usage", () => {
      const code = dedent`
        import { chunkMessage } from "./messages";
        class Chunk {
          message() {
            return chunkMessage;
          }
        }
        export const chunk = new Chunk();
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage } from "./messages";
        class Chunk {
          message() {
            return chunkMessage;
          }
        }
        export const chunk = new Chunk();"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });

    test("class method mutation", () => {
      const code = dedent`
        import { chunkMessage, mutatedMessage } from "./messages";
        class Chunk {
          message() {
            return chunkMessage;
          }
        }
        let chunkInstance = new Chunk();
        chunkInstance.message = () => mutatedMessage;
        export const chunk = chunkInstance;
        export const main = "main";
      `;

      expect(hasChunkableExport(code, "chunk", ...cache)).toBe(true);
      expect(getChunkedExport(code, "chunk", {}, ...cache)?.code)
        .toMatchInlineSnapshot(`
        "import { chunkMessage, mutatedMessage } from "./messages";
        class Chunk {
          message() {
            return chunkMessage;
          }
        }
        let chunkInstance = new Chunk();
        chunkInstance.message = () => mutatedMessage;
        export const chunk = chunkInstance;"
      `);
      expect(
        omitChunkedExports(code, ["chunk"], {}, ...cache)?.code
      ).toMatchInlineSnapshot(`"export const main = "main";"`);
    });
  });
});
