// The `delegation` ref kind (docs/desktop-modules.md §19.9, provider: the delegations module): key =
// the ask id on the ref's host. Pure helpers (tested in test/delegationDetail.test.ts).
import type { CutexRef } from "../modules/slots";

export const DELEGATION_REF_KIND = "delegation";

const ASK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_TITLE = 200;

/** A plausible ask id (full `ask-…` or any cutex id shape); refs are untrusted data. */
export function isAskId(value: unknown): value is string {
  return typeof value === "string" && ASK_ID.test(value);
}

export function delegationRef(hostId: string, askId: string, title?: string): CutexRef {
  return { hostId, kind: DELEGATION_REF_KIND, key: askId, title: (title?.trim() || askId).slice(0, MAX_TITLE), params: {} };
}

/** The ask id of a `delegation` ref; null = not one / malformed. */
export function askIdOfRef(ref: Pick<CutexRef, "kind" | "key">): string | null {
  return ref.kind === DELEGATION_REF_KIND && isAskId(ref.key) ? ref.key : null;
}
