// @vitest-environment jsdom
// The settings rules of docs/design/settings-rules.md (owner 2026-11-28 sweep), enforced where they are structural:
// one host picker per page (in the header), a stated host never repeated by a card, the label line keeping markers and
// 恢复默认 in its own flow, list-row provenance from one rule.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ state: { daemon: { kind: "disconnected" }, hosts: { active: "local", hosts: [{ id: "local", label: "HOST-A" }] } } as Record<string, unknown> }));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));

const { ResetButton, Section, SettingsPage, SettingRow } = await import("../src/renderer/src/components/settings/Form");
const { SKILL_ORIGINS, pluginShortName, skillArchivable, skillOrigin } = await import("../src/renderer/src/lib/skillOrigin");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (node: React.ReactNode) => act(() => root.render(node));
const card = (title: string, source: "local" | "host" | "codex") => h(Section, { key: title, title, children: h(SettingRow, { label: title, agents: "none", source }) });
const section = (title: string) => [...container.querySelectorAll("section")].find((s) => s.querySelector("h3")?.textContent?.startsWith(title))!;
const tags = (el: Element) => [...el.querySelectorAll("[data-effect-scope-marker]")].map((m) => m.textContent);

describe("a page header's host switcher states the host once", () => {
  const picker = h("button", { "data-test-picker": "" }, "HOST-A ▾");

  it("puts the one picker first in the header; cards on that host never repeat it", () => {
    render(h(SettingsPage, { host: picker, hostId: "local", children: [card("Sync", "host"), card("Installed", "codex"), card("Installed 2", "codex"), card("This desktop", "local")] }));
    expect(container.querySelectorAll("[data-test-picker]")).toHaveLength(1);
    expect(container.querySelector("[data-settings-header] [data-settings-header-host] [data-test-picker]")).not.toBeNull();
    // The most common place on the stated host goes in the header, without the host's name.
    expect(tags(container.querySelector("[data-settings-header]")!)).toEqual(["settings.scope.codex.short"]);
    // The card in that place: no tag. Another place on the same host: its place only. Elsewhere: its full place.
    expect(tags(section("Installed"))).toEqual([]);
    expect(tags(section("Sync"))).toEqual(["settings.scope.host.short"]);
    expect(tags(section("This desktop"))).toEqual(["settings.scope.local.label"]);
    // Nowhere on the page a 「主机 · HOST」 tag (the full label names the host).
    expect(container.textContent).not.toContain("settings.scope.host.label");
    expect(container.textContent).not.toContain("settings.scope.codex.label");
  });

  it("a one-place host page: header 「HOST ▾ 主机」 and no card tags", () => {
    render(h(SettingsPage, { host: picker, hostId: "local", children: [card("A", "host"), card("B", "host")] }));
    expect(tags(container.querySelector("[data-settings-header]")!)).toEqual(["settings.scope.host.short"]);
    expect(tags(section("A"))).toEqual([]);
    expect(tags(section("B"))).toEqual([]);
  });

  it("without a picker the host is named in full, as before", () => {
    render(h(SettingsPage, { children: [card("A", "host")] }));
    expect(tags(container)).toEqual(["settings.scope.host.label"]);
  });
});

describe("the label line", () => {
  it("keeps effect markers and 恢复默认 in the label's flow, whatever the label holds", () => {
    // ThreadDefaults once passed a block-level flex span: the marker went onto a line of its own.
    render(h(SettingsPage, { children: h(Section, { title: "Card", children: [
      h(SettingRow, { key: "a", label: h("span", { className: "flex" }, "Sandbox"), agents: "next", source: "local", reset: h(ResetButton, { onClick: () => {} }) }, h("button", {}, "control")),
      h(SettingRow, { key: "b", label: "Approval", agents: "now", source: "host" }, h("button", {}, "control")),
    ] }) }));
    for (const row of container.querySelectorAll("[data-setting-row]")) {
      const line = row.querySelector("[data-setting-label-line]")!;
      expect(line.className).toMatch(/\bflex\b/);
      expect(line.className).toMatch(/\bflex-wrap\b/);
      const marker = row.querySelector("[data-effect-markers]");
      if (marker) expect(marker.parentElement).toBe(line);
    }
    const restore = container.querySelector("[data-setting-restore]")!;
    expect(restore.parentElement?.hasAttribute("data-setting-label-line")).toBe(true);
    // Never floated over the control column.
    expect(restore.className).not.toMatch(/\babsolute\b/);
  });
});

describe("list-row provenance (技能)", () => {
  it("files a plugin's skill under 插件 whatever its scope, and names the plugin briefly", () => {
    expect(skillOrigin({ scope: "user", pluginId: "documents@openai-primary-runtime" })).toBe("plugin");
    expect(skillOrigin({ scope: "system", pluginId: null })).toBe("system");
    expect(pluginShortName("documents@openai-primary-runtime")).toBe("documents");
    expect(pluginShortName("plain")).toBe("plain");
    expect(SKILL_ORIGINS.filter(skillArchivable)).toEqual(["user"]);
  });
});

describe("one host picker in Settings", () => {
  // Settings pages never build a host picker of their own: the header's SettingsHostSwitcher is the only one.
  // 用量's 「全部主机」 edit target picks among the hosts of that one view (where an edit goes), not the page's host.
  const ALLOWED = new Set(["components/SettingsHostFrame.tsx", "modules/usage/UsagePage.tsx"]);
  const root = join(__dirname, "../src/renderer/src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : [];
  });
  it("only SettingsHostFrame renders a HostPicker among settings pages", () => {
    const settingsFiles = [...files(join(root, "components/settings")), ...files(join(root, "modules")).filter((f) => /Settings|Page|Sections/.test(f))];
    const offenders = settingsFiles.map((f) => relative(root, f).replace(/\\/g, "/")).filter((f) => !ALLOWED.has(f) && /<HostPicker\b/.test(readFileSync(join(root, f), "utf8")))
      // Create forms (new agent / project / quick chat / science) pick where to create, not which host's settings.
      .filter((f) => !["modules/agent-config/NewAgentPage.tsx", "modules/projects/ProjectsPage.tsx", "modules/quick-chats/PendingChat.tsx", "modules/claude-science/ClaudeSciencePage.tsx"].includes(f));
    expect(offenders).toEqual([]);
  });
  it("Section has no card-level picker any more", () => {
    const form = readFileSync(join(root, "components/settings/Form.tsx"), "utf8");
    expect(form).not.toMatch(/PartSource|PartPickerContext/);
    expect(form).not.toMatch(/export function Section\([^)]*\bpicker\b/);
  });
});
