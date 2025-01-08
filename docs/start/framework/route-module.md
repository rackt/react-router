---
title: Route Module
order: 3
---

# Route Module

The files referenced in `routes.ts` are called Route Modules.

```tsx filename=app/routes.ts
route("teams/:teamId", "./team.tsx"),
//           route module ^^^^^^^^
```

Route modules are the foundation of React Router's framework features, they define:

- automatic code-splitting
- data loading
- actions
- revalidation
- error boundaries
- and more

This guide is a quick overview of every route module feature. The rest of the getting started guides will cover these features in more detail.

For additional details, please refer to the API documentation for a [Route Module][route-module]

## Component (`default`)

Defines the component that will render when the route matches.

```tsx filename=app/routes/my-route.tsx
export default function MyRouteComponent() {
  return (
    <div>
      <h1>Look ma!</h1>
      <p>
        I'm still using React Router after like 10 years.
      </p>
    </div>
  );
}
```

See also:

- [`default` export Component props][component-props]

## `loader`

Route loaders provide data to route components before they are rendered. They are only called on the server when server rendering or during the build with pre-rendering.

```tsx
export async function loader() {
  return { message: "Hello, world!" };
}

export default function MyRoute({ loaderData }) {
  return <h1>{loaderData.message}</h1>;
}
```

See also:

- [`loader` params][loader-params]

## `clientLoader`

Called only in the browser, route client loaders provide data to route components in addition to, or in place of, route loaders.

```tsx
export async function clientLoader({ serverLoader }) {
  // call the server loader
  const serverData = await serverLoader();
  // And/or fetch data on the client
  const data = getDataFromClient();
  // Return the data to expose through useLoaderData()
  return data;
}
```

Client loaders can participate in initial page load hydration of server rendered pages by setting the `hydrate` property on the function:

```tsx
export async function clientLoader() {
  // ...
}
clientLoader.hydrate = true as const;
```

<docs-info>

By using `as const`, TypeScript will infer that the type for `clientLoader.hydrate` is `true` instead of `boolean`.
That way, React Router can derive types for `loaderData` based on the value of `clientLoader.hydrate`.

</docs-info>

See also:

- [`clientLoader` params][client-loader-params]

## `action`

Route actions allow server-side data mutations with automatic revalidation of all loader data on the page when called from `<Form>`, `useFetcher`, and `useSubmit`.

```tsx
// route("/list", "./list.tsx")
import { Form } from "react-router";
import { TodoList } from "~/components/TodoList";

// this data will be loaded after the action completes...
export async function loader() {
  const items = await fakeDb.getItems();
  return { items };
}

// ...so that the list here is updated automatically
export default function Items({ loaderData }) {
  return (
    <div>
      <List items={loaderData.items} />
      <Form method="post" navigate={false} action="/list">
        <input type="text" name="title" />
        <button type="submit">Create Todo</button>
      </Form>
    </div>
  );
}

export async function action({ request }) {
  const data = await request.formData();
  const todo = await fakeDb.addItem({
    title: data.get("title"),
  });
  return { ok: true };
}
```

See also:

- [`action` params][action-params]

## `clientAction`

Like route actions but only called in the browser.

```tsx
export async function clientAction({ serverAction }) {
  fakeInvalidateClientSideCache();
  // can still call the server action if needed
  const data = await serverAction();
  return data;
}
```

See also:

- [`clientAction` params][client-action-params]

## `ErrorBoundary`

When other route module APIs throw, the route module `ErrorBoundary` will render instead of the route component.

```tsx
import {
  isRouteErrorResponse,
  useRouteError,
} from "react-router";

export function ErrorBoundary({ error }) {
  if (isRouteErrorResponse(error)) {
    return (
      <div>
        <h1>
          {error.status} {error.statusText}
        </h1>
        <p>{error.data}</p>
      </div>
    );
  } else if (error instanceof Error) {
    return (
      <div>
        <h1>Error</h1>
        <p>{error.message}</p>
        <p>The stack trace is:</p>
        <pre>{error.stack}</pre>
      </div>
    );
  } else {
    return <h1>Unknown Error</h1>;
  }
}
```

See also:

- [`ErrorBoundary` props][errorboundary-props]
- [`isRouteErorResponse` docs][is-route-error-response]
- [React Error Boundaries docs][error-boundaries]

## `HydrateFallback`

On initial page load, the route component renders only after the client loader is finished. If exported, a `HydrateFallback` can render immediately in place of the route component.

```tsx filename=routes/client-only-route.tsx
export async function clientLoader() {
  const data = await fakeLoadLocalGameData();
  return data;
}

export function HydrateFallback() {
  return <p>Loading Game...</p>;
}

export default function Component({ loaderData }) {
  return <Game data={loaderData} />;
}
```

See also:

- [`HydrateFallback` props][hydratefallback-props]

## `headers`

Route headers define HTTP [headers] to be sent with the response when server rendering.

```tsx
export function headers() {
  return {
    "X-Stretchy-Pants": "its for fun",
    "Cache-Control": "max-age=300, s-maxage=3600",
  };
}
```

See also:

- [`headers` params][headers-params]
- [`Cache-Control` header][cache-control-header]

## `handle`

Route handle allows apps to add anything to a route match in `useMatches` to create abstractions (like breadcrumbs, etc.).

```tsx
export const handle = {
  its: "all yours",
};
```

See also:

- [`handle` docs][handle]
- [`useMatches` docs][use-matches]

## `links`

Route links define [`<link>` element][link-element]s to be rendered in the document `<head>`.

```tsx
export function links() {
  return [
    {
      rel: "icon",
      href: "/favicon.png",
      type: "image/png",
    },
    {
      rel: "stylesheet",
      href: "https://example.com/some/styles.css",
    },
    {
      rel: "preload",
      href: "/images/banner.jpg",
      as: "image",
    },
  ];
}
```

All routes links will be aggregated and rendered through the `<Links />` component, usually rendered in your app root:

```tsx
import { Links } from "react-router";

export default function Root() {
  return (
    <html>
      <head>
        <Links />
      </head>

      <body />
    </html>
  );
}
```

See also:

- [`links` params][links-params]

## `meta`

Route meta defines [`<meta>`][meta-element] tags to be rendered in the `<head>` of the document.

```tsx
export function meta() {
  return [
    { title: "Very cool app" },
    {
      property: "og:title",
      content: "Very cool app",
    },
    {
      name: "description",
      content: "This app is the best",
    },
  ];
}
```

All routes' meta will be aggregated and rendered through the `<Meta />` component, usually rendered in your app root:

```tsx
import { Meta } from "react-router";

export default function Root() {
  return (
    <html>
      <head>
        <Meta />
      </head>

      <body />
    </html>
  );
}
```

See also:

- [`meta` params][meta-params]

## `shouldRevalidate`

By default, all routes are revalidated after actions. This function allows a route to opt-out of revalidation for actions that don't affect its data.

```tsx
import type { ShouldRevalidateFunctionArgs } from "react-router";

export function shouldRevalidate(
  arg: ShouldRevalidateFunctionArgs
) {
  return true;
}
```

See also:

- [`shouldRevalidate` params][shouldrevalidate-params]

---

Next: [Rendering Strategies](./rendering)

[error-boundaries]: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
[is-route-error-response]: https://api.reactrouter.com/v7/functions/react_router.isRouteErrorResponse
[cache-control-header]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control
[headers]: https://developer.mozilla.org/en-US/docs/Web/API/Response
[use-matches]: https://api.reactrouter.com/v7/functions/react_router.useMatches
[link-element]: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link
[meta-element]: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta
[route-module]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html
[component-props]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#default
[loader-params]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#loader
[client-loader-params]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#clientLoader
[action-params]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#actioin
[client-action-params]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#clientAction
[meta-params]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#meta
[links-params]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#links
[handle]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#handle
[errorboundary-props]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#ErrorBoundary
[hydratefallback-props]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#HydrateFallback
[headers-params]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#headers
[shouldrevalidate-params]: https://api.reactrouter.com/v7/interfaces/react_router.ServerRouteModule.html#shouldRevalidate
