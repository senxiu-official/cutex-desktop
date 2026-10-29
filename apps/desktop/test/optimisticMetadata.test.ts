// @vitest-environment jsdom
// Setting a badge or a note is drawn at once (owner 2026-10-27 「设置徽章、备注很慢」): lib/menus updateAgentBadge /
// setAgentNote hold the new value over every sidebar snapshot until cutex answers (lib/pendingMetadata), roll back on
// a failure, and a conflict retry still compares against cutex's value, not the held one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";

const server = vi.hoisted(() => ({ sessions: [] as Record<string, unknown>[] }));
vi.mock("../src/renderer/src/bridge", () => ({
  api: { sidebar: async () => ({ active: server.sessions.map((s) => ({ ...s })), retired: [], hostRows: {}, projects: null }) },
  apiFor: () => ({}),
  onEvent: () => () => {},
}));

const { useApp, sidebarOf } = await import("../src/renderer/src/store");
const { setAgentNote, updateAgentBadge } = await import("../src/renderer/src/lib/menus");
const held = await import("../src/renderer/src/lib/pendingMetadata");

const shown = (id = "a") => sidebarOf(useApp.getState(), "local")!.active.find((s) => s.cutexSessionId === id)!;

/** One write cutex answers when the test says so (the write lands in `server` only on success). */
function slowWrites() {
  const calls: { params: Record<string, unknown>; ok(): Promise<void>; fail(e: Error): Promise<void> }[] = [];
  const sessionAction = vi.fn((id: string, _method: string, params: Record<string, unknown>) =>
    new Promise((resolve, reject) => {
      const settle = async (error: Error | null) => {
        if (!error) {
          const s = server.sessions.find((x) => x.cutexSessionId === id)!;
          const { expectedRevision: _r, ...fields } = params;
          Object.assign(s, fields, { revision: (s.revision as number) + 1 });
        }
        await useApp.getState().refreshSidebar(); // store sessionAction re-reads the sidebar before it settles
        if (error) reject(error);
        else resolve({});
      };
      calls.push({ params, ok: () => settle(null), fail: (e) => settle(e) });
    }),
  );
  useApp.setState({ sessionAction: sessionAction as never });
  return calls;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  held.resetHeldMetadata();
  server.sessions = [{ cutexSessionId: "a", displayName: "a", lifecycle: "active", revision: 3, note: "old", badge: { text: "旧", tint: "blue" }, runtime: { status: "offline", activeTurnId: null } }];
  useApp.setState({ features: new Set(["session-badge", "session-metadata"]), hosts: null, byHost: {}, sidebar: null });
  await useApp.getState().refreshSidebar();
});
afterEach(() => held.resetHeldMetadata());

describe("optimistic note / badge", () => {
  it("draws the new badge before cutex answers and keeps it over a refresh that lands meanwhile", async () => {
    const calls = slowWrites();
    const session = shown() as SessionResource;
    const done = updateAgentBadge(session, "local", { text: "HELP", tint: "pink" });
    expect(shown().badge).toEqual({ text: "HELP", tint: "pink" });
    await useApp.getState().refreshSidebar(); // an unrelated refresh (activity) brings cutex's old badge
    expect(shown().badge).toEqual({ text: "HELP", tint: "pink" });
    await flush();
    await calls[0]!.ok();
    await done;
    expect(shown().badge).toEqual({ text: "HELP", tint: "pink" });
    expect(held.heldFields("a")).toBeNull();
  });

  it("puts cutex's note back when the write fails and rejects with the reason", async () => {
    const calls = slowWrites();
    const done = setAgentNote(shown() as SessionResource, "local", "new note");
    expect(shown().note).toBe("new note");
    await flush();
    const failed = expect(done).rejects.toThrow("ssh tunnel closed");
    await calls[0]!.fail(new Error("ssh tunnel closed"));
    await failed;
    expect(shown().note).toBe("old");
    expect(held.heldFields("a")).toBeNull();
  });

  it("a revision conflict retries against cutex's value (not the held one) and lands", async () => {
    const calls = slowWrites();
    const done = setAgentNote(shown() as SessionResource, "local", "mine");
    await flush();
    // Another field moved the revision (a turn): conflict, nothing written.
    server.sessions[0]!.revision = 9;
    await calls[0]!.fail(new Error("revision_conflict: expected 3"));
    await new Promise((r) => setTimeout(r, 200)); // METADATA_RETRY_DELAYS_MS[0]
    expect(calls).toHaveLength(2);
    expect(calls[1]!.params.expectedRevision).toBe(9);
    expect(shown().note).toBe("mine");
    await calls[1]!.ok();
    await done;
    expect(shown().note).toBe("mine");
  });

  it("a second badge write while the first is in flight: the first failing leaves the second's value", async () => {
    const calls = slowWrites();
    const first = updateAgentBadge(shown() as SessionResource, "local", { text: "A", tint: "blue" });
    const second = updateAgentBadge({ ...(shown() as SessionResource) }, "local", { text: "B", tint: "green" });
    expect(shown().badge?.text).toBe("B");
    await flush();
    const firstFailed = expect(first).rejects.toThrow("boom");
    await calls[0]!.fail(new Error("boom"));
    await firstFailed;
    expect(shown().badge?.text).toBe("B");
    await calls[1]!.ok();
    await second;
    expect(shown().badge?.text).toBe("B");
  });
});

describe("lib/pendingMetadata", () => {
  const s = (note: string | null) => ({ cutexSessionId: "x", note }) as unknown as SessionResource;
  it("lays held fields over a snapshot, records cutex's values, and leaves untouched snapshots alone", () => {
    const snap = { active: [s("cutex")], retired: [], hostRows: {}, projects: null } as unknown as SidebarSnapshot;
    expect(held.snapshotWithHeld(snap)).toBe(snap);
    const token = held.holdMetadata("x", { note: "held" }, s("cutex"));
    const over = held.snapshotWithHeld(snap);
    expect(over).not.toBe(snap);
    expect(over.active[0]!.note).toBe("held");
    expect(snap.active[0]!.note).toBe("cutex"); // a copy, never patched in place
    held.snapshotWithHeld({ ...snap, active: [s("cutex2")] });
    expect(held.serverView(over.active[0]!).note).toBe("cutex2");
    expect(held.releaseMetadata("x", token)).toEqual({ note: "cutex2" });
    expect(held.snapshotWithHeld(snap)).toBe(snap);
  });
});
