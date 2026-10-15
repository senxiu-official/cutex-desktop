import { delegationAskRow, delegationResultItems } from "../../lib/delegations";
import { taskToolRow } from "../../lib/taskRows";
import type { ExternalMessage, RawItem } from "../../lib/timeline";
import { DelegationAskRow, DelegationResultsRow } from "../../components/DelegationRows";
import { TaskToolRow } from "../../components/TaskRows";
import { TimelineRowFallback } from "../TimelineRowFallback";

/**
 * cutex agent tools (delegation lines, agent_tell, alarm_set, agent_create / agent_archive,
 * read_overlength_content, and their old names) as one formatted line. Core and ungated like the
 * baseline: only the 委托 card (modules/delegations) needs agent-asks.
 */
export function AgentToolRow({ item }: { item: RawItem; sessionId: string }) {
  const task = taskToolRow(item);
  return task ? <TaskToolRow item={item} task={task} /> : <TimelineRowFallback />;
}

/** A delegation ASK delivered to this agent (cutex.delegation-ask.v1): rendered by schema, ungated. */
export function AskReceivedRow({ message }: { message: ExternalMessage; sessionId: string; readOnly: boolean }) {
  const row = delegationAskRow(message);
  return row ? <DelegationAskRow row={row} body={message.text} /> : <TimelineRowFallback />;
}

/** Delegation results delivered to the requester (cutex.delegation-results.v1): by schema, ungated. */
export function ResultsReceivedRow({ message, sessionId }: { message: ExternalMessage; sessionId: string; readOnly: boolean }) {
  const items = delegationResultItems(message);
  return items.length ? <DelegationResultsRow items={items} message={message} sessionId={sessionId} /> : <TimelineRowFallback />;
}
