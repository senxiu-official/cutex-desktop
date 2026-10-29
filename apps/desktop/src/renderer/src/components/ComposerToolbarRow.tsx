import { useCallback, type ReactNode } from "react";
import { DROP_RESET_ATTR, SQUEEZE_NAME_ATTR, useToolbarFit } from "../lib/toolbarFit";

/**
 * The composer's settings row: `left` (tools, permissions, rules, plan) and `right` (profile · quota | model ·
 * context, then `tail`). When both do not fit, the right group takes a second row, right-aligned; tighter still, the
 * countdown text and then the Profile name give way (lib/toolbarFit, styles.css). Never clipped, at most two rows.
 * `sizeRef` also gets the row element (lib/sizeFlags).
 */
export function ComposerToolbarRow({ left, right, tail, sizeRef }: { left: ReactNode; right: ReactNode; tail?: ReactNode; sizeRef?: (el: HTMLElement | null) => (() => void) | undefined }) {
  const fit = useToolbarFit();
  const { row: fitRow } = fit;
  const rowRef = useCallback(
    (el: HTMLElement | null) => {
      fitRow(el);
      const cleanup = sizeRef?.(el);
      return () => {
        cleanup?.();
        fitRow(null);
      };
    },
    [fitRow, sizeRef],
  );
  const wrapped = fit.step > 0;
  return (
    <div ref={rowRef} data-toolbar-step={fit.step} className={`mt-1 flex min-w-0 items-center gap-0.5 px-0.5 ${wrapped ? "flex-wrap" : ""}`}>
      <div ref={fit.left} className="flex min-w-0 items-center gap-0.5">
        {left}
      </div>
      <div
        ref={fit.right}
        data-toolbar-right=""
        {...{ [DROP_RESET_ATTR]: fit.step >= 2 ? "" : undefined, [SQUEEZE_NAME_ATTR]: fit.step >= 3 ? "" : undefined }}
        className={`ml-auto flex min-w-0 items-center gap-0.5 ${wrapped ? "basis-full justify-end" : ""}`}
      >
        {/* One rhythm: chips are 4px-padded with no gap, so every token sits 8px apart. */}
        <div className="flex min-w-0 items-center [&>div>button]:px-1 [&>span:not([aria-hidden])]:px-1">{right}</div>
        {tail}
      </div>
    </div>
  );
}
