---
"@react-router/dev": patch
"react-router": patch
---

Fix typegen for repeated params

In React Router, path parameters are keyed by their name.
So for a path pattern like `/a/:id/b/:id?/c/:id`, the last `:id` will set the value for `id` in `useParams` and the `params` prop.
For example, `/a/1/b/2/c/3` will result in the value `{ id: 3 }` at runtime.

Previously, generated types for params incorrectly modeled repeated params with an array.
So `/a/1/b/2/c/3` generated a type like `{ id: [1,2,3] }`.

To be consistent with runtime behavior, the generated types now correctly model the "last one wins" semantics of path parameters.
So `/a/1/b/2/c/3` now generates a type like `{ id: 3 }`.
