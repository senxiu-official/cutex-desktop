// @vitest-environment jsdom
// 撤销文件改动 of a Codex turn (cutex cutex/session/files/revert): the result parser, the gate, and the
// panel's flow — dry run first, the plan in place, execute with that plan's digest, plan_changed asks again,
// a conflict never executes.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ filesRevert: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({ hostApi: (host: string) => ({ filesRevert: (...args: unknown[]) => fx.filesRevert(host, ...args) }) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars && "n" in vars ? `${key}:${vars.n}` : key) }) }));
import { filesRevertFailure, filesRevertPlan, SESSION_FILES_REVERT_FEATURE, type FilesRevertPlan } from "../src/shared/filesRevert";
import { canRevertTurnFiles, filesRevertKey, useFilesRevert } from "../src/renderer/src/lib/filesRevert";
import { FilesRevertButton, FilesRevertPanel } from "../src/renderer/src/components/TurnFilesRevert";
import { zhCN as conversationZh } from "../src/renderer/src/modules/conversation/i18n";
import { en as conversationEn } from "../src/renderer/src/modules/conversation/i18n.en";

const raw = (over: Record<string, unknown> = {}) => ({
  cutexSessionId: "cutex.a", threadId: "th", turnId: "t1", dryRun: true, planDigest: "sha256:one", applicable: true,
  files: [
    { path: "/w/a.txt", relativePath: "a.txt", movePath: null, action: "restore", status: "ok", reason: null, added: 1, deleted: 2 },
    { path: "/w/b.txt", relativePath: "b.txt", movePath: null, action: "delete", status: "alreadyReverted", reason: null, added: 0, deleted: 3 },
  ],
  warnings: [{ kind: "laterTurnsTouchedFiles", turnIds: ["t2"], paths: ["a.txt"] }],
  actionId: null, applied: false, journalPath: null, agentNote: "x", recovered: [],
  ...over,
});
const plan = (over: Record<string, unknown> = {}) => filesRevertPlan(raw(over))!;

describe("cutex files revert results", () => {
  it("reads a plan and drops what isn't one", () => {
    const p = plan();
    expect(p).toMatchObject({ turnId: "t1", planDigest: "sha256:one", applicable: true, applied: false, recovered: [] });
    expect(p.files.map((f) => [f.relativePath, f.action, f.status, f.added, f.deleted])).toEqual([["a.txt", "restore", "ok", 1, 2], ["b.txt", "delete", "alreadyReverted", 0, 3]]);
    expect(p.warnings[0]!.kind).toBe("laterTurnsTouchedFiles");
    expect(filesRevertPlan({ turnId: "t1", files: [] })).toBeNull();
    expect(filesRevertPlan(null)).toBeNull();
  });

  it("an error carries cutex's fresh plan (plan_changed / revert_conflict) or the journal (revert_partial)", () => {
    const changed = filesRevertFailure("plan_changed", "plan_changed: plan changed since preview", raw({ planDigest: "sha256:two" }));
    expect(changed).toMatchObject({ ok: false, code: "plan_changed", message: "plan changed since preview", journalPath: null });
    expect(changed.plan!.planDigest).toBe("sha256:two");
    const partial = filesRevertFailure("revert_partial", "x", { journalPath: "C:/h/runtime/file-reverts/frv-1", outcomeUnknown: true });
    expect(partial).toMatchObject({ plan: null, journalPath: "C:/h/runtime/file-reverts/frv-1" });
    const generic = filesRevertFailure("request_outcome_unknown", "x", { resyncRequired: true, originalDetails: { journalPath: "j" } });
    expect(generic.journalPath).toBe("j");
  });

  it("offered for Codex agents on hosts with session-files-revert only", () => {
    const host = (on: boolean) => ({ has: (f: string) => on && f === SESSION_FILES_REVERT_FEATURE });
    expect(canRevertTurnFiles({ runtime: "codex", map: null }, host(true))).toBe(true);
    expect(canRevertTurnFiles({ runtime: "codex", map: null }, host(false))).toBe(false);
    expect(canRevertTurnFiles({ runtime: "claude", map: { fileRewind: true } }, host(true))).toBe(false);
    expect(canRevertTurnFiles({ runtime: "dsh", map: null } as never, host(true))).toBe(false);
  });

  it("every string has zh-CN and en", () => {
    const keys = Object.keys(conversationZh).filter((k) => k.startsWith("conversation.filesRevert."));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect((conversationEn as Record<string, string>)[k], k).toBeTruthy();
    for (const s of ["ok", "alreadyReverted", "conflict", "missing", "outsideWorkspace", "unsupported"]) expect(keys).toContain(`conversation.filesRevert.status.${s}`);
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let div: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const ids = { hostId: "h1", sessionId: "cutex.a", turnId: "t1" };
const render = () => act(async () => root.render(h("div", null, h(FilesRevertButton, ids), h(FilesRevertPanel, ids))));
const byTest = (id: string) => div.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = async (el: HTMLElement | null) => act(async () => { el!.click(); });
const button = (text: string) => [...div.querySelectorAll("button")].find((b) => b.textContent === text) ?? null;
const ok = (p: FilesRevertPlan) => ({ ok: true, plan: p });

describe("files revert panel", () => {
  beforeEach(async () => {
    useFilesRevert.setState({ byKey: {} });
    fx.filesRevert.mockReset();
    div = document.createElement("div");
    document.body.append(div);
    root = createRoot(div);
    await render();
  });
  afterEach(() => { act(() => root.unmount()); div.remove(); });

  it("previews first, then executes exactly the previewed plan", async () => {
    fx.filesRevert.mockResolvedValueOnce(ok(plan()));
    await click(byTest("files-revert-start"));
    expect(fx.filesRevert.mock.calls).toEqual([["h1", "cutex.a", "t1", { dryRun: true }]]);
    expect(byTest("files-revert-start")).toBeNull();
    expect(byTest("files-revert-panel")!.dataset.phase).toBe("preview");
    expect(div.textContent).toContain("conversation.filesRevert.willRevert:1");
    expect(div.textContent).toContain("a.txt");
    expect(div.textContent).toContain("conversation.filesRevert.action.restore");
    expect(div.textContent).toContain("conversation.filesRevert.status.alreadyReverted");
    expect(div.textContent).toContain("conversation.filesRevert.warn.later:1");
    fx.filesRevert.mockResolvedValueOnce(ok(plan({ applied: true, actionId: "frv-1", dryRun: false })));
    await click(byTest("files-revert-apply"));
    expect(fx.filesRevert.mock.calls[1]).toEqual(["h1", "cutex.a", "t1", { dryRun: false, expectedPlanDigest: "sha256:one" }]);
    expect(byTest("files-revert-panel")!.dataset.phase).toBe("done");
    expect(div.textContent).toContain("conversation.filesRevert.done:1");
    await click(button("conversation.filesRevert.close"));
    expect(useFilesRevert.getState().byKey[filesRevertKey("h1", "cutex.a", "t1")]).toBeUndefined();
    expect(byTest("files-revert-start")).not.toBeNull();
  });

  it("plan_changed shows cutex's fresh plan to confirm again, with its new digest", async () => {
    fx.filesRevert.mockResolvedValueOnce(ok(plan()));
    await click(byTest("files-revert-start"));
    const fresh = plan({ planDigest: "sha256:two" });
    fx.filesRevert.mockResolvedValueOnce({ ok: false, code: "plan_changed", message: "", plan: fresh, journalPath: null });
    await click(byTest("files-revert-apply"));
    expect(byTest("files-revert-panel")!.dataset.phase).toBe("preview");
    expect(div.textContent).toContain("conversation.filesRevert.changed");
    fx.filesRevert.mockResolvedValueOnce(ok({ ...fresh, applied: true }));
    await click(byTest("files-revert-apply"));
    expect(fx.filesRevert.mock.calls[2]![3]).toEqual({ dryRun: false, expectedPlanDigest: "sha256:two" });
  });

  it("a conflicting plan is shown but offers no execute", async () => {
    fx.filesRevert.mockResolvedValueOnce(ok(plan({ applicable: false, files: [{ path: "/w/a.txt", relativePath: "a.txt", action: "restore", status: "conflict", reason: "patch no longer applies", added: 1, deleted: 1 }] })));
    await click(byTest("files-revert-start"));
    expect(div.textContent).toContain("conversation.filesRevert.blocked");
    expect(div.textContent).toContain("conversation.filesRevert.status.conflict");
    expect(byTest("files-revert-apply")).toBeNull();
    expect(fx.filesRevert).toHaveBeenCalledTimes(1);
  });

  it("errors say what happened; a partial revert shows its journal and no retry", async () => {
    fx.filesRevert.mockResolvedValueOnce({ ok: false, code: "session_busy", message: "", plan: null, journalPath: null });
    await click(byTest("files-revert-start"));
    expect(div.textContent).toContain("conversation.filesRevert.error.session_busy");
    expect(button("conversation.filesRevert.retry")).not.toBeNull();
    fx.filesRevert.mockResolvedValueOnce(ok(plan()));
    await click(button("conversation.filesRevert.retry"));
    fx.filesRevert.mockResolvedValueOnce({ ok: false, code: "revert_partial", message: "", plan: null, journalPath: "C:/h/frv-1" });
    await click(byTest("files-revert-apply"));
    expect(div.textContent).toContain("conversation.filesRevert.error.revert_partial");
    expect(div.textContent).toContain("conversation.filesRevert.journal");
    expect(button("conversation.filesRevert.retry")).toBeNull();
    fx.filesRevert.mockResolvedValueOnce({ ok: false, code: "weird_code", message: "boom", plan: null, journalPath: null });
    await click(button("conversation.filesRevert.close"));
    await click(byTest("files-revert-start"));
    expect(div.textContent).toContain("conversation.filesRevert.error.other");
  });
});
