// 添加设备 on a host's 设备 list (owner 2026-11-08: one way to add a device; contract rev 9.1). One QR / paste
// string (`cutex-pair:v2:…`) that works over the host's tailnet / LAN address and, when the host has the relay's
// pairing entry, over the relay too; the phone applies, both sides show the same 6-digit code, the owner checks
// it and allows here. Whichever route the phone used, the request, the code, 允许 / 拒绝 and the resulting
// device are the same; the route is only a detail. Allowing a full-control device asks in main's native dialog
// with the code (main/pairingInvites.ts); chat / read devices take a click-twice confirm here.
// An older cutex without v2 invites gets today's v1 code in the same panel (no Allow step: that cutex cannot).
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Copy, Lock, Smartphone } from "lucide-react";
import type { CreatedPairingInviteView, PairingCodeView, PairingInviteView } from "../../../../shared/ipc";
import { accessRefusalOf, DEVICE_SCOPE_FEATURE, OWNER_DEVICE_NOTICE_FEATURE, OWNER_USER_ID, shownUserName, type DeviceScope, type UserRecord, type UsersRefusal } from "../../../../shared/users";
import { Button, ErrorNote, Notice, SettingsGroup } from "../../components/settings/Form";
import { InvitePanel } from "../../components/settings/InvitePanel";
import { accessRefusalText, scopeLabel, useOwnerLocalLock } from "../../components/settings/OwnerDevices";
import { OwnerCodeWarning, PairingCard, PairPaths, PairScope, QrCode, type PairPath } from "../../components/settings/PairingParts";
import { Tag } from "../../components/Tag";
import { useI18n } from "../../i18n";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { copyText } from "../../lib/menus";
import { groupedHex, hasPairingInvites, isRequestRow, spacedCode, usePairingInvites, type PairingInvitesState } from "../../lib/pairingInvites";
import { formatCountdown, PAIRING_FEATURE, secondsLeft } from "../../lib/remoteAccess";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useNow } from "../../lib/time";
import { useHostScope } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { refusalText } from "../../lib/userGrants";
import { relayRouteNow } from "../../lib/relayPairing";
import { RelayPairingOffer, useHostRelayPairing } from "./RelayPairing";

type T = ReturnType<typeof useI18n>["t"];
const PLATFORMS = ["android", "ios", "web", "other"] as const;

/** What 添加设备 can do on this host: v2 invites, only the v1 code (older cutex), or nothing (much older). */
export function useAddDeviceSupport(): "v2" | "v1" | null {
  const features = useTargetFeatures();
  return hasPairingInvites(features) ? "v2" : features.has(PAIRING_FEATURE) ? "v1" : null;
}

const errorText = (t: T, error: UsersRefusal, host: string) =>
  error.code === "no_pairing_route" ? t("users.pair.noRoute", { host }) :
  accessRefusalText(t, accessRefusalOf({ ok: false, error }, { action: "pairingCode" }), host) ?? refusalText(error, (key, vars) => t(key as never, vars));

/**
 * The 设备 list's pairing part: requests waiting for the owner (always, while the page is open), and the
 * 添加设备 panel while `adding`. `onChanged` reloads the device list (a device was allowed / paired).
 */
export function DevicePairing({ adding, onClose, onChanged }: { adding: boolean; onClose(): void; onChanged(): void }) {
  const support = useAddDeviceSupport();
  const hostId = useTargetHostId();
  const lock = useOwnerLocalLock(hostId);
  const v2 = support === "v2" && !lock.locked;
  const invites = usePairingInvites(hostId, v2, adding);
  const host = useHostScope().host(hostId)?.view.label ?? hostId;
  const { t } = useI18n();
  const notify = useApp((s) => s.notify);
  // A request that became approved (here, in another window or by the CLI): the device list has a new device.
  const approved = useRef<Set<string> | null>(null);
  useEffect(() => {
    approved.current = null;
  }, [hostId]);
  useEffect(() => {
    if (!invites.invites) return;
    const now = new Set(invites.invites.filter((i) => i.status === "approved").map((i) => i.inviteId));
    const before = approved.current;
    approved.current = now;
    if (!before) return;
    const fresh = invites.invites.filter((i) => i.status === "approved" && !before.has(i.inviteId));
    if (fresh.length === 0) return;
    onChanged();
    for (const i of fresh) notify(t("users.pair.added", { device: i.request?.deviceName || t("users.pair.aDevice"), host }));
  }, [invites.invites]); // eslint-disable-line react-hooks/exhaustive-deps -- once per list read
  const rows = invites.invites?.filter(isRequestRow) ?? [];
  return (
    <>
      {rows.length > 0 && <PairingRequests rows={rows} invites={invites} host={host} />}
      {adding && support && <AddDevicePanel support={support} invites={invites} host={host} onClose={onClose} onChanged={onChanged} />}
    </>
  );
}

/** 有设备申请连接: each device that applied, its code, 允许 / 拒绝. */
function PairingRequests({ rows, invites, host }: { rows: PairingInviteView[]; invites: PairingInvitesState; host: string }) {
  const { t } = useI18n();
  return (
    <div className="-mx-4 border-b border-border bg-accent/5 px-4 py-2.5" data-testid="pairing-requests">
      <div className="text-sm font-medium">{t("users.pair.requests", { host })}</div>
      <p className="text-xs text-subtle">{t("users.pair.requestsHint")}</p>
      {rows.map((invite) => (
        <PairingRequestRow key={invite.inviteId} invite={invite} invites={invites} host={host} />
      ))}
    </div>
  );
}

function platformName(t: T, platform: string): string {
  return (PLATFORMS as readonly string[]).includes(platform) ? t(`remote.platform.${platform}` as never) : t("remote.platform.other");
}

function PairingRequestRow({ invite, invites, host }: { invite: PairingInviteView; invites: PairingInvitesState; host: string }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [armed, setArmed] = useArmed(invite.request?.requestId);
  const users = useUsersOnce();
  const request = invite.request!;
  const user = users?.find((u) => u.id === invite.userId);
  const owner = invite.userId === OWNER_USER_ID;
  const platform = platformName(t, request.platform);
  const now = useNow(invite.status === "pending");
  const left = secondsLeft(invite.expiresAt, now);
  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      const platforms = Object.fromEntries(PLATFORMS.map((p) => [p, platformName(t, p)]));
      const r = await api.approvePairingRequest(invite.inviteId, request.requestId, {
        title: t("users.pair.dialog.title", { host }),
        message: t("users.pair.dialog.message", { device: "{device}", host: "{host}" }),
        detail: t("users.pair.dialog.detail", { code: "{code}", user: "{user}", platform: "{platform}", host: "{host}" }),
        allow: t("users.pair.allow"),
        cancel: t("dialog.cancel"),
        platforms,
      });
      if (!r.ok && "changed" in r) setError(t("users.pair.changed"));
      else if (!r.ok && "error" in r) setError(errorText(t, r.error, host));
    } catch (e) {
      setError(t("users.error.other", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
      void invites.reload();
    }
  };
  const deny = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.denyPairingRequest(invite.inviteId, request.requestId);
      if (!r.ok) setError(errorText(t, r.error, host));
    } catch (e) {
      setError(t("users.error.other", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
      void invites.reload();
    }
  };
  const scopeText = owner && invite.scope === "full" ? t("users.pair.scope.full") : scopeLabel(t, invite.scope, owner);
  const pending = invite.status === "pending";
  return (
    <div className="mt-2 rounded-lg border border-border bg-surface px-3 py-2.5" data-testid="pairing-request" data-status={invite.status}>
      <div className="flex flex-wrap items-start gap-3">
        <Smartphone size={18} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium">{request.deviceName || platform}</span>
            <span className="text-subtle">· {platform}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
            <span>{t("users.pair.forUser", { user: user ? shownUserName(user) : owner ? t("users.pair.you") : invite.userId })}</span>
            <Tag tone={owner && invite.scope === "full" ? "attention" : undefined}>{scopeText}</Tag>
            {request.route && <span>· {t(request.route === "relay" ? "users.pair.route.relay" : "users.pair.route.direct")}</span>}
          </div>
        </div>
        {pending ? (
          <div className="flex shrink-0 items-center gap-2">
            {invite.scope === "full" ? (
              <SettingsGroup agents="access" source="host"><Button primary disabled={busy} onClick={() => void allow()}>{t("users.pair.allow")}</Button></SettingsGroup>
            ) : armed ? (
              <button className={ARMED_FORM_BUTTON} disabled={busy} onClick={() => (setArmed(false), void allow())}>{t("users.pair.allowArmed")}</button>
            ) : (
              <SettingsGroup agents="access" source="host"><Button primary disabled={busy} onClick={() => setArmed(true)}>{t("users.pair.allow")}</Button></SettingsGroup>
            )}
            <SettingsGroup agents="access" source="host"><Button disabled={busy} onClick={() => void deny()}>{t("users.pair.deny")}</Button></SettingsGroup>
          </div>
        ) : (
          <span className={`shrink-0 text-xs ${invite.status === "approved" ? "text-ok-text" : "text-subtle"}`}>{t(invite.status === "approved" ? "users.pair.status.approved" : "users.pair.status.approving")}</span>
        )}
      </div>
      {pending && (
        <div className="mt-2 ml-[30px] flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xs text-subtle">{t("users.pair.code")}</span>
          <span className="font-mono text-3xl font-semibold tracking-[0.15em] tabular-nums" data-testid="pairing-short-code">{spacedCode(request.shortCode)}</span>
          <span className={`text-xs tabular-nums ${left < 60 ? "text-warn" : "text-subtle"}`}>{t("users.pair.requestExpires", { time: formatCountdown(left) })}</span>
        </div>
      )}
      {pending && <p className="mt-1 ml-[30px] text-xs text-subtle">{t("users.pair.codeHint")}</p>}
      <button className="mt-1 ml-[30px] flex items-center gap-0.5 rounded text-xs text-subtle hover:text-foreground" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
        <ChevronRight size={12} className={details ? "rotate-90 transition-transform" : "transition-transform"} />
        {t("users.pair.details")}
      </button>
      {details && (
        <dl className="mt-1 ml-[30px] grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs" data-testid="pairing-request-details">
          <dt className="text-subtle">{t("users.pair.keyPrint")}</dt>
          <dd className="font-mono break-all">{request.keySha256 ? groupedHex(request.keySha256) : "—"}</dd>
          <dt className="text-subtle">{t("users.pair.csrPrint")}</dt>
          <dd className="font-mono break-all">{request.csrSha256 ? groupedHex(request.csrSha256) : "—"}</dd>
          <dt className="text-subtle">{t("users.pair.route")}</dt>
          <dd>{request.route ? t(request.route === "relay" ? "users.pair.route.relay" : "users.pair.route.direct") : "—"}</dd>
          <dt className="text-subtle">{t("users.pair.inviteId")}</dt>
          <dd className="font-mono">{invite.inviteId}</dd>
        </dl>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

/** The host's users, read once per host (who a request's device will belong to; the 邀请他人 path). */
function useUsersOnce(): UserRecord[] | null {
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  useEffect(() => {
    let live = true;
    setUsers(null);
    void api.users().then((r) => live && setUsers(r?.users ?? null), () => {});
    return () => {
      live = false;
    };
  }, [hostId]); // eslint-disable-line react-hooks/exhaustive-deps -- api follows the target host
  return users;
}

interface Choice {
  userId: string;
  scope: DeviceScope;
  label: string;
}

/** 添加设备: whose device, its scope, then one QR (v2) or the v1 code of an older cutex. */
function AddDevicePanel({ support, invites, host, onClose, onChanged }: { support: "v2" | "v1"; invites: PairingInvitesState; host: string; onClose(): void; onChanged(): void }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const features = useTargetFeatures();
  const hostId = useTargetHostId();
  const lock = useOwnerLocalLock(hostId);
  const users = useUsersOnce();
  const withScope = features.has(DEVICE_SCOPE_FEATURE);
  const [path, setPath] = useState<PairPath>("mine");
  const [scope, setScope] = useState<DeviceScope>("full");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ invite: CreatedPairingInviteView; choice: Choice } | null>(null);
  const [code, setCode] = useState<{ code: PairingCodeView; choice: Choice } | null>(null);
  useEffect(() => {
    setCreated(null);
    setCode(null);
    setError(null);
    setPath("mine");
    setScope("full");
  }, [hostId]);
  // An older cutex's v1 code: the device list reloads while it is live (a new device = the phone paired).
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => {
      if (secondsLeft(code.code.expiresAt, Date.now()) > 0) onChanged();
    }, 3000);
    return () => clearInterval(timer);
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps -- reload only
  const makeInvite = async (choice: Choice) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createPairingInvite({ ...(choice.userId !== OWNER_USER_ID ? { userId: choice.userId } : {}), scope: choice.scope, ...(choice.label ? { label: choice.label } : {}) });
      if (r.ok) {
        setCreated({ invite: r.value, choice });
        setCode(null);
        void invites.reload();
      } else setError(errorText(t, r.error, host));
    } catch (e) {
      setError(t("users.error.other", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  const makeCode = async (choice: Choice) => {
    setBusy(true);
    setError(null);
    try {
      const made = await api.createPairingCode(choice.label || undefined, choice.userId !== OWNER_USER_ID ? choice.userId : undefined, withScope ? choice.scope : undefined);
      setCode({ code: made, choice });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setError(accessRefusalText(t, accessRefusalOf(e, { action: "pairingCode" }), host) ?? (text.includes("too_many_pairing_codes") ? t("remote.pair.tooMany") : text));
    } finally {
      setBusy(false);
    }
  };
  const start = (choice: Choice) => (support === "v2" ? makeInvite(choice) : makeCode(choice));
  const cancel = async () => {
    const live = created && invites.invites?.find((i) => i.inviteId === created.invite.invite.inviteId);
    // Only a QR nobody used yet is withdrawn; a device that applied stays in the request list for 允许 / 拒绝.
    if (live && live.status === "invited") {
      const r = await api.cancelPairingInvite(live.inviteId).catch(() => null);
      if (r && !r.ok) setError(errorText(t, r.error, host));
      void invites.reload();
    }
    setCreated(null);
    setCode(null);
    onClose();
  };
  const listed = created ? invites.invites?.find((i) => i.inviteId === created.invite.invite.inviteId) : undefined;
  const ownerDevice = path === "mine";
  const choiceMine: Choice = { userId: OWNER_USER_ID, scope: withScope ? scope : "full", label: "" };
  return (
    <div className="-mx-4 border-b border-border px-4 py-3" data-testid="add-device">
      <div className="mb-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium">{t("users.pair.panelTitle", { host })}</span>
        <Button onClick={() => void cancel()}>{created && (!listed || listed.status === "invited") ? t("users.pair.cancel") : t("remote.pair.close")}</Button>
      </div>
      {support === "v1" && <Notice tone="info">{t("users.pair.v1Only", { host })}</Notice>}
      {support === "v2" && !lock.locked && <RelayPairingOffer />}
      {lock.locked ? (
        <p className="flex items-center gap-1 py-1 text-xs text-subtle"><Lock size={12} />{t("users.pair.localOnly", { host })}</p>
      ) : created ? (
        <InviteCard created={created.invite} listed={listed} host={host} busy={busy} onRenew={() => void makeInvite(created.choice)} onAgain={() => (setCreated(null), setCode(null))} legacy={features.has(PAIRING_FEATURE) ? () => void makeCode(created.choice) : null} legacyCode={code?.code ?? null} onLegacyClose={() => setCode(null)} />
      ) : code ? (
        <PairingCard code={code.code} busy={busy} onRenew={() => void makeCode(code.choice)} onClose={() => void cancel()} />
      ) : (
        <>
          {users && <PairPaths value={path} onChange={(next) => (setPath(next), setScope("full"))} />}
          {path === "invite" && users ? (
            <InvitePanel users={users} busy={busy} onCode={(userId, name) => start({ userId, scope: "full", label: name })} />
          ) : (
            <>
              {withScope && <PairScope value={scope} ownerDevice={ownerDevice} onChange={setScope} labels={{ full: t("users.pair.scope.full") }} />}
              {scope === "full" && features.has(OWNER_DEVICE_NOTICE_FEATURE) && <OwnerCodeWarning host={host} title={support === "v2" ? t("users.pair.warning.title", { host }) : undefined} once={support === "v2" ? t("users.pair.warning.once") : undefined} />}
              <div className="-mx-4 flex flex-wrap items-center justify-end gap-2 px-4 pt-2.5">
                <span className="min-w-0 flex-1 text-sm" data-testid="pair-result">{t("users.pair.result", { scope: scope === "full" ? t("users.pair.scope.full") : scopeLabel(t, scope, true), host })}</span>
                <SettingsGroup agents="access" source="host"><Button primary disabled={busy} onClick={() => void start(choiceMine)}>
                  {busy ? t("remote.pair.generating") : t(support === "v2" ? "users.pair.generate" : "remote.pair.generate")}
                </Button></SettingsGroup>
              </div>
            </>
          )}
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

/** The live invite: QR + paste string + countdown; once a device applied, the request list above takes over. */
function InviteCard({ created, listed, host, busy, onRenew, onAgain, legacy, legacyCode, onLegacyClose }: {
  created: CreatedPairingInviteView;
  listed: PairingInviteView | undefined;
  host: string;
  busy: boolean;
  onRenew(): void;
  /** Back to the form for the next device (this one applied). */
  onAgain(): void;
  /** TODO(qr-pair phone v2): remove 旧版手机 (and these props) once the phone app reads `cutex-pair:v2`. */
  legacy: (() => void) | null;
  legacyCode: PairingCodeView | null;
  onLegacyClose(): void;
}) {
  const { t } = useI18n();
  const now = useNow(true);
  const [copied, setCopied] = useState(false);
  // The QR names the relay entry whenever one is configured; whether a phone can use it now is the switch (9.4).
  const relayNow = relayRouteNow(created.relay, useHostRelayPairing()?.state.status ?? null);
  const status = listed?.status ?? created.invite.status;
  const left = secondsLeft(created.invite.expiresAt, now);
  const expired = left === 0 || status === "expired" || status === "cancelled" || status === "rejected";
  if (status === "pending" || status === "approving" || status === "approved") {
    return (
      <div className="flex flex-wrap items-center gap-2 py-1">
        <p className="min-w-0 flex-1 text-sm text-ok-text" data-testid="invite-taken">{t(status === "approved" ? "users.pair.taken.approved" : "users.pair.taken", { device: listed?.request?.deviceName || t("users.pair.aDevice") })}</p>
        <SettingsGroup agents="access" source="host"><Button onClick={onAgain}>{t("users.pair.again")}</Button></SettingsGroup>
      </div>
    );
  }
  return (
    <div data-testid="pair-invite-v2">
      <div className="flex flex-wrap items-start gap-5">
        <div className={expired ? "opacity-30" : ""}>
          <QrCode text={created.qr} label={t("users.pair.qr")} size="h-56 w-56" />
        </div>
        {/* Beside the QR when there is room, under it in a narrow settings pane (the paste string needs the width). */}
        <div className="min-w-[16rem] flex-1 basis-64 space-y-2">
          <p className="text-sm">{t("users.pair.scanHint")}</p>
          <p className={`text-xs tabular-nums ${expired ? "text-danger" : left < 60 ? "text-warn" : "text-subtle"}`} data-testid="invite-countdown">
            {expired ? t("users.pair.expired") : t("users.pair.expiresIn", { time: formatCountdown(left) })}
          </p>
          <p className="text-xs text-subtle" data-testid="invite-route">
            {relayNow ? t("users.pair.routeRelay") : t("users.pair.routeDirect", { host })}
          </p>
          <div>
            <div className="text-xs text-subtle">{t("users.pair.paste")}</div>
            <div className="mt-0.5 flex items-center gap-2">
              <code className={`min-w-0 flex-1 truncate rounded border border-border bg-surface-2/50 px-2 py-1 font-mono text-xs select-all ${expired ? "text-subtle line-through" : ""}`} title={t("users.pair.pasteHint")} data-testid="invite-paste">{created.qr}</code>
              <Button disabled={expired} onClick={() => (copyText(created.qr), setCopied(true))}>
                <Copy size={12} className="mr-1 -ml-0.5 inline align-[-1px]" />
                {copied ? t("users.pair.copied") : t("users.pair.copy")}
              </Button>
            </div>
            <p className="mt-0.5 text-xs text-subtle">{t("users.pair.pasteHint")}</p>
          </div>
          {!expired && (
            <p className="flex items-center gap-1.5 text-xs text-subtle">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              {t("users.pair.waiting")}
            </p>
          )}
          {expired && (
            <SettingsGroup agents="access" source="host"><Button primary disabled={busy} onClick={onRenew}>{t("users.pair.renew")}</Button></SettingsGroup>
          )}
          {(created.directUrls.length > 0 || created.bootstrapOrigin) && (
            <details className="text-xs text-subtle">
              <summary className="cursor-pointer">{t("users.pair.addresses")}</summary>
              {created.directUrls.map((u) => <div key={u} className="truncate font-mono">{u}</div>)}
              {created.bootstrapOrigin && <div className="truncate font-mono">{created.bootstrapOrigin} · {t("users.pair.route.relay")}</div>}
            </details>
          )}
        </div>
      </div>
      {legacy && (
        <details className="mt-3 border-t border-border pt-2 text-xs" data-testid="pair-legacy">
          <summary className="cursor-pointer text-subtle">{t("users.pair.legacy")}</summary>
          <p className="mt-1 text-subtle">{t("users.pair.legacyHint")}</p>
          {legacyCode ? (
            <PairingCard code={legacyCode} busy={busy} onRenew={legacy} onClose={onLegacyClose} compact />
          ) : (
            <div className="mt-1"><SettingsGroup agents="access" source="host"><Button disabled={busy} onClick={legacy}>{t("users.pair.legacyShow")}</Button></SettingsGroup></div>
          )}
        </details>
      )}
    </div>
  );
}
