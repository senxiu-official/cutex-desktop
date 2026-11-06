import type { OwnerNotifyFilter } from "@cutex-desktop/protocol";

/** A single bounded page. Cursors are opaque; pass nextCursor back unchanged. */
export interface PageQuery {
  /** Defaults to 100; finite values are floored and clamped to 1..500. */
  limit?: number;
  cursor?: string;
}

export interface OwnerNotificationsPageQuery extends PageQuery {
  filter?: OwnerNotifyFilter;
  agentId?: string;
}

export interface SafetyChecksPageQuery extends PageQuery {
  state?: "open" | "all";
  agentId?: string;
}

/** Always select the bounded backend route, including on the first page. */
export function pageQuery(query: PageQuery): { limit: number; cursor?: string } {
  const limit = typeof query.limit === "number" && Number.isFinite(query.limit)
    ? Math.max(1, Math.min(500, Math.floor(query.limit))) : 100;
  return { limit, ...(query.cursor !== undefined ? { cursor: query.cursor } : {}) };
}

/** Older page responses may omit the cursor; approvals also emits null at EOF. */
export function pageResponse<T extends { nextCursor?: string }>(
  response: Omit<T, "nextCursor"> & { nextCursor?: string | null },
): T {
  const { nextCursor, ...rest } = response;
  return { ...rest, ...(nextCursor !== undefined && nextCursor !== null ? { nextCursor } : {}) } as T;
}
