import {
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
  type ThisEncode,
} from "./utils";

export function flatten(this: ThisEncode, input: unknown): number | [number] {
  const { indices } = this;
  const existing = indices.get(input);
  if (existing) return [existing];

  if (input === undefined) return UNDEFINED;
  if (input === null) return NULL;
  if (Number.isNaN(input)) return NAN;
  if (input === Number.POSITIVE_INFINITY) return POSITIVE_INFINITY;
  if (input === Number.NEGATIVE_INFINITY) return NEGATIVE_INFINITY;
  if (input === 0 && 1 / input < 0) return NEGATIVE_ZERO;

  const index = this.index++;
  indices.set(input, index);
  stringify.call(this, input, index);
  return index;
}

function stringify(this: ThisEncode, input: unknown, index: number) {
  const { deferred, plugins, postPlugins } = this;
  const str = this.stringified;

  const stack: [unknown, number][] = [[input, index]];
  while (stack.length > 0) {
    const [input, index] = stack.pop()!;

    const partsForObj = (obj: any) =>
      Object.keys(obj)
        .map((k) => `"_${flatten.call(this, k)}":${flatten.call(this, obj[k])}`)
        .join(",");
    let error: Error | null = null;

    switch (typeof input) {
      case "boolean":
      case "number":
      case "string":
        str[index] = JSON.stringify(input);
        break;
      case "bigint":
        str[index] = `["${TYPE_BIGINT}","${input}"]`;
        break;
      case "symbol": {
        const keyFor = Symbol.keyFor(input);
        if (!keyFor) {
          error = new Error(
            "Cannot encode symbol unless created with Symbol.for()"
          );
        } else {
          str[index] = `["${TYPE_SYMBOL}",${JSON.stringify(keyFor)}]`;
        }
        break;
      }
      case "object": {
        if (!input) {
          str[index] = `${NULL}`;
          break;
        }

        const isArray = Array.isArray(input);
        let pluginHandled = false;
        if (!isArray && plugins) {
          for (const plugin of plugins) {
            const pluginResult = plugin(input);
            if (Array.isArray(pluginResult)) {
              pluginHandled = true;
              const [pluginIdentifier, ...rest] = pluginResult;
              str[index] = `[${JSON.stringify(pluginIdentifier)}`;
              if (rest.length > 0) {
                str[index] += `,${rest
                  .map((v) => flatten.call(this, v))
                  .join(",")}`;
              }
              str[index] += "]";
              break;
            }
          }
        }

        if (!pluginHandled) {
          let result = isArray ? "[" : "{";
          if (isArray) {
            for (let i = 0; i < input.length; i++)
              result +=
                (i ? "," : "") +
                (i in input ? flatten.call(this, input[i]) : HOLE);
            str[index] = `${result}]`;
          } else if (input instanceof Date) {
            str[index] = `["${TYPE_DATE}",${input.getTime()}]`;
          } else if (input instanceof URL) {
            str[index] = `["${TYPE_URL}",${JSON.stringify(input.href)}]`;
          } else if (input instanceof RegExp) {
            str[index] = `["${TYPE_REGEXP}",${JSON.stringify(
              input.source
            )},${JSON.stringify(input.flags)}]`;
          } else if (input instanceof Set) {
            if (input.size > 0) {
              str[index] = `["${TYPE_SET}",${[...input]
                .map((val) => flatten.call(this, val))
                .join(",")}]`;
            } else {
              str[index] = `["${TYPE_SET}"]`;
            }
          } else if (input instanceof Map) {
            if (input.size > 0) {
              str[index] = `["${TYPE_MAP}",${[...input]
                .flatMap(([k, v]) => [
                  flatten.call(this, k),
                  flatten.call(this, v),
                ])
                .join(",")}]`;
            } else {
              str[index] = `["${TYPE_MAP}"]`;
            }
          } else if (input instanceof Promise) {
            str[index] = `["${TYPE_PROMISE}",${index}]`;
            deferred[index] = input;
          } else if (input instanceof Error) {
            str[index] = `["${TYPE_ERROR}",${JSON.stringify(input.message)}`;
            if (input.name !== "Error") {
              str[index] += `,${JSON.stringify(input.name)}`;
            }
            str[index] += "]";
          } else if (Object.getPrototypeOf(input) === null) {
            str[index] = `["${TYPE_NULL_OBJECT}",{${partsForObj(input)}}]`;
          } else if (isPlainObject(input)) {
            str[index] = `{${partsForObj(input)}}`;
          } else {
            error = new Error("Cannot encode object with prototype");
          }
        }
        break;
      }
      default: {
        const isArray = Array.isArray(input);
        let pluginHandled = false;
        if (!isArray && plugins) {
          for (const plugin of plugins) {
            const pluginResult = plugin(input);
            if (Array.isArray(pluginResult)) {
              pluginHandled = true;
              const [pluginIdentifier, ...rest] = pluginResult;
              str[index] = `[${JSON.stringify(pluginIdentifier)}`;
              if (rest.length > 0) {
                str[index] += `,${rest
                  .map((v) => flatten.call(this, v))
                  .join(",")}`;
              }
              str[index] += "]";
              break;
            }
          }
        }

        if (!pluginHandled) {
          error = new Error("Cannot encode function or unexpected type");
        }
      }
    }

    if (error) {
      let pluginHandled = false;

      if (postPlugins) {
        for (const plugin of postPlugins) {
          const pluginResult = plugin(input);
          if (Array.isArray(pluginResult)) {
            pluginHandled = true;
            const [pluginIdentifier, ...rest] = pluginResult;
            str[index] = `[${JSON.stringify(pluginIdentifier)}`;
            if (rest.length > 0) {
              str[index] += `,${rest
                .map((v) => flatten.call(this, v))
                .join(",")}`;
            }
            str[index] += "]";
            break;
          }
        }
      }

      if (!pluginHandled) {
        throw error;
      }
    }
  }
}

const objectProtoNames = Object.getOwnPropertyNames(Object.prototype)
  .sort()
  .join("\0");

function isPlainObject(
  thing: unknown
): thing is Record<string | number | symbol, unknown> {
  const proto = Object.getPrototypeOf(thing);
  return (
    proto === Object.prototype ||
    proto === null ||
    Object.getOwnPropertyNames(proto).sort().join("\0") === objectProtoNames
  );
}
