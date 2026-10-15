// useStatus of the 闹钟 category: present while the agent has a scheduled alarm (set by it or waking
// it), or one went off < 30 min ago. Loaded while the category is placed in the capsule (this hook
// runs only there); the agent's own host answers (multi-host: an agent opened from another host).
import { AlarmClock } from "lucide-react";
import { StatusMore } from "../../components/StatusChip";
import { useClock } from "../../lib/time";
import type { StatusLine } from "../slots";
import { AlarmLine } from "./AlarmsStatus";
import { alarmsWorthShowing, type AgentAlarms } from "./model";
import { useAgentAlarms } from "./store";

export type AlarmsData = AgentAlarms & { hostId: string; error: string | null };

export function useAlarmsStatus(sessionId: string): { data: AlarmsData; line: StatusLine } | null {
  const data = useAgentAlarms(sessionId, true);
  const now = useClock();
  if (!alarmsWorthShowing(data, now)) return null;
  return {
    data,
    line: {
      icon: <AlarmClock size={14} className={`shrink-0 ${data.pending.length > 0 ? "text-accent" : "text-subtle"}`} />,
      text: <AlarmLine data={data} />,
      title: [...data.pending, ...data.recent.slice(0, 3)].map((a) => a.messagePreview).join("\n"),
      trailing: <StatusMore n={data.pending.length} />,
    },
  };
}
