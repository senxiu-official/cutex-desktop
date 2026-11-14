// 「接下来」固定状态表 (Next Up registry) — the one code table behind every Next Up row, label and button.
// Source of truth for the words: docs/design/next-up-registry.md (approved by the owner 2026-11-14). Any change to a
// state, label, tooltip, button, effect or exit policy here needs owner / Director approval and a change-log line in that
// document with a matching REGISTRY_VERSION (the snapshot test fails otherwise).
// Pure data + pure projection: no React, no store. Components only render what `projectNextUp` returns.
import type { InputAction, InputKind, InputRecord, InputState, InputWaitingReason } from "@cutex-desktop/protocol";
import { INPUT_ACTIONS, INPUT_KINDS, INPUT_REASONS_BY_STATE, INPUT_STAGES } from "@cutex-desktop/protocol";

/** docs/design/next-up-registry.md version this table implements. */
export const REGISTRY_VERSION = "1.9";

export type Lang = "zh" | "en";
export interface Text { zh: string; en: string }

/** The 14 fixed state keys (registry 1.5 §〇), in table order. Keys never change; their words are i18n entries. */
export const NEXT_UP_STATE_IDS = [
  "sending", "queued", "afterWork", "awaitingRead", "passiveNote", "held", "paused",
  "awaitingOnline", "awaitingReconnect", "review", "needsAction", "unconfirmed", "failed", "unknown",
] as const;
export type NextUpStateId = (typeof NEXT_UP_STATE_IDS)[number];

/** Button effects. One id = one exact behaviour; the same word with another behaviour is another id. */
export const NEXT_UP_EFFECT_IDS = [
  "insertNow", "sendNow", "edit", "remove", "hold", "releaseHold", "dismiss", "ignoreNotice", "viewDelegation",
  "interruptSend", "readNow", "resume", "viewDetails", "start", "viewReason", "approve", "reject",
  "retry", "retryNotice", "moveToComposer", "refresh", "clearNotice", "hideLocal",
] as const;
export type NextUpEffectId = (typeof NEXT_UP_EFFECT_IDS)[number];

export type Tone = "neutral" | "warn" | "danger";

/**
 * How a row in this state is guaranteed to end (registry §五):
 * - `owner`: at least one disposal button that works now (dismiss / clear / remove / reject …);
 * - `deadline`: the host's own deadline turns the record into `to` (a state with disposal buttons). The desktop never
 *   applies a deadline itself (Director 2026-11-14: the daemon decides deadlines and states); that the host's deadline is
 *   absolute is a backend guarantee (listed in the tests' "needs backend" list).
 */
export type ExitPolicy = { kind: "owner"; disposals: readonly NextUpEffectId[] } | { kind: "deadline"; to: NextUpStateId };

export interface NextUpStateDef {
  /** Registry row number (1-14). */
  n: number;
  /** What it means / when it shows (registry §一 long text: the label's tooltip and the Help page). The short label is
   *  the i18n entry `stateLabelKey(key)` (owner 2026-11-14: wording is tuned in the translation files only). */
  meaning: Text;
  tone: Tone;
  /** Buttons this state may show, in display order. Which of them a kind gets: `buttonsFor`. */
  buttons: readonly NextUpEffectId[];
  exit: ExitPolicy;
  /** Registry 1.6: the ⓘ icon's text, only on the four states easy to misread (passiveNote, afterWork timed,
   *  unconfirmed, needsAction). Every state's label shows `meaning` on hover. */
  info?: Text;
}

export const NEXT_UP_STATES = {
  /** Any message being handed to the agent right now (cutex has it and is routing or submitting it). A host record has no buttons: it ends by itself — read in, or the host's deadline turns it into `unconfirmed` with its disposal buttons. A send this desktop holds before the host's first record (O0) can be hidden on this computer only. */
  sending: {
    n: 1,
    meaning: { zh: "消息正在往 agent 那边送。", en: "The message is on its way to the agent." },
    tone: "neutral", buttons: ["hideLocal", "dismiss"], exit: { kind: "deadline", to: "unconfirmed" },
  },
  /** A message waiting its turn: other messages are ahead of it, results wait to be sent together, the host is busy, or it waits for an automatic retry. The owner's own message can be inserted / sent now / edited / deleted; anyone else's can be held or dismissed, and a delegation's opened. Ends when it is sent (or deleted / dismissed). */
  queued: {
    n: 2,
    meaning: { zh: "前面还有别的消息，或在等几条结果合并一起送。", en: "Other messages are ahead of it, or it waits for several results to be sent together." },
    tone: "neutral", buttons: ["insertNow", "sendNow", "edit", "remove", "hold", "dismiss", "ignoreNotice", "viewDelegation"], exit: { kind: "owner", disposals: ["remove", "dismiss", "ignoreNotice"] },
  },
  /** A message to an agent that is working. It goes in when the agent finishes this turn; with a server deadline (variant `timed`) it goes in at the agent's next tool call once the countdown runs out (then `awaitingRead`). The owner can dismiss it (their own message: interrupt and send). Ends when it is read in or dismissed. */
  afterWork: {
    n: 3,
    meaning: { zh: "对方正在干活：干完就送；行末倒计时先到，就在它下一次调用工具的间隙插进去（转为第 4 种）。", en: "The agent is working: it gets this when it is done; if the countdown at the row end runs out first, it is put in at its next tool call (then “Delivered, unread”)." },
    tone: "neutral", buttons: ["interruptSend", "hold", "dismiss", "ignoreNotice", "viewDelegation"], exit: { kind: "owner", disposals: ["dismiss", "ignoreNotice"] },
    /** Shown only for the `timed` variant (the countdown). */
    info: { zh: "对方忙完就发；倒计时到了还没忙完，就在它下一次调用工具的间隙插进去，不会打断它。", en: "Sent as soon as the agent is done; if the countdown runs out first, it goes in at the agent's next tool call, without interrupting it." },
  },
  /** A message that reached the agent but is not read in yet (inserted into a running turn, or waiting for the next read point). The owner can dismiss it (their own message: interrupt and send). Ends when the agent reads it. */
  awaitingRead: {
    n: 4,
    meaning: { zh: "已经送到，对方还没读进去。", en: "It has arrived; the agent has not read it yet." },
    tone: "neutral", buttons: ["interruptSend", "dismiss", "ignoreNotice", "viewDelegation"], exit: { kind: "owner", disposals: ["dismiss", "ignoreNotice"] },
  },
  /** A note (passive message): it never wakes the agent; it is read during the agent's next work. The owner can have it read now (agent idle) or dismiss it. */
  passiveNote: {
    n: 5,
    meaning: { zh: "留言类消息，不会主动叫醒对方。", en: "A note: it does not wake the agent." },
    tone: "neutral", buttons: ["readNow", "dismiss", "ignoreNotice"], exit: { kind: "owner", disposals: ["dismiss", "ignoreNotice"] },
    // Read timing verified 2026-11-14 (registry 1.7).
    info: {
      zh: "留言不会叫醒对方，也不会自己开新一回合。对方正在工作时，会在它下一次思考（模型请求）前读到——写最终回复通常也算一次，所以多半本回合就读了。只有本回合没有下一次思考时，才会等它下次开工；这期间一直显示「待读留言」，可以「现在读取」或「放弃」。",
      en: "A note never wakes the agent or starts a turn. If the agent is working, it reads the note before its next model request — writing the final reply usually counts, so mostly still in this turn. Only if the turn has no further request does it wait until the agent next works; meanwhile it shows “Unread note” with Read now / Dismiss.",
    },
  },
  /** A message the owner put on hold with 「暂缓这条」. It stays until the owner allows sending or dismisses it. */
  held: {
    n: 6,
    meaning: { zh: "你点了「暂缓这条」。", en: "You chose “Hold” for this message." },
    tone: "neutral", buttons: ["releaseHold", "dismiss", "ignoreNotice"], exit: { kind: "owner", disposals: ["dismiss", "ignoreNotice"] },
  },
  /** A message to an agent that is paused (or whose deliveries stopped with the owner's stop). Not sent until the owner resumes; the owner can also dismiss it. */
  paused: {
    n: 7,
    meaning: { zh: "这个 agent 被暂停了。", en: "This agent is paused." },
    tone: "warn", buttons: ["resume", "viewDetails", "dismiss", "ignoreNotice"], exit: { kind: "owner", disposals: ["dismiss", "ignoreNotice"] },
  },
  /** A message to an agent that is offline. It is sent once the agent is online; the owner can start the agent (when it can be started from here) or dismiss the message. */
  awaitingOnline: {
    n: 8,
    meaning: { zh: "对方离线。", en: "The agent is offline." },
    tone: "neutral", buttons: ["start", "dismiss", "ignoreNotice", "viewDelegation"], exit: { kind: "owner", disposals: ["dismiss", "ignoreNotice"] },
  },
  /** A message waiting for a dropped connection to the agent's runtime to come back. It is sent after the reconnect; the owner can read the reason or dismiss it. */
  awaitingReconnect: {
    n: 9,
    meaning: { zh: "连接断了，会自动恢复。", en: "The connection dropped; it recovers by itself." },
    tone: "neutral", buttons: ["viewReason", "dismiss", "ignoreNotice"], exit: { kind: "owner", disposals: ["dismiss", "ignoreNotice"] },
  },
  /** A delegation request waiting for the owner's approval before it may start. The owner approves or rejects it here or opens the delegation; rejecting ends it. */
  review: {
    n: 10,
    meaning: { zh: "委托需要你批准才能开始。", en: "The delegation needs your approval before it starts." },
    tone: "warn", buttons: ["approve", "reject", "viewDelegation"], exit: { kind: "owner", disposals: ["reject"] },
  },
  /** A message that is stuck and will not recover by itself (an old backlog, a delivery the agent cannot take, a version mismatch …). The owner reads the reason, allows sending when the host can release it, or dismisses it. */
  needsAction: {
    n: 11,
    meaning: { zh: "卡住了，不会自己好（积压太久、对方不支持、版本不对等）。", en: "It is stuck and will not recover by itself (backlog too old, not supported by the agent, version mismatch …)." },
    tone: "warn", buttons: ["releaseHold", "viewReason", "dismiss", "ignoreNotice", "viewDelegation"], exit: { kind: "owner", disposals: ["dismiss", "ignoreNotice"] },
    info: { zh: "它不会自己好。点「查看原因」看卡在哪里；能放行时可以「允许发送」，否则可以放弃。", en: "It will not recover by itself. “View reason” shows where it is stuck; allow sending when the host can release it, otherwise dismiss it." },
  },
  /** A message whose delivery cannot be confirmed: it may or may not have reached the agent. The owner can resend it (it may arrive twice) or dismiss it; it never resends by itself. */
  unconfirmed: {
    n: 12,
    meaning: { zh: "不知道对方收到没有。", en: "It is not known whether the agent got it." },
    tone: "warn", buttons: ["retry", "retryNotice", "dismiss", "ignoreNotice", "hideLocal", "viewReason"], exit: { kind: "owner", disposals: ["dismiss", "ignoreNotice", "hideLocal"] },
    info: { zh: "重新发送可能让对方收到两次；放弃不会撤回可能已经送到的内容。", en: "Resending may make it arrive twice; dismissing does not withdraw anything that may have arrived." },
  },
  /** A message that certainly did not reach the agent. It stays until the owner resends it, puts the text back in the input box, or dismisses it. */
  failed: {
    n: 13,
    meaning: { zh: "确定没送到。会一直留在这里，直到你处理。", en: "It certainly did not arrive. It stays here until you handle it." },
    tone: "danger", buttons: ["retry", "retryNotice", "moveToComposer", "dismiss", "ignoreNotice", "hideLocal", "viewReason"], exit: { kind: "owner", disposals: ["dismiss", "ignoreNotice", "hideLocal"] },
  },
  /** A message whose status the host reported in a form this table does not know (a newer host). The message is kept and nothing is sent or withdrawn; the owner can refresh, read the details, or clear the notice on this computer. */
  unknown: {
    n: 14,
    meaning: { zh: "后端发来这张表里没有的状态。消息没有被删除或撤回。", en: "The host sent a status this table does not know. The message is not deleted or withdrawn." },
    tone: "warn", buttons: ["refresh", "viewDetails", "dismiss", "ignoreNotice", "clearNotice"], exit: { kind: "owner", disposals: ["clearNotice"] },
  },
} as const satisfies Record<NextUpStateId, NextUpStateDef>;

/** State 3's variants (registry 1.5 §〇): `timed` has a server deadline ({time} counts down), `untimed` waits for the turn end. */
export type AfterWorkVariant = "timed" | "untimed";

/** The i18n entry of a state's short label. `afterWork` has one per variant; `timed` takes `{time}`. */
export function stateLabelKey(state: NextUpStateId, variant: AfterWorkVariant = "untimed"): string {
  return state === "afterWork" ? `nextUp.state.afterWork.${variant}` : `nextUp.state.${state}`;
}

/** Every label entry the i18n files must have (zh-CN and en; a test checks). */
export const STATE_LABEL_KEYS: readonly string[] = NEXT_UP_STATE_IDS.flatMap(id => id === "afterWork" ? [stateLabelKey(id, "timed"), stateLabelKey(id, "untimed")] : [stateLabelKey(id)]);

export interface NextUpEffectDef {
  label: Text;
  /** Tooltip; fixed wording (registry §五 for resend). */
  tip?: Text;
  /** A disposal: ends the row (counted by the exit guarantee). */
  disposal: boolean;
  /** The backend action this button needs in `record.actions`; null = a local / non-ledger effect. */
  action: InputAction | null;
}

export const NEXT_UP_EFFECTS = {
  insertNow: { label: { zh: "插话", en: "Insert" }, disposal: false, action: "sendNow" },
  sendNow: { label: { zh: "立即发送", en: "Send now" }, disposal: false, action: "sendNow" },
  edit: { label: { zh: "编辑", en: "Edit" }, tip: { zh: "放回输入框修改", en: "Back to the input box to change it" }, disposal: false, action: "edit" },
  remove: { label: { zh: "删除", en: "Delete" }, disposal: true, action: "cancel" },
  hold: { label: { zh: "暂缓这条", en: "Hold" }, disposal: false, action: "hold" },
  releaseHold: { label: { zh: "允许发送", en: "Allow sending" }, disposal: false, action: "releaseHold" },
  dismiss: { label: { zh: "放弃", en: "Dismiss" }, tip: { zh: "不再发送这一条；已经送到的内容不会被撤回", en: "Stop sending this; anything already delivered is not withdrawn" }, disposal: true, action: "dismiss" },
  ignoreNotice: { label: { zh: "忽略此通知", en: "Ignore this notice" }, disposal: true, action: "dismiss" },
  viewDelegation: { label: { zh: "查看委托", en: "View delegation" }, disposal: false, action: null },
  interruptSend: { label: { zh: "打断并发送", en: "Interrupt and send" }, tip: { zh: "停下当前这一轮，马上发这条", en: "Stop the current turn and send this now" }, disposal: false, action: "interruptSend" },
  readNow: { label: { zh: "现在读取", en: "Read now" }, disposal: false, action: null },
  resume: { label: { zh: "继续", en: "Resume" }, disposal: false, action: null },
  viewDetails: { label: { zh: "查看详情", en: "View details" }, disposal: false, action: null },
  start: { label: { zh: "启动", en: "Start" }, disposal: false, action: null },
  viewReason: { label: { zh: "查看原因", en: "View reason" }, disposal: false, action: null },
  approve: { label: { zh: "批准", en: "Approve" }, disposal: false, action: null },
  reject: { label: { zh: "拒绝", en: "Reject" }, disposal: true, action: null },
  retry: { label: { zh: "重新发送", en: "Resend" }, tip: { zh: "可能收到两次", en: "It may arrive twice" }, disposal: false, action: "retry" },
  retryNotice: { label: { zh: "重发通知", en: "Resend notice" }, tip: { zh: "只重发这条通知，任务不会重新开始；可能收到两次", en: "Only the notice is sent again; the task does not restart. It may arrive twice" }, disposal: false, action: "retry" },
  moveToComposer: { label: { zh: "放回输入框", en: "Back to input box" }, tip: { zh: "把原文放回输入框，并放弃这一条", en: "Put the text back in the input box and dismiss this" }, disposal: true, action: "dismiss" },
  refresh: { label: { zh: "刷新状态", en: "Refresh status" }, disposal: false, action: null },
  clearNotice: { label: { zh: "清除此提示", en: "Clear this notice" }, tip: { zh: "只在本机不再显示；不撤回消息", en: "Only hides it on this computer; the message is not withdrawn" }, disposal: true, action: null },
  hideLocal: { label: { zh: "不再显示", en: "Hide" }, tip: { zh: "只在本机不再显示；不会撤回可能已经送到的内容", en: "Only hides it on this computer; anything that may have been delivered is not withdrawn" }, disposal: true, action: null },
} as const satisfies Record<NextUpEffectId, NextUpEffectDef>;

/** Fixed panel controls that are not messages (registry §三). Same freeze rules. */
export const NEXT_UP_PANEL_CONTROLS = {
  scheduledContinue: { label: { zh: "已安排稍后继续", en: "Scheduled to continue later" }, buttons: [{ zh: "取消本次继续", en: "Cancel this continuation" }] },
  resetCredit: { label: { zh: "可使用重置券", en: "Reset credit available" }, buttons: [{ zh: "用一张", en: "Use one" }, { zh: "收起", en: "Hide" }] },
  grantNotice: { label: { zh: "批准通知等待送达", en: "Approval notice waiting to be delivered" }, buttons: [] },
  cleanupUnconfirmed: { label: { zh: "清理所有未确认（{n}）", en: "Clear all unconfirmed ({n})" }, armed: { zh: "再点一次清理（{n}）", en: "Click again to clear ({n})" }, tip: { zh: "放弃这个 agent 所有送达未确认的消息，包括时间线里的", en: "Dismisses every unconfirmed message of this agent, including those in the timeline" }, buttons: [] },
  releaseLease: { label: { zh: "释放占用", en: "Release" }, tip: { zh: "要点两次确认", en: "Click twice to confirm" }, buttons: [] },
  /** 1.8: the agent is paused — 继续 resumes the whole agent (kept from before the registry). */
  agentPaused: { label: { zh: "智能体已暂停", en: "Agent paused" }, buttons: [{ zh: "继续", en: "Resume" }] },
  /** 1.8, old hosts only (no input ledger): the queue a stop paused — 继续 sends it in order; 放回输入框 puts the
   *  messages back in the input box in order; 全部放弃 drops it after a second click. */
  legacyPausedQueue: { label: { zh: "暂停中，未发送", en: "Paused, not sent" }, buttons: [{ zh: "继续", en: "Resume" }, { zh: "放回输入框", en: "Back to input box" }, { zh: "全部放弃", en: "Dismiss all" }], armed: { zh: "再点一次全部放弃（{n}）", en: "Click again to dismiss all ({n})" }, legacyOnly: true },
} as const;
export type NextUpPanelControlId = keyof typeof NEXT_UP_PANEL_CONTROLS;
/** Controls a host with the input ledger may show (legacy-only ones are for older hosts). */
export const isLedgerPanelControl = (id: string | undefined): id is NextUpPanelControlId =>
  !!id && id in NEXT_UP_PANEL_CONTROLS && !("legacyOnly" in NEXT_UP_PANEL_CONTROLS[id as NextUpPanelControlId]);

/** Words that must never show again (registry §二); a test checks no Next Up string contains them. */
export const RETIRED_WORDS = ["对方正忙", "主机正忙", "等待插入时机", "合并结果", "已接收", "已登记", "积压过久等你放行"] as const;

// ---------- projection: backend record → registry state ----------

/** Where a waiting reason goes. Exhaustive: a new backend reason fails to compile here. */
const WAITING_TO_STATE = {
  explicitQueue: "queued",
  afterTurn: "afterWork",
  nextStep: "awaitingRead",
  passive: "passiveNote",
  turnRunning: "afterWork",
  turnFinishing: "afterWork",
  adapterQueued: "afterWork",
  ownerQueueAhead: "queued",
  rideAlongAhead: "queued",
  delegationLease: "afterWork",
  eventLease: "queued",
  paused: "paused",
  stopHold: "paused",
  ownerPause: "held",
  agentOffline: "awaitingOnline",
  runtimeDisconnected: "awaitingReconnect",
  hostBusy: "queued",
  resultCoalescing: "queued",
  autoRetry: "queued",
  reviewPending: "review",
  targetBusy: "afterWork",
  staleHeld: "needsAction",
  nativeHeld: "needsAction",
  nativeRetry: "queued",
  returned: "queued",
  ownerRetry: "sending",
} as const satisfies Record<InputWaitingReason, NextUpStateId>;

/** Where a non-waiting state goes ("hidden" = it leaves Next Up). Exhaustive over InputState. */
const STATE_TO_STATE = {
  received: "sending",
  held: "queued",
  waiting: "queued", // by reason: WAITING_TO_STATE
  sending: "sending",
  accepted: "awaitingRead",
  inContext: "hidden",
  uncertain: "unconfirmed",
  failed: "failed",
  rejected: "hidden",
  discarded: "hidden",
  superseded: "hidden",
} as const satisfies Record<InputState, NextUpStateId | "hidden">;

/** Who gets which buttons of a state: owner messages, delegation requests, everything else. */
type KindGroup = "owner" | "request" | "other";
const kindGroup = (kind: InputKind): KindGroup => kind === "owner" ? "owner" : kind === "delegationRequest" ? "request" : "other";

const BUTTONS_BY_GROUP = {
  queued: { owner: ["insertNow", "sendNow", "edit", "remove", "dismiss"], request: ["dismiss", "viewDelegation"], other: ["hold", "dismiss", "viewDelegation"] },
  afterWork: { owner: ["interruptSend", "dismiss"], request: ["dismiss", "viewDelegation"], other: ["hold", "dismiss", "viewDelegation"] },
  awaitingRead: { owner: ["interruptSend", "dismiss"], request: ["dismiss", "viewDelegation"], other: ["dismiss", "viewDelegation"] },
  passiveNote: { owner: ["dismiss"], request: ["dismiss"], other: ["readNow", "dismiss"] },
  held: { owner: ["dismiss"], request: ["dismiss"], other: ["releaseHold", "dismiss"] },
  paused: { owner: ["resume", "viewDetails", "dismiss"], request: ["resume", "viewDetails", "dismiss"], other: ["resume", "viewDetails", "dismiss"] },
  awaitingOnline: { owner: ["start", "dismiss"], request: ["start", "dismiss", "viewDelegation"], other: ["start", "dismiss", "viewDelegation"] },
  awaitingReconnect: { owner: ["viewReason", "dismiss"], request: ["viewReason", "dismiss"], other: ["viewReason", "dismiss"] },
  // Review normally comes only on a delegation request; any other kind gets the same buttons (grey without a known ask).
  review: { owner: ["approve", "reject", "viewDelegation"], request: ["approve", "reject", "viewDelegation"], other: ["approve", "reject", "viewDelegation"] },
  needsAction: { owner: ["releaseHold", "viewReason", "dismiss"], request: ["viewReason", "dismiss", "viewDelegation"], other: ["releaseHold", "viewReason", "dismiss", "viewDelegation"] },
  unconfirmed: { owner: ["retry", "dismiss", "viewReason"], request: ["retry", "dismiss", "viewReason"], other: ["retry", "dismiss", "viewReason"] },
  failed: { owner: ["retry", "moveToComposer", "dismiss", "viewReason"], request: ["retry", "dismiss", "viewReason"], other: ["retry", "dismiss", "viewReason"] },
  // 1.9: Dismiss on 1 and 14 only when the host has input-disposal-v1 (id-only, any state / kind): see DISPOSE_ONLY.
  // State 10 keeps Reject as its disposal (Director 2026-11-14: no third "stop waiting" button there).
  sending: { owner: ["dismiss"], request: ["dismiss"], other: ["dismiss"] },
  unknown: { owner: ["refresh", "viewDetails", "dismiss", "clearNotice"], request: ["refresh", "viewDetails", "dismiss", "clearNotice"], other: ["refresh", "viewDetails", "dismiss", "clearNotice"] },
} as const satisfies Record<NextUpStateId, Record<KindGroup, readonly NextUpEffectId[]>>;

/** A notice (Claude Task delivery / delegation status): its resend and dismiss words are the notice variants. */
export function isNotice(record: Pick<InputRecord, "kind" | "details">): boolean {
  return record.kind === "delegationStatus" || (record.details?.retryEffect === "redeliverNotice" && record.details?.taskRestartsOnRetry === false);
}

/** The buttons of `state` for this record, in display order (notice variants swapped in). Registered effects only. */
export function buttonsFor(state: NextUpStateId, record: Pick<InputRecord, "kind" | "details" | "askId">): NextUpEffectId[] {
  const notice = isNotice(record);
  return (BUTTONS_BY_GROUP[state][kindGroup(record.kind)] as readonly NextUpEffectId[])
    .map(effect => notice && effect === "dismiss" ? "ignoreNotice" : notice && effect === "retry" && record.kind !== "delegationStatus" ? "retryNotice" : effect)
    .filter(effect => effect !== "viewDelegation" || !!record.askId);
}

export type NextUpProjection =
  | { kind: "hidden" }
  | {
      kind: "state";
      state: NextUpStateId;
      buttons: NextUpEffectId[];
      /** Set for state 14: what was not recognised (diagnostics only, never the main text). */
      unknown?: { field: "kind" | "state" | "reason" | "stage"; code: string };
    };

const KNOWN_ACTIONS = new Set<string>(INPUT_ACTIONS);
/** Backend actions the record offers that this table knows (unknown ones never become buttons). */
export function knownActions(record: Pick<InputRecord, "actions">): InputAction[] {
  return (record.actions ?? []).filter((action): action is InputAction => KNOWN_ACTIONS.has(action));
}

/** `details.stuck` of an owner record the host found stuck (input_ledger.rs STUCK_CASES). */
const STUCK_CASES = new Set(["generationChanged", "leaseStale", "orphan"]);
/** `details.hold.reason` (asks/ledger.rs queued_reason) that will not clear by waiting: the owner must act. */
const OWNER_HOLDS = new Set(["peerVersionMismatch", "peerIdentityChanged", "waitingForInput"]);
/** Older hosts keep these native holds as `waiting`; they describe an unknown outcome, not a temporary wait. */
const UNCERTAIN_NATIVE = new Set(["request_uncertain", "interrupted"]);

/**
 * The registry state of a record, from the host's fields only (no clock: the daemon decides deadlines and states).
 * Never reads labels or i18n; never guesses from text. Unknown kind / state / reason / stage → state 14.
 */
export function projectNextUp(record: Pick<InputRecord, "kind" | "state" | "reason" | "stage" | "details" | "askId" | "stalled" | "surface">): NextUpProjection {
  const unknown = (field: "kind" | "state" | "reason" | "stage", code: string): NextUpProjection =>
    ({ kind: "state", state: "unknown", buttons: buttonsFor("unknown", { ...record, kind: (INPUT_KINDS as readonly string[]).includes(record.kind) ? record.kind : "agentMessage" }), unknown: { field, code } });
  if (!(INPUT_KINDS as readonly string[]).includes(record.kind)) return unknown("kind", String(record.kind));
  const base = (STATE_TO_STATE as Record<string, NextUpStateId | "hidden">)[record.state];
  if (!base) return unknown("state", String(record.state));
  const reasons = INPUT_REASONS_BY_STATE[record.state] as readonly string[] | undefined;
  if (record.reason !== null && record.reason !== undefined && (!reasons || !reasons.includes(record.reason))) return unknown("reason", String(record.reason));
  if (record.stage !== null && record.stage !== undefined && !(INPUT_STAGES as readonly string[]).includes(record.stage)) return unknown("stage", String(record.stage));
  let state: NextUpStateId | "hidden" = base;
  if (record.state === "waiting") {
    if (!record.reason) return unknown("reason", "");
    state = WAITING_TO_STATE[record.reason as InputWaitingReason];
    if (record.reason === "nativeHeld" && UNCERTAIN_NATIVE.has(String(record.details?.nativeReason))) state = "unconfirmed";
    if (record.reason === "ownerRetry" && record.kind === "owner" && record.stalled?.reason === "noProgress") state = "unconfirmed";
    // Someone else's message waiting to be resent is queued (the host offers its dismiss there), not "sending".
    if (record.reason === "ownerRetry" && record.kind !== "owner") state = "queued";
    const hold = (record.details?.hold as { reason?: unknown } | undefined)?.reason;
    if (typeof hold === "string" && OWNER_HOLDS.has(hold)) state = "needsAction";
  }
  if (record.state === "accepted" && record.surface === "pendingNotes") state = "passiveNote";
  // A sending / accepted record the host marked stalled: the runtime dropped (→ reconnect), or the host found it stuck
  // (owner, details.stuck → it offers resend / dismiss, as for an unconfirmed one).
  if ((record.state === "sending" || record.state === "accepted") && record.stalled?.reason === "runtimeDisconnected") state = "awaitingReconnect";
  if ((record.state === "sending" || record.state === "accepted") && record.kind === "owner" && record.stalled?.reason === "noProgress" && STUCK_CASES.has(String(record.details?.stuck))) state = "unconfirmed";
  if (state === "hidden") return { kind: "hidden" };
  return { kind: "state", state, buttons: buttonsFor(state, record) };
}

/**
 * Whether Next Up shows this record at all (any state, including unknown). The one rule for both the row and the
 * durable local clear marks: a mark may be reclaimed only for a record this says is gone from Next Up.
 */
export const shownInNextUp = (record: Parameters<typeof projectNextUp>[0]): boolean => projectNextUp(record).kind !== "hidden";

/** A label in the given language. */
export const textOf = (text: Text, lang: Lang): string => text[lang];

/** zh-* locales read the Chinese words, every other locale the English ones (the registry ships zh-CN and en). */
export const langOf = (locale: string | undefined): Lang => (locale ?? "").startsWith("zh") ? "zh" : "en";

// ---------- availability: which buttons work now ----------

/** Why a registered button is grey (registry §一 补充规则: a button that cannot be used now shows grey with a reason). */
export const DISABLED_REASONS = {
  notOffered: { zh: "这台主机现在不接受这个操作", en: "The host does not accept this right now" },
  loading: { zh: "正在读取这条消息，稍等", en: "Loading this message, one moment" },
  noDelegation: { zh: "还没读到这个委托", en: "This delegation has not loaded yet" },
  notReviewable: { zh: "这个委托现在不能在这里审核，点「查看委托」", en: "This delegation cannot be reviewed here now; use “View delegation”" },
  notStartable: { zh: "这个 agent 现在不能从这里启动", en: "This agent cannot be started from here now" },
  notIdle: { zh: "对方正在工作，下次工作时会读到", en: "The agent is working; it reads this during its next work" },
  noText: { zh: "原文不在本机，不能放回输入框", en: "The text is not on this computer, so it cannot go back to the input box" },
  readOnly: { zh: "这里只能查看", en: "View only here" },
  pending: { zh: "正在处理", en: "Working on it" },
  composerBusy: { zh: "输入框里还有没发出的文字，先发出或清空", en: "The input box still has unsent text; send or clear it first" },
} as const satisfies Record<string, Text>;
export type DisabledReasonId = keyof typeof DISABLED_REASONS;

/** What the row knows besides the record (all optional; absent = not available). */
export interface NextUpContext {
  readOnly?: boolean;
  /** Owner row: its QueueItem (full text, queueId) has loaded. */
  queueItem?: boolean;
  /** The delegation is in the store (title, review state). */
  askKnown?: boolean;
  /** The delegation's review can be decided here (owner review pending, decision available). */
  canReview?: boolean;
  /** Session resume is possible (paused / stop-held). */
  canResume?: boolean;
  /** The agent can be started from here. */
  canStart?: boolean;
  /** Read now (wake) possible: the agent is idle. */
  canReadNow?: boolean;
  /** The original text is on this computer (failed owner message). */
  hasText?: boolean;
  /** The agent is idle (send now instead of insert). */
  idle?: boolean;
  /** Owner row edit: the input box is empty (editing puts the text there). Absent = true. */
  composerEmpty?: boolean;
  /** The host has input-disposal-v1: every host disposal goes through the id-only `cutex/input/dispose`, which works
   *  in any state for any kind (registry 1.9), so it never waits for `record.actions`. */
  disposal?: boolean;
  /** The owner's dispose of this row is accepted but not applied yet (receipt `appliedAt` null): its buttons are grey
   *  ("working on it") until the host applies it — no new state. */
  disposing?: boolean;
}

export interface NextUpButton {
  effect: NextUpEffectId;
  enabled: boolean;
  /** Registered reason when grey. */
  reason?: DisabledReasonId;
}

/** Host-disposal effects (they end the row on the host: `dismiss` in record.actions, or dispose with input-disposal-v1).
 *  With input-disposal-v1 the owner's 删除 (`remove`) is one too: same word, but it goes to the id-only dispose instead of
 *  the revisioned queue remove (components/InputStatus routes it), so it never waits for the queue item. */
const HOST_DISPOSALS: ReadonlySet<NextUpEffectId> = new Set(["dismiss", "ignoreNotice", "moveToComposer", "remove"]);
/** States whose Dismiss exists only through input-disposal-v1 (an older host has no dismiss there at all). */
const DISPOSE_ONLY: Partial<Record<NextUpStateId, ReadonlySet<NextUpEffectId>>> = { sending: new Set(["dismiss", "ignoreNotice"]), unknown: new Set(["dismiss", "ignoreNotice"]) };
/** Effects that never change anything (they stay usable while a dispose is pending). */
const VIEW_ONLY: ReadonlySet<NextUpEffectId> = new Set(["viewDelegation", "viewDetails", "viewReason", "refresh"]);

/** Buttons that are alternatives for one disposal: only one shows (the first that works, else the first, grey). */
const ALTERNATIVES: readonly (readonly NextUpEffectId[])[] = [["insertNow", "sendNow"], ["remove", "dismiss"]];

function available(effect: NextUpEffectId, record: Pick<InputRecord, "actions" | "askId" | "kind">, ctx: NextUpContext): NextUpButton {
  const def: NextUpEffectDef = NEXT_UP_EFFECTS[effect];
  const offered = (action: InputAction) => (record.actions ?? []).includes(action);
  const grey = (reason: DisabledReasonId): NextUpButton => ({ effect, enabled: false, reason });
  if (ctx.readOnly && effect !== "viewDelegation" && effect !== "viewDetails" && effect !== "viewReason") return grey("readOnly");
  if (ctx.disposing && !VIEW_ONLY.has(effect)) return grey("pending");
  if (ctx.disposal && HOST_DISPOSALS.has(effect)) return effect === "moveToComposer" && !ctx.hasText ? grey("noText") : { effect, enabled: true };
  switch (effect) {
    case "insertNow": case "sendNow": case "edit": case "remove":
      if (record.kind === "owner" && !offered(def.action!)) return grey("notOffered");
      if (record.kind === "owner" && !ctx.queueItem) return grey("loading");
      if (effect === "insertNow" && ctx.idle) return grey("notOffered");
      if (effect === "sendNow" && !ctx.idle) return grey("notOffered");
      if (effect === "edit" && ctx.composerEmpty === false) return grey("composerBusy");
      return { effect, enabled: true };
    case "viewDelegation": return record.askId ? { effect, enabled: true } : grey("noDelegation");
    case "approve": case "reject":
      if (!ctx.askKnown) return grey("noDelegation");
      return ctx.canReview ? { effect, enabled: true } : grey("notReviewable");
    case "resume": return ctx.canResume ? { effect, enabled: true } : grey("notOffered");
    case "start": return ctx.canStart ? { effect, enabled: true } : grey("notStartable");
    case "readNow": return ctx.canReadNow ? { effect, enabled: true } : grey("notIdle");
    case "moveToComposer": if (!ctx.hasText) return grey("noText"); return offered("dismiss") ? { effect, enabled: true } : grey("notOffered");
    case "viewDetails": case "viewReason": case "refresh": case "clearNotice": case "hideLocal": return { effect, enabled: true };
    default: return def.action && offered(def.action) ? { effect, enabled: true } : grey("notOffered");
  }
}

/** The buttons a row shows now: registered for its state and kind, each enabled or grey with a reason. */
export function rowButtons(projection: Extract<NextUpProjection, { kind: "state" }>, record: Pick<InputRecord, "actions" | "askId" | "kind">, ctx: NextUpContext = {}): NextUpButton[] {
  const all = projection.buttons.filter(effect => ctx.disposal || !DISPOSE_ONLY[projection.state]?.has(effect)).map(effect => available(effect, record, ctx));
  const out: NextUpButton[] = [];
  for (const button of all) {
    const group = ALTERNATIVES.find(g => g.includes(button.effect));
    if (!group) { out.push(button); continue; }
    if (out.some(b => group.includes(b.effect))) continue;
    const members = all.filter(b => group.includes(b.effect));
    out.push(members.find(b => b.enabled) ?? members[0]!);
  }
  return out;
}

/** The row has a disposal that works now, or the host's deadline moves it on (registry §五). */
export function hasExit(projection: Extract<NextUpProjection, { kind: "state" }>, buttons: readonly NextUpButton[]): boolean {
  if (buttons.some(b => b.enabled && NEXT_UP_EFFECTS[b.effect].disposal)) return true;
  return NEXT_UP_STATES[projection.state].exit.kind === "deadline";
}

// ---------- fixed details (row-end add-ons; same freeze rules) ----------

/** Fixed wording of the add-ons a row may carry after its label. `{x}` placeholders only. */
export const NEXT_UP_DETAILS = {
  /** Results waiting to be sent together (state 2 with a host deadline). */
  coalescing: { zh: "{n} 秒后一起送", en: "sends together in {n}s" },
  /** Waiting longer than the host's stall threshold. */
  stalled: { zh: "已等 {n} 分钟", en: "Waiting {n} min" },
  /** The approval notice of a safety block (panel control 批准通知等待送达). */
  grantWaiting: { zh: "已批准一次，等待当前工具返回后送达", en: "Approved once; delivered when the current tool returns" },
  grantCap: { zh: "最晚 {time} 前有效", en: "valid until {time} at the latest" },
  grantRead: { zh: "已送达 · 有效至 {time}", en: "Delivered · valid until {time}" },
} as const satisfies Record<string, Text>;

/** `{name}` placeholders filled in. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in values ? String(values[name]) : all));
}

/** The Help page 「接下来里的状态」: every state with its meaning and buttons, straight from this table. */
export function helpRows(lang: Lang): { n: number; id: NextUpStateId; labelKeys: string[]; meaning: string; buttons: string[]; disposals: string[]; deadline: { to: NextUpStateId } | null; info: string | null }[] {
  return NEXT_UP_STATE_IDS.map(id => {
    const def: NextUpStateDef = NEXT_UP_STATES[id];
    const labelKeys = id === "afterWork" ? [stateLabelKey(id, "timed"), stateLabelKey(id, "untimed")] : [stateLabelKey(id)];
    const disposals = def.exit.kind === "owner" ? def.exit.disposals.map(e => NEXT_UP_EFFECTS[e].label[lang]) : [];
    const deadline = def.exit.kind === "deadline" ? { to: def.exit.to } : null;
    return { n: def.n, id, labelKeys, meaning: def.meaning[lang], buttons: def.buttons.map(e => NEXT_UP_EFFECTS[e].label[lang]), disposals, deadline, info: def.info?.[lang] ?? null };
  });
}

/**
 * A send of the owner's this desktop holds before the host's first record for it (O0): its registry state and buttons.
 * `sending` → state 1; `unconfirmed` → state 12 (or 13 when the host says the id is unknown). Hiding is local only and
 * says so (「不再显示」: never withdraws what may have arrived).
 */
export function localSendView(phase: "sending" | "unconfirmed", error?: string): { state: NextUpStateId; buttons: NextUpEffectId[] } {
  // Never a row without a button (Director 2026-11-14): hiding is durable and says it withdraws nothing.
  if (phase === "sending") return { state: "sending", buttons: ["hideLocal"] };
  return { state: error === "input_not_found" ? "failed" : "unconfirmed", buttons: ["retry", "hideLocal"] };
}

/** 「不再显示」 could not be stored: the row stays (registry 1.4: a hide that is not durable is not claimed done). */
export const LOCAL_HIDE_FAILED: Text = { zh: "没能保存「不再显示」，这一条还会显示", en: "Could not save “Hide”; this one still shows" };

/**
 * The identity of a row (registry 1.7 / 1.9): one delivery occurrence, not one delegation. The host's input id is that
 * occurrence (requestAdmissionOccurrencesV1: a reopened / revised / retried delegation request gets `askId::input-N`;
 * occurrence 0 keeps the ask id; an older host has one input per ask). Rows, tombstones and dedupe key on it, so a
 * disposed occurrence never hides the next one. The delegation link always stays on `askId`.
 */
export function rowIdentity(record: Pick<InputRecord, "inputId">): string {
  return record.inputId;
}
