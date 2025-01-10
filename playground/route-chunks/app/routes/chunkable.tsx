import { useLoaderData } from "react-router";

export const clientLoader = async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return "Hello from chunkable client loader";
};

export function HydrateFallback() {
  return <div>Loading...</div>;
}

export default function Hello() {
  const message = useLoaderData() as Awaited<ReturnType<typeof clientLoader>>;
  return <div>{message}</div>;
}
