import { agentMentionTokens, type AgentMentionToken } from "./agentMentions";
import { profileMentionTokens, type ProfileMentionToken } from "./profileMentions";

export type ComposerMentionToken = (AgentMentionToken & { kind: "agent" }) | ProfileMentionToken;

/** The same offset model backs every typed atom, including selection, clipboard and undo. */
export function composerMentionTokens(text: string): ComposerMentionToken[] {
  const candidates: ComposerMentionToken[] = [
    ...agentMentionTokens(text).map(token => ({ ...token, kind: "agent" as const })),
    ...profileMentionTokens(text),
  ];
  const tokens: ComposerMentionToken[] = [];
  for (const token of candidates.sort((a, b) => a.start - b.start || b.end - a.end)) {
    // A field/label containing mention syntax belongs to the outer atom.
    if (!tokens.length || token.start >= tokens[tokens.length - 1]!.end) tokens.push(token);
  }
  return tokens;
}
