import { describe, expect, it } from "vitest";
import { carriedInputs, carriedReceivedRow } from "./carries";
import { record } from "./testkit";

const owner = record("owner", { kind: "owner", surface: "timeline", turnId: "turn1", carries: ["notice", "result"] });
const notice = record("notice", { kind: "systemNotice", surface: "timeline", turnId: "turn1", reason: "carriedByOwner", state: "inContext" });
const result = record("result", { kind: "delegationResult", surface: "timeline", turnId: "turn1", reason: "carriedByOwner", state: "accepted", stage: "offered" });
const records = (...rows: ReturnType<typeof record>[]) => new Map(rows.map(row => [row.inputId, row]));

describe("057 owner carries", () => {
  it("keeps daemon order and joins carried notices only once", () => {
    const joined = carriedInputs(records(result, notice, owner), true);
    expect(joined.byOwner.get("owner")).toEqual([notice, result]);
    expect([...joined.inputIds]).toEqual(["notice", "result"]);
  });

  it("retains old-host behavior without the capability", () => {
    expect(carriedInputs(records(owner, notice), false).inputIds.size).toBe(0);
  });

  it("does not hide rows when an endpoint is missing or the owner is still nextUp", () => {
    expect(carriedInputs(records(notice), true).inputIds.size).toBe(0);
    expect(carriedInputs(records({ ...owner, surface: "nextUp" }, notice), true).inputIds.size).toBe(0);
    expect(carriedInputs(records(owner), true).byOwner.size).toBe(0);
  });

  it("leaves nextUp, other-turn and unrelated inputs on their authoritative surfaces", () => {
    for (const patch of [{ surface: "nextUp" as const }, { turnId: "turn2" }, { reason: "nextStep" }, { cutexSessionId: "other" }]) {
      expect(carriedInputs(records(owner, { ...notice, ...patch }), true).inputIds.size).toBe(0);
    }
  });

  it("cannot attach owner messages or infer a join from a matching turn", () => {
    expect(carriedInputs(records(owner, { ...notice, kind: "owner" }), true).inputIds.size).toBe(0);
    expect(carriedInputs(records({ ...owner, carries: undefined }, notice), true).inputIds.size).toBe(0);
  });
});


it("keeps a shared native row until every represented input has a hydrated card", () => {
  const entry = { kind: "received", id: "shared" } as any;
  const index = { byItemId: new Map([["shared", [notice, result]]]), byInputId: new Map() };
  expect(carriedReceivedRow(entry, index, new Set(["notice"]))).toBe(false);
  expect(carriedReceivedRow(entry, index, new Set(["notice", "result"]))).toBe(true);
  expect(carriedReceivedRow({ kind: "received", id: "unknown" } as any, index, new Set(["notice", "result"]))).toBe(false);
  expect(carriedReceivedRow({ kind: "user", id: "shared" } as any, index, new Set(["notice", "result"]))).toBe(false);
});
