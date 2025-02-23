---
title: Address Book
order: 1
---

# Address Book

We'll be building a small, but feature-rich address book app that lets you keep track of your contacts. There's no database or other "production ready" things, so we can stay focused on the features React Router gives you. We expect it to take 30-45m if you're following along, otherwise it's a quick read.

<docs-info>

You can also watch our [walkthrough of the React Router Tutorial](https://www.youtube.com/watch?v=pw8FAg07kdo) if you prefer 🎥

</docs-info>

<img class="tutorial" src="/_docs/v7_address_book_tutorial/01.webp" />

👉 **Every time you see this it means you need to do something in the app!**

The rest is just there for your information and deeper understanding. Let's get to it.

## Setup

👉 **Generate a basic template**

```shellscript nonumber
npx create-react-router@latest --template remix-run/react-router/tutorials/address-book
```

This uses a pretty bare-bones template but includes our css and data model, so we can focus on React Router.

👉 **Start the app**

```shellscript nonumber
# cd into the app directory
cd {wherever you put the app}

# install dependencies if you haven't already
npm install

# start the server
npm run dev
```

You should be able to open up [http://localhost:5173][http-localhost-5173] and see an unstyled screen that looks like this:

## The Root Route

Note the file at `app/root.tsx`. This is what we call the ["Root Route"][root-route]. It's the first component in the UI that renders, so it typically contains the global layout for the page, as well as a the default [Error Boundary][error-boundaries].

<details>

<summary>Expand here to see the root component code</summary>

```tsx filename=app/root.tsx
import {
  Form,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import type { Route } from "./+types/root";

import appStylesHref from "./app.css?url";

export default function App() {
  return (
    <>
      <div id="sidebar">
        <h1>React Router Contacts</h1>
        <div>
          <Form id="search-form" role="search">
            <input
              aria-label="Search contacts"
              id="q"
              name="q"
              placeholder="Search"
              type="search"
            />
            <div
              aria-hidden
              hidden={true}
              id="search-spinner"
            />
          </Form>
          <Form method="post">
            <button type="submit">New</button>
          </Form>
        </div>
        <nav>
          <ul>
            <li>
              <a href={`/contacts/1`}>Your Name</a>
            </li>
            <li>
              <a href={`/contacts/2`}>Your Friend</a>
            </li>
          </ul>
        </nav>
      </div>
    </>
  );
}

// The Layout component is a special export for the root route.
// It acts as your document's "app shell" for all route components, HydrateFallback, and ErrorBoundary
// For more information, see https://reactrouter.com/explanation/special-files#layout-export
export function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
        <link rel="stylesheet" href={appStylesHref} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// The top most error boundary for the app, rendered when your app throws an error
// For more information, see https://reactrouter.com/start/framework/route-module#errorboundary
export function ErrorBoundary({
  error,
}: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (
    import.meta.env.DEV &&
    error &&
    error instanceof Error
  ) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main id="error-page">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre>
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
```

</details>

## The Contact Route UI

If you click on one of the sidebar items you'll get the default 404 page. Let's create a route that matches the url `/contacts/1`.

👉 **Create a contact route module**

```shellscript nonumber
mkdir app/routes
touch app/routes/contact.tsx
```

We could put this file anywhere we want, but to make things a bit more organized, we'll put all our routes inside the `app/routes` directory.

You can also use [file-based routing if you prefer][file-route-conventions].

👉 **Configure the route**

We need to tell React Router about our new route. `routes.ts` is a special file where we can configure all our routes.

```tsx filename=routes.ts lines=[2,5]
import type { RouteConfig } from "@react-router/dev/routes";
import { route } from "@react-router/dev/routes";

export default [
  route("contacts/:contactId", "routes/contact.tsx"),
] satisfies RouteConfig;
```

In React Router, `:` makes a segment dynamic. We just made the following urls match the `routes/contact.tsx` route module:

- `/contacts/123`
- `/contacts/abc`

👉 **Add the contact component UI**

It's just a bunch of elements, feel free to copy/paste.

```tsx filename=app/routes/contact.tsx
import { Form } from "react-router";

import type { ContactRecord } from "../data";

export default function Contact() {
  const contact = {
    first: "Your",
    last: "Name",
    avatar: "https://placecats.com/200/200",
    twitter: "your_handle",
    notes: "Some notes",
    favorite: true,
  };

  return (
    <div id="contact">
      <div>
        <img
          alt={`${contact.first} ${contact.last} avatar`}
          key={contact.avatar}
          src={contact.avatar}
        />
      </div>

      <div>
        <h1>
          {contact.first || contact.last ? (
            <>
              {contact.first} {contact.last}
            </>
          ) : (
            <i>No Name</i>
          )}
          <Favorite contact={contact} />
        </h1>

        {contact.twitter ? (
          <p>
            <a
              href={`https://twitter.com/${contact.twitter}`}
            >
              {contact.twitter}
            </a>
          </p>
        ) : null}

        {contact.notes ? <p>{contact.notes}</p> : null}

        <div>
          <Form action="edit">
            <button type="submit">Edit</button>
          </Form>

          <Form
            action="destroy"
            method="post"
            onSubmit={(event) => {
              const response = confirm(
                "Please confirm you want to delete this record."
              );
              if (!response) {
                event.preventDefault();
              }
            }}
          >
            <button type="submit">Delete</button>
          </Form>
        </div>
      </div>
    </div>
  );
}

function Favorite({
  contact,
}: {
  contact: Pick<ContactRecord, "favorite">;
}) {
  const favorite = contact.favorite;

  return (
    <Form method="post">
      <button
        aria-label={
          favorite
            ? "Remove from favorites"
            : "Add to favorites"
        }
        name="favorite"
        value={favorite ? "false" : "true"}
      >
        {favorite ? "★" : "☆"}
      </button>
    </Form>
  );
}
```

Now if we click one of the links or visit [`/contacts/1`][contacts-1] we get ... nothing new?

<img class="tutorial" src="/_docs/v7_address_book_tutorial/02.webp" />

## Nested Routes and Outlets

React Router supports nested routing. In order for child routes to render inside of parent layouts, we need to render an [`Outlet`][outlet-component] in the parent. Let's fix it, open up `app/root.tsx` and render an outlet inside.

👉 **Render an [`<Outlet />`][outlet-component]**

```tsx filename=app/root.tsx lines=[3,15-17]
import {
  Form,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";

// existing imports & exports

export default function App() {
  return (
    <>
      <div id="sidebar">{/* other elements */}</div>
      <div id="detail">
        <Outlet />
      </div>
    </>
  );
}
```

Now the child route should be rendering through the outlet.

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/03.webp" />

## Client Side Routing

You may or may not have noticed, but when we click the links in the sidebar, the browser is doing a full document request for the next URL instead of client side routing, which completely remounts our app

Client side routing allows our app to update the URL without reloading the entire page. Instead, the app can immediately render new UI. Let's make it happen with [`<Link>`][link-component].

👉 **Change the sidebar `<a href>` to `<Link to>`**

```tsx filename=app/root.tsx lines=[3,20,23]
import {
  Form,
  Link,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";

// existing imports & exports

export default function App() {
  return (
    <>
      <div id="sidebar">
        {/* other elements */}
        <nav>
          <ul>
            <li>
              <Link to={`/contacts/1`}>Your Name</Link>
            </li>
            <li>
              <Link to={`/contacts/2`}>Your Friend</Link>
            </li>
          </ul>
        </nav>
      </div>
      {/* other elements */}
    </>
  );
}
```

You can open the network tab in the browser devtools to see that it's not requesting documents anymore.

## Loading Data

URL segments, layouts, and data are more often than not coupled (tripled?) together. We can see it in this app already:

| URL Segment         | Component   | Data               |
| ------------------- | ----------- | ------------------ |
| /                   | `<App>`     | list of contacts   |
| contacts/:contactId | `<Contact>` | individual contact |

Because of this natural coupling, React Router has data conventions to get data into your route components easily.

First we'll create and export a [`clientLoader`][client-loader] function in the root route and then render the data.

👉 **Export a `clientLoader` function from `app/root.tsx` and render the data**

<docs-info>The following code has a type error in it, we'll fix it in the next section</docs-info>

```tsx filename=app/root.tsx lines=[2,6-9,11-12,19-42]
// existing imports
import { getContacts } from "./data";

// existing exports

export async function clientLoader() {
  const contacts = await getContacts();
  return { contacts };
}

export default function App({ loaderData }) {
  const { contacts } = loaderData;

  return (
    <>
      <div id="sidebar">
        {/* other elements */}
        <nav>
          {contacts.length ? (
            <ul>
              {contacts.map((contact) => (
                <li key={contact.id}>
                  <Link to={`contacts/${contact.id}`}>
                    {contact.first || contact.last ? (
                      <>
                        {contact.first} {contact.last}
                      </>
                    ) : (
                      <i>No Name</i>
                    )}
                    {contact.favorite ? (
                      <span>★</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <i>No contacts</i>
            </p>
          )}
        </nav>
      </div>
      {/* other elements */}
    </>
  );
}
```

That's it! React Router will now automatically keep that data in sync with your UI. The sidebar should now look like this:

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/04.webp" />

You may be wondering why we're "client" loading data instead of loading the data on the server so we can do server-side rendering (SSR). Right now our contacts site is a [Single Page App][spa], so there's no server-side rendering. This makes it really easy to deploy to any static hosting provider, but we'll talk more about how to enable SSR in a bit so you can learn about all the different [rendering strategies][rendering-strategies] React Router offers.

## Type Safety

You probably noticed that we didn't assign a type to the `loaderData` prop. Let's fix that.

👉 **Add the `ComponentProps` type to the `App` component**

```tsx filename=app/root.tsx lines=[5-7]
// existing imports
import type { Route } from "./+types/root";
// existing imports & exports

export default function App({
  loaderData,
}: Route.ComponentProps) {
  const { contacts } = loaderData;

  // existing code
}
```

Wait, what? Where did these types come from?!

We didn't define them, yet somehow they already know about the `contacts` property we returned from our `clientLoader`.

That's because React Router [generates types for each route in your app][type-safety] to provide automatic type safety.

## Adding a `HydrateFallback`

We mentioned earlier that we are working on a [Single Page App][spa] with no server-side rendering. If you look inside of [`react-router.config.ts`][react-router-config] you'll see that this is configured with a simple boolean:

```tsx filename=react-router.config.ts lines=[4]
import { type Config } from "@react-router/dev/config";

export default {
  ssr: false,
} satisfies Config;
```

You might have started noticing that whenever you refresh the page you get a flash of white before the app loads. Since we're only rendering on the client, there's nothing to show the user while the app is loading.

👉 **Add a `HydrateFallback` export**

We can provide a fallback that will show up before the app is hydrated (rendering on the client for the first time) with a [`HydrateFallback`][hydrate-fallback] export.

```tsx filename=app/root.tsx lines=[3-10]
// existing imports & exports

export function HydrateFallback() {
  return (
    <div id="loading-splash">
      <div id="loading-splash-spinner" />
      <p>Loading, please wait...</p>
    </div>
  );
}
```

Now if you refresh the page, you'll briefly see the loading splash before the app is hydrated.

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/05.webp" />

## Index Routes

When you load the app and aren't yet on a contact page, you'll notice a big blank page on the right side of the list.

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/06.webp" />

When a route has children, and you're at the parent route's path, the `<Outlet>` has nothing to render because no children match. You can think of [index routes][index-route] as the default child route to fill in that space.

👉 **Create an index route for the root route**

```shellscript nonumber
touch app/routes/home.tsx
```

```ts filename=app/routes.ts lines=[2,5]
import type { RouteConfig } from "@react-router/dev/routes";
import { index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("contacts/:contactId", "routes/contact.tsx"),
] satisfies RouteConfig;
```

👉 **Fill in the index component's elements**

Feel free to copy/paste, nothing special here.

```tsx filename=app/routes/home.tsx
export default function Home() {
  return (
    <p id="index-page">
      This is a demo for React Router.
      <br />
      Check out{" "}
      <a href="https://reactrouter.com">
        the docs at reactrouter.com
      </a>
      .
    </p>
  );
}
```

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/07.webp" />

Voilà! No more blank space. It's common to put dashboards, stats, feeds, etc. at index routes. They can participate in data loading as well.

## Adding an About Route

Before we move on to working with dynamic data that the user can interact with, let's add a page with static content we expect to rarely change. An about page will be perfect for this.

👉 **Create the about route**

```shellscript nonumber
touch app/routes/about.tsx
```

Don't forget to add the route to `app/routes.ts`:

```tsx filename=app/routes.ts lines=[4]
export default [
  index("routes/home.tsx"),
  route("contacts/:contactId", "routes/contact.tsx"),
  route("about", "routes/about.tsx"),
] satisfies RouteConfig;
```

👉 **Add the about page UI**

Nothing too special here, just copy and paste:

```tsx filename=app/routes/about.tsx
import { Link } from "react-router";

export default function About() {
  return (
    <div id="about">
      <Link to="/">← Go to demo</Link>
      <h1>About React Router Contacts</h1>

      <div>
        <p>
          This is a demo application showing off some of the
          powerful features of React Router, including
          dynamic routing, nested routes, loaders, actions,
          and more.
        </p>

        <h2>Features</h2>
        <p>
          Explore the demo to see how React Router handles:
        </p>
        <ul>
          <li>
            Data loading and mutations with loaders and
            actions
          </li>
          <li>
            Nested routing with parent/child relationships
          </li>
          <li>URL-based routing with dynamic segments</li>
          <li>Pending and optimistic UI</li>
        </ul>

        <h2>Learn More</h2>
        <p>
          Check out the official documentation at{" "}
          <a href="https://reactrouter.com">
            reactrouter.com
          </a>{" "}
          to learn more about building great web
          applications with React Router.
        </p>
      </div>
    </div>
  );
}
```

👉 **Add a link to the about page in the sidebar**

```tsx filename=app/root.tsx lines=[5-7]
export default function App() {
  return (
    <>
      <div id="sidebar">
        <h1>
          <Link to="about">React Router Contacts</Link>
        </h1>
        {/* other elements */}
      </div>
      {/* other elements */}
    </>
  );
}
```

Now navigate to the [about page][about-page] and it should look like this:

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/08.webp" />

## Layout Routes

We don't actually want the about page to be nested inside of the sidebar layout. Let's move the sidebar to a layout so we can avoid rendering it on the about page. Additionally, we want to avoid loading all the contacts data on the about page.

👉 **Create a layout route for the sidebar**

You can name and put this layout route wherever you want, but putting it inside of a `layouts` directory will help keep things organized for our simple app.

```shellscript nonumber
mkdir app/layouts
touch app/layouts/sidebar.tsx
```

For now just return an [`<Outlet>`][outlet-component].

```tsx filename=app/layouts/sidebar.tsx
import { Outlet } from "react-router";

export default function SidebarLayout() {
  return <Outlet />;
}
```

👉 **Move route definitions under the sidebar layout**

We can define a `layout` route to automatically render the sidebar for all matched routes within in. This is basically what our `root` was, but now we can scope it to specific routes.

```ts filename=app/routes.ts lines=[4,9,12]
import type { RouteConfig } from "@react-router/dev/routes";
import {
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  layout("layouts/sidebar.tsx", [
    index("routes/home.tsx"),
    route("contacts/:contactId", "routes/contact.tsx"),
  ]),
  route("about", "routes/about.tsx"),
] satisfies RouteConfig;
```

👉 **Move the layout and data fetching to the sidebar layout**

We want to move the `clientLoader` and everything inside the `App` component to the sidebar layout. It should look like this:

```tsx filename=app/layouts/sidebar.tsx
import { Form, Link, Outlet } from "react-router";
import { getContacts } from "../data";
import type { Route } from "./+types/sidebar";

export async function clientLoader() {
  const contacts = await getContacts();
  return { contacts };
}

export default function SidebarLayout({
  loaderData,
}: Route.ComponentProps) {
  const { contacts } = loaderData;

  return (
    <>
      <div id="sidebar">
        <h1>
          <Link to="about">React Router Contacts</Link>
        </h1>
        <div>
          <Form id="search-form" role="search">
            <input
              aria-label="Search contacts"
              id="q"
              name="q"
              placeholder="Search"
              type="search"
            />
            <div
              aria-hidden
              hidden={true}
              id="search-spinner"
            />
          </Form>
          <Form method="post">
            <button type="submit">New</button>
          </Form>
        </div>
        <nav>
          {contacts.length ? (
            <ul>
              {contacts.map((contact) => (
                <li key={contact.id}>
                  <Link to={`contacts/${contact.id}`}>
                    {contact.first || contact.last ? (
                      <>
                        {contact.first} {contact.last}
                      </>
                    ) : (
                      <i>No Name</i>
                    )}
                    {contact.favorite ? (
                      <span>★</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <i>No contacts</i>
            </p>
          )}
        </nav>
      </div>
      <div id="detail">
        <Outlet />
      </div>
    </>
  );
}
```

And inside `app/root.tsx`, `App` should just return an [`<Outlet>`][outlet-component], and all unused imports can be removed. Make sure there is no `clientLoader` in `root.tsx`.

```tsx filename=app/root.tsx lines=[3-10]
// existing imports and exports

export default function App() {
  return <Outlet />;
}
```

Now with that shuffling around done, our about page no longer loads contacts data nor is it nested inside of the sidebar layout:

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/09.webp" />

## Pre-rendering a Static Route

If you refresh the about page, you still see the loading spinner for just a split second before the page render on the client. This is really not a good experience, plus the page is just static information, we should be able to pre-render it as static HTML at build time.

👉 **Pre-render the about page**

Inside of `react-router.config.ts`, we can add a [`prerender`][pre-rendering] array to the config to tell React Router to pre-render certain urls at build time. In this case we just want to pre-render the about page.

```ts filename=app/react-router.config.ts lines=[5]
import { type Config } from "@react-router/dev/config";

export default {
  ssr: false,
  prerender: ["/about"],
} satisfies Config;
```

Now if you go to the [about page][about-page] and refresh, you won't see the loading spinner!

<docs-warning>

If you're still seeing a spinner when you refresh, make sure you deleted the `clientLoader` in `root.tsx`.

</docs-warning>

## Server-Side Rendering

React Router is a great framework for building [Single Page Apps][spa]. Many applications are served well by only client-side rendering, and _maybe_ statically pre-rendering a few pages at build time.

If you ever do want to introduce server-side rendering into your React Router application, it's incredibly easy (remember that `ssr: false` boolean from earlier?).

👉 **Enable server-side rendering**

```ts filename=app/react-router.config.ts lines=[2]
export default {
  ssr: true,
  prerender: ["/about"],
} satisfies Config;
```

And now... nothing is different? We're still getting our spinner for a split second before the page renders on the client? Plus, aren't we using `clientLoader`, so our data is still being fetched on the client?

That's right! With React Router you can still use `clientLoader` (and `clientAction`) to do client-side data fetching where you see fit. React Router gives you a lot of flexibility to use the right tool for the job.

Let's switch to using [`loader`][loader], which (you guessed it) is used to fetch data on the server.

👉 **Switch to using `loader` to fetch data**

```tsx filename=app/layouts/sidebar.tsx lines=[3]
// existing imports

export async function loader() {
  const contacts = await getContacts();
  return { contacts };
}
```

Whether you set `ssr` to `true` or `false` depends on you and your users needs. Both strategies are perfectly valid. For the remainder of this tutorial we're going to use server-side rendering, but know that all rendering strategies are first class citizens in React Router.

## URL Params in Loaders

👉 **Click on one of the sidebar links**

We should be seeing our old static contact page again, with one difference: the URL now has a real ID for the record.

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/10.webp" />

Remember the `:contactId` part of the route definition in `app/routes.ts`? These dynamic segments will match dynamic (changing) values in that position of the URL. We call these values in the URL "URL Params", or just "params" for short.

These `params` are passed to the loader with keys that match the dynamic segment. For example, our segment is named `:contactId` so the value will be passed as `params.contactId`.

These params are most often used to find a record by ID. Let's try it out.

👉 **Add a `loader` function to the contact page and access data with `loaderData`**

<docs-info>The following code has type errors in it, we'll fix them in the next section</docs-info>

```tsx filename=app/routes/contact.tsx lines=[2-3,5-8,10-13]
// existing imports
import { getContact } from "../data";
import type { Route } from "./+types/contact";

export async function loader({ params }: Route.LoaderArgs) {
  const contact = await getContact(params.contactId);
  return { contact };
}

export default function Contact({
  loaderData,
}: Route.ComponentProps) {
  const { contact } = loaderData;

  // existing code
}

// existing code
```

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/11.webp" />

## Throwing Responses

You'll notice that the type of `loaderData.contact` is `ContactRecord | null`. Based on our automatic type safety, TypeScript already knows that `params.contactId` is a string, but we haven't done anything to make sure it's a valid ID. Since the contact might not exist, `getContact` could return `null`, which is why we have type errors.

We could account for the possibility of the contact being not found in component code, but the webby thing to do is send a proper 404. We can do that in the loader and solve all of our problems at once.

```tsx filename=app/routes/contact.tsx lines=[5-7]
// existing imports

export async function loader({ params }: Route.LoaderArgs) {
  const contact = await getContact(params.contactId);
  if (!contact) {
    throw new Response("Not Found", { status: 404 });
  }
  return { contact };
}

// existing code
```

Now, if the user isn't found, code execution down this path stops and React Router renders the error path instead. Components in React Router can focus only on the happy path 😁

## Data Mutations

We'll create our first contact in a second, but first let's talk about HTML.

React Router emulates HTML Form navigation as the data mutation primitive, which used to be the only way prior to the JavaScript cambrian explosion. Don't be fooled by the simplicity! Forms in React Router give you the UX capabilities of client rendered apps with the simplicity of the "old school" web model.

While unfamiliar to some web developers, HTML `form`s actually cause a navigation in the browser, just like clicking a link. The only difference is in the request: links can only change the URL while `form`s can also change the request method (`GET` vs. `POST`) and the request body (`POST` form data).

Without client side routing, the browser will serialize the `form`'s data automatically and send it to the server as the request body for `POST`, and as [`URLSearchParams`][url-search-params] for `GET`. React Router does the same thing, except instead of sending the request to the server, it uses client side routing and sends it to the route's [`action`][action] function.

We can test this out by clicking the "New" button in our app.

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/12.webp" />

React Router sends a 405 because there is no code on the server to handle this form navigation.

## Creating Contacts

We'll create new contacts by exporting an `action` function in our root route. When the user clicks the "new" button, the form will `POST` to the root route action.

👉 **Export an `action` function from `app/root.tsx`**

```tsx filename=app/root.tsx lines=[3,5-8]
// existing imports

import { createEmptyContact } from "./data";

export async function action() {
  const contact = await createEmptyContact();
  return { contact };
}

// existing code
```

That's it! Go ahead and click the "New" button, and you should see a new record pop into the list 🥳

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/13.webp" />

The `createEmptyContact` method just creates an empty contact with no name or data or anything. But it does still create a record, promise!

> 🧐 Wait a sec ... How did the sidebar update? Where did we call the `action` function? Where's the code to re-fetch the data? Where are `useState`, `onSubmit` and `useEffect`?!

This is where the "old school web" programming model shows up. [`<Form>`][form-component] prevents the browser from sending the request to the server and sends it to your route's `action` function instead with [`fetch`][fetch].

In web semantics, a `POST` usually means some data is changing. By convention, React Router uses this as a hint to automatically revalidate the data on the page after the `action` finishes.

In fact, since it's all just HTML and HTTP, you could disable JavaScript and the whole thing will still work. Instead of React Router serializing the form and making a [`fetch`][fetch] request to your server, the browser will serialize the form and make a document request. From there React Router will render the page server side and send it down. It's the same UI in the end either way.

We'll keep JavaScript around though because we're going to make a better user experience than spinning favicons and static documents.

## Updating Data

Let's add a way to fill the information for our new record.

Just like creating data, you update data with [`<Form>`][form-component]. Let's make a new route module inside `app/routes/edit-contact.tsx`.

👉 **Create the edit contact route**

```shellscript nonumber
touch app/routes/edit-contact.tsx
```

Don't forget to add the route to `app/routes.ts`:

<!-- prettier-ignore -->
```tsx filename=app/routes.ts lines=[5]
export default [
  layout("layouts/sidebar.tsx", [
    index("routes/home.tsx"),
    route("contacts/:contactId", "routes/contact.tsx"),
    route("contacts/:contactId/edit", "routes/edit-contact.tsx"),
  ]),
  route("about", "routes/about.tsx"),
] satisfies RouteConfig;
```

👉 **Add the edit page UI**

Nothing we haven't seen before, feel free to copy/paste:

```tsx filename=app/routes/edit-contact.tsx
import { Form } from "react-router";
import type { Route } from "./+types/edit-contact";

import { getContact } from "../data";

export async function loader({ params }: Route.LoaderArgs) {
  const contact = await getContact(params.contactId);
  if (!contact) {
    throw new Response("Not Found", { status: 404 });
  }
  return { contact };
}

export default function EditContact({
  loaderData,
}: Route.ComponentProps) {
  const { contact } = loaderData;

  return (
    <Form key={contact.id} id="contact-form" method="post">
      <p>
        <span>Name</span>
        <input
          aria-label="First name"
          defaultValue={contact.first}
          name="first"
          placeholder="First"
          type="text"
        />
        <input
          aria-label="Last name"
          defaultValue={contact.last}
          name="last"
          placeholder="Last"
          type="text"
        />
      </p>
      <label>
        <span>Twitter</span>
        <input
          defaultValue={contact.twitter}
          name="twitter"
          placeholder="@jack"
          type="text"
        />
      </label>
      <label>
        <span>Avatar URL</span>
        <input
          aria-label="Avatar URL"
          defaultValue={contact.avatar}
          name="avatar"
          placeholder="https://example.com/avatar.jpg"
          type="text"
        />
      </label>
      <label>
        <span>Notes</span>
        <textarea
          defaultValue={contact.notes}
          name="notes"
          rows={6}
        />
      </label>
      <p>
        <button type="submit">Save</button>
        <button type="button">Cancel</button>
      </p>
    </Form>
  );
}
```

Now click on your new record, then click the "Edit" button. We should see the new route.

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/14.webp" />

## Updating Contacts with `FormData`

The edit route we just created already renders a `form`. All we need to do is add the `action` function. React Router will serialize the `form`, `POST` it with [`fetch`][fetch], and automatically revalidate all the data.

👉 **Add an `action` function to the edit route**

```tsx filename=app/routes/edit-contact.tsx lines=[1,4,8,6-15]
import { Form, redirect } from "react-router";
// existing imports

import { getContact, updateContact } from "../data";

export async function action({
  params,
  request,
}: Route.ActionArgs) {
  const formData = await request.formData();
  const updates = Object.fromEntries(formData);
  await updateContact(params.contactId, updates);
  return redirect(`/contacts/${params.contactId}`);
}

// existing code
```

Fill out the form, hit save, and you should see something like this! <small>(Except easier on the eyes and maybe with the patience to cut watermelon.)</small>

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/15.webp" />

## Mutation Discussion

> 😑 It worked, but I have no idea what is going on here...

Let's dig in a bit...

Open up `app/routes/edit-contact.tsx` and look at the `form` elements. Notice how they each have a name:

```tsx filename=app/routes/edit-contact.tsx lines=[4]
<input
  aria-label="First name"
  defaultValue={contact.first}
  name="first"
  placeholder="First"
  type="text"
/>
```

Without JavaScript, when a form is submitted, the browser will create [`FormData`][form-data] and set it as the body of the request when it sends it to the server. As mentioned before, React Router prevents that and emulates the browser by sending the request to your `action` function with [`fetch`][fetch] instead, including the [`FormData`][form-data].

Each field in the `form` is accessible with `formData.get(name)`. For example, given the input field from above, you could access the first and last names like this:

```tsx filename=app/routes/edit-contact.tsx  lines=[6,7] nocopy
export const action = async ({
  params,
  request,
}: ActionFunctionArgs) => {
  const formData = await request.formData();
  const firstName = formData.get("first");
  const lastName = formData.get("last");
  // ...
};
```

Since we have a handful of form fields, we used [`Object.fromEntries`][object-from-entries] to collect them all into an object, which is exactly what our `updateContact` function wants.

```tsx filename=app/routes/edit-contact.tsx nocopy
const updates = Object.fromEntries(formData);
updates.first; // "Some"
updates.last; // "Name"
```

Aside from the `action` function, none of these APIs we're discussing are provided by React Router: [`request`][request], [`request.formData`][request-form-data], [`Object.fromEntries`][object-from-entries] are all provided by the web platform.

After we finished the `action`, note the [`redirect`][redirect] at the end:

```tsx filename=app/routes/edit-contact.tsx lines=[9]
export async function action({
  params,
  request,
}: Route.ActionArgs) {
  invariant(params.contactId, "Missing contactId param");
  const formData = await request.formData();
  const updates = Object.fromEntries(formData);
  await updateContact(params.contactId, updates);
  return redirect(`/contacts/${params.contactId}`);
}
```

`action` and `loader` functions can both return a `Response` (makes sense, since they received a [`Request`][request]!). The [`redirect`][redirect] helper just makes it easier to return a [`Response`][response] that tells the app to change locations.

Without client side routing, if a server redirected after a `POST` request, the new page would fetch the latest data and render. As we learned before, React Router emulates this model and automatically revalidates the data on the page after the `action` call. That's why the sidebar automatically updates when we save the form. The extra revalidation code doesn't exist without client side routing, so it doesn't need to exist with client side routing in React Router either!

One last thing. Without JavaScript, the [`redirect`][redirect] would be a normal redirect. However, with JavaScript it's a client-side redirect, so the user doesn't lose client state like scroll positions or component state.

## Redirecting new records to the edit page

Now that we know how to redirect, let's update the action that creates new contacts to redirect to the edit page:

👉 **Redirect to the new record's edit page**

```tsx filename=app/root.tsx lines=[6,12]
import {
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  redirect,
} from "react-router";
// existing imports

export async function action() {
  const contact = await createEmptyContact();
  return redirect(`/contacts/${contact.id}/edit`);
}

// existing code
```

Now when we click "New", we should end up on the edit page:

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/16.webp" />

## Active Link Styling

Now that we have a bunch of records, it's not clear which one we're looking at in the sidebar. We can use [`NavLink`][nav-link] to fix this.

👉 **Replace `<Link>` with `<NavLink>` in the sidebar**

```tsx filename=app/layouts/sidebar.tsx lines=[1,17-26,28]
import { Form, Link, NavLink, Outlet } from "react-router";

// existing imports and exports

export default function SidebarLayout({
  loaderData,
}: Route.ComponentProps) {
  const { contacts } = loaderData;

  return (
    <>
      <div id="sidebar">
        {/* existing elements */}
        <ul>
          {contacts.map((contact) => (
            <li key={contact.id}>
              <NavLink
                className={({ isActive, isPending }) =>
                  isActive
                    ? "active"
                    : isPending
                    ? "pending"
                    : ""
                }
                to={`contacts/${contact.id}`}
              >
                {/* existing elements */}
              </NavLink>
            </li>
          ))}
        </ul>
        {/* existing elements */}
      </div>
      {/* existing elements */}
    </>
  );
}
```

Note that we are passing a function to `className`. When the user is at the URL that matches `<NavLink to>`, then `isActive` will be true. When it's _about_ to be active (the data is still loading) then `isPending` will be true. This allows us to easily indicate where the user is and also provide immediate feedback when links are clicked but data needs to be loaded.

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/17.webp" />

## Global Pending UI

As the user navigates the app, React Router will _leave the old page up_ as data is loading for the next page. You may have noticed the app feels a little unresponsive as you click between the list. Let's provide the user with some feedback so the app doesn't feel unresponsive.

React Router is managing all the state behind the scenes and reveals the pieces you need to build dynamic web apps. In this case, we'll use the [`useNavigation`][use-navigation] hook.

👉 **Use `useNavigation` to add global pending UI**

```tsx filename=app/layouts/sidebar.tsx lines=[6,13,19-21]
import {
  Form,
  Link,
  NavLink,
  Outlet,
  useNavigation,
} from "react-router";

export default function SidebarLayout({
  loaderData,
}: Route.ComponentProps) {
  const { contacts } = loaderData;
  const navigation = useNavigation();

  return (
    <>
      {/* existing elements */}
      <div
        className={
          navigation.state === "loading" ? "loading" : ""
        }
        id="detail"
      >
        <Outlet />
      </div>
    </>
  );
}
```

[`useNavigation`][use-navigation] returns the current navigation state: it can be one of `"idle"`, `"loading"` or `"submitting"`.

In our case, we add a `"loading"` class to the main part of the app if we're not idle. The CSS then adds a nice fade after a short delay (to avoid flickering the UI for fast loads). You could do anything you want though, like show a spinner or loading bar across the top.

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/18.webp" />

## Deleting Records

If we review code in the contact route, we can find the delete button looks like this:

```tsx filename=app/routes/contact.tsx lines=[2]
<Form
  action="destroy"
  method="post"
  onSubmit={(event) => {
    const response = confirm(
      "Please confirm you want to delete this record."
    );
    if (!response) {
      event.preventDefault();
    }
  }}
>
  <button type="submit">Delete</button>
</Form>
```

Note the `action` points to `"destroy"`. Like `<Link to>`, `<Form action>` can take a _relative_ value. Since the form is rendered in the route `contacts/:contactId`, then a relative action with `destroy` will submit the form to `contacts/:contactId/destroy` when clicked.

At this point you should know everything you need to know to make the delete button work. Maybe give it a shot before moving on? You'll need:

1. A new route
2. An `action` at that route
3. `deleteContact` from `app/data.ts`
4. `redirect` to somewhere after

👉 **Configure the "destroy" route module**

```shellscript nonumber
touch app/routes/destroy-contact.tsx
```

<!-- prettier-ignore -->
```tsx filename=app/routes.ts lines=[3]
export default [
    // existing routes
    route("contacts/:contactId/destroy", "routes/destroy-contact.tsx"),
    // existing routes
] satisfies RouteConfig;
```

👉 **Add the destroy action**

```tsx filename=app/routes/destroy-contact.tsx
import { redirect } from "react-router";
import type { Route } from "./+types/destroy-contact";

import { deleteContact } from "../data";

export async function action({ params }: Route.ActionArgs) {
  await deleteContact(params.contactId);
  return redirect("/");
}
```

Alright, navigate to a record and click the "Delete" button. It works!

> 😅 I'm still confused why this all works

When the user clicks the submit button:

1. `<Form>` prevents the default browser behavior of sending a new document `POST` request to the server, but instead emulates the browser by creating a `POST` request with client side routing and [`fetch`][fetch]
2. The `<Form action="destroy">` matches the new route at `contacts/:contactId/destroy` and sends it the request
3. After the `action` redirects, React Router calls all the `loader`s for the data on the page to get the latest values (this is "revalidation"). `loaderData` in `routes/contact.tsx` now has new values and causes the components to update!

Add a `Form`, add an `action`, React Router does the rest.

## Cancel Button

On the edit page we've got a cancel button that doesn't do anything yet. We'd like it to do the same thing as the browser's back button.

We'll need a click handler on the button as well as [`useNavigate`][use-navigate].

👉 **Add the cancel button click handler with `useNavigate`**

```tsx filename=app/routes/edit-contact.tsx lines=[1,8,15]
import { Form, redirect, useNavigate } from "react-router";
// existing imports & exports

export default function EditContact({
  loaderData,
}: Route.ComponentProps) {
  const { contact } = loaderData;
  const navigate = useNavigate();

  return (
    <Form key={contact.id} id="contact-form" method="post">
      {/* existing elements */}
      <p>
        <button type="submit">Save</button>
        <button onClick={() => navigate(-1)} type="button">
          Cancel
        </button>
      </p>
    </Form>
  );
}
```

Now when the user clicks "Cancel", they'll be sent back one entry in the browser's history.

> 🧐 Why is there no `event.preventDefault()` on the button?

A `<button type="button">`, while seemingly redundant, is the HTML way of preventing a button from submitting its form.

Two more features to go. We're on the home stretch!

## `URLSearchParams` and `GET` Submissions

All of our interactive UI so far have been either links that change the URL or `form`s that post data to `action` functions. The search field is interesting because it's a mix of both: it's a `form`, but it only changes the URL, it doesn't change data.

Let's see what happens when we submit the search form:

👉 **Type a name into the search field and hit the enter key**

Note the browser's URL now contains your query in the URL as [`URLSearchParams`][url-search-params]:

```
http://localhost:5173/?q=ryan
```

Since it's not `<Form method="post">`, React Router emulates the browser by serializing the [`FormData`][form-data] into the [`URLSearchParams`][url-search-params] instead of the request body.

`loader` functions have access to the search params from the `request`. Let's use it to filter the list:

👉 **Filter the list if there are `URLSearchParams`**

```tsx filename=app/layouts/sidebar.tsx lines=[3-8]
// existing imports & exports

export async function loader({
  request,
}: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const contacts = await getContacts(q);
  return { contacts };
}

// existing code
```

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/19.webp" />

Because this is a `GET`, not a `POST`, React Router _does not_ call the `action` function. Submitting a `GET` `form` is the same as clicking a link: only the URL changes.

This also means it's a normal page navigation. You can click the back button to get back to where you were.

## Synchronizing URLs to Form State

There are a couple of UX issues here that we can take care of quickly.

1. If you click back after a search, the form field still has the value you entered even though the list is no longer filtered.
2. If you refresh the page after searching, the form field no longer has the value in it, even though the list is filtered

In other words, the URL and our input's state are out of sync.

Let's solve (2) first and start the input with the value from the URL.

👉 **Return `q` from your `loader`, set it as the input's default value**

```tsx filename=app/layouts/sidebar.tsx lines=[9,15,26]
// existing imports & exports

export async function loader({
  request,
}: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const contacts = await getContacts(q);
  return { contacts, q };
}

export default function SidebarLayout({
  loaderData,
}: Route.ComponentProps) {
  const { contacts, q } = loaderData;
  const navigation = useNavigation();

  return (
    <>
      <div id="sidebar">
        {/* existing elements */}
        <div>
          <Form id="search-form" role="search">
            <input
              aria-label="Search contacts"
              defaultValue={q || ""}
              id="q"
              name="q"
              placeholder="Search"
              type="search"
            />
            {/* existing elements */}
          </Form>
          {/* existing elements */}
        </div>
        {/* existing elements */}
      </div>
      {/* existing elements */}
    </>
  );
}
```

The input field will show the query if you refresh the page after a search now.

Now for problem (1), clicking the back button and updating the input. We can bring in `useEffect` from React to manipulate the input's value in the DOM directly.

👉 **Synchronize input value with the `URLSearchParams`**

```tsx filename=app/layouts/sidebar.tsx lines=[2,12-17]
// existing imports
import { useEffect } from "react";

// existing imports & exports

export default function SidebarLayout({
  loaderData,
}: Route.ComponentProps) {
  const { contacts, q } = loaderData;
  const navigation = useNavigation();

  useEffect(() => {
    const searchField = document.getElementById("q");
    if (searchField instanceof HTMLInputElement) {
      searchField.value = q || "";
    }
  }, [q]);

  // existing code
}
```

> 🤔 Shouldn't you use a controlled component and React State for this?

You could certainly do this as a controlled component. You will have more synchronization points, but it's up to you.

<details>

<summary>Expand this to see what it would look like</summary>

```tsx filename=app/layouts/sidebar.tsx lines=[2,11-12,14-18,30-33,36-37]
// existing imports
import { useEffect, useState } from "react";

// existing imports & exports

export default function SidebarLayout({
  loaderData,
}: Route.ComponentProps) {
  const { contacts, q } = loaderData;
  const navigation = useNavigation();
  // the query now needs to be kept in state
  const [query, setQuery] = useState(q || "");

  // we still have a `useEffect` to synchronize the query
  // to the component state on back/forward button clicks
  useEffect(() => {
    setQuery(q || "");
  }, [q]);

  return (
    <>
      <div id="sidebar">
        {/* existing elements */}
        <div>
          <Form id="search-form" role="search">
            <input
              aria-label="Search contacts"
              id="q"
              name="q"
              // synchronize user's input to component state
              onChange={(event) =>
                setQuery(event.currentTarget.value)
              }
              placeholder="Search"
              type="search"
              // switched to `value` from `defaultValue`
              value={query}
            />
            {/* existing elements */}
          </Form>
          {/* existing elements */}
        </div>
        {/* existing elements */}
      </div>
      {/* existing elements */}
    </>
  );
}
```

</details>

Alright, you should now be able to click the back/forward/refresh buttons and the input's value should be in sync with the URL and results.

## Submitting `Form`'s `onChange`

We've got a product decision to make here. Sometimes you want the user to submit the `form` to filter some results, other times you want to filter as the user types. We've already implemented the first, so let's see what it's like for the second.

We've seen `useNavigate` already, we'll use its cousin, [`useSubmit`][use-submit], for this.

```tsx filename=app/layouts/sidebar.tsx lines=[7,16,27-29]
import {
  Form,
  Link,
  NavLink,
  Outlet,
  useNavigation,
  useSubmit,
} from "react-router";
// existing imports & exports

export default function SidebarLayout({
  loaderData,
}: Route.ComponentProps) {
  const { contacts, q } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();

  // existing code

  return (
    <>
      <div id="sidebar">
        {/* existing elements */}
        <div>
          <Form
            id="search-form"
            onChange={(event) =>
              submit(event.currentTarget)
            }
            role="search"
          >
            {/* existing elements */}
          </Form>
          {/* existing elements */}
        </div>
        {/* existing elements */}
      </div>
      {/* existing elements */}
    </>
  );
}
```

As you type, the `form` is automatically submitted now!

Note the argument to [`submit`][use-submit]. The `submit` function will serialize and submit any form you pass to it. We're passing in `event.currentTarget`. The `currentTarget` is the DOM node the event is attached to (the `form`).

## Adding Search Spinner

In a production app, it's likely this search will be looking for records in a database that is too large to send all at once and filter client side. That's why this demo has some faked network latency.

Without any loading indicator, the search feels kinda sluggish. Even if we could make our database faster, we'll always have the user's network latency in the way and out of our control.

For a better user experience, let's add some immediate UI feedback for the search. We'll use [`useNavigation`][use-navigation] again.

👉 **Add a variable to know if we're searching**

```tsx filename=app/layouts/sidebar.tsx lines=[9-13]
// existing imports & exports

export default function SidebarLayout({
  loaderData,
}: Route.ComponentProps) {
  const { contacts, q } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const searching =
    navigation.location &&
    new URLSearchParams(navigation.location.search).has(
      "q"
    );

  // existing code
}
```

When nothing is happening, `navigation.location` will be `undefined`, but when the user navigates it will be populated with the next location while data loads. Then we check if they're searching with `location.search`.

👉 **Add classes to search form elements using the new `searching` state**

```tsx filename=app/layouts/sidebar.tsx lines=[22,31]
// existing imports & exports

export default function SidebarLayout({
  loaderData,
}: Route.ComponentProps) {
  // existing code

  return (
    <>
      <div id="sidebar">
        {/* existing elements */}
        <div>
          <Form
            id="search-form"
            onChange={(event) =>
              submit(event.currentTarget)
            }
            role="search"
          >
            <input
              aria-label="Search contacts"
              className={searching ? "loading" : ""}
              defaultValue={q || ""}
              id="q"
              name="q"
              placeholder="Search"
              type="search"
            />
            <div
              aria-hidden
              hidden={!searching}
              id="search-spinner"
            />
          </Form>
          {/* existing elements */}
        </div>
        {/* existing elements */}
      </div>
      {/* existing elements */}
    </>
  );
}
```

Bonus points, avoid fading out the main screen when searching:

```tsx filename=app/layouts/sidebar.tsx lines=[13]
// existing imports & exports

export default function SidebarLayout({
  loaderData,
}: Route.ComponentProps) {
  // existing code

  return (
    <>
      {/* existing elements */}
      <div
        className={
          navigation.state === "loading" && !searching
            ? "loading"
            : ""
        }
        id="detail"
      >
        <Outlet />
      </div>
      {/* existing elements */}
    </>
  );
}
```

You should now have a nice spinner on the left side of the search input.

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/20.webp" />

## Managing the History Stack

Since the form is submitted for every keystroke, typing the characters "alex" and then deleting them with backspace results in a huge history stack 😂. We definitely don't want this:

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/21.webp" />

We can avoid this by _replacing_ the current entry in the history stack with the next page, instead of pushing into it.

👉 **Use `replace` in `submit`**

```tsx filename=app/layouts/sidebar.tsx lines=[16-19]
// existing imports & exports

export default function SidebarLayout({
  loaderData,
}: Route.ComponentProps) {
  // existing code

  return (
    <>
      <div id="sidebar">
        {/* existing elements */}
        <div>
          <Form
            id="search-form"
            onChange={(event) => {
              const isFirstSearch = q === null;
              submit(event.currentTarget, {
                replace: !isFirstSearch,
              });
            }}
            role="search"
          >
            {/* existing elements */}
          </Form>
          {/* existing elements */}
        </div>
        {/* existing elements */}
      </div>
      {/* existing elements */}
    </>
  );
}
```

After a quick check if this is the first search or not, we decide to replace. Now the first search will add a new entry, but every keystroke after that will replace the current entry. Instead of clicking back 7 times to remove the search, users only have to click back once.

## `Form`s Without Navigation

So far all of our forms have changed the URL. While these user flows are common, it's equally common to want to submit a form _without_ causing a navigation.

For these cases, we have [`useFetcher`][use-fetcher]. It allows us to communicate with `action`s and `loader`s without causing a navigation.

The ★ button on the contact page makes sense for this. We aren't creating or deleting a new record, and we don't want to change pages. We simply want to change the data on the page we're looking at.

👉 **Change the `<Favorite>` form to a fetcher form**

```tsx filename=app/routes/contact.tsx lines=[1,10,14,26]
import { Form, useFetcher } from "react-router";

// existing imports & exports

function Favorite({
  contact,
}: {
  contact: Pick<ContactRecord, "favorite">;
}) {
  const fetcher = useFetcher();
  const favorite = contact.favorite;

  return (
    <fetcher.Form method="post">
      <button
        aria-label={
          favorite
            ? "Remove from favorites"
            : "Add to favorites"
        }
        name="favorite"
        value={favorite ? "false" : "true"}
      >
        {favorite ? "★" : "☆"}
      </button>
    </fetcher.Form>
  );
}
```

This form will no longer cause a navigation, but simply fetch to the `action`. Speaking of which ... this won't work until we create the `action`.

👉 **Create the `action`**

```tsx filename=app/routes/contact.tsx lines=[2,5-13]
// existing imports
import { getContact, updateContact } from "../data";
// existing imports

export async function action({
  params,
  request,
}: Route.ActionArgs) {
  const formData = await request.formData();
  return updateContact(params.contactId, {
    favorite: formData.get("favorite") === "true",
  });
}

// existing code
```

Alright, we're ready to click the star next to the user's name!

<img class="tutorial" loading="lazy" src="/_docs/v7_address_book_tutorial/22.webp" />

Check that out, both stars automatically update. Our new `<fetcher.Form method="post">` works almost exactly like the `<Form>` we've been using: it calls the action and then all data is revalidated automatically — even your errors will be caught the same way.

There is one key difference though, it's not a navigation, so the URL doesn't change and the history stack is unaffected.

## Optimistic UI

You probably noticed the app felt kind of unresponsive when we clicked the favorite button from the last section. Once again, we added some network latency because you're going to have it in the real world.

To give the user some feedback, we could put the star into a loading state with `fetcher.state` (a lot like `navigation.state` from before), but we can do something even better this time. We can use a strategy called "Optimistic UI".

The fetcher knows the [`FormData`][form-data] being submitted to the `action`, so it's available to you on `fetcher.formData`. We'll use that to immediately update the star's state, even though the network hasn't finished. If the update eventually fails, the UI will revert to the real data.

👉 **Read the optimistic value from `fetcher.formData`**

```tsx filename=app/routes/contact.tsx lines=[9-11]
// existing code

function Favorite({
  contact,
}: {
  contact: Pick<ContactRecord, "favorite">;
}) {
  const fetcher = useFetcher();
  const favorite = fetcher.formData
    ? fetcher.formData.get("favorite") === "true"
    : contact.favorite;

  return (
    <fetcher.Form method="post">
      <button
        aria-label={
          favorite
            ? "Remove from favorites"
            : "Add to favorites"
        }
        name="favorite"
        value={favorite ? "false" : "true"}
      >
        {favorite ? "★" : "☆"}
      </button>
    </fetcher.Form>
  );
}
```

Now the star _immediately_ changes to the new state when you click it.

---

That's it! Thanks for giving React Router a shot. We hope this tutorial gives you a solid start to build great user experiences. There's a lot more you can do, so make sure to check out all the [APIs][react-router-apis] 😀

[http-localhost-5173]: http://localhost:5173
[root-route]: ../explanation/special-files#roottsx
[error-boundaries]: ../how-to/error-boundary
[links]: ../start/framework/route-module#links
[outlet-component]: https://api.reactrouter.com/v7/functions/react_router.Outlet
[file-route-conventions]: ../how-to/file-route-conventions
[contacts-1]: http://localhost:5173/contacts/1
[link-component]: https://api.reactrouter.com/v7/functions/react_router.Link
[client-loader]: ../start/framework/route-module#clientloader
[spa]: ../how-to/spa
[type-safety]: ../explanation/type-safety
[react-router-config]: ../explanation/special-files#react-routerconfigts
[rendering-strategies]: ../start/framework/rendering
[index-route]: ../start/framework/routing#index-routes
[layout-route]: ../start/framework/routing#layout-routes
[hydrate-fallback]: ../start/framework/route-module#hydratefallback
[about-page]: http://localhost:5173/about
[pre-rendering]: ../how-to/pre-rendering
[url-search-params]: https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
[loader]: ../start/framework/route-module#loader
[action]: ../start/framework/route-module#action
[form-component]: https://api.reactrouter.com/v7/functions/react_router.Form
[fetch]: https://developer.mozilla.org/en-US/docs/Web/API/fetch
[form-data]: https://developer.mozilla.org/en-US/docs/Web/API/FormData
[object-from-entries]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/fromEntries
[request-form-data]: https://developer.mozilla.org/en-US/docs/Web/API/Request/formData
[request]: https://developer.mozilla.org/en-US/docs/Web/API/Request
[redirect]: https://api.reactrouter.com/v7/functions/react_router.redirect
[response]: https://developer.mozilla.org/en-US/docs/Web/API/Response
[nav-link]: https://api.reactrouter.com/v7/functions/react_router.NavLink
[use-navigation]: https://api.reactrouter.com/v7/functions/react_router.useNavigation
[use-navigate]: https://api.reactrouter.com/v7/functions/react_router.useNavigate
[use-submit]: https://api.reactrouter.com/v7/functions/react_router.useSubmit
[use-fetcher]: https://api.reactrouter.com/v7/functions/react_router.useFetcher
[react-router-apis]: https://api.reactrouter.com/v7/modules/react_router
