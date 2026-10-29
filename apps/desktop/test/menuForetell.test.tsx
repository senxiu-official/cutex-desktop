// @vitest-environment jsdom
// 动作预告 on menu rows (docs/design/008; lib/contextMenu MenuAction.foretell, components/Overlays): the active row
// (hovered or reached with the arrows) shows its foretell after the delay; leaving it / closing the menu hides it.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeMenu, openMenuAt } from "../src/renderer/src/lib/contextMenu";
import { FORETELL_DELAY_MS, useForetellStore, type Foretell } from "../src/renderer/src/lib/foretell";
import { Overlays } from "../src/renderer/src/components/Overlays";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(h(Overlays)));
});
afterEach(() => {
  act(() => closeMenu());
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const fold: Foretell = { tone: "fold", text: "收成窄条", marks: [{ selector: "body" }] };

describe("menu rows foretell", () => {
  it("hovering a row with a foretell shows it after the delay; another row / closing hides it", () => {
    act(() => openMenuAt(10, 10, [{ label: "独占", foretell: () => fold, onSelect: () => {} }, { label: "复制", onSelect: () => {} }]));
    const rows = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")];
    expect(rows.length).toBe(2);
    act(() => rows[0]!.parentElement!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(FORETELL_DELAY_MS - 10));
    expect(useForetellStore.getState().shown).toBeNull();
    act(() => vi.advanceTimersByTime(20));
    expect(useForetellStore.getState().shown).toEqual(fold);
    act(() => rows[1]!.parentElement!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(useForetellStore.getState().shown).toBeNull();
    act(() => rows[0]!.parentElement!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(FORETELL_DELAY_MS + 10));
    expect(useForetellStore.getState().shown).toEqual(fold);
    act(() => closeMenu());
    expect(useForetellStore.getState().shown).toBeNull();
  });
});
