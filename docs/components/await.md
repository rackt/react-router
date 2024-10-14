---
title: Await
new: true
---

## `<Await>`

Used to render [deferred][defer] values with automatic error handling. Make sure to review the [Deferred Data Guide][deferred guide] since there are a few APIs that work together with this component.

```jsx lines=[1,10-18]
import { Await, useLoaderData } from "react-router-dom";

function Book() {
  const { book, reviews } = useLoaderData();
  return (
    <div>
      <h1>{book.title}</h1>
      <p>{book.description}</p>
      <React.Suspense key={book.id} fallback={<ReviewsSkeleton />}>
        <Await
          resolve={reviews}
          errorElement={
            <div>Could not load reviews 😬</div>
          }
          children={(resolvedReviews) => (
            <Reviews items={resolvedReviews} />
          )}
        />
      </React.Suspense>
    </div>
  );
}
```

**Note:** `<Await>` expects to be rendered inside of a `<React.Suspense>` or `<React.SuspenseList>` parent to enable the fallback UI.

**Note:** Add a data-bound `key` to the parent of `<Await>` to ensure if the route changes, the fallback is invoked while new data is loaded.

## Type declaration

```tsx
declare function Await(
  props: AwaitProps
): React.ReactElement;

interface AwaitProps {
  children: React.ReactNode | AwaitResolveRenderFunction;
  errorElement?: React.ReactNode;
  resolve: TrackedPromise | any;
}

interface AwaitResolveRenderFunction {
  (data: Awaited<any>): React.ReactElement;
}
```

## `children`

Can either be React elements or a function.

When using a function, the value is provided as the only parameter.

```tsx [2]
<Await resolve={reviewsPromise}>
  {(resolvedReviews) => <Reviews items={resolvedReviews} />}
</Await>
```

When using React elements, [`useAsyncValue`][useasyncvalue] will provide the data:

```tsx [2]
<Await resolve={reviewsPromise}>
  <Reviews />
</Await>;

function Reviews() {
  const resolvedReviews = useAsyncValue();
  return <div>{/* ... */}</div>;
}
```

## `errorElement`

The error element renders instead of the children when the promise rejects. You can access the error with [`useAsyncError`][useasyncerror].

If the promise rejects, you can provide an optional `errorElement` to handle that error in a contextual UI via the `useAsyncError` hook.

```tsx [3,9]
<Await
  resolve={reviewsPromise}
  errorElement={<ReviewsError />}
>
  <Reviews />
</Await>;

function ReviewsError() {
  const error = useAsyncError();
  return <div>{error.message}</div>;
}
```

If you do not provide an errorElement, the rejected value will bubble up to the nearest route-level [`errorElement`][routeerrorelement] and be accessible via the [`useRouteError`][userouteerror] hook.

## `resolve`

Takes a promise returned from a [deferred][defer] [loader][loader] value to be resolved and rendered.

```jsx [12,15,24,32-33]
import {
  defer,
  Route,
  useLoaderData,
  Await,
} from "react-router-dom";

// given this route
<Route
  loader={async () => {
    let book = await getBook();
    let reviews = getReviews(); // not awaited
    return defer({
      book,
      reviews, // this is a promise
    });
  }}
  element={<Book />}
/>;

function Book() {
  const {
    book,
    reviews, // this is the same promise
  } = useLoaderData();
  return (
    <div>
      <h1>{book.title}</h1>
      <p>{book.description}</p>
      <React.Suspense key={book.id} fallback={<ReviewsSkeleton />}>
        <Await
          // and is the promise we pass to Await
          resolve={reviews}
        >
          <Reviews />
        </Await>
      </React.Suspense>
    </div>
  );
}
```

[useloaderdata]: ../hooks/use-loader-data
[userouteerror]: ../hooks/use-route-error
[defer]: ../utils/defer
[deferred guide]: ../guides/deferred
[useasyncvalue]: ../hooks/use-async-value
[useasyncerror]: ../hooks/use-async-error
[routeerrorelement]: ../route/error-element
[loader]: ../route/loader
