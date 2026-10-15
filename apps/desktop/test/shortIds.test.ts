// Short cutex ids in agent-facing tool text (cutex task 06). Samples are taken from the cutex
// task 06 tests (src/short_ids.rs, src/asks/short_ids.rs, src/short_ids/render_tests.rs,
// src/asks/directory.rs); the old full-id format is kept working for older daemons.
import { describe, expect, it } from "vitest";
import { findById, isSessionRef, isShortId, parseIdRef, resolveId, sameId } from "../src/renderer/src/lib/shortIds";
import { taskToolRow } from "../src/renderer/src/lib/taskRows";
import { delegateCallOf, delegateEntryOf, inferDelegations } from "../src/renderer/src/lib/delegations";
import type { TimelineEntry } from "../src/renderer/src/lib/timeline";

// cutex src/short_ids.rs tests::index()
const ALPHA = "cutex.00000000-0000-7000-8000-000000abc123";
const OTHER = "cutex.00000000-0000-7000-8000-000000def456";
const ASK = "ask-123456abcdef00000000000000000000";
const DOC = "doc-123456abcdef11111111111111111111";
// cutex src/asks/store.rs tests
const REQUESTER = "cutex.00000000-0000-0000-0000-0000000000a1";
const TARGET = "cutex.00000000-0000-0000-0000-0000000000b1";

describe("parseIdRef / isShortId", () => {
  it("reads the display forms cutex writes", () => {
    expect(parseIdRef("cutex.…abc123")).toEqual({ kind: "session", hex: "abc123", mode: "suffix" });
    expect(parseIdRef("ask-123456")).toEqual({ kind: "ask", hex: "123456", mode: "either" });
    expect(parseIdRef("doc-123456")).toMatchObject({ kind: "document", mode: "either" });
    expect(parseIdRef("q-abcdef")).toMatchObject({ kind: "question", mode: "either" });
    expect(parseIdRef("art-0123abcd")).toMatchObject({ kind: "artifact", mode: "either" });
    expect(isShortId("cutex.…0000b1")).toBe(true);
    expect(isShortId("ask-123456")).toBe(true);
  });

  it("reads what agents may write: bare prefixes / suffixes, three dots, other spellings of a full id", () => {
    expect(parseIdRef("...abc123")).toEqual({ kind: null, hex: "abc123", mode: "suffix" });
    expect(parseIdRef("…00000000b1")).toEqual({ kind: null, hex: "00000000b1", mode: "suffix" });
    expect(parseIdRef("00000000")).toEqual({ kind: null, hex: "00000000", mode: "either" });
    expect(parseIdRef("cutex.00000000")).toMatchObject({ kind: "session", mode: "either" });
    expect(parseIdRef("CUTEX.00000000000070008000000000ABC123")).toEqual({ kind: "session", hex: "00000000000070008000000000abc123", mode: "full" });
  });

  it("treats full ids, names, mock ids and artifact-store ids as not short", () => {
    expect(isShortId(ALPHA)).toBe(false);
    expect(isShortId(ASK)).toBe(false);
    expect(isShortId("Kimi")).toBe(false);
    expect(isShortId("ask-run")).toBe(false);
    expect(isShortId("af-0123abcd")).toBe(false);
    expect(isShortId("AF-0123abcd")).toBe(false);
    expect(isShortId(null)).toBe(false);
  });

  it("knows a session reference from a name", () => {
    expect(isSessionRef("cutex.…0000b1")).toBe(true);
    expect(isSessionRef(TARGET)).toBe(true);
    expect(isSessionRef("Kimi")).toBe(false);
    expect(isSessionRef(null)).toBe(false);
  });
});

describe("resolveId", () => {
  const all = [ALPHA, OTHER, ASK, DOC];

  it("resolves the cutex normalisation samples to the full id", () => {
    for (const input of [ALPHA, "CUTEX.00000000000070008000000000ABC123", "cutex.…abc123", "...abc123"]) expect(resolveId(input, all)).toBe(ALPHA);
    expect(resolveId("ask-123456", all)).toBe(ASK);
    expect(resolveId("doc-123456", all)).toBe(DOC);
  });

  it("returns null when too short, ambiguous or unknown", () => {
    expect(resolveId("abc12", all)).toBeNull(); // id_too_short
    expect(resolveId("123456", all)).toBeNull(); // ask- and doc- both start with it
    expect(resolveId("cutex.00000000", all)).toBeNull(); // both sessions
    expect(resolveId("cutex.…0000d1", all)).toBeNull();
    expect(resolveId("Kimi", all)).toBeNull();
  });

  it("passes a listed id through, full or not", () => {
    expect(resolveId(TARGET, [REQUESTER, TARGET])).toBe(TARGET);
    expect(resolveId("ask-run", ["ask-run"])).toBe("ask-run");
    expect(resolveId(TARGET, [REQUESTER])).toBeNull();
  });

  it("keeps a suffix form to suffixes and checks the kind", () => {
    expect(resolveId("cutex.…0000b1", [REQUESTER, TARGET])).toBe(TARGET);
    expect(resolveId("cutex.…000000", [REQUESTER, TARGET])).toBeNull(); // a prefix of both, not a suffix
    expect(resolveId("ask-000000", [REQUESTER])).toBeNull();
  });
});

describe("sameId / findById", () => {
  it("matches a full id with its short forms and short forms that grew", () => {
    expect(sameId(ASK, "ask-123456")).toBe(true);
    expect(sameId("ask-123456", "ask-1234567")).toBe(true);
    expect(sameId(TARGET, "cutex.…0000b1")).toBe(true);
    expect(sameId("cutex.…0000b1", "cutex.…00000000b1")).toBe(true);
    expect(sameId(REQUESTER, TARGET)).toBe(false);
    expect(sameId(ASK, "doc-123456")).toBe(false);
    expect(sameId("ask-123456", "ask-654321")).toBe(false);
    expect(sameId(null, ASK)).toBe(false);
  });

  it("finds the one entry an id names; nothing when ambiguous", () => {
    const map = new Map([
      [ASK, "Parser review"],
      ["ask-abcdef00000000000000000000000000", "Other"],
    ]);
    expect(findById(map, "ask-123456")).toBe("Parser review");
    expect(findById(map, ASK)).toBe("Parser review");
    expect(findById(map, "ask-999999")).toBeUndefined();
    const twins = new Map([
      ["ask-123456aa000000000000000000000000", "a"],
      ["ask-123456bb000000000000000000000000", "b"],
    ]);
    expect(findById(twins, "ask-123456")).toBeUndefined();
  });
});

// ---------- tool rows parsed from the transcript ----------

const done = (tool: string, args: unknown, result: unknown, id = "m1") => ({
  type: "mcpToolCall",
  id,
  server: "cutex",
  tool,
  status: "completed",
  arguments: args,
  result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: null },
});

describe("delegation rows with short ids (cutex task 06)", () => {
  it("names a short target and learns the title under the short delegation id", () => {
    const delegated = done("agent_delegate", { target: "KiMi", title: "Short parser", text: "Review it" }, { ok: true, delegation_id: "ask-5a5a5a", target: "Kimi", target_id: "cutex.…0000b1", state: "queued" });
    expect(taskToolRow(delegated)).toMatchObject({ verb: "delegate", counterpartId: "cutex.…0000b1", counterpartName: "Kimi" });
    // Later calls name the delegation fully, by the grown display form, or by the agent's own prefix.
    expect(taskToolRow(done("delegation_stop", { delegation: "ask-5a5a5a00000000000000000000000000" }, { ok: true }))).toMatchObject({ verb: "delegationStop", text: "Short parser" });
    expect(taskToolRow(done("delegation_close", { delegation: "ask-5a5a5a0", outcome: "accepted" }, { ok: true }))).toMatchObject({ verb: "delegationAccept", text: "Short parser" });
    expect(taskToolRow(done("delegation_read", { delegation: "5a5a5a" }, { ok: true }))?.text).toBe("Short parser");
    expect(taskToolRow(done("delegation_wait", { delegations: ["ask-5a5a5a"] }, { ok: true, results: [] }))?.detail).toBe("Short parser");
  });

  it("takes a short recipient from agent_tell / alarm_set (target written as an id)", () => {
    expect(taskToolRow(done("agent_tell", { to: "cutex.…0000b1", text: "hi" }, { ok: true, to: "cutex.…0000b1", name: "Kimi" }))).toMatchObject({ verb: "tell", counterpartId: "cutex.…0000b1", counterpartName: "Kimi" });
    expect(taskToolRow(done("agent_tell", { to: "KiMi", text: "hi" }, { ok: true }))).toMatchObject({ counterpartId: null, counterpartName: "KiMi" });
    expect(taskToolRow(done("alarm_set", { alarm_id: "a", to: "cutex.…0000a1", message: "ping" }, { ok: true }))).toMatchObject({ verb: "alarmSet", counterpartId: "cutex.…0000a1" });
  });

  it("reports the renamed resolution errors with cutex's own codes", () => {
    const ambiguous = done(
      "agent_delegate",
      { target: "00000000", text: "x" },
      { ok: false, status: "no_write", code: "id_ambiguous", detail: "identifier matches several accessible objects; use a longer ID", input: "00000000", candidates: [{ kind: "session", id: ALPHA, short: "cutex.…abc123", name: "Alpha" }, { kind: "session", id: OTHER, short: "cutex.…def456", name: null }] },
    );
    expect(taskToolRow(ambiguous)?.outcome).toEqual({ kind: "failed", code: "id_ambiguous", detail: "identifier matches several accessible objects; use a longer ID" });
    expect(taskToolRow(done("delegation_stop", { delegation: "abc12" }, { ok: false, status: "no_write", code: "id_too_short", detail: "ID needs at least 6 hex characters" }))?.outcome?.code).toBe("id_too_short");
    expect(taskToolRow(done("agent_tell", { to: "nobody", text: "x" }, { ok: false, status: "no_write", code: "id_not_found", detail: "no accessible object matches this ID or name" }))?.outcome?.code).toBe("id_not_found");
    // Older daemons: recipient_not_found / recipient_ambiguous.
    expect(taskToolRow(done("agent_tell", { to: "nobody", text: "x" }, { ok: false, status: "no_write", code: "recipient_not_found", detail: "no reachable agent named nobody; see agent_list" }))?.outcome?.code).toBe("recipient_not_found");
  });

  it("still handles the full-id format of older daemons", () => {
    const delegated = done("agent_delegate", { target: TARGET, title: "Full parser" }, { ok: true, delegation_id: "ask-7b7b7b00000000000000000000000000", target: "Kimi", target_id: TARGET });
    expect(taskToolRow(delegated)).toMatchObject({ counterpartId: TARGET, counterpartName: "Kimi" });
    expect(taskToolRow(done("delegation_stop", { delegation: "ask-7b7b7b00000000000000000000000000" }, { ok: true }))?.text).toBe("Full parser");
    expect(taskToolRow(done("agent_tell", { to: TARGET, text: "hi" }, { ok: true, to: TARGET }))?.counterpartId).toBe(TARGET);
  });
});

const tool = (id: string, item: ReturnType<typeof done>): TimelineEntry => ({ kind: "tool", id, turnId: `t-${id}`, item }) as unknown as TimelineEntry;

describe("delegation cards with short ids", () => {
  const FULL = "ask-9c9c9c00000000000000000000000000";

  it("reads the short delegation id and target off the delegate result", () => {
    const call = delegateCallOf(done("agent_delegate", { target: "Kimi", text: "go" }, { ok: true, delegation_id: "ask-9c9c9c", target: "Kimi", target_id: "cutex.…0000b1", state: "queued" }));
    expect(call).toMatchObject({ askId: "ask-9c9c9c", targetId: "cutex.…0000b1", targetName: "Kimi" });
  });

  it("finds the card of a full id whose call result was short", () => {
    const entries = [tool("e1", done("agent_delegate", { target: "Kimi", text: "go" }, { ok: true, delegation_id: "ask-9c9c9c", target_id: "cutex.…0000b1" }))];
    expect(delegateEntryOf(entries, FULL)).toEqual({ entryId: "e1", turnId: "t-e1" });
    expect(delegateEntryOf(entries, "ask-1d1d1d00000000000000000000000000")).toBeNull();
  });

  it("merges a delegation's rows that spell its id differently, keeping the most complete", () => {
    const entries = [
      tool("e1", done("agent_delegate", { target: "Kimi", title: "Merge me" }, { ok: true, delegation_id: "ask-9c9c9c", target_id: "cutex.…0000b1" }, "c1")),
      tool("e2", done("delegation_wait", {}, { ok: true, results: [{ kind: "answer", delegation_id: "ask-9c9c9c0", status: "completed", answer: "done" }] }, "c2")),
      tool("e3", done("delegation_close", { delegation: FULL, outcome: "accepted" }, { ok: true }, "c3")),
    ];
    const inferred = inferDelegations(entries);
    expect([...inferred.keys()]).toEqual([FULL]);
    expect(inferred.get(FULL)).toMatchObject({ askId: FULL, title: "Merge me", execution: "answered", answerPreview: "done", closed: "accepted" });
    expect(findById(inferred, "ask-9c9c9c")?.title).toBe("Merge me");
  });
});
