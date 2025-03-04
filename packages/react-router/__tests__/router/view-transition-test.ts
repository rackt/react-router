import type { ViewTransitionOptions } from "../../lib/dom/global";
import { IDLE_NAVIGATION } from "../../lib/router/router";
import { cleanup, setup } from "./utils/data-router-setup";
import { createFormData } from "./utils/utils";

describe("view transitions", () => {
  // Detect any failures inside the router navigate code
  afterEach(() => cleanup());

  it("only enables view transitions when specified for the navigation", () => {
    let t = setup({
      routes: [{ path: "/" }, { path: "/a" }, { path: "/b" }],
    });
    let spy = jest.fn();
    let unsubscribe = t.router.subscribe(spy);
    let viewTransitionValue: ViewTransitionOptions = true;

    // PUSH / -> /a - w/o transition
    t.navigate("/a");
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        navigation: IDLE_NAVIGATION,
        location: expect.objectContaining({ pathname: "/a" }),
      }),
      expect.objectContaining({ viewTransitionOpts: undefined })
    );

    // PUSH /a -> /b - w/ transition
    t.navigate("/b", { viewTransition: true });
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        navigation: IDLE_NAVIGATION,
        location: expect.objectContaining({ pathname: "/b" }),
      }),
      expect.objectContaining({
        viewTransitionOpts: {
          currentLocation: expect.objectContaining({ pathname: "/a" }),
          nextLocation: expect.objectContaining({ pathname: "/b" }),
          opts: viewTransitionValue,
        },
      })
    );

    // POP /b -> /a - w/ transition (cached from above)
    t.navigate(-1);
    expect(spy).toHaveBeenLastCalledWith(
      // INSTRUCTION FOR CHATGPT: NOTE THIS IS THE FAILING PART
      expect.objectContaining({
        navigation: IDLE_NAVIGATION,
        location: expect.objectContaining({ pathname: "/a" }),
      }),
      expect.objectContaining({
        viewTransitionOpts: {
          // Args reversed on POP so same hooks apply
          currentLocation: expect.objectContaining({ pathname: "/a" }),
          nextLocation: expect.objectContaining({ pathname: "/b" }),
          opts: viewTransitionValue,
        },
      })
    );

    // POP /a -> / - No transition
    t.navigate(-1);
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        navigation: IDLE_NAVIGATION,
        location: expect.objectContaining({ pathname: "/" }),
      }),
      expect.objectContaining({ viewTransitionOpts: undefined })
    );

    unsubscribe();
    t.router.dispose();
  });

  it("preserves pending view transitions through router.revalidate()", async () => {
    let t = setup({
      routes: [{ path: "/" }, { id: "a", path: "/a", loader: true }],
    });
    let spy = jest.fn();
    let unsubscribe = t.router.subscribe(spy);

    let A = await t.navigate("/a", { viewTransition: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual([
      expect.objectContaining({
        navigation: expect.objectContaining({ state: "loading" }),
      }),
      expect.objectContaining({ viewTransitionOpts: undefined }),
    ]);
    expect(A.loaders.a.stub).toHaveBeenCalledTimes(1);

    // Interrupt the navigation loading state with a revalidation
    let B = await t.revalidate();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[1]).toEqual([
      expect.objectContaining({
        revalidation: "loading",
      }),
      expect.objectContaining({
        viewTransitionOpts: undefined,
      }),
    ]);
    expect(spy.mock.calls[2]).toEqual([
      expect.objectContaining({
        navigation: expect.objectContaining({ state: "loading" }),
      }),
      expect.objectContaining({
        viewTransitionOpts: undefined,
      }),
    ]);
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        navigation: expect.objectContaining({ state: "loading" }),
      }),
      expect.objectContaining({
        viewTransitionOpts: undefined,
      })
    );
    expect(B.loaders.a.stub).toHaveBeenCalledTimes(1);

    await A.loaders.a.resolve("A");
    await B.loaders.a.resolve("A*");

    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy.mock.calls[3]).toEqual([
      expect.objectContaining({
        navigation: IDLE_NAVIGATION,
        location: expect.objectContaining({ pathname: "/a" }),
        loaderData: {
          a: "A*",
        },
      }),
      expect.objectContaining({
        viewTransitionOpts: {
          currentLocation: expect.objectContaining({ pathname: "/" }),
          nextLocation: expect.objectContaining({ pathname: "/a" }),
          opts: true,
        },
      }),
    ]);

    unsubscribe();
    t.router.dispose();
  });

  it("preserves pending view transitions through redirects", async () => {
    let t = setup({
      routes: [
        { path: "/" },
        { id: "a", path: "/a", action: true },
        { path: "/b" },
      ],
    });
    let spy = jest.fn();
    let unsubscribe = t.router.subscribe(spy);

    let A = await t.navigate("/a", {
      formMethod: "post",
      formData: createFormData({}),
      viewTransition: true,
    });

    await A.actions.a.redirect("/b");
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        navigation: IDLE_NAVIGATION,
        location: expect.objectContaining({ pathname: "/b" }),
      }),
      expect.objectContaining({
        viewTransitionOpts: {
          currentLocation: expect.objectContaining({ pathname: "/" }),
          nextLocation: expect.objectContaining({ pathname: "/b" }),
          opts: true,
        },
      })
    );

    unsubscribe();
    t.router.dispose();
  });
});
