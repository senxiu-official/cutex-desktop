// IM-style sidebar and its avatar rail (2026-10-20): the sidebar's narrow store selectors (perf baseline
// H1 / fix 2: a streamed token changes nothing the list reads unless a row's preview, unread count or
// attention changes), the plain-text message preview, the unread count, the rail's agents and badges,
// and the rail toggle (Ctrl/⌘+B) with its prefs migration.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope, SessionResource } from "@cutex-desktop/protocol";
import { activityTimesOf, sessionsFingerprint, sessionsMetaOf, viewsOfHost, type ViewLike } from "../src/renderer/src/lib/sessionsMeta";
import { messageOf, nextPreview, plainPreview, previewFromResource, previewLine, type ActivityPreview } from "../src/renderer/src/lib/activity";
import { liveStatuses, pendingByAgent, type AgentRow, type AgentStatus, type ProjectGroup } from "../src/renderer/src/lib/sidebar";
import { applyTurnEnd, unreadCount, type TurnMarks } from "../src/renderer/src/lib/turnUnread";
import { layoutSidebar, type LayoutContext } from "../src/renderer/src/lib/sidebarLayout";
import { avatarBadge } from "../src/renderer/src/lib/avatarStatus";
import { viewKey } from "../src/renderer/src/lib/viewKey";

type View = ViewLike & { version: number; entries: string[] };

function view(over: Partial<View> = {}): View {
  return { loading: false, connection: "live", historySource: "live", timeline: { pending: new Map(), activeTurnId: null }, version: 1, entries: [], ...over };
}

/** A streamed token as the store applies it: the timeline mutated in place, the view and `sessions` replaced. */
function token(sessions: Record<string, View>, key: string, text: string): Record<string, View> {
  const v = sessions[key]!;
  v.entries.push(text);
  return { ...sessions, [key]: { ...v, version: v.version + 1 } };
}

describe("sessionsMetaOf (the sidebar's view of `sessions`)", () => {
  const eva = viewKey("local", "eva");
  const mika = viewKey("local", "mika");
  const other = viewKey("ssh-b", "eva");

  it("keeps the same object across streamed tokens (nothing a row shows changed)", () => {
    let sessions: Record<string, View> = { [eva]: view({ timeline: { pending: new Map(), activeTurnId: "t1" } }), [mika]: view() };
    const first = sessionsMetaOf(sessions);
    for (let i = 0; i < 50; i++) {
      sessions = token(sessions, eva, `delta ${i}`);
      expect(sessionsMetaOf(sessions)).toBe(first);
    }
  });

  it("changes when a request starts waiting (需要你 / ⚠ stay live) and copies the in-place timeline", () => {
    const pending = new Map<string, { method: string }>();
    let sessions: Record<string, View> = { [eva]: view({ timeline: { pending, activeTurnId: "t1" } }) };
    const before = sessionsMetaOf(sessions);
    expect(pendingByAgent(viewsOfHost(before, "local"))).toEqual({});
    // The store mutates the pending map in place and bumps the version.
    pending.set("7", { method: "item/commandExecution/requestApproval" });
    sessions = token(sessions, eva, "");
    const after = sessionsMetaOf(sessions);
    expect(after).not.toBe(before);
    expect(pendingByAgent(viewsOfHost(after, "local"))).toEqual({ eva: ["item/commandExecution/requestApproval"] });
    // The projection is a copy: answering it changes the next projection, not this one.
    pending.delete("7");
    sessions = token(sessions, eva, "");
    expect(viewsOfHost(after, "local").eva!.timeline.pending.size).toBe(1);
    expect(viewsOfHost(sessionsMetaOf(sessions), "local").eva!.timeline.pending.size).toBe(0);
  });

  it("changes when a turn starts / ends, the feed reconnects or a view comes or goes", () => {
    let sessions: Record<string, View> = { [eva]: view() };
    let last = sessionsMetaOf(sessions);
    const changed = (next: Record<string, View>) => {
      sessions = next;
      const meta = sessionsMetaOf(sessions);
      const did = meta !== last;
      last = meta;
      return did;
    };
    expect(changed({ ...sessions, [eva]: view({ timeline: { pending: new Map(), activeTurnId: "t2" } }) })).toBe(true);
    expect(liveStatuses(viewsOfHost(last, "local")).get("eva")).toBe("running");
    expect(changed({ ...sessions, [eva]: view({ connection: "retrying", timeline: { pending: new Map(), activeTurnId: "t2" } }) })).toBe(true);
    expect(changed({ ...sessions, [other]: view() })).toBe(true);
    expect(Object.keys(viewsOfHost(last, "ssh-b"))).toEqual(["eva"]);
    expect(changed({ ...sessions })).toBe(false);
  });

  it("fingerprints only what rows show", () => {
    const a = { [eva]: view({ version: 1 }) };
    const b = { [eva]: view({ version: 99, entries: ["x"] }) };
    expect(sessionsFingerprint(a)).toBe(sessionsFingerprint(b));
    expect(sessionsFingerprint({ [eva]: view({ loading: true }) })).not.toBe(sessionsFingerprint(a));
  });
});

describe("activityTimesOf (idle fold / offline order)", () => {
  it("stays the same object while a stream refreshes previews within the minute", () => {
    const base = Date.UTC(2026, 9, 20, 10, 0, 5);
    const t0 = activityTimesOf({ eva: { at: base }, mika: { at: base - 3_600_000 } });
    expect(activityTimesOf({ eva: { at: base + 20_000 }, mika: { at: base - 3_600_000 } })).toBe(t0);
    const t1 = activityTimesOf({ eva: { at: base + 70_000 }, mika: { at: base - 3_600_000 } });
    expect(t1).not.toBe(t0);
    expect(t1.eva).toBe(base + 70_000);
    expect(activityTimesOf({ eva: { at: base + 70_000 }, mika: { at: base - 3_600_000 }, kai: { at: base } })).not.toBe(t1);
  });
});

describe("row signals: needs-you and the unread count", () => {
  const session = (id: string) => ({ cutexSessionId: id, displayName: id, runtime: {} }) as unknown as SessionResource;
  const row = (id: string, status: AgentStatus): AgentRow => ({ id, name: id, subtitle: "", status, isDirector: false, pinned: false, lastActivity: 0, profile: null, color: null, session: session(id) });

  it("an unchanged row keeps its signal; a needs-you or unread change reaches it", () => {
    const project: ProjectGroup = { kind: "project", id: "p", name: "p", badge: "", color: "blue", online: [row("eva", "running"), row("mika", "idle")], offline: [] };
    const signals = new Map<string, "running" | "needsYou" | "done">([["eva", "running"]]);
    const ctx: LayoutContext = { signalOf: (k) => signals.get(k), selectedId: null, starred: new Set(), prefs: { grouping: "all", noOnline: "collapse", running: "full" } };
    const before = layoutSidebar([project], ctx).main[0]!;
    expect(before.big.map((r) => r.id)).toContain("eva");
    signals.set("mika", "needsYou");
    expect(layoutSidebar([project], ctx).main[0]!.needsYouCount).toBe(1);
    // Unread: each unseen finished turn counts.
    let marks: TurnMarks = {};
    marks = applyTurnEnd(marks, "mika", { turnId: "t1", status: "completed" }, 1, false);
    marks = applyTurnEnd(marks, "mika", { turnId: "t2", status: "completed" }, 2, false);
    expect(unreadCount(marks.mika)).toBe(2);
    expect(unreadCount({ at: 1, failed: false, turnId: null })).toBe(1);
    expect(unreadCount(undefined)).toBe(0);
    marks = applyTurnEnd(marks, "mika", { turnId: "t3", status: "completed" }, 3, true);
    expect(unreadCount(marks.mika)).toBe(0);
  });
});

function ev(method: string, params: unknown): EventEnvelope {
  return {
    contractVersion: 2, eventId: "e", cursor: "c", streamId: "s", sequence: 1, receivedAt: "2026-10-20T00:00:00Z",
    cutexSessionId: "a", hostId: "h", source: "app_server", sensitivity: "owner", correlation: {},
    native: { kind: "notification", message: { method, params } },
  } as EventEnvelope;
}

describe("message preview", () => {
  it("strips Markdown to one line of plain text", () => {
    expect(plainPreview("## 结果\n\n- **全部**通过：`pnpm test`\n- 见 [日志](http://x/y)\n\n```ts\nconst a = 1;\n```")).toBe("结果 全部通过：pnpm test 见 日志 const a = 1;");
    expect(plainPreview("> quoted *emphasis* and __bold__, 2 * 3 = 6")).toBe("quoted emphasis and bold, 2 * 3 = 6");
    expect(plainPreview("![图](a.png) done ~~old~~")).toBe("图 done old");
    const once = plainPreview("1. one\n2. two");
    expect(once).toBe("one two");
    expect(plainPreview(once)).toBe(once);
  });

  it("the owner's message, then the reply; a tool step keeps the last message", () => {
    let p: ActivityPreview | undefined = nextPreview(undefined, ev("item/started", { item: { type: "userMessage", id: "u1", content: [{ type: "text", text: "跑一下\n测试" }] } }));
    expect(p).toMatchObject({ kind: "input", text: "跑一下 测试" });
    p = nextPreview(p, ev("item/started", { item: { type: "commandExecution", id: "c1", command: "pnpm test" } })) ?? p;
    expect(p).toMatchObject({ kind: "tool", text: "$ pnpm test" });
    expect(messageOf(p)).toMatchObject({ kind: "input", text: "跑一下 测试" });
    // Running: the current step; idle: the last message.
    expect(previewLine(p, true)).toMatchObject({ kind: "tool", text: "$ pnpm test" });
    expect(previewLine(p, false)).toMatchObject({ kind: "input", text: "跑一下 测试" });
    for (const delta of ["**全部", "**通过"]) p = nextPreview(p, ev("item/agentMessage/delta", { itemId: "m1", delta })) ?? p;
    expect(previewLine(p, true)).toEqual({ kind: "output", text: "全部通过", at: p!.at });
    p = nextPreview(p, ev("item/completed", { item: { type: "agentMessage", id: "m1", text: "## 好了\n- **全部**通过" } })) ?? p;
    expect(p).toMatchObject({ kind: "output", text: "好了 全部通过" });
    expect(previewLine(undefined, false)).toBeNull();
  });

  it("seeds from the session's projection: a newer tool call keeps the last reply as the message", () => {
    const session = { activity: { lastOutput: { displayText: "**完成**了", updatedAt: "2026-10-20T00:00:00Z" }, lastToolCall: { displayText: "$ ls", updatedAt: "2026-10-20T00:01:00Z" } } } as unknown as SessionResource;
    const p = previewFromResource(session)!;
    expect(p.kind).toBe("tool");
    expect(previewLine(p, false)).toMatchObject({ kind: "output", text: "完成了" });
  });
});

describe("avatar rail", () => {
  it("badges (lib/avatarStatus): needs-you ? / ! / count, error !, unread count; running and idle have none", () => {
    expect(avatarBadge("needsYou", { count: 1, reasons: ["approval"] }, 0)).toEqual({ tone: "attention", text: "!" });
    expect(avatarBadge("needsYou", { count: 1, reasons: ["question"] }, 0)).toEqual({ tone: "attention", text: "?" });
    expect(avatarBadge("needsYou", { count: 3, reasons: ["question", "approval", "check"] }, 0)).toEqual({ tone: "attention", text: "3" });
    expect(avatarBadge("error", undefined, 0)).toEqual({ tone: "danger", text: "!" });
    expect(avatarBadge("done", undefined, 2)).toEqual({ tone: "accent", text: "2" });
    expect(avatarBadge("done", undefined, 140)).toEqual({ tone: "accent", text: "99+" });
    expect(avatarBadge("running", undefined, 0)).toBeNull();
    expect(avatarBadge("idle", undefined, 0)).toBeNull();
  });
});

describe("rail toggle (Ctrl/⌘+B) and prefs", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  });

  it("toggles full ↔ rail and remembers it on this device", async () => {
    const prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.getUiPrefs().sidebarRail).toBe(false);
    prefs.toggleSidebarRail();
    expect(prefs.getUiPrefs()).toMatchObject({ sidebarOpen: true, sidebarRail: true });
    expect(JSON.parse(storage.get("cutex-desktop.ui")!).sidebarRail).toBe(true);
    vi.resetModules();
    const again = await import("../src/renderer/src/lib/prefs");
    expect(again.getUiPrefs().sidebarRail).toBe(true);
    again.toggleSidebarRail();
    expect(again.getUiPrefs().sidebarRail).toBe(false);
  });

  it("a sidebar stored hidden comes back as the rail; 消息预览 defaults to every row", async () => {
    storage.set("cutex-desktop.ui", JSON.stringify({ sidebarOpen: false, rowPreview: "director" }));
    const prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.getUiPrefs()).toMatchObject({ sidebarOpen: true, sidebarRail: true, rowPreview: "all" });
    expect(prefs.migrateRowPreview("director", 1)).toBe("director");
    expect(prefs.migrateRowPreview("off", undefined)).toBe("off");
    expect(prefs.migrateRowPreview(undefined, undefined)).toBe("all");
    expect(prefs.migrateSidebarRail({ sidebarRail: true })).toEqual({ sidebarOpen: true, sidebarRail: true });
    expect(prefs.migrateSidebarRail({})).toEqual({ sidebarOpen: true, sidebarRail: false });
  });
});
