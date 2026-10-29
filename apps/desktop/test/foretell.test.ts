// @vitest-environment jsdom
// 动作预告 foretell (docs/design/008-foretell.md; lib/foretell): the pure parts (sameForetell, markText,
// markTone, withHandlers) and useForetell's timing — shown only after the pointer rests FORETELL_DELAY_MS,
// gone on leave / press / blur, Ctrl/⌘ switches it to the beside one, another control's hide leaves it.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearForetell, FORETELL_DELAY_MS, foretellAfterDelay, markText, markTone, sameForetell, setForetell, useForetell, useForetellStore, withHandlers, type Foretell, type ForetellHandlers, type ForetellMods } from "../src/renderer/src/lib/foretell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const f = (text: string, extra: Partial<Foretell> = {}): Foretell => ({ tone: "replace", text, marks: [{ selector: "[data-x]" }], ...extra });
const shown = () => useForetellStore.getState().shown;

describe("pure parts", () => {
  it("sameForetell: same tone, text and marks (selector, text, tone, box)", () => {
    expect(sameForetell(null, null)).toBe(true);
    expect(sameForetell(f("a"), null)).toBe(false);
    expect(sameForetell(f("a"), f("a"))).toBe(true);
    expect(sameForetell(f("a"), f("b"))).toBe(false);
    expect(sameForetell(f("a"), f("a", { tone: "beside" }))).toBe(false);
    expect(sameForetell(f("a"), f("a", { marks: [{ selector: "[data-y]" }] }))).toBe(false);
    expect(sameForetell(f("a"), f("a", { marks: [{ selector: "[data-x]" }, { selector: "[data-y]" }] }))).toBe(false);
    const box = { left: 1, top: 2, width: 3, height: 4 };
    expect(sameForetell(f("a", { marks: [{ box }] }), f("a", { marks: [{ box: { ...box } }] }))).toBe(true);
    expect(sameForetell(f("a", { marks: [{ box }] }), f("a", { marks: [{ box: { ...box, width: 9 } }] }))).toBe(false);
    expect(sameForetell(f("a", { marks: [{ selector: "s", text: "x" }] }), f("a", { marks: [{ selector: "s", text: "y" }] }))).toBe(false);
  });

  it("markText: a mark's own sentence, else the foretell's on the first mark only", () => {
    const x = f("main", { marks: [{ selector: "a" }, { selector: "b" }, { selector: "c", text: "own" }, { selector: "d", text: "" }] });
    expect(markText(x, 0)).toBe("main");
    expect(markText(x, 1)).toBeNull();
    expect(markText(x, 2)).toBe("own");
    expect(markText(x, 3)).toBe("");
    expect(markText(x, 9)).toBeNull();
    expect(markText(f("m", { marks: [{ selector: "a", text: "first" }] }), 0)).toBe("first");
  });

  it("markTone: a mark's own tone, else the foretell's", () => {
    const x = f("t", { tone: "fold", marks: [{ selector: "a" }, { selector: "b", tone: "beside" }] });
    expect(markTone(x, x.marks[0]!)).toBe("fold");
    expect(markTone(x, x.marks[1]!)).toBe("beside");
  });

  it("setForetell / clearForetell: an owner's hide does not remove another owner's preview", () => {
    const a = {};
    const b = {};
    setForetell(a, f("a"));
    setForetell(b, null);
    expect(shown()?.text).toBe("a");
    setForetell(b, f("b"));
    setForetell(a, null);
    expect(shown()?.text).toBe("b");
    clearForetell();
    expect(shown()).toBeNull();
  });

  it("withHandlers: the control's own handler first, then the foretell's; other props kept", () => {
    const calls: string[] = [];
    const fh = { onPointerEnter: () => calls.push("f-enter"), onPointerLeave: () => calls.push("f-leave"), onPointerDown: () => calls.push("f-down"), onFocus: () => calls.push("f-focus"), onBlur: () => calls.push("f-blur") } as unknown as ForetellHandlers;
    const merged = withHandlers({ onPointerDown: () => void calls.push("own-down"), onClick: () => void calls.push("own-click") }, fh);
    merged.onPointerDown();
    merged.onClick();
    merged.onBlur();
    expect(calls).toEqual(["own-down", "f-down", "own-click", "f-blur"]);
  });
});

describe("timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearForetell();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearForetell();
  });

  it("foretellAfterDelay: shows after the delay, the cancel stops a pending one, null hides at once", () => {
    const owner = {};
    const cancel = foretellAfterDelay(owner, f("x"));
    vi.advanceTimersByTime(FORETELL_DELAY_MS - 1);
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown()?.text).toBe("x");
    cancel();
    const cancel2 = foretellAfterDelay(owner, f("y"));
    cancel2();
    vi.advanceTimersByTime(FORETELL_DELAY_MS * 2);
    expect(shown()?.text).toBe("x");
    foretellAfterDelay(owner, null);
    expect(shown()).toBeNull();
  });

  describe("useForetell", () => {
    let root: Root | null = null;
    let el: HTMLElement | null = null;
    let handlers: ForetellHandlers | null = null;
    const seen: ForetellMods[] = [];
    function Probe({ disabled }: { disabled?: boolean }) {
      handlers = useForetell((m) => {
        seen.push(m);
        return f(m.beside ? "beside" : "replace", { tone: m.beside ? "beside" : "replace" });
      }, { disabled });
      return null;
    }
    const render = (disabled = false) => act(() => root!.render(h(Probe, { disabled })));
    const enter = (init: { ctrlKey?: boolean } = {}) => act(() => handlers!.onPointerEnter({ ctrlKey: !!init.ctrlKey, metaKey: false } as never));
    const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
    const key = (type: "keydown" | "keyup", k: string, ctrlKey: boolean) => act(() => void window.dispatchEvent(new KeyboardEvent(type, { key: k, ctrlKey })));

    beforeEach(() => {
      seen.length = 0;
      el = document.createElement("div");
      document.body.appendChild(el);
      root = createRoot(el);
      render();
    });
    afterEach(() => {
      act(() => root?.unmount());
      el?.remove();
      root = null;
    });

    it("a pointer crossing shows nothing; resting shows it; leaving hides it", () => {
      enter();
      tick(FORETELL_DELAY_MS - 10);
      act(() => handlers!.onPointerLeave());
      tick(FORETELL_DELAY_MS);
      expect(shown()).toBeNull();
      expect(seen).toEqual([]);
      enter();
      tick(FORETELL_DELAY_MS);
      expect(shown()?.text).toBe("replace");
      act(() => handlers!.onPointerLeave());
      expect(shown()).toBeNull();
    });

    it("pressing the control hides it (the click acts); Ctrl held on enter = the beside one", () => {
      enter({ ctrlKey: true });
      tick(FORETELL_DELAY_MS);
      expect(shown()).toMatchObject({ tone: "beside", text: "beside" });
      act(() => handlers!.onPointerDown());
      expect(shown()).toBeNull();
    });

    it("Ctrl pressed / released while shown recomputes it", () => {
      enter();
      tick(FORETELL_DELAY_MS);
      key("keydown", "Control", true);
      expect(shown()?.text).toBe("beside");
      key("keyup", "Control", false);
      expect(shown()?.text).toBe("replace");
      // Other keys change nothing.
      key("keydown", "a", false);
      expect(shown()?.text).toBe("replace");
    });

    it("disabled: nothing shows, and turning disabled hides it; unmount hides it", () => {
      enter();
      tick(FORETELL_DELAY_MS);
      expect(shown()).not.toBeNull();
      render(true);
      expect(shown()).toBeNull();
      enter();
      tick(FORETELL_DELAY_MS);
      expect(shown()).toBeNull();
      render(false);
      enter();
      tick(FORETELL_DELAY_MS);
      expect(shown()).not.toBeNull();
      act(() => root!.unmount());
      root = null;
      expect(shown()).toBeNull();
    });

    it("focus: only keyboard focus (:focus-visible) previews", () => {
      const btn = document.createElement("button");
      document.body.appendChild(btn);
      const matches = vi.spyOn(btn, "matches").mockReturnValue(false);
      act(() => handlers!.onFocus({ currentTarget: btn } as never));
      tick(FORETELL_DELAY_MS);
      expect(shown()).toBeNull();
      matches.mockReturnValue(true);
      act(() => handlers!.onFocus({ currentTarget: btn } as never));
      tick(FORETELL_DELAY_MS);
      expect(shown()?.text).toBe("replace");
      act(() => handlers!.onBlur());
      expect(shown()).toBeNull();
      btn.remove();
    });
  });
});
