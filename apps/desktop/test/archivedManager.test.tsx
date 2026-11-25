// @vitest-environment jsdom
// 设置 → 归档 → 已归档的智能体 (owner 2026-11-24): filters, selection (全选 of the filtered rows, Shift range), batch restore
// (medium: a second click in place) / permanent delete (high: typed confirmation naming count and size), progress and
// per-item failures, and figures read once per agent (id@revision) from cutex's storage items and usage ledger.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";

const fx = vi.hoisted(() => ({
  archived: [] as { id: string; name: string; color: null; session: SessionResource }[],
  features: new Set<string>(),
  api: { storageItems: vi.fn(), usage: vi.fn() },
  prompt: vi.fn(),
  restore: vi.fn(),
  deleteSession: vi.fn(),
}));
vi.mock("../src/renderer/src/lib/sidebarView", () => ({ useSidebarModel: () => ({ archived: fx.archived }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "local", useTargetFeatures: () => fx.features, useTargetSidebar: () => null, useTargetSelect: () => async () => {} }));
vi.mock("../src/renderer/src/lib/hostLists", () => ({ hostApi: () => fx.api }));
vi.mock("../src/renderer/src/lib/agentLook", () => ({ agentFamilyNow: (id: string) => (id.endsWith("c") ? "claude" : "openai") }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ promptDialog: fx.prompt }));
vi.mock("../src/renderer/src/lib/menus", () => ({ SESSION_FEATURES: { delete: "session-delete" }, deleteAgent: vi.fn(), restoreArchived: fx.restore }));
vi.mock("../src/renderer/src/lib/projectArchive", () => ({ restoreWithDirector: vi.fn() }));
vi.mock("../src/renderer/src/lib/settingsFocus", () => ({ useScrollToSettingsAnchor: () => {} }));
vi.mock("../src/renderer/src/components/Avatar", () => ({ Avatar: () => null }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ deleteSession: fx.deleteSession, refreshHostSidebar: async () => {} }) }) }));
vi.mock("../src/renderer/src/i18n", async () => {
  const { zhCN } = await import("../src/renderer/src/modules/archive/i18n");
  return { useI18n: () => ({ locale: "zh-CN", t: (key: string, vars: Record<string, unknown> = {}) => String((zhCN as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? "")) }) };
});
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Section: ({ title, children }: { title?: string; children: React.ReactNode }) => h("section", null, h("h2", null, title), children),
  EmptyState: ({ children }: { children: React.ReactNode }) => h("p", { "data-empty": "" }, children),
  ErrorNote: ({ children }: { children: React.ReactNode }) => h("p", { role: "alert" }, children),
  SettingsGroup: ({ children }: { children: React.ReactNode }) => children,
  Button: (props: object) => h("button", { type: "button", ...props }),
  IconButton: ({ label, onClick }: { label: string; onClick(): void }) => h("button", { "aria-label": label, onClick }),
  TextLink: ({ children, onClick }: { children: React.ReactNode; onClick(): void }) => h("button", { "data-link": "", onClick }, children),
  ListRow: ({ leading, title, detail, actions, below }: Record<string, React.ReactNode>) => h("div", { "data-row": "" }, leading, h("span", null, title), h("span", { "data-detail": "" }, detail), actions, below),
  TextInput: ({ value, onChange, label }: { value: string; onChange(v: string): void; label?: string }) => h("input", { "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }),
  Select: ({ value, options, onChange, label }: { value: string; options: { value: string; label: string }[]; onChange(v: string): void; label?: string }) =>
    h("select", { "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, options.map((o) => h("option", { key: o.value, value: o.value }, o.label))),
}));
vi.mock("../src/renderer/src/lib/armedConfirm", async () => {
  const { useState } = await import("react");
  return { ARMED_FORM_BUTTON: "border-danger-solid bg-danger-solid", useArmed: () => useState(false) };
});

const { ArchivedManager } = await import("../src/renderer/src/modules/archive/ArchivedManager");
const { matchesArchived, rangeIds, sortArchived, totalsOf, EMPTY_FILTER, NO_PROJECT } = await import("../src/renderer/src/modules/archive/archivedFilter");
const { loadArchivedStats, readUsage, resetArchivedStats, runBounded, useArchivedStats } = await import("../src/renderer/src/modules/archive/archivedStats");
const { zhCN } = await import("../src/renderer/src/modules/archive/i18n");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
const NOW = Date.now();
function session(id: string, over: { daysAgo?: number; project?: string | null; revision?: number } = {}): SessionResource {
  const at = new Date(NOW - (over.daysAgo ?? 1) * DAY).toISOString();
  return { cutexSessionId: id, revision: over.revision ?? 3, lifecycle: "retired", retiredAt: at, displayName: id, createdAt: new Date(NOW - 400 * DAY).toISOString(), updatedAt: at, activity: { lastConversationAt: at },
    projectId: over.project ?? null, projectName: over.project ? `P-${over.project}` : null, runtime: {}, avatar: null } as unknown as SessionResource;
}
const row = (s: SessionResource) => ({ id: s.cutexSessionId, name: s.cutexSessionId, color: null, session: s });
const page = (items: { id: string; bytes: number }[], nextCursor: string | null = null) => ({ store: "light-homes", nextCursor, items: items.map((x) => ({ id: `h-${x.id}`, path: `runtime/light/agents/${x.id}`, cutexSessionId: x.id, state: "retired", bytes: x.bytes, files: 10 })) });
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

let unmount = () => {};
let node: HTMLDivElement;
beforeEach(() => {
  resetArchivedStats();
  localStorage.clear();
  fx.features = new Set(["host-storage", "usage-ledger", "session-delete"]);
  fx.api.storageItems.mockReset().mockResolvedValue(page([{ id: "a1", bytes: 100 * 1024 ** 2 }, { id: "b2", bytes: 50 * 1024 ** 2 }, { id: "c3c", bytes: 10 * 1024 ** 2 }]));
  // The newest window has a1's usage; the older one nothing (an agent not asked for is ignored).
  fx.api.usage.mockReset().mockResolvedValueOnce({ rows: [{ key: { agent: "a1" }, total: 1000, turns: 4 }, { key: { agent: "zz" }, total: 9, turns: 1 }] }).mockResolvedValue({ rows: [] });
  fx.prompt.mockReset();
  fx.restore.mockReset().mockResolvedValue(undefined);
  fx.deleteSession.mockReset().mockResolvedValue({ ok: true });
  fx.archived = [session("a1", { daysAgo: 2, project: "p1" }), session("b2", { daysAgo: 40 }), session("c3c", { daysAgo: 120, project: "p1" }), session("d4", { daysAgo: 5, project: "p2" })].map(row);
});
afterEach(() => { unmount(); document.body.innerHTML = ""; });
async function mount() {
  node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(h(ArchivedManager)));
  await flush();
  unmount = () => act(() => root.unmount());
}
const rows = () => [...node.querySelectorAll<HTMLElement>("[data-archived-row]")].map((e) => e.dataset.archivedRow);
const check = (id: string, shiftKey = false) => act(() => node.querySelector<HTMLElement>(`[data-archived-row="${id}"] [role=checkbox]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey })));
const button = (text: string) => [...node.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const select = (label: string, value: string) => act(() => { const s = node.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; s.value = value; s.dispatchEvent(new Event("change", { bubbles: true })); });

describe("filters and order (pure)", () => {
  it("name / project text, project (incl. none), family, archive-date presets; shift ranges; totals", () => {
    const f = (s: SessionResource, family = "openai") => ({ id: s.cutexSessionId, name: s.cutexSessionId, session: s, project: (s as unknown as { projectId?: string }).projectId ? { id: (s as unknown as { projectId: string }).projectId, name: "Proj" } : null, family, archivedAt: Date.parse(s.retiredAt!), lastActiveAt: null, figures: null });
    const a = f(session("a1", { daysAgo: 2, project: "p1" })), b = f(session("b2", { daysAgo: 40 }), "claude");
    expect(matchesArchived(a, { ...EMPTY_FILTER, text: "proj" }, NOW)).toBe(true);
    expect(matchesArchived(b, { ...EMPTY_FILTER, project: NO_PROJECT }, NOW)).toBe(true);
    expect(matchesArchived(a, { ...EMPTY_FILTER, project: NO_PROJECT }, NOW)).toBe(false);
    expect(matchesArchived(b, { ...EMPTY_FILTER, family: "claude" }, NOW)).toBe(true);
    expect([a, b].filter((x) => matchesArchived(x, { ...EMPTY_FILTER, when: "30d" }, NOW)).map((x) => x.id)).toEqual(["a1"]);
    expect([a, b].filter((x) => matchesArchived(x, { ...EMPTY_FILTER, when: "older90d" }, NOW))).toEqual([]);
    expect(sortArchived([b, a], "archived", "en").map((x) => x.id)).toEqual(["a1", "b2"]);
    expect(rangeIds(["a", "b", "c", "d"], "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeIds(["a", "b"], null, "b")).toEqual(["b"]);
    expect(totalsOf([{ ...a, figures: { bytes: 5, files: 1, tokens: 7, turns: 2 } }, b])).toMatchObject({ count: 2, bytes: 5, measured: 1, tokens: 7, turns: 2 });
  });
});

describe("figures", () => {
  it("read once per agent (id@revision), kept across a reopen; a new revision or 重新统计 reads again", async () => {
    const sessions = fx.archived.map((r) => r.session);
    await loadArchivedStats("local", fx.api, sessions, { size: true, usage: true });
    const kept = useArchivedStats.getState().figures.local!;
    expect(kept["a1@3"]).toEqual({ bytes: 100 * 1024 ** 2, files: 10, tokens: 1000, turns: 4 });
    // Not in cutex's items: no local copy recorded (null), not zero.
    expect(kept["d4@3"]).toMatchObject({ bytes: null, tokens: 0 });
    expect(JSON.parse(localStorage.getItem("cutex-desktop.archivedStats.v1")!).figures.local["a1@3"].bytes).toBe(100 * 1024 ** 2);
    const calls = fx.api.storageItems.mock.calls.length;
    await loadArchivedStats("local", fx.api, sessions, { size: true, usage: true });
    expect(fx.api.storageItems.mock.calls.length).toBe(calls);
    // Restored and archived again: a new revision is a new agent for the figures; the old key is dropped.
    const again = [session("a1", { revision: 9 }), ...sessions.slice(1)];
    await loadArchivedStats("local", fx.api, again, { size: true, usage: true });
    expect(fx.api.storageItems.mock.calls.length).toBe(calls + 1);
    expect(Object.keys(useArchivedStats.getState().figures.local!).sort()).toEqual(["a1@9", "b2@3", "c3c@3", "d4@3"]);
    await loadArchivedStats("local", fx.api, again, { size: true, usage: true }, { force: true });
    expect(fx.api.storageItems.mock.calls.length).toBe(calls + 2);
  });

  it("pages through cutex's items; usage in ≤ 366-day windows back to the oldest agent", async () => {
    fx.api.storageItems.mockReset().mockResolvedValueOnce(page([{ id: "a1", bytes: 1 }], "1")).mockResolvedValueOnce(page([{ id: "a1", bytes: 2 }]));
    await loadArchivedStats("local", fx.api, [session("a1")], { size: true, usage: false });
    expect(fx.api.storageItems).toHaveBeenNthCalledWith(2, "light-homes", { sort: "bytes", limit: 200, cursor: "1" });
    expect(useArchivedStats.getState().figures.local!["a1@3"]!.bytes).toBe(3);
    fx.api.usage.mockClear();
    await readUsage(fx.api, [session("old")], NOW);
    // createdAt 400 days ago: two windows.
    expect(fx.api.usage).toHaveBeenCalledTimes(2);
    for (const [q] of fx.api.usage.mock.calls) expect((Date.parse(q.to) - Date.parse(q.from)) / DAY).toBeLessThanOrEqual(365);
  });

  it("hosts without the capabilities read nothing", async () => {
    await loadArchivedStats("local", fx.api, [session("a1")], { size: false, usage: false });
    expect(fx.api.storageItems).not.toHaveBeenCalled();
    expect(fx.api.usage).not.toHaveBeenCalled();
  });

  it("runBounded: never more than the limit at once, every item settles, failures in place", async () => {
    let live = 0, peak = 0;
    const out = await runBounded([1, 2, 3, 4, 5, 6, 7], 3, async (n) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 1)); live--; if (n === 4) throw new Error("no"); return n * 2; });
    expect(peak).toBe(3);
    expect(out.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled", "fulfilled"]);
  });
});

describe("the page", () => {
  it("totals with size and tokens; per-row figures; filters by project / family / date", async () => {
    await mount();
    expect(node.querySelector("[data-archived-totals]")!.textContent).toContain("共 4 个");
    expect(node.querySelector("[data-archived-totals]")!.textContent).toContain("本地副本 160 MiB（3 / 4 个有记录）");
    expect(node.querySelector(`[data-archived-row="a1"]`)!.closest("[data-row]")!.querySelector("[data-archived-figures]")!.textContent).toContain("100 MiB");
    expect(rows()).toEqual(["a1", "d4", "b2", "c3c"]);
    select(zhCN["archive.manage.project"], "p1");
    expect(rows()).toEqual(["a1", "c3c"]);
    expect(node.querySelector("[data-archived-totals]")!.textContent).toContain("筛选出 2 / 4 个");
    select(zhCN["archive.manage.family"], "claude");
    expect(rows()).toEqual(["c3c"]);
    act(() => button(zhCN["archive.manage.clearFilter"]).click());
    select(zhCN["archive.manage.when"], "7d");
    expect(rows()).toEqual(["a1", "d4"]);
  });

  it("全选 takes the filtered rows; Shift-click a range; a new filter clears the selection", async () => {
    await mount();
    check("a1");
    check("b2", true);
    expect(node.querySelector("[data-archived-batch]")!.textContent).toContain("已选 3 个");
    select(zhCN["archive.manage.project"], "p1");
    expect(node.querySelector("[data-archived-batch]")!.textContent).not.toContain("已选");
    act(() => node.querySelector<HTMLElement>("[data-archived-batch] [role=checkbox]")!.click());
    expect(node.querySelector("[data-archived-batch]")!.textContent).toContain("已选 2 个");
  });

  it("batch restore: a second click in place, then every agent (three at a time); failures listed and kept selected", async () => {
    fx.restore.mockImplementation(async (s: SessionResource) => { if (s.cutexSessionId === "d4") throw new Error("project_restore_conflict"); });
    await mount();
    check("a1"); check("d4");
    act(() => button(zhCN["archive.manage.restore"]).click());
    expect(fx.restore).not.toHaveBeenCalled();
    const armed = node.querySelector<HTMLButtonElement>("[data-archived-restore-armed]")!;
    expect(armed.textContent).toBe("再左键点击一次恢复 2 个");
    await act(async () => armed.click());
    await flush();
    expect(fx.restore.mock.calls.map(([s, withProject, host]) => [s.cutexSessionId, withProject, host])).toEqual([["a1", true, "local"], ["d4", true, "local"]]);
    const progress = node.querySelector("[data-archived-progress]")!;
    expect(progress.getAttribute("data-archived-progress")).toBe("done");
    expect(progress.textContent).toContain("已恢复 1 / 2 个");
    expect(progress.querySelector("[data-archived-failures]")!.textContent).toContain("d4：project_restore_conflict");
    expect(node.querySelector("[data-archived-batch]")!.textContent).toContain("已选 1 个");
  });

  it("batch delete: the typed dialog names count and size; nothing without the word; refusals listed", async () => {
    fx.deleteSession.mockImplementation(async (id: string) => (id === "b2" ? { ok: false, error: { code: "session_busy", message: "busy" } } : { ok: true }));
    await mount();
    check("a1"); check("b2");
    fx.prompt.mockResolvedValueOnce(null);
    await act(async () => button(zhCN["archive.manage.delete"]).click());
    const [title, , options] = fx.prompt.mock.calls[0]!;
    expect(title).toMatch(/^永久删除 2 个.*（共 150 MiB）$/);
    expect(options).toMatchObject({ expect: "删除" });
    expect(fx.deleteSession).not.toHaveBeenCalled();
    fx.prompt.mockResolvedValueOnce("删除");
    await act(async () => button(zhCN["archive.manage.delete"]).click());
    await flush();
    expect(fx.deleteSession.mock.calls).toEqual([["a1", 3, "local"], ["b2", 3, "local"]]);
    const progress = node.querySelector("[data-archived-progress]")!;
    expect(progress.textContent).toContain("已永久删除 1 / 2 个");
    expect(progress.querySelector("[data-archived-failures]")!.textContent).toContain("b2");
  });

  it("without storage / usage capabilities: no figures, no reads", async () => {
    fx.features = new Set(["session-delete"]);
    await mount();
    expect(node.querySelector("[data-archived-figures]")).toBeNull();
    expect(fx.api.storageItems).not.toHaveBeenCalled();
    expect(node.querySelector("[data-archived-totals]")!.textContent).toBe("共 4 个");
  });
});

// Review 2026-11-24 (roster-bottom-review, boundary tests on 422d0dd11).
it("leaving the archived page stops follow-up storage pages", async () => {
  fx.features = new Set(["host-storage"]);
  let release!: (value: unknown) => void;
  fx.api.storageItems.mockReset().mockImplementationOnce(() => new Promise((r) => release = r)).mockResolvedValue(page([]));
  await mount(); expect(fx.api.storageItems).toHaveBeenCalledTimes(1);
  unmount(); unmount = () => {};
  release(page([], "next")); await flush(); await flush();
  expect(fx.api.storageItems).toHaveBeenCalledTimes(1);
});

it("an updated archived snapshot during an inflight read is eventually measured", async () => {
  let release!: (value: unknown) => void;
  fx.api.storageItems.mockReset().mockImplementationOnce(() => new Promise((r) => release = r)).mockResolvedValue(page([{ id: "b2", bytes: 20 }]));
  const first = loadArchivedStats("local", fx.api, [session("a1")], { size: true, usage: false });
  const changed = loadArchivedStats("local", fx.api, [session("a1"), session("b2")], { size: true, usage: false });
  release(page([{ id: "a1", bytes: 10 }])); await Promise.all([first, changed]);
  expect(useArchivedStats.getState().figures.local!["b2@3"]).toBeDefined();
});

it("restoring/deleting the final archived agent prunes its memory and persisted figures", async () => {
  await loadArchivedStats("local", fx.api, [session("a1")], { size: true, usage: false });
  await loadArchivedStats("local", fx.api, [], { size: true, usage: false });
  expect(Object.keys(useArchivedStats.getState().figures.local ?? {})).toEqual([]);
  expect(Object.keys(JSON.parse(localStorage.getItem("cutex-desktop.archivedStats.v1")!).figures.local ?? {})).toEqual([]);
});

it("delete freezes ids/revisions before the prompt, and skips explicitly unsupported agents", async () => {
  fx.features = new Set(["session-delete"]);
  const supported = session("yes", { revision: 17 });
  const unsupported = { ...session("no"), native: { schema: { protocol: "claude-app-server-subset", capabilities: { features: { threadDelete: false } } } } } as unknown as SessionResource;
  fx.archived = [supported, unsupported].map(row);
  let confirm!: (value: string) => void; fx.prompt.mockImplementationOnce(() => new Promise((r) => confirm = r));
  await mount(); check("yes"); check("no");
  act(() => button(zhCN["archive.manage.delete"]).click());
  expect(fx.prompt.mock.calls[0]![0]).toContain("1 个"); expect(fx.prompt.mock.calls[0]![2].hint).toContain("另有 1 个");
  // The chosen set is changed while confirmation is pending; the original id/revision must remain frozen.
  select(zhCN["archive.manage.when"], "older90d");
  await act(async () => confirm("删除")); await flush();
  expect(fx.deleteSession.mock.calls).toEqual([["yes", 17, "local"]]);
});

it("a running mounted batch disables duplicate clicks and never starts more than three calls", async () => {
  fx.features = new Set(["session-delete"]); fx.prompt.mockResolvedValue("删除");
  const pending: ((value: { ok: boolean }) => void)[] = [];
  fx.deleteSession.mockImplementation(() => new Promise((r) => pending.push(r)));
  await mount(); for (const id of rows()) check(id!);
  await act(async () => button(zhCN["archive.manage.delete"]).click()); await flush();
  expect(fx.deleteSession).toHaveBeenCalledTimes(3);
  const deleteButton = button(zhCN["archive.manage.delete"]); expect(deleteButton.disabled).toBe(true);
  act(() => { deleteButton.click(); deleteButton.click(); }); expect(fx.prompt).toHaveBeenCalledTimes(1);
  await act(async () => { for (const resolve of pending.splice(0)) resolve({ ok: true }); }); await flush();
  expect(fx.deleteSession).toHaveBeenCalledTimes(4);
  await act(async () => { for (const resolve of pending.splice(0)) resolve({ ok: true }); }); await flush();
});

it("reopening while a left page's read is still stopping reads again (an aborted read is not shared)", async () => {
  fx.features = new Set(["host-storage"]);
  let release!: (value: unknown) => void;
  fx.api.storageItems.mockReset().mockImplementationOnce(() => new Promise((r) => release = r)).mockResolvedValue(page([{ id: "a1", bytes: 7 }]));
  await mount(); unmount(); unmount = () => {};
  await mount();
  release(page([], "next")); await flush(); await flush();
  expect(useArchivedStats.getState().figures.local?.["a1@3"]?.bytes).toBe(7);
});

it("kept figures are bounded per host and in all; other hosts go oldest-read first", async () => {
  const many = Array.from({ length: 3100 }, (_, i) => session(`s${i}`));
  fx.api.storageItems.mockReset().mockResolvedValue(page([]));
  useArchivedStats.setState({ figures: { old: Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`o${i}@1`, { bytes: 1, files: 1, tokens: 0, turns: 0 }])) }, readAt: { old: 1 } });
  await loadArchivedStats("local", fx.api, many, { size: true, usage: false });
  const { figures } = useArchivedStats.getState();
  expect(Object.keys(figures.local!)).toHaveLength(3000);
  expect(figures.old).toBeUndefined();
});

it("copy: turns are 回合; the bulk delete prompt is destructive and says what it does", async () => {
  expect(zhCN["archive.manage.stats.tokens"]).toBe("{tokens} tokens · {turns} 个回合");
  expect(zhCN["archive.manage.row.turns"]).toBe("{n} 个回合");
  await mount(); check("a1");
  fx.prompt.mockResolvedValueOnce(null);
  await act(async () => button(zhCN["archive.manage.delete"]).click());
  expect(fx.prompt.mock.calls[0]![2]).toMatchObject({ danger: true, okLabel: "永久删除 1 个" });
});

// Re-review 2026-11-24 (roster-bottom-review, boundary tests on 6ed5d1dff).
it("a second live page sharing a read survives the first page leaving", async () => {
  const firstPage = new AbortController(), secondPage = new AbortController();
  let release!: (value: unknown) => void;
  fx.api.storageItems.mockReset().mockImplementationOnce(() => new Promise((r) => release = r)).mockResolvedValue(page([{ id: "a1", bytes: 30 }]));
  const sessions = [session("a1")];
  const first = loadArchivedStats("local", fx.api, sessions, { size: true, usage: false }, { signal: firstPage.signal });
  const second = loadArchivedStats("local", fx.api, sessions, { size: true, usage: false }, { signal: secondPage.signal });
  firstPage.abort(); release(page([], "next")); await Promise.all([first, second]);
  expect(secondPage.signal.aborted).toBe(false);
  expect(useArchivedStats.getState().figures.local?.["a1@3"]).toBeDefined();
});

it("an empty archived snapshot received during a read stays empty after that read completes", async () => {
  let release!: (value: unknown) => void;
  fx.api.storageItems.mockReset().mockImplementationOnce(() => new Promise((r) => release = r));
  const first = loadArchivedStats("local", fx.api, [session("a1")], { size: true, usage: false });
  const cleared = loadArchivedStats("local", fx.api, [], { size: true, usage: false });
  release(page([{ id: "a1", bytes: 30 }])); await Promise.all([first, cleared]);
  expect(Object.keys(useArchivedStats.getState().figures.local ?? {})).toEqual([]);
  expect(Object.keys(JSON.parse(localStorage.getItem("cutex-desktop.archivedStats.v1")!).figures.local ?? {})).toEqual([]);
});

it("the shared read stops once every page waiting for it has left", async () => {
  const one = new AbortController(), two = new AbortController();
  let release!: (value: unknown) => void;
  fx.api.storageItems.mockReset().mockImplementationOnce(() => new Promise((r) => release = r)).mockResolvedValue(page([{ id: "a1", bytes: 30 }]));
  const sessions = [session("a1")];
  const first = loadArchivedStats("local", fx.api, sessions, { size: true, usage: false }, { signal: one.signal });
  const second = loadArchivedStats("local", fx.api, sessions, { size: true, usage: false }, { signal: two.signal });
  one.abort(); two.abort(); release(page([], "next")); await Promise.all([first, second]);
  expect(fx.api.storageItems).toHaveBeenCalledTimes(1);
  expect(useArchivedStats.getState().figures.local?.["a1@3"]).toBeUndefined();
});

// Third review 2026-11-24 (roster-bottom-review, queue boundary on 23eba452c).
it("an older queued snapshot cannot supersede a newer empty archived list", async () => {
  let release!: (value: unknown) => void;
  fx.api.storageItems.mockReset().mockImplementationOnce(() => new Promise((r) => release = r)).mockResolvedValue(page([{ id: "b2", bytes: 20 }]));
  const first = loadArchivedStats("local", fx.api, [session("a1")], { size: true, usage: false });
  const queued = loadArchivedStats("local", fx.api, [session("a1"), session("b2")], { size: true, usage: false });
  const cleared = loadArchivedStats("local", fx.api, [], { size: true, usage: false });
  release(page([{ id: "a1", bytes: 10 }])); await Promise.all([first, queued, cleared]);
  expect(Object.keys(useArchivedStats.getState().figures.local ?? {})).toEqual([]);
  expect(Object.keys(JSON.parse(localStorage.getItem("cutex-desktop.archivedStats.v1")!).figures.local ?? {})).toEqual([]);
  expect(fx.api.storageItems).toHaveBeenCalledTimes(1);
});

it("random pages join, change the list and leave, reads fail at random: settled with a waiting page open and no failure, the cache is the newest list; nothing reads once settled or with no page left (seeded)", async () => {
  const pool = ["a1", "b2", "c3c", "d4", "e5", "f6"];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const seed of [1, 2, 3, 5, 7, 11, 13, 42, 99, 2026, 31337, 4242]) {
    resetArchivedStats();
    localStorage.clear();
    let x = seed;
    const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    // Every storage read answers after a random delay with every agent of the pool.
    // Storage and the usage ledger answer after random delays; each fails now and then (one failing must stop the other).
    // A request while the worker is stopped (loading off) is a read that went on after it stopped.
    let afterStop = 0;
    const stoppedNow = () => { if (!useArchivedStats.getState().loading.local) afterStop++; };
    // Storage answers in three pages (a read left running would ask for the next one).
    fx.api.storageItems.mockReset().mockImplementation((_store: string, q: { cursor?: string } = {}) => (stoppedNow(), new Promise((r, j) => setTimeout(() => {
      const at = Number(q.cursor ?? 0);
      if (rand() < 0.08) j(new Error("storage down"));
      else r(page(at === 2 ? pool.map((id) => ({ id, bytes: 1 })) : [], at < 2 ? String(at + 1) : null));
    }, 2 + Math.floor(rand() * 6)))));
    fx.api.usage.mockReset().mockImplementation(() => (stoppedNow(), new Promise((r, j) => setTimeout(() => (rand() < 0.1 ? j(new Error("ledger down")) : r({ rows: pool.map((agent) => ({ key: { agent }, total: 5, turns: 1 })) })), 1 + Math.floor(rand() * 8)))));
    const open: AbortController[] = [];
    const calls: Promise<void>[] = [];
    // Calls still waiting (not settled): when the newest list arrives, these and the newest call are its subscribers.
    const waiting = new Set<{ page: AbortController | null }>();
    let newest: { list: string[]; subscribers: { page: AbortController | null }[] } = { list: [], subscribers: [] };
    const request = (pageCtl: AbortController | null, force = false) => {
      const list = pool.filter(() => rand() < 0.5);
      const call = { page: pageCtl };
      waiting.add(call);
      newest = { list, subscribers: [...waiting] };
      calls.push(loadArchivedStats("local", fx.api, list.map((id) => session(id)), { size: true, usage: true }, { signal: pageCtl?.signal, force }).then(() => void waiting.delete(call)));
    };
    for (let step = 0; step < 40; step++) {
      const r = rand();
      if (r < 0.35 || !open.length) { const ctl = new AbortController(); open.push(ctl); request(ctl); }          // a page opens
      else if (r < 0.6) request(open[Math.floor(rand() * open.length)]!, rand() < 0.2);                           // a page sees a new list (or 重新统计)
      else open.splice(Math.floor(rand() * open.length), 1)[0]!.abort();                                         // a page leaves
      if (rand() < 0.4) await sleep(Math.floor(rand() * 4));
    }
    await Promise.all(calls);
    await sleep(20);
    const keys = Object.keys(useArchivedStats.getState().figures.local ?? {}).sort();
    // Settled: no read of either endpoint goes on (a failed one stopped the other too).
    const settled = [fx.api.storageItems.mock.calls.length, fx.api.usage.mock.calls.length];
    await sleep(30);
    expect([fx.api.storageItems.mock.calls.length, fx.api.usage.mock.calls.length], `seed ${seed}`).toEqual(settled);
    // A subscriber of the newest list that never left, and the last run did not fail: the cache is exactly that list.
    // Otherwise it stays within it.
    if (!useArchivedStats.getState().errors.local && newest.subscribers.some((c) => !c.page?.signal.aborted)) expect(keys, `seed ${seed}`).toEqual(newest.list.map((id) => `${id}@3`).sort());
    else for (const key of keys) expect(newest.list.map((id) => `${id}@3`), `seed ${seed}`).toContain(key);
    const saved = Object.keys(JSON.parse(localStorage.getItem("cutex-desktop.archivedStats.v1") ?? '{"figures":{}}').figures.local ?? {}).sort();
    expect(saved, `seed ${seed}`).toEqual(keys);
    // Every page leaves in the middle of a read: no read starts afterwards.
    const ctl = new AbortController();
    const last = loadArchivedStats("local", fx.api, pool.map((id) => session(id, { revision: 4 })), { size: true, usage: true }, { signal: ctl.signal, force: true });
    for (const page_ of open) page_.abort();
    ctl.abort();
    await last;
    const reads = [fx.api.storageItems.mock.calls.length, fx.api.usage.mock.calls.length];
    await sleep(30);
    expect([fx.api.storageItems.mock.calls.length, fx.api.usage.mock.calls.length], `seed ${seed}`).toEqual(reads);
    expect(afterStop, `seed ${seed}: reads after the worker stopped`).toBe(0);
  }
}, 30_000); // 12 seeded runs with real timers (≈ 4 s alone)
