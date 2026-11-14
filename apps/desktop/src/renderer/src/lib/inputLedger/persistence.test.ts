import { describe, expect, it, vi } from "vitest";
import { acknowledgeLedgerOutbox, loadLedgerOutbox, persistLedgerOutbox } from "./outbox";
import { migrateLegacyDelivery } from "./migration";
import type { LedgerOwnerOutbox } from "./owner";
import { record } from "./testkit";

function memory(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); }, clear: () => data.clear() };
}
function draft(inputId: string, hostId = "eva"): LedgerOwnerOutbox {
  return { inputId, hostId, sessionId: "s", text: `Full message ${inputId}`, extra: [], strategy: "auto", createdAt: "2026-11-02T00:00:00Z", phase: "sending" };
}

describe("O0 crash recovery", () => {
  it("preserves separate writers and hosts and removes only the authoritative id", () => {
    const target = memory();
    for (const item of [draft("a"), draft("b"), draft("a", "hachimi")]) expect(persistLedgerOutbox(item, target)).toBe(true);
    acknowledgeLedgerOutbox("eva", "s", "a", target);
    expect(loadLedgerOutbox(target).map(e => [e.hostId, e.inputId, e.phase])).toEqual([["eva", "b", "unconfirmed"], ["hachimi", "a", "unconfirmed"]]);
  });
  it("ignores malformed entries without erasing a valid draft", () => {
    const target = memory();
    persistLedgerOutbox(draft("a"), target);
    target.setItem("cutex-desktop.inputLedger.o0.v1:bad", "{broken");
    expect(loadLedgerOutbox(target).map(e => e.inputId)).toEqual(["a"]);
    expect(target.length).toBe(2);
  });
  it("keeps the first-request prediction across a crash", () => {
    const target = memory();
    persistLedgerOutbox({ ...draft("offline"), predictedSurface: "nextUp" }, target);
    expect(loadLedgerOutbox(target)[0]).toMatchObject({ inputId: "offline", predictedSurface: "nextUp", phase: "unconfirmed" });
  });
});

describe("054 one-time migration", () => {
  it("recovers missing steers without resend, uses CAS dismiss and preserves legacy hosts", async () => {
    const target = memory();
    const source = { "eva\ns": { at: 1, steers: [{ id: "missing", text: "Do not lose this", extra: [{ type: "text", text: "attachment" }] }] },
      "hachimi\ns": { at: 2, steers: [{ id: "old-host", text: "keep" }] } };
    target.setItem("cutex-desktop.pendingSteers.v1", JSON.stringify(source));
    target.setItem("cutex-desktop.hiddenRows", JSON.stringify(["note:eva/bus", "ask:hachimi/legacy", "ask:eva/other-session"]));
    const bus = record("bus", { kind: "agentMessage", state: "uncertain", actions: ["dismiss"], rev: 7 });
    const api = { inputGet: vi.fn(async () => ({ ledgerEpoch: "e", stateRevision: 4, records: [bus], missing: ["missing", "other-session"] })), inputDismiss: vi.fn(async () => ({})) };
    const result = await migrateLegacyDelivery("eva", "s", api, target);
    expect(result.recovered[0]?.text).toBe("Do not lose this");
    expect(loadLedgerOutbox(target)[0]?.text).toBe("Do not lose this");
    expect(api.inputDismiss).toHaveBeenCalledExactlyOnceWith("s", "bus", 7);
    expect(JSON.parse(target.getItem("cutex-desktop.pendingSteers.v1")!)).toEqual({ "hachimi\ns": source["hachimi\ns"] });
    expect(JSON.parse(target.getItem("cutex-desktop.hiddenRows")!)).toEqual(["ask:hachimi/legacy", "ask:eva/other-session"]);
    await migrateLegacyDelivery("eva", "s", api, target);
    expect(api.inputGet).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["HTTP 200 with failed[]", () => vi.fn(async () => ({ failed: [{ inputId: "bus", code: "dismiss_failed", message: "result admission busy" }] }))],
    ["a rejected call", () => vi.fn().mockRejectedValue(new Error("offline"))],
  ])("a hidden row the host did not dismiss (%s) keeps its old marker and the migration stays open", async (_name, dismiss) => {
    const target = memory();
    target.setItem("cutex-desktop.hiddenRows", JSON.stringify(["note:eva/bus"]));
    const bus = record("bus", { kind: "agentMessage", state: "uncertain", actions: ["dismiss"], rev: 7 });
    const api = { inputGet: vi.fn(async () => ({ ledgerEpoch: "e", stateRevision: 4, records: [bus], missing: [] })), inputDismiss: dismiss() };
    const result = await migrateLegacyDelivery("eva", "s", api, target);
    expect(result.notDismissed).toEqual(["bus"]);
    expect(JSON.parse(target.getItem("cutex-desktop.hiddenRows")!)).toEqual(["note:eva/bus"]);
    // Not marked done: the next start tries again, and a success then finishes it.
    api.inputDismiss = vi.fn(async () => ({}));
    const again = await migrateLegacyDelivery("eva", "s", api, target);
    expect(api.inputGet).toHaveBeenCalledTimes(2);
    expect(again.notDismissed).toBeUndefined();
    expect(target.getItem("cutex-desktop.hiddenRows")).toBeNull();
  });
  it("a hidden row the host does not offer dismiss for yet keeps its old marker; applied once dismiss is offered", async () => {
    const target = memory();
    target.setItem("cutex-desktop.hiddenRows", JSON.stringify(["ask:eva/req", "note:eva/done"]));
    let req = record("req", { kind: "delegationRequest", state: "waiting", reason: "targetBusy", surface: "nextUp", actions: [], rev: 3 });
    const done = record("done", { kind: "agentMessage", state: "inContext", surface: "timeline", actions: [] });
    const api = { inputGet: vi.fn(async () => ({ ledgerEpoch: "e", stateRevision: 4, records: [req, done], missing: [] })), inputDismiss: vi.fn(async () => ({})) };
    const first = await migrateLegacyDelivery("eva", "s", api, target);
    expect(api.inputDismiss).not.toHaveBeenCalled();
    expect(first.notDismissed).toEqual(["req"]);
    // The finished one is satisfied; the unapplied one keeps its marker and the migration is not done.
    expect(JSON.parse(target.getItem("cutex-desktop.hiddenRows")!)).toEqual(["ask:eva/req"]);
    req = { ...req, actions: ["dismiss"] };
    const second = await migrateLegacyDelivery("eva", "s", api, target);
    expect(api.inputGet).toHaveBeenCalledTimes(2);
    expect(api.inputDismiss).toHaveBeenCalledExactlyOnceWith("s", "req", 3);
    expect(second.notDismissed).toBeUndefined();
    expect(target.getItem("cutex-desktop.hiddenRows")).toBeNull();
  });
  it("with input-disposal-v1 an old hide decision is applied by dispose (any record); only an applied receipt clears its marker", async () => {
    const target = memory();
    target.setItem("cutex-desktop.hiddenRows", JSON.stringify(["ask:eva/req", "note:eva/note"]));
    const req = record("req", { kind: "delegationRequest", state: "sending", surface: "nextUp", actions: [], rev: 3 });
    const note = record("note", { kind: "agentMessage", state: "waiting", reason: "turnRunning", surface: "nextUp", actions: ["dismiss"], rev: 2 });
    const receipt = (inputId: string, appliedAt: string | null) => ({ inputId, cutexSessionId: "s", dispositionId: `d-${inputId}`, requestedAt: "2026-11-14T00:00:00Z", appliedAt, effect: "stop" });
    let applied = false;
    const api = {
      inputGet: vi.fn(async () => ({ ledgerEpoch: "e", stateRevision: 4, records: [req, note], missing: [] })),
      inputDismiss: vi.fn(async () => ({})),
      inputDispose: vi.fn(async (_s: string, id: string) => receipt(id, id === "note" || applied ? "2026-11-14T00:00:01Z" : null)),
    };
    // Accepted but not applied yet (req): its marker stays and the migration stays open; note is applied.
    const first = await migrateLegacyDelivery("eva", "s", api, target, [], { disposal: true });
    expect(api.inputDismiss).not.toHaveBeenCalled();
    expect(api.inputDispose.mock.calls.map(c => c[1]).sort()).toEqual(["note", "req"]);
    expect(first.notDismissed).toEqual(["req"]);
    expect(JSON.parse(target.getItem("cutex-desktop.hiddenRows")!)).toEqual(["ask:eva/req"]);
    // A failed call keeps it too.
    api.inputDispose.mockRejectedValueOnce(new Error("busy"));
    expect((await migrateLegacyDelivery("eva", "s", api, target, [], { disposal: true })).notDismissed).toEqual(["req"]);
    // Next start, the host has applied it: the marker goes and the migration completes.
    applied = true;
    const third = await migrateLegacyDelivery("eva", "s", api, target, [], { disposal: true });
    expect(third.notDismissed).toBeUndefined();
    expect(target.getItem("cutex-desktop.hiddenRows")).toBeNull();
  });
  it("keeps all source data after a failed authoritative read", async () => {
    const target = memory();
    const source = JSON.stringify({ "eva\ns": { at: 1, steers: [{ id: "a", text: "keep" }] } });
    target.setItem("cutex-desktop.pendingSteers.v1", source);
    const api = { inputGet: vi.fn().mockRejectedValue(new Error("offline")), inputDismiss: vi.fn() };
    await expect(migrateLegacyDelivery("eva", "s", api, target)).rejects.toThrow("offline");
    expect(target.getItem("cutex-desktop.pendingSteers.v1")).toBe(source);
    expect(api.inputDismiss).not.toHaveBeenCalled();
  });
  it("respects a newer explicit restore rather than dismissing the row", async () => {
    const target = memory(), suffix = JSON.stringify(["eva", "s"]);
    target.setItem("cutex-desktop.hiddenBusReceipts.v1:" + suffix, JSON.stringify(["bus"]));
    target.setItem('cutex-desktop.busReceiptVisibility.v2:["eva","s","bus","window-a"]', JSON.stringify({ version: 2, revision: 2, state: "hidden" }));
    target.setItem('cutex-desktop.busReceiptVisibility.v2:["eva","s","bus","window-b"]', JSON.stringify({ version: 2, revision: 3, state: "restored" }));
    const api = { inputGet: vi.fn(), inputDismiss: vi.fn() };
    await migrateLegacyDelivery("eva", "s", api, target);
    expect(api.inputGet).not.toHaveBeenCalled();
    expect(api.inputDismiss).not.toHaveBeenCalled();
  });
  it("does not clear a different pending send added while migration is reading", async () => {
    const target = memory();
    const a = { id: "a", text: "old" }, b = { id: "b", text: "new" };
    target.setItem("cutex-desktop.pendingSteers.v1", JSON.stringify({ "eva\ns": { at: 1, steers: [a] } }));
    const api = { inputGet: vi.fn(async () => {
      target.setItem("cutex-desktop.pendingSteers.v1", JSON.stringify({ "eva\ns": { at: 2, steers: [a, b] } }));
      return { ledgerEpoch: "e", stateRevision: 1, records: [record("a")], missing: [] };
    }), inputDismiss: vi.fn() };
    await migrateLegacyDelivery("eva", "s", api, target);
    expect(JSON.parse(target.getItem("cutex-desktop.pendingSteers.v1")!)["eva\ns"].steers).toEqual([b]);
  });
  it("also recovers an in-memory failed outbox after a host gains the capability", async () => {
    const target = memory();
    target.setItem('cutex-desktop.inputLedger.migrated.v1:["eva","s"]', "1");
    const api = { inputGet: vi.fn(async () => ({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: ["orphan"] })), inputDismiss: vi.fn() };
    const result = await migrateLegacyDelivery("eva", "s", api, target, [draft("orphan")]);
    expect(result.recovered.map(e => e.inputId)).toEqual(["orphan"]);
    expect(loadLedgerOutbox(target)[0]?.text).toBe("Full message orphan");
  });
  it("keeps the legacy source if writing the recovered O0 would exceed storage quota", async () => {
    const target = memory();
    const source = JSON.stringify({ "eva\ns": { at: 1, steers: [{ id: "a", text: "keep original" }] } });
    target.setItem("cutex-desktop.pendingSteers.v1", source);
    const write = target.setItem;
    target.setItem = (key, value) => { if (key.startsWith("cutex-desktop.inputLedger.o0.v1:")) throw Error("quota"); write(key, value); };
    const api = { inputGet: vi.fn(async () => ({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: ["a"] })), inputDismiss: vi.fn() };
    await expect(migrateLegacyDelivery("eva", "s", api, target)).rejects.toThrow("input_migration_storage_full");
    expect(target.getItem("cutex-desktop.pendingSteers.v1")).toBe(source);
  });
});
