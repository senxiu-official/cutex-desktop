// @vitest-environment jsdom
// Owner 2026-11-24: 自动标题 read as an agent setting (its own section with the 「立即生效」 agent badge). cutex names only
// quick chats (cli_app/thread_titles.rs), so its rows sit in 新建默认 → 快速启动 after the quick-chat defaults, keep the
// `titles` anchor, and the hint says it is for quick chats. cutex re-reads the setting on every user message (an existing
// unnamed quick chat is named after its next one), so the rows say 快速会话 · 立即生效 (`chatsNow`, a chat glyph), not
// the section's 仅新建时 and not the agent-flavoured `now`.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { PreloadBridge } from "../src/shared/ipc";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";
import { zhHantTW } from "../src/renderer/src/i18n/zh-Hant-TW";

const fx = vi.hoisted(() => ({ api: null as unknown as PreloadBridge["api"], features: new Set<string>(["auto-thread-titles"]) }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {}, platform: "win32" }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTargetApi: () => fx.api,
  useTargetFeatures: () => fx.features,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { DefaultsPage } = await import("../src/renderer/src/components/settings/GlobalSettings");
const { DEFAULTS_SEARCH } = await import("../src/renderer/src/modules/agent-config/settingsSearch");
const { installMockBridge } = await import("../src/renderer/src/dev/mockBridge");

afterEach(() => { document.body.innerHTML = ""; });

it("puts the auto-title rows in 快速启动 with the quick-chat timing, under the `titles` anchor", async () => {
  installMockBridge();
  fx.api = (window as unknown as { cutex: PreloadBridge }).cutex.api;
  const div = document.createElement("div"); document.body.append(div);
  const root = createRoot(div);
  await act(async () => root.render(h(DefaultsPage)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  const quick = div.querySelector("#settings-quickWork")!;
  expect(quick).not.toBeNull();
  const titles = div.querySelector("#settings-titles")!;
  expect(titles).not.toBeNull();
  expect(quick.contains(titles)).toBe(true);
  // No section of its own.
  expect(titles.closest("section, [data-settings-section]")).toBe(quick.closest("section, [data-settings-section]"));
  const rows = [...titles.querySelectorAll<HTMLElement>("[data-setting-row]")];
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("agent-config.quickChats.titles.auto"),
    expect.stringContaining("agent-config.quickChats.titles.model"),
  ]);
  expect(rows.map((row) => row.getAttribute("data-effect-timing"))).toEqual(["chatsNow", "chatsNow"]);
  expect(div.querySelector('[data-effect-timing="now"]')).toBeNull();
  // Each row shows its own marker (the chat glyph), overriding the section's 仅新建时.
  expect(rows.map((row) => row.querySelector("[data-agent-timing-icon]")?.getAttribute("data-agent-timing-icon"))).toEqual(["chatsNow", "chatsNow"]);
  expect(rows.map((row) => row.querySelector("[data-settings-agents]")?.getAttribute("aria-label"))).toEqual(["settings.scope.agents.chatsNow", "settings.scope.agents.chatsNow"]);
  // The quick-chat defaults before them stay new-creations-only, and no header states one timing for the whole section.
  const others = [...quick.querySelectorAll<HTMLElement>("[data-setting-row]")].filter((row) => !titles.contains(row));
  expect(others.length).toBeGreaterThan(0);
  expect(others.every((row) => row.getAttribute("data-effect-timing") === "newAgents")).toBe(true);
  expect(quick.querySelector('[data-timing-presentation="header"][data-settings-agents="newAgents"]')).toBeNull();
  await act(async () => root.unmount());
});

it("search still finds it at `titles`; the hint names quick chats in every shipped Chinese / English catalog", () => {
  const entry = DEFAULTS_SEARCH.sections!.find((section) => section.anchor === "titles")!;
  expect(entry.titleKey).toBe("agent-config.quickChats.titles");
  expect(entry.keywords).toContain("agent-config.quickChats.titles.hint");
  const zh = zhCN as Record<string, string>, english = en as Record<string, string>;
  expect(zh["agent-config.quickChats.titles.hint"]).toContain("快速会话");
  expect(english["agent-config.quickChats.titles.hint"]).toMatch(/quick chats/i);
  expect((zhHantCN as Record<string, string>)["agent-config.quickChats.titles.hint"]).toContain("快速會話");
  expect((zhHantTW as Record<string, string>)["agent-config.quickChats.titles.hint"]).toBeTruthy();
  for (const catalog of [zh, english]) expect(Object.keys(catalog).some((key) => key.startsWith("agent-config.titles"))).toBe(false);
});
