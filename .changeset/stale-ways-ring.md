---
"react-router": patch
---

Align dev server behavior with static file server behavior when `ssr:false` is set

- When no `prerender` config exists, only SSR down to the root `HydrateFallback` (SPA Mode)
- When a `prerender` config exists but the current path is not prerendered, only SSR down to the root `HydrateFallback` (SPA Fallback)
- Return a 404 on `.data` requests to non-pre-rendered paths
