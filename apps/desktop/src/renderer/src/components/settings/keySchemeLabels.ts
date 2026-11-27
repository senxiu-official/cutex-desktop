// The names schemes are shown by: the migrated 「我的快捷键」 in the current language, and a (2) / (3) after a name
// two devices both brought (each kept its own 「我的快捷键」 when they first synced).
import type { KeyScheme } from "../../lib/keybindingSchemes";

export function schemeLabels(schemes: readonly KeyScheme[], mine: string): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const s of schemes) {
    const base = s.name ?? mine;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(s.id, n === 1 ? base : `${base} (${n})`);
  }
  return out;
}
