import type { MetaFunction } from "@react-router/node";
import { useLoaderData } from "react-router";

export const meta: MetaFunction = () => {
  return [
    { title: "New Remix App" },
    { name: "description", content: "Welcome to Remix!" },
  ];
};

export function loader({ request }) {
  return <strong>{request.url}</strong>;
}

export default function Index() {
  console.log({
    data: useLoaderData(),
  });
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
      <h1>Home</h1>
      <p>{useLoaderData()}</p>
    </div>
  );
}
