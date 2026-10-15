import { describe, expect, it } from "vitest";
import { fieldsUnchanged, isRevisionConflict } from "../src/renderer/src/lib/metadataRetry";

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
});
