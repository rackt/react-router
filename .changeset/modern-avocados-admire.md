---
"@react-router/architect": patch
"@react-router/express": patch
"@react-router/node": patch
"react-router-dom": patch
"react-router": patch
---

Fix React context mismatches (e.g. `useHref() may be used only in the context of a <Router> component.`) during development when using libraries that have a peer dependency on React Router. This is done by removing `node` export conditions and merging them into `default` to ensure a single instance of React Router's context is used.
