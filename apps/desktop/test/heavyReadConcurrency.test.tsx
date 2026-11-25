// @vitest-environment jsdom
// 主机详情 → 高级 → 性能 → 重型读取并发数 (cutex r295, desktop spec 2026-11-25). Acceptance: automatic on two hosts
// with distinct computed values, manual choice, restore default, pending after save, the running number after a
// reconnect, a host without the fields, and a failed save keeping the last confirmed choice.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../src/shared/ipc";

type Heavy = { override: number | null; auto: number; active: number } | null;
const env = vi.hoisted(() => ({
  hosts: new Map<string, Heavy>(),
  failPatch: false,
  owner: true,
  patches: [] as { hostId: string; patch: Record<string, unknown> }[],
}));
const view = (hostId: string): GlobalSettings => {
  const x = env.hosts.get(hostId);
  return (x ? { heavyReadConcurrency: x.override, heavyReadConcurrencyDefault: x.auto, heavyReadConcurrencyActive: x.active, heavyReadConcurrencyOptions: [2, 4, 6, 8] } : {}) as GlobalSettings;
};
vi.mock("../src/renderer/src/bridge", () => ({
  apiFor: (hostId: string) => ({
    getSettings: async () => view(hostId),
    patchSettings: async (patch: Record<string, unknown>) => {
      env.patches.push({ hostId, patch });
      if (env.failPatch) throw new Error("503 settings_store_unavailable");
      const x = env.hosts.get(hostId)!;
      x.override = patch.heavyReadConcurrency as number | null;
      return { ...view(hostId), restartRequired: (x.override ?? x.auto) !== x.active ? ["heavyReadConcurrency"] : [] };
    },
  }),
}));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const useApp = create(() => ({ hosts: { hosts: [{ id: "a", conn: { epoch: 1 } }, { id: "b", conn: { epoch: 1 } }, { id: "old", conn: { epoch: 1 } }] } }));
  return { useApp };
});
vi.mock("../src/renderer/src/lib/hostAccess", () => ({ useHostAccess: () => ({ isOwner: env.owner }) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}${JSON.stringify(vars)}` : key) }) }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Section: ({ title, children }: { title: string; children: ReactNode }) => h("section", null, h("h3", null, title), children),
  SettingRow: ({ label, hint, info, reset, children, agents, readOnly }: { label: string; hint: ReactNode; info: ReactNode; reset: ReactNode; children: ReactNode; agents: string; readOnly?: boolean }) =>
    h("div", { "data-row": label, "data-agents": agents, "data-read-only": readOnly ? "" : undefined }, h("span", { "data-info": "" }, info), h("span", { "data-hint": "" }, hint), reset, children),
  ResetButton: ({ disabled, onClick }: { disabled?: boolean; onClick(): void }) => h("button", { "data-reset": "", disabled, onClick }, "reset"),
  Select: ({ value, options, onChange, disabled }: { value: string; options: { value: string; label: string; group?: string }[]; onChange(v: string): void; disabled?: boolean }) =>
    h("select", { value, disabled, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, options.map((o) => h("option", { key: o.value, value: o.value, "data-group": o.group ?? "" }, o.label))),
}));

const { HeavyReadSection } = await import("../src/renderer/src/components/settings/HeavyReadSection");
const { readHeavyRead } = await import("../src/renderer/src/lib/heavyReadConcurrency");
const { useApp } = await import("../src/renderer/src/store");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  env.hosts = new Map<string, Heavy>([["a", { override: null, auto: 4, active: 4 }], ["b", { override: null, auto: 2, active: 2 }], ["old", null]]);
  env.failPatch = false; env.owner = true; env.patches = [];
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); });

const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };
async function show(hostId: string) { act(() => root.render(h(HeavyReadSection, { hostId }))); await settle(); }
const select = () => node.querySelector("select");
const hint = () => node.querySelector("[data-hint]")?.textContent ?? "";
const reset = () => node.querySelector<HTMLButtonElement>("[data-reset]")!;
async function choose(value: string) {
  const el = select()!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    set.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

describe("heavy-read concurrency row", () => {
  it("automatic on two hosts shows each host's own computed number; switching hosts never keeps the other's", async () => {
    await show("a");
    expect(select()!.value).toBe("auto");
    expect(select()!.options[0]!.textContent).toBe('shell.access.heavyRead.auto{"count":4}');
    expect(hint()).toBe('shell.access.heavyRead.active{"count":4}');
    expect(reset().disabled).toBe(true); // not modified
    await show("b");
    expect(select()!.options[0]!.textContent).toBe('shell.access.heavyRead.auto{"count":2}');
    expect(hint()).toBe('shell.access.heavyRead.active{"count":2}');
    await show("old");
    expect(node.querySelector("[data-row]")).toBeNull(); // older host: no row, nothing of host b left
  });

  it("2 and 4 are plain choices, 6 and 8 under 高级; restart timing; explanation only in the ⓘ", async () => {
    await show("a");
    const groups = [...select()!.options].map((o) => [o.value, o.dataset.group]);
    expect(groups).toEqual([["auto", ""], ["2", ""], ["4", ""], ["6", "shell.access.heavyRead.advancedGroup"], ["8", "shell.access.heavyRead.advancedGroup"]]);
    expect(node.querySelector("[data-row]")!.getAttribute("data-agents")).toBe("hostRestart");
    expect(node.querySelector("[data-info]")!.textContent).toContain("shell.access.heavyRead.help");
    expect(hint()).not.toContain("shell.access.heavyRead.help");
  });

  it("a manual choice saves, shows 主机服务重启后生效 until the service runs it, and is modified", async () => {
    await show("a");
    await choose("6");
    expect(env.patches).toEqual([{ hostId: "a", patch: { heavyReadConcurrency: 6 } }]);
    expect(select()!.value).toBe("6");
    expect(hint()).toContain("settings.scope.agents.hostRestart");
    expect(hint()).toContain('active{"count":4}');
    expect(reset().disabled).toBe(false);
    // The Management service restarted: a reconnect (new epoch) reads the running number again.
    env.hosts.get("a")!.active = 6;
    await act(async () => { useApp.setState({ hosts: { hosts: [{ id: "a", conn: { epoch: 2 } }, { id: "b", conn: { epoch: 1 } }, { id: "old", conn: { epoch: 1 } }] } } as never); });
    await settle();
    expect(hint()).toBe('shell.access.heavyRead.active{"count":6}');
  });

  it("a manual choice equal to the automatic number is still a saved choice (modified, no pending)", async () => {
    await show("a");
    await choose("4");
    expect(select()!.value).toBe("4");
    expect(reset().disabled).toBe(false);
    expect(hint()).not.toContain("settings.scope.agents.hostRestart");
  });

  it("恢复默认 clears the saved choice (null), even when it matches the automatic number", async () => {
    env.hosts.set("a", { override: 4, auto: 4, active: 4 });
    await show("a");
    expect(select()!.value).toBe("4");
    await act(async () => { reset().click(); });
    await settle();
    expect(env.patches.at(-1)).toEqual({ hostId: "a", patch: { heavyReadConcurrency: null } });
    expect(select()!.value).toBe("auto");
    expect(reset().disabled).toBe(true);
  });

  it("a failed save keeps the last confirmed choice and says why", async () => {
    env.hosts.set("a", { override: 2, auto: 4, active: 2 });
    await show("a");
    env.failPatch = true;
    await choose("8");
    expect(select()!.value).toBe("2");
    expect(hint()).toContain("shell.access.heavyRead.saveFailed");
    expect(hint()).toContain("503 settings_store_unavailable");
  });

  it("not the owner: shown read-only, no save", async () => {
    env.owner = false;
    await show("a");
    expect(select()!.disabled).toBe(true);
    expect(node.querySelector("[data-row]")!.hasAttribute("data-read-only")).toBe(true);
  });
});

describe("readHeavyRead", () => {
  it("field detection: absent or incomplete fields hide the row", () => {
    expect(readHeavyRead({} as GlobalSettings)).toBeNull();
    expect(readHeavyRead({ heavyReadConcurrencyDefault: 4, heavyReadConcurrencyActive: 4, heavyReadConcurrencyOptions: [2, 4] } as GlobalSettings)).toBeNull();
    expect(readHeavyRead({ heavyReadConcurrency: null, heavyReadConcurrencyActive: 4, heavyReadConcurrencyOptions: [2, 4] } as GlobalSettings)).toBeNull();
  });
  it("pending = the saved choice (or automatic) differs from the running number", () => {
    const base = { heavyReadConcurrencyDefault: 4, heavyReadConcurrencyActive: 4, heavyReadConcurrencyOptions: [8, 2, 4, 6] };
    expect(readHeavyRead({ ...base, heavyReadConcurrency: null } as GlobalSettings)).toEqual({ override: null, auto: 4, active: 4, options: [2, 4, 6, 8], pending: false });
    expect(readHeavyRead({ ...base, heavyReadConcurrency: 6 } as GlobalSettings)!.pending).toBe(true);
    expect(readHeavyRead({ ...base, heavyReadConcurrency: null, heavyReadConcurrencyActive: 6 } as GlobalSettings)!.pending).toBe(true);
  });
});
