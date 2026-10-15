// Esc anywhere in the conversation stops the selected agent's running turn (Claude Code / ZCode
// style), not only while the composer has focus. The composer textarea keeps its own handler
// (lib/sendKeys.ts); this covers the rest of the conversation view. Guards (decided on a snapshot
// taken when the key event starts, before other handlers close their popups):
//   - a dialog / menu / popover / palette / composer panel / pending approval is open → its Esc;
//   - focus in a text input / editable (the composer, the terminal, a search box) → theirs;
//   - a text selection in the page → Esc only clears it (copying should not stop a turn);
//   - modifiers, key repeat, IME composition, an Esc another handler already consumed;
//   - focus / target inside the right side or a gutter ([data-side-root] / [data-gutter-root]) → never
//     a turn interrupt there (docs/desktop-modules.md §19 Esc chain);
//   - a right-side layer in front (maximised / full screen, the narrow-window drawer) → its Esc first;
//   - idle agent → nothing.
// A delegation turn (the agent handles someone's delegation) asks for a second Esc within
// ESC_CONFIRM_MS, bound to the same turn: stopping it from a stray key press affects the
// delegation's requester. Pure decision here; the DOM probes below feed it.
import type { SendKeyPreset } from "./sendKeys";

/** Window for the confirming second Esc on a delegation turn. */
export const ESC_CONFIRM_MS = 1500;

export interface ConversationEscEvent {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  repeat: boolean;
  /** IME composition in progress. */
  composing: boolean;
  /** Another handler already used the key (preventDefault). */
  defaultPrevented: boolean;
}

export interface ConversationEscContext {
  preset: SendKeyPreset;
  /** The selected agent's running turn; null = idle. */
  turnId: string | null;
  /** A dialog / menu / popover / palette / panel / pending interaction is open (snapshot at key down). */
  blocked: boolean;
  /** Focus is in a text input / textarea / select / contenteditable. */
  editableFocus: boolean;
  /** A non-empty text selection in the page. */
  textSelection: boolean;
  /** The key event comes from (or focus is in) the right side / a gutter: Esc there never interrupts. */
  inSide?: boolean;
  /** A right-side layer is in front (maximised / full screen / narrow drawer): it takes the Esc. */
  sideLayers?: boolean;
  /** Steers of this agent still waiting for the native to read them. */
  pendingSteers: number;
  /** The running turn handles a delegation. */
  delegation: boolean;
  /** A previous Esc armed the confirmation: for which turn, and when (ms). */
  armed: { turnId: string; at: number } | null;
  now: number;
}

export type ConversationEscDecision =
  | { kind: "ignore" }
  | { kind: "clearSelection" }
  /** First Esc on a delegation turn: show the "press again" hint. */
  | { kind: "arm"; turnId: string }
  | { kind: "act"; action: "interrupt" | "interruptSendSteers"; turnId: string };

export function conversationEscDecision(e: ConversationEscEvent, ctx: ConversationEscContext): ConversationEscDecision {
  if (e.key !== "Escape" || e.ctrl || e.shift || e.alt || e.meta || e.repeat || e.composing || e.defaultPrevented) return { kind: "ignore" };
  if (!ctx.turnId || ctx.blocked || ctx.editableFocus || ctx.inSide || ctx.sideLayers) return { kind: "ignore" };
  if (ctx.textSelection) return { kind: "clearSelection" };
  const confirmed = !ctx.delegation || (ctx.armed !== null && ctx.armed.turnId === ctx.turnId && ctx.now - ctx.armed.at <= ESC_CONFIRM_MS);
  if (!confirmed) return { kind: "arm", turnId: ctx.turnId };
  // Same mapping as the composer's Esc (composerKeyAction).
  return { kind: "act", action: ctx.preset === "cli" && ctx.pendingSteers > 0 ? "interruptSendSteers" : "interrupt", turnId: ctx.turnId };
}

// ---- DOM probes (not unit-tested) ----

/** A text-entry element (Esc there belongs to it). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  return target.tagName === "INPUT" && !["checkbox", "radio", "range", "button", "submit", "reset", "color", "file"].includes((target as HTMLInputElement).type);
}

const OVERLAY_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[aria-modal="true"]';

/** A visible dialog / menu / listbox anywhere in the document. */
export function overlayInDom(doc: Document = document): boolean {
  for (const el of doc.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)) {
    if (el.getClientRects().length > 0) return true;
  }
  return false;
}

const SIDE_ROOT_SELECTOR = "[data-side-root],[data-gutter-root]";

/** The element is inside the right side (area or instance layer) or a conversation gutter. */
export function inSideRoot(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(SIDE_ROOT_SELECTOR);
}

/** A non-collapsed text selection (outside inputs, whose selection is not reported here). */
export function pageHasSelection(): boolean {
  const sel = window.getSelection();
  return !!sel && sel.rangeCount > 0 && !sel.isCollapsed && sel.toString().length > 0;
}
