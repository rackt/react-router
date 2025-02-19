// https://reactjs.org/blog/2022/03/08/react-18-upgrade-guide.html#configuring-your-testing-environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.TextEncoder || !globalThis.TextDecoder) {
  const { TextDecoder, TextEncoder } = require("node:util");
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

if (!globalThis.ReadableStream || !globalThis.WritableStream) {
  const { ReadableStream, WritableStream } = require("node:stream/web");
  globalThis.ReadableStream = ReadableStream;
  globalThis.WritableStream = WritableStream;
}

if (!globalThis.fetch) {
  const { fetch, FormData, Request, Response, Headers } = require("undici");

  globalThis.fetch = fetch;
  globalThis.Request = Request;
  globalThis.Response = Response;
  globalThis.Headers = Headers;

  globalThis.FormData = globalThis.FormData || FormData;
}

if (!globalThis.TextEncoderStream) {
  const { TextEncoderStream } = require("node:stream/web");
  globalThis.TextEncoderStream = TextEncoderStream;
}
if (!globalThis.TextDecoderStream) {
  const { TextDecoderStream } = require("node:stream/web");
  globalThis.TextDecoderStream = TextDecoderStream;
}

if (!globalThis.TransformStream) {
  const { TransformStream } = require("node:stream/web");
  globalThis.TransformStream = TransformStream;
}
