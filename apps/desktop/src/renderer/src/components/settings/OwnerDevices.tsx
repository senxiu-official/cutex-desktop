// 主人的设备 (owner 2026-10-19, host-ownership §5; data: lib/ownerDevices, shared/users; backend contract
// docs/research/owner-devices-ui-contract-20261019.md): the owner's paired devices have full control, so
// - new ones are announced: OwnerDevicesBanner on 连接 → 用户 (× = 是我的设备 → ack; 吊销), and the sidebar
//   设置 dot (useOwnerDevicesAttention);
// - root-identity actions (配对码, 关闭新设备审批, 主机互联 配对 / 启用) only on the host itself or over SSH:
//   useOwnerLocalLock → a locked control says so (unknown = an older cutex: never locked);
// - every device has a scope that only narrows its user's grant (DeviceScopeRow, in the device's detail).
// Refusals from cutex are worded by accessRefusalText.
import { useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { accessRefusalOf, DEVICE_SCOPES, type AccessRefusal, type DeviceScope } from "../../../../shared/users";
import { useI18n, type MessageKey } from "../../i18n";
import { clientTokenName } from "../../lib/deviceNames";
import { useOwnerLocalActions, useOwnerNewDevices } from "../../lib/ownerDevices";
import { formatWhen, useClock } from "../../lib/time";
import { useHostScope } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { ErrorNote, Segmented, SettingRow } from "./Form";

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
    <SettingRow label={t("ownerDev.scope")} hint={own ? t("ownerDev.scope.ownHint") : t(ownerDevice ? "ownerDev.scope.ownerHint" : "ownerDev.scope.userHint")}>
      {own ? (
        <span className="text-xs text-subtle">{scopeLabel(t, scope, ownerDevice)}</span>
      ) : (
        <Segmented<DeviceScope> value={scope} disabled={disabled} label={t("ownerDev.scope")} options={scopeOptions(t, ownerDevice, canSend)} onChange={onChange} />
      )}
    </SettingRow>
  );
}

/** 新设备以主人身份连接 …: one line per unacknowledged owner device of this host (not this desktop's own). */
export function OwnerDevicesBanner({ hostId }: { hostId: string }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const v = useOwnerNewDevices(hostId);
  const host = useHostLabel(hostId);
  const [error, setError] = useState<string | null>(null);
  if (!v.available || v.others.length === 0) return null;
  const run = async (r: Promise<{ ok: true } | { ok: false; error: { code: string; message?: string } }>) => {
    setError(null);
    const out = await r;
    if (!out.ok) setError(accessRefusalText(t, accessRefusalOf(out), host) ?? t("ownerDev.failed", { message: out.error.message || out.error.code }));
  };
  return (
    <div className="mb-6 space-y-1.5" data-testid="owner-devices-banner">
      {v.others.map((d) => {
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
                {" · "}
                {t("ownerDev.notYou")}
              </span>
              {v.canRevoke && (
                <button type="button" className="ml-1 text-danger hover:underline" onClick={() => void run(v.revoke(d.tokenId))}>
                  {t("users.revoke")}
                </button>
              )}
            </span>
            {v.canAck && (
              <button type="button" title={t("ownerDev.ack")} aria-label={t("ownerDev.ack")} onClick={() => void run(v.ack(d.tokenId))} className="shrink-0 rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground">
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

/** The sidebar 设置 dot: the focus host has an unacknowledged owner device (another than this desktop). */
export function useOwnerDevicesAttention(): boolean {
  const hostId = useApp((s) => s.hosts?.active ?? "local");
  const v = useOwnerNewDevices(hostId);
  return v.available && v.others.length > 0;
}

/** 连接 → 用户 in the settings nav: the same dot. */
export function useOwnerDevicesNavBadge(): { dot: true; title: string } | null {
  const { t } = useI18n();
  return useOwnerDevicesAttention() ? { dot: true, title: t("ownerDev.navAttention") } : null;
}
