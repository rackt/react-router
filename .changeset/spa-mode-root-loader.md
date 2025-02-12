---
"@react-router/dev": minor
---

- Allow a `loader` in the root route in SPA mode because it can be called/server-rendered at build time
- `Route.HydrateFallbackProps` now also receives `loaderData`
  - This will be defined so long as the `HydrateFallback` is rendering while _children_ routes are loading
  - This will be `undefined` if the `HydrateFallback` is rendering because the route has it's own hydrating `clientLoader`
  - In SPA mode, this will allow you to render loader root data into the SPA `index.html`
