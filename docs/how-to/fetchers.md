---
title: Using Fetchers
---

# Using Fetchers

Fetchers are useful for creating complex, dynamic user interfaces that require multiple, concurrent data interactions without causing a navigation.

Fetchers track their own, independent state and can be used to load data, mutate data, submit forms, and generally interact with loaders and actions.

## Calling Actions

The most common case for a fetcher is to submit data to an action, triggering a revalidation of route data. Consider the following route module:

```tsx
import { useLoaderData } from "react-router";

export async function clientLoader({ request }) {
  let title = localStorage.getItem("title") || "No Title";
  return { title };
}

export default function Component() {
  let data = useLoaderData();
  return (
    <div>
      <h1>{data.title}</h1>
    </div>
  );
}
```

### 1. Add an action

First we'll add an action to the route for the fetcher to call:

```tsx lines=[7-11]
import { useLoaderData } from "react-router";

export async function clientLoader({ request }) {
  // ...
}

export async function clientAction({ request }) {
  await new Promise((res) => setTimeout(res, 1000));
  let data = await request.formData();
  localStorage.setItem("title", data.get("title"));
  return { ok: true };
}

export default function Component() {
  let data = useLoaderData();
  // ...
}
```

### 2. Create a fetcher

Next create a fetcher and render a form with it:

```tsx lines=[7,12-14]
import { useLoaderData, useFetcher } from "react-router";

// ...

export default function Component() {
  let data = useLoaderData();
  let fetcher = useFetcher();
  return (
    <div>
      <h1>{data.title}</h1>

      <fetcher.Form method="post">
        <input type="text" name="title" />
      </fetcher.Form>
    </div>
  );
}
```

### 3. Submit the form

If you submit the form now, the fetcher will call the action and revalidate the route data automatically.

### 4. Render pending state

Fetchers make their state available during the async work so you can render pending UI the moment the user interacts:

```tsx lines=[10]
export default function Component() {
  let data = useLoaderData();
  let fetcher = useFetcher();
  return (
    <div>
      <h1>{data.title}</h1>

      <fetcher.Form method="post">
        <input type="text" name="title" />
        {fetcher.state !== "idle" && <p>Saving...</p>}
      </fetcher.Form>
    </div>
  );
}
```

### 5. Optimistic UI

Sometimes there's enough information in the form to render the next state immediately. You can access the form data with `fetcher.formData`:

```tsx lines=[3-4,8]
export default function Component() {
  let data = useLoaderData();
  let fetcher = useFetcher();
  let title = fetcher.formData?.get("title") || data.title;

  return (
    <div>
      <h1>{title}</h1>

      <fetcher.Form method="post">
        <input type="text" name="title" />
        {fetcher.state !== "idle" && <p>Saving...</p>}
      </fetcher.Form>
    </div>
  );
}
```

### 6. Fetcher Data and Validation

Data returned from an action is available in the fetcher's `data` property. This is primarily useful for returning error messages to the user for a failed mutation:

```tsx lines=[7-10,28-32]
// ...

export async function clientAction({ request }) {
  await new Promise((res) => setTimeout(res, 1000));
  let data = await request.formData();

  let title = data.get("title") as string;
  if (title.trim() === "") {
    return { ok: false, error: "Title cannot be empty" };
  }

  localStorage.setItem("title", title);
  return { ok: true, error: null };
}

export default function Component() {
  let data = useLoaderData();
  let fetcher = useFetcher();
  let title = fetcher.formData?.get("title") || data.title;

  return (
    <div>
      <h1>{title}</h1>

      <fetcher.Form method="post">
        <input type="text" name="title" />
        {fetcher.state !== "idle" && <p>Saving...</p>}
        {fetcher.data?.error && (
          <p style={{ color: "red" }}>
            {fetcher.data.error}
          </p>
        )}
      </fetcher.Form>
    </div>
  );
}
```

## Loading Data

Another common use case for fetchers is to load data from a route for something like a combobox.

### 1. Create a search route

Consider the following route with a very basic search:

```tsx filename=./search-users.tsx
// { path: '/search-users', filename: './search-users.tsx' }
const users = [
  { id: 1, name: "Ryan" },
  { id: 2, name: "Michael" },
  // ...
];

export async function loader({ request }) {
  await new Promise((res) => setTimeout(res, 300));
  let url = new URL(request.url);
  let query = url.searchParams.get("q");
  return users.filter((user) =>
    user.name.toLowerCase().includes(query.toLowerCase())
  );
}
```

### 2. Render a fetcher in a combobox component

```tsx
import { useFetcher } from "react-router";

export function UserSearchCombobox() {
  let fetcher = useFetcher();
  return (
    <div>
      <fetcher.Form method="get" action="/search-users">
        <input type="text" name="q" />
      </fetcher.Form>
    </div>
  );
}
```

- The action points to the route we created above: "/search-users"
- The name of the input is "q" to match the query parameter

### 3. Add type inference

```tsx lines=[2,5]
import { useFetcher } from "react-router";
import type * as Search from "./search-users";

export function UserSearchCombobox() {
  let fetcher = useFetcher<typeof Search.action>();
  // ...
}
```

Ensure you use `import type` so you only import the types.

### 4. Render the data

```tsx lines=[10-16]
import { useFetcher } from "react-router";

export function UserSearchCombobox() {
  let fetcher = useFetcher<typeof Search.action>();
  return (
    <div>
      <fetcher.Form method="get" action="/search-users">
        <input type="text" name="q" />
      </fetcher.Form>
      {fetcher.data && (
        <ul>
          {fetcher.data.map((user) => (
            <li key={user.id}>{user.name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Note you will need to hit "enter" to submit the form and see the results.

### 5. Render a pending state

```tsx lines=[12-14]
import { useFetcher } from "react-router";

export function UserSearchCombobox() {
  let fetcher = useFetcher<typeof Search.action>();
  return (
    <div>
      <fetcher.Form method="get" action="/search-users">
        <input type="text" name="q" />
      </fetcher.Form>
      {fetcher.data && (
        <ul
          style={{
            opacity: fetcher.state === "idle" ? 1 : 0.25,
          }}
        >
          {fetcher.data.map((user) => (
            <li key={user.id}>{user.name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### 6. Search on user input

Fetchers can be submitted programmatically with `fetcher.submit`:

```tsx lines=[5-7]
<fetcher.Form method="get" action="/search-users">
  <input
    type="text"
    name="q"
    onChange={(event) => {
      fetcher.submit(event.currentTarget.form);
    }}
  />
</fetcher.Form>
```

Note the input event's form is passed as the first argument to `fetcher.submit`. The fetcher will use that form to submit the request, reading its attributes and serializing the data from its elements.
