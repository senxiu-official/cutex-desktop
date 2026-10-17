// React side of lib/profileTransfer: the hosts a profile of `sourceHostId` can be copied to, live.
import { useMemo } from "react";
import { useApp } from "../store";
import { transferTargets } from "./profileTransfer";

export function useTransferTargets(sourceHostId: string): string[] {
  const hosts = useApp((s) => s.hosts);
  const daemon = useApp((s) => s.daemon);
  const features = useApp((s) => s.features);
  const featuresKnown = useApp((s) => s.featuresKnown);
  const byHost = useApp((s) => s.byHost);
  return useMemo(
    () => transferTargets({ hosts, daemon, features, featuresKnown, byHost, sidebar: null, approvals: null, services: null }, sourceHostId),
    [hosts, daemon, features, featuresKnown, byHost, sourceHostId],
  );
}
