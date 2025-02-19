export const HOLE = -1;
export const NAN = -2;
export const NEGATIVE_INFINITY = -3;
export const NEGATIVE_ZERO = -4;
export const NULL = -5;
export const POSITIVE_INFINITY = -6;
export const UNDEFINED = -7;

export const TYPE_BIGINT = "B";
export const TYPE_DATE = "D";
export const TYPE_ERROR = "E";
export const TYPE_MAP = "M";
export const TYPE_NULL_OBJECT = "N";
export const TYPE_PROMISE = "P";
export const TYPE_REGEXP = "R";
export const TYPE_SET = "S";
export const TYPE_SYMBOL = "Y";
export const TYPE_URL = "U";
export const TYPE_PREVIOUS_RESOLVED = "Z";

export type DecodePlugin = (
  type: string,
  ...data: unknown[]
) => { value: unknown } | false | null | undefined;

export type EncodePlugin = (
  value: unknown
) => [string, ...unknown[]] | false | null | undefined;

export interface ThisDecode {
  values: unknown[];
  hydrated: unknown[];
  deferred: Record<number, Deferred<unknown>>;
  plugins?: DecodePlugin[];
}

export interface ThisEncode {
  index: number;
  indices: Map<unknown, number>;
  stringified: string[];
  deferred: Record<number, Promise<unknown>>;
  plugins?: EncodePlugin[];
  postPlugins?: EncodePlugin[];
  signal?: AbortSignal;
}

export class Deferred<T = unknown> {
  promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export function createLineSplittingTransform() {
  const decoder = new TextDecoder();
  let leftover = "";

  return new TransformStream({
    transform(chunk, controller) {
      const str = decoder.decode(chunk, { stream: true });
      const parts = (leftover + str).split("\n");

      // The last part might be a partial line, so keep it for the next chunk.
      leftover = parts.pop() || "";

      for (const part of parts) {
        controller.enqueue(part);
      }
    },

    flush(controller) {
      // If there's any leftover data, enqueue it before closing.
      if (leftover) {
        controller.enqueue(leftover);
      }
    },
  });
}
