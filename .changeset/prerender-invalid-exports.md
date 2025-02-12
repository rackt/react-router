---
"@react-router/dev": patch
---

Enhance invalid export detection when using `ssr:false`

- `headers`/`action` are prohibited in all routes with `ssr:false` because there will be no runtime server on which to run them
- `loader` functions are more nuanced and depend on whether a given route is prerendered
  - When using `ssr:false` without a `prerender` config, only the `root` route can have a `loader`
    - This is "SPA mode" which generates a single `index.html` file with the root route `HydrateFallback` so it is capable of hydrating for any path in your application - therefore we can only call a root route `loader` at build time
  - When using `ssr:false` with a `prerender` config, you can export a `loader` from routes matched by one of the `prerender` paths because those routes will be server rendered at build time
    - Exporting a `loader` from a route that is never matched by a `prerender` path will throw a build time error because there will be no runtime server to ever run the loader
