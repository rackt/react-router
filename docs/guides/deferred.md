---
title: Deferred Data
description: When, why, and how to defer non-critical data loading with React 18 and React Router's defer API.
new: true
---

# Deferred Data Guide

## The problem

Imagine a scenario where one of your routes' loaders needs to retrieve some data that for one reason or another is quite slow. For example, let's say you're showing the user the location of a package that's being delivered to their home:

```jsx
import { json, useLoaderData } from "react-router-dom";
import { getPackageLocation } from "./api/packages";

async function loader({ params }) {
  const packageLocation = await getPackageLocation(
    params.packageId
  );

  return json({ packageLocation });
}

function PackageRoute() {
  const data = useLoaderData();
  const { packageLocation } = data;

  return (
    <main>
      <h1>Let's locate your package</h1>
      <p>
        Your package is at {packageLocation.latitude} lat
        and {packageLocation.longitude} long.
      </p>
    </main>
  );
}
```

We'll assume that `getPackageLocation` is slow. This will lead to initial page load times and transitions to that route to take as long as the slowest bit of data. There are a few things you can do to optimize this and improve the user experience:

- Speed up the slow thing (😅).
- Parallelize data loading with `Promise.all` (we have nothing to parallelize in our example, but it might help a bit in other situations).
- Add a global transition spinner (helps a bit with UX).
- Add a localized skeleton UI (helps a bit with UX).

If these approaches don't work well, then you may feel forced to move the slow data out of the `loader` into a component fetch (and show a skeleton fallback UI while loading). In this case you'd render the fallback UI on mount and fire off the fetch for the data. This is actually not so terrible from a DX standpoint thanks to [`useFetcher`][usefetcher]. And from a UX standpoint this improves the loading experience for both client-side transitions as well as initial page load. So it does seem to solve the problem.

But it's still sub optimal in most cases (especially if you're code-splitting route components) for two reasons:

1. Client-side fetching puts your data request on a waterfall: document -> JavaScript -> Lazy Loaded Route -> data fetch
2. Your code can't easily switch between component fetching and route fetching (more on this later).

## The solution

React Router takes advantage of React 18's Suspense for data fetching using the [`defer` Response][defer response] utility and [`<Await />`][await] component / [`useAsyncValue`][useasyncvalue] hook. By using these APIs, you can solve both of these problems:

1. Your data is no longer on a waterfall: document -> JavaScript -> Lazy Loaded Route & data (in parallel)
2. Your code can easily switch between rendering the fallback and waiting for the data

Let's take a dive into how to accomplish this.

### Using `defer`

Start by adding `<Await />` for your slow data requests where you'd rather render a fallback UI. Let's do that for our example above:

```jsx lines=[3,9,13-15,24-40]
import {
  Await,
  defer,
  useLoaderData,
} from "react-router-dom";
import { getPackageLocation } from "./api/packages";

async function loader({ params }) {
  const packageLocationPromise = getPackageLocation(
    params.packageId
  );

  return defer({
    packageLocation: packageLocationPromise,
    id: params.packageId,
  });
}

export default function PackageRoute() {
  const data = useLoaderData();

  return (
    <main>
      <h1>Let's locate your package</h1>
      <React.Suspense
        key={data.id}
        fallback={<p>Loading package location...</p>}
      >
        <Await
          resolve={data.packageLocation}
          errorElement={
            <p>Error loading package location!</p>
          }
        >
          {(packageLocation) => (
            <p>
              Your package is at {packageLocation.latitude}{" "}
              lat and {packageLocation.longitude} long.
            </p>
          )}
        </Await>
      </React.Suspense>
    </main>
  );
}
```

<details>
  <summary>Alternatively, you can use the `useAsyncValue` hook:</summary>

If you're not jazzed about bringing back render props, you can use a hook, but you'll have to break things out into another component:

```jsx lines=[11, 16, 23-31]
export default function PackageRoute() {
  const data = useLoaderData();

  return (
    <main>
      <h1>Let's locate your package</h1>
      <React.Suspense
        key={data.id}
        fallback={<p>Loading package location...</p>}
      >
        <Await
          resolve={data.packageLocation}
          errorElement={
            <p>Error loading package location!</p>
          }
        >
          <PackageLocation />
        </Await>
      </React.Suspense>
    </main>
  );
}

function PackageLocation() {
  const packageLocation = useAsyncValue();
  return (
    <p>
      Your package is at {packageLocation.latitude} lat and{" "}
      {packageLocation.longitude} long.
    </p>
  );
}
```

</details>

## Evaluating the solution

So rather than waiting for the component before we can trigger the fetch request, we start the request for the slow data as soon as the user starts the transition to the new route. This can significantly speed up the user experience for slower networks.

Additionally, the API that React Router exposes for this is extremely ergonomic. You can literally switch between whether something is going to be deferred or not based on whether you include the `await` keyword:

```tsx
return defer({
  // not deferred:
  packageLocation: await packageLocationPromise,
  // deferred:
  packageLocation: packageLocationPromise,
});
```

Because of this, you can A/B test deferring, or even determine whether to defer based on the user or data being requested:

```tsx
async function loader({ request, params }) {
  const packageLocationPromise = getPackageLocation(
    params.packageId
  );
  const shouldDefer = shouldDeferPackageLocation(
    request,
    params.packageId
  );

  return defer({
    packageLocation: shouldDefer
      ? packageLocationPromise
      : await packageLocationPromise,
  });
}
```

That `shouldDeferPackageLocation` could be implemented to check the user making the request, whether the package location data is in a cache, the status of an A/B test, or whatever else you want. This is pretty sweet 🍭

## FAQ

### Why not defer everything by default?

The React Router defer API is another lever React Router offers to give you a nice way to choose between trade-offs. Do you want the page to render more quickly? Defer stuff. Do you want a lower CLS (Content Layout Shift)? Don't defer stuff. You want a faster render, but also want a lower CLS? Defer just the slow and unimportant stuff.

It's all trade-offs, and what's neat about the API design is that it's well suited for you to do easy experimentation to see which trade-offs lead to better results for your real-world key indicators.

### When does the `<Suspense/>` fallback render?

The `<Await />` component will only throw the promise up the `<Suspense>` boundary on the initial render of the `<Await />` component with an unsettled promise. It will not re-render the fallback if props change. Effectively, this means that you _will not_ get a fallback rendered when a user submits a form and loader data is revalidated. You _will_ get a fallback rendered when the user navigates to the same route with different params (in the context of our above example, if the user selects from a list of packages on the left to find their location on the right). If the fallback is not being rendered when the props change, ensure you have a `key` on the `<Suspense>` boundary to force it to recognize that the props have changed.

This may feel counter-intuitive at first, but stay with us, we really thought this through and it's important that it works this way. Let's imagine a world without the deferred API. For those scenarios you're probably going to want to implement Optimistic UI for form submissions/revalidation.

When you decide you'd like to try the trade-offs of `defer`, we don't want you to have to change or remove those optimizations because we want you to be able to easily switch between deferring some data and not deferring it. So, we ensure that your existing optimistic states work the same way. If we didn't do this, then you could experience what we call "Popcorn UI" where submissions of data trigger the fallback loading state instead of the optimistic UI you'd worked hard on.

So just keep this in mind: **Deferred is 100% only about the initial load of a route and its params.**

### Why don't Response objects returned by the loader work anymore?

When you use `defer`, you're telling React Router to load the page immediately, without the deferred data. The page is already loaded before the `Response` object is returned so responses are not automatically processed in the same way as if you had done `return fetch(url)`.

Therefore, you will need to handle your own `Response` processing and resolve your deferred Promise with data, not a `Response` instance.

```jsx
async function loader({ request, params }) {
  return defer({
    // Broken! Resolves with a Response
    // broken: fetch(url),

    // Fixed! Resolves with the response data
    data: fetch(url).then((res) => res.json()),
  });
}
```

Or consider the scenario where our deferred data could return a redirect `Response`. You can detect the redirect and send the status code and location back as data, and then you could perform a client-side redirect in your component via `useEffect` and `useNavigate`.

```jsx
async function loader({ request, params }) {
  let data = fetch(url).then((res) => {
    if (res.status == 301) {
      return {
        isRedirect: true,
        status: res.status,
        location: res.headers.get("Location"),
      };
    }
    return res.json();
  });

  return defer({ data });
}
```

[link]: ../components/link
[usefetcher]: ../hooks/use-fetcher
[defer response]: ../utils/defer
[await]: ../components/await
[useasyncvalue]: ../hooks/use-async-value
