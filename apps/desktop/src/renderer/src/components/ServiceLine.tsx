// One service in a narrow list (project Overview aside): status glyph, name (click opens), port;
// everything else in the ⋯ / context menu. The Services page uses the full table instead.
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ServiceView } from "../../../shared/ipc";
import { useI18n, type MessageKey } from "../i18n";
import { contextMenu, openMenuFrom } from "../lib/contextMenu";
import { openService, serviceMenu } from "../lib/services";
import { serviceStatus } from "../lib/status";
import { useTargetHostId } from "../lib/targetHost";
import { ServiceLogs } from "./ServiceLogs";
import { StatusIcon } from "./StatusIcon";

/** `hostId`: the service's host (default: the target host, lib/targetHost — the project page's). */
export function ServiceLine({ s, onError, hostId }: { s: ServiceView; onError(e: string): void; hostId?: string }) {
  const { t } = useI18n();
  const target = useTargetHostId();
  const host = hostId ?? target;
  const [logs, setLogs] = useState(false);
  const menu = () => serviceMenu(s, t, onError, () => setLogs((v) => !v), host);

  return (
    <div className="group border-b border-border/60 py-1.5 last:border-b-0" onContextMenu={contextMenu(menu)}>
      <div className="flex items-center gap-2 text-sm">
        <span title={t(`services.health.${s.health}` as MessageKey)}>
          <StatusIcon kind={serviceStatus(s)} size={13} />
        </span>
        <button onClick={() => void openService(s, host).catch((e: unknown) => onError(String(e)))} className="min-w-0 flex-1 truncate text-left hover:underline" title={s.url}>
          {s.displayName || s.slug}
        </button>
        <span className="shrink-0 font-mono text-[11px] text-subtle">:{s.port}</span>
        <button onClick={(e) => openMenuFrom(e.currentTarget, menu())} className="shrink-0 rounded p-0.5 text-subtle opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-foreground">
          <MoreHorizontal size={14} />
        </button>
      </div>
      {logs && <ServiceLogs slug={s.slug} hostId={host} className="mt-1.5 mb-1" />}
    </div>
  );
}
