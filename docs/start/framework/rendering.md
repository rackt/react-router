---
title: Rendering Strategies
order: 4
---

# Rendering Strategies

There are three rendering strategies in React Router:

- Client Side Rendering
- Server Side Rendering
- Static Pre-rendering

All routes are always client side rendered as the user navigates around the app. However, you can control server rendering and static pre-rendering with the `ssr` and `prerender` config options.

## Server Side Rendering

```ts filename=react-router.config.ts
import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
} satisfies Config;
```

Server side rendering requires a deployment that supports it. Though it's a global setting, individual routes can still be statically pre-rendered, and/or use client data loading with `clientLoader` to avoid server rendering/fetching of their portion of the UI.

## Static Pre-rendering

```ts filename=react-router.config.ts
import type { Config } from "@react-router/dev/config";

export default {
  // return a list of URLs to prerender at build time
  async prerender() {
    return ["/", "/about", "/contact"];
  },
} satisfies Config;
```

Pre-rendering is a build-time operation that generates static HTML and client navigation data payloads for a list of URLs. This is useful for SEO and performance, especially for deployments without server rendering. When pre-rendering, route module loaders are used to fetch data at build time.

---

Next: [Data Loading](./data-loading)
