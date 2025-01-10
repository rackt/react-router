import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("chunkable", "routes/chunkable.tsx"),
  route("unchunkable", "routes/unchunkable.tsx"),
] satisfies RouteConfig;
