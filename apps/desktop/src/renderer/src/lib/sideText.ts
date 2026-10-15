// Texts of the right side that are built from the layout (page-button tooltips). Kept out of the
// component files; translate() is read at render time (the lane re-renders on a language change).
import { translate } from "../i18n";
import { cardName, pageLabel } from "./sideActions";
import { visibleTabs, type SideLayout, type SidePage, type SideViewContext } from "./sideLayout";
import type { PillContent } from "./sidePills";

/** Page name + Ctrl+Shift+n, then one line per card: name ×n · k pending · running · new (other agents greyed). */
export function pillTooltip(page: SidePage, index: number, pill: PillContent, layout: SideLayout, ctx: SideViewContext): string {
  const head = `${pageLabel(page)}${index < 9 ? `  ${translate("side.pill.shortcut", { n: index + 1 })}` : ""}`;
  if (pill.launcher) return `${head}\n${translate("side.launcher.title")}`;
  const lines = page.cards.map((card) => {
    const visible = visibleTabs(layout, card, ctx);
    const icon = pill.icons.find((i) => i.cardId === card.id);
    const n = visible.length || card.tabs.length;
    const parts = [`${cardName(card)}${n > 1 ? ` ${translate("side.pill.count", { n })}` : ""}`];
    if (icon?.attention) parts.push(translate("side.pill.attention", { n: icon.attention }));
    if (icon?.busy) parts.push(translate("side.pill.running"));
    if (icon?.unread) parts.push(translate("side.pill.unread"));
    if (!visible.length) parts.push(`(${translate("side.pill.other")})`);
    return `• ${parts.join(" · ")}`;
  });
  return [head, ...lines].join("\n");
}
