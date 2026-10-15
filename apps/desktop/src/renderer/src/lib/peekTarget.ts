// Where a reference card opens (docs/desktop-modules.md §19.5; RFC §7.5). Pure.
//   gutter  — the left gutter is wide enough (≥ peekMin): the card sits there
//   overlay — 总在左侧 with a narrow gutter: the card floats over the column from the card's left edge
//   page    — the right side (place(), the reference component's placement); also while the right
//             side is maximised / full screen and the conversation is covered
export type PeekSetting = "auto" | "right" | "left";
export type PeekWhere = "gutter" | "overlay" | "page";

export function peekTarget(setting: PeekSetting, gutterWidth: number, peekMin: number, conversationVisible: boolean): PeekWhere {
  if (!conversationVisible) return "page";
  if (setting === "right") return "page";
  if (gutterWidth >= peekMin) return "gutter";
  return setting === "left" ? "overlay" : "page";
}
