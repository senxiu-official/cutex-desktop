// A message's input items (cute-codex UserInput: text, image, localImage, skill, mention, …) as a preview: the
// segments in message order (text, images as thumbnails, skills / file mentions by name) and the plain text of it.
// A preview never shows an item's type as text (the old 「[localImage]」): images are thumbnails only, a skill reads
// `$name`, a file mention `@name`, and anything else is left out. Pure, shared by the queue rows, the timeline and
// any plain-text use (titles, confirm dialogs, drag text).
import { messageImages, type MessageImage } from "./input";

export type InputPart = { type: string; text?: unknown; name?: unknown; path?: unknown; url?: unknown; width?: unknown; height?: unknown };

export type PreviewSegment =
  | { kind: "text"; text: string }
  | { kind: "image"; image: MessageImage }
  | { kind: "ref"; ref: "skill" | "mention"; text: string; path?: string };

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * Whether `text` holds `token` (`$name` / `@name`) as a whole reference word: not as the start of a longer one
 * (`$reviewer` is not `$review`, `@plan.md.bak` is not `@plan.md`).
 */
export function hasReferenceToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A name character is any letter / digit / mark (CJK too) or `_`; `.` `-` `/` `\` are part of a name only when a
  // name character follows (`@计划书.md`, `@plan.md.bak`), so a sentence's own full stop still ends one (`@plan.md.`).
  const name = String.raw`[\p{L}\p{N}\p{M}_]`;
  const sep = String.raw`[./\\-]`;
  return new RegExp(String.raw`(^|[^\p{L}\p{N}\p{M}_$@./\\-])${escaped}(?!${name}|${sep}${name})`, "u").test(text);
}

/** One part as a reference word (`$skill`, `@file`), or null when it is not one. */
function refOf(part: InputPart): Extract<PreviewSegment, { kind: "ref" }> | null {
  if (part.type !== "skill" && part.type !== "mention") return null;
  const name = typeof part.name === "string" && part.name ? part.name : typeof part.path === "string" && part.path ? baseName(part.path) : "";
  if (!name) return null;
  return { kind: "ref", ref: part.type, text: `${part.type === "skill" ? "$" : "@"}${name}`, ...(typeof part.path === "string" ? { path: part.path } : {}) };
}

/**
 * The parts as preview segments, in message order. A skill / mention whose word the text already contains (the
 * composer writes `$name` / `@name` into the text) is not repeated.
 */
export function inputSegments(parts: readonly InputPart[]): PreviewSegment[] {
  const text = parts.filter((p) => p.type === "text").map((p) => (typeof p.text === "string" ? p.text : "")).join("\n");
  const out: PreviewSegment[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (typeof part.text === "string" && part.text) out.push({ kind: "text", text: part.text });
      continue;
    }
    const [image] = messageImages([part as { type: string }]);
    if (image) { out.push({ kind: "image", image }); continue; }
    const ref = refOf(part);
    if (ref && !hasReferenceToken(text, ref.text)) out.push(ref);
  }
  return out;
}

/** The plain text of a message's parts: its text (parts joined by a line break) and reference words; no images. */
export function inputPreviewText(parts: readonly InputPart[]): string {
  let out = "";
  let last: PreviewSegment["kind"] | null = null;
  for (const seg of inputSegments(parts)) {
    if (seg.kind === "image") continue;
    if (out) out += seg.kind === "text" && last === "text" ? "\n" : " ";
    out += seg.text;
    last = seg.kind;
  }
  return out;
}
