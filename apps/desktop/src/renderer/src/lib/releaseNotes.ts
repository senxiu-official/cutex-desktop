// 新功能 and the upgrade dialog read the same notes (onboarding v3, owner 2026-11-26): the bundled CHANGELOG
// (shared/changelog, modules/about), per version, newest first. Internal build names (cutex r259, claude-r28,
// 0.167.0-r60) mean nothing to a user: a phrase that names one says 「新版主机」 / "newer hosts" instead, and a sentence
// that is only about such versions is left out (an item left empty is dropped). Settings → 关于 → 更新记录 keeps the
// original text.
import type { ChangelogBlock, ChangelogRelease } from "../../../shared/changelog";

/** A host / runtime build name the user cannot act on. */
const INTERNAL = /\br\d{2,3}\b|claude-r\d+|\b\d+\.\d+\.\d+-r\d+\b/i;

const EN: readonly [RegExp, string][] = [
  [/\b(o)lder (?:cutex )?r\d{2,3}(?: or r\d{2,3})? hosts\b/gi, "$1lder hosts"],
  [/\ban? (?:cutex )?r\d{2,3} host\b/gi, "a newer host"],
  [/\b(?:cutex )?r\d{2,3}(?: or r\d{2,3})?(?: or newer)? hosts\b/gi, "newer hosts"],
  [/\brequires (?:cutex )?r\d{2,3}\b/gi, "requires a newer host"],
  [/\bto cutex r\d{2,3}\b/gi, "to newer hosts"],
  [/\b(?:on|with) (?:cutex )?r\d{2,3}\b/gi, "on newer hosts"],
  [/\bnative runtime \d+\.\d+\.\d+-r\d+/gi, "the matching native runtime"],
  [/ on the claude-r\d+ runtime\b/gi, ""],
];

const ZH: readonly [RegExp, string][] = [
  [/\s*(?:cutex\s*)?r\d{2,3}\s*主机/g, "新版主机"],
  [/\s*cutex\s*r\d{2,3}\s*/g, "新版主机"],
  [/[（(]\s*claude-r\d+\s*运行时\s*[)）]/g, ""],
  [/原生运行时\s*\d+\.\d+\.\d+-r\d+/g, "新版原生运行时"],
];

const CJK = /[㐀-鿿]/;

/** One note's text for a user: internal build names replaced or their sentences left out; null when nothing is left. */
export function userFacingText(text: string): string | null {
  const zh = CJK.test(text);
  let out = text;
  for (const [re, to] of zh ? ZH : EN) out = out.replace(re, to);
  if (!INTERNAL.test(out)) return out.trim() || null;
  // Sentences (Chinese: also clauses after ；), kept with their end marks.
  const parts = zh ? out.split(/(?<=[。！？；])/) : out.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((p) => p.trim() && !INTERNAL.test(p));
  if (!kept.length) return null;
  let joined = zh ? kept.join("") : kept.join(" ");
  if (zh) joined = joined.replace(/；$/, "。");
  return joined.trim();
}

/** A block for a user (see userFacingText); null when nothing is left of it. Group headings stay as written. */
export function userFacingBlock(block: ChangelogBlock): ChangelogBlock | null {
  if (block.kind === "heading") return block;
  const text = userFacingText(block.text);
  const zh = block.zh !== undefined ? userFacingText(block.zh) : undefined;
  if (text === null && (zh === undefined || zh === null)) return null;
  // One language gone and the other kept: show the kept one to everyone (as an entry without a split does).
  if (text === null) return { kind: block.kind, text: zh! };
  return zh ? { kind: block.kind, text, zh } : { kind: block.kind, text };
}

/** A release's notes for a user: blocks cleaned (userFacingBlock), headings with nothing under them dropped. */
export function userFacingRelease(release: ChangelogRelease): ChangelogRelease {
  const blocks = release.blocks.map(userFacingBlock).filter((b): b is ChangelogBlock => b !== null);
  const out: ChangelogBlock[] = [];
  blocks.forEach((b, i) => {
    if (b.kind === "heading" && (i === blocks.length - 1 || blocks[i + 1]!.kind === "heading")) return;
    out.push(b);
  });
  return { ...release, blocks: out };
}

/** The first version 新功能 lists (owner 2026-11-26: 0.1.x stays in 关于 → 更新记录 only). */
export const FEATURES_SINCE = "0.2.0";

/** The releases 新功能 lists: FEATURES_SINCE and later, in changelog order (newest first). */
export function featureReleases(releases: readonly ChangelogRelease[]): ChangelogRelease[] {
  const [maj, min] = FEATURES_SINCE.split(".").map(Number) as [number, number];
  return releases.filter((r) => {
    const [a = 0, b = 0] = r.version.split(/[.-]/).map(Number);
    return a > maj || (a === maj && b >= min);
  });
}

/** The items of a release (what the upgrade dialog lists and 新功能 shows per version). */
export function releaseItems(release: ChangelogRelease): ChangelogBlock[] {
  return userFacingRelease(release).blocks.filter((b) => b.kind === "item");
}
