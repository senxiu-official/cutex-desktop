// The words for a delegation on a tool row (components/DelegationRowRef). Pure, so it is unit-tested.
import { isSessionRef } from "./shortIds";
import type { TaskRowDelegation } from "./taskRows";

/** The store's record fields the label uses. */
export interface DelegationRecordLike { askId?: string; title?: string | null; targetName?: string | null; target?: string | null }

/**
 * `text`: 「title → handler」, the title alone, or the id when nothing is known. `title` (tooltip): the id,
 * with the full title when the line is truncated.
 */
export function delegationRowLabel(ref: TaskRowDelegation, record: DelegationRecordLike | null | undefined, sessionName: string | null): { text: string; title: string } {
  const title = record?.title?.trim() || ref.title?.trim() || null;
  const handler = record?.targetName?.trim() || sessionName || (ref.target && !isSessionRef(ref.target) ? ref.target : null);
  const text = title ? (handler ? `${title} → ${handler}` : title) : handler ? `${ref.id} → ${handler}` : ref.id;
  return { text, title: title ? `${text}\n${ref.id}` : ref.id };
}
