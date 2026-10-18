// Default agent avatars (Settings → 外观 → 默认头像): a curated set of bundled emoji pictures, one
// picked deterministically from the agent's cutexSessionId so it is the same on every device.
// Pictures: Microsoft Fluent Emoji, Flat style (MIT; NOTICE, LICENSES/MIT-fluentui-emoji.txt),
// optimised with svgo, named by code point in assets/emoji/. Bundled rather than drawn with the
// system font so Windows / Linux / macOS look the same and Linux without colour emoji still works.

export type AvatarEmojiGroup = "animals" | "plants" | "food" | "things";

export interface AvatarEmoji {
  group: AvatarEmojiGroup;
  /** Code points, as in the file name (assets/emoji/<code>.svg). */
  code: string;
  /** The emoji character (what cutex stores for an `emoji` avatar). */
  glyph: string;
  /** CLDR short name (alt text). */
  name: string;
}

// [group, code, glyph, CLDR name]. Friendly, clearly distinct, no flags / people / hands / religious
// or political symbols. Order is part of the default pick: append only, never reorder or remove.
const ROWS: readonly (readonly [AvatarEmojiGroup, string, string, string])[] = [
  ["animals", "1f98a", "🦊", "fox"],
  ["animals", "1f431", "🐱", "cat face"],
  ["animals", "1f436", "🐶", "dog face"],
  ["animals", "1f989", "🦉", "owl"],
  ["animals", "1f43c", "🐼", "panda"],
  ["animals", "1f430", "🐰", "rabbit face"],
  ["animals", "1f42f", "🐯", "tiger face"],
  ["animals", "1f981", "🦁", "lion"],
  ["animals", "1f428", "🐨", "koala"],
  ["animals", "1f438", "🐸", "frog"],
  ["animals", "1f427", "🐧", "penguin"],
  ["animals", "1f419", "🐙", "octopus"],
  ["animals", "1f422", "🐢", "turtle"],
  ["animals", "1f42c", "🐬", "dolphin"],
  ["animals", "1f40b", "🐋", "whale"],
  ["animals", "1f420", "🐠", "tropical fish"],
  ["animals", "1f994", "🦔", "hedgehog"],
  ["animals", "1f439", "🐹", "hamster"],
  ["animals", "1f43b", "🐻", "bear"],
  ["animals", "1f984", "🦄", "unicorn"],
  ["animals", "1f98b", "🦋", "butterfly"],
  ["animals", "1f41d", "🐝", "honeybee"],
  ["animals", "1f41e", "🐞", "lady beetle"],
  ["animals", "1f40c", "🐌", "snail"],
  ["animals", "1f980", "🦀", "crab"],
  ["animals", "1f986", "🦆", "duck"],
  ["animals", "1f99c", "🦜", "parrot"],
  ["animals", "1f9a9", "🦩", "flamingo"],
  ["animals", "1f418", "🐘", "elephant"],
  ["animals", "1f992", "🦒", "giraffe"],
  ["animals", "1f993", "🦓", "zebra"],
  ["animals", "1f99b", "🦛", "hippopotamus"],
  ["animals", "1f999", "🦙", "llama"],
  ["animals", "1f9a5", "🦥", "sloth"],
  ["animals", "1f9a6", "🦦", "otter"],
  ["animals", "1f98c", "🦌", "deer"],
  ["plants", "1f33b", "🌻", "sunflower"],
  ["plants", "1f338", "🌸", "cherry blossom"],
  ["plants", "1f337", "🌷", "tulip"],
  ["plants", "1f33a", "🌺", "hibiscus"],
  ["plants", "1f335", "🌵", "cactus"],
  ["plants", "1f340", "🍀", "four leaf clover"],
  ["plants", "1f341", "🍁", "maple leaf"],
  ["plants", "1f344", "🍄", "mushroom"],
  ["plants", "1f332", "🌲", "evergreen tree"],
  ["plants", "1f33f", "🌿", "herb"],
  ["food", "1f34e", "🍎", "red apple"],
  ["food", "1f34b", "🍋", "lemon"],
  ["food", "1f352", "🍒", "cherries"],
  ["food", "1f353", "🍓", "strawberry"],
  ["food", "1f349", "🍉", "watermelon"],
  ["food", "1f350", "🍐", "pear"],
  ["food", "1f34d", "🍍", "pineapple"],
  ["food", "1f951", "🥑", "avocado"],
  ["food", "1f955", "🥕", "carrot"],
  ["food", "1f33d", "🌽", "ear of corn"],
  ["food", "1f347", "🍇", "grapes"],
  ["food", "1f95d", "🥝", "kiwi fruit"],
  ["food", "1f950", "🥐", "croissant"],
  ["food", "1f369", "🍩", "doughnut"],
  ["food", "1f36a", "🍪", "cookie"],
  ["food", "1f370", "🍰", "shortcake"],
  ["food", "2615", "☕", "hot beverage"],
  ["food", "1fad6", "🫖", "teapot"],
  ["things", "1f680", "🚀", "rocket"],
  ["things", "1fa81", "🪁", "kite"],
  ["things", "26f5", "⛵", "sailboat"],
  ["things", "1f4a1", "💡", "light bulb"],
  ["things", "1f9e9", "🧩", "puzzle piece"],
  ["things", "1f48e", "💎", "gem stone"],
  ["things", "1f511", "🔑", "key"],
  ["things", "1f9ed", "🧭", "compass"],
  ["things", "1f52d", "🔭", "telescope"],
  ["things", "1f3b8", "🎸", "guitar"],
  ["things", "1f3a8", "🎨", "artist palette"],
  ["things", "1f4da", "📚", "books"],
  ["things", "1f308", "🌈", "rainbow"],
  ["things", "2b50", "⭐", "star"],
  ["things", "2744-fe0f", "❄️", "snowflake"],
  ["things", "2601-fe0f", "☁️", "cloud"],
];

export const AVATAR_EMOJI_GROUPS: readonly AvatarEmojiGroup[] = ["animals", "plants", "food", "things"];

export const AVATAR_EMOJI_SET: readonly AvatarEmoji[] = ROWS.map(([group, code, glyph, name]) => ({ group, code, glyph, name }));

const URLS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>("../assets/emoji/*.svg", { eager: true, query: "?url", import: "default" })).map(([path, url]) => [
    path.slice(path.lastIndexOf("/") + 1, -".svg".length),
    url,
  ]),
);

/** Variation selectors don't change which picture we draw (☁ vs ☁️). */
const bare = (glyph: string) => glyph.replace(/\uFE0F/g, "");
const BY_GLYPH = new Map(AVATAR_EMOJI_SET.map((e) => [bare(e.glyph), e]));

/** The bundled picture for a stored emoji value, or null (anything else is drawn as text). */
export function bundledEmoji(glyph: string | null | undefined): AvatarEmoji | null {
  return glyph ? (BY_GLYPH.get(bare(glyph.trim())) ?? null) : null;
}

export function emojiUrl(emoji: AvatarEmoji): string | null {
  return URLS[emoji.code] ?? null;
}

/** 32-bit FNV-1a over UTF-16 code units with a murmur3 finaliser: cheap, stable, well mixed for
 *  ids that share long prefixes / differ only in the last characters. */
export function seedHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The default emoji of an agent (seed = its cutexSessionId). */
export function defaultEmoji(seed: string): AvatarEmoji {
  return AVATAR_EMOJI_SET[seedHash(seed) % AVATAR_EMOJI_SET.length]!;
}

/** Background behind an avatar emoji: the agent colour softened so the picture reads in both themes.
 * 55 % (lead handoff 2026-10-18; was 30 %, where a pink Profile read grey-brown on the dark theme): the
 * colour is recognisable in both themes and orange / yellow emoji still stand out on their own colour. */
export function emojiTint(color: string): string {
  return `color-mix(in srgb, ${color} 55%, var(--surface))`;
}
