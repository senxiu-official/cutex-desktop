// Settings → 主机 (page "access", 连接 D plan, owner 2026-10-19): the two cards on top of one host's page.
// - 主机信息: who the host belongs to (主人: one owner person per host, cutex `/v2/host.owner`), its cutex
//   version and system. 「是我」 confirms an unconfirmed owner, 「设为我」 makes you the owner; both only
//   where cutex allows it (lib/hostOwnership canSetHere: this machine; over SSH from r246).
// - 你的权限: what you can do there (完全控制 / 按授权 / 等待分配) and where it comes from (本机, the SSH
//   login, a device token); over SSH with full control but someone else as the owner that is said
//   plainly; SSH hosts switch between connecting as member and as owner; 管理用户 opens 用户.
// Owner and permissions are kept apart on purpose: full control does not make you the owner.
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { SshErrorView } from "../../../../shared/hosts";
import { api } from "../../bridge";
import { useI18n, type MessageKey } from "../../i18n";
import { deviceScopeOf } from "../../../../shared/users";
import { useHostAccess } from "../../lib/hostAccess";
import { useHostOwnership } from "../../lib/hostOwnership";
import { scopeLabel } from "./OwnerDevices";
import { hostVersionTitle } from "../../lib/hostScope";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useHostScope } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { connectResultText, ownerName, ProblemText, roleKey } from "./ConnectionSettings";
import { Button, SettingRow, Section } from "./Form";

const PLATFORM: Record<string, string> = { win32: "Windows", windows: "Windows", darwin: "macOS", macos: "macOS", linux: "Linux" };

export function HostInfoSection({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const o = useHostOwnership(hostId);
  const look = useHostScope().host(hostId);
  const notify = useApp((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const label = look?.view.label ?? hostId;
  const confirm = async () => {
    setBusy(true);
    try {
      const r = await o.confirmMine();
      if (r.ok) notify(t("host.own.confirmed", { host: label }));
      else notify(r.error.code === "owner_person_local_only" ? t("host.info.ownerLocalOnly") : r.error.message || r.error.code, "error");
    } finally {
      setBusy(false);
    }
  };
  const version = look?.build ? hostVersionTitle(look.build, { dev: t("cutexBuild.dev"), legacy: t("cutexBuild.legacy") }) : null;
  const system = look?.platform ? (PLATFORM[look.platform] ?? look.platform) : null;
  const owner = o.owner;
  let action = null;
  if (o.capability === false) action = <span className="text-xs text-subtle">{t("host.info.ownerOlder")}</span>;
  else if (o.canConfirmHere || (o.canSetHere && o.mine !== true))
    action = (
      <Button disabled={busy} onClick={() => void confirm()}>
        {busy ? t("host.own.confirming") : o.canConfirmHere ? t("host.own.confirm") : t("host.info.setMe")}
      </Button>
    );
  else if (o.mine !== true && o.capability === true) action = <span className="text-xs text-subtle">{t("host.info.changeWhere")}</span>;
  return (
    <Section id={settingsAnchorId("hostInfo")} title={t("host.info.title")} hint={t("host.info.hint")} source="host">
      <SettingRow
        label={
          <span className="flex flex-wrap items-center gap-1.5">
            {t("host.info.owner")}
            <span className="text-muted">{owner ? ownerName(owner, t("host.own.someone")) : o.capability === false ? t("host.info.ownerUnknown") : t("host.info.ownerNone")}</span>
            {o.mine === true && <span className="rounded bg-accent/15 px-1.5 text-[10px] text-accent">{t("host.info.you")}</span>}
            {owner?.confirmed && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-ok-text">
                <ShieldCheck size={11} />
                {t("host.info.confirmed")}
              </span>
            )}
            {owner && !owner.confirmed && <span className="text-[11px] text-warn-text">{t("host.info.unconfirmed")}</span>}
          </span>
        }
        hint={owner?.fingerprint ? <span className="font-mono">{owner.fingerprint.match(/.{1,4}/g)!.join(" ")}</span> : undefined}
      >
        {action}
      </SettingRow>
      <SettingRow label={t("host.info.version")}>
        <span className="font-mono text-xs text-muted">{version ?? "—"}</span>
      </SettingRow>
      <SettingRow label={t("host.info.system")}>
        <span className="text-xs text-muted">{system ?? "—"}</span>
      </SettingRow>
    </Section>
  );
}

export function HostRightsSection({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const o = useHostOwnership(hostId);
  const look = useHostScope().host(hostId);
  const notify = useApp((s) => s.notify);
  const openSettings = useApp((s) => s.openSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SshErrorView | null>(null);
  const label = look?.view.label ?? hostId;
  const role = roleKey(o);
  const full = o.role === "owner" || o.role === "older";
  const via = o.connection === "local" ? t("host.rights.via.local") : o.connection === "ssh" ? t("host.rights.via.ssh", { target: o.sshTarget ?? label }) : o.connection === "dev" ? t("host.own.how.dev") : t("host.rights.via.token");
  const paired = look?.view.kind !== "ssh" || !!look.view.paired;
  const switchTo = async () => {
    const next = o.connectAs === "owner" ? "member" : "owner";
    setBusy(true);
    setError(null);
    try {
      const r = await api.setSshConnectAs(hostId, next);
      if (!r.ok) setError(r.error);
      else notify(connectResultText(t, r, label) ?? t(next === "member" ? "host.own.nowMember" : "host.own.nowOwner", { host: label }));
    } catch (e) {
      setError({ code: "exited", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  // A paired device of the owner has full control too (host-ownership §5), but root-identity actions stay on
  // this machine / SSH; cutex says which (user.ownerLocal; absent on an older cutex: by the connection kind).
  const access = useHostAccess(hostId);
  const scope = deviceScopeOf(access);
  const narrowed = !!scope && scope !== "full";
  const pairedOwner = access.ownerLocal === false || (access.ownerLocal === undefined && o.connection === "paired");
  const hint = narrowed
    ? t("host.rights.narrowed", { scope: scopeLabel(t, scope!, full) })
    : full
      ? pairedOwner ? t("host.rights.fullToken") : o.connection === "local" ? t("host.rights.fullLocal") : t("host.rights.full", { via })
      : t("host.rights.other", { via });
  return (
    <Section id={settingsAnchorId("hostRights")} title={t("host.rights.title")} hint={t("host.rights.hint")} source="host">
      <SettingRow label={narrowed ? scopeLabel(t, scope!, full) : role ? t(role as MessageKey) : t("host.rights.unknown")} hint={hint}>
        <span className="flex flex-wrap justify-end gap-1.5">
          {o.connection === "ssh" && paired && (
            <Button disabled={busy} onClick={() => void switchTo()}>
              {busy ? t("host.own.switching") : t(o.connectAs === "owner" ? "host.own.toMember" : "host.own.toOwner")}
            </Button>
          )}
          {full && <Button onClick={() => openSettings("users")}>{t("host.rights.manageUsers")}</Button>}
        </span>
      </SettingRow>
      {o.ownerRightsOnly && <p className="py-2 text-xs text-subtle">{t("host.rights.notOwner", { owner: ownerName(o.owner, t("host.own.someone")) })}</p>}
      {o.connection === "ssh" && o.connectAs === "member" && <p className="py-2 text-xs text-subtle">{t("host.own.memberNote")}</p>}
      {error && <ProblemText error={error} />}
    </Section>
  );
}
