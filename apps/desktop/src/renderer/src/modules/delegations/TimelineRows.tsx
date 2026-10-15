import { delegateCallOf } from "../../lib/delegations";
import { isRunning } from "../../lib/workGroups";
import { taskToolRow } from "../../lib/taskRows";
import type { RawItem } from "../../lib/timeline";
import { DelegationCard } from "../../components/DelegationCard";
import { TaskToolRow } from "../../components/TaskRows";
import { TimelineRowFallback } from "../TimelineRowFallback";

export function DelegationCallRow({ item, sessionId }: { item: RawItem; sessionId: string }) {
  if (!isRunning(item) && delegateCallOf(item)?.askId) return <DelegationCard item={item} sessionId={sessionId} />;
  const task = taskToolRow(item);
  return task ? <TaskToolRow item={item} task={task} /> : <TimelineRowFallback />;
}
