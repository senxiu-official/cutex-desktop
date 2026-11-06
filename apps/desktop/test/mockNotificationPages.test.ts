import { describe, expect, it, vi } from "vitest";
import type { OwnerNotification } from "@cutex-desktop/protocol";
import { asRecord } from "../src/shared/ownerNotify";
import { mockNotificationPage } from "../src/renderer/src/dev/mockNotificationPages";
const row = (id: string, text = "a", agentId = "eva") => asRecord({ notificationId: id, agentId, text, level: "info", state: "open", createdAt: "2026-11-04T00:00:00Z" })!;
describe("byte-bounded preview pages", () => {
  it("caps three rows, uses stable ID tie boundaries, and covers all rows once", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`ntf-${i}`));
    let cursor: string | undefined; const received: string[] = [];
    do { const page = mockNotificationPage(rows, { agentId: "eva", limit: 50, cursor }); expect(page.notifications.length).toBeLessThanOrEqual(3); received.push(...page.notifications.map(r => r.notificationId)); cursor = page.nextCursor; } while (cursor);
    expect(received).toEqual(rows.map(r => r.notificationId).sort().reverse());
  });
  it("a byte-short page and a single oversized record still have continuation", () => {
    const rows = [row("ntf-3", "x".repeat(2500)), row("ntf-2", "y".repeat(5000)), row("ntf-1")];
    const first = mockNotificationPage(rows, { limit: 50 }); expect(first.notifications).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    const second = mockNotificationPage(rows, { cursor: first.nextCursor }); expect(second.notifications.map(r => r.notificationId)).toEqual(["ntf-2"]); expect(second.nextCursor).toBeTruthy();
    const third = mockNotificationPage(rows, { cursor: second.nextCursor }); expect(third.notifications.map(r => r.notificationId)).toEqual(["ntf-1"]); expect(third.nextCursor).toBeUndefined();
  });
  it("keeps source fields for owner and safety cards, and skips new rows above the boundary", () => {
    const first = mockNotificationPage([row("ntf-2"), row("ntf-1")], { agentId: "eva", limit: 1 });
    const safety = { ...row("ntf-1"), turnId: "old-turn", systemKind: "safetyBlock", origin: "system" } as OwnerNotification;
    const second = mockNotificationPage([row("ntf-3"), safety], { agentId: "eva", cursor: first.nextCursor }); expect(second.notifications).toEqual([safety]);
  });
  it("applies filter and agent scope, and rejects malformed/wrong-scope cursors", () => {
    const rows = [row("ntf-3"), row("ntf-2"), row("ntf-mika", "a", "mika")];
    const first = mockNotificationPage(rows, { agentId: "eva", limit: 1 }); expect(first.notifications.map(r => r.agentId)).toEqual(["eva"]);
    expect(mockNotificationPage(rows, { filter: "pending" }).notifications).toEqual([]);
    expect(() => mockNotificationPage(rows, { cursor: "broken" })).toThrow("invalid_cursor");
    expect(() => mockNotificationPage(rows, { agentId: "mika", cursor: first.nextCursor })).toThrow("invalid_cursor");
    expect(() => mockNotificationPage(rows, { agentId: "eva", filter: "pending", cursor: first.nextCursor })).toThrow("invalid_cursor");
  });
});

it("?s10pages shares owner and safety notification sources; history reveals older safety cards", async () => {
  vi.resetModules(); vi.stubGlobal("location", { search: "?s10pages" });
  try {
    const { mock: owner } = await import("../src/renderer/src/modules/owner-notify/mock");
    const { mock: safety } = await import("../src/renderer/src/modules/safety-grants/mock");
    const helpers = await import("../src/renderer/src/dev/mockNotificationPages");
    const core = { legacy: false, emitCutex: vi.fn(), settingsView: vi.fn(), ownerNotificationPages: {
      register: helpers.registerMockOwnerNotes, rows: helpers.mockNotificationRows, page: helpers.mockNotificationPage,
    } } as never;
    const api = owner.api!(core);
    safety.api!(core);
    const loaded: OwnerNotification[] = []; let cursor: string | undefined;
    do {
      const page = await api.ownerNotificationsPage!({ agentId: "ifm-plot", filter: "all", limit: 50, cursor });
      expect(page.notifications.length).toBeLessThanOrEqual(3); loaded.push(...page.notifications); cursor = page.nextCursor;
    } while (cursor);
    expect(loaded).toHaveLength(7); expect(new Set(loaded.map(r => r.notificationId)).size).toBe(7);
    expect(loaded.every(r => r.systemKind === "safetyBlock" && r.safetyBlock)).toBe(true);
    const bootstrap = safety.cutexState!("ifm-plot", core).ownerNotifications as OwnerNotification[];
    expect(bootstrap.length).toBeLessThan(loaded.length); expect(loaded.at(-1)!.notificationId).toBe("ntf-sb-mock-7");
    expect(owner.features?.new ?? []).toEqual([]);
  } finally { vi.unstubAllGlobals(); }
});
it("non-scene page API remains available without the three-row demonstration cap", () => {
  const rows = Array.from({ length: 7 }, (_, i) => row(`ntf-${i}`));
  expect(mockNotificationPage(rows, { limit: 50 }, false).notifications).toHaveLength(7);
});
