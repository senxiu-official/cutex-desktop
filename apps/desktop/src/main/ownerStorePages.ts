import { CutexApiError } from "@cutex-desktop/cutex-client";

export function ownerPageQuery(query: { limit?: number; cursor?: string } = {}): { limit: number; cursor?: string } {
  const limit = typeof query.limit === "number" && Number.isFinite(query.limit) ? Math.max(1, Math.min(500, Math.floor(query.limit))) : 100;
  if (query.cursor !== undefined && (typeof query.cursor !== "string" || !query.cursor || query.cursor.length > 16_384)) throw new Error("bad owner-store cursor");
  return { limit, ...(query.cursor === undefined ? {} : { cursor: query.cursor }) };
}

export function ownerPageNeedsRestart(error: unknown): boolean {
  return error instanceof CutexApiError && ((error.status === 400 && error.code === "invalid_cursor") || (error.status === 409 && error.code === "resync_required"));
}

/** Logical legacy array reads use bounded requests on S10. Never infer EOF from row count. */
export async function collectOwnerPages<T>(load: (cursor: string | undefined, limit: number) => Promise<{ items: T[]; nextCursor?: string | null } | null>, maxRows = Infinity): Promise<T[] | null> {
  for (let attempt = 0; ; attempt++) {
    const items: T[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    try {
      for (;;) {
        const page = await load(cursor, Math.min(100, maxRows - items.length));
        if (page === null) return null;
        items.push(...page.items.slice(0, maxRows - items.length));
        if (!page.nextCursor || items.length >= maxRows) return items;
        if (seen.has(page.nextCursor)) throw new Error("owner-store cursor did not advance");
        seen.add(page.nextCursor);
        cursor = page.nextCursor;
      }
    } catch (error) {
      if (attempt === 0 && ownerPageNeedsRestart(error)) continue;
      throw error;
    }
  }
}
