// 主人的设备 (owner 2026-10-19, host-ownership §5; data: lib/ownerDevices, shared/users; backend contract
// docs/research/owner-devices-ui-contract-20261019.md): the owner's paired devices have full control, so
// - new ones are announced: OwnerDevicesBanner on 连接 → 用户 (是我的设备 → ack; 不认识，撤销访问 → revoke,
//   a row for each other host with one), and the sidebar 设置 dot for any connected host (useOwnerDevicesAttention);
// - root-identity actions (配对码, 关闭新设备审批, 主机互联 配对 / 启用) only on the host itself or over SSH:
//   useOwnerLocalLock → a locked control says so (unknown = an older cutex: never locked);
// - every device has a scope that only narrows its user's grant (DeviceScopeRow, in the device's detail).
// Refusals from cutex are worded by accessRefusalText.
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { accessRefusalOf, DEVICE_SCOPES, type AccessRefusal, type DeviceScope } from "../../../../shared/users";
import { useI18n, type MessageKey } from "../../i18n";
import { clientTokenName } from "../../lib/deviceNames";
import { useHostsWithNewOwnerDevices, useOwnerLocalActions, useOwnerNewDevices } from "../../lib/ownerDevices";
import { setSettingsHost } from "../../lib/settingsHost";
import { formatWhen, useClock } from "../../lib/time";
import { useHostScope } from "../../lib/useHostScope";
import { ArmedRemove, Button, ErrorNote, Segmented, SettingRow, SettingsGroup } from "./Form";

type T = ReturnType<typeof useI18n>["t"];

/** A host's label for a sentence. */
function useHostLabel(hostId: string): string {
  return useHostScope().host(hostId)?.view.label ?? hostId;
}

/** Root-identity actions: locked only when cutex says this connection is not the host itself (or is narrowed). */
export function useOwnerLocalLock(hostId: string): { locked: boolean; hint: string | null } {
  const { t } = useI18n();
  const allowed = useOwnerLocalActions(hostId);
  const host = useHostLabel(hostId);
  return allowed === "no" ? { locked: true, hint: t("ownerDev.localOnly", { host }) } : { locked: false, hint: null };
}

/** A refusal of the owner-device rules as one sentence (null: another error — the caller words it). */
export function accessRefusalText(t: T, refusal: AccessRefusal | null, host: string): string | null {
  if (!refusal) return null;
  switch (refusal.reason) {
    case "ownerLocalOnly":
      return t("ownerDev.localOnly", { host });
    case "ownerPersonLocalOnly":
      return t("host.info.ownerLocalOnly");
    case "deviceScopeDenied":
      return t("ownerDev.scopeDenied", { scope: t(`ownerDev.scope.${refusal.scope ?? "read"}` as MessageKey) });
    case "invalidScope":
      return t("ownerDev.invalidScope");
    case "loopbackOnly":
      return t("remote.pair.loopbackOnly");
  }
}

/** The label of a scope: the first tier is 完全控制 on the owner's devices, 按用户授权 on other users'. */
export function scopeLabel(t: T, scope: DeviceScope, ownerDevice: boolean): string {
  return scope === "full" && !ownerDevice ? t("ownerDev.scope.byUser") : t(`ownerDev.scope.${scope}` as MessageKey);
}

/** The scopes as options (each with what it means as a tooltip); `upTo` drops tiers the user's grant does not reach. */
export function scopeOptions(t: T, ownerDevice: boolean, canSend: boolean) {
  return DEVICE_SCOPES.filter((s) => s !== "chat" || ownerDevice || canSend).map((s) => ({ value: s, label: scopeLabel(t, s, ownerDevice), title: t(`ownerDev.scope.${s}.hint` as MessageKey) }));
}

/** 设备权限 in a device's detail: a narrowing of its user's grant (this desktop's own token: read-only). */
export function DeviceScopeRow({ scope, ownerDevice, canSend, own, disabled, onChange }: { scope: DeviceScope; ownerDevice: boolean; canSend: boolean; own: boolean; disabled?: boolean; onChange(scope: DeviceScope): void }) {
  const { t } = useI18n();
  return (
    <SettingRow agents="access" source="host" label={t("ownerDev.scope")} hint={own ? t("ownerDev.scope.ownHint") : t(ownerDevice ? "ownerDev.scope.ownerHint" : "ownerDev.scope.userHint")}>
      {own ? (
        <span className="text-xs text-subtle">{scopeLabel(t, scope, ownerDevice)}</span>
      ) : (
        <Segmented<DeviceScope> value={scope} disabled={disabled} label={t("ownerDev.scope")} options={scopeOptions(t, ownerDevice, canSend)} onChange={onChange} />
      )}
    </SettingRow>
  );
}

/** 新设备以主人身份连接 …: one line per unacknowledged owner device of this host (not this desktop's own), then one per other host that has any. */
export function OwnerDevicesBanner({ hostId }: { hostId: string }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const v = useOwnerNewDevices(hostId);
  const host = useHostLabel(hostId);
  const scope = useHostScope();
  const elsewhere = useHostsWithNewOwnerDevices().filter((id) => id !== hostId);
  const [error, setError] = useState<string | null>(null);
  const here = v.available ? v.others : [];
  if (here.length === 0 && elsewhere.length === 0) return null;
  const run = async (r: Promise<{ ok: true } | { ok: false; error: { code: string; message?: string } }>) => {
    setError(null);
    const out = await r;
    if (!out.ok) setError(accessRefusalText(t, accessRefusalOf(out), host) ?? t("ownerDev.failed", { message: out.error.message || out.error.code }));
  };
  return (
    <div className="mb-6 space-y-1.5" data-testid="owner-devices-banner">
      {here.map((d) => {
        const at = Date.parse(d.at);
        return (
          <div key={d.tokenId} className="flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm">
            <ShieldAlert size={16} className="shrink-0 text-warn-text" />
            <span className="min-w-0 flex-1">
              {t("ownerDev.banner")}
              <span className="font-medium">{clientTokenName(d, (k, vars) => t(k as MessageKey, vars))}</span>
              <span className="text-muted">
                {" · "}
                {scopeLabel(t, d.scope ?? "full", true)}
                {Number.isFinite(at) && ` · ${formatWhen(at / 1000, now, locale)}`}
              </span>
            </span>
            {v.canAck && (
              <SettingsGroup agents="none" source="host"><Button title={t("ownerDev.ack")} onClick={() => void run(v.ack(d.tokenId))}>{t("ownerDev.mine")}</Button></SettingsGroup>
            )}
            {v.canRevoke && (
              <SettingsGroup agents="access" source="host"><ArmedRemove label={t("ownerDev.notMine")} title={t("users.revokeHint")} armedLabel={t("users.revokeArmed")} onRemove={() => void run(v.revoke(d.tokenId))} /></SettingsGroup>
            )}
          </div>
        );
      })}
      {elsewhere.map((id) => (
        <div key={id} className="flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm">
          <ShieldAlert size={16} className="shrink-0 text-warn-text" />
          <span className="min-w-0 flex-1">{t("ownerDev.elsewhere", { host: scope.host(id)?.view.label ?? id })}</span>
          {/* A link, not a button: an offline host's page disables every button in it, and this leaves that page. */}
          <SettingsGroup navigation agents="none" source="local"><a href="#" className="shrink-0 rounded-md px-2 py-1 text-xs text-accent hover:bg-surface" onClick={(e) => { e.preventDefault(); setSettingsHost(id); }}>{t("ownerDev.elsewhereOpen")}</a></SettingsGroup>
        </div>
      ))}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

/** The sidebar 设置 dot: a connected host has an unacknowledged owner device (another than this desktop). */
export function useOwnerDevicesAttention(): boolean {
  return useHostsWithNewOwnerDevices().length > 0;
}

/** 连接 → 用户 in the settings nav: the same dot. */
export function useOwnerDevicesNavBadge(): { dot: true; title: string } | null {
  const { t } = useI18n();
  return useOwnerDevicesAttention() ? { dot: true, title: t("ownerDev.navAttention") } : null;
}
