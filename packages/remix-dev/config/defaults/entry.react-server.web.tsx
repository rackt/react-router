// @ts-expect-error - no types
import ReactServerDOM from "react-server-dom-diy/server";

export function renderToReadableStream(data: unknown) {
  return ReactServerDOM.renderToReadableStream(
    data,
    global.__diy_server_manifest__
  );
}

export const decodeAction = ReactServerDOM.decodeAction;
export const decodeFormState = ReactServerDOM.decodeFormState;
export const decodeReply = ReactServerDOM.decodeReply;
