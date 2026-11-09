// Pieces of 添加设备 shared by the host page's device list (modules/users/AddDevice.tsx, pairing v2 and the v1
// fallback) and an older host's 配对设备 card (RemoteAccess.tsx PairingSection): the QR, the v1 code card,
// whose device it is, its scope, and the warning before a full-control owner device.
import { useMemo } from "react";
import { ShieldAlert } from "lucide-react";
import type { PairingCodeView } from "../../../../shared/ipc";
import type { DeviceScope } from "../../../../shared/users";
import { useI18n } from "../../i18n";
import { qrPath } from "../../lib/qr";
import { formatCountdown, secondsLeft } from "../../lib/remoteAccess";
import { useNow } from "../../lib/time";
import { useApp } from "../../store";
import { Button, SettingsGroup, TextLink } from "./Form";
import { scopeOptions } from "./OwnerDevices";

export type PairPath = "mine" | "invite";

/** The pairing payload as a QR code: dark on white in both themes (phones need the contrast). */
export function QrCode({ text, label, size = "h-48 w-48" }: { text: string; label: string; size?: string }) {
  const { size: modules, d } = useMemo(() => qrPath(text), [text]);
  const quiet = 4;
  return (
    <svg role="img" aria-label={label} viewBox={`${-quiet} ${-quiet} ${modules + quiet * 2} ${modules + quiet * 2}`} shapeRendering="crispEdges" className={`${size} shrink-0 rounded-lg bg-white ring-1 ring-border`}>
      <path d={d} fill="#000" />
    </svg>
  );
}

/** 设备权限 at pairing: one radio per scope with what it means (the owner's default: 完全控制). */
export function PairScope({ value, ownerDevice, onChange, labels }: { value: DeviceScope; ownerDevice: boolean; onChange(scope: DeviceScope): void; /** Plainer labels by scope (添加设备 v2: 完全控制，可以运行命令). */ labels?: Partial<Record<DeviceScope, string>> }) {
  const { t } = useI18n();
  return (
    <SettingsGroup agents="access" source="host"><div className="-mx-4 border-b border-border px-4 py-2.5" role="radiogroup" aria-label={t("ownerDev.scope")}>
      <div className="mb-1 text-sm">{t("ownerDev.scope")}</div>
      {scopeOptions(t, ownerDevice, true).map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-2 py-1 text-sm">
          <input type="radio" name="pair-scope" checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1 accent-[var(--color-accent)]" />
          <span>
            {(ownerDevice && labels?.[o.value]) || o.label}
            {o.value === "full" && ownerDevice && <span className="ml-1 text-xs text-subtle">{t("ownerDev.scope.ownerDefault")}</span>}
            <span className="block text-xs text-subtle">{o.value === "full" && !ownerDevice ? t("ownerDev.scope.byUser.hint") : o.title}</span>
          </span>
        </label>
      ))}
    </div></SettingsGroup>
  );
}

/** 配对 starts with whose device this is: yours (the owner's defaults) or someone else's (they see nothing yet). */
export function PairPaths({ value, onChange }: { value: PairPath; onChange(path: PairPath): void }) {
  const { t } = useI18n();
  const paths = [
    { id: "mine", title: t("remote.pair.path.mine"), hint: t("remote.pair.path.mineHint") },
    { id: "invite", title: t("remote.pair.path.invite"), hint: t("remote.pair.path.inviteHint") },
  ] as const;
  return (
    <SettingsGroup navigation agents="none" source="local"><div className="-mx-4 grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-2 border-b border-border px-4 py-2.5" role="radiogroup" aria-label={t("remote.pair.path")} data-testid="pair-paths">
      {paths.map((path) => (
        <label key={path.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${value === path.id ? "border-accent bg-accent/5" : "border-border hover:bg-surface-2/50"}`}>
          <input type="radio" name="pair-path" checked={value === path.id} onChange={() => onChange(path.id)} className="mt-1 accent-[var(--color-accent)]" />
          <span>
            {path.title}
            <span className="block text-xs text-subtle">{path.hint}</span>
          </span>
        </label>
      ))}
    </div></SettingsGroup>
  );
}

/** Before generating an owner code with full control: what it gives (owner 2026-10-19, three points). */
export function OwnerCodeWarning({ host, title, once }: { host: string; /** Default: the v1 code's wording. */ title?: string; once?: string }) {
  const { t } = useI18n();
  return (
    <div className="-mx-4 border-b border-border bg-warn/10 px-4 py-3 text-xs text-warn-text" data-testid="owner-code-warning">
      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        <ShieldAlert size={14} className="shrink-0" />
        {title ?? t("ownerDev.code.title", { host })}
      </div>
      <ul className="list-disc space-y-0.5 pl-5">
        <li>{t("ownerDev.code.commands")}</li>
        <li>{once ?? t("ownerDev.code.once")}</li>
        <li>{t("ownerDev.code.notice", { host })}</li>
      </ul>
    </div>
  );
}

/** A v1 one-time code (`cutex-pair:v1`): the phone redeems it over the host's tailnet / LAN address at once. */
export function PairingCard({ code, onClose, onRenew, busy, compact }: { code: PairingCodeView; onClose(): void; onRenew(): void; busy: boolean; /** Inside the v2 card's 旧版手机 fold: no frame of its own. */ compact?: boolean }) {
  const { t } = useI18n();
  const now = useNow(true);
  const left = secondsLeft(code.expiresAt, now);
  const expired = left === 0;
  return (
    <div className={compact ? "py-2" : "-mx-4 border-b border-border px-4 py-3"} data-testid="pairing-code-v1">
      <div className="flex flex-wrap items-start gap-5">
        <div className={expired ? "opacity-30" : ""}>
          <QrCode text={code.qr} label={t("remote.pair.qr")} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs text-subtle">{t("remote.pair.scanHint")}</p>
          <div className={`font-mono text-3xl font-semibold tracking-[0.2em] select-all ${expired ? "text-subtle line-through" : ""}`}>{code.code}</div>
          <p className={`text-xs tabular-nums ${expired ? "text-danger" : left < 60 ? "text-warn" : "text-subtle"}`}>
            {expired ? t("remote.pair.expired") : t("remote.pair.expiresIn", { time: formatCountdown(left) })}
            {code.label ? ` · ${code.label}` : ""}
          </p>
          {code.urls.length > 0 ? (
            <div>
              <div className="text-xs text-subtle">{t("remote.pair.urls")}</div>
              {code.urls.map((u) => (
                <div key={u} className="truncate font-mono text-xs text-muted">
                  {u}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-warn">
              {t("remote.pair.noUrls")}{" "}
              <TextLink onClick={() => useApp.getState().openSettings("access", { anchor: "remote-access.listen" })}>{t("remote.pair.openListen")}</TextLink>
            </p>
          )}
          {!expired && (
            <p className="flex items-center gap-1.5 text-xs text-subtle">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              {t("remote.pair.waiting")}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <SettingsGroup agents="access" source="host"><Button primary={expired} disabled={busy} onClick={onRenew}>
              {t("remote.pair.renew")}
            </Button></SettingsGroup>
            <Button onClick={onClose}>{t("remote.pair.close")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
