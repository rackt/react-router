import type { MetaFunction } from "@react-router/node";
import {
  ActionFunctionArgs,
  Form,
  LoaderFunctionArgs,
  useActionData,
  useLoaderData,
} from "react-router-dom";

export const meta: MetaFunction = () => {
  return [
    { title: "New Remix App" },
    { name: "description", content: "Welcome to Remix!" },
  ];
};

export function loader({ request }: LoaderFunctionArgs) {
  return <em>{request.url}</em>;
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  switch (formData.get("format")) {
    case "strong":
      return <strong>{request.url}</strong>;
    case "em":
      return <em>{request.url}</em>;
    default:
      throw new Error("Invalid action");
  }
}

export default function About() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
      <h1>About</h1>
      <p>{useLoaderData()}</p>
      <Form method="POST">
        <button type="submit" name="format" value="strong">
          Strong
        </button>
        <button type="submit" name="format" value="em">
          Emphisized
        </button>
        <p>{useActionData()}</p>
      </Form>
    </div>
  );
}
