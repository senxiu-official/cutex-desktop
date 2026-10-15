// Settings → 用户 for every connection (docs/research/identity-settings-review-20261015.md §4.2):
// 你在这台主机上 — your name and picture, your role there and what this desktop is on the host (lib/myHost) —
// and, on a connection that is not the owner's, 你的设备: your own devices on that host with 移除 (cutex
// `user-own-devices`, `GET|DELETE /v2/users/me/devices`); without it only this desktop's row from cutex
// C1 `user.token`, or nothing. The owner manages every device in the users module's 设备 list instead.
import { useCallback, useEffect, useState } from "react";
import { USER_OWN_DEVICES_FEATURE, USERS_SELF_PROFILE_FEATURE, type OwnDevice } from "../../../../shared/users";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import { useHostAccess } from "../../lib/hostAccess";
import { identityInitials, identityName } from "../../lib/identity";
import { useIdentityPrefs } from "../../lib/identityPrefs";
import { useMyHost } from "../../lib/myHost";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi, useTargetFeatures } from "../../lib/targetHost";
import { useUserAvatar } from "../../lib/userAvatars";
import { useHostData } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { Avatar } from "../Avatar";
import { ArmedRemove, EmptyState, ErrorNote, ListRow, Loading, Section } from "./Form";
import { DeviceLineText, RoleLine } from "./MyHostLines";
import { ThisComputerBadge, TokenDetail, TokenIcon, TokenTitle } from "./TokenName";

let osUserName: string | null | undefined;
function useOsUserName(): string | null {
  const [name, setName] = useState(osUserName ?? null);
  useEffect(() => {
    if (osUserName !== undefined || !bridge.shell) return;
    bridge.shell.state().then((s) => setName((osUserName = s.osUserName ?? null)), () => {});
  }, []);
  return name;
}

/** 你在这台主机上. */
export function MeHereSection({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const me = useMyHost(hostId);
  const access = useHostAccess(hostId);
  const prefs = useIdentityPrefs();
  const os = useOsUserName();
  const selfProfile = useHostData(hostId)?.features.has(USERS_SELF_PROFILE_FEATURE) ?? false;
  const picture = useUserAvatar(hostId, selfProfile && !prefs.picture ? access.userId : null, access.avatarEtag);
  const name = identityName(access, prefs.name, os, selfProfile) || t("identity.you");
  const owner = me.row.role === "owner" || me.row.role === "older";
  return (
    <Section id={settingsAnchorId("users-me")} title={t("users.me.title")}>
      <div className="flex items-center gap-3 py-2.5" data-testid="users-me">
        <Avatar name={name} initial={identityInitials(name)} color="#868e96" picture={prefs.picture ?? picture} size={32} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate font-medium">{name}</span>
            {owner && <span className="shrink-0 rounded bg-accent/15 px-1.5 text-[11px] text-accent">{t("users.ownerBadge")}</span>}
          </div>
          {!owner && <RoleLine row={me.row} stale={me.stale} />}
          <DeviceLineText device={me.device} />
        </div>
      </div>
    </Section>
  );
}

/** 你的设备 (a non-owner, assigned connection). */
export function OwnDevicesSection({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const access = useHostAccess(hostId);
  const supported = useTargetFeatures().has(USER_OWN_DEVICES_FEATURE);
  const connected = useHostData(hostId)?.daemon.kind === "connected";
  const notify = useApp((s) => s.notify);
  const [devices, setDevices] = useState<OwnDevice[] | null>(null);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api.usersMeDevices();
      if (r.ok && r.value) setDevices(r.value.devices);
      else setRefused(true); // older cutex (null) or user_pending / access_pending
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);
  useEffect(() => {
    setDevices(null);
    setRefused(false);
    setError(null);
    if (supported && connected) void load();
  }, [hostId, supported, connected, load]);
  const remove = async (device: OwnDevice) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.usersMeRemoveDevice(device.tokenId);
      if (!r.ok) setError(r.error.code === "client_token_not_found" ? t("users.own.notFound") : t("users.error.other", { message: r.error.message || r.error.code }));
      else if (r.value.current) notify(t("users.own.removedCurrent"));
      else void load();
    } catch (e) {
      setError(t("users.error.other", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  const own = access.token;
  // Without C2 (or refused): this desktop's own row from C1, else nothing.
  if (!supported || refused) {
    if (!own) return null;
    return (
      <Section id={settingsAnchorId("users-own-devices")} title={t("users.own.title")} hint={t("users.own.hint")}>
        <ListRow leading={<TokenIcon token={{ kind: "client" }} />} title={<TokenTitle token={{ tokenId: own.id, label: own.label, deviceName: own.deviceName, ownerName: own.ownerName }} editing={false} onSave={async () => false} onCancel={() => {}} extra={<ThisComputerBadge />} />} />
      </Section>
    );
  }
  return (
    <Section id={settingsAnchorId("users-own-devices")} title={t("users.own.title")} hint={t("users.own.hint")}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {devices === null && !error && <Loading rows={2} />}
      {devices?.length === 0 && <EmptyState>{t("users.noDevices")}</EmptyState>}
      {[...(devices ?? [])]
        .sort((a, b) => (a.current !== b.current ? (a.current ? -1 : 1) : (Date.parse(b.lastUsedAt ?? "") || 0) - (Date.parse(a.lastUsedAt ?? "") || 0)))
        .map((device) => (
          <ListRow
            key={device.tokenId}
            leading={<TokenIcon token={device} />}
            title={<TokenTitle token={device} editing={false} onSave={async () => false} onCancel={() => {}} extra={device.current ? <ThisComputerBadge /> : undefined} />}
            detail={<TokenDetail token={device} />}
            actions={<ArmedRemove title={device.current ? t("remote.token.revokeOwn") : `${t("users.revoke")} — ${t("users.revokeHint")}`} armedLabel={t(device.current ? "users.own.removeCurrentArmed" : "users.revokeArmed")} disabled={busy} onRemove={() => void remove(device)} />}
          />
        ))}
    </Section>
  );
}
