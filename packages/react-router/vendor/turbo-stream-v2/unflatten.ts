import {
  Deferred,
  HOLE,
  NAN,
  NEGATIVE_INFINITY,
  NEGATIVE_ZERO,
  NULL,
  POSITIVE_INFINITY,
  UNDEFINED,
  TYPE_BIGINT,
  TYPE_DATE,
  TYPE_ERROR,
  TYPE_MAP,
  TYPE_NULL_OBJECT,
  TYPE_PREVIOUS_RESOLVED,
  TYPE_PROMISE,
  TYPE_REGEXP,
  TYPE_SET,
  TYPE_SYMBOL,
  TYPE_URL,
  type ThisDecode,
} from "./utils";

const globalObj = (
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
    ? globalThis
    : undefined
) as Record<string, typeof Error> | undefined;

export function unflatten(this: ThisDecode, parsed: unknown): unknown {
  const { hydrated, values } = this;
  if (typeof parsed === "number") return hydrate.call(this, parsed);

  if (!Array.isArray(parsed) || !parsed.length) throw new SyntaxError();

  const startIndex = values.length;
  for (const value of parsed) {
    values.push(value);
  }
  hydrated.length = values.length;

  return hydrate.call(this, startIndex);
}

function hydrate(this: ThisDecode, index: number): any {
  const { hydrated, values, deferred, plugins } = this;

  let result: unknown;
  const stack = [
    [
      index,
      (v: unknown) => {
        result = v;
      },
    ] as const,
  ];

  let postRun: Array<() => void> = [];

  while (stack.length > 0) {
    const [index, set] = stack.pop()!;

    switch (index) {
      case UNDEFINED:
        set(undefined);
        continue;
      case NULL:
        set(null);
        continue;
      case NAN:
        set(NaN);
        continue;
      case POSITIVE_INFINITY:
        set(Infinity);
        continue;
      case NEGATIVE_INFINITY:
        set(-Infinity);
        continue;
      case NEGATIVE_ZERO:
        set(-0);
        continue;
    }

    if (hydrated[index]) {
      set(hydrated[index]);
      continue;
    }

    const value = values[index];
    if (!value || typeof value !== "object") {
      hydrated[index] = value;
      set(value);
      continue;
    }

    if (Array.isArray(value)) {
      if (typeof value[0] === "string") {
        const [type, b, c] = value;
        switch (type) {
          case TYPE_DATE:
            set((hydrated[index] = new Date(b)));
            continue;
          case TYPE_URL:
            set((hydrated[index] = new URL(b)));
            continue;
          case TYPE_BIGINT:
            set((hydrated[index] = BigInt(b)));
            continue;
          case TYPE_REGEXP:
            set((hydrated[index] = new RegExp(b, c)));
            continue;
          case TYPE_SYMBOL:
            set((hydrated[index] = Symbol.for(b)));
            continue;
          case TYPE_SET:
            const newSet = new Set();
            hydrated[index] = newSet;
            for (let i = 1; i < value.length; i++)
              stack.push([
                value[i],
                (v) => {
                  newSet.add(v);
                },
              ]);
            set(newSet);
            continue;
          case TYPE_MAP:
            const map = new Map();
            hydrated[index] = map;
            for (let i = 1; i < value.length; i += 2) {
              const r: any[] = [];
              stack.push([
                value[i + 1],
                (v) => {
                  r[1] = v;
                },
              ]);
              stack.push([
                value[i],
                (k) => {
                  r[0] = k;
                },
              ]);
              postRun.push(() => {
                map.set(r[0], r[1]);
              });
            }
            set(map);
            continue;
          case TYPE_NULL_OBJECT:
            const obj = Object.create(null);
            hydrated[index] = obj;
            for (const key of Object.keys(b).reverse()) {
              const r: any[] = [];
              stack.push([
                b[key],
                (v) => {
                  r[1] = v;
                },
              ]);
              stack.push([
                Number(key.slice(1)),
                (k) => {
                  r[0] = k;
                },
              ]);
              postRun.push(() => {
                obj[r[0]] = r[1];
              });
            }
            set(obj);
            continue;
          case TYPE_PROMISE:
            if (hydrated[b]) {
              set((hydrated[index] = hydrated[b]));
            } else {
              const d = new Deferred();
              deferred[b] = d;
              set((hydrated[index] = d.promise));
            }
            continue;
          case TYPE_ERROR:
            const [, message, errorType] = value;
            let error =
              errorType && globalObj && globalObj[errorType]
                ? new globalObj[errorType](message)
                : new Error(message);
            hydrated[index] = error;
            set(error);
            continue;
          case TYPE_PREVIOUS_RESOLVED:
            set((hydrated[index] = hydrated[b]));
            continue;
          default:
            // Run plugins at the end so we have a chance to resolve primitives
            // without running into a loop
            if (Array.isArray(plugins)) {
              const r: unknown[] = [];
              const vals = value.slice(1);
              for (let i = 0; i < vals.length; i++) {
                const v = vals[i];
                stack.push([
                  v,
                  (v) => {
                    r[i] = v;
                  },
                ]);
              }
              postRun.push(() => {
                for (const plugin of plugins) {
                  const result = plugin(value[0], ...r);
                  if (result) {
                    set((hydrated[index] = result.value));
                    return;
                  }
                }
                throw new SyntaxError();
              });
              continue;
            }
            throw new SyntaxError();
        }
      } else {
        const array: unknown[] = [];
        hydrated[index] = array;

        for (let i = 0; i < value.length; i++) {
          const n = value[i];
          if (n !== HOLE) {
            stack.push([
              n,
              (v) => {
                array[i] = v;
              },
            ]);
          }
        }
        set(array);
        continue;
      }
    } else {
      const object: Record<string, unknown> = {};
      hydrated[index] = object;

      for (const key of Object.keys(value).reverse()) {
        const r: any[] = [];
        stack.push([
          (value as Record<string, number>)[key],
          (v) => {
            r[1] = v;
          },
        ]);
        stack.push([
          Number(key.slice(1)),
          (k) => {
            r[0] = k;
          },
        ]);
        postRun.push(() => {
          object[r[0]] = r[1];
        });
      }
      set(object);
      continue;
    }
  }

  while (postRun.length > 0) {
    postRun.pop()!();
  }

  return result;
}
