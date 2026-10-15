// Usage-page view of the host's profiles: which ledger rows belong to deleted profiles.
import type { ProfileItem, UsageReport } from "../../../../shared/ipc";

/** Existing profiles by name, or null while unknown: then nothing counts as deleted. */
export type ProfileProviders = ReadonlyMap<string, ProfileItem> | null;

/** Only which names exist matters for hiding deleted profiles. */
type Existing = ReadonlyMap<string, unknown> | null;

/**
 * The ledger keeps rows under the profile name used at the time, so deleted or renamed profiles
 * still show up. Until cutex flags them (r218, id-based ledger), a name missing from
 * `/v2/profiles` is an old profile. Placeholders ("…", "—") are not profiles.
 */
export function isDeletedProfile(name: string, profiles: Existing): boolean {
  return profiles !== null && name !== "…" && name !== "—" && !profiles.has(name);
}

/**
 * Rows of a day × profile report without deleted profiles (display only; the ledger keeps them and
 * `totals` still count them). cutex r218 (id-based ledger) says so per row
 * (`profileState: "current" | "deleted"`, on the row and its key) and that answer is final; older
 * hosts: a name missing from `/v2/profiles` counts as deleted.
 */
export function withoutDeletedProfiles(report: UsageReport, profiles: Existing): UsageReport {
  const deleted = (r: UsageReport["rows"][number]) => {
    const state = r.profileState ?? r.key.profileState;
    return state ? state === "deleted" : !!r.key.profile && isDeletedProfile(r.key.profile, profiles);
  };
  const rows = report.rows.filter((r) => !deleted(r));
  return rows.length === report.rows.length ? report : { ...report, rows };
}
