---
title: Custom Framework
---

# Custom Framework

Instead of using `@react-router/dev`, you can integrate React Router's framework features (like loaders, actions, fetchers, etc.) into your own bundler and server abstractions.

## Client Rendering

### 1. Create a Router

The browser runtime API that enables route module APIs (loaders, actions, etc.) is `createBrowserRouter`.

It takes an array of route objects that support loaders, actions, error boundaries and more. The React Router Vite plugin creates one of these from `routes.ts`, but you can create one manually (or with an abstraction) and use your own bundler.

```tsx
import { createBrowserRouter } from "react-router";

let router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      {
        path: "shows/:showId",
        Component: Show,
        loader: ({ request, params }) =>
          fetch(`/api/show/${params.id}.json`, {
            signal: request.signal,
          }),
      },
    ],
  },
]);
```

### 2. Render the Router

To render the router in the browser, use `<RouterProvider>`.

```tsx
import {
  createBrowserRouter,
  RouterProvider,
} from "react-router";
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")).render(
  <RouterProvider router={router} />
);
```

### 3. Lazy Loading

Routes can take most of their definition lazily with the `lazy` property.

```tsx
createBrowserRouter([
  {
    path: "/show/:showId",
    lazy: async () => {
      let [loader, action, Component] = await Promise.all([
        import("./show.action.js"),
        import("./show.loader.js"),
        import("./show.component.js"),
      ]);
      return { loader, action, Component };
    },
  },
]);
```

## Server Rendering

To server render a custom setup, there are a few server APIs available for rendering an data loading.

This guide simply gives you some ideas about how it works. For deeper understanding, please see the [Custom Framework Example Repo](https://github.com/remix-run/custom-react-router-framework-example)

### 1. Define Your Routes

Routes are the same kinds of objects on the server as the client.

```tsx
export default [
  {
    path: "/",
    Component: Root,
    children: [
      {
        path: "shows/:showId",
        Component: Show,
        loader: ({ params }) => {
          return db.loadShow(params.id);
        },
      },
    ],
  },
];
```

### 2. Create a static handler

Turn your routes into a request handler with `createStaticHandler`:

```tsx
import { createStaticHandler } from "react-router";
import routes from "./some-routes";

let { query, dataRoutes } = createStaticHandler(routes);
```

### 3. Get Routing Context and Render

React Router works with web fetch [Requests](https://developer.mozilla.org/en-US/docs/Web/API/Request), so if your server doesn't, you'll need to adapt whatever objects it uses to a web fetch `Request` object.

This step assumes your server receives `Request` objects.

```tsx
import { renderToString } from "react-dom/server";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router";

import routes from "./some-routes.js";

let { query, dataRoutes } = createStaticHandler(routes);

export async function handler(request: Request) {
  // 1. run actions/loaders to get the routing context with `query`
  let context = await query(request);

  // If `query` returns a Response, send it raw (a route probably a redirected)
  if (context instanceof Response) {
    return context;
  }

  // 2. Create a static router for SSR
  let router = createStaticRouter(dataRoutes, context);

  // 3. Render everything with StaticRouterProvider
  let html = renderToString(
    <StaticRouterProvider
      router={router}
      context={context}
    />
  );

  // Setup headers from action and loaders from deepest match
  let leaf = context.matches[context.matches.length - 1];
  let actionHeaders = context.actionHeaders[leaf.route.id];
  let loaderHeaders = context.loaderHeaders[leaf.route.id];
  let headers = new Headers(actionHeaders);
  if (loaderHeaders) {
    for (let [key, value] of loaderHeaders.entries()) {
      headers.append(key, value);
    }
  }

  headers.set("Content-Type", "text/html; charset=utf-8");

  // 4. send a response
  return new Response(`<!DOCTYPE html>${html}`, {
    status: context.statusCode,
    headers,
  });
}
```

### 4. Hydrate in the browser

Hydration data is embedded onto `window.__staticRouterHydrationData`, use that to initialize your client side router and render a `<RouterProvider>`.

```tsx
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import routes from "./app/routes.js";
import { createBrowserRouter } from "react-router";

let router = createBrowserRouter(routes, {
  hydrationData: window.__staticRouterHydrationData,
});

hydrateRoot(
  document,
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
```
