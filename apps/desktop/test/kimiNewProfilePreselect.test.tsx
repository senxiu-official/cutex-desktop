// @vitest-environment jsdom
// Kimi accounts → 用这个账户新建 Profile (r266c): the button opens the new-Profile form on the Kimi provider with that
// account chosen (store openSettings `kimiAccount`), not the default ChatGPT provider with nothing picked.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { KimiAccount } from "../src/shared/kimiAccounts";

const account: KimiAccount = { id: "ka-work", label: "Work", kind: "subscription", region: "mainland-cn", home: null, createdAt: null, credentialsPresent: true, status: null, login: null, models: [], profiles: [], sessions: { active: 0, online: 0, retired: 0 }, removable: true };
const other: KimiAccount = { ...account, id: "ka-home", label: "Home" };
const fx = vi.hoisted(() => ({ features: new Set<string>(["profile-runtime-variants", "profile-create", "kimi-runtime-profiles", "kimi-accounts"]) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => key + (vars ? JSON.stringify(vars) : ""), locale: "en" }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (original) => ({ ...(await original<object>()), useTargetApi: () => ({}), useTargetHostId: () => "local", useTargetFeatures: () => fx.features }));
vi.mock("../src/renderer/src/lib/useProfilePresets", () => ({ useProfilePresets: () => [] }));
vi.mock("../src/renderer/src/lib/componentView", () => ({ useComponentState: () => ({ state: { kind: "body" }, entry: { list: null, refusal: null } }) }));
vi.mock("../src/renderer/src/components/ComponentCard", () => ({ ComponentNotice: () => null }));
vi.mock("../src/renderer/src/components/settings/ProfileClaudeAccount", () => ({ NewClaudeAccountRow: () => null }));
vi.mock("../src/renderer/src/lib/useClaudeAccountList", () => ({ useClaudeAccountList: () => ({ list: null, loadError: null, load: vi.fn() }) }));
vi.mock("../src/renderer/src/modules/react", async (original) => ({ ...(await original<object>()), useSlot: () => [] }));
vi.mock("../src/renderer/src/lib/kimiAccounts", async (original) => ({ ...(await original<object>()), useKimiAccountList: () => ({ list: [other, account], loadError: null, load: vi.fn() }) }));
const { useApp } = await import("../src/renderer/src/store");
const { useSettingsShelf } = await import("../src/renderer/src/lib/settingsShelf");
const { NewProfileVariantsForm } = await import("../src/renderer/src/components/settings/NewProfileVariantsForm");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("openSettings carries the Kimi account to the new-Profile page", () => {
  useApp.getState().openSettings("profiles", { create: true, kimiAccount: "ka-work" });
  expect(useSettingsShelf.getState().params).toMatchObject({ tab: "profiles", create: "1" });
  expect(useApp.getState().settingsFocus).toMatchObject({ kimiAccount: "ka-work" });
});

it("the form opens on the Kimi provider with that account chosen", () => {
  act(() => root.render(h(NewProfileVariantsForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn(), initialKimiAccount: "ka-work" })));
  const select = host.querySelector<HTMLSelectElement>("[data-kimi-account-select] select");
  expect(select?.value).toBe("ka-work");
  expect(host.querySelector('[data-variant-choice="kimi"]')).toBeTruthy();
  expect(host.querySelector('[data-provider-chosen="kimi"] [data-experimental-runtime="kimi"]')).toBeTruthy();
  expect(host.querySelector('[data-auth-option="kimiAccount"] [data-experimental-runtime="kimi"]')).toBeTruthy();
  expect(host.querySelector('[data-variant-choice="kimi"] [data-experimental-runtime="kimi"]')?.getAttribute("title")).toContain("creation.experimentalHint");
  expect(host.querySelector('[data-experimental-runtime="dsh"]')).toBeNull();
});

it("without an account the form keeps its ChatGPT default and no Kimi account is chosen", () => {
  act(() => root.render(h(NewProfileVariantsForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn() })));
  expect(host.querySelector("[data-kimi-account-select]")).toBeNull();
});
