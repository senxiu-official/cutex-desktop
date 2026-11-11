// How an owner's 批准一次 reaches the agent (cutex safety-grant-delivery): the grant goes out as an approval
// system notice (a ledger alarm record, `alarm-approval-…`) read at the agent's next tool boundary, and the
// block names it (`noticeInputId`). Before it is read the grant is valid until the hard cap (`hardExpiresAt`,
// approval + 2 h); once read (`noticeReadAt`, or the ledger record in context with evidence) until `expiresAt`
// (read + 30 min, never past the cap). Without `noticeInputId` (an older cutex or adapter) callers keep their
// old wording. Pure (unit-tested).
import type { InputRecord, OwnerNotification, SafetyBlock } from "@cutex-desktop/protocol";

export type GrantNoticeStatus =
  /** Approved; the notice waits for the current tool to return (ledger: waiting / registered / offered). */
  | { kind: "waiting"; until: string | null }
  /** The agent read it; the grant is valid until `until`. */
  | { kind: "read"; until: string | null };

type Block = Pick<SafetyBlock, "state" | "expiresAt" | "noticeInputId" | "noticeReadAt" | "hardExpiresAt">;
type Ledger = Pick<InputRecord, "state" | "evidence"> | null | undefined;

const read = (record: Ledger): boolean => record?.state === "inContext" && !!record.evidence;

/**
 * The block's delivery status while granted and unused: null for an older cutex (no `noticeInputId`) and for
 * every other state (blocked, used, expired, dismissed keep their own lines).
 */
export function grantNoticeOf(block: Block, record?: Ledger): GrantNoticeStatus | null {
  if (block.state !== "granted" || !block.noticeInputId) return null;
  if (block.noticeReadAt || read(record)) return { kind: "read", until: block.expiresAt };
  return { kind: "waiting", until: block.hardExpiresAt ?? block.expiresAt };
}

/** Ledger states in which the notice is still on its way (else the row keeps its own status: failed, uncertain …). */
const ON_THE_WAY = new Set<string>(["received", "waiting", "sending", "accepted"]);

/** The 接下来 row's status for the notice record of `block`: null keeps the row's own ledger status. */
export function grantNoticeRowOf(block: Block | null | undefined, record: Pick<InputRecord, "state" | "evidence">): GrantNoticeStatus | null {
  if (!block) return null;
  if (!ON_THE_WAY.has(record.state) && !read(record)) return null;
  return grantNoticeOf(block, record);
}

/** The safety-block notice whose grant notice is ledger record `inputId` of `agentId`. */
export function blockOfNotice(byId: Readonly<Record<string, OwnerNotification>>, agentId: string, inputId: string): SafetyBlock | null {
  for (const r of Object.values(byId)) if (r.agentId === agentId && r.safetyBlock?.noticeInputId === inputId) return r.safetyBlock;
  return null;
}
