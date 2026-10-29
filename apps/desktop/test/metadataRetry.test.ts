import { describe, expect, it, vi } from "vitest";
import { fieldsUnchanged, isRevisionConflict, isStoreConflict, writeMetadataRetrying } from "../src/renderer/src/lib/metadataRetry";

// The owner's banner (2026-10-23, 新建 → Maid): cutex's store-wide CAS lost to the new agent's startup events.
const STORE = "Error invoking remote method 'daemon:sessionAction': Error: event_persistence_unavailable: cutex session store revision conflict: expected 264720, current 264721; reload before retrying";
const SESSION = "Error: revision_conflict: session revision conflict: expected 20, current 21";
const noWait = { delays: [1, 1, 1], sleep: async () => {} };

describe("metadata revision retry", () => {
  it("recognises the session revision conflict after the IPC hop", () => {
    expect(isRevisionConflict(new Error("Error invoking remote method 'daemon:sessionAction': Error: revision_conflict: session revision conflict: expected 20, current 21"))).toBe(true);
    expect(isRevisionConflict(new Error("admission_revision_conflict: order changed"))).toBe(false);
    expect(isRevisionConflict(new Error("session_offline"))).toBe(false);
  });

  it("retries only while the edited fields are unchanged", () => {
    const before = { avatar: { kind: "emoji", value: "🦊" }, note: null };
    expect(fieldsUnchanged(before, { avatar: { kind: "emoji", value: "🦊" }, revision: 21 })).toBe(true);
    expect(fieldsUnchanged(before, { avatar: { kind: "emoji", value: "🐱" }, note: null })).toBe(false);
    expect(fieldsUnchanged({ displayNameOverride: null }, { displayNameOverride: "Eva" })).toBe(false);
  });

  it("tells cutex's store-wide CAS loss from the session revision conflict", () => {
    expect(isStoreConflict(new Error(STORE))).toBe(true);
    expect(isRevisionConflict(new Error(STORE))).toBe(false);
    expect(isStoreConflict(new Error(SESSION))).toBe(false);
    expect(isStoreConflict(new Error("event_persistence_unavailable: disk full"))).toBe(false);
  });

  it("a lost store CAS is retried after a re-read while the field is unchanged; the owner never sees it", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error(STORE)).mockRejectedValueOnce(new Error(STORE)).mockResolvedValueOnce({});
    const reread = vi.fn(async () => ({ avatar: null, revision: 4 }));
    await writeMetadataRetrying({ write, reread, before: { avatar: null }, changed: () => new Error("changed"), ...noWait });
    expect(write).toHaveBeenCalledTimes(3);
    expect(reread).toHaveBeenCalledTimes(2);
    // The retry gets the fresh session (a fenced writer takes its revision from it).
    expect(write.mock.calls[0]![0]).toBeNull();
    expect(write.mock.calls[1]![0]).toEqual({ avatar: null, revision: 4 });
  });

  it("no retry when the field changed meanwhile, the session is gone, or the error is something else", async () => {
    const changed = () => new Error("changed");
    const lost = () => vi.fn().mockRejectedValue(new Error(STORE));
    await expect(writeMetadataRetrying({ write: lost(), reread: async () => ({ avatar: { kind: "emoji", value: "🦊" } }), before: { avatar: null }, changed, ...noWait })).rejects.toThrow("changed");
    await expect(writeMetadataRetrying({ write: lost(), reread: async () => null, before: { avatar: null }, changed, ...noWait })).rejects.toThrow("changed");
    const other = vi.fn().mockRejectedValue(new Error("session_offline"));
    await expect(writeMetadataRetrying({ write: other, reread: async () => ({}), before: {}, changed, ...noWait })).rejects.toThrow("session_offline");
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last delay with the store error; the session conflict is retried only for fenced writes", async () => {
    const lost = vi.fn().mockRejectedValue(new Error(STORE));
    await expect(writeMetadataRetrying({ write: lost, reread: async () => ({ avatar: null }), before: { avatar: null }, changed: () => new Error("changed"), ...noWait })).rejects.toThrow("session store revision conflict");
    expect(lost).toHaveBeenCalledTimes(4);
    const moved = () => vi.fn().mockRejectedValueOnce(new Error(SESSION)).mockResolvedValueOnce({});
    const unfenced = moved();
    await expect(writeMetadataRetrying({ write: unfenced, reread: async () => ({}), before: {}, changed: () => new Error("changed"), ...noWait })).rejects.toThrow("revision_conflict");
    const fenced = moved();
    await writeMetadataRetrying({ write: fenced, reread: async () => ({}), before: {}, fenced: true, changed: () => new Error("changed"), ...noWait });
    expect(fenced).toHaveBeenCalledTimes(2);
  });
});

 it("avatar and mode retries share the conflict domain in both directions", async () => {
   expect(fieldsUnchanged({ avatar: null }, { avatar: null, avatarMode: "inherit" })).toBe(false);
   expect(fieldsUnchanged({ avatarMode: "fixed", avatar: null }, { avatarMode: "fixed", avatar: { kind: "emoji", value: "new" } })).toBe(false);
   const write = vi.fn().mockRejectedValue(new Error(SESSION));
   await expect(writeMetadataRetrying({ write, before: { avatar: null, avatarMode: null }, reread: async () => ({ avatar: null, avatarMode: "inherit" }), changed: () => new Error("mode changed"), fenced: true, ...noWait })).rejects.toThrow("mode changed");
   expect(write).toHaveBeenCalledTimes(1);
 });
