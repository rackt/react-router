import type * as express from "express";
import type { ReactServerBuild } from "@react-router/node";
import { createReactServerRequestHandler as createRemixReactServerRequestHandler } from "@react-router/node";

import { createRemixRequest, sendRemixResponse } from "./server";
import type { GetLoadContextFunction } from "./server";

export type RSCRequestHandler = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<void>;

export function createReactServerRequestHandler({
  build,
  getLoadContext,
  mode,
}: {
  build: ReactServerBuild | (() => Promise<ReactServerBuild>);
  getLoadContext?: GetLoadContextFunction;
  mode?: string;
}): RSCRequestHandler {
  let handler = createRemixReactServerRequestHandler(build, mode);
  return async (req, res, next) => {
    try {
      let loadContext = getLoadContext
        ? await getLoadContext(req, res)
        : undefined;
      let request = createRemixRequest(req, res);
      let response = await handler(request, loadContext);
      await sendRemixResponse(res, response);
    } catch (error) {
      next(error);
    }
  };
}
