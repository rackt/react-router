---
title: View Transitions
---

# View Transitions

Enable smooth animations between page transitions in your React Router applications using the [View Transitions API][view-transitions-api]. This feature allows you to create seamless visual transitions during client-side navigation.

## Basic View Transition

### 1. Enable view transitions on navigation

The simplest way to enable view transitions is by adding the `viewTransition` prop to your `Link`, `NavLink`, or `Form` components. This automatically wraps the navigation update in `document.startViewTransition()`.

```tsx
<Link to="/about" viewTransition>
  About
</Link>
```

Without any additional CSS, this provides a basic cross-fade animation between pages.

For more information on using the View Transitions API, please refer to the ["Smooth transitions with the View Transition API" guide][view-transitions-guide] from the Google Chrome team.

## Image Gallery Example

Let's build an image gallery that demonstrates how to trigger and use view transitions. We'll create a list of images that expand into a detail view with smooth animations.

### 2. Create the image gallery route

```tsx filename=routes/image-gallery.tsx
import { NavLink } from "react-router";

export const images = [
  "https://remix.run/blog-images/headers/the-future-is-now.jpg",
  "https://remix.run/blog-images/headers/waterfall.jpg",
  "https://remix.run/blog-images/headers/webpack.png",
  // ... more images ...
];

export default function ImageGalleryRoute() {
  return (
    <div className="image-list">
      <h1>Image List</h1>
      <div>
        {images.map((src, idx) => (
          <NavLink
            key={src}
            to={`/image/${idx}`}
            viewTransition // Enable view transitions for this link
          >
            <p>Image Number {idx}</p>
            <img
              className="max-w-full contain-layout"
              src={src}
            />
          </NavLink>
        ))}
      </div>
    </div>
  );
}
```

### 3. Add transition styles

Define view transition names and animations for elements that should transition smoothly between routes.

```css filename=app.css
/* Layout styles for the image grid */
.image-list > div {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  column-gap: 10px;
}

.image-list h1 {
  font-size: 2rem;
  font-weight: 600;
}

.image-list img {
  max-width: 100%;
  contain: layout;
}

.image-list p {
  width: fit-content;
}

/* Assign transition names to elements during navigation */
.image-list a.transitioning img {
  view-transition-name: image-expand;
}

.image-list a.transitioning p {
  view-transition-name: image-title;
}
```

### 4. Create the image detail route

The detail view needs to use the same view transition names to create a seamless animation.

```tsx filename=routes/image-details.tsx
import { Link } from "react-router";
import { images } from "./home";
import type { Route } from "./+types/image-details";

export default function ImageDetailsRoute({
  params,
}: Route.ComponentProps) {
  return (
    <div className="image-detail">
      <Link to="/" viewTransition>
        Back
      </Link>
      <h1>Image Number {params.id}</h1>
      <img src={images[Number(params.id)]} />
    </div>
  );
}
```

### 5. Add matching transition styles for the detail view

```css filename=app.css
/* Match transition names from the list view */
.image-detail h1 {
  font-size: 2rem;
  font-weight: 600;
  width: fit-content;
  view-transition-name: image-title;
}

.image-detail img {
  max-width: 100%;
  contain: layout;
  view-transition-name: image-expand;
}
```

## Advanced Usage

You can control view transitions more precisely using either render props or the `useViewTransitionState` hook.

### 1. Using render props

```tsx filename=routes/image-gallery.tsx
<NavLink to={`/image/${idx}`} viewTransition>
  {({ isTransitioning }) => (
    <>
      <p
        style={{
          viewTransitionName: isTransitioning
            ? "image-title"
            : "none",
        }}
      >
        Image Number {idx}
      </p>
      <img
        src={src}
        style={{
          viewTransitionName: isTransitioning
            ? "image-expand"
            : "none",
        }}
      />
    </>
  )}
</NavLink>
```

### 2. Using the `useViewTransitionState` hook

```tsx filename=routes/image-gallery.tsx
function NavImage(props: { src: string; idx: number }) {
  const href = `/image/${props.idx}`;
  // Hook provides transition state for specific route
  const isTransitioning = useViewTransitionState(href);

  return (
    <Link to={href} viewTransition>
      <p
        style={{
          viewTransitionName: isTransitioning
            ? "image-title"
            : "none",
        }}
      >
        Image Number {props.idx}
      </p>
      <img
        src={props.src}
        style={{
          viewTransitionName: isTransitioning
            ? "image-expand"
            : "none",
        }}
      />
    </Link>
  );
}
```

### 3. Using `viewTransition` for Custom Transition Styles

You can further customize the transition by specifying an array of view transition types. These types are passed to document.startViewTransition() and allow you to apply targeted CSS animations.

For example, you can set different animation styles like so:

```tsx
<Link
  to="/about"
  viewTransition={{ types: ["fade", "slide"] }}
>
  About
</Link>
```

When using this custom variation of the prop, React Router will pass the specified types to the underlying View Transitions API call, enabling your CSS to target these transition types and define custom animations.
[Read more about view transition types](https://developer.chrome.com/blog/view-transitions-update-io24#view-transition-types)

[view-transitions-api]: https://developer.mozilla.org/en-US/docs/Web/API/ViewTransition
[view-transitions-guide]: https://developer.chrome.com/docs/web-platform/view-transitions
