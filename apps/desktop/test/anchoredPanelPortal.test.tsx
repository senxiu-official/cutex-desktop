// @vitest-environment jsdom
// An outside press closes an AnchoredPanel, but a pick list portalled out of it (Popover / EntitySelect) is part of it:
// the same mousedown-before-click loss as the new-agent launch panel (303c48e3a), where every pick fell to the default.
import { act, createElement as h, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { AnchoredPanel } = await import("../src/renderer/src/components/AnchoredPanel");
const { Popover } = await import("../src/renderer/src/components/Menu");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

function Harness({ onClose, onPick }: { onClose(refocus: boolean): void; onPick(): void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  return h("div", null,
    h("button", { ref: anchor, "data-anchor": "" }, "open"),
    h(AnchoredPanel, {
      anchor, side: "below", label: "Panel", onClose, "data-test-panel": "",
      children: h(Popover, {
        trigger: "pick", triggerProps: { "data-pick-trigger": "" },
        children: (close: () => void) => h("button", { "data-option": "", onClick: () => { onPick(); close(); } }, "Option"),
      }),
    }));
}

const press = (el: Element) => { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); (el as HTMLElement).click(); };

it("a portalled pick list inside the panel keeps it open; a real outside press still closes it", () => {
  const onClose = vi.fn(), onPick = vi.fn();
  act(() => root.render(h(Harness, { onClose, onPick })));
  const panel = document.querySelector("[data-test-panel]")!;
  act(() => panel.querySelector<HTMLButtonElement>("[data-pick-trigger]")!.click());
  const option = document.querySelector<HTMLButtonElement>("[data-option]")!;
  expect(panel.contains(option)).toBe(false);
  act(() => press(option));
  expect(onPick).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
});
