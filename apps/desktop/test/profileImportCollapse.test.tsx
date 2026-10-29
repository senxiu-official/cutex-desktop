// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CcSwitchImportList } from "../src/shared/ccSwitchImport";

const env = vi.hoisted(() => ({ features: new Set(["profile-import-cc-switch"]), read: vi.fn(), write: vi.fn() }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({ ...(await importOriginal<object>()),
  useTargetHostId: () => "remote", useFocusHostId: () => "local",
  daemonApiOf: () => ({ ccSwitchImportList: env.read, ccSwitchImport: env.write }),
}));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostData: () => ({ daemon: { kind: "connected" }, features: env.features }) }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ loadProfileList: vi.fn().mockResolvedValue(null) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => vars ? `${key} ${JSON.stringify(vars)}` : key }) }));
import { ProfileImportSection } from "../src/renderer/src/modules/profile-import/ProfileImportSection";
import { ProfileImport, resetCcSwitchListCache } from "../src/renderer/src/components/ProfileImport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
const list: CcSwitchImportList = {
  found: true, source: { path: "/remote/.cc-switch/store.db", format: "sqlite", schemaVersion: 5 }, error: null,
  providers: ["one", "two"].map((id, index) => ({ id, app: index === 0 ? "claude" : "codex", name: id, baseUrl: null, model: "gpt", hasKey: true, supported: true, reason: null, current: false, existingProfile: null })),
};
beforeEach(() => {
  sessionStorage.clear(); resetCcSwitchListCache(); env.features = new Set(["profile-import-cc-switch"]);
  env.read.mockReset().mockResolvedValue(structuredClone(list)); env.write.mockReset().mockResolvedValue({ created: [], failed: [] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const mount = async () => { await act(async () => root.render(h(ProfileImportSection))); };

it("shows an independent titled section with a session-collapsed provider card and status beside the title", async () => {
  await mount();
  const section = host.querySelector("section")!;
  const title = section.querySelector("h3")!;
  expect(title.textContent).toBe("profile-import.section");
  expect(section.textContent).toContain("profile-import.sectionHint");
  expect(host.querySelector("[data-settings-disclosure]")).toBeNull();
  const status = section.querySelector("[data-profile-import-status]")!;
  expect(status.textContent).toContain('profile-import.summary.count {"total":2,"available":2}');
  // Beside the title in the card header (its controls group, which wraps below the title when narrow).
  expect(title.closest("[data-settings-card-head]")!.contains(status)).toBe(true);
  // The card-level marker sits inline with the title (the header's title group).
  const marker = section.querySelector('[data-settings-agents="newAgents"]')!;
  expect(title.closest("[data-settings-card-title]")!.contains(marker)).toBe(true);
  expect(section.querySelector(".group\\/card [data-effect-markers]")).toBeNull();
  expect(env.read).toHaveBeenCalledTimes(1); expect(env.write).not.toHaveBeenCalled();
  const toggle = title.querySelector<HTMLButtonElement>("button")!;
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(panel.closest("[hidden]")).not.toBeNull();
  expect(status.closest("[hidden]")).toBeNull();
  act(() => toggle.click());
  expect(panel.closest("[hidden]")).toBeNull();
  const boxes = section.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(boxes).toHaveLength(2);
  expect(section.querySelectorAll("[data-cc-switch-app]")).toHaveLength(2);
  act(() => boxes[0]!.click()); expect(boxes[0]!.checked).toBe(false);
  act(() => toggle.click());
  expect(panel.closest("[hidden]")).not.toBeNull();
  act(() => toggle.click());
  await mount();
  expect(section.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]!.checked).toBe(false);
  expect(env.read).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("/remote/.cc-switch/store.db");
});

it("shows loading then missing-source status in the section header", async () => {
  let resolve!: (value: CcSwitchImportList) => void;
  env.read.mockReturnValue(new Promise<CcSwitchImportList>((done) => { resolve = done; }));
  await mount();
  expect(host.querySelector("[data-profile-import-status]")!.textContent).toContain("profile-import.summary.loading");
  await act(async () => resolve({ found: false, source: null, error: null, providers: [] }));
  expect(host.querySelector("[data-profile-import-status]")!.textContent).toContain("profile-import.notFound");
  expect(host.querySelector("[data-settings-disclosure]")).toBeNull(); expect(env.write).not.toHaveBeenCalled();
});

it("shows a failed-read status and keeps retry immediately available", async () => {
  env.read.mockRejectedValue(new Error("offline")); await mount();
  const status = host.querySelector("[data-profile-import-status]")!;
  expect(status.textContent).toContain("profile-import.summary.error");
  expect(status.classList.contains("text-warn")).toBe(true);
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "profile-import.reload")).toBe(true);
  expect(host.querySelector("[data-settings-disclosure]")).toBeNull();
  expect(env.read).toHaveBeenCalledTimes(1); expect(env.write).not.toHaveBeenCalled();
});

it("keeps capability gates and the onboarding's existing expanded layout", async () => {
  env.features.clear(); await mount();
  expect(host.querySelector("[data-settings-disclosure]")).toBeNull(); expect(env.read).not.toHaveBeenCalled();
  env.features.add("profile-import-cc-switch");
  await act(async () => root.render(h(ProfileImport, { hostId: "remote", compact: true })));
  expect(host.querySelector("[data-settings-disclosure]")).toBeNull();
  expect(host.querySelectorAll("[data-cc-switch-row]")).toHaveLength(2);
});


it("updates the header count after importing and rereading the provider list", async () => {
  await mount();
  env.read.mockResolvedValue({ ...structuredClone(list), providers: [list.providers[0]!] });
  env.write.mockResolvedValue({ created: [{ app: "claude", id: "one", profile: { id: "imported", name: "Imported" } }], failed: [] });
  const runImport = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.startsWith("profile-import.import "))!;
  await act(async () => runImport.click());
  expect(env.read).toHaveBeenCalledTimes(2);
  expect(host.querySelector("[data-profile-import-status]")!.textContent).toContain('profile-import.summary.count {"total":1,"available":1}');
  expect(host.querySelectorAll("[data-cc-switch-row]")).toHaveLength(1);
});


it("remembers expanded and collapsed state across remounts within this session", async () => {
  await mount();
  let toggle = host.querySelector<HTMLButtonElement>("h3 button[aria-expanded]")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  act(() => toggle.click());
  expect(sessionStorage.getItem("cutex-desktop.profile-import.open:remote")).toBe("1");
  act(() => root.render(null));
  await mount();
  toggle = host.querySelector<HTMLButtonElement>("h3 button[aria-expanded]")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  act(() => toggle.click());
  act(() => root.render(null));
  await mount();
  expect(host.querySelector("h3 button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("false");
  expect(env.read).toHaveBeenCalledTimes(1);
});
