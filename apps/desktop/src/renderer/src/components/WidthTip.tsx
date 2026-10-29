// The width tooltip (lib/widthTip, checklist #5): a small pill beside the edge being dragged / stepped, 「560 px」
// or 「560 px · 48%」 for a conversation column. Over everything, never takes the pointer. Drawn in the edge's window
// (multi-window P3.5, lib/widthTip `doc`).
import { useI18n } from "../i18n";
import { useWidthTip, type WidthTipState } from "../lib/widthTip";
import { useOwnerWindow } from "../lib/ownerContext";
import { OwnerLayer } from "./OwnerLayer";

export function WidthTip() {
  const tip = useWidthTip((s) => s.tip);
  if (!tip) return null;
  return (
    <OwnerLayer doc={tip.doc}>
      <Tip tip={tip} />
    </OwnerLayer>
  );
}

function Tip({ tip }: { tip: WidthTipState }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const text = tip.pct === null ? t("widthTip.px", { px: tip.px }) : t("widthTip.pct", { px: tip.px, pct: tip.pct });
  // Right of the edge, unless that runs off the window.
  const right = !!win && tip.x + 140 > win.innerWidth;
  return (
    <div
      data-width-tip=""
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed z-[90] rounded-md border border-border bg-surface px-2 py-0.5 text-meta/[inherit] font-medium whitespace-nowrap text-foreground tabular-nums shadow-e2"
      style={{ top: tip.y - 12, left: right ? undefined : tip.x + 10, right: right ? win.innerWidth - tip.x + 10 : undefined }}
    >
      {text}
    </div>
  );
}
