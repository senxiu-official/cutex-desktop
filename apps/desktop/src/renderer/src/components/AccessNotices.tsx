// users (docs/research/user-isolation-p1-20261014.md §9): what this device may do on a host where it
// is not the owner. `HostAccessBanner`: under the title bar for the focus host — pending (waiting for
// the host owner to assign this device) or "signed in as X". `ReadOnlyComposerNote`: in place of the
// composer when the user's grant has no `send`.
import { Eye, UserRound } from "lucide-react";
import { useI18n } from "../i18n";
import { useHostAccess } from "../lib/hostAccess";
import { useHostScope } from "../lib/useHostScope";
import { useApp } from "../store";

export function HostAccessBanner() {
  const { t } = useI18n();
  const scope = useHostScope();
  const hostId = useApp((s) => s.hosts?.active ?? "local");
  const connected = useApp((s) => s.daemon.kind === "connected");
  const access = useHostAccess(hostId);
  if (!connected || !access.known || access.isOwner) return null;
  const host = scope.host(hostId)?.label ?? hostId;
  return (
    <div className={`border-b border-border px-4 py-1 text-xs ${access.pending ? "bg-warn/10 text-foreground" : "bg-surface-2/60 text-muted"}`} role="status" data-testid="host-access-banner">
      <div className="flex items-center gap-2">
        <UserRound size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={access.pending ? t("users.access.pendingHint") : undefined}>
          {access.pending ? t("users.access.pending", { host }) : t(access.grant?.send ? "users.access.signedIn" : "users.access.signedInReadOnly", { host, name: access.displayName || access.name || access.userId || "" })}
        </span>
      </div>
    </div>
  );
}

export function ReadOnlyComposerNote({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const access = useHostAccess(hostId);
  return (
    <div className="side-col px-6 pb-4" data-testid="read-only-composer" data-gutter-anchor="banner">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm">
        <Eye size={16} className="mt-0.5 shrink-0 text-subtle" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{t("users.access.readOnlyTitle")}</div>
          <div className="text-xs text-subtle">{t(access.pending ? "users.access.readOnlyPending" : "users.access.readOnlyBody")}</div>
        </div>
      </div>
    </div>
  );
}
