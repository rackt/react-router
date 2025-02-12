import type { Register } from "./types/register";
import type { Equal } from "./types/utils";

type AnyParams = Record<string, Record<string, string | undefined>>;
type Params = Register extends {
  params: infer RegisteredParams extends AnyParams;
}
  ? RegisteredParams
  : AnyParams;

type Args = { [K in keyof Params]: ToArgs<Params[K]> };

// prettier-ignore
type ToArgs<T> =
  // path without params -> no `params` arg
  Equal<T, {}> extends true ? [] :
  // path with only optional params -> optional `params` arg
  Partial<T> extends T ? [T] | [] :
  // otherwise, require `params` arg
  [T];

/**
  Returns a resolved URL path for the specified route.

  ```tsx
  const h = href("/:lang?/about", { lang: "en" })
  // -> `/en/about`

  <Link to={href("/products/:id", { id: "abc123" })} />
  ```
 */
export function href<Path extends keyof Args>(
  path: Path,
  ...args: Args[Path]
): string {
  let params = args[0];
  return path
    .split("/")
    .map((segment) => {
      const match = segment.match(/^:([\w-]+)(\?)?/);
      if (!match) return segment;
      const param = match[1];
      const value = params ? params[param] : undefined;

      const isRequired = match[2] === undefined;
      if (isRequired && value === undefined) {
        throw Error(
          `Path '${path}' requires param '${param}' but it was not provided`
        );
      }
      return value;
    })
    .filter((segment) => segment !== undefined)
    .join("/");
}
