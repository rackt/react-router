---
"@remix-run/router": patch
"react-router-dom": patch
---

Re-throw `DOMException` (`DataCloneError`) when attempting to perform a `PUSH` navigation with non-serializable state.
