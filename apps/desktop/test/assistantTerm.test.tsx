// @vitest-environment jsdom
// 个人助理 as a 术语 term (owner 2026-11-26): {{assistant}} in every language (zh 个人助理, en personal assistant), a
// value in the Maid preset (Lady's Maid) with a short sidebar chip, saved Maid wording migrated so it still reads as the
// preset, daemon Chinese text re-termed; the sidebar knows a 个人助理's agent from the store; and 新建智能体 offers a
// 个人助理 that opens the 个人助理 page's own create form on that host.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { applyTerms, DEFAULT_TERMS, parseOverrides, resolveSidebarRoleLabel, resolveTerms, retermDaemonText, TERM_IDS, type TermOverrides } from "../src/renderer/src/lib/terms";
import { currentTermPreset, termPresets } from "../src/renderer/src/lib/termPresets";
import { migrateAssistantTerm } from "../src/renderer/src/lib/termPresetMigration";
import { isAssistantSession } from "../src/renderer/src/lib/personalAssistantStore";

const opened = vi.hoisted(() => [] as [string, unknown][]);
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: { openPage: (page: string, params: unknown) => opened.push([page, params]) } } }));

const MAID_EN: TermOverrides["en"] = { agent: { one: "Maid", many: "Maids" }, subagent: { one: "Maidling", many: "Maidlings" }, parentagent: { one: "Mentor Maid", many: "Mentor Maids" }, director: { one: "Chief Maid", many: "Chief Maids" }, operator: { one: "Deputy Maid", many: "Deputy Maids" }, owner: { one: "Master", many: "Masters" } };
const zhOf = (en: NonNullable<TermOverrides["en"]>) => Object.fromEntries(Object.entries(en).map(([id, f]) => [id, { one: f!.one, many: f!.one }]));

describe("the 个人助理 term", () => {
  it("has a default in every language and reads in templates", () => {
    expect(TERM_IDS).toContain("assistant");
    for (const forms of Object.values(DEFAULT_TERMS)) expect(forms.assistant.one).toBeTruthy();
    expect(applyTerms("创建{{assistant}}", resolveTerms({}, "zh-CN"), "zh-CN")).toBe("创建个人助理");
    expect(applyTerms("{{Assistants}} · {{an assistant}}", resolveTerms({}, "en"), "en")).toBe("Personal assistants · a personal assistant");
    expect(applyTerms("建立{{assistant}}", resolveTerms({}, "zh-Hant-TW"), "zh-Hant-TW")).toBe("建立個人助理");
    // A renamed term follows everywhere (zh spacing around a Latin word included).
    expect(applyTerms("创建{{assistant}}", resolveTerms({ "zh-CN": { assistant: { one: "Lady's Maid" } } }, "zh-CN"), "zh-CN")).toBe("创建 Lady's Maid");
  });

  it("the Maid preset names it Lady's Maid; the sidebar chip is short by default", () => {
    expect(termPresets("en").find((p) => p.id === "maid")?.terms.assistant).toEqual({ one: "Lady's Maid", many: "Lady's Maids" });
    expect(termPresets("zh-CN").find((p) => p.id === "maid")?.terms.assistant).toEqual({ one: "Lady's Maid", many: "Lady's Maid" });
    expect(resolveSidebarRoleLabel({}, "zh-CN", "assistant")).toBe("助理");
    expect(resolveSidebarRoleLabel({}, "en", "assistant")).toBe("assistant");
    expect(resolveSidebarRoleLabel({ en: { ...MAID_EN, assistant: { one: "Lady's Maid", many: "Lady's Maids" } } }, "en", "assistant")).toBe("Lady's Maid");
    // A sidebar label of its own is kept (empty = hidden), like the Director's.
    expect(parseOverrides({ en: { assistant: { sidebar: "" } } }).en?.assistant?.sidebar).toBe("");
  });

  it("saved Maid wording gains Lady's Maid and still reads as the preset; custom wording is left alone", () => {
    const saved: TermOverrides = { en: MAID_EN, "zh-CN": zhOf(MAID_EN!) };
    expect(currentTermPreset("en", saved)).toBeNull();
    const migrated = migrateAssistantTerm(saved);
    expect(migrated.en?.assistant).toEqual({ one: "Lady's Maid", many: "Lady's Maids" });
    expect(migrated["zh-CN"]?.assistant).toEqual({ one: "Lady's Maid", many: "Lady's Maid" });
    expect(currentTermPreset("en", migrated)).toBe("maid");
    expect(currentTermPreset("zh-CN", migrated)).toBe("maid");
    expect(migrateAssistantTerm(migrated)).toBe(migrated);
    const custom: TermOverrides = { en: { ...MAID_EN, owner: { one: "Boss", many: "Bosses" } } };
    expect(migrateAssistantTerm(custom)).toBe(custom);
    const own: TermOverrides = { en: { ...MAID_EN, assistant: { one: "Valet" } } };
    expect(migrateAssistantTerm(own)).toBe(own);
  });

  it("daemon Chinese text says the owner's word", () => {
    const terms = resolveTerms({ "zh-CN": { assistant: { one: "Lady's Maid" } } }, "zh-CN");
    expect(retermDaemonText("个人助理的定期任务需要重新确认", terms, "zh-CN")).toBe("Lady's Maid 的定期任务需要重新确认");
    expect(retermDaemonText("个人助理的定期任务", resolveTerms({}, "zh-CN"), "zh-CN")).toBe("个人助理的定期任务");
  });
});

describe("where the term shows", () => {
  it("the sidebar knows a 个人助理's agent from the store", () => {
    const s = { byHost: { local: { assistants: [{ id: "pa-1", sessionId: "kai" }, { id: "pa-2", sessionId: null }] } } } as never;
    expect(isAssistantSession(s, "local", "kai")).toBe(true);
    expect(isAssistantSession(s, "local", "eva")).toBe(false);
    expect(isAssistantSession(s, "remote", "kai")).toBe(false);
    expect(isAssistantSession(s, "local", null)).toBe(false);
  });

  it("新建智能体's 个人助理 choice opens the 个人助理 create form on that host", async () => {
    localStorage.setItem("cutex-desktop.locale", "zh-CN");
    const { I18nProvider } = await import("../src/renderer/src/i18n");
    const { AssistantChoice } = await import("../src/renderer/src/modules/agent-config/AssistantChoice");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const div = document.createElement("div");
    document.body.append(div);
    const root = createRoot(div);
    await act(async () => root.render(h(I18nProvider, null, h(AssistantChoice, { hostId: "hostb" }))));
    const button = div.querySelector<HTMLButtonElement>("[data-new-agent-assistant-open]")!;
    expect(button.textContent).toBe("创建个人助理");
    expect(div.textContent).toContain("个人助理");
    await act(async () => button.click());
    expect(opened).toEqual([["personal-assistants.page", { view: "new", host: "hostb" }]]);
    act(() => root.unmount());
  });
});
