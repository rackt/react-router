import * as React from "react";
import { MemoryRouter, Routes, Route } from "react-router";

import { fireEvent, render, screen } from "@testing-library/react";

describe("when a Routes location prop changes from null to a location", () => {
  it("does not re-mount the tree", () => {
    function StatefulPage({ label }: { label: string }) {
      let [count, setCount] = React.useState(0);
      return (
        <div>
          <h1>
            {label} {count}
          </h1>
          <button onClick={() => setCount(count + 1)}>Increment {label}</button>
        </div>
      );
    }

    function TestCase() {
      let [location, setLocation] = React.useState<string | null>(null);
      return (
        <MemoryRouter initialEntries={["/stateful"]}>
          <Routes location={location || undefined}>
            <Route path="home" element={<div>Home</div>} />
            <Route path="stateful" element={<StatefulPage label="counter" />} />
          </Routes>
          <button onClick={() => setLocation("/stateful")}>
            Switch to location prop
          </button>
        </MemoryRouter>
      );
    }

    // Initial render
    let { container } = render(<TestCase />);
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<div><h1>counter 0</h1><button>Increment counter</button></div><button>Switch to location prop</button>"`
    );

    // Increment counter
    fireEvent.click(screen.getByText("Increment counter"));
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<div><h1>counter 1</h1><button>Increment counter</button></div><button>Switch to location prop</button>"`
    );

    // Switch to provide the location via the location prop
    fireEvent.click(screen.getByText("Switch to location prop"));

    // The counter state should be preserved
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<div><h1>counter 1</h1><button>Increment counter</button></div><button>Switch to location prop</button>"`
    );
  });
});
