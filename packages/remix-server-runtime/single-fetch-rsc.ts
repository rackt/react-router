import type {
  unstable_DataStrategyFunction as DataStrategyFunction,
  unstable_HandlerResult as HandlerResult,
} from "react-router";
import { redirect } from "react-router";

import type { CreateFromReadableStreamFunction } from "./build";
import type {
  getResponseStubs,
  SingleFetchResult,
  SingleFetchResults,
} from "./single-fetch";
import { SingleFetchRedirectSymbol } from "./single-fetch";

export type CallReactServer = (
  url: string,
  init: RequestInit
) => Promise<Response>;

export function getServerComponentsDataStrategy(
  responseStubs: ReturnType<typeof getResponseStubs>,
  createFromReadableStream: CreateFromReadableStreamFunction,
  callReactServer: CallReactServer,
  // TODO: This make me want to puke
  onBody: (body: ReadableStream<Uint8Array> | null) => void,
  onActionBody: (
    routeId: string,
    body: ReadableStream<Uint8Array> | null
  ) => void
): DataStrategyFunction {
  return async ({ request, matches }) => {
    let headers = new Headers(request.headers);
    headers.append("Remix-Route-IDs", matches.map((m) => m.route.id).join(","));

    let requestInit: RequestInit & { duplex?: "half" } = {
      headers,
      method: request.method,
      signal: request.signal,
    };

    let isActionRequest = request.method !== "GET" && request.method !== "HEAD";
    if (isActionRequest && request.body) {
      requestInit.body = request.body;
      requestInit.duplex = "half";
    }

    let bodyB: ReadableStream<Uint8Array> | null = null;
    const payloadPromise = callReactServer(request.url, requestInit).then(
      async (response) => {
        if (!response.body) {
          throw new Error("Response body is missing");
        }
        const [bodyA, _bodyB] = response.body.tee();
        if (!isActionRequest) {
          onBody(_bodyB);
        } else {
          bodyB = _bodyB;
        }
        const payload = (await createFromReadableStream(
          bodyA
        )) as SingleFetchResults;
        return [response.status, response.headers, payload] as const;
      }
    );

    return Promise.all(
      matches.map(async (m) =>
        m.resolve(async (): Promise<HandlerResult> => {
          const [status, headers, results] = await payloadPromise;
          // TODO: merge status and headers?
          responseStubs[m.route.id].status = status;

          if (isActionRequest) {
            onActionBody(m.route.id, bodyB);
            return { type: "data", result: results.data };
          }

          let result = unwrapSingleFetchResults(results, m.route.id);
          return { type: "data", result };
        })
      )
    );
  };
}

function unwrapSingleFetchResults(
  results: SingleFetchResults,
  routeId: string
) {
  let redirect = results[SingleFetchRedirectSymbol];
  if (redirect) {
    return unwrapSingleFetchResult(redirect, routeId);
  }

  return results[routeId] !== undefined
    ? unwrapSingleFetchResult(results[routeId], routeId)
    : null;
}

function unwrapSingleFetchResult(result: SingleFetchResult, routeId: string) {
  if ("error" in result) {
    throw result.error;
  } else if ("redirect" in result) {
    let headers: Record<string, string> = {};
    if (result.revalidate) {
      headers["X-Remix-Revalidate"] = "yes";
    }
    if (result.reload) {
      headers["X-Remix-Reload-Document"] = "yes";
    }
    return redirect(result.redirect, { status: result.status, headers });
  } else if ("data" in result) {
    return result.data;
  } else {
    throw new Error(`No response found for routeId "${routeId}"`);
  }
}
