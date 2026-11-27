/**
 * The look of a status word that has a tip (等待中, 已到期, 失败 …): dotted underline, help cursor. The tip is the app
 * tooltip (`data-tip`, lib/tips), never a native `title`: lib/tips shows the innermost anchor, so a row's own
 * `data-tip` gives way while the pointer is on the word; a native title would sit under the row's tip.
 */
export const STATUS_TIP_WORD = "cursor-help underline decoration-dotted underline-offset-2";
