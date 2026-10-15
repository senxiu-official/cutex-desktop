// Long-message folding (lib/messageFold, lib/foldView): clips a message to N lines with a fade and
// 「展开全部（共 M 行）」; an expanded long message gets a 「收起」 that sticks to its top-right while it
// scrolls, plus one at the end. The clip is CSS only (max-height in `lh`), so heights are final at
// first layout; the overlay button takes no space. Focus landing in the hidden part unfolds it.
import type { ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useI18n } from "../i18n";
import { FOLD_SLACK } from "../lib/messageFold";
import type { MessageFold } from "../lib/foldView";

const PILL = "flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-muted shadow-sm hover:text-foreground";

/**
 * `className` must carry the content's font size / line height (the clip is measured in `lh`).
 * `stickyLeft`: the sticky 收起 on the top-left (right-aligned user bubbles, whose top-right sits
 * under a top-corner status capsule).
 */
export function Foldable({ fold, className = "", stickyLeft = false, children }: { fold: MessageFold; className?: string; stickyLeft?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  // Same element tree whether folding applies or not: a reply that stops streaming must not
  // remount its Markdown.
  const clip = fold.clipLines;
  return (
    <div ref={fold.frameRef} className={`relative ${className}`}>
      {fold.collapsible && (
        <div className="sticky top-[var(--fold-sticky-top,0.25rem)] z-10 h-0">
          <div className={`flex ${stickyLeft ? "justify-start" : "justify-end"}`}>
            {/* Left: just outside the bubble (its px-4 padding + a gap), clear of the text. */}
            <button onClick={() => fold.setFolded(true)} className={`${PILL} ${stickyLeft ? "-translate-x-[calc(100%+1.5rem)]" : ""}`}>
              <ChevronsDownUp size={12} />
              {t("fold.collapse")}
            </button>
          </div>
        </div>
      )}
      <div
        className={clip !== null ? "overflow-hidden" : undefined}
        style={
          clip !== null
            ? {
                maxHeight: `${clip + FOLD_SLACK}lh`,
                ...(fold.overflowing && { maskImage: "linear-gradient(to bottom, black calc(100% - 2.2lh), transparent)" }),
              }
            : undefined
        }
        onFocus={(e) => {
          // Keyboard focus (Tab, a jump) into the hidden part unfolds the message.
          if (!fold.overflowing) return;
          const box = e.currentTarget.getBoundingClientRect();
          if (e.target.getBoundingClientRect().bottom > box.bottom) fold.setFolded(false);
        }}
      >
        <div ref={fold.contentRef}>{children}</div>
      </div>
      {fold.overflowing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center">
          <button onClick={() => fold.setFolded(false)} className={`pointer-events-auto ${PILL}`}>
            <ChevronsUpDown size={12} />
            {t("fold.expandAll", { n: fold.lines })}
          </button>
        </div>
      )}
      {fold.collapsible && (
        <button onClick={() => fold.setFolded(true)} className="mt-1 flex items-center gap-1 text-xs text-subtle hover:text-foreground">
          <ChevronsDownUp size={12} />
          {t("fold.collapse")}
        </button>
      )}
    </div>
  );
}
