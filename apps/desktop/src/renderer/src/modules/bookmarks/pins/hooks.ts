import { useMemo } from "react";
import { OWNER_PINS_FEATURE } from "../../../../../shared/ownerPins";
import { LOCAL_HOST_ID } from "../../../../../shared/hosts";
import { featuresOf, useApp } from "../../../store";
import { openCounts, pinRows } from "./model";
import { usePins } from "./store";

/** Open pins asking something of the owner (todo + decide) and open notes; `agentId` = one agent's. */
export function useCounts(agentId?: string | null) {
  const byHost = usePins((s) => s.byHost);
  return useMemo(() => openCounts(pinRows(byHost, agentId)), [byHost, agentId]);
}

/** Some host in the list runs a cutex with `owner-pins` (the 备忘 card then shows its 要处理 tab). */
export function usePinsAvailable(): boolean {
  return useApp((s) => (s.hosts?.hosts ?? [{ id: LOCAL_HOST_ID }]).some((h) => featuresOf(s, h.id).has(OWNER_PINS_FEATURE)));
}
