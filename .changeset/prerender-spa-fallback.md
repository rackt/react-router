---
"@react-router/dev": minor
---

Generate a "SPA fallback" HTML file for scenarios where applications are prerendering the `/` route with `ssr:false`

- If you specify `ssr:false` without a `prerender` config, this is considered "SPA Mode" and the generated `index.html` file will only render down to the root route and will be able to hydrate for any valid application path
- If you specify `ssr:false` with a `prerender` config but _do not_ include the `/` path (i.e., `prerender: ['/blog/post']`), then we still generate a "SPA Mode" `index.html` file that can hydrate for any path in the application
- However, previously if you specified `ssr:false` and included the `/` path in your `prerender` config, we would prerender the `/` route into `index.html` as a non-SPA page
  - The generated HTML would include the root index route which prevented hydration for any other paths
  - With this change, we now generate a "SPA Mode" file in `__spa-fallback.html` that will allow you to hydrate for any non-prerendered paths
  - You can serve this file from your static file server for any paths that would otherwise 404 if you only want to pre-render _some_ routes in your `ssr:false` app and serve the others as a SPA
  - `npx sirv-cli build/client --single __spa-fallback.html`
