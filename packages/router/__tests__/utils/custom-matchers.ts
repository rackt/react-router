import type { DeferredData, TrackedPromise } from "../../utils";
import { AbortedDeferredError } from "../../utils";

interface CustomMatchers<R = jest.Expect> {
  URL(url: string);
  trackedPromise(data?: any, error?: any, aborted?: boolean): R;
  deferredData(
    done: boolean,
    status?: number,
    headers?: Record<string, string>
  ): R;
}

declare global {
  namespace jest {
    interface Expect extends CustomMatchers {}
    interface Matchers<R> extends CustomMatchers<R> {}
    interface InverseAsymmetricMatchers extends CustomMatchers {}
  }
}

// Custom matcher for asserting against URLs
export function urlMatch(received, url) {
  return {
    message: () => `expected URL ${received.toString()} to equal URL ${url}`,
    pass: received instanceof URL && received.toString() === url,
  };
}

// Custom matcher for asserting deferred promise results for static handler
//  - expect(val).deferredData(false) => Unresolved promise
//  - expect(val).deferredData(false) => Resolved promise
//  - expect(val).deferredData(false, 201, { 'x-custom': 'yes' })
//      => Unresolved promise with status + headers
//  - expect(val).deferredData(true, 201, { 'x-custom': 'yes' })
//      => Resolved promise with status + headers
export function deferredData(received, done, status = 200, headers = {}) {
  let deferredData = received as DeferredData;

  return {
    message: () =>
      `expected done=${String(done)}/status=${status}/headers=${JSON.stringify(
        headers
      )}, ` +
      `instead got done=${String(deferredData.done)}/status=${
        deferredData.init!.status || 200
      }/headers=${JSON.stringify(
        Object.fromEntries(
          (deferredData.init!.headers
            ? new Headers(deferredData.init!.headers)
            : new Headers()
          ).entries()
        )
      )}`,
    pass:
      deferredData.done === done &&
      (deferredData.init!.status || 200) === status &&
      JSON.stringify(
        Object.fromEntries(
          (deferredData.init!.headers
            ? new Headers(deferredData.init!.headers)
            : new Headers()
          ).entries()
        )
      ) === JSON.stringify(headers),
  };
}

// Custom matcher for asserting deferred promise results inside of `toEqual()`
//  - expect.trackedPromise()                  =>  pending promise
//  - expect.trackedPromise(value)             =>  promise resolved with `value`
//  - expect.trackedPromise(null, error)       =>  promise rejected with `error`
//  - expect.trackedPromise(null, null, true)  =>  promise aborted
export function trackedPromise(received, data, error, aborted = false) {
  let promise = received as TrackedPromise;
  let isTrackedPromise =
    promise instanceof Promise && promise._tracked === true;

  if (data != null) {
    let dataMatches = promise._data === data;
    return {
      message: () => `expected ${received} to be a resolved deferred`,
      pass: isTrackedPromise && dataMatches,
    };
  }

  if (error != null) {
    let errorMatches =
      error instanceof Error
        ? promise._error.toString() === error.toString()
        : promise._error === error;
    return {
      message: () => `expected ${received} to be a rejected deferred`,
      pass: isTrackedPromise && errorMatches,
    };
  }

  if (aborted) {
    let errorMatches = promise._error instanceof AbortedDeferredError;
    return {
      message: () => `expected ${received} to be an aborted deferred`,
      pass: isTrackedPromise && errorMatches,
    };
  }

  return {
    message: () => `expected ${received} to be a pending deferred`,
    pass:
      isTrackedPromise &&
      promise._data === undefined &&
      promise._error === undefined,
  };
}
