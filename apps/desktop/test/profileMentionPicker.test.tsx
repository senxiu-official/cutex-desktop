// @vitest-environment jsdom
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileItem, ProfileModelsView } from "../src/shared/ipc";
import { AT_GROUP_ROWS, atAgentRows, useProfileMentions } from "../src/renderer/src/lib/useProfileMentions";
import { agentMentionCandidates, type MentionHost } from "../src/renderer/src/lib/composerAgentMentions";
import { setUiPref } from "../src/renderer/src/lib/prefs";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { profileMentionText } from "../src/renderer/src/lib/profileMentions";
import { mentionAt } from "../src/renderer/src/lib/slashCommands";
import { profileMentionModelChoices } from "../src/renderer/src/lib/profileMentionModels";
import { en } from "../src/renderer/src/lib/agentMentionMessages";
const mocks = vi.hoisted(() => ({ list: vi.fn(), models: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: (host: string) => ({ profileModels: (id: string) => mocks.models(host, id) }) }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ cachedProfile: () => null, cachedProfileList: () => null, loadProfileList: (host: string) => mocks.list(host) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t }) }));
const t = ((key: string) => en[key as keyof typeof en] ?? key) as Parameters<typeof profileMentionModelChoices>[3];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const profile = { id: "Ada", name: "Ada", cliKind: "codex", model: "gpt-6-sol" } as ProfileItem;
const catalog = { profile: { id: profile.id, name: profile.name }, selectedModel: "gpt-6-sol", models: [{ id: "gpt-6-sol", displayName: "Sol" }, { id: "gpt-6-astra", displayName: "Astra" }], discovery: { models: ["gpt-6-luna"] } } as ProfileModelsView;
const features = new Set<string>();
let root: Root, element: HTMLDivElement, result: ReturnType<typeof useProfileMentions>, draft: string;
let setDraft: (text: string) => void;
function Harness({ host = "one", initial = "p@" }: { host?: string; initial?: string }) {
 const [text, setText] = useState(initial), [caret, setCaret] = useState(initial.length);
 draft = text; setDraft = value => { setText(value); setCaret(value.length); };
 result = useProfileMentions({ text, caret, hostId: host, sessionId: "agent", currentProfile: profile.id, runtime: "codex", features, enabled: true, onChange: (value, at) => { setText(value); setCaret(at); }, focusAt: () => {} });
 return null;
}
async function render(host = "one", initial = "p@") { await act(async () => { root.render(h(Harness, { host, initial })); }); }
async function change(text: string) { await act(async () => { setDraft(text); }); }
beforeEach(() => { element = document.createElement("div"); document.body.append(element); root = createRoot(element); mocks.list.mockReset().mockResolvedValue({ defaultProfile: profile.id, profiles: [profile] }); mocks.models.mockReset().mockResolvedValue(catalog); });
afterEach(() => { act(() => root.unmount()); element.remove(); });
it("keeps both steps open through empty filtering and picks a combined atom", async () => {
 await render(); expect(result.rows.map(r => r.label)).toEqual(["Ada"]);
 await change("p@no-match"); expect(result.open).toBe(true); expect(result.rows).toHaveLength(0);
 await change("p@Ada"); await act(async () => result.pick(0));
 expect(draft).toBe(profileMentionText(profile.id)); expect(result.cascade).toBe(true);
 expect(result.rows.map(r => r.model?.id)).toEqual(["gpt-6-sol", "gpt-6-astra", "gpt-6-luna"]);
 await change(draft + "zzzz"); expect(result.open).toBe(true); expect(result.rows).toHaveLength(0);
 expect(result.sendText()).toBe(profileMentionText(profile.id));
 await change(profileMentionText(profile.id) + "ast"); expect(result.rows).toHaveLength(1);
 await act(async () => result.pick(0)); expect(draft).toBe(profileMentionText(profile.id, "gpt-6-astra") + " "); expect(result.open).toBe(false);
});
it.each([false, true])("explicit exit drops the model filter (space=%s)", async space => {
 await render(); await act(async () => result.pick(0)); await change(draft + "no-match");
 await act(async () => result.exit(space));
 expect(draft).toBe(profileMentionText(profile.id) + (space ? " " : "")); expect(result.open).toBe(false);
});
it("pasted whitespace exits and preserves text after the space", async () => {
 await render(); await act(async () => result.pick(0)); const raw = draft;
 await act(async () => result.change(raw + "ast next", raw.length + 8));
 expect(draft).toBe(raw + " next"); expect(result.open).toBe(false);
});
it("m@ uses the current profile catalog and creates model-only text", async () => {
 await render("one", "m@ast"); expect(result.rows.map(r => r.model?.id)).toEqual(["gpt-6-astra"]);
 await act(async () => result.pick(0)); expect(draft).toBe(profileMentionText(null, "gpt-6-astra") + " ");
 expect(mocks.models).toHaveBeenCalledWith("one", "Ada");
});
it("ignores late model results from a previous host", async () => {
 let resolve!: (value: ProfileModelsView) => void;
 mocks.models.mockImplementation((host: string) => host === "one" ? new Promise<ProfileModelsView>(done => { resolve = done; }) : Promise.resolve({ ...catalog, models: [{ id: "other-host-model" }], selectedModel: "other-host-model", discovery: null }));
 await render("one", "m@"); await render("two", "m@");
 await act(async () => resolve(catalog));
 expect(result.rows.map(r => r.model?.id)).toEqual(["other-host-model"]);
});
it("includes defaults/discovery without duplicate or invented model IDs", () => {
 expect(profileMentionModelChoices(profile, catalog, features, t).map(r => [r.id, r.isDefault])).toEqual([["gpt-6-sol", true], ["gpt-6-astra", false], ["gpt-6-luna", false]]);
 expect(profileMentionModelChoices({ ...profile, model: null }, null, features, t)).toEqual([{ id: null, name: "Profile default model", isDefault: true, efforts: [], defaultEffort: null }]);
});

it("uses the current runtime variant catalog and default for model-only references", () => {
 const variant = { id: "kimi", runtime: "kimi", primary: false, defaults: { model: "kimi-k3" }, models: [{ id: "kimi-k3" }, { id: "kimi-k3-fast" }] };
 const multi = { ...profile, runtimeVariants: [variant], defaultVariant: "kimi" } as ProfileItem;
 expect(profileMentionModelChoices(multi, catalog, new Set(["profile-runtime-variants"]), t, "kimi").map(row => row.id)).toEqual(["kimi-k3", "kimi-k3-fast"]);
});

async function enterEfforts(initial = "p@") {
 mocks.models.mockResolvedValue({ ...catalog, models: catalog.models.map(model => model.id === "gpt-6-astra" ? { ...model, supportedReasoningEfforts: ["low", "high", "adaptive-custom"], defaultReasoningEffort: "high" } : model) });
 await render("one", initial);
 if (initial === "p@") { await act(async () => result.pick(0)); await change(draft + "ast"); }
 await act(async () => result.pick(0));
}
it("offers daemon-defined efforts with an unspecified default first; default selection adds nothing", async () => {
 await enterEfforts();
 expect(result.effortStep).toBe(true);
 expect(result.rows.map(row => row.effort?.id)).toEqual([null, "low", "high", "adaptive-custom"]);
 expect(draft).toBe(profileMentionText(profile.id, "gpt-6-astra"));
 await act(async () => result.pick(0));
 expect(draft).toBe(profileMentionText(profile.id, "gpt-6-astra") + " "); expect(result.open).toBe(false);
});
it("keeps empty effort results open and serializes an explicit daemon-defined effort as one atom", async () => {
 await enterEfforts(); const raw = draft;
 await change(raw + "no-match"); expect(result.open).toBe(true); expect(result.rows).toHaveLength(0);
 expect(result.sendText()).toBe(raw);
 await change(raw + "custom"); expect(result.rows.map(row => row.effort?.id)).toEqual(["adaptive-custom"]);
 await act(async () => result.pick(0));
 expect(draft).toBe(profileMentionText(profile.id, "gpt-6-astra", "adaptive-custom") + " "); expect(result.open).toBe(false);
});
it.each([false, true])("effort exit keeps profile and model (space=%s)", async space => {
 await enterEfforts(); const raw = draft; await change(raw + "no-match");
 await act(async () => result.exit(space)); expect(draft).toBe(raw + (space ? " " : "")); expect(result.open).toBe(false);
});
it("model-only references also offer effort and explicit values filter separately from the default", async () => {
 await enterEfforts("m@ast"); const raw = draft;
 await change(raw + "high"); expect(result.rows.map(row => row.effort?.id)).toEqual(["high"]);
 await act(async () => result.pick(0)); expect(draft).toBe(profileMentionText(null, "gpt-6-astra", "high") + " ");
});
it("reads model capabilities without a hard-coded effort fallback", () => {
 const rows = profileMentionModelChoices(profile, { ...catalog, models: [{ ...catalog.models[0]!, supportedReasoningEfforts: ["adaptive-custom"], defaultReasoningEffort: "adaptive-custom" }] }, features, t);
 expect(rows[0]).toMatchObject({ efforts: ["adaptive-custom"], defaultEffort: "adaptive-custom" });
 expect(profileMentionModelChoices(profile, catalog, features, t).every(row => row.efforts.length === 0)).toBe(true);
});

describe("plain @: the profile group beside the agents", () => {
 const more = ["Zeta", "beta", "Gamma", "delta", "Eta", "alpha"].map(name => ({ ...profile, id: `id-${name}`, name }));
 let atResult: ReturnType<typeof useProfileMentions>, atDraft: string;
 function AtHarness({ initial, enabled = true }: { initial: string; enabled?: boolean }) {
  const [text, setText] = useState(initial), [caret, setCaret] = useState(initial.length);
  atDraft = text;
  // The Composer's own trigger (lib/slashCommands mentionAt): word starts only.
  atResult = useProfileMentions({ at: mentionAt(text, caret), text, caret, hostId: "remote", sessionId: "agent", currentProfile: null, runtime: "codex", features, enabled,
   onChange: (value, next) => { setText(value); setCaret(next); }, focusAt: () => {} });
  return null;
 }
 it("lists the conversation host's profiles by name, at most AT_GROUP_ROWS, and filters them with the agents' query", async () => {
  mocks.list.mockResolvedValue({ defaultProfile: null, profiles: [profile, ...more] });
  await act(async () => { root.render(h(AtHarness, { initial: "hi @" })); });
  expect(mocks.list).toHaveBeenCalledWith("remote");
  expect(atResult.open).toBe(false);
  expect(atResult.atRows.map(r => r.label)).toEqual(["Ada", "alpha", "beta", "delta", "Eta"].slice(0, AT_GROUP_ROWS));
  expect(atResult.atTotal).toBe(7);
  await act(async () => { root.render(h(AtHarness, { key: "q", initial: "hi @ta" })); });
  expect(atResult.atRows.map(r => r.label)).toEqual(["beta", "delta", "Eta", "Zeta"]);
 });
 it("profile rows follow the owner's name order (Settings → 名字分组), like the agent rows", async () => {
  const names = ["zed", "张三", "bob", "Alice", "李四"].map(name => ({ ...profile, id: `id-${name}`, name }));
  mocks.list.mockResolvedValue({ defaultProfile: null, profiles: names });
  try {
   setUiPref("nameGrouping", "letter"); setUiPref("nameReading", "zh");
   await act(async () => { root.render(h(AtHarness, { key: "letter", initial: "hi @" })); });
   expect(atResult.atRows.map(r => r.label)).toEqual(["Alice", "bob", "李四", "zed", "张三"]);
   setUiPref("nameGrouping", "script");
   await act(async () => { root.render(h(AtHarness, { key: "script", initial: "hi @" })); });
   expect(atResult.atRows.map(r => r.label)).toEqual(["Alice", "bob", "zed", "李四", "张三"]);
  } finally { setUiPref("nameGrouping", null); setUiPref("nameReading", null); }
 });
 it("with a profile group the agents show AT_GROUP_ROWS of more than that; without one, all of them", () => {
  const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, runtime: { status: "online" }, visible: true, lifecycle: "active" }) as SessionResource;
  const names = ["Ada", "Bo", "Cy", "Dee", "Eli", "Fay", "Gus", "Hal"];
  const sessions = [session("cutex.ag-self", "Self"), ...names.map(name => session(`cutex.ag-${name.toLowerCase()}`, name))];
  const host: MentionHost = { id: "local", label: "local", connected: true, sidebar: { active: sessions, retired: [], projects: null, hostRows: {} } as unknown as SidebarSnapshot };
  const agents = agentMentionCandidates([host], "local", "cutex.ag-self", "");
  expect(agents).toHaveLength(8);
  const grouped = atAgentRows(agents, 2);
  expect(grouped.shown.map(a => a.label)).toEqual(names.slice(0, AT_GROUP_ROWS));
  expect(grouped).toMatchObject({ total: 8, cut: true });
  expect(atAgentRows(agents, 0)).toMatchObject({ shown: agents, total: 8, cut: false });
  expect(atAgentRows(agents.slice(0, 3), 2)).toMatchObject({ total: 3, cut: false });
 });
 it("picking a profile row replaces the @ text and continues the model cascade", async () => {
  await act(async () => { root.render(h(AtHarness, { initial: "ask @Ada" })); });
  await act(async () => atResult.pickAt(0));
  expect(atDraft).toBe("ask " + profileMentionText(profile.id));
  expect(atResult.cascade).toBe(true);
  expect(atResult.rows.map(r => r.model?.id)).toEqual(["gpt-6-sol", "gpt-6-astra", "gpt-6-luna"]);
  expect(atResult.atRows).toEqual([]);
 });
 it("no profile group when the list cannot be read, or the picker is disabled (agents only, as before)", async () => {
  mocks.list.mockRejectedValue(new Error("offline"));
  await act(async () => { root.render(h(AtHarness, { initial: "@" })); });
  expect(atResult.atRows).toEqual([]);
  mocks.list.mockResolvedValue({ defaultProfile: null, profiles: [profile] });
  await act(async () => { root.render(h(AtHarness, { key: "off", initial: "@", enabled: false })); });
  expect(atResult.atRows).toEqual([]);
 });
 it("leaves `ap@x.com` and mid-word @ alone", async () => {
  await act(async () => { root.render(h(AtHarness, { initial: "mail ap@x.com" })); });
  expect(atResult.atRows).toEqual([]); expect(atResult.open).toBe(false);
 });
});
