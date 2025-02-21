import type { HydrationState } from "../router/router";
import type { CriticalCss, FutureConfig } from "../dom/ssr/entry";
import { escapeHtml } from "./markup";

type ValidateShape<T, Shape> =
  // If it extends T
  T extends Shape
    ? // and there are no leftover props after removing the base
      Exclude<keyof T, keyof Shape> extends never
      ? // we are good
        T
      : // otherwise it's either too many or too few props
        never
    : never;

// TODO: Remove Promises from serialization
export function createServerHandoffString<T>(serverHandoff: {
  // Don't allow StaticHandlerContext to be passed in verbatim, since then
  // we'd end up including duplicate info
  state?: ValidateShape<T, HydrationState>;
  criticalCss?: CriticalCss;
  basename: string | undefined;
  future: FutureConfig;
  ssr: boolean;
  isSpaMode: boolean;
}): string {
  // Uses faster alternative of jsesc to escape data returned from the loaders.
  // This string is inserted directly into the HTML in the `<Scripts>` element.
  return escapeHtml(JSON.stringify(serverHandoff));
}
