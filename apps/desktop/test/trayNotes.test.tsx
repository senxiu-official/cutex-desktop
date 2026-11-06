// @vitest-environment jsdom
// Notes on the tray's entries (owner 2026-10-24, layout 甲 of .claude/previews/preview-tray-notes-badges.html v2): the
// first line written on the item, the whole note in its tooltip and 「… N」's list; a folding tray shortens the notes
// before anything folds; right-click 「备注…」 edits in place (Enter saves, Shift+Enter new line, Esc cancels). An agent's
// note is its cutex session note (fenced metadata update), an app's is `pins[i].note` in the home document (140 chars).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const i18n = vi.hoisted(() => ({ t: (key: string, v?: Record<string, unknown>) => (v?.name ? `${key}:${v.name}` : key), locale: "zh-CN" }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({ ...(await importOriginal<object>()), useI18n: () => i18n }));
const home = vi.hoisted(() => {
  const state = { doc: { pins: [] as unknown[] } as Record<string, unknown>, ok: true, listeners: new Set<() => void>() };
  return {
    state,
    source: () => ({
      hostId: "local",
      entry: { doc: state.doc },
      update: async (edit: (d: unknown) => unknown) => {
        if (!state.ok) return false;
        state.doc = edit(state.doc) as Record<string, unknown>;
        for (const l of state.listeners) l();
        return true;
      },
    }),
  };
});
vi.mock("../src/renderer/src/modules/home/hooks", async (importOriginal) => {
  const react = await import("react");
  return {
    ...(await importOriginal<object>()),
    useHomeSource: () => {
      const [, bump] = react.useState(0);
      react.useEffect(() => {
        const l = () => bump((n) => n + 1);
        home.state.listeners.add(l);
        return () => void home.state.listeners.delete(l);
      }, []);
      return home.source();
    },
  };
});
// The sidebar rows the tray reads names / notes from: agent "e" (with a note) and "x".
const rows = vi.hoisted(() => ({
  list: [] as { hostId: string; key: string; id: string; name: string; session: { cutexSessionId: string; displayName: string; note: string | null } }[],
}));
vi.mock("../src/renderer/src/lib/scopedSidebarView", () => ({
  useScopedSidebar: () => ({ model: { groups: [], chats: [] }, scope: { focus: "local" } }),
  useScopedAttention: () => ({ rows: rows.list, signals: new Map(), needs: new Map() }),
}));
const meta = vi.hoisted(() => ({ setAgentNote: vi.fn(async (..._a: unknown[]) => {}) }));
vi.mock("../src/renderer/src/lib/menus", () => ({ setAgentNote: (...a: unknown[]) => meta.setAgentNote(...a) }));
const menus = vi.hoisted(() => ({ last: [] as { label?: string; onSelect?: () => void }[] }));
vi.mock("../src/renderer/src/lib/trayMenu", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openTrayMenu: (_el: unknown, entries: never[]) => void (menus.last = entries),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { HomeDoc, HomePin } from "../src/shared/home";
import { pinId } from "../src/renderer/src/modules/home/model";
import { APP_NOTE_MAX, closeNoteEdit, noteLine, useNoteEdit, withPinNote } from "../src/renderer/src/modules/home/trayNotes";
import { fitDock, foldUnits } from "../src/renderer/src/lib/trayFold";
import { useApp } from "../src/renderer/src/store";
import { useShelfToast } from "../src/renderer/src/lib/shelves";

const { HomeDock } = await import("../src/renderer/src/modules/home/Dock");

const agent = (key: string, extra: Partial<HomePin> = {}): HomePin => ({ hostId: "local", kind: "agent", key, title: key.toUpperCase(), ...extra });
const svc = (note?: string): HomePin => ({ hostId: "local", kind: "url", key: "https://example.com/", title: "Board", ...(note ? { note } : {}) });
const row = (key: string, note: string | null) => ({ hostId: "local", key, id: key, name: key.toUpperCase(), session: { cutexSessionId: key, displayName: key.toUpperCase(), note } });

describe("notes (pure)", () => {
  it("the tray writes the first line only; blank is no note", () => {
    expect(noteLine("盯 r253 部署包\n别碰运行中的服务")).toBe("盯 r253 部署包");
    expect(noteLine("  \n  ")).toBeNull();
    expect(noteLine(null)).toBeNull();
    expect(noteLine(42)).toBeNull();
  });

  it("an app's note lives on its pin: set, cut to 140 chars, removed when cleared; unchanged = the same document", () => {
    const doc = { pins: [svc(), agent("e")] } as unknown as HomeDoc;
    const id = pinId(svc());
    const set = withPinNote(doc, id, "看板 · 只读");
    expect((set.pins![0] as HomePin).note).toBe("看板 · 只读");
    expect(set.pins![1]).toBe(doc.pins![1]);
    expect(((withPinNote(doc, id, "长".repeat(200)).pins![0] as HomePin).note as string).length).toBe(APP_NOTE_MAX);
    const cleared = withPinNote(set, id, "  ");
    expect("note" in (cleared.pins![0] as HomePin)).toBe(false);
    expect(withPinNote(set, id, "看板 · 只读")).toBe(set);
    expect(withPinNote(doc, "nope", "x")).toBe(doc);
  });
});

describe("fitDock with notes on the items", () => {
  /** Four items, two with a note label (60 px wide, 20 px when the dock is short), 40 px each otherwise. */
  function dock(width: number) {
    const el = document.createElement("div");
    el.innerHTML =
      `<span class="tray-group">` +
      [0, 1, 2, 3].map((i) => `<span class="tray-slot"><button data-tray-item="" ${i < 2 ? 'data-has-note=""' : ""}>${i < 2 ? '<span data-tray-label="">n</span>' : ""}</button></span>`).join("") +
      `</span><button data-tray-item="" data-tray-more="" hidden></button>`;
    const more = el.querySelector<HTMLElement>("[data-tray-more]")!;
    const box = { width };
    Object.defineProperty(el, "clientWidth", { get: () => box.width });
    Object.defineProperty(el, "scrollWidth", {
      get: () =>
        foldUnits(el)
          .filter((u) => !u.closest("[data-tray-folded]"))
          .reduce((w, u) => w + 40 + (u.querySelector("[data-tray-label]") ? (el.hasAttribute("data-tray-short") ? 20 : 60) : 0), 0) + (more.hidden ? 0 : 40),
    });
    return { el, more, box };
  }

  it("room for everything: the notes keep their full width", () => {
    const { el } = dock(400);
    expect(fitDock(el, null)).toBe(0);
    expect(el.hasAttribute("data-tray-short")).toBe(false);
  });

  it("a little short: the notes shorten first and nothing folds", () => {
    const { el, more } = dock(220); // full 280, short 200
    expect(fitDock(el, more)).toBe(0);
    expect(el.hasAttribute("data-tray-short")).toBe(true);
    expect(more.hidden).toBe(true);
  });

  it("still too narrow: then the trailing items fold into 「… N」; wider again, everything comes back", () => {
    const { el, more, box } = dock(150);
    // short: 60 + 60 + 40 + 40 = 200, with 「… N」 240; folding from the end: 200, 160, then 100 fits
    expect(fitDock(el, more)).toBe(3);
    expect(el.hasAttribute("data-tray-short")).toBe(true);
    box.width = 400;
    expect(fitDock(el, more)).toBe(0);
    expect(el.hasAttribute("data-tray-short")).toBe(false);
    expect(el.querySelectorAll("[data-tray-folded]")).toHaveLength(0);
  });
});

describe("HomeDock: notes on the items and 「备注…」", () => {
  let root: Root;
  let host: HTMLDivElement;
  const render = () => act(() => root.render(h(HomeDock, { placement: "desktop", onUsed: () => {} } as never)));
  beforeEach(() => {
    home.state.ok = true;
    meta.setAgentNote.mockReset();
    meta.setAgentNote.mockImplementation(async () => {});
    closeNoteEdit();
    rows.list = [row("e", "盯 r253 部署包\n别碰运行中的服务"), row("x", null)];
    home.state.doc = { pins: [agent("e"), agent("x"), svc("看板 · 只读\n周一更新")] };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    render();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    closeNoteEdit();
  });
  const itemOf = (name: string) => [...host.querySelectorAll<HTMLElement>("[data-tray-item]")].find((el) => el.getAttribute("aria-label")?.startsWith(name))!;
  const menuOf = (name: string) => {
    act(() => itemOf(name).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 })));
    return menus.last;
  };
  const editor = () => document.querySelector<HTMLElement>("[data-tray-note-editor]");
  const field = () => editor()!.querySelector("textarea")!;
  const type = (text: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      set.call(field(), text);
      field().dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const key = (k: string, extra: KeyboardEventInit = {}) => act(async () => void field().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra })));

  it("writes the first line on the item (agent and app), the whole note in the tooltip; an item without a note is unchanged", () => {
    const e = itemOf("E");
    expect(e.hasAttribute("data-has-note")).toBe(true);
    expect(e.querySelector("[data-tray-label]")!.textContent).toBe("盯 r253 部署包");
    expect(e.querySelector(".tray-note-full")!.textContent).toBe("盯 r253 部署包\n别碰运行中的服务");
    expect(e.dataset.tip).toContain("别碰运行中的服务");
    expect(itemOf("Board").querySelector("[data-tray-label]")!.textContent).toBe("看板 · 只读");
    const x = itemOf("X");
    expect(x.hasAttribute("data-has-note")).toBe(false);
    expect(x.querySelector("[data-tray-label]")).toBeNull();
  });

  it("「备注…」 on an agent: an editor beside it (280 chars, 「托盘只显示第一行」); Enter saves the cutex session note", async () => {
    act(() => menuOf("E").find((m) => m.label === "tray.note.menu")!.onSelect!());
    expect(editor()).not.toBeNull();
    expect(field().value).toBe("盯 r253 部署包\n别碰运行中的服务");
    expect(field().maxLength).toBe(280);
    expect(editor()!.textContent).toContain("tray.note.firstLine");
    type("盯 r254");
    await key("Enter");
    expect(meta.setAgentNote).toHaveBeenCalledTimes(1);
    const [session, hostId, note] = meta.setAgentNote.mock.calls[0]!;
    expect((session as { cutexSessionId: string }).cutexSessionId).toBe("e");
    expect(hostId).toBe("local");
    expect(note).toBe("盯 r254");
    expect(editor()).toBeNull();
    expect(home.state.doc.pins).toEqual([agent("e"), agent("x"), svc("看板 · 只读\n周一更新")]); // the home document is not touched
  });

  it("Shift+Enter is a new line, Esc cancels without saving", async () => {
    act(() => menuOf("X").find((m) => m.label === "tray.note.menu")!.onSelect!());
    type("第一行");
    await key("Enter", { shiftKey: true });
    expect(editor()).not.toBeNull();
    await key("Escape");
    expect(editor()).toBeNull();
    expect(meta.setAgentNote).not.toHaveBeenCalled();
  });

  it("an agent's note closes the editor at once (drawn before cutex answers, lib/menus); a failure is said", async () => {
    meta.setAgentNote.mockRejectedValueOnce(new Error("revision conflict"));
    act(() => menuOf("E").find((m) => m.label === "tray.note.menu")!.onSelect!());
    type("新的");
    await key("Enter");
    expect(editor()).toBeNull();
    // The app's toast (no conversation here, where store notify would show).
    expect(useShelfToast.getState().toast?.text).toContain("revision conflict");
  });

  it("「备注…」 on an app saves pins[i].note in the home document (140 chars), never the cutex session; 清除 removes it", async () => {
    act(() => menuOf("Board").find((m) => m.label === "tray.note.menu")!.onSelect!());
    expect(field().maxLength).toBe(140);
    type("只读看板");
    await key("Enter");
    expect(((home.state.doc.pins as HomePin[])[2]!).note).toBe("只读看板");
    expect(meta.setAgentNote).not.toHaveBeenCalled();
    expect(itemOf("Board").querySelector("[data-tray-label]")!.textContent).toBe("只读看板");
    act(() => menuOf("Board").find((m) => m.label === "tray.note.menu")!.onSelect!());
    await act(async () => editor()!.querySelector<HTMLButtonElement>("[data-note-clear]")!.click());
    expect("note" in (home.state.doc.pins as HomePin[])[2]!).toBe(false);
    expect(itemOf("Board").hasAttribute("data-has-note")).toBe(false);
  });

  it("a capsule of several agents has no note of its own and no 「备注…」", () => {
    home.state.doc = { pins: [agent("e", { title: "E + X", members: [{ hostId: "local", key: "e" }, { hostId: "local", key: "x" }] })] };
    render();
    const capsule = host.querySelector<HTMLElement>("[data-tray-item][data-capsule]")!;
    expect(capsule.hasAttribute("data-has-note")).toBe(false);
    act(() => capsule.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 })));
    expect(menus.last.some((m) => m.label === "tray.note.menu")).toBe(false);
  });

  it("only one editor is drawn while two docks are mounted (the tray and 「… N」's list)", () => {
    const other = document.createElement("div");
    document.body.appendChild(other);
    const second = createRoot(other);
    act(() => second.render(h(HomeDock, { placement: "overlay", onUsed: () => {} } as never)));
    act(() => menuOf("E").find((m) => m.label === "tray.note.menu")!.onSelect!());
    expect(document.querySelectorAll("[data-tray-note-editor]")).toHaveLength(1);
    expect(useNoteEdit.getState().edit?.name).toBe("E");
    act(() => second.unmount());
    other.remove();
  });
});
