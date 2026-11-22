// Main-side check of a submit's interrupt-send-many-v1 selection (the renderer builds it from the ledger; this copies
// only the documented fields and refuses a malformed one, so a draft never goes out alone by accident).
import type { InputInterruptSendManyParams } from "@cutex-desktop/protocol";

const MAX_IDS = 99;
const MAX_ID_BYTES = 256;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** The selection to send, `undefined` when none was asked for; throws `invalid_request` for a malformed one. */
export function interruptSendSelection(value: unknown, draftId: string | undefined): InputInterruptSendManyParams | undefined {
  if (value === undefined || value === null) return undefined;
  const bad = (why: string): never => { throw new Error(`invalid_request: interruptSend ${why}`); };
  if (typeof value !== "object" || Array.isArray(value)) bad("must be an object");
  const v = value as Record<string, unknown>;
  const ids = v.inputIds;
  if (!Array.isArray(ids) || ids.length > MAX_IDS) bad("inputIds");
  const list = ids as unknown[];
  if (list.some(id => typeof id !== "string" || !id || bytes(id) > MAX_ID_BYTES) || new Set(list).size !== list.length) bad("inputIds");
  if (draftId && list.includes(draftId)) bad("names the draft");
  const revs = v.expectedRevs;
  if (!revs || typeof revs !== "object" || Array.isArray(revs)) bad("expectedRevs");
  const revMap = revs as Record<string, unknown>;
  const keys = Object.keys(revMap);
  if (keys.length !== list.length || keys.some(k => !list.includes(k))) bad("expectedRevs");
  if (keys.some(k => !Number.isSafeInteger(revMap[k]) || (revMap[k] as number) < 1)) bad("expectedRevs");
  if (typeof v.expectedTurnId !== "string" || !v.expectedTurnId) bad("expectedTurnId");
  if (!Number.isSafeInteger(v.expectedRuntimeGeneration) || (v.expectedRuntimeGeneration as number) < 0) bad("expectedRuntimeGeneration");
  return {
    inputIds: [...(list as string[])],
    expectedRevs: Object.fromEntries((list as string[]).map(id => [id, revMap[id] as number])),
    expectedTurnId: v.expectedTurnId as string,
    expectedRuntimeGeneration: v.expectedRuntimeGeneration as number,
  };
}
