/** Development-only catalog adapter consumed by the desktop's integration tests. */
export interface CatalogEntry {
  id: string;
  themeId: string;
  characterId: string;
  variant: number;
  image: string;
  thumbnail: string;
  sha256: string;
  width: number;
  height: number;
  reviewStatus: string;
}
export function normalizeCatalog(catalog: unknown): {
  themes: { id: string; name: string; order: number }[];
  characters: string[];
  entries: CatalogEntry[];
};
