---
title: HashRouter
---

# `<HashRouter>`

<details>
  <summary>Type declaration</summary>

```tsx
declare function HashRouter(
  props: HashRouterProps
): React.ReactElement;

interface HashRouterProps {
  basename?: string;
  hashType?: HashType
  children?: React.ReactNode;
  future?: FutureConfig;
  window?: Window;
}
```

</details>  

`<HashRouter>` is for use in web browsers when the URL should not (or cannot) be sent to the server for some reason. This may happen in some shared hosting scenarios where you do not have full control over the server. In these situations, `<HashRouter>` makes it possible to store the current location in the `hash` portion of the current URL, so it is never sent to the server.

```tsx
import * as React from "react";
import * as ReactDOM from "react-dom";
import { HashRouter } from "react-router-dom";

ReactDOM.render(
  <HashRouter>
    {/* The rest of your app goes here */}
  </HashRouter>,
  root
);
```

<docs-warning>We strongly recommend you do not use `HashRouter` unless you absolutely have to.</docs-warning>

## `basename`

Configure your application to run underneath a specific basename in the URL:

```jsx
function App() {
  return (
    <HashRouter basename="/app">
      <Routes>
        <Route path="/" /> {/* 👈 Renders at /#/app/ */}
      </Routes>
    </HashRouter>
  );
}
```

## `hashType`

Decide wether to put a slash after the '#' in the URL (default: 'slash')

```jsx
function App() {
  return (
    <HashRouter hashType='noslash'>
      <Routes>
        <Route path="/bookmark" /> {/* 👈 Renders at /#bookmark/ */}
      </Routes>
    </HashRouter>
  );
}
```

## `future`

An optional set of [Future Flags][api-development-strategy] to enable. We recommend opting into newly released future flags sooner rather than later to ease your eventual migration to v7.

```jsx
function App() {
  return (
    <HashRouter future={{ v7_startTransition: true }}>
      <Routes>{/*...*/}</Routes>
    </HashRouter>
  );
}
```

## `window`

`HashRouter` defaults to using the current [document's `defaultView`][defaultview], but it may also be used to track changes to another window's URL, in an `<iframe>`, for example.

[defaultview]: https://developer.mozilla.org/en-US/docs/Web/API/Document/defaultView
[api-development-strategy]: ../guides/api-development-strategy
