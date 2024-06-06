import * as stream from "node:stream";

import { createReadableStreamFromReadable } from "@react-router/node";
// @ts-expect-error - no types
import ReactServerDOM from "react-server-dom-diy/server";

export function renderToReadableStream(data: unknown) {
  const passthrough = new stream.PassThrough();
  const { pipe } = ReactServerDOM.renderToPipeableStream(
    data,
    global.__diy_server_manifest__
  );
  pipe(passthrough);
  return createReadableStreamFromReadable(passthrough);
}

export const decodeAction = ReactServerDOM.decodeAction;
export const decodeFormState = ReactServerDOM.decodeFormState;
export const decodeReply = ReactServerDOM.decodeReply;
