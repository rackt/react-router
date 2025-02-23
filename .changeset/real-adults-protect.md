---
"react-router": minor
---

Add `fetcherKey` as a parameter to `patchRoutesOnNavigation`

- In framework mode, Lazy Route Discovery will now detect manifest version mismatches after a new deploy
- On navigations to undiscovered routes, this mismatch will trigger a document reload of the destination path
- On `fetcher` calls to undiscovered routes, this mismatch will trigger a document reload of the current path
