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
