// Next Up registry (docs/design/next-up-registry.md): the one table every Next Up row is drawn from.
// Pins: every state × kind has an exit (an enabled disposal or a deadline), overlays never change the disposal set,
// unknown input falls back to state `unknown`, the snapshot is tied to the doc's change-log version, every label key exists.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INPUT_KINDS, INPUT_REASONS_BY_STATE, INPUT_STATES, INPUT_WAITING_REASONS, type InputAction, type InputKind, type InputRecord } from "@cutex-desktop/protocol";
import { record } from "../src/renderer/src/lib/inputLedger/testkit";
import {
  NEXT_UP_EFFECTS, NEXT_UP_PANEL_CONTROLS, NEXT_UP_STATE_IDS, NEXT_UP_STATES, REGISTRY_VERSION, RETIRED_WORDS, STATE_LABEL_KEYS,
  buttonsFor, hasExit, isLedgerPanelControl, helpRows, localSendView, projectNextUp, rowButtons, stateLabelKey, type NextUpContext, type NextUpStateId,
} from "../src/renderer/src/lib/inputLedger/nextUpRegistry";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

const T0 = Date.parse("2026-11-14T00:00:00Z");
type Shown = Extract<ReturnType<typeof projectNextUp>, { kind: "state" }>;
const shown = (r: InputRecord): Shown => {
  const p = projectNextUp(r);
  if (p.kind !== "state") throw new Error(`hidden: ${r.state}/${r.reason}`);
  return p;
};
/**
 * The actions offered by the public 0.2.3 backend. Tests use the actual action contract rather than
 * every possible action, so the disposal check reflects legacy backend capabilities.
 */
function legacyHostActions(r: Pick<InputRecord, "kind" | "state" | "reason" | "stalled" | "details">): InputAction[] {
  const stuck = r.kind === "owner" && (
    (r.state === "waiting" && r.reason === "ownerRetry" && r.stalled?.reason === "noProgress")
    || ((r.state === "sending" || r.state === "accepted") && (r.stalled?.reason === "runtimeDisconnected" || (r.stalled?.reason === "noProgress" && ["generationChanged", "leaseStale", "orphan"].includes(String(r.details?.stuck))))));
  if (stuck) return ["retry", "dismiss"];
  const out: InputAction[] = r.state === "failed" ? (r.kind === "owner" ? ["retry", "dismiss"] : ["retry"])
    : r.state === "uncertain" ? ["retry", "dismiss"]
    : r.state === "waiting" && r.kind === "owner" && r.reason === "explicitQueue" ? ["cancel", "sendNow", "edit"]
    : r.state === "waiting" && r.kind !== "owner" && r.kind !== "delegationRequest" ? ["dismiss"]
    : [];
  // interruptSend (owner, running turn) and hold / releaseHold (details.ownerHold) are never disposals.
  // (This is the 0.2.3 host: no input-disposal-v1. A host with it: disposalActions below.)
  if (r.state === "waiting" && r.kind !== "owner" && r.kind !== "delegationRequest" && typeof r.details?.ownerHold === "boolean") out.push(r.details.ownerHold ? "releaseHold" : "hold");
  return out;
}

/**
 * The action contract for hosts with input-disposal-v1. Failed and uncertain: retry +
 * dismiss for every kind; the owner's explicit queue adds dismiss; waiting / held / accepted: dismiss for every kind;
 * received / sending: none (the id-only `cutex/input/dispose` still works there — `dismissible` is every unfinished state).
 */
function disposalActions(r: Pick<InputRecord, "kind" | "state" | "reason" | "stalled" | "details">): InputAction[] {
  const stuck = r.kind === "owner" && (
    (r.state === "waiting" && r.reason === "ownerRetry" && r.stalled?.reason === "noProgress")
    || ((r.state === "sending" || r.state === "accepted") && (r.stalled?.reason === "runtimeDisconnected" || (r.stalled?.reason === "noProgress" && ["generationChanged", "leaseStale", "orphan"].includes(String(r.details?.stuck))))));
  if (stuck) return ["retry", "dismiss"];
  const out: InputAction[] = r.state === "failed" || r.state === "uncertain" ? ["retry", "dismiss"]
    : r.state === "waiting" && r.kind === "owner" && r.reason === "explicitQueue" ? ["cancel", "sendNow", "edit", "dismiss"]
    : r.state === "waiting" || r.state === "held" || r.state === "accepted" ? ["dismiss"]
    : [];
  if (r.state === "waiting" && r.kind !== "owner" && r.kind !== "delegationRequest" && typeof r.details?.ownerHold === "boolean") out.push(r.details.ownerHold ? "releaseHold" : "hold");
  return out;
}

/**
 * Rows the public 0.2.3 backend cannot dispose of, grouped by capability gap.
 * The desktop shows the grey 放弃 with its reason on legacy hosts and turns it
 * on by itself once the host offers `dismiss`. The test fails if a gap appears outside this list, or a listed gap
 * is closed (then remove the line).
 */
const NEEDS_BACKEND: Record<string, string> = {
  "any:received": "received has no dismiss; the host deadline must end it (E1)",
  "any:held": "held (host busy) has no dismiss; the host deadline must end it (E1)",
  "any:sending": "sending has no dismiss and its deadline can renew; needs an absolute host deadline → uncertain (E1)",
  "any:accepted": "accepted (delivered, unread) has no dismiss for any kind (E5/E6)",
  "owner:waiting≠explicitQueue": "owner waiting other than the explicit queue has no dismiss (E2/E7/E8)",
  "request:waiting≠reviewPending": "a waiting delegation request has no dismiss / cancel (E3)",
  "nonOwner:failed": "a failed non-owner input offers only retry (E13)",
};
/** Backend capability gaps beyond missing actions. */
export const NEEDS_BACKEND_NOTES = [
  "staleHeld: the dedicated release_stale_held action (desktop shows 允许发送 only when releaseHold is offered; dispose ends it meanwhile)",
] as const;
/** Every gap above is closed by input-disposal-v1: with the capability nothing is left. Held / accepted rows
 *  no longer get a host deadline there (only received / sending do); their exit is the owner disposal checked here. */
const NEEDS_BACKEND_WITH_DISPOSAL: Record<string, string> = {};
const gapKey = (r: InputRecord): string =>
  r.state === "received" || r.state === "held" || r.state === "sending" || r.state === "accepted" ? `any:${r.state}`
    : r.kind === "owner" && r.state === "waiting" ? "owner:waiting≠explicitQueue"
    : r.kind === "delegationRequest" && r.state === "waiting" ? "request:waiting≠reviewPending"
    : r.state === "failed" && r.kind !== "owner" ? "nonOwner:failed"
    : `${r.kind}:${r.state}:${r.reason}`;
/** The page context when everything it can know is loaded (queue item, approval record, delivery state). */
const FULL_CTX: NextUpContext = { queueItem: true, askKnown: true, canReview: true, canResume: true, canStart: true, canReadNow: true, hasText: true, idle: true, composerEmpty: true };

/** Every (kind, state, reason) the schema allows, as a record on Next Up. */
function allRecords(actionsOf: (r: InputRecord) => InputAction[] = legacyHostActions): InputRecord[] {
  const out: InputRecord[] = [];
  for (const kind of INPUT_KINDS) for (const state of INPUT_STATES) {
    const reasons = (INPUT_REASONS_BY_STATE[state] as readonly string[] | undefined) ?? [];
    for (const reason of reasons.length ? reasons : [null])
      for (const stage of state === "accepted" ? [null, "registered", "offered"] : [null]) {
        const r = record(`${kind}-${state}-${reason}-${stage}`, { kind, state, reason, stage, surface: "nextUp", askId: "ask-1", createdAt: new Date(T0).toISOString(), since: new Date(T0).toISOString() } as Partial<InputRecord>);
        out.push({ ...r, actions: actionsOf(r) });
      }
  }
  // Owner records the host marks stuck get retry / dismiss (legacy backend action contract).
  for (const state of ["sending", "accepted"] as const) {
    const r = record(`owner-${state}-stuck`, { kind: "owner", state, reason: null, surface: "nextUp", stalled: { reason: "runtimeDisconnected", since: new Date(T0).toISOString() } });
    out.push({ ...r, actions: actionsOf(r) });
  }
  return out;
}

describe("registry table", () => {
  it("has exactly the 14 v1.5 state keys, numbered in order", () => {
    expect(NEXT_UP_STATE_IDS).toEqual(["sending", "queued", "afterWork", "awaitingRead", "passiveNote", "held", "paused", "awaitingOnline", "awaitingReconnect", "review", "needsAction", "unconfirmed", "failed", "unknown"]);
    NEXT_UP_STATE_IDS.forEach((id, i) => expect(NEXT_UP_STATES[id].n).toBe(i + 1));
  });
  it("every state's exit is an owner disposal it shows, or a deadline into a state with one", () => {
    for (const id of NEXT_UP_STATE_IDS) {
      const exit = NEXT_UP_STATES[id].exit;
      if (exit.kind === "deadline") { expect(NEXT_UP_STATES[exit.to].exit.kind).toBe("owner"); continue; }
      expect(exit.disposals.length).toBeGreaterThan(0);
      for (const d of exit.disposals) { expect(NEXT_UP_EFFECTS[d].disposal).toBe(true); expect(NEXT_UP_STATES[id].buttons).toContain(d); }
    }
  });
  it("every short label key exists in zh-CN and en, and afterWork timed takes {time}", () => {
    for (const key of STATE_LABEL_KEYS) { expect(zhCN).toHaveProperty([key]); expect(en).toHaveProperty([key]); }
    expect(zhCN[stateLabelKey("afterWork", "timed") as keyof typeof zhCN]).toContain("{time}");
    expect(en[stateLabelKey("afterWork", "timed") as keyof typeof en]).toContain("{time}");
  });
  it("no retired word in any Next Up text", () => {
    const texts = [
      ...STATE_LABEL_KEYS.flatMap(k => [zhCN[k as keyof typeof zhCN], en[k as keyof typeof en]]),
      ...NEXT_UP_STATE_IDS.flatMap(id => [NEXT_UP_STATES[id].meaning.zh, NEXT_UP_STATES[id].meaning.en]),
      ...Object.values(NEXT_UP_EFFECTS).flatMap(e => [e.label.zh, e.label.en, ...("tip" in e ? [e.tip.zh, e.tip.en] : [])]),
      ...Object.values(NEXT_UP_PANEL_CONTROLS).flatMap(c => [c.label.zh, c.label.en, ...c.buttons.flatMap(b => [b.zh, b.en])]),
    ];
    for (const word of RETIRED_WORDS) for (const text of texts) expect(text, word).not.toContain(word);
  });
  it("tooltips and help say what a key means in plain words, never the bare key", () => {
    for (const lang of ["zh", "en"] as const) for (const row of helpRows(lang)) {
      if (/[A-Z]/.test(row.id)) expect(row.meaning).not.toContain(row.id); // compound program keys never leak; plain words like "paused" may
      expect(row.meaning.length).toBeGreaterThan(3);
    }
  });
});

describe("panel controls (registry §三)", () => {
  it("1.8 adds agentPaused (any host) and legacyPausedQueue (old hosts only); the ID check covers both", () => {
    expect(Object.keys(NEXT_UP_PANEL_CONTROLS).sort()).toEqual(["agentPaused", "cleanupUnconfirmed", "grantNotice", "legacyPausedQueue", "releaseLease", "resetCredit", "scheduledContinue"]);
    expect(isLedgerPanelControl("agentPaused")).toBe(true);
    expect(isLedgerPanelControl("resetCredit")).toBe(true);
    expect(isLedgerPanelControl("legacyPausedQueue")).toBe(false);
    expect(isLedgerPanelControl("somethingElse")).toBe(false);
    expect(isLedgerPanelControl(undefined)).toBe(false);
    expect(NEXT_UP_PANEL_CONTROLS.legacyPausedQueue.buttons.map(b => b.zh)).toEqual(["继续", "放回输入框", "全部放弃"]);
    expect(NEXT_UP_PANEL_CONTROLS.agentPaused.buttons.map(b => b.zh)).toEqual(["继续"]);
  });
});

describe("projection: backend codes → one registry state", () => {
  it("every schema waiting reason maps to a registry state", () => {
    for (const reason of INPUT_WAITING_REASONS) {
      const p = projectNextUp(record("r", { state: "waiting", reason, surface: "nextUp" }));
      expect(p.kind).toBe("state");
      expect(p.kind === "state" && p.state).not.toBe("unknown");
    }
  });
  it("settled states leave (no empty line); uncertain / failed stay however old", () => {
    for (const state of ["inContext", "rejected", "discarded", "superseded"] as const) expect(projectNextUp(record("r", { state, reason: null })).kind).toBe("hidden");
    const old = new Date(T0 - 30 * 86_400_000).toISOString();
    expect(shown(record("u", { state: "uncertain", reason: "outcomeUnknown", since: old })).state).toBe("unconfirmed");
    expect(shown(record("f", { state: "failed", reason: (INPUT_REASONS_BY_STATE.failed as readonly string[])[0] as never, since: old })).state).toBe("failed");
  });
  it.each([
    ["kind", { kind: "futureKind" as InputKind }],
    ["state", { state: "futureState" as never }],
    ["reason", { state: "waiting" as const, reason: "futureReason" as never }],
    ["stage", { stage: "futureStage" as never }],
  ])("an unknown %s falls back to state unknown with Refresh / View details / Clear this notice", (field, patch) => {
    const p = shown(record("x", { state: "waiting", reason: "explicitQueue", ...patch }));
    expect(p.state).toBe("unknown");
    expect(p.unknown?.field).toBe(field);
    expect(p.buttons).toEqual(["refresh", "viewDetails", "dismiss", "clearNotice"]);
    const buttons = rowButtons(p, { actions: [], askId: null, kind: "agentMessage" });
    // Without input-disposal-v1 there is no Dismiss on state 14 (an older host cannot end a status it sent unrecognised).
    expect(buttons.map(b => b.effect)).toEqual(["refresh", "viewDetails", "clearNotice"]);
    expect(buttons.every(b => b.enabled)).toBe(true);
    expect(hasExit(p, buttons)).toBe(true);
    // With it, the id-only dispose ends it on the host (registry 1.9).
    expect(rowButtons(p, { actions: [], askId: null, kind: "agentMessage" }, { disposal: true }).map(b => `${b.effect}:${b.enabled}`)).toEqual(["refresh:true", "viewDetails:true", "dismiss:true", "clearNotice:true"]);
  });
  it("the desktop never rewrites a state by its own clock: an old sending record stays sending (the host decides)", () => {
    const r = record("s", { state: "sending", reason: null, createdAt: new Date(T0 - 86_400_000).toISOString(), since: new Date(T0).toISOString() });
    expect(shown(r).state).toBe("sending");
    expect(NEXT_UP_STATES.sending.exit).toEqual({ kind: "deadline", to: "unconfirmed" });
  });
  it.each(["peerVersionMismatch", "peerIdentityChanged"])("a delegation request held by %s needs the owner (not 'reconnect')", hold => {
    expect(shown(record("r", { kind: "delegationRequest", state: "waiting", reason: "runtimeDisconnected", details: { hold: { reason: hold } } })).state).toBe("needsAction");
    expect(shown(record("r", { kind: "delegationRequest", state: "waiting", reason: "runtimeDisconnected", details: { hold: { reason: "peerUnreachable" } } })).state).toBe("awaitingReconnect");
  });
  it("a request waiting for the owner's input needs the owner (not 'after work')", () => {
    expect(shown(record("r", { kind: "delegationRequest", state: "waiting", reason: "targetBusy", details: { hold: { reason: "waitingForInput" } } })).state).toBe("needsAction");
    expect(shown(record("r", { kind: "delegationRequest", state: "waiting", reason: "targetBusy", details: { hold: { reason: "targetBusy" } } })).state).toBe("afterWork");
  });
  it("nativeHeld that is really an unsure send reads unconfirmed, not needsAction", () => {
    expect(shown(record("n", { state: "waiting", reason: "nativeHeld", details: { nativeReason: "request_uncertain" } })).state).toBe("unconfirmed");
    expect(shown(record("n", { state: "waiting", reason: "nativeHeld", details: { nativeReason: "plan_mode" } })).state).toBe("needsAction");
  });
});

describe("disposal guarantee (registry §五)", () => {
  it("with 0.2.3's real actions, every row has an enabled disposal — except exactly the 'needs backend' list", () => {
    const gaps = new Map<string, string[]>();
    let checked = 0;
    for (const r of allRecords()) {
      const p = projectNextUp(r);
      if (p.kind === "hidden") continue;
      checked++;
      const buttons = rowButtons(p, r, FULL_CTX);
      if (buttons.some(b => b.enabled && NEXT_UP_EFFECTS[b.effect].disposal)) continue;
      // No enabled disposal: the row must still show a grey one with its reason (or be state 1, which has none).
      if (p.state !== "sending") expect(buttons.some(b => !b.enabled && NEXT_UP_EFFECTS[b.effect].disposal && b.reason), `${r.inputId} grey disposal`).toBe(true);
      const key = gapKey(r);
      gaps.set(key, [...(gaps.get(key) ?? []), r.inputId]);
    }
    expect(checked).toBeGreaterThan(100);
    expect([...gaps.keys()].sort(), JSON.stringify(Object.fromEntries(gaps), null, 1)).toEqual(Object.keys(NEEDS_BACKEND).sort());
  });
  it("with input-disposal-v1 (cutex 52a1ef8f's real actions), every state × kind has an enabled disposal — no gaps", () => {
    const gaps = new Map<string, string[]>();
    let checked = 0;
    for (const r of allRecords(disposalActions)) {
      const p = projectNextUp(r);
      if (p.kind === "hidden") continue;
      checked++;
      // State 10's disposal is the review itself (Reject / Approve), so it needs the review loaded (Director 2026-11-14).
      for (const ctx of (p.state === "review" ? [FULL_CTX] : [FULL_CTX, {}]) as NextUpContext[]) {
        const buttons = rowButtons(p, r, { ...ctx, disposal: true });
        if (!buttons.some(b => b.enabled && (NEXT_UP_EFFECTS[b.effect].disposal || b.effect === "approve"))) gaps.set(gapKey(r), [...(gaps.get(gapKey(r)) ?? []), r.inputId]);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(Object.fromEntries(gaps)).toEqual(NEEDS_BACKEND_WITH_DISPOSAL);
    // Even with nothing offered in record.actions (an id the page barely knows), dispose works.
    for (const r of allRecords(() => [])) {
      const p = projectNextUp(r);
      if (p.kind === "hidden") continue;
      const ctx: NextUpContext = p.state === "review" ? { ...FULL_CTX, disposal: true } : { disposal: true };
      expect(rowButtons(p, r, ctx).some(b => b.enabled && NEXT_UP_EFFECTS[b.effect].disposal), r.inputId).toBe(true);
      if (p.state === "review") expect(rowButtons(p, r, ctx).map(b => b.effect)).not.toContain("dismiss");
    }
  });
  it("held / accepted rows never rely on a host deadline (52a1ef8f: only received / sending have one); their exit is an owner disposal", () => {
    for (const r of allRecords(disposalActions).filter(r => (r.state === "held" || r.state === "accepted") && !r.stalled)) {
      const p = projectNextUp(r);
      if (p.kind === "hidden") continue;
      expect(NEXT_UP_STATES[p.state].exit.kind, r.inputId).toBe("owner");
    }
    for (const state of ["received", "sending"] as const) expect(NEXT_UP_STATES[shown(record("t", { state, reason: null })).state].exit).toEqual({ kind: "deadline", to: "unconfirmed" });
  });
  it("without input-disposal-v1, cutex 52a1ef8f's actions alone leave only state 1 (sending) to the host deadline", () => {
    for (const r of allRecords(disposalActions)) {
      const p = projectNextUp(r);
      if (p.kind === "hidden") continue;
      if (!rowButtons(p, r, FULL_CTX).some(b => b.enabled && NEXT_UP_EFFECTS[b.effect].disposal)) expect(p.state, r.inputId).toBe("sending");
    }
  });
  it("a dispose accepted but not applied yet greys every changing button with 'working on it'; views stay usable", () => {
    for (const r of allRecords(disposalActions)) {
      const p = projectNextUp(r);
      if (p.kind === "hidden") continue;
      for (const b of rowButtons(p, r, { ...FULL_CTX, disposal: true, disposing: true })) {
        if (["viewDelegation", "viewDetails", "viewReason", "refresh"].includes(b.effect)) continue;
        expect(b, `${r.inputId} ${b.effect}`).toEqual({ effect: b.effect, enabled: false, reason: "pending" });
      }
    }
  });
  it("owner records the host marks stuck, and every true uncertain, have a working dismiss", () => {
    for (const r of allRecords().filter(r => r.inputId.endsWith("-stuck") || r.state === "uncertain")) {
      const p = projectNextUp(r);
      if (p.kind !== "state") continue;
      expect(rowButtons(p, r, FULL_CTX).some(b => b.enabled && NEXT_UP_EFFECTS[b.effect].disposal), r.inputId).toBe(true);
    }
  });
  it("with nothing offered by the host every disposal is still shown (grey, with a reason) — never a row without controls", () => {
    for (const r of allRecords()) {
      const p = projectNextUp(r);
      if (p.kind === "hidden" || p.state === "sending") continue;
      const buttons = rowButtons(p, { ...r, actions: [] }, {});
      const disposals = buttons.filter(b => NEXT_UP_EFFECTS[b.effect].disposal);
      expect(disposals.length, `${r.kind}/${r.state}/${r.reason}`).toBeGreaterThan(0);
      for (const b of buttons) if (!b.enabled) expect(b.reason).toBeTruthy();
    }
  });
  it("overlays (countdown → read point → held → grant → plain) keep the same disposal set", () => {
    for (const kind of ["agentMessage", "delegationResult", "alarm", "owner"] as const) {
      const r = record("o", { kind, state: "waiting", reason: "turnRunning", askId: "ask-1", actions: ["dismiss", "hold", "interruptSend"] });
      const disposalsOf = (state: NextUpStateId) =>
        rowButtons({ kind: "state", state, buttons: buttonsFor(state, r) }, r, FULL_CTX).filter(b => NEXT_UP_EFFECTS[b.effect].disposal).map(b => `${b.effect}:${b.enabled}`).sort();
      const plain = disposalsOf("afterWork");
      // countdown and grant notice are add-ons on afterWork; the read point is awaitingRead; an admission hold is held.
      for (const overlay of ["afterWork", "awaitingRead", "held"] as const) expect(disposalsOf(overlay), `${kind} ${overlay}`).toEqual(plain);
      expect(plain.some(d => d.endsWith(":true"))).toBe(true);
    }
  });
  it("O0 (local send before the host knows it) has local Hide once unconfirmed", () => {
    expect(localSendView("sending")).toEqual({ state: "sending", buttons: ["hideLocal"] });
    expect(localSendView("unconfirmed").buttons).toContain("hideLocal");
    expect(localSendView("unconfirmed", "input_not_found").state).toBe("failed");
  });
});

describe("registry snapshot ↔ docs change log", () => {
  it("the table matches its snapshot and REGISTRY_VERSION is the doc's newest change-log entry", () => {
    const doc = readFileSync(join(__dirname, "../../../docs/design/next-up-registry.md"), "utf8");
    const log = doc.slice(doc.indexOf("## 变更记录"));
    const versions = [...log.matchAll(/^\| ([\d.]+) \|/gm)].map(m => m[1]);
    expect(versions.at(-1)).toBe(REGISTRY_VERSION);
    const snapshot = {
      version: REGISTRY_VERSION,
      labels: Object.fromEntries(STATE_LABEL_KEYS.map(k => [k, [zhCN[k as keyof typeof zhCN], en[k as keyof typeof en]]])),
      states: Object.fromEntries(NEXT_UP_STATE_IDS.map(id => [id, { tone: NEXT_UP_STATES[id].tone, buttons: NEXT_UP_STATES[id].buttons, exit: NEXT_UP_STATES[id].exit }])),
      effects: Object.fromEntries(Object.entries(NEXT_UP_EFFECTS).map(([id, e]) => [id, { label: e.label, disposal: e.disposal, action: e.action }])),
      panel: NEXT_UP_PANEL_CONTROLS,
    };
    // A failing snapshot means the registry changed: bump REGISTRY_VERSION with an approved change-log entry, then update.
    expect(snapshot).toMatchSnapshot(`registry ${REGISTRY_VERSION}`);
  });
});
