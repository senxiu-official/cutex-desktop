// The 需要你 list (components/NeedsYou): a page of rows at most (owner 2026-11-05: past a maximum height it pages
// instead of growing).

/** Rows per page: six 44 px rows keep the panel under about 22 rem. */
export const NEEDS_PAGE_SIZE = 6;

/** One page of `items`; `requested` is clamped when the list shrinks under it. */
export function needsPage<T>(items: readonly T[], requested: number) {
  const pages = Math.max(1, Math.ceil(items.length / NEEDS_PAGE_SIZE));
  const page = Math.max(0, Math.min(requested, pages - 1));
  return { page, pages, rows: items.slice(page * NEEDS_PAGE_SIZE, (page + 1) * NEEDS_PAGE_SIZE) };
}
