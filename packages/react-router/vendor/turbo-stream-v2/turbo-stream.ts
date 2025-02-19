import { flatten } from "./flatten";
import { unflatten } from "./unflatten";
import {
  Deferred,
  TYPE_ERROR,
  TYPE_PREVIOUS_RESOLVED,
  TYPE_PROMISE,
  createLineSplittingTransform,
  type DecodePlugin,
  type EncodePlugin,
  type ThisDecode,
  type ThisEncode,
} from "./utils";

export type { DecodePlugin, EncodePlugin };

export async function decode(
  readable: ReadableStream<Uint8Array>,
  options?: { plugins?: DecodePlugin[] }
) {
  const { plugins } = options ?? {};

  const done = new Deferred<void>();
  const reader = readable
    .pipeThrough(createLineSplittingTransform())
    .getReader();

  const decoder: ThisDecode = {
    values: [],
    hydrated: [],
    deferred: {},
    plugins,
  };

  const decoded = await decodeInitial.call(decoder, reader);

  let donePromise = done.promise;
  if (decoded.done) {
    done.resolve();
  } else {
    donePromise = decodeDeferred
      .call(decoder, reader)
      .then(done.resolve)
      .catch((reason) => {
        for (const deferred of Object.values(decoder.deferred)) {
          deferred.reject(reason);
        }

        done.reject(reason);
      });
  }

  return {
    done: donePromise.then(() => reader.closed),
    value: decoded.value,
  };
}

async function decodeInitial(
  this: ThisDecode,
  reader: ReadableStreamDefaultReader<string>
) {
  const read = await reader.read();
  if (!read.value) {
    throw new SyntaxError();
  }

  let line: unknown;
  try {
    line = JSON.parse(read.value);
  } catch (reason) {
    throw new SyntaxError();
  }

  return {
    done: read.done,
    value: unflatten.call(this, line),
  };
}

async function decodeDeferred(
  this: ThisDecode,
  reader: ReadableStreamDefaultReader<string>
) {
  let read = await reader.read();
  while (!read.done) {
    if (!read.value) continue;
    const line = read.value;
    switch (line[0]) {
      case TYPE_PROMISE: {
        const colonIndex = line.indexOf(":");
        const deferredId = Number(line.slice(1, colonIndex));
        const deferred = this.deferred[deferredId];
        if (!deferred) {
          throw new Error(`Deferred ID ${deferredId} not found in stream`);
        }
        const lineData = line.slice(colonIndex + 1);
        let jsonLine: unknown;
        try {
          jsonLine = JSON.parse(lineData);
        } catch (reason) {
          throw new SyntaxError();
        }

        const value = unflatten.call(this, jsonLine);
        deferred.resolve(value);

        break;
      }
      case TYPE_ERROR: {
        const colonIndex = line.indexOf(":");
        const deferredId = Number(line.slice(1, colonIndex));
        const deferred = this.deferred[deferredId];
        if (!deferred) {
          throw new Error(`Deferred ID ${deferredId} not found in stream`);
        }
        const lineData = line.slice(colonIndex + 1);
        let jsonLine: unknown;
        try {
          jsonLine = JSON.parse(lineData);
        } catch (reason) {
          throw new SyntaxError();
        }
        const value = unflatten.call(this, jsonLine);
        deferred.reject(value);
        break;
      }
      default:
        throw new SyntaxError();
    }
    read = await reader.read();
  }
}

export function encode(
  input: unknown,
  options?: {
    plugins?: EncodePlugin[];
    postPlugins?: EncodePlugin[];
    signal?: AbortSignal;
  }
) {
  const { plugins, postPlugins, signal } = options ?? {};

  const encoder: ThisEncode = {
    deferred: {},
    index: 0,
    indices: new Map(),
    stringified: [],
    plugins,
    postPlugins,
    signal,
  };
  const textEncoder = new TextEncoder();
  let lastSentIndex = 0;
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const id = flatten.call(encoder, input);
      if (Array.isArray(id)) {
        throw new Error("This should never happen");
      }
      if (id < 0) {
        controller.enqueue(textEncoder.encode(`${id}\n`));
      } else {
        controller.enqueue(
          textEncoder.encode(`[${encoder.stringified.join(",")}]\n`)
        );
        lastSentIndex = encoder.stringified.length - 1;
      }

      const seenPromises = new WeakSet<Promise<unknown>>();
      if (Object.keys(encoder.deferred).length) {
        let raceDone!: () => void;
        const racePromise = new Promise<never>((resolve, reject) => {
          raceDone = resolve as () => void;
          if (signal) {
            const rejectPromise = () =>
              reject(signal.reason || new Error("Signal was aborted."));
            if (signal.aborted) {
              rejectPromise();
            } else {
              signal.addEventListener("abort", (event) => {
                rejectPromise();
              });
            }
          }
        });
        while (Object.keys(encoder.deferred).length > 0) {
          for (const [deferredId, deferred] of Object.entries(
            encoder.deferred
          )) {
            if (seenPromises.has(deferred)) continue;
            seenPromises.add(
              // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
              (encoder.deferred[Number(deferredId)] = Promise.race([
                racePromise,
                deferred,
              ])
                .then(
                  (resolved) => {
                    const id = flatten.call(encoder, resolved);
                    if (Array.isArray(id)) {
                      controller.enqueue(
                        textEncoder.encode(
                          `${TYPE_PROMISE}${deferredId}:[["${TYPE_PREVIOUS_RESOLVED}",${id[0]}]]\n`
                        )
                      );
                      encoder.index++;
                      lastSentIndex++;
                    } else if (id < 0) {
                      controller.enqueue(
                        textEncoder.encode(
                          `${TYPE_PROMISE}${deferredId}:${id}\n`
                        )
                      );
                    } else {
                      const values = encoder.stringified
                        .slice(lastSentIndex + 1)
                        .join(",");
                      controller.enqueue(
                        textEncoder.encode(
                          `${TYPE_PROMISE}${deferredId}:[${values}]\n`
                        )
                      );
                      lastSentIndex = encoder.stringified.length - 1;
                    }
                  },
                  (reason) => {
                    if (
                      !reason ||
                      typeof reason !== "object" ||
                      !(reason instanceof Error)
                    ) {
                      reason = new Error("An unknown error occurred");
                    }

                    const id = flatten.call(encoder, reason);
                    if (Array.isArray(id)) {
                      controller.enqueue(
                        textEncoder.encode(
                          `${TYPE_ERROR}${deferredId}:[["${TYPE_PREVIOUS_RESOLVED}",${id[0]}]]\n`
                        )
                      );
                      encoder.index++;
                      lastSentIndex++;
                    } else if (id < 0) {
                      controller.enqueue(
                        textEncoder.encode(`${TYPE_ERROR}${deferredId}:${id}\n`)
                      );
                    } else {
                      const values = encoder.stringified
                        .slice(lastSentIndex + 1)
                        .join(",");
                      controller.enqueue(
                        textEncoder.encode(
                          `${TYPE_ERROR}${deferredId}:[${values}]\n`
                        )
                      );
                      lastSentIndex = encoder.stringified.length - 1;
                    }
                  }
                )
                .finally(() => {
                  delete encoder.deferred[Number(deferredId)];
                }))
            );
          }
          await Promise.race(Object.values(encoder.deferred));
        }

        raceDone();
      }
      await Promise.all(Object.values(encoder.deferred));

      controller.close();
    },
  });

  return readable;
}
