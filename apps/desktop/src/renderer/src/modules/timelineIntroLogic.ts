// timeline.intro's pure host logic (docs/desktop-modules.md §19.3). Kept out of the component file
// so Fast Refresh only ever sees component exports there; the tests import these directly.
import type { AppSlotEntry, TimelineIntroProps } from "./slots";

/** The session's start is on screen: no turns hidden by the recent-entries window, no older page. */
export function timelineAtStart(hiddenTurns: number, olderCursor: string | null | undefined): boolean {
  return hiddenTurns === 0 && !olderCursor;
}

/** The first item that can show this session's opening (by order, available, `when` not false).
 *  A throwing `when` is reported through `onWhenError` (with the item's own module) and skipped:
 *  one bad item never takes the slot down, the next candidate still shows. */
export function pickTimelineIntroItem(entries: readonly Entry[], props: TimelineIntroProps, onWhenError?: (entry: Entry, error: unknown) => void): Entry | null {
  const shown = entries.filter((e) => e.mode === "show").sort((a, b) => (a.item.order ?? 500) - (b.item.order ?? 500));
  for (const entry of shown) {
    try {
      if (entry.item.when?.(props) !== false) return entry;
    } catch (error) {
      onWhenError?.(entry, error);
    }
  }
  return null;
}

type Entry = AppSlotEntry<"timeline.intro">;
