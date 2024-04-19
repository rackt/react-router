// @ts-expect-error - no types
import ReactServerDOM from "react-server-dom-diy/server";

export function renderToReadableStream(data: unknown) {
  return ReactServerDOM.renderToReadableStream(data);
}
