// Non-component Settings helpers (kept out of component files so React Fast Refresh works).
import { useMemo } from "react";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { useApp } from "../store";

/** Profile names known from agents (active + archived), until cutex `GET /v2/profiles` lands. */
export function useKnownProfiles(): string[] {
  const sidebar = useApp((s) => s.sidebar);
  return useMemo(() => knownProfileNames(sidebar), [sidebar]);
}

/** Profiles a host's agents (also archived ones) ran on, by name (sorted). */
export function knownProfileNames(sidebar: SidebarSnapshot | null | undefined): string[] {
  const names = new Set<string>();
  for (const s of [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])]) {
    const p = s.launchedProfile ?? s.configuredProfile ?? s.profile;
    if (p) names.add(p);
  }
  return [...names].sort();
}
