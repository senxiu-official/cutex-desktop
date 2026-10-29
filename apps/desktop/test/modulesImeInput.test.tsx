// @vitest-environment jsdom
import { act, createElement as h, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  state: { selectedId: null, hosts: { active: "host" } },
  drafts: { note: { title: "中文笔记", body: "正文", clientNonce: "nonce", scope: { kind: "host" }, pins: [], anchor: null } },
  createNote: vi.fn(async () => ({})), updateNote: vi.fn(async () => ({})), clearDraft: vi.fn(),
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "zh-CN" }) }));
vi.mock("../src/renderer/src/lib/openOverlays", () => ({ useTrackOverlay: () => {} }));
vi.mock("../src/renderer/src/lib/trayPrefs", () => ({ useTrayPrefs: (selector: (value: { edge: string }) => unknown) => selector({ edge: "bottom" }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (selector: (value: unknown) => unknown) => selector(env.state), sidebarOf: () => undefined }));
vi.mock("../src/renderer/src/modules/notes/store", () => ({
  notesCache: { create: env.createNote, update: env.updateNote },
  patchNoteDraft: vi.fn(), setNoteDraft: env.clearDraft, useHostSidebar: () => undefined,
  useNoteDrafts: Object.assign((selector: (value: unknown) => unknown) => selector({ drafts: env.drafts }), { getState: () => ({ drafts: env.drafts }) }),
}));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  TextInput: ({ label, onChange, width: _width, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & { label: string; width?: string; onChange(value: string): void }) =>
    h("input", { ...props, "aria-label": label, onChange: event => onChange(event.currentTarget.value) }),
  Button: ({ primary: _primary, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) => h("button", props),
  Toggle: () => null, Select: () => null,
}));

import { installImeGuards } from "../src/renderer/src/lib/ime";
import { BrowserAgentPicker } from "../src/renderer/src/modules/browser/BrowserAgentPicker";
import { NoteEditor } from "../src/renderer/src/modules/notes/NoteEditor";
import { paletteKey } from "../src/renderer/src/modules/quick-switch/model";
import { TrayNoteEditor } from "../src/renderer/src/modules/home/TrayNoteEditor";
import { useNoteEdit } from "../src/renderer/src/modules/home/trayNotes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root, uninstall: () => void;
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  vi.clearAllMocks();
  useNoteEdit.setState({ edit: null, host: null });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  uninstall = installImeGuards(document);
});
afterEach(async () => {
  for (const input of document.querySelectorAll("input,textarea")) input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await act(async () => root.unmount()); uninstall(); container.remove();
  if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoView);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});
type Mode = "native" | "keyCode229" | "which229" | "tracked";
function keyboard(target: Element, key: string, mode?: Mode, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...modifiers, isComposing: mode === "native", keyCode: mode === "keyCode229" ? 229 : 0 });
  if (mode === "which229") Object.defineProperty(event, "which", { value: 229 });
  target.dispatchEvent(event); return event;
}
function start(target: Element, mode: Mode) {
  if (mode === "tracked") target.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
}
function end(target: Element) { target.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); }

describe.each<Mode>(["native", "keyCode229", "which229", "tracked"])("module input composition (%s)", mode => {
  it("keeps browser picker candidates from moving, selecting or cancelling", async () => {
    const selected = vi.fn();
    await act(async () => root.render(h(BrowserAgentPicker, {
      hostId: "host", agents: [{ sessionId: "cutex.alpha", name: "Alpha" }, { sessionId: "cutex.beta", name: "Beta" }],
      selected: "", onSelect: selected, onOpen: vi.fn(), disabled: false, loading: false, placeholder: "Pick",
    })));
    await act(async () => container.querySelector<HTMLButtonElement>("[data-browser-agent-select]")!.click());
    const input = container.querySelector<HTMLInputElement>("[role=combobox]")!; input.focus(); start(input, mode);
    const initial = input.getAttribute("aria-activedescendant");
    await act(async () => { keyboard(input, "ArrowDown", mode); keyboard(input, "Enter", mode); keyboard(input, "Escape", mode); });
    expect(selected).not.toHaveBeenCalled();
    expect(container.querySelector("[role=combobox]")).toBe(input);
    expect(input.getAttribute("aria-activedescendant")).toBe(initial);
    end(input);
    await act(async () => keyboard(input, "ArrowDown"));
    await act(async () => keyboard(input, "Enter"));
    expect(selected).toHaveBeenCalledExactlyOnceWith("cutex.beta");
    expect(container.querySelector("[role=combobox]")).toBeNull();
  });
  it("does not save or dismiss a note while confirming an IME candidate", async () => {
    const dismiss = vi.fn();
    await act(async () => root.render(h(NoteEditor, { hostId: "host", draftKey: "note", onDismiss: dismiss })));
    const input = container.querySelector("textarea")!; input.focus(); start(input, mode);
    await act(async () => { keyboard(input, "Enter", mode, { ctrlKey: true }); keyboard(input, "Escape", mode); });
    expect(env.createNote).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled();
    expect(input.value).toBe("正文");
    end(input);
    await act(async () => keyboard(input, "Enter", undefined, { ctrlKey: true }));
    expect(env.createNote).toHaveBeenCalledOnce();
    expect(env.createNote).toHaveBeenCalledWith("host", expect.objectContaining({ title: "中文笔记", body: "正文" }));
    await act(async () => keyboard(input, "Escape"));
    expect(dismiss).toHaveBeenCalledOnce();
  });
});

describe("quick switch composition fallback", () => {
  it.each(["Enter", "Escape", "ArrowDown", "Tab"])("leaves %s to the IME for 229 events", key => {
    const base = { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false };
    expect(paletteKey({ ...base, keyCode: 229 }, false)).toBeNull();
    expect(paletteKey({ ...base, which: 229 }, false)).toBeNull();
    expect(paletteKey(base, false)).not.toBeNull();
  });
});

it("preserves a complete over-limit tray note rather than sending a clipped value", async () => {
  const save = vi.fn(async (_note: string | null) => false);
  useNoteEdit.setState({ edit: { name: "Example", initial: "", max: 4, anchor: { left: 0, top: 0, right: 30, bottom: 20 }, save } });
  await act(async () => root.render(h(TrayNoteEditor)));
  const input = document.querySelector<HTMLTextAreaElement>("[data-tray-note-editor] textarea")!;
  const change = async (text: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await change("zhongwen");
  expect(input.value).toBe("zhongwen");
  await act(async () => keyboard(input, "Enter", "keyCode229"));
  expect(save).not.toHaveBeenCalled();
  await change("中文文字！"); end(input);
  await act(async () => keyboard(input, "Enter"));
  expect(save).not.toHaveBeenCalled();
  expect(input.value).toBe("中文文字！");
  expect(document.querySelector<HTMLButtonElement>("[data-note-save]")!.disabled).toBe(true);
  await change("中文");
  await act(async () => keyboard(input, "Enter"));
  expect(save).toHaveBeenCalledExactlyOnceWith("中文");
});
