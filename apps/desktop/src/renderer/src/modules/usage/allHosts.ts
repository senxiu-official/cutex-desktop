// 用量 「全部主机」: reading every included host (lib/settingsHost `useAllHostsTarget`). The merge itself
// is pure (./merge.ts); this file holds the per-host loads and the view the page components share.
import { createContext, useContext, useEffect, useState } from "react";
import type { DaemonApi, UsageReport } from "../../../../shared/ipc";
import type { AllHostsChoice } from "../../lib/hostPick";
import { asCutexSource, emptyReport, hostQuery, type UsageQuery } from "./merge";
import type { ProfileProviders } from "./provider";

/** One host of the merged view. */
export interface HostTarget {
  hostId: string;
  label: string;
  /** Host color (the 「主机」 split). */
  color: string;
  api: DaemonApi;
  /** The host keeps extra usage sources (usage-external-sources). */
  sources: boolean;
}

/** One host's answer: `report` null + no error = this cutex has no ledger. */
export interface HostResult {
  hostId: string;
  label: string;
  report: UsageReport | null;
  error: string | null;
}

/** What the 「全部主机」 page components share. */
export interface AllView {
  targets: HostTarget[];
  /** The Settings host: its currency is the view's (when it has one). */
  primary: string;
  /** Configured hosts left out (offline / no ledger / still connecting). */
  excluded: AllHostsChoice["excluded"];
  /** Each host's profiles by name (undefined while loading). */
  providers: ReadonlyMap<string, ProfileProviders> | undefined;
  /** Shown spelling of a profile name across hosts (merge.ts canonicalNames). */
  canonical(name: string): string;
  /** Host label → color. */
  colors: ReadonlyMap<string, string>;
  /** The one host price table / model map / extra directories are edited on. */
  editHost: string;
  setEditHost(hostId: string): void;
}

export const AllViewContext = createContext<AllView | null>(null);

/** The 「全部主机」 view (null: one host). */
export function useAllView(): AllView | null {
  return useContext(AllViewContext);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The same query on every host (never rejects: a failed host carries its error). */
export function loadHostsUsage(targets: readonly HostTarget[], query: UsageQuery): Promise<HostResult[]> {
  return Promise.all(
    targets.map(async ({ hostId, label, api, sources }): Promise<HostResult> => {
      const q = hostQuery(query, sources);
      if (!q) return { hostId, label, report: emptyReport(query), error: null };
      try {
        const report = await api.usage(q);
        return { hostId, label, report: report && q.groupBy.length < query.groupBy.length ? asCutexSource(report) : report, error: null };
      } catch (e) {
        return { hostId, label, report: null, error: message(e) };
      }
    }),
  );
}

/** Each host's profiles by name (`listProfiles`); a host whose list failed maps to null. */
export function useHostsProfileProviders(targets: readonly HostTarget[]): ReadonlyMap<string, ProfileProviders> | undefined {
  const [map, setMap] = useState<ReadonlyMap<string, ProfileProviders> | undefined>(undefined);
  const key = targets.map((t) => t.hostId).join("\n");
  useEffect(() => {
    let live = true;
    void Promise.all(targets.map((t) => t.api.listProfiles().then((r) => new Map((r?.profiles ?? []).map((p) => [p.name, p])), () => null))).then((lists) => {
      if (live) setMap(new Map(targets.map((t, i) => [t.hostId, lists[i]!])));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the targets
  }, [key]);
  return map;
}
