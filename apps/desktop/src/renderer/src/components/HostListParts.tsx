// Shared pieces of the cross-host list pages (multi-host P1 step 2b; lib/hostLists): the per-row host
// dot and the notice for hosts of the scope a list has no rows from (RFC §8.5).
import { useI18n } from "../i18n";
import type { HostLook } from "../lib/hostScope";
import { setHostConnected } from "../lib/useHostScope";
import { HostMark } from "./HostMark";

/** A row's host dot (hover = host name) when the scope shows host marks; nothing otherwise. */
export function RowHost({ host, show }: { host: HostLook | null; show: boolean }) {
  if (!show || !host) return null;
  return <HostMark host={host} dotOnly className="shrink-0" />;
}

/**
 * One line per host of the scope whose entries a list cannot show: not connected (⏻ 连接), still
 * connecting, or (`unsupported`) connected but its cutex lacks the page's capability.
 */
export function MissingHosts({ hosts, unsupported = [] }: { hosts: readonly HostLook[]; unsupported?: readonly HostLook[] }) {
  const { t } = useI18n();
  if (hosts.length === 0 && unsupported.length === 0) return null;
  return (
    <div className="mb-3 flex flex-col gap-1">
      {hosts.map((h) => {
        const connecting = h.connected && (h.indicator.status === "connecting" || h.indicator.status === "retrying");
        return (
          <p key={h.id} className="flex items-center gap-2 text-xs text-subtle">
            <HostMark host={h} />
            <span>{t(connecting ? "hostLists.connecting" : "hostLists.offline", { host: h.label })}</span>
            {!h.connected && (
              <button onClick={() => void setHostConnected(h.id, true)} className="text-accent hover:underline">
                {t("hostLists.connect")}
              </button>
            )}
          </p>
        );
      })}
      {unsupported.map((h) => (
        <p key={h.id} className="flex items-center gap-2 text-xs text-subtle">
          <HostMark host={h} />
          <span>{t("hostLists.needsUpgrade", { host: h.label })}</span>
        </p>
      ))}
    </div>
  );
}
