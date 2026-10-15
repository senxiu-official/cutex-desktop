import type { AgentSignal, NeedsYou } from "./agentAttention";

/**
 * Sidebar 状态标签 (Settings → 侧栏): the status chip of an agent row as text (「需要你 ×2」), as an
 * icon only, or automatic: text while the row has room, the icon once the text chip would squeeze or
 * truncate the agent name. The tooltip / aria-label always carry the full text.
 */
export type StatusChips = "auto" | "detailed" | "compact";
export const STATUS_CHIPS: readonly StatusChips[] = ["auto", "detailed", "compact"];
export const DEFAULT_STATUS_CHIPS: StatusChips = "auto";

export function migrateStatusChips(value: unknown): StatusChips {
  return (STATUS_CHIPS as readonly unknown[]).includes(value) ? (value as StatusChips) : DEFAULT_STATUS_CHIPS;
}

/**
 * Colour budget (quiet pass, owner 2026-10-14): a chip keeps its colour only when the owner has to act
 * now — 出错, or a needs-you with a pending decision (等待确认 / 有提问 / 待审批). The rest (待审核 /
 * 待验收 / 结果未知 / owner messages, 完成) are neutral text with a small status dot.
 */
export type ChipTone = "error" | "urgent" | "quiet";
const URGENT_REASONS: readonly string[] = ["confirm", "question", "approval"];

export function chipTone(signal: AgentSignal, needs: NeedsYou | undefined): ChipTone {
  if (signal === "error") return "error";
  if (signal !== "needsYou") return "quiet";
  if (!needs || needs.reasons.length === 0) return "urgent";
  return needs.reasons.some((r) => URGENT_REASONS.includes(r)) ? "urgent" : "quiet";
}

export interface ChipFit {
  /** Width of the row's first line (name, pills, chip, time). */
  lineWidth: number;
  /** The name's natural width (its scrollWidth: the full text even while truncated). */
  nameWidth: number;
  /** Everything else on that line except the name and the chip (Director pill, host dot, time, gaps). */
  otherWidth: number;
  /** The text chip's width (text + padding). */
  chipWidth: number;
}

/** Subpixel rounding tolerance (px). */
const NAME_ROOM = 0.5;

/**
 * Compact or text chip. 自动: compact when name + the text chip + the rest do not fit on the line
 * (the name would be truncated). The inputs do not depend on the chosen mode, so the decision cannot
 * flip back and forth. Without a measurement yet (lineWidth 0), the text chip.
 */
export function chipIsCompact(pref: StatusChips, fit: ChipFit | null): boolean {
  if (pref !== "auto") return pref === "compact";
  if (!fit || fit.lineWidth <= 0) return false;
  return fit.nameWidth + fit.otherWidth + fit.chipWidth > fit.lineWidth + NAME_ROOM;
}
