// 闹钟 (cutex `alarms-api`, r225): the agent's alarm_set reminders as a status category — ones it set
// and ones that will wake it, with the owner's cancel. Live from `cutex/alarms/changed` (store.ts).
// Each agent asks its own host; a host without `alarms-api` shows nothing for its agents.
import { AlarmClock } from "lucide-react";
import { ALARMS_FEATURE } from "../../../../shared/alarms";
import { defineModule } from "../slots";
import { AlarmsBody, AlarmsMeta, AlarmsStatusBar } from "./AlarmsStatus";
import { startAlarmSync } from "./store";
import { useAlarmsStatus } from "./useAlarmsStatus";

export default defineModule({
  id: "alarms",
  titleKey: "alarms.title",
  descriptionKey: "alarms.description",
  requires: { capabilities: [ALARMS_FEATURE] },
  activate: (ctx) => startAlarmSync(ctx),
  contributes: {
    "conversation.status": [
      { id: "alarms.status", order: 650, titleKey: "alarms.statusTitle", defaultPlace: "capsule", useStatus: useAlarmsStatus, Meta: AlarmsMeta, Body: AlarmsBody, Bar: AlarmsStatusBar, icon: AlarmClock },
    ],
  },
});
