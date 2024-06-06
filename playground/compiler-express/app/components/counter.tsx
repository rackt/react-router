"use client";

import * as React from "react";

export function Counter() {
  const [count, setCount] = React.useState(0);

  return (
    <div>
      <h1>Counter</h1>
      <p>Count is: {count}</p>
      <button onClick={() => setCount((c) => c + 1)}>Increment</button>
    </div>
  );
}
