// Pinyin search (「tingshu」 / 「ts」 finds 听书): the readings of the titles' Chinese characters, from pinyin-pro
// (MIT, offline dictionary, no network). Its data (~320 KB) is a separate chunk loaded the first time the palette
// opens (a dynamic import), so opening stays fast; until then matching is literal only. The units are computed
// once per title (cached for the session) when the item list is built; every keystroke only runs
// model.ts matchPinyin over them.
import type { PinyinUnit, QsItem } from "./model";

export type PinyinLib = Pick<typeof import("pinyin-pro"), "pinyin">;

let loading: Promise<PinyinLib | null> | null = null;
let loaded: PinyinLib | null = null;

/** pinyin-pro, loaded once (null: the chunk failed to load — literal matching only). */
export function loadPinyin(): Promise<PinyinLib | null> {
  loading ??= import("pinyin-pro").then(
    (m) => (loaded = { pinyin: m.pinyin }),
    () => null,
  );
  return loading;
}

/** pinyin-pro when an earlier open loaded it already (the next palette has pinyin from its first frame). */
export function pinyinNow(): PinyinLib | null {
  return loaded;
}

/** A Chinese character (the BMP ideographs and extension A, compatibility ideographs) or one outside the BMP. */
const HAN = /^(?:[㐀-䶿一-鿿豈-﫿]|[\uD840-\uD87F][\uDC00-\uDFFF])$/;
const LATIN = /^[a-z0-9]$/i;

/** A reading without tones; ü (and pinyin-pro's v) also as v and u, so 「lv」 and 「lu」 both find 绿. */
function toneless(reading: string): string[] {
  const plain = reading
    .toLowerCase()
    .replace(/[üǖǘǚǜ]/g, "v")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!/^[a-z]+$/.test(plain)) return [];
  return plain.includes("v") ? [plain, plain.replace(/v/g, "u")] : [plain];
}

const cache = new Map<string, readonly PinyinUnit[] | null>();
const CACHE_MAX = 4000;

/** The title's units (model.ts PinyinUnit); null when it has no Chinese character (nothing to add to literal matching). */
export function pinyinUnits(title: string, lib: PinyinLib): readonly PinyinUnit[] | null {
  const known = cache.get(title);
  if (known !== undefined) return known;
  let units: PinyinUnit[] | null = null;
  if (/[㐀-䶿一-鿿豈-﫿\uD840-\uD87F]/.test(title)) {
    try {
      units = [];
      let at = 0;
      for (const ch of lib.pinyin(title, { toneType: "none", type: "all" })) {
        const origin = ch.origin;
        if (ch.isZh || HAN.test(origin)) {
          // The likely reading first, then the other readings of a polyphonic character (重: chong, zhong).
          const syl = [...new Set([...toneless(ch.pinyin), ...ch.polyphonic.flatMap(toneless)])];
          if (syl.length) units.push({ at, len: origin.length, syl, zh: true });
        } else if (LATIN.test(origin)) units.push({ at, len: origin.length, syl: [origin.toLowerCase()], zh: false });
        at += origin.length;
      }
      // The readings must line up with the title; anything else: literal matching only.
      if (at !== title.length || !units.some((u) => u.zh)) units = null;
    } catch {
      units = null;
    }
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(title, units);
  return units;
}

/** The items with their titles' pinyin (unchanged objects where there is none). */
export function withPinyin(items: readonly QsItem[], lib: PinyinLib | null): QsItem[] {
  if (!lib) return items as QsItem[];
  return items.map((item) => {
    const units = pinyinUnits(item.title, lib);
    return units ? { ...item, pinyin: units } : item;
  });
}
