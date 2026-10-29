// A user message's text with its @-mentions as chips (lib/mentionWire): the bubble shows the draft form it was sent
// from (chips that read the agent's id, so renames follow), or — older messages — the chip markup the text itself
// carries. The rest stays plain text (ScriptText), escapes and all.
import { agentMentionTokens } from "../lib/agentMentions";
import { useMentionRichText } from "../lib/mentionWire";
import { AgentMentionChip } from "./AgentMentionChip";
import { ScriptText } from "./ScriptText";

export function MentionText({ text, hostId, sessionId }: { text: string; hostId: string | null | undefined; sessionId: string }) {
  const rich = useMentionRichText(hostId, sessionId, text);
  const tokens = agentMentionTokens(rich);
  if (!tokens.length) return <ScriptText text={rich} />;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) parts.push(<ScriptText key={`t${cursor}`} text={rich.slice(cursor, token.start)} />);
    parts.push(<AgentMentionChip key={`m${token.start}`} id={token.id} name={token.name} host={token.host} />);
    cursor = token.end;
  }
  if (cursor < rich.length) parts.push(<ScriptText key={`t${cursor}`} text={rich.slice(cursor)} />);
  return <>{parts}</>;
}
