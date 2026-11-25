/**
 * Explicit plain-text references. JSON strings keep punctuation/newlines unambiguous; no hidden send markup.
 * `[profile: "<id>", name: "Ceobe", model: "…", effort: "…"]`: the ID is the reference (exact across renames; agent_create
 * takes it); `name` is the profile's name when it was inserted, so the receiving agent can say which profile it means
 * (owner 2026-11-24). Older text without `name` still parses.
 */
export interface ProfileMentionToken { kind: "profile"; profile: string | null; /** The name written with the reference (when inserted). */ name: string | null; model: string | null; effort: string | null; raw: string; start: number; end: number }
export interface ProfileMentionTrigger { kind: "profile" | "model"; start: number; end: number; query: string }
export interface ProfileMentionCascade { profile: string | null; name?: string | null; model?: string | null; start: number; end: number; raw: string }

/** Longest name written into a reference (a display name; the ID stays the reference). */
export const PROFILE_MENTION_NAME_MAX = 64;
/** The name part: trimmed, one line, at most PROFILE_MENTION_NAME_MAX characters; none when empty or equal to the ID. */
function mentionName(profile: string | null, name: string | null | undefined): string | null {
  if (!profile || !name) return null;
  const chars = [...name.replace(/\s+/g, " ").trim()];
  const clean = chars.length > PROFILE_MENTION_NAME_MAX ? `${chars.slice(0, PROFILE_MENTION_NAME_MAX - 1).join("")}…` : chars.join("");
  return clean && clean !== profile ? clean : null;
}
export function profileMentionText(profile: string | null, model: string | null = null, effort: string | null = null, name: string | null = null): string {
  if (!profile && !model) throw new Error("empty_profile_mention");
  const shown = mentionName(profile, name);
  return `[${[profile ? `profile: ${JSON.stringify(profile)}` : "", shown ? `name: ${JSON.stringify(shown)}` : "", model ? `model: ${JSON.stringify(model)}` : "", model && effort ? `effort: ${JSON.stringify(effort)}` : ""].filter(Boolean).join(", ")}]`;
}
const STR = String.raw`("(?:[^"\\\r\n]|\\.)*")`;
const TOKENS = new RegExp(String.raw`\[(?:profile: ${STR}(?:, name: ${STR})?(?:, model: ${STR})?|model: ${STR})(?:, effort: ${STR})?\]`, "g");
export function profileMentionTokens(text: string): ProfileMentionToken[] {
  const result: ProfileMentionToken[] = [];
  for (const match of text.matchAll(TOKENS)) {
    let slashes = 0; for (let i=match.index-1;i>=0&&text[i]==="\\";i--) slashes++;
    if (slashes % 2) continue;
    try {
      const profile = match[1] ? JSON.parse(match[1]) as string : null;
      const named = match[2] ? JSON.parse(match[2]) as string : null;
      const model = match[3] || match[4] ? JSON.parse((match[3] ?? match[4])!) as string : null;
      const effort = match[5] ? JSON.parse(match[5]) as string : null;
      if (effort !== null && (!model || !effort.trim())) continue;
      if ((profile !== null && !profile.trim()) || (model !== null && !model.trim())) continue;
      const name = named?.trim() ? named : null;
      result.push({kind:"profile",profile,name,model,effort,raw:match[0],start:match.index,end:match.index+match[0].length});
    } catch { /* Invalid JSON is ordinary text, never a chip. */ }
  }
  return result;
}
/** Only word starts; `ap@x.com`, embedded punctuation and an ordinary @agent are unaffected. */
export function profileMentionAt(text: string, caret: number): ProfileMentionTrigger | null {
  const before = text.slice(0, caret), found = /(^|\s)([pm])@([^\s@]*)$/i.exec(before);
  if (!found) return null;
  const rest = /^[^\s]*/.exec(text.slice(caret))![0];
  return {kind:found[2]!.toLowerCase()==="p"?"profile":"model",start:before.length-found[3]!.length-2,end:caret+rest.length,query:found[3]!};
}
/** Null means the owner edited/moved away from the chosen profile atom. No unmatched query ever cancels it. */
export function profileCascadeQuery(text: string, caret: number, cascade: ProfileMentionCascade): string | null {
  return caret >= cascade.end && text.slice(cascade.start,cascade.end)===cascade.raw ? text.slice(cascade.end,caret) : null;
}
export function finishProfileCascade(text: string, caret: number, cascade: ProfileMentionCascade, model: string | null, space: boolean, effort: string | null = null): {text:string;caret:number} {
  if (profileCascadeQuery(text,caret,cascade)===null) return {text,caret};
  const raw=profileMentionText(cascade.profile,model,effort,cascade.name ?? null), after=text.slice(caret), separator=space&&!after.startsWith(" ")?" ":"";
  return {text:text.slice(0,cascade.start)+raw+separator+after,caret:cascade.start+raw.length+separator.length};
}
