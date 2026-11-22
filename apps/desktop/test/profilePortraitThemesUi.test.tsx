// @vitest-environment jsdom
// Owner 2026-11-18: saving a Profile failed with `avatarStyle: portraitThemes must use pack/theme identifiers (1-20 …)` —
// bundled themes 「山城万象」 (27-character id) and 「大学风云」 (22) are longer than an older host's 20. On such a host
// every other field still saves, the 头像风格 draft is kept (across the remount a rename causes) with a short named note,
// and the backend's raw error is never shown (shared/profilePortraitThemes, main patchProfile's portraitProblem).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileDetail, ProfileItem } from "../src/shared/ipc";
import type { ProfilePortraitThemeProblem } from "../src/shared/profilePortraitThemes";

const MOUNTAIN = "kit-20261029/mountain-city-myriad-layers";
const UNIVERSITY = "kit-20261029/university-universalis";
const OFFICE = "kit-20261029/office";
const env = vi.hoisted(() => ({ snapshot: null as unknown, features: new Set<string>(), api: {} as Record<string, unknown>, pick: [] as string[], cold: false, host: "local" }));
vi.mock("../src/renderer/src/bridge", () => ({
  api: env.api, apiFor: () => env.api, cleanIpcMessage: (s: string) => s,
  bridge: { on: () => () => {}, shell: { logError: vi.fn() } }, onEvent: () => () => {},
}));
vi.mock("../src/renderer/src/i18n", async (original) => ({
  ...(await original<object>()), useI18n: () => ({ locale: "en", t: (key: string, v?: Record<string, unknown>) => (v ? `${key}:${JSON.stringify(v)}` : key) }),
}));
vi.mock("../src/renderer/src/lib/targetHost", async (original) => ({
  ...(await original<object>()), useTargetApi: () => env.api, useTargetFeatures: () => env.features,
  useTargetHostId: () => env.host, useTargetLoadQuota: () => vi.fn(), useTargetQuotas: () => ({}),
  useTargetSidebar: () => ({ active: [], retired: [], projects: null }), useTargetSelect: () => vi.fn(),
}));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({
  cachedProfile: () => (env.cold ? null : env.snapshot), loadProfileSnapshot: async () => env.snapshot,
  updateCachedProfile: vi.fn(), loadProfileList: async () => null,
}));
vi.mock("../src/renderer/src/lib/useProfilePresets", async () => {
  const { FALLBACK_PRESETS } = await import("../src/renderer/src/lib/profilePresets");
  return { useProfilePresets: () => FALLBACK_PRESETS };
});
vi.mock("../src/renderer/src/lib/useClaudeAccountList", () => ({ useClaudeAccountList: () => ({ list: [], loadError: null, load: async () => {} }) }));
vi.mock("../src/renderer/src/modules/react", () => ({ useSlot: () => [] }));
// The installed packs' names (the real hook reads the pack store).
// Like the real hook it is a React hook (it subscribes to the pack store): a call after an early return breaks the hook order.
vi.mock("../src/renderer/src/lib/portraitThemes", async (original) => {
  const { useState } = await import("react");
  return {
    ...(await original<object>()),
    usePortraitThemes: () => useState(() => ({ themes: [{ key: MOUNTAIN, name: "山城万象" }, { key: UNIVERSITY, name: "大学风云" }, { key: OFFICE, name: "办公室" }], enabled: [] }))[0],
  };
});
// The picker itself has its own tests (avatarStylePicker.test.tsx): here a button drafts a portrait style and shows what is edged.
vi.mock("../src/renderer/src/components/settings/AvatarStylePicker", async (original) => {
  const real = await original<typeof import("../src/renderer/src/components/settings/AvatarStylePicker")>();
  return {
    ...real,
    AvatarStylePicker: ({ value, onChange, blocked }: { value: { kind: string; portraitThemes?: string[] } | null; onChange(v: unknown): void; blocked?: readonly string[] }) =>
      h("div", { "data-stub-picker": value?.kind === "portrait" ? value.portraitThemes!.join(",") : (value?.kind ?? "inherit"), "data-stub-blocked": (blocked ?? []).join(",") },
        h("button", { type: "button", "data-pick": "", onClick: () => onChange({ kind: "portrait", portraitThemes: env.pick }) }, "pick")),
    AvatarStyleLabel: () => null,
  };
});
const { ProfileEditor } = await import("../src/renderer/src/components/settings/ProfileEditor");
const { CardBoundary } = await import("../src/renderer/src/components/settings/Form");
const { releaseBlockedStyle, portraitProblemText } = await import("../src/renderer/src/lib/portraitThemeDraft");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
function profile(name: string): ProfileDetail {
  return { id: "p1", name, cliKind: "codex", authKind: "apiKey", providerFamily: "relay", providerFamilyLabel: null, authPresent: true,
    baseUrl: "https://relay.example/v1", planLabel: null, model: "gpt-5", modelReasoningEffort: null,
    appearance: { color: null, effectiveColor: null, providerCategory: null }, allowSessionSwitch: false, quotaEnabled: false,
    detail: { config: { model: "gpt-5", modelProvider: "relay", providerBaseUrl: "https://relay.example/v1" }, editable: { name: true, model: true }, apiKeyPresent: true },
  } as unknown as ProfileDetail;
}
const onChanged = vi.fn();
const mount = (detail: ProfileDetail) => {
  env.snapshot = { detail, models: null, quota: null, account: null };
  return act(async () => root.render(h(ProfileEditor, {
    key: `${env.host}:${detail.name}`, profile: detail.name, item: detail as ProfileItem, isDefault: false, refusal: null,
    onChanged, onDuplicate: vi.fn(), onDelete: async () => {}, onCreateProvider: vi.fn(),
  })));
};
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const saveButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent === "settings.save");
const note = () => q("[data-portrait-theme-problem]");
async function pick(themes: string[]) {
  env.pick = themes;
  await act(async () => q("[data-pick]")!.click());
}
function rename(to: string) {
  const input = [...container.querySelectorAll<HTMLInputElement>("input")].find((i) => i.title === "settings.profile.rename")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, to);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  env.features = new Set(["profile-avatar-style"]);
  env.cold = false;
  env.host = "local";
  onChanged.mockReset();
  for (const k of Object.keys(env.api)) delete env.api[k];
  Object.assign(env.api, { getProfile: async () => (env.snapshot as { detail: ProfileDetail }).detail, profileAccount: async () => null, profileModels: async () => null,
    components: async () => ({ components: [] }), listComponents: async () => ({ components: [] }) });
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  releaseBlockedStyle("local", "p1");
});

describe("a host that stores theme ids up to 20 characters", () => {
  it("no cached Profile: the editor waits for the detail, then renders (the theme names hook runs on every render)", async () => {
    env.cold = true;
    const detail = profile("omega");
    env.snapshot = { detail, models: null, quota: null, account: null };
    await act(async () => root.render(h(CardBoundary, { children: h(ProfileEditor, {
      profile: detail.name, item: detail as ProfileItem, isDefault: false, refusal: null,
      onChanged, onDuplicate: vi.fn(), onDelete: async () => {}, onCreateProvider: vi.fn(),
    }) })));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(q("[data-card-error]")).toBeNull();
    expect(q("[data-stub-picker]")).not.toBeNull();
  });

  it("the note names the themes as soon as they are picked; their cards are edged", async () => {
    await mount(profile("omega"));
    await pick([OFFICE, MOUNTAIN, UNIVERSITY]);
    expect(note()!.textContent).toContain("avatarStyle.portrait.hostTooOld");
    expect(note()!.textContent).toContain("山城万象、大学风云");
    expect(note()!.textContent).toContain("avatarStyle.portrait.keptDraft");
    expect(q("[data-stub-blocked]")!.dataset.stubBlocked).toBe(`${MOUNTAIN},${UNIVERSITY}`);
  });

  it("rename + unsupported themes: the rename saves without the style; after the remount the draft and its note are still there", async () => {
    const patchProfile = vi.fn(async (_id: string, body: Record<string, unknown>) => ({ ...profile(String(body.name ?? "omega")) }));
    env.api.patchProfile = patchProfile;
    await mount(profile("omega"));
    await pick([OFFICE, MOUNTAIN]);
    rename("omega-2");
    await act(async () => saveButton()!.click());
    expect(patchProfile).toHaveBeenCalledExactlyOnceWith("omega", { name: "omega-2" });
    expect(onChanged).toHaveBeenLastCalledWith("omega-2");
    // ProfilesSettings keys the editor by name: the renamed Profile mounts a new editor.
    await mount(profile("omega-2"));
    expect(q("[data-stub-picker]")!.dataset.stubPicker).toBe(`${OFFICE},${MOUNTAIN}`);
    expect(note()!.textContent).toContain("山城万象");
    expect(saveButton()).toBeDefined();
    expect(container.textContent).not.toContain("pack/theme identifiers");
  });

  it("only the style changed: nothing is sent, no 「saved」 line, the draft stays", async () => {
    const patchProfile = vi.fn();
    env.api.patchProfile = patchProfile;
    await mount(profile("omega"));
    await pick([MOUNTAIN]);
    await act(async () => saveButton()!.click());
    expect(patchProfile).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("agent-config.profile.savedNext");
    expect(q("[data-stub-picker]")!.dataset.stubPicker).toBe(MOUNTAIN);
    expect(note()).not.toBeNull();
  });

  it("ids that fit go to the host as before; the draft clears", async () => {
    const patchProfile = vi.fn(async () => profile("omega"));
    env.api.patchProfile = patchProfile;
    await mount(profile("omega"));
    await pick([OFFICE]);
    expect(note()).toBeNull();
    await act(async () => saveButton()!.click());
    expect(patchProfile).toHaveBeenCalledExactlyOnceWith("omega", { avatarStyle: { kind: "portrait", portraitThemes: [OFFICE] } });
    expect(q("[data-stub-picker]")!.dataset.stubPicker).not.toBe(OFFICE);
    expect(container.textContent).toContain("agent-config.profile.savedNext");
  });
});

describe("the host's own answer", () => {
  it("capabilities changed after the check: main leaves the style out and says so — the rest is saved, the draft and note stay", async () => {
    env.features = new Set(["profile-avatar-style", "profile-avatar-style-theme-32"]);
    const problem: ProfilePortraitThemeProblem = { kind: "invalidReferences", references: [MOUNTAIN], maxThemeLength: 20 };
    const patchProfile = vi.fn(async (_id: string, body: Record<string, unknown>) => ({ ...profile(String(body.name ?? "omega")), portraitProblem: problem }));
    env.api.patchProfile = patchProfile;
    await mount(profile("omega"));
    await pick([MOUNTAIN]);
    expect(note()).toBeNull();
    rename("omega-3");
    await act(async () => saveButton()!.click());
    expect(patchProfile).toHaveBeenCalledExactlyOnceWith("omega", { name: "omega-3", avatarStyle: { kind: "portrait", portraitThemes: [MOUNTAIN] } });
    await mount(profile("omega-3"));
    expect(q("[data-stub-picker]")!.dataset.stubPicker).toBe(MOUNTAIN);
    expect(note()!.textContent).toContain("山城万象");
  });

  it("an older host's own refusal is shown as the short note, never the raw message", async () => {
    env.features = new Set(["profile-avatar-style", "profile-avatar-style-theme-32"]);
    env.api.patchProfile = vi.fn(async () => {
      throw new Error("avatarStyle: portraitThemes must use pack/theme identifiers (1-20 characters each)");
    });
    await mount(profile("omega"));
    await pick([MOUNTAIN, OFFICE]);
    await act(async () => saveButton()!.click());
    expect(container.textContent).not.toContain("pack/theme identifiers");
    expect(container.textContent).toContain("avatarStyle.portrait.hostTooOld");
    expect(container.textContent).toContain("山城万象");
  });

  it("reverting lets the held draft go", async () => {
    env.api.patchProfile = vi.fn(async (_id: string, body: Record<string, unknown>) => profile(String(body.name ?? "omega")));
    await mount(profile("omega"));
    await pick([MOUNTAIN]);
    rename("omega-4");
    await act(async () => saveButton()!.click());
    await mount(profile("omega-4"));
    const revert = [...container.querySelectorAll("button")].find((b) => b.textContent === "agent-config.profile.revert");
    expect(revert).toBeDefined();
    await act(async () => revert!.click());
    await mount(profile("omega-5"));
    expect(q("[data-stub-picker]")!.dataset.stubPicker).not.toBe(MOUNTAIN);
  });
});

describe("the note's words", () => {
  const t = (key: string, v?: Record<string, string | number>) => (v ? `${key}:${JSON.stringify(v)}` : key);
  const name = (k: string) => ({ [MOUNTAIN]: "山城万象", [UNIVERSITY]: "大学风云" })[k] ?? k;
  it("ids an upgrade can store: 「暂时存不了…（升级后可用）」 with the names", () => {
    expect(portraitProblemText({ kind: "invalidReferences", references: [MOUNTAIN, UNIVERSITY], maxThemeLength: 20 }, name, t)).toBe('avatarStyle.portrait.hostTooOld:{"themes":"山城万象、大学风云"}');
  });
  it("ids no host stores, duplicates, none, too many", () => {
    expect(portraitProblemText({ kind: "invalidReferences", references: ["Bad Id"], maxThemeLength: 32 }, name, t)).toBe('avatarStyle.portrait.cannotSave:{"themes":"Bad Id"}');
    expect(portraitProblemText({ kind: "duplicateThemes", references: [MOUNTAIN], maxThemeLength: 32 }, name, t)).toBe('avatarStyle.portrait.duplicate:{"themes":"山城万象"}');
    expect(portraitProblemText({ kind: "emptyThemes", references: [], maxThemeLength: 32 }, name, t)).toBe("avatarStyle.portrait.empty");
    expect(portraitProblemText({ kind: "tooManyThemes", references: Array(129).fill(MOUNTAIN), maxThemeLength: 32 }, name, t)).toBe('avatarStyle.portrait.tooMany:{"n":129}');
  });
});

// Cross-review (peer-review, 2026-11-18): a save in flight captured the style it sent; the owner could still revert or pick
// another while it ran, and its completion held the old style again, which the rename remount then brought back over the
// owner's latest choice. The draft is now tied to its revision (lib/portraitThemeDraft styleDraftRevision).
describe("a save still running when the owner changes the style", () => {
  const deferredPatch = () => {
    let resolve!: (v: ProfileDetail) => void;
    env.api.patchProfile = vi.fn(() => new Promise<ProfileDetail>((r) => (resolve = r)));
    return (v: ProfileDetail) => resolve(v);
  };

  it("撤销 while it runs: the reverted style does not come back after the rename", async () => {
    const resolve = deferredPatch();
    await mount(profile("omega"));
    await pick([MOUNTAIN]);
    rename("omega-race");
    await act(async () => saveButton()!.click());
    const revert = [...container.querySelectorAll("button")].find((b) => b.textContent === "agent-config.profile.revert")!;
    expect(revert.disabled).toBe(false);
    await act(async () => revert.click());
    await act(async () => resolve(profile("omega-race")));
    await mount(profile("omega-race"));
    expect(q("[data-stub-picker]")!.dataset.stubPicker).not.toBe(MOUNTAIN);
    expect(q("[data-portrait-theme-problem]")).toBeNull();
  });

  it("another theme picked while it runs: that newer choice survives the rename, not the one the save captured", async () => {
    const resolve = deferredPatch();
    await mount(profile("omega"));
    await pick([MOUNTAIN]);
    rename("omega-change");
    await act(async () => saveButton()!.click());
    await pick([OFFICE]);
    await act(async () => resolve(profile("omega-change")));
    await mount(profile("omega-change"));
    expect(q("[data-stub-picker]")!.dataset.stubPicker).toBe(OFFICE);
  });

  it("another theme picked while a save without a rename runs: the newer choice stays the draft (not cleared as saved)", async () => {
    const resolve = deferredPatch();
    await mount(profile("omega"));
    // A theme this host stores: the PATCH carries it and is still running when the owner picks again.
    await pick([OFFICE]);
    await act(async () => saveButton()!.click());
    expect(env.api.patchProfile).toHaveBeenCalledWith("omega", expect.objectContaining({ avatarStyle: expect.anything() }));
    await pick([MOUNTAIN]);
    await act(async () => resolve(profile("omega")));
    expect(q("[data-stub-picker]")!.dataset.stubPicker).toBe(MOUNTAIN);
    expect(container.textContent).toContain("agent-config.profile.unsaved");
  });

  it("held drafts stay scoped to their host and stable Profile id", async () => {
    await mount(profile("omega"));
    await pick([MOUNTAIN]);
    await act(async () => saveButton()!.click());
    await mount({ ...profile("other"), id: "p2" });
    expect(q("[data-stub-picker]")!.dataset.stubPicker).not.toBe(MOUNTAIN);
    env.host = "remote";
    await mount(profile("omega"));
    expect(q("[data-stub-picker]")!.dataset.stubPicker).not.toBe(MOUNTAIN);
    env.host = "local";
    await mount(profile("omega"));
    expect(q("[data-stub-picker]")!.dataset.stubPicker).toBe(MOUNTAIN);
  });
});
