import { taskDeliveryRow, taskToolRow } from "../../lib/taskRows";
import type { ExternalMessage, RawItem } from "../../lib/timeline";
import { TaskDeliveryRow, TaskToolRow } from "../../components/TaskRows";
import { TimelineRowFallback } from "../TimelineRowFallback";

export function TaskReceivedRow({ message }: { message: ExternalMessage; sessionId: string; readOnly: boolean }) {
  const task = taskDeliveryRow(message);
  return task ? <TaskDeliveryRow task={task} body={message.text} /> : <TimelineRowFallback />;
}

export function TaskCallRow({ item }: { item: RawItem; sessionId: string }) {
  const task = taskToolRow(item);
  return task ? <TaskToolRow item={item} task={task} /> : <TimelineRowFallback />;
}
