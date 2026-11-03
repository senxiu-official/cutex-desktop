// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CatalogModel, ProfileDetail, ProfileModelsView } from "../src/shared/ipc";

const env = vi.hoisted(() => ({ features: new Set<string>(), api: {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/targetHost", async original => ({
  ...(await original<object>()),
  useTargetFeatures: () => env.features, useTargetHostId: () => "host", useTargetApi: () => env.api,
  useTargetLoadQuota: () => vi.fn(), useTargetQuotas: () => ({}),
}));
vi.mock("../src/renderer/src/lib/modelDisplay", async (importOriginal) => ({
  ...(await importOriginal<object>()), useModelName: () => (id: string) => id,
  modelLabel: (id: string) => id, updateProfileModelNames: () => {},
}));
import { ProfileModelFields } from "../src/renderer/src/components/settings/ProfileModelFields";
import { ProfileModelDialog } from "../src/renderer/src/components/settings/ProfileModelDialog";
import { ModelList } from "../src/renderer/src/components/settings/ProfileModels";
import { OfficialQuotaSection, QuotaConfigSection } from "../src/renderer/src/components/settings/ProfileQuota";
import { Section, SettingsPage, SettingRow } from "../src/renderer/src/components/settings/Form";
import { ProfileToolFields } from "../src/renderer/src/components/settings/ProfileToolFields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  env.features.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const model = { id: "m", displayName: null, inputModalities: ["text"], supportedReasoningEfforts: ["low"], defaultReasoningEffort: "low", effective: { contextWindow: null, contextWindowSource: "unknown", autoCompactTokenLimit: null, autoCompactTokenLimitSource: "unknown" } } as CatalogModel;
const view: ProfileModelsView = { profile: { id: "p", name: "P" }, catalogSupported: true, catalogPresent: true, selectedModel: "m", profileOverrides: { modelContextWindow: null, modelAutoCompactTokenLimit: null }, discovery: null, models: [model], unsupportedModelFields: [], precedence: null };
const detail = { id: "p", cliKind: "codex", detail: { editable: { model: true, modelReasoningEffort: true, modelReasoningSummary: true, modelContextWindow: true, modelAutoCompactTokenLimit: true, updatePlanEnabled: true, webSearch: true, searchTool: true } } } as unknown as ProfileDetail;
const chips = (element: Element) => [...element.querySelectorAll("button[data-settings-agents]")].map(button => button.getAttribute("aria-label"));
const headerChips = (element: Element) => [...element.querySelectorAll('button[data-timing-presentation="header"]')].map(button => button.getAttribute("aria-label"));
const row = (element: Element, key: string) => [...element.querySelectorAll("[data-setting-row]")].find((r) => r.textContent?.startsWith(key))!;

it("states uniform Profile model timing once at page level", () => {
  act(() => root.render(h(SettingsPage, { page: "profiles", children: h(Section, { title: "Models", children: h(ProfileModelFields, { detail, models: view, cfg: { model: "m" }, set: vi.fn() }) }) })));
  expect(headerChips(host)).toEqual(["settings.scope.agents.next"]);
  expect(host.querySelector('section button[data-timing-presentation="header"]')).toBeNull();
  for (const name of ["model", "effort", "reasoningSummary", "contextWindow", "autoCompact"]) {
    expect(chips(row(host, `agent-config.profile.${name}`))).toEqual([]);
  }
});

it("keeps catalog draft metadata but omits per-field settings badges in the model dialog", () => {
  act(() => root.render(h(ProfileModelDialog, { model, profile: "p", view, names: true, onSaved: vi.fn(), onClose: vi.fn() })));
  const dialog = document.querySelector("dialog")!;
  expect(headerChips(dialog)).toEqual([]);
  for (const name of ["contextWindow", "maxContextWindow", "autoCompact", "vision", "efforts", "defaultEffort"]) {
    expect(chips(row(dialog, `agent-config.profile.${name}`))).toEqual([]);
    expect(row(dialog, `agent-config.profile.${name}`).getAttribute("data-effect-timing")).toBe("next");
  }
  const names = row(dialog, "agent-config.profile.displayName");
  expect(chips(names)).toEqual([]);
  expect(names.getAttribute("data-effect-timing")).toBe("none");
  expect(dialog.querySelector("[data-effect-markers]")).toBeNull();
  expect(dialog.textContent).not.toContain("agent-config.profile.appliesNext");
});

it("retains timing chip popovers inside a modal when it contains actual settings", () => {
  act(() => root.render(h("dialog", { open: true }, h(SettingRow, { label: "Persistent setting", agents: "none", source: "host", children: "Value" }))));
  const dialog = host.querySelector("dialog")!;
  const marker = dialog.querySelector<HTMLButtonElement>('[data-settings-agents="none"]')!;
  act(() => marker.click());
  // Portaled into the modal <dialog> (the top layer), not the body, so it shows above the dialog.
  const note = document.getElementById(marker.getAttribute("aria-controls")!)!;
  expect(note.textContent).toContain("settings.scope.agents.none.body");
  expect(note.parentElement).toBe(dialog);
});

it("does not label a name-only catalog editor as changing runtime configuration", () => {
  act(() => root.render(h(ProfileModelDialog, { model, profile: "p", view, catalog: false, names: true, onSaved: vi.fn(), onClose: vi.fn() })));
  const dialog = document.querySelector("dialog")!;
  expect(chips(dialog)).toEqual([]);
  expect(dialog.querySelectorAll('[data-form-field][data-effect-timing="none"]')).toHaveLength(2);
});

it("labels the catalog control once for runtime or display-only edits", () => {
  act(() => root.render(h(ModelList, { profile: "p", view, setView: vi.fn() })));
  expect(chips(row(host, "settings.profileIa.catalogOverrides"))).toEqual(["settings.scope.agents.next"]);
  act(() => root.render(h(ModelList, { profile: "p", view: { ...view, catalogSupported: false }, setView: vi.fn() })));
  expect(chips(row(host, "settings.profileIa.catalogOverrides"))).toEqual([]);
});

it("never marks read-only current quota or official quota results", () => {
  act(() => root.render(h(SettingsPage, { page: "profiles", children: h(QuotaConfigSection, { profile: "p", draft: null, setDraft: vi.fn() }) })));
  expect(headerChips(host)).toEqual([]);
  for (const row of host.querySelectorAll("[data-setting-row]")) expect(chips(row)).toEqual([]);
  act(() => root.render(h(SettingsPage, { page: "profiles", children: h(OfficialQuotaSection, { profile: "p", claude: false }) })));
  expect(headerChips(host)).toEqual([]);
  for (const row of host.querySelectorAll("[data-setting-row]")) expect(chips(row)).toEqual([]);
});

it("marks built-in native tool config next while preserving capability gates", () => {
  act(() => root.render(h(ProfileToolFields, { detail, cfg: {}, set: vi.fn() })));
  expect(chips(row(host, "agent-config.profile.updatePlan"))).toEqual(["settings.scope.agents.next"]);
  expect(chips(row(host, "agent-config.profile.webSearch"))).toEqual(["settings.scope.agents.next"]);
  expect(chips(row(host, "agent-config.profile.searchTool"))).toEqual(["settings.scope.agents.offNowOnNext"]);
  expect(row(host, "agent-config.profile.searchTool").textContent).not.toContain("settings.profileTiming.searchTool");
  act(() => root.render(h(ProfileToolFields, { detail: { detail: {} } as ProfileDetail, cfg: {}, set: vi.fn() })));
  expect(chips(host)).toEqual([]);
});

it("reports mixed timing at page level, shows row icons, and keeps the coupled search edit", () => {
  const set = vi.fn();
  act(() => root.render(h(SettingsPage, { page: "profiles", children: h(Section, { title: "Tools", children: [
    h(ProfileToolFields, { key: "native", detail, cfg: { webSearch: "live" }, set, part: "native" }),
    h(ProfileToolFields, { key: "host", detail, cfg: { webSearch: "live" }, set, part: "search" }),
  ] }) })));
  expect(headerChips(host)).toEqual(["settings.scope.agents.mixed"]);
  expect(host.querySelector('section button[data-timing-presentation="header"]')).toBeNull();
  expect(chips(row(host, "agent-config.profile.updatePlan"))).toEqual(["settings.scope.agents.next"]);
  const search = row(host, "agent-config.profile.searchTool");
  expect(chips(search)).toEqual(["settings.scope.agents.offNowOnNext"]);
  expect(host.querySelector("[data-settings-timing-group]")).toBeNull();
  act(() => search.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(set).toHaveBeenCalledWith({ searchTool: true, webSearch: "disabled" });
});
