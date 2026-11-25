// Composer send shortcuts ("发送快捷键" setting). Two presets; pure so the mapping is testable.
//   queueFirst (default): Enter queues while a turn runs (starts one when idle), Ctrl+Enter steers
//     (insert at the next tool boundary, no interrupt), Ctrl+Shift+Enter interrupts & sends,
//     Esc interrupts.
//   cli (Codex CLI style): Enter steers while a turn runs, Tab queues, Esc interrupts — and while
//     steers are still waiting it interrupts and sends them right away.
// 「多行时 Enter 换行」 (owner 2026-11-24, off by default; .claude/reports/composer-enter-study-20261124.md 方案 B): once the
// draft has a line break, plain Enter only adds a line; Ctrl/Cmd+Enter keeps its meaning (send when idle, steer while a
// turn runs), Shift+Enter, Ctrl+Shift+Enter, Tab and Esc are unchanged; a one-line draft behaves as above. An IME
// composition's Enter never reaches this (the composers stop it first).

export type SendKeyPreset = "queueFirst" | "cli";

export type ComposerKeyAction =
  /** Idle: start a turn. Busy: queue (queueFirst) — the plain "send" button. */
  | "send"
  | "steer"
  | "queue"
  | "interruptSend"
  | "interrupt"
  /** Interrupt the turn and send the steers it has not read yet (store.interruptAndSendSteers). */
  | "interruptSendSteers";

export interface ComposerKeyEvent {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt?: boolean;
}

export interface ComposerKeyContext {
  busy: boolean;
  /** Something to send (text or images). */
  hasContent: boolean;
  /** Steers of this agent still waiting for the native to read them. */
  pendingSteers: number;
  /** Caret without a selection (Esc keeps clearing a selection otherwise). */
  collapsedSelection: boolean;
  /** 「多行时 Enter 换行」 applies to this press: the setting is on and the draft already has a line break. */
  multilineNewline?: boolean;
}

/** A draft with a line break (where 「多行时 Enter 换行」 turns plain Enter into a new line). */
export const isMultilineDraft = (text: string): boolean => /\r|\n/.test(text);

/** The composer hint while 「多行时 Enter 换行」 applies: what Ctrl/Cmd+Enter does now and how to queue. */
export type MultilineHint = "idle" | "busyQueueFirst" | "busyCli" | "busyQueueOnly";
export function multilineHint(preset: SendKeyPreset, busy: boolean, steerKeysQueue = false): MultilineHint {
  if (!busy) return "idle";
  // A delegation turn without steer shortcuts: Ctrl+Enter queues (lib/delegationTurn delegationKeyAction).
  if (steerKeysQueue) return "busyQueueOnly";
  return preset === "cli" ? "busyCli" : "busyQueueFirst";
}

/** Action for a key press in the composer textarea (popups handled before), or null = default. */
export function composerKeyAction(preset: SendKeyPreset, e: ComposerKeyEvent, ctx: ComposerKeyContext): ComposerKeyAction | null {
  if (e.alt) return null;
  if (e.key === "Escape") {
    if (!ctx.busy || !ctx.collapsedSelection) return null;
    return preset === "cli" && ctx.pendingSteers > 0 ? "interruptSendSteers" : "interrupt";
  }
  if (e.key === "Tab") {
    return preset === "cli" && ctx.busy && ctx.hasContent && !e.ctrl && !e.shift ? "queue" : null;
  }
  if (e.key !== "Enter") return null;
  if (e.shift && !e.ctrl) return null; // newline
  if (e.ctrl) return e.shift ? "interruptSend" : "steer";
  if (ctx.multilineNewline) return null; // 「多行时 Enter 换行」: a new line
  return preset === "cli" ? "steer" : "send";
}

/** Strategy for a send action given whether a turn runs (cutex "queue" never starts a turn). */
export function strategyFor(action: "send" | "steer" | "join" | "queue" | "interruptSend", busy: boolean): "auto" | "queue" | "interrupt" {
  if (!busy) return "auto";
  if (action === "interruptSend") return "interrupt";
  if (action === "steer" || action === "join") return "auto";
  return "queue";
}
