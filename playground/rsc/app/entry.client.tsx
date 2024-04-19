import { HydratedRouter } from "react-router-dom";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
// @ts-expect-error - no types
import ReactServerDOM from "react-server-dom-diy/client";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});

window.createFromReadableStream = function createFromReadableStream(
  body: ReadableStream<Uint8Array>
) {
  return ReactServerDOM.createFromReadableStream(body);
};
