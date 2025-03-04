---
title: Single Page App (SPA)
---

# Single Page App (SPA)

There are two ways to ship a single page app with React Router

- **as a library** - Instead of using React Router's framework features, you can use it as a library in your own SPA architecture. Refer to [React Router as a Library](../start/library/installation) guides.
- **as a framework** - This guide will focus here

## Overview

When using React Router as a framework, you can enable "SPA Mode" by setting `ssr:false` in your `react-router.config.ts` file. This will disable runtime server rendering and generate an `index.html` at build time that you can serve and hydrate as a SPA.

Typical Single Page apps send a mostly blank `index.html` template with little more than an empty `<div id="root"></div>`. In contrast, `react-router build` (in SPA Mode) pre-renders your root route at build time into an `index.html` file. This means you can:

- Send more than an empty `<div>`
- Use a root `loader` to load data for your application shell
- Use React components to generate the initial page users see (root `HydrateFallback`)
- Re-enable server rendering later without changing anything about your UI

It's important to note that setting `ssr:false` only disables _runtime server rendering_. React Router will still server render your root route at _build time_ to generate the `index.html` file. This is why your project still needs a dependency on `@react-router/node` and your routes need to be SSR-safe. That means you can't call `window` or other browser-only APIs during the initial render, even when server rendering is disabled.

<docs-info>SPA Mode is a special form of "Pre-Rendering" that allows you to serve all paths in your application from the same HTML file. Please refer to the [Pre-Rendering](./pre-rendering) guide if you want to do more extensive pre-rendering.</docs-info>

## 1. Disable Runtime Server Rendering

Server rendering is enabled by default. Set the `ssr` flag to `false` in `react-router.config.ts` to disable it.

```ts filename=react-router.config.ts lines=[4]
import { type Config } from "@react-router/dev/config";

export default {
  ssr: false,
} satisfies Config;
```

With this set to false, the server build will no longer be generated.

<docs-info>It's important to note that setting `ssr:false` only disables _runtime server rendering_. React Router will still server render your root route at _build time_ to generate the `index.html` file. This is why your project still needs a dependency on `@react-router/node` and your routes need to be SSR-safe. That means you can't call `window` or other browser-only APIs during the initial render, even when server rendering is disabled.</docs-info>

## 2. Add a `HydrateFallback` and optional `loader` to your root route

SPA Mode will generate an `index.html` file at build-time that you can serve as the entry point for your SPA. This will only render the root route so that it is capable of hydrating at runtime for any path in your application.

To provide a better loading UI than an empty `<div>`, you can add a `HydrateFallback` component to your root route to render your loading UI into the `index.html` at build time. This way, it will be shown to users immediately while the SPA is loading/hydrating.

```tsx filename=root.tsx lines=[7-9]
import LoadingScreen from "./components/loading-screen";

export function Layout() {
  return <html>{/*...*/}</html>;
}

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function App() {
  return <Outlet />;
}
```

Because the root route is server-rendered at build time, you can also use a `loader` in your root route if you choose. This `loader` will be called at build time and the data will be available via the optional `HydrateFallback` `loaderData` prop.

```tsx filename=root.tsx lines=[5,10,14]
import { Route } from "./+types/root";

export async function loader() {
  return {
    version: await getVersion(),
  };
}

export function HydrateFallback({
  loaderData,
}: Route.ComponentProps) {
  return (
    <div>
      <h1>Loading version {loaderData.version}...</h1>
      <AwesomeSpinner />
    </div>
  );
}
```

You cannot include a `loader` in any other routes in your app when using SPA Mode unless you are [pre-rendering those pages](./pre-rendering).

## 3. Use client loaders and client actions

With server rendering disabled, you can still use `clientLoader` and `clientAction` to manage route data and mutations.

```tsx filename=some-route.tsx
import { Route } from "./+types/some-route";

export async function clientLoader({
  params,
}: Route.ClientLoaderArgs) {
  let data = await fetch(`/some/api/stuff/${params.id}`);
  return data;
}

export async function clientAction({
  request,
}: Route.ClientActionArgs) {
  let formData = await request.formData();
  return await processPayment(formData);
}
```

## 4. Direct all URLs to index.html

After running `react-router build`, deploy the `build/client` directory to whatever static host you prefer.

Common to deploying any SPA, you'll need to configure your host to direct all URLs to the `index.html` of the client build. Some hosts do this by default, but others don't. As an example, a host may support a `_redirects` file to do this:

```
/*    /index.html   200
```

If you're getting 404s at valid routes for your app, it's likely you need to configure your host.
