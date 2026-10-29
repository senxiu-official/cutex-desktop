/** Typed owner review references, independent of the legacy result-acceptance `review` string. */
export interface AskReviewReference {
  kind: "routing" | "capability";
  approvalId: string;
  projectId: string | null;
}
export interface AskReviewFields {
  reviewRef?: AskReviewReference | null;
  reviewRefs?: AskReviewReference[];
  reviewDenialReason?: string | null;
}
function reference(raw: unknown): AskReviewReference | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if ((r.kind !== "routing" && r.kind !== "capability") || typeof r.approvalId !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,256}$/.test(r.approvalId) || (r.projectId !== null && typeof r.projectId !== "string")) return null;
  return { kind: r.kind, approvalId: r.approvalId, projectId: r.projectId as string | null };
}
/** Omitted fields remain omitted so an unrelated state event cannot erase a reference. */
export function askReviewFields(raw: Record<string, unknown>): AskReviewFields {
  return {
    ...("reviewRef" in raw ? { reviewRef: reference(raw.reviewRef) } : {}),
    ...("reviewRefs" in raw ? { reviewRefs: Array.isArray(raw.reviewRefs) ? raw.reviewRefs.map(reference).filter((r): r is AskReviewReference => !!r) : [] } : {}),
    ...("reviewDenialReason" in raw ? { reviewDenialReason: typeof raw.reviewDenialReason === "string" ? raw.reviewDenialReason : null } : {}),
  };
}
export function reviewReferences(row: AskReviewFields): AskReviewReference[] {
  const refs = row.reviewRefs ?? [];
  return row.reviewRef && !refs.some(r => r.kind === row.reviewRef!.kind && r.approvalId === row.reviewRef!.approvalId) ? [row.reviewRef, ...refs] : refs;
}
