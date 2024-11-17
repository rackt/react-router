---
title: Type Safety
---

# Type Safety

If you haven't done so already, check out our guide for <a href="../framework/how-to/setting-up-type-safety">setting up type safety</a> in a new project.

React Router generates types for each route in your app that you can use to get type safety for each route module export.

For example, let's say you have a `products/:id` route configured:

```ts filename=app/routes.ts
import {
  type RouteConfig,
  route,
} from "@react-router/dev/routes";

export default [
  route("products/:id", "./routes/product.tsx"),
] satisfies RouteConfig;
```

You can import route-specific types like so:

```tsx filename=app/routes/product.tsx
import type { Route } from "./+types/product";
// types generated for this route 👆

export function loader({ params }: Route.LoaderArgs) {
  //                      👆 { id: string }
  return { planet: `world #${params.id}` };
}

export default function Component({
  loaderData, // 👈 { planet: string }
}: Route.ComponentProps) {
  return <h1>Hello, {loaderData.planet}!</h1>;
}
```

## `typegen` command

You can manually generate types with the `typegen` command:

```sh
react-router typegen
```

You can also use `--watch` to automatically regenerate types as files change:

```sh
react-router typegen --watch
```

The following types are generated for each route:

- `LoaderArgs`
- `ClientLoaderArgs`
- `ActionArgs`
- `ClientActionArgs`
- `HydrateFallbackProps`
- `ComponentProps` (for the `default` export)
- `ErrorBoundaryProps`

## How it works

React Router's type generation executes your route config (`app/routes.ts` by default) to determine the routes for your app.
It then generates a `+types/<route file>.d.ts` for each route within a special `.react-router/types/` directory.
With [`rootDirs` configured][setting-up-type-safety], TypeScript can import these generated files as if they were right next to their corresponding route modules.

For a deeper dive into some of the design decisions, check out our [type inference decision doc](https://github.com/remix-run/react-router/blob/dev/decisions/0012-type-inference.md).

[setting-up-type-safety]: ../framework/how-to/setting-up-type-safety
