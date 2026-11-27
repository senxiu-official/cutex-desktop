// @vitest-environment jsdom
// 运行时配置 → 技能 (owner 2026-11-28 「按推荐」): the runtime-skills contract helpers, main's checks before a request
// leaves the app, and the 「复制到…」 dialog (preview → collision choice → typed phrase → result; one action id per preview).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import type { SkillCopyAnswer, SkillCopyPreview, SkillCopyPreviewAnswer, SkillCopyRequest, SkillCopySelection } from "../src/shared/runtimeSkills";
import { copyRequestBody, copySelectionBody, runtimeSkillsFeature, validCopyRequest, validCopySelection } from "../src/shared/runtimeSkills";
import { byOrigin, confirmationOk, copyBlockedReason, frontmatterChanges, listBlockedReason, needsFreshPreview, previewAction, sourceLabel } from "../src/renderer/src/lib/runtimeSkillsView";

vi.mock("../src/renderer/src/i18n", () => ({
  useI18n: () => ({ t: (key: string, vars?: Record<string, string | number>) => Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), (zhCN as Record<string, string>)[key] ?? key) }),
}));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  DetachedSettings: ({ children }: { children: unknown }) => children,
  SettingsGroup: ({ children }: { children: unknown }) => (typeof children === "function" ? (children as (d: unknown) => unknown)({ attributes: {}, marker: null }) : children),
}));
const { SkillCopyDialog } = await import("../src/renderer/src/components/SkillCopyDialog");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("contract helpers", () => {
  it("each runtime's list has its flag; Codex and Claude share the base one", () => {
    expect(["codex", "claude", "dsh", "kimi"].map((r) => runtimeSkillsFeature(r as never))).toEqual(["runtime-skills", "runtime-skills", "runtime-skills-dsh", "runtime-skills-kimi"]);
    const base = new Set(["runtime-skills"]);
    expect(listBlockedReason("claude", base)).toBeNull();
    expect(listBlockedReason("kimi", base)).toBe("noFlag");
    expect(listBlockedReason("dsh", new Set([...base, "runtime-skills-dsh"]))).toBeNull();
    expect(listBlockedReason("codex", new Set())).toBe("noInventory");
  });
  it("「复制到…」 stays on every Codex / Claude row, disabled with why", () => {
    const both = new Set(["runtime-skills", "runtime-skill-copy"]);
    expect(copyBlockedReason("codex", { copyable: true, origin: "personal" }, both)).toBeNull();
    expect(copyBlockedReason("claude", { copyable: false, origin: "plugin" }, both)).toBe("notPersonal");
    expect(copyBlockedReason("codex", { copyable: true, origin: "personal" }, new Set(["runtime-skills"]))).toBe("noCopyFeature");
    expect(copyBlockedReason("dsh", { copyable: false, origin: "personal" }, both)).toBe("readOnlyRuntime");
  });
  it("cards by origin (personal first, built-in last); a plugin row shows its short name, the raw id as tooltip", () => {
    const s = (name: string, origin: string, source = "x") => ({ id: name, name, description: "", path: "", origin, source, state: "enabled", copyable: false, compatibility: { status: "portable", fields: [] } }) as never;
    expect(byOrigin([s("b", "builtin"), s("z", "personal"), s("a", "personal"), s("p", "plugin")]).map((g) => [g.origin, g.skills.map((x: { name: string }) => x.name)])).toEqual([["personal", ["a", "z"]], ["plugin", ["p"]], ["builtin", ["b"]]]);
    expect(sourceLabel({ origin: "plugin", source: "documents@openai-curated" })).toEqual({ label: "documents", title: "documents@openai-curated" });
    expect(sourceLabel({ origin: "personal", source: "CODEX_HOME/skills" })).toBeNull();
    expect(sourceLabel({ origin: "other", source: "C:\\repo\\.agents\\skills" })).toEqual({ label: ".agents/skills", title: "C:\\repo\\.agents\\skills" });
  });
  it("main forwards only well-formed selections and requests, with the contract's fields only", () => {
    const sel: SkillCopySelection = { sourceRuntime: "codex", targetRuntime: "claude", skillId: "codex:pdf" };
    expect(validCopySelection(sel)).toBe(true);
    expect(validCopySelection({ ...sel, targetRuntime: "codex" })).toBe(false);
    expect(validCopySelection({ ...sel, sourceRuntime: "dsh" })).toBe(false);
    expect(validCopySelection({ ...sel, skillId: "" })).toBe(false);
    expect(validCopySelection({ ...sel, skillId: "a\nb" })).toBe(false);
    expect(copySelectionBody({ ...sel, overwrite: false, path: "C:/x" } as never)).toEqual(sel);
    const req: SkillCopyRequest = { ...sel, overwrite: true, actionId: "skill-copy-1", previewToken: "pt-1", confirmation: "overwrite pdf" };
    expect(validCopyRequest(req)).toBe(true);
    expect(validCopyRequest({ ...req, previewToken: "" })).toBe(false);
    expect(copyRequestBody({ ...req, extra: 1 } as never)).toEqual(req);
  });
  it("the preview decides the main button and the phrase", () => {
    expect(previewAction({ disposition: "blocked", previewToken: null, confirmPhrase: null })).toBe("none");
    expect(previewAction({ disposition: "skip", previewToken: "t", confirmPhrase: null })).toBe("skip");
    expect(confirmationOk({ confirmPhrase: "copy pdf" }, "  copy pdf ")).toBe(true);
    expect(confirmationOk({ confirmPhrase: "copy pdf" }, "copy PDF")).toBe(false);
    expect(confirmationOk({ confirmPhrase: null }, "")).toBe(true);
    expect(frontmatterChanges({ frontmatter: [{ key: "name", change: "preserve" }, { key: "allowed-tools", change: "remove" }] }).map((f) => f.key)).toEqual(["allowed-tools"]);
    expect(needsFreshPreview("skill_copy_preview_stale") && needsFreshPreview("skill_copy_action_conflict") && !needsFreshPreview("skill_copy_confirmation_required")).toBe(true);
  });
});

describe("「复制到…」 dialog", () => {
  let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
  const base: SkillCopyPreview = { name: "pdf", destination: "C:\\h\\.cutex\\claude-skills\\pdf", destinationExists: false, disposition: "copy", files: [{ path: "SKILL.md", bytes: 2000, script: false }, { path: "scripts/fill.py", bytes: 4096, script: true }], frontmatter: [{ key: "name", change: "preserve" }, { key: "allowed-tools", change: "review" }], warnings: ["1 script file(s) are copied as files; the copy never runs them."], sourceDigest: "sha256:abc", previewToken: "pt-1", confirmPhrase: "copy pdf" };
  let preview: (s: SkillCopySelection) => SkillCopyPreviewAnswer;
  let copy: (r: SkillCopyRequest) => Promise<SkillCopyAnswer>;
  const calls: { preview: SkillCopySelection[]; copy: SkillCopyRequest[] } = { preview: [], copy: [] };
  const api = { previewSkillCopy: async (s: SkillCopySelection) => (calls.preview.push(s), preview(s)), copySkill: (r: SkillCopyRequest) => (calls.copy.push(r), copy(r)) } as never;
  const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel);
  const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
  const typeInto = async (sel: string, value: string) => {
    const el = $(sel) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const click = async (sel: string) => { await act(async () => $(sel)!.click()); await settle(); };
  const open = async () => {
    await act(async () => root.render(h(SkillCopyDialog, { api, hostLabel: "SAMPLEHOSTA", source: "codex", skill: { id: "codex:pdf", name: "pdf" }, onClose: () => {} })));
    await settle();
  };
  beforeEach(() => {
    calls.preview = []; calls.copy = [];
    preview = () => ({ ok: true, preview: base });
    copy = async (r) => ({ ok: true, result: { actionId: r.actionId, outcome: "copied", name: "pdf", destination: base.destination, replayed: false } });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("previews files, the scripts as code (collapsed), setting differences; copies only after the phrase", async () => {
    await open();
    expect(calls.preview).toEqual([{ sourceRuntime: "codex", targetRuntime: "claude", skillId: "codex:pdf" }]);
    expect($("[data-skill-copy-files]")!.textContent).toContain("SKILL.md");
    expect($("[data-skill-copy-files]")!.textContent).not.toContain("fill.py");
    expect($("[data-skill-copy-scripts]")!.textContent).toContain("脚本（1）");
    expect($("[data-skill-copy-scripts]")!.textContent).toContain("这些文件是代码");
    expect($("[data-skill-copy-script-list]")).toBeNull();
    await click("[data-skill-copy-scripts] button");
    expect($("[data-skill-copy-script-list]")!.textContent).toContain("scripts/fill.py");
    expect($("[data-skill-copy-differences]")!.textContent).toContain("allowed-tools");
    const apply = $("[data-skill-copy-apply=copy]") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    await typeInto("[data-skill-copy-confirm]", "copy pdf");
    expect(apply.disabled).toBe(false);
    await click("[data-skill-copy-apply=copy]");
    expect(calls.copy).toHaveLength(1);
    expect(calls.copy[0]).toMatchObject({ sourceRuntime: "codex", targetRuntime: "claude", skillId: "codex:pdf", previewToken: "pt-1", confirmation: "copy pdf" });
    expect(calls.copy[0]!.actionId).toMatch(/^skill-copy-/);
    expect($("[data-skill-copy-result=copied]")!.textContent).toContain("已复制到 Claude");
  });

  it("a taken name is skipped by default; 覆盖 previews again with overwrite and asks for its own phrase", async () => {
    preview = (s) => ({ ok: true, preview: s.overwrite ? { ...base, destinationExists: true, disposition: "overwrite", previewToken: "pt-2", confirmPhrase: "overwrite pdf" } : { ...base, destinationExists: true, disposition: "skip", confirmPhrase: null } });
    await open();
    expect(($("[data-skill-copy-skip]") as HTMLInputElement).checked).toBe(true);
    expect($("[data-skill-copy-apply=skip]")).not.toBeNull();
    expect($("[data-skill-copy-confirm]")).toBeNull();
    await click("[data-skill-copy-overwrite]");
    expect(calls.preview.at(-1)).toEqual({ sourceRuntime: "codex", targetRuntime: "claude", skillId: "codex:pdf", overwrite: true });
    await typeInto("[data-skill-copy-confirm]", "overwrite pdf");
    copy = async (r) => ({ ok: true, result: { actionId: r.actionId, outcome: "overwritten", name: "pdf", destination: base.destination, replayed: false } });
    await click("[data-skill-copy-apply=overwrite]");
    expect(calls.copy[0]).toMatchObject({ overwrite: true, previewToken: "pt-2", confirmation: "overwrite pdf" });
    expect($("[data-skill-copy-result=overwritten]")).not.toBeNull();
  });

  it("a lost answer: 重试 sends the same action id (the daemon replays); a refusal starts a new one", async () => {
    await open();
    await typeInto("[data-skill-copy-confirm]", "copy pdf");
    copy = async () => { throw new Error("socket hang up"); };
    await click("[data-skill-copy-apply=copy]");
    expect($("[data-skill-copy-error]")!.textContent).toContain("socket hang up");
    expect($("[data-skill-copy-apply=copy]")!.textContent).toBe("重试");
    copy = async (r) => ({ ok: true, result: { actionId: r.actionId, outcome: "copied", name: "pdf", destination: base.destination, replayed: true } });
    await click("[data-skill-copy-apply=copy]");
    expect(calls.copy[1]!.actionId).toBe(calls.copy[0]!.actionId);
    expect($("[data-skill-copy-replayed]")).not.toBeNull();

    act(() => root.unmount()); root = createRoot(host); calls.copy = [];
    await open();
    await typeInto("[data-skill-copy-confirm]", "copy pdf");
    copy = async () => ({ ok: false, error: { code: "skill_copy_confirmation_required", message: "type it" } });
    await click("[data-skill-copy-apply=copy]");
    expect($("[data-skill-copy-error]")!.textContent).toContain("确认短语不对");
    copy = async (r) => ({ ok: true, result: { actionId: r.actionId, outcome: "copied", name: "pdf", destination: base.destination, replayed: false } });
    await click("[data-skill-copy-apply=copy]");
    expect(calls.copy[1]!.actionId).not.toBe(calls.copy[0]!.actionId);
  });

  it("a stale preview offers 重新预览; a blocked one explains and offers no write", async () => {
    await open();
    await typeInto("[data-skill-copy-confirm]", "copy pdf");
    copy = async () => ({ ok: false, error: { code: "skill_copy_preview_stale", message: "stale" } });
    await click("[data-skill-copy-apply=copy]");
    expect($("[data-skill-copy-error=skill_copy_preview_stale]")).not.toBeNull();
    await click("[data-skill-copy-repreview]");
    expect(calls.preview).toHaveLength(2);

    act(() => root.unmount()); root = createRoot(host);
    preview = () => ({ ok: true, preview: { ...base, disposition: "blocked", previewToken: null, confirmPhrase: null, warnings: ["Its native hook declaration cannot travel to Codex."] } });
    await open();
    expect($("[data-skill-copy-blocked]")).not.toBeNull();
    expect($("[data-skill-copy-warnings]")!.textContent).toContain("hook declaration");
    expect(document.body.querySelector("[data-skill-copy-apply]")).toBeNull();
    expect($("[data-skill-copy-confirm]")).toBeNull();
  });
});
