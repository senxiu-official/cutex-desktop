// Settings → 用户 → 在线的桌面 (cutex `client-remote-close`; lib/remoteClose.ts, shared/remoteClose.ts):
// the cutex desktops registered on the selected host (the owner sees all, other users their own),
// each with its version, system, user, last heartbeat and state, live through `cutex/client/stateChanged`.
// 「关闭」 asks that desktop to close (it shows a 15 s countdown and may cancel); only the desktop app
// quits, agents and services keep running. This desktop is labelled 这台电脑 and has no button; a
// desktop that turned remote close off, or one this connection may not close, has the button off with
// the reason.
import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { DESKTOP_APP_NAME, OWNER_USER_ID, shownUserName } from "@cutex-desktop/cutex-client";
import { clientPlatformLabel, isKnownRemoteCloseRefusal, type ClientState, type RemoteCloseRefusal } from "../../../../shared/remoteClose";
import { deviceScopeOf, USERS_FEATURE } from "../../../../shared/users";
import { apiFor } from "../../bridge";
import { useI18n, type MessageKey } from "../../i18n";
import { confirmDialog } from "../../lib/contextMenu";
import { useHostAccess } from "../../lib/hostAccess";
import { ONLINE_DESKTOPS_ANCHOR, useOnlineClients, type OnlineClientRowView } from "../../lib/remoteClose";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { Button, EmptyState, ErrorNote, ListRow, Loading, Section } from "./Form";

type T = ReturnType<typeof useI18n>["t"];

/** A refusal of the clients routes as one sentence. */
function remoteCloseRefusalText(t: T, refusal: RemoteCloseRefusal): string {
  if (isKnownRemoteCloseRefusal(refusal.code)) return t(`remoteClose.refusal.${refusal.code}` as MessageKey);
  return t("remoteClose.refusal.other", { message: refusal.message || refusal.code });
}

const STATE_KEYS: Record<Exclude<ClientState, "online">, MessageKey> = {
  closeRequested: "remoteClose.state.closeRequested",
  closing: "remoteClose.state.closing",
  cancelled: "remoteClose.state.cancelled",
};

/** user id → shown name (owner connections read `/v2/users`; others know only themselves). */
function useUserNames(hostId: string, read: boolean): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    setNames({});
    if (!read) return;
    let live = true;
    apiFor(hostId).users().then(
      (list) => {
        if (live && list) setNames(Object.fromEntries(list.users.map((u) => [u.id, shownUserName(u)])));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [hostId, read]);
  return names;
}

export function OnlineDesktopsSection() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const view = useOnlineClients(hostId);
  const access = useHostAccess(hostId);
  const features = useTargetFeatures();
  const names = useUserNames(hostId, view.available && access.isOwner && features.has(USERS_FEATURE));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setError(null), [hostId]);
  if (!view.available) return null;
  const narrowed = (deviceScopeOf(access) ?? "full") !== "full";
  // Whose desktop it is: 你名下 / <name> 名下 (the owner's name for a member is the {{owner}} term).
  const userName = (userId: string | null): string | null => {
    if (!userId) return null;
    if (userId === access.userId) return t("remoteClose.userYou");
    return t("remoteClose.user", { name: userId === OWNER_USER_ID && !names[userId] ? t("remoteClose.userOwner") : (names[userId] ?? userId) });
  };
  const close = async (row: OnlineClientRowView) => {
    const device = row.deviceName || t("remoteClose.unnamed");
    if (!(await confirmDialog(t("remoteClose.confirm", { device }), true, { ok: t("remoteClose.close"), cancel: t("remoteClose.cancel") }))) return;
    setBusy(row.instanceId);
    setError(null);
    const r = await view.close(row.instanceId);
    setBusy(null);
    if (!r.ok) setError(remoteCloseRefusalText(t, r.error));
  };
  return (
    <Section id={settingsAnchorId(ONLINE_DESKTOPS_ANCHOR)} title={t("remoteClose.list")} hint={t("remoteClose.listHint")}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {view.error && !view.rows.length && <ErrorNote>{remoteCloseRefusalText(t, view.error)}</ErrorNote>}
      {!view.read && view.loading && <Loading rows={1} />}
      {view.read && !view.error && view.rows.length === 0 && <EmptyState>{t("remoteClose.none")}</EmptyState>}
      {view.rows.map((row) => (
        <DesktopRow key={row.instanceId} row={row} user={userName(row.userId)} busy={busy === row.instanceId} narrowed={narrowed} onClose={() => void close(row)} />
      ))}
    </Section>
  );
}

function DesktopRow({ row, user, busy, narrowed, onClose }: { row: OnlineClientRowView; user: string | null; busy: boolean; narrowed: boolean; onClose(): void }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const seen = row.lastSeen ? Date.parse(row.lastSeen) : NaN;
  const app = row.appName === DESKTOP_APP_NAME || !row.appName ? t("remoteClose.appName", { version: row.appVersion || "?" }) : `${row.appName} ${row.appVersion}`.trim();
  const parts = [app, row.platform ? clientPlatformLabel(row.platform) : null, user, Number.isFinite(seen) ? t("remoteClose.lastSeen", { when: formatWhen(seen / 1000, now, locale) }) : null].filter((p): p is string => !!p);
  const hint =
    row.gate === "disabled" ? t("remoteClose.gate.disabled") : row.gate === "forbidden" ? t(narrowed ? "remoteClose.gate.scope" : "remoteClose.gate.otherUser") : row.gate === "busy" ? t("remoteClose.gate.busy") : t("remoteClose.closeHint");
  return (
    <ListRow
      leading={<Monitor size={16} className="shrink-0 text-muted" />}
      title={
        <span className="flex min-w-0 items-center gap-1.5" data-testid="online-desktop" data-instance={row.instanceId}>
          <span className="truncate">{row.deviceName || t("remoteClose.unnamed")}</span>
          {row.self && <span className="shrink-0 rounded bg-accent/15 px-1.5 text-[11px] text-accent">{t("remoteClose.thisComputer")}</span>}
          {row.state !== "online" && (
            <span className={`shrink-0 rounded px-1.5 text-[11px] ${row.state === "cancelled" ? "border border-border text-muted" : "bg-warn/15 text-warn-text"}`} data-testid="online-desktop-state">
              {t(STATE_KEYS[row.state])}
            </span>
          )}
          {!row.allowRemoteClose && !row.self && <span className="shrink-0 rounded border border-border px-1.5 text-[11px] text-muted">{t("remoteClose.offChip")}</span>}
        </span>
      }
      detail={<span title={Number.isFinite(seen) ? formatAbsolute(seen / 1000) : undefined}>{parts.join(" · ")}</span>}
      actions={row.self ? undefined : <Button disabled={busy || row.gate !== "ok"} title={hint} onClick={onClose}>{t("remoteClose.close")}</Button>}
    />
  );
}
