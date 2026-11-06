// The order people's and projects' names are listed in (design 060 §5.1, owner 2026-11-05). Two choices,
// both defaulting from the UI language (Settings → Appearance in the desktop):
//
//   grouping "letter": one block per first letter, A to Z; inside a block Latin names first, then names in
//                      the reading's script (Han, and Hangul for Korean / kana for Japanese). Names starting
//                      with anything else (digits, symbols, emoji, other scripts) form one block before A.
//   grouping "script": no letter blocks. Reading "zh": every name not starting with a Han character, in
//                      the UI locale's order, then the Han names in pinyin order. Readings "ko" / "ja": the
//                      Korean / Japanese collator's own order of scripts.
//   reading:           how Han names are read: "zh" pinyin (zh-u-co-pinyin), "ko" Korean (ko: Hanja by
//                      Hangul reading), "ja" Japanese (ja: kanji in JIS order, roughly on'yomi).
//
// Numbers by value (agent2 before agent10), case and accents ignored. Callers break ties on a stable id.
//
// A Han character's letter comes from the reading's collator and a few boundary characters (the first
// character under each letter), not from a dictionary. Known, accepted limits:
// - zh: a polyphone takes ICU's default reading (长安 and 重楼 land under Z).
// - ko: the letter is the Revised Romanization of the reading, not how a person spells it (박 under B, not
//   P; 김 under G, not K); 李 / 林 are read 리 / 림 (R). Characters with no Korean reading in ICU (many
//   simplified ones: 张, 长) go in the block before A.
// - ja: kanji go by their JIS level-1 row, i.e. roughly the first on'yomi, and a voiced reading stays in
//   its row (田 でん → T, 後 ご → K); level-2 kanji and simplified characters outside JIS (张, 艾) go in the
//   block before A. Kana are exact (が → G).
// Pure; collators are built once per locale.

export type NameGrouping = "letter" | "script";
export type NameReading = "zh" | "ko" | "ja";
export interface NameOrder {
  grouping: NameGrouping;
  reading: NameReading;
}

export const NAME_GROUPINGS: readonly NameGrouping[] = ["letter", "script"];
export const NAME_READINGS: readonly NameReading[] = ["zh", "ko", "ja"];

/** Defaults by UI language (owner 2026-11-05, final): Chinese letter + zh; Korean script + ko; Japanese script + ja; others script + zh. */
const DEFAULTS: readonly (readonly [RegExp, NameOrder])[] = [
  [/^zh(?:-|$)/i, { grouping: "letter", reading: "zh" }],
  [/^ko(?:-|$)/i, { grouping: "script", reading: "ko" }],
  [/^ja(?:-|$)/i, { grouping: "script", reading: "ja" }],
];
const OTHER_DEFAULT: NameOrder = { grouping: "script", reading: "zh" };

export function defaultNameOrder(locale: string): NameOrder {
  return DEFAULTS.find(([re]) => re.test(locale))?.[1] ?? OTHER_DEFAULT;
}

const COLLATOR_LOCALE: Record<NameReading, string> = { zh: "zh-u-co-pinyin", ko: "ko", ja: "ja" };

// Boundary characters: the first character (in the reading's collator) under each letter.
/** zh pinyin: A B C D E F G H J K L M N O P Q R S T W X Y Z (no I, U, V). */
const ZH_BOUNDS: readonly (readonly [string, string])[] = [..."阿八嚓哒妸发旮哈讥咔垃妈拏噢妑七呥仨它穵夕丫帀"].map((ch, i) => [ch, "ABCDEFGHJKLMNOPQRSTWXYZ"[i]!] as const);
/** ko: the first syllable of each Revised-Romanization initial (vowel-initial syllables by their vowel). Hanja sort with their Hangul reading. */
const KO_BOUNDS: readonly (readonly [string, string])[] = [["가", "G"], ["까", "K"], ["나", "N"], ["다", "D"], ["따", "T"], ["라", "R"], ["마", "M"], ["바", "B"], ["빠", "P"], ["사", "S"], ["아", "A"], ["야", "Y"], ["어", "E"], ["여", "Y"], ["오", "O"], ["와", "W"], ["외", "O"], ["요", "Y"], ["우", "U"], ["워", "W"], ["유", "Y"], ["으", "E"], ["의", "U"], ["이", "I"], ["자", "J"], ["차", "C"], ["카", "K"], ["타", "T"], ["파", "P"], ["하", "H"]];
/** ja: the first kanji of each kana row in JIS X 0208 level 1 (ICU's ja order); 弌 starts level 2 (radical order: no letter). */
const JA_BOUNDS: readonly (readonly [string, string])[] = [["亜", "A"], ["以", "I"], ["右", "U"], ["荏", "E"], ["於", "O"], ["下", "K"], ["些", "S"], ["他", "T"], ["値", "C"], ["津", "T"], ["那", "N"], ["巴", "H"], ["不", "F"], ["丙", "H"], ["摩", "M"], ["也", "Y"], ["羅", "R"], ["倭", "W"], ["弌", ""]];

/** Kana → Hepburn initial, in Unicode order from ぁ (U+3041) to ゖ (U+3096); katakana are 0x60 above. */
const KANA = "aaiiuueeookgkgkgkgkgszsjszszsztdcjttztdtdnnnnnhbphbpfbphbphbpmmmmmyyyyyyrrrrrwwwwonvkk";
const HAN = /\p{Script=Han}/u;
const HANGUL = /\p{Script=Hangul}/u;
const LATIN = /\p{Script=Latin}/u;

const collators = new Map<string, Intl.Collator>();
function collator(locale: string): Intl.Collator {
  let c = collators.get(locale);
  if (!c) collators.set(locale, (c = new Intl.Collator(locale, { numeric: true, sensitivity: "base" })));
  return c;
}
const supported = new Map<NameReading, boolean>();
function readingSupported(reading: NameReading): boolean {
  let ok = supported.get(reading);
  if (ok === undefined) {
    try {
      ok = Intl.Collator.supportedLocalesOf([COLLATOR_LOCALE[reading]]).length > 0;
    } catch {
      ok = false;
    }
    supported.set(reading, ok);
  }
  return ok;
}

const initials = new Map<string, string>();
function boundaryLetter(ch: string, reading: NameReading): string {
  const key = reading + ch;
  let hit = initials.get(key);
  if (hit === undefined) {
    const bounds = reading === "zh" ? ZH_BOUNDS : reading === "ko" ? KO_BOUNDS : JA_BOUNDS;
    const c = collator(COLLATOR_LOCALE[reading]);
    // ko: a Han character without a Korean reading sorts after every Hangul syllable: no letter.
    if (reading === "ko" && c.compare(ch, "힣") > 0) {
      initials.set(key, "");
      return "";
    }
    let lo = 0;
    let hi = bounds.length - 1;
    hit = "";
    // The last boundary not after `ch` (bounds increase in this collator; test/nameOrder.test.ts).
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c.compare(bounds[mid]![0], ch) <= 0) {
        hit = bounds[mid]![1];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (initials.size > 20000) initials.clear();
    initials.set(key, hit);
  }
  return hit;
}

/** Where a name's first character puts it: its letter ("" = the block before A) and whether it is Latin. */
function blockOf(name: string, reading: NameReading): { letter: string; latin: boolean } {
  const ch = [...name.trimStart()][0];
  if (!ch) return { letter: "", latin: false };
  if (LATIN.test(ch)) {
    const base = ch.normalize("NFD")[0]!.toUpperCase()[0]!;
    return { letter: base >= "A" && base <= "Z" ? base : "", latin: true };
  }
  if (!readingSupported(reading)) return { letter: "", latin: false };
  if (HAN.test(ch)) return { letter: boundaryLetter(ch, reading), latin: false };
  if (reading === "ko" && HANGUL.test(ch)) return { letter: boundaryLetter(ch, reading), latin: false };
  if (reading === "ja") {
    const code = ch.codePointAt(0)!;
    const i = code >= 0x30a1 && code <= 0x30f6 ? code - 0x30a1 : code >= 0x3041 && code <= 0x3096 ? code - 0x3041 : -1;
    if (i >= 0) return { letter: KANA[i]!.toUpperCase(), latin: false };
  }
  return { letter: "", latin: false };
}

/** The block a name is listed under in grouping "letter": "A"–"Z", or "" for the block before A. */
export function nameBlock(name: string, reading: NameReading): string {
  return blockOf(name, reading).letter;
}

const comparers = new Map<string, (a: string, b: string) => number>();

/** Compares two names in `order`; `locale` (the UI language) orders the non-Han names of grouping "script" with reading "zh". */
export function nameComparer(order: NameOrder, locale: string): (a: string, b: string) => number {
  const key = `${order.grouping}|${order.reading}|${locale}`;
  let cmp = comparers.get(key);
  if (cmp) return cmp;
  const reading = collator(COLLATOR_LOCALE[order.reading]);
  if (order.grouping === "letter") {
    const blocks = new Map<string, { letter: string; latin: boolean }>();
    const of = (name: string) => {
      let b = blocks.get(name);
      if (!b) {
        if (blocks.size > 20000) blocks.clear();
        blocks.set(name, (b = blockOf(name, order.reading)));
      }
      return b;
    };
    cmp = (a, b) => {
      const x = of(a);
      const y = of(b);
      if (x.letter !== y.letter) return x.letter < y.letter ? -1 : 1;
      if (x.latin !== y.latin) return x.latin ? -1 : 1;
      return reading.compare(a, b);
    };
  } else if (order.reading === "zh" && readingSupported("zh")) {
    let ui: Intl.Collator;
    try {
      ui = collator(locale);
    } catch {
      ui = collator("en");
    }
    const han = (name: string) => HAN.test([...name.trimStart()][0] ?? "");
    cmp = (a, b) => {
      const x = han(a);
      const y = han(b);
      if (x !== y) return x ? 1 : -1;
      return (x ? reading : ui).compare(a, b);
    };
  } else cmp = (a, b) => reading.compare(a, b);
  comparers.set(key, cmp);
  return cmp;
}

/** A sort comparator over items: by `nameOf` in `order`, then by `idOf` (stable). */
export function byName<T>(order: NameOrder, locale: string, nameOf: (item: T) => string, idOf: (item: T) => string): (a: T, b: T) => number {
  const cmp = nameComparer(order, locale);
  return (a, b) => {
    const r = cmp(nameOf(a), nameOf(b));
    if (r) return r;
    const x = idOf(a);
    const y = idOf(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };
}
