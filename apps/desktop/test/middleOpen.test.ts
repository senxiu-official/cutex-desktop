// Window audit 2026-10-23 #4: middle-click is the alternate open (Ctrl/⌘-click's) on sidebar nav entries.
import { expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const { middleOpen } = await import("../src/renderer/src/components/SidebarNav");
const { openModifiers } = await import("../src/renderer/src/lib/openModifiers");

const ev = (button: number) => ({ button, preventDefault: vi.fn() }) as never as React.MouseEvent & { preventDefault: ReturnType<typeof vi.fn> };

it("a middle click runs the alternate open; other buttons do nothing; the mouse-down is swallowed (no autoscroll)", () => {
  const run = vi.fn();
  const h = middleOpen(run);
  const middle = ev(1);
  h.onAuxClick(middle);
  expect(run).toHaveBeenCalledTimes(1);
  expect(middle.preventDefault).toHaveBeenCalled();
  h.onAuxClick(ev(2));
  expect(run).toHaveBeenCalledTimes(1);
  const down = ev(1);
  h.onMouseDown(down);
  expect(down.preventDefault).toHaveBeenCalled();
  const left = ev(0);
  h.onMouseDown(left);
  expect(left.preventDefault).not.toHaveBeenCalled();
  // What the entries pass on: a middle click reads as Ctrl/⌘-click (a new, kept instance / beside).
  expect(openModifiers({ ctrlKey: false, metaKey: false, shiftKey: false, button: 1 }, false).newInstance).toBe(true);
});
