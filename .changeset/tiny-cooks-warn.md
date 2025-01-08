---
"react-router": patch
---

Remove the `exports.node.module-sync` config from `package.json` to avoid ESM/CJS mismatches on Node 22+
