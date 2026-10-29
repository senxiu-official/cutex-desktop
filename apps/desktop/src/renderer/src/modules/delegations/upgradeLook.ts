// Shared classes and status looks of the delegation-upgrade preview surfaces (tree, run control, routing,
// members, their dialogs), so they follow the visual language (docs/design/040 §1–§2) instead of each
// file's own sizes. Looks only: nothing here decides what is shown or allowed.
import type { StatusGlyph, StatusTone } from "../../lib/delegations";
import type { TagTone } from "../../components/Tag";
import type { UpgradeApproval, UpgradeNode, UpgradeRunControl } from "./upgradeTypes";

/** A text field / select: 28 px, `rounded-ctl`, the page background inside a surface. */
export const FIELD = "h-7 min-w-0 rounded-ctl border border-border bg-background px-2 text-ui text-foreground outline-none placeholder:text-subtle focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-40";
/** Native checkbox / radio in the accent colour (kept native: the forms post their own `checked`). */
export const CHECK = "size-3.5 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40";
/** A section of the workspace (运行控制, 路由审批, 成员): title row. */
export const SECTION_TITLE = "text-ui font-semibold text-foreground";
/** A group inside a section (活动成员, 已有授权): small muted heading. */
export const GROUP_TITLE = "flex h-6 items-center gap-1.5 text-meta font-medium text-muted";
/** A grouped block on the panel: the `--surface` face, no border (cards in a card get no frame, 040 §2). */
export const BLOCK = "rounded-inner bg-surface p-3";
/** Dialog frame: the app's typed-confirmation dialogs (TypedRuleConfirmation, storage cleanup). */
export const DIALOG = "fixed inset-0 m-auto max-h-[90vh] w-[460px] max-w-[95vw] overflow-y-auto rounded-dialog border border-border bg-surface p-5 text-ui text-foreground shadow-e3 backdrop:bg-foreground/30";
/** One choice of a dialog (stop scope, archive kind): a bordered row, the checked one on the accent face. */
export const CHOICE = "flex cursor-pointer items-center gap-2 rounded-ctl border border-border px-3 py-2 text-ui hover:bg-hover has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:disabled]:cursor-default has-[:disabled]:opacity-50";
/** The confirm button of a destructive dialog: solid red. Its own fill (--danger-solid), not --danger: dark --danger is a light
 *  red made for text, white on it is 2.8:1 (measured 2026-10-26). */
export const DANGER_SOLID = "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-ctl bg-danger-solid px-3 text-ui font-medium whitespace-nowrap text-on-accent transition-colors hover:brightness-110 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40";

/** The glyph of a tree node, like the 委托 list's status mark (glyph + word, never colour alone). */
export function nodeGlyph(node: UpgradeNode, continuing: boolean, limited: boolean): { glyph: StatusGlyph; tone: StatusTone } {
  if (node.closed) {
    if (node.closed === "failed" || node.closed === "routing_denied" || node.closed === "rejected") return { glyph: "cross", tone: "danger" };
    if (node.closed === "stopped") return { glyph: "ring", tone: "neutral" };
    return node.execution === "answered" || node.closed === "completed" || node.closed === "accepted" ? { glyph: "check", tone: "green" } : { glyph: "dot", tone: "neutral" };
  }
  if (limited) return { glyph: "hollow", tone: "warn" };
  if (continuing) return { glyph: "pulse", tone: "accent" };
  switch (node.execution) {
    case "running": return { glyph: "pulse", tone: "accent" };
    case "answered": return { glyph: "check", tone: "green" };
    case "interrupted": return { glyph: "ring", tone: "neutral" };
    default: return { glyph: "hollow", tone: "muted" };
  }
}

export const PHASE_TONE: Record<UpgradeRunControl["phase"], TagTone> = { running: "ok", pausing: "attention", paused: "attention", partial: "attention" };
export const APPROVAL_TONE: Record<UpgradeApproval["state"], TagTone> = { pending: "attention", approved: "ok", denied: "danger", stale: "attention", cancelled: "neutral" };
