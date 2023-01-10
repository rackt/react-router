import React from "react";
import { Blocker, useNavigate } from "react-router-dom";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Form,
  json,
  Link,
  Outlet,
  Route,
  RouterProvider,
  useBlocker,
  useLocation,
} from "react-router-dom";

let router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<Layout />}>
      <Route index element={<h2>Index</h2>} />
      <Route path="one" element={<h2>One</h2>} />
      <Route path="two" element={<h2>Two</h2>} />
      <Route
        path="three"
        action={() => json({ ok: true })}
        element={
          <>
            <h2>Three</h2>
            <ImportantForm />
          </>
        }
      />
      <Route path="four" element={<h2>Four</h2>} />
      <Route path="five" element={<h2>Five</h2>} />
    </Route>
  )
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => router.dispose());
}

export default function App() {
  return <RouterProvider router={router} />;
}

function Layout() {
  let [historyIndex, setHistoryIndex] = React.useState(
    window.history.state?.idx
  );
  let location = useLocation();
  let navigate = useNavigate();

  // Expose the underlying history index in the UI for debugging
  React.useEffect(() => {
    setHistoryIndex(window.history.state?.idx);
  }, [location]);

  // Give us meaningful document titles for popping back/forward more than 1 entry
  React.useEffect(() => {
    document.title = location.pathname;
  }, [location]);

  return (
    <>
      <h1>Navigation Blocking Example</h1>
      <nav>
        <Link to="/">Index</Link>&nbsp;&nbsp;
        <Link to="/one">One</Link>&nbsp;&nbsp;
        <Link to="/two">Two</Link>&nbsp;&nbsp;
        <Link to="/three">Three (Form)</Link>&nbsp;&nbsp;
        <Link to="/four">Four</Link>&nbsp;&nbsp;
        <Link to="/five">Five</Link>&nbsp;&nbsp;
        <a href="https://remix.run">External link to Remix Docs</a>&nbsp;&nbsp;
        <button onClick={() => navigate(-1)}>Back</button>&nbsp;&nbsp;
      </nav>
      <p>
        Current location (index): {location.pathname} ({historyIndex})
      </p>
      <Outlet />
    </>
  );
}

function ImportantForm() {
  let [value, setValue] = React.useState("");
  let isBlocked = value !== "";
  let blocker = useBlocker(isBlocked);
  router.getBlocker("a", () => false);
  router.getBlocker("b", () => false);

  // Reset the blocker if the user cleans the form
  React.useEffect(() => {
    if (blocker.state === "blocked" && !isBlocked) {
      blocker.reset();
    }
  }, [blocker, isBlocked]);

  // Display our confirmation UI
  const blockerUI: Record<Blocker["state"], React.ReactElement> = {
    unblocked: <p style={{ color: "green" }}>Blocker is currently unblocked</p>,
    blocked: (
      <>
        <p style={{ color: "red" }}>Blocked the last navigation</p>
        <button onClick={() => blocker.proceed?.()}>Let me through</button>
        <button onClick={() => blocker.reset?.()}>Keep me here</button>
      </>
    ),
    proceeding: (
      <p style={{ color: "orange" }}>Proceeding through blocked navigation</p>
    ),
  };

  return (
    <>
      <p>
        Is the form dirty?{" "}
        {isBlocked ? (
          <span style={{ color: "red" }}>Yes</span>
        ) : (
          <span style={{ color: "green" }}>No</span>
        )}
      </p>

      <Form method="post">
        <label>
          Enter some important data:
          <input
            name="data"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <button type="submit">Save</button>
      </Form>

      {blockerUI[blocker.state]}
    </>
  );
}
