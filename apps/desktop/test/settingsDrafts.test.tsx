// @vitest-environment jsdom
// Unsaved drafts in Settings (lib/settingsDrafts; Director 2026-11-18): only a dirty page counts, saving stops at the first
// draft that is not saved, an unmounted page is forgotten; what counts as an unsaved change of any other form. The
// window-bar confirm with the real ProfileEditor: test/profileEditorKinds.test.tsx.
import { readFileSync } from "node:fs";
import { act, createElement as h, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasSettingsDrafts, resetSettingsDrafts, saveSettingsDrafts, discardSettingsDrafts, settingsControlChanged, unsavedSettingsEdits, useSettingsCard, useSettingsDraft, useSettingsEditWatch, watchSettingsEdits, type SettingsDraft } from "../src/renderer/src/lib/settingsDrafts";
import { TextField, TextInput, Toggle } from "../src/renderer/src/components/settings/Form";

vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ locale: "en", t: (s: string) => s }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetSettingsDrafts();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Page({ draft }: { draft: SettingsDraft }) {
  useSettingsDraft(draft);
  return null;
}
const draft = (dirty: boolean, saved = true): SettingsDraft => ({ dirty, save: vi.fn(async () => saved), discard: vi.fn() });

describe("the Settings draft registry", () => {
  it("only a page with unsaved edits counts; unmounted, it is forgotten", () => {
    act(() => root.render(h(Page, { draft: draft(false) })));
    expect(hasSettingsDrafts()).toBe(false);
    act(() => root.render(h(Page, { draft: draft(true) })));
    expect(hasSettingsDrafts()).toBe(true);
    act(() => root.render(null));
    expect(hasSettingsDrafts()).toBe(false);
  });

  it("save: every dirty draft, stopping at the first not saved; discard: each dirty one", async () => {
    const a = draft(true, false);
    const b = draft(true);
    const clean = draft(false);
    act(() => root.render(h("div", null, h(Page, { draft: a }), h(Page, { draft: b }), h(Page, { draft: clean }))));
    expect(await saveSettingsDrafts()).toBe(false);
    expect(a.save).toHaveBeenCalledTimes(1);
    expect(b.save).not.toHaveBeenCalled();
    expect(clean.save).not.toHaveBeenCalled();
    discardSettingsDrafts();
    expect(a.discard).toHaveBeenCalledTimes(1);
    expect(b.discard).toHaveBeenCalledTimes(1);
    expect(clean.discard).not.toHaveBeenCalled();
  });

  it("a save that throws counts as not saved", async () => {
    act(() => root.render(h(Page, { draft: { dirty: true, save: async () => { throw new Error("x"); }, discard() {} } })));
    expect(await saveSettingsDrafts()).toBe(false);
  });

  it("the Settings pages with a save bar report theirs (Profile, 指令, the MCP server form)", () => {
    const src = (p: string) => readFileSync(`src/renderer/src/components/settings/${p}`, "utf8");
    expect(src("ProfileEditor.tsx")).toContain("leaveDraft.current = { dirty, save, discard: revert };");
    expect(src("GlobalSettings.tsx")).toContain("useSettingsDraft({ dirty: !!doc && text !== doc.content, save,");
    expect(src("CapabilitiesSettings.tsx")).toMatch(/useSettingsDraft\(\{\n\s+dirty: name !== \(editing \?\? ""\) \|\| JSON\.stringify\(draft\) !== opened,/);
  });
});

// Review 2026-11-18 (night-review): opt-in registration missed many forms, so the Settings Shelf watches its page. Final review
// (Director 2026-11-18): a card counts from the first change of any control until it reports a successful save — never
// settled by a button press or Enter; controls that save by themselves report their own result.
describe("changes in any Settings form (watchSettingsEdits)", () => {
  let page: HTMLDivElement;
  let stop: () => void;
  beforeEach(() => {
    page = document.createElement("div");
    page.innerHTML = `<section id="card"><input id="name" type="text"><textarea id="note"></textarea><select id="pick"><option value="a">a</option><option value="b">b</option></select>
      <input id="box" type="checkbox"><button id="save">保存</button></section>
      <section><div data-settings-list-filter=""><input id="filter"></div><input id="search" data-settings-filter=""><div role="search"><input id="q"></div></section>
      <div data-settings-draft=""><input id="owned"><div data-settings-card="" id="inner"><input id="nested"></div></div>`;
    document.body.append(page);
    stop = watchSettingsEdits(page);
  });
  afterEach(() => {
    stop();
    page.remove();
  });
  const el = <E extends HTMLElement>(id: string) => page.querySelector<E>(`#${id}`)!;
  const typeIn = (id: string, value: string) => {
    const e = el<HTMLInputElement>(id);
    e.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    e.value = value;
    e.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const ids = () => unsavedSettingsEdits().map((e) => e.id);

  it("a field typed in, a select or box changed: unsaved until back to its value before the change", () => {
    typeIn("name", "draft");
    typeIn("note", "more");
    const pick = el<HTMLSelectElement>("pick");
    pick.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    pick.value = "b";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    el<HTMLInputElement>("box").click();
    expect(ids()).toEqual(["name", "note", "pick", "box"]);
    expect(hasSettingsDrafts()).toBe(true);
    typeIn("name", "");
    pick.value = "a";
    el<HTMLInputElement>("box").click();
    expect(ids()).toEqual(["note"]);
  });

  it("a button pressed in its card or Enter in a field settles nothing (final review 2026-11-18)", () => {
    typeIn("name", "draft");
    el("save").click();
    el("name").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(ids()).toEqual(["name"]);
  });

  it("a removed field is forgotten (its form closed); filters never count", () => {
    typeIn("note", "x");
    el("note").remove();
    for (const id of ["filter", "search", "q"]) typeIn(id, "typed");
    expect(unsavedSettingsEdits()).toHaveLength(0);
  });

  it("a page that reports its own draft keeps its controls; a card inside it is the card's", () => {
    typeIn("owned", "typed");
    expect(unsavedSettingsEdits()).toHaveLength(0);
    typeIn("nested", "typed");
    expect(ids()).toEqual(["nested"]);
  });

  it("a control that saved itself: unsaved until its save resolved, kept when that failed", async () => {
    let finish!: (ok: unknown) => void;
    settingsControlChanged(el("save"), new Promise((resolve) => (finish = resolve)));
    expect(ids()).toEqual(["save"]);
    finish(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(unsavedSettingsEdits()).toHaveLength(0);
    settingsControlChanged(el("save"), Promise.reject(new Error("refused")));
    settingsControlChanged(el("box"), Promise.resolve(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ids()).toEqual(["save", "box"]);
    settingsControlChanged(el("q"), undefined);
    expect(ids()).toEqual(["save", "box"]);
  });
});

describe("a Settings card (useSettingsCard) with Form's controls", () => {
  function Form({ save }: { save(): Promise<boolean> }) {
    const card = useSettingsCard();
    const [on, setOn] = useState(false);
    const [name, setName] = useState("");
    return h(Fragment, null,
      h("div", { ref: card.ref, id: "form" },
        h(TextInput, { label: "name", value: name, onChange: setName }),
        h(Toggle, { label: "on", checked: on, onChange: setOn }),
        h("button", { id: "pick", onClick: () => card.changed() }, "colour"),
        h("button", { id: "create", onClick: () => void save().then((ok) => ok && card.saved()) }, "创建"),
      ),
      h("section", null, h(Toggle, { label: "applies", checked: on, onChange: () => Promise.resolve() })),
    );
  }
  function Shelf(props: { save(): Promise<boolean> }) {
    return h("div", { ref: useSettingsEditWatch() }, h(Form, props));
  }
  const q = <E extends Element>(sel: string) => host.querySelector<E>(sel)!;

  it("any change counts (a switch, a picker of its own) until its save succeeds; a refused save keeps it", async () => {
    let ok = false;
    act(() => root.render(h(Shelf, { save: async () => ok })));
    act(() => q<HTMLButtonElement>('[aria-label="on"]').click());
    expect(hasSettingsDrafts()).toBe(true);
    await act(async () => q<HTMLButtonElement>("#create").click());
    expect(hasSettingsDrafts()).toBe(true);
    ok = true;
    await act(async () => q<HTMLButtonElement>("#create").click());
    expect(hasSettingsDrafts()).toBe(false);
    act(() => q<HTMLButtonElement>("#pick").click());
    expect(hasSettingsDrafts()).toBe(true);
  });

  it("a switch outside any card saves itself: nothing unsaved once that save resolved", async () => {
    act(() => root.render(h(Shelf, { save: async () => true })));
    await act(async () => q<HTMLButtonElement>('[aria-label="applies"]').click());
    expect(hasSettingsDrafts()).toBe(false);
  });
});

// Final review 2026-11-18 (P3): a TextField whose blur save succeeded was still reported unsaved.
describe("a TextField (saves on Enter / blur)", () => {
  function Page({ commit }: { commit(next: string): Promise<unknown> }) {
    const watch = useSettingsEditWatch();
    const [value, setValue] = useState("old");
    return h("div", { ref: watch }, h("section", null, h(TextField, { value, label: "review-autosave", onCommit: async (next: string) => { await commit(next); setValue(next); } })));
  }
  const typeAndBlur = async (text: string) => {
    const input = host.querySelector("input")!;
    act(() => input.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(hasSettingsDrafts()).toBe(true);
    await act(async () => input.blur());
    return input;
  };

  it("a successful save: nothing unsaved", async () => {
    act(() => root.render(h(Page, { commit: async () => {} })));
    const input = await typeAndBlur("saved-new");
    expect(input.value).toBe("saved-new");
    expect(hasSettingsDrafts()).toBe(false);
  });

  it("a failed save keeps what was typed, unsaved", async () => {
    act(() => root.render(h(Page, { commit: async () => { throw new Error("refused"); } })));
    const input = await typeAndBlur("not-saved");
    expect(input.value).toBe("not-saved");
    expect(hasSettingsDrafts()).toBe(true);
  });

  // Final review 2026-11-18 (night-review, second pass): save results carry the revision they were made at.
  const typeIn = (input: HTMLInputElement, text: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  it.each(["newer text", "Escape"])("a late failed save respects %s typed meanwhile", async (mode) => {
    let fail!: (reason: unknown) => void;
    const pending = new Promise<void>((_, reject) => (fail = reject));
    act(() => root.render(h(Page, { commit: () => pending })));
    const input = await typeAndBlur("first failed text");
    act(() => input.focus());
    typeIn(input, "newer unsaved text");
    if (mode === "Escape") act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    const expected = mode === "Escape" ? "old" : "newer unsaved text";
    expect(input.value).toBe(expected);
    await act(async () => fail(new Error("review refusal")));
    expect(input.value).toBe(expected);
    expect(hasSettingsDrafts()).toBe(mode !== "Escape");
  });

  it("Esc after a failed save puts the saved value back: nothing unsaved", async () => {
    act(() => root.render(h(Page, { commit: async () => { throw new Error("refused"); } })));
    const input = await typeAndBlur("failed text");
    expect(input.value).toBe("failed text");
    act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(input.value).toBe("old");
    expect(hasSettingsDrafts()).toBe(false);
  });

  it("an older save that succeeds late does not settle a newer one that failed", async () => {
    let done!: (value?: unknown) => void, fail!: (reason: unknown) => void;
    const a = new Promise((resolve) => (done = resolve));
    const b = new Promise((_, reject) => (fail = reject));
    act(() => root.render(h(Page, { commit: (next: string) => (next === "A" ? a : b) })));
    await typeAndBlur("A");
    const input = await typeAndBlur("B");
    await act(async () => fail(new Error("B refused")));
    expect(input.value).toBe("B");
    expect(hasSettingsDrafts()).toBe(true);
    await act(async () => done());
    expect(input.value).toBe("B");
    expect(hasSettingsDrafts()).toBe(true);
  });
});

describe("a card's save settles only the changes it carried", () => {
  it("a change made while its save runs stays unsaved", async () => {
    let card!: ReturnType<typeof useSettingsCard>;
    function Form() {
      card = useSettingsCard();
      return h("div", { ref: useSettingsEditWatch() }, h("div", { ref: card.ref }, h("button", { id: "pick", onClick: () => card.changed() }, "pick")));
    }
    act(() => root.render(h(Form)));
    act(() => host.querySelector<HTMLButtonElement>("#pick")!.click());
    const upTo = card.revision();
    act(() => host.querySelector<HTMLButtonElement>("#pick")!.click());
    card.saved(upTo);
    expect(hasSettingsDrafts()).toBe(true);
    card.saved(card.revision());
    expect(hasSettingsDrafts()).toBe(false);
  });

  it("a form that knows its own 未保存 (useSettingsCard(dirty)): unsaved exactly while it differs", () => {
    let save!: (on: boolean) => void;
    function Grant() {
      const [saved, setSaved] = useState(false);
      const [on, setOn] = useState(false);
      const card = useSettingsCard(on !== saved);
      save = (v) => setSaved(v);
      return h("div", { ref: useSettingsEditWatch() }, h("div", { ref: card.ref }, h(Toggle, { label: "send", checked: on, onChange: setOn })));
    }
    act(() => root.render(h(Grant)));
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="send"]')!;
    act(() => toggle.click());
    expect(hasSettingsDrafts()).toBe(true);
    act(() => toggle.click());
    expect(hasSettingsDrafts()).toBe(false);
    act(() => toggle.click());
    act(() => save(true));
    expect(hasSettingsDrafts()).toBe(false);
  });
});

describe("the forms the review listed are watched", () => {
  const src = (p: string) => readFileSync(`src/renderer/src/${p}`, "utf8");
  // New Profile; Profile credentials / account key; variant defaults; manual proxy; host add / edit; token import; new
  // host group; listen address / CORS (远程访问); device invite; Claude / Kimi account add / rename.
  // A card (useSettingsCard): saved only by a successful save. The rest close on success or empty their fields (tracked
  // by value): token import, a Claude account's rename (远程访问's address fields too; its pairing scope is a card).
  const cards = ["components/settings/NewProfileForm.tsx", "components/settings/ProfileCredentialSection.tsx", "components/settings/ProfileVariantsSection.tsx",
    "components/settings/ProxyEditor.tsx", "components/settings/ConnectionSettings.tsx", "components/settings/HostGroupsSection.tsx", "components/settings/InvitePanel.tsx",
    "modules/kimi-accounts/KimiAccountsSection.tsx", "components/settings/RemoteAccess.tsx"];
  const byValue = ["components/settings/HostTokenImport.tsx", "modules/claude-accounts/ClaudeAccountsSection.tsx"];
  it.each([...cards, ...byValue])("%s: its fields are watched, none left out as a filter / a page draft", (file) => {
    const s = src(file);
    expect(s).toMatch(/<TextInput\b|<TextArea\b|<input\b|<textarea\b/);
    expect(s).not.toMatch(/<TextInput\b[^>]*\bsearch\b/);
    expect(s).not.toContain("data-settings-draft");
    expect(s.includes("useSettingsCard(")).toBe(cards.includes(file));
  });
  // Second pass (final review): the multi-runtime new Profile, and the draft forms a sweep of Settings found (choices kept
  // until a submit): a person's access, NCI identity / mailbox, Claude account add, per-agent notification add row,
  // plugin install confirmation, pairing scope, a pending device's 「记住这个人」, account links, 互通的项目 picks, usage source
  // add / prices, backend upgrade's advanced choices, a peer invite's label.
  it.each(["components/settings/NewProfileVariantsForm.tsx", "modules/users/UsersPage.tsx", "modules/nci/NciSettings.tsx", "modules/claude-accounts/AccountFlow.tsx",
    "components/settings/OwnerNotifySettings.tsx", "components/settings/PluginsSettings.tsx", "modules/users/AddDevice.tsx", "modules/users/DevicesSection.tsx",
    "components/settings/ProfileAccountLinkDialog.tsx", "components/settings/SecuritySettings.tsx", "modules/usage/Sources.tsx", "modules/usage/UsagePage.tsx",
    "modules/backend-upgrade/BackendUpgradePage.tsx", "modules/peers/PeersPage.tsx"])("%s uses a Settings card", (file) => {
    expect(src(file)).toContain("useSettingsCard(");
  });
  it("the Settings Shelf watches its page column; Form's controls report their own changes; TextInput's `search` is a filter", () => {
    expect(src("components/SettingsShelf.tsx")).toContain('<div ref={watchEdits} className="flex min-h-0 min-w-0 flex-1" data-settings-page-column=""');
    const form = src("components/settings/Form.tsx");
    expect(form).toContain('data-settings-filter={search ? "" : undefined}');
    expect(form.match(/settingsControlChanged\(e\.currentTarget, onChange\(/g)?.length).toBeGreaterThanOrEqual(8);
  });
});

it("Review 2026-11-18: 保存并前往 keeps the window it was asked in after an awaited save", async () => {
  const { useActiveWindow, currentWindow } = await import("../src/renderer/src/lib/windowScope");
  const { useSettingsShelf, openSettingsShelf, setSettingsShelfMaximized, resetSettingsShelfForTest } = await import("../src/renderer/src/lib/settingsShelf");
  const { leaveCoveringSettings } = await import("../src/renderer/src/lib/openSettings");
  const { useOverlayState, runAction, closeMenu } = await import("../src/renderer/src/lib/contextMenu");
  let finish!: (ok: boolean) => void;
  const request = new Promise<boolean>((resolve) => (finish = resolve));
  const go = vi.fn(() => currentWindow());
  let menu: ReturnType<typeof useOverlayState>["menu"] = null;
  function Probe() {
    useSettingsDraft({ dirty: true, save: () => request, discard() {} });
    menu = useOverlayState().menu;
    return null;
  }
  const anchor = document.createElement("button");
  document.body.append(anchor);
  useActiveWindow.setState({ key: "main" });
  resetSettingsShelfForTest();
  openSettingsShelf({ tab: "general" });
  setSettingsShelfMaximized(true);
  try {
    act(() => root.render(h(Probe)));
    act(() => leaveCoveringSettings(go, anchor));
    const save = menu!.items[1];
    if (!save || save === "separator") throw new Error("no save row");
    let action!: Promise<void>;
    await act(async () => {
      action = runAction(save);
      await Promise.resolve();
    });
    useActiveWindow.setState({ key: "review-other-window" });
    await act(async () => {
      finish(true);
      await action;
    });
    expect(go).toHaveReturnedWith("main");
    expect(useSettingsShelf.getState().open).toBe(false);
  } finally {
    useActiveWindow.setState({ key: "main" });
    act(() => {
      closeMenu();
      resetSettingsShelfForTest();
    });
    anchor.remove();
  }
}, 20000);
