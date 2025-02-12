---
"@react-router/dev": minor
"react-router": minor
---

New type-safe `href` utility that guarantees links point to actual paths in your app

```tsx
import { href } from "react-router";

export default function Component() {
  const link = href("/blog/:slug", { slug: "my-first-post" });
  return (
    <main>
      <Link to={href("/products/:id", { id: "asdf" })} />
      <NavLink to={href("/:lang?/about", { lang: "en" })} />
    </main>
  );
}
```
