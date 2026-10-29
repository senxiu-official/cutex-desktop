import { loadProfileList } from "./profileSnapshot";
import { loadHostQuota } from "./targetHost";
import { onHostReset, onHostSwitch } from "./hostSwitch";

const pending = new Map<string, ReturnType<typeof loadProfileList>>();
onHostReset((host) => pending.delete(host));
onHostSwitch(() => pending.clear());
/** Identity menu and its flyout share one warm-up, including quotas, not just profile names. */
export function prepareUsage(host: string): ReturnType<typeof loadProfileList> {
  const existing = pending.get(host);
  if (existing) return existing;
  const run = loadProfileList(host).then(async (list) => {
    await Promise.allSettled((list?.profiles ?? []).map((p) => loadHostQuota(host, p.name)));
    return list;
  }).finally(() => { if (pending.get(host) === run) pending.delete(host); });
  pending.set(host, run);
  return run;
}
