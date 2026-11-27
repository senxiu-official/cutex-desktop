// @vitest-environment jsdom
// Shortcut schemes (lib/keybindingSchemes + Store; owner 2026-11-26): the built-in 默认 is read-only, a scheme stores
// only overrides (a command it does not mention keeps its default), bindings are platform-neutral with per-platform
// lists, conflicts are checked per platform, the old this-desktop overrides migrate into 「我的快捷键」 with no change
// in behaviour, the 同步 category's fields (per scheme, deletions, the shared active scheme), export / import, and
// Settings → 键盘快捷键's scheme picker.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "zh-CN" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { bindingConflicts, bindingsOf, matchesCommand, resetKeybindingsForTests, setBindings, setKeybindingPlatform, type KeyLike } from "../src/renderer/src/lib/keybindings";
import {
  BUILTIN_SCHEME_ID, LEGACY_STORAGE_KEY, SCHEMES_STORAGE_KEY, emptyLibrary, exportScheme, migrateLegacy, parseSchemeExport, readLibrary, schemeBindings,
  syncFieldsOf, withActive, withBinding, withNewScheme, withSync, withSyncFields, withoutScheme, type KeyScheme, type SchemeLibrary,
} from "../src/renderer/src/lib/keybindingSchemes";
import {
  activeScheme, createScheme, deleteScheme, importScheme, keybindingSyncFields, reloadSchemesFromStorage, renameScheme, resetSchemesForTests, schemeLibrary,
  setKeybindingSyncOn, setPlatformSpecific, setSchemeSync, switchScheme,
} from "../src/renderer/src/lib/keybindingSchemeStore";
import { keybindingSyncCategory } from "../src/renderer/src/lib/keybindingSync";
import { KeybindingsSection } from "../src/renderer/src/components/settings/KeybindingsSection";

const ctrl = (code: string, extra: Partial<KeyLike> = {}): KeyLike => ({ key: code.replace(/^Key/, "").toLowerCase(), code, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...extra });
const cmd = (code: string, extra: Partial<KeyLike> = {}): KeyLike => ({ ...ctrl(code), ctrlKey: false, metaKey: true, ...extra });

const scheme = (over: Partial<KeyScheme> = {}): KeyScheme => ({ id: "s-a", name: "A", parent: BUILTIN_SCHEME_ID, bindings: {}, sync: true, updatedAt: 1, ...over });
const libWith = (...schemes: KeyScheme[]): SchemeLibrary => ({ ...emptyLibrary(), schemes, active: schemes[0]?.id ?? BUILTIN_SCHEME_ID });

beforeEach(() => {
  localStorage.clear();
  setKeybindingPlatform("windows");
  resetKeybindingsForTests();
});
afterEach(() => {
  setKeybindingPlatform(null);
  resetKeybindingsForTests();
});

describe("schemes over the built-in", () => {
  it("the built-in scheme is the registry's defaults; a scheme keeps only what it changes", () => {
    expect(schemeBindings(null, "sidebar", "windows")).toEqual(["Mod+KeyB"]);
    const s = scheme({ bindings: { sidebar: { keys: ["Mod+Backslash"] } } });
    expect(schemeBindings(s, "sidebar", "windows")).toEqual(["Mod+Backslash"]);
    // A command the scheme never mentions (e.g. one added later) has its default.
    expect(schemeBindings(s, "tray", "windows")).toEqual(["Mod+KeyJ"]);
    expect(schemeBindings(s, "terminal", "mac")).toEqual(["Ctrl+Backquote"]);
  });

  it("an edit back to the default everywhere leaves no entry", () => {
    let lib = libWith(scheme());
    lib = withBinding(lib, "s-a", "sidebar", "keys", ["Mod+Backslash"], 2);
    expect(lib.schemes[0]!.bindings.sidebar).toEqual({ keys: ["Mod+Backslash"] });
    lib = withBinding(lib, "s-a", "sidebar", "keys", ["Mod+KeyB"], 3);
    expect(lib.schemes[0]!.bindings.sidebar).toBeUndefined();
  });

  it("platform-neutral keys mean Ctrl on Windows and ⌘ on a Mac; a platform's own list wins there", () => {
    resetSchemesForTests(libWith(scheme({ bindings: { quickSwitch: { keys: ["Mod+KeyP"], mac: ["Mod+Shift+KeyP"] } } })));
    expect(matchesCommand("quickSwitch", ctrl("KeyP"))).toBe(true);
    expect(bindingsOf("quickSwitch", "linux")).toEqual(["Mod+KeyP"]);
    setKeybindingPlatform("mac");
    expect(matchesCommand("quickSwitch", cmd("KeyP"))).toBe(false);
    expect(matchesCommand("quickSwitch", cmd("KeyP", { shiftKey: true }))).toBe(true);
  });

  it("a command whose default differs on macOS is edited per platform", () => {
    resetSchemesForTests(libWith(scheme()));
    setBindings("terminal", ["Mod+Shift+Backquote"]);
    expect(activeScheme()!.bindings.terminal).toEqual({ windows: ["Mod+Shift+Backquote"] });
    expect(bindingsOf("terminal", "mac")).toEqual(["Ctrl+Backquote"]);
  });

  it("单独为一个平台: its own list starts from what it has, and dropping it returns to the shared keys", () => {
    resetSchemesForTests(libWith(scheme({ bindings: { sidebar: { keys: ["Mod+Backslash"] } } })));
    setPlatformSpecific("sidebar", "mac", true);
    expect(activeScheme()!.bindings.sidebar).toEqual({ keys: ["Mod+Backslash"], mac: ["Mod+Backslash"] });
    setBindings("sidebar", ["Mod+Alt+KeyS"], "mac");
    expect(bindingsOf("sidebar", "mac")).toEqual(["Mod+Alt+KeyS"]);
    expect(bindingsOf("sidebar", "windows")).toEqual(["Mod+Backslash"]);
    setPlatformSpecific("sidebar", "mac", false);
    expect(bindingsOf("sidebar", "mac")).toEqual(["Mod+Backslash"]);
  });

  it("conflicts are checked for the platform shown", () => {
    resetSchemesForTests(libWith(scheme()));
    expect(bindingConflicts("sidebar", "Mod+KeyQ", "mac")).toContainEqual({ kind: "reserved" });
    expect(bindingConflicts("sidebar", "Mod+KeyQ", "windows")).toEqual([]);
    expect(bindingConflicts("sidebar", "Alt+F4", "windows")).toContainEqual({ kind: "reserved" });
    expect(bindingConflicts("sidebar", "Alt+F4", "mac")).toEqual([]);
  });

  it("a change while 默认 is active starts 「我的快捷键」 (默认 itself never changes)", () => {
    expect(activeScheme()).toBeNull();
    setBindings("sidebar", ["Mod+Backslash"]);
    const mine = activeScheme()!;
    expect(mine.name).toBeNull();
    expect(bindingsOf("sidebar")).toEqual(["Mod+Backslash"]);
    switchScheme(BUILTIN_SCHEME_ID);
    expect(bindingsOf("sidebar")).toEqual(["Mod+KeyB"]);
  });
});

describe("migration of the old this-desktop overrides", () => {
  it("becomes 「我的快捷键」, active, with every key as before", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ v: 1, bindings: { sidebar: ["Ctrl+Backslash"], tray: [], terminal: ["Mod+Shift+Backquote"], nope: ["Mod+KeyX"] } }));
    reloadSchemesFromStorage();
    const mine = activeScheme()!;
    expect(mine.name).toBeNull();
    expect(bindingsOf("sidebar")).toEqual(["Mod+Backslash"]);
    expect(bindingsOf("tray")).toEqual([]);
    expect(bindingsOf("terminal")).toEqual(["Mod+Shift+Backquote"]);
    // terminal's default differs on macOS: the old key stays this platform's.
    expect(mine.bindings.terminal).toEqual({ windows: ["Mod+Shift+Backquote"] });
    expect(bindingsOf("terminal", "mac")).toEqual(["Ctrl+Backquote"]);
    // Stored once; the old key is left as it was.
    expect(readLibrary(JSON.parse(localStorage.getItem(SCHEMES_STORAGE_KEY)!))!.active).toBe(mine.id);
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toContain("Ctrl+Backslash");
    // A migrated device does not push its active scheme over another device's.
    expect(keybindingSyncFields().active).toBeUndefined();
    expect(Object.keys(keybindingSyncFields())).toEqual([`scheme:${mine.id}`]);
  });

  it("no old overrides: 默认 stays active and nothing is created", () => {
    expect(migrateLegacy({}, "s-x", 1)).toEqual(emptyLibrary());
    reloadSchemesFromStorage();
    expect(schemeLibrary().schemes).toEqual([]);
    expect(activeScheme()).toBeNull();
  });
});

describe("library operations", () => {
  it("新建 / 复制 / 重命名 / 切换 / 删除", () => {
    const a = createScheme("A")!;
    expect(schemeLibrary().active).toBe(a);
    setBindings("sidebar", ["Mod+Backslash"]);
    const b = createScheme("B", a)!;
    expect(activeScheme()!.bindings.sidebar).toEqual({ keys: ["Mod+Backslash"] });
    setBindings("sidebar", ["Mod+Alt+KeyS"]);
    switchScheme(a);
    expect(bindingsOf("sidebar")).toEqual(["Mod+Backslash"]);
    renameScheme(a, "  Vim   keys ");
    expect(activeScheme()!.name).toBe("Vim keys");
    renameScheme(a, "   ");
    expect(activeScheme()!.name).toBe("Vim keys");
    deleteScheme(a);
    expect(schemeLibrary().active).toBe(BUILTIN_SCHEME_ID);
    expect(schemeLibrary().schemes.map((s) => s.id)).toEqual([b]);
    expect(schemeLibrary().deleted[a]).toBeTypeOf("number");
    switchScheme("s-missing");
    expect(schemeLibrary().active).toBe(BUILTIN_SCHEME_ID);
  });

  it("export / import round-trips the overrides; other text is refused", () => {
    resetSchemesForTests(libWith(scheme({ name: "Mine", bindings: { sidebar: { keys: ["Mod+Backslash"], mac: ["Mod+Alt+KeyB"] } } })));
    const text = exportScheme(activeScheme()!, "fallback");
    expect(parseSchemeExport(text)).toEqual({ name: "Mine", bindings: { sidebar: { keys: ["Mod+Backslash"], mac: ["Mod+Alt+KeyB"] } } });
    expect(importScheme("{\"hello\":1}", "x")).toBe(false);
    expect(importScheme("not json", "x")).toBe(false);
    expect(importScheme(text, "x")).toBe(true);
    expect(activeScheme()!.id).not.toBe("s-a");
    expect(activeScheme()!.name).toBe("Mine");
    expect(bindingsOf("sidebar")).toEqual(["Mod+Backslash"]);
  });
});

describe("sync fields (the 同步 category)", () => {
  it("offers synced schemes, deletions as null and the active scheme once shared; 「不同步」 ones stay here", () => {
    let lib = libWith(scheme({ id: "s-a" }), scheme({ id: "s-b", sync: false }));
    expect(Object.keys(syncFieldsOf(lib))).toEqual(["scheme:s-a"]);
    lib = withActive(lib, "s-a");
    expect(syncFieldsOf(lib).active).toBe("s-a");
    lib = withoutScheme(lib, "s-a", 5);
    expect(syncFieldsOf(lib)).toEqual({ "scheme:s-a": null, active: BUILTIN_SCHEME_ID });
    lib = withSync(lib, "s-b", true, 6);
    expect(syncFieldsOf(lib)["scheme:s-b"]).toMatchObject({ name: "A" });
    // Off again: the other devices drop their copy; this device keeps it (and ignores the deletion coming back).
    lib = withSync(lib, "s-b", false, 7);
    expect(syncFieldsOf(lib)["scheme:s-b"]).toBeNull();
    expect(withSyncFields(lib, { "scheme:s-b": null }).schemes.map((s) => s.id)).toEqual(["s-b"]);
  });

  it("takes another device's schemes, deletions and switch; leaves a local-only scheme alone", () => {
    const local = libWith(scheme({ id: "s-a" }), scheme({ id: "s-keep", name: "Keep", sync: false }));
    let lib = withSyncFields(local, {
      "scheme:s-new": { name: "From laptop", parent: "default", bindings: { sidebar: { keys: ["Mod+Backslash"] }, bogus: { keys: ["X"] } }, updatedAt: 9 },
      "scheme:s-keep": { name: "Overwritten?", bindings: {} },
      "scheme:s-a": null,
      active: "s-new",
    });
    expect(lib.schemes.map((s) => s.id)).toEqual(["s-keep", "s-new"]);
    expect(lib.schemes[0]!.name).toBe("Keep");
    expect(lib.schemes[1]!.bindings).toEqual({ sidebar: { keys: ["Mod+Backslash"] } });
    expect(lib.active).toBe("s-new");
    // The same remote `active` again does not switch this device back after the owner chose here.
    lib = withActive(lib, "s-keep");
    lib = withSyncFields(lib, { active: "s-new" });
    expect(lib.active).toBe("s-keep");
    // A switch to a scheme this device does not have yet waits for it.
    lib = withSyncFields(lib, { active: "s-later" });
    expect(lib.active).toBe("s-keep");
    lib = withSyncFields(lib, { "scheme:s-later": { name: "Later", bindings: {} }, active: "s-later" });
    expect(lib.active).toBe("s-later");
  });

  it("the category descriptor reads / writes the store and summarises the active scheme", () => {
    const a = createScheme("Work")!;
    expect(keybindingSyncCategory.read({ hosts: [] })).toMatchObject({ [`scheme:${a}`]: { name: "Work" }, active: a });
    keybindingSyncCategory.write({ [`scheme:${a}`]: null }, { hosts: [] });
    expect(schemeLibrary().active).toBe(BUILTIN_SCHEME_ID);
    const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? JSON.stringify(vars) : ""}`;
    expect(keybindingSyncCategory.summary({}, t as never, { hosts: [] })).toBe('keySchemes.syncSummary{"name":"keySchemes.builtin","n":1}');
    expect(keybindingSyncCategory.defaultOn).toBe(true);
  });

  it("a new scheme copies the source's sync choice", () => {
    let lib = libWith(scheme({ id: "s-a", sync: false }));
    lib = withNewScheme(lib, "B", "s-a", "s-b", 2);
    expect(lib.schemes[1]!.sync).toBe(false);
  });
});

describe("Settings → 键盘快捷键 scheme picker", () => {
  let root: Root;
  let host: HTMLDivElement;
  const render = () => act(() => root.render(h(KeybindingsSection)));
  const q = (sel: string) => host.querySelector<HTMLElement>(sel);
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined;
  const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click());

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("默认 is read-only until copied; the copy becomes active and editable", () => {
    render();
    expect(q("[data-keybinding-readonly]")).not.toBeNull();
    expect(q("[data-keybinding-add]")).toBeNull();
    expect((q("[data-keybinding='sidebar'] [data-keybinding-key]") as HTMLButtonElement).disabled).toBe(true);
    expect(button("keySchemes.delete")).toBeUndefined();
    click(button("keySchemes.copyToEdit"));
    expect(activeScheme()).not.toBeNull();
    expect(q("[data-keybinding-readonly]")).toBeNull();
    expect(q("[data-keybinding-add]")).not.toBeNull();
  });

  it("新建 asks for a name; 删除 needs a second click and returns to 默认", () => {
    render();
    click(button("keySchemes.new"));
    const input = q("[data-key-scheme-name='new'] input") as HTMLInputElement;
    expect(input.value).toBe("keySchemes.newName");
    click(button("keySchemes.save"));
    const id = schemeLibrary().active;
    expect(activeScheme()!.name).toBe("keySchemes.newName");
    click(button("keySchemes.delete"));
    expect(schemeLibrary().active).toBe(id);
    click(button("keySchemes.deleteArmed"));
    expect(schemeLibrary().active).toBe(BUILTIN_SCHEME_ID);
    expect(schemeLibrary().schemes).toEqual([]);
  });

  it("已同步 shows when the category is on and the scheme syncs; 查看平台 shows another platform's keys", () => {
    resetSchemesForTests(libWith(scheme({ name: "Mine", bindings: { sidebar: { keys: ["Mod+Backslash"], mac: ["Mod+Alt+KeyB"] } } })));
    render();
    expect(q("[data-key-scheme-synced]")).toBeNull();
    act(() => setKeybindingSyncOn(true));
    expect(q("[data-key-scheme-synced]")).not.toBeNull();
    act(() => setSchemeSync("s-a", false));
    expect(q("[data-key-scheme-synced]")).toBeNull();
    expect(q("[data-keybinding='sidebar'] [data-keybinding-key]")!.textContent).toBe("Ctrl+\\");
    click([...host.querySelectorAll("[data-keybinding-view] button")].find((b) => b.textContent === "keySchemes.platform.mac"));
    expect(q("[data-keybinding-view]")!.getAttribute("data-keybinding-view")).toBe("mac");
    expect(q("[data-keybinding-other-platform]")).not.toBeNull();
    expect(q("[data-keybinding='sidebar'] [data-keybinding-key]")!.textContent).toBe("⌥⌘B");
    expect(q("[data-keybinding='sidebar'] [data-keybinding-platform-own]")!.getAttribute("data-keybinding-platform-own")).toBe("on");
  });
});
