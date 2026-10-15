// Pure helpers of the 工作流 page (no React / store): unit-tested in test/workflowsReviewFixes.test.ts.

/**
 * Runs waiting for approval open by themselves, once each: `seen` holds the ids already opened that
 * way, so a run the owner collapsed stays collapsed on the next poll. Returns the ids to open now
 * (empty = nothing to do) and the new `seen`.
 */
export function autoExpandWaiting(waiting: readonly string[], seen: ReadonlySet<string>): { open: string[]; seen: ReadonlySet<string> } {
  const open = waiting.filter((id) => !seen.has(id));
  return open.length === 0 ? { open, seen } : { open, seen: new Set([...seen, ...open]) };
}
