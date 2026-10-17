// "Is this card narrow?" for the settings cards (components/settings/Form Card), measured with a
// ResizeObserver (lib/sizeFlags) instead of a CSS size container.
//
// The cards used to be `@container` (container-type: inline-size) with `@max-[28rem]:` rows. Chromium
// (reproduced in headless Chrome 151; the packaged app on Windows) can leave a card's rows without
// layout boxes after one React commit changes several cards at once — e.g. 主机后端更新 when an update
// run commits: 当前版本 / 回滚 became empty 10 px bars while their DOM was complete (switching the
// card's container-type off was the only change that fixed it). Desktop 0.1.2 on Windows showed
// exactly that. So the cards are no size containers any more: the width comes from here and the rows
// react to `data-narrow` (Tailwind `group-data-[narrow]/card:`). Every other renderer element that
// used container queries follows the same pattern: see lib/sizeFlags.
import { remPx, type SizeTest } from "./sizeFlags";

/** A card narrower than this (content box, in rem) stacks a row's controls under its label. */
export const NARROW_CARD_REM = 28;

/** Whether a content box `width` (px) counts as narrow (0 = not laid out yet: keep the wide layout). */
export function isNarrowWidth(width: number, rem = remPx()): boolean {
  return width > 0 && width < NARROW_CARD_REM * rem;
}

/** useSizeFlags tests of a settings card: `data-narrow`. */
export const CARD_FLAGS: Readonly<Record<"narrow", SizeTest>> = { narrow: (box, rem) => isNarrowWidth(box.width, rem) };
