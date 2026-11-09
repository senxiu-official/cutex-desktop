// A filter on a settings sub-page, offered once the list outgrows what reads at a glance (design: settings-subpages).
export const FILTER_FROM = 8;

export function matchesFilter(query: string, ...texts: readonly (string | null | undefined)[]): boolean {
  const q = query.trim().toLocaleLowerCase();
  return !q || texts.some((text) => text?.toLocaleLowerCase().includes(q));
}
