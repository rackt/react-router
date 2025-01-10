import { useLoaderData } from "react-router";

export const clientLoader = async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return "Hello from chunkable client loader";
};

// Uncomment the following line to see an error message since HydrateFallback is
// not a valid export outside of the root route in SPA mode:
// export function HydrateFallback() {}

export default function Hello() {
  const message = useLoaderData() as Awaited<ReturnType<typeof clientLoader>>;
  return <div>{message}</div>;
}
