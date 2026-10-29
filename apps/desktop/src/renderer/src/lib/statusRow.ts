// The status row above the input (components/StatusBar) and the 需要你 strip it hosts (owner 2026-10-27: one row
// right above 「接下来」 when the row's left is empty). How a row that gets narrow gives way, in this order — it never
// wraps for lack of width; only something on the row's left (目标, an owner notice) puts 需要你 on its own line:
//   1. 需要你's chips that do not fit go behind its 「+N」 from the end (lib/stripFit; the menu opens each);
//   2. below STATUS_ROW_TIGHT_REM the right-side chips drop their word: 「委托 20 ›」 → 「⇆ 20 ›」 (StatusChipWords; the
//      full words stay as the button's title and accessible name);
//   3. at the narrowest 需要你 is its label and 「+N」 alone (every item in the menu).
import { widthBelow } from "./sizeFlags";

/** Content width (rem) under which the right-side status chips show icon + count only. */
export const STATUS_ROW_TIGHT_REM = 30;

/** lib/sizeFlags tests of the status row: `data-tight` on the row (group/status). */
export const STATUS_ROW_FLAGS = { tight: widthBelow(STATUS_ROW_TIGHT_REM) } as const;
