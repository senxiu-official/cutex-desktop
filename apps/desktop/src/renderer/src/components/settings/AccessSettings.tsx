// Settings → 主机 and 用户 (连接 D plan, owner 2026-10-19): the basic unit is one host — the one picked in
// Settings (the header names it, with the picker); 主机列表 (page "hosts") is the desktop's own list.
// 主机 (page "access", 混合设置):
// - 主机信息 and 你的权限 (components/settings/HostSections): who the host belongs to, its version and
//   system; what you can do there and where that comes from. Owner and permissions are kept apart.
// - 本地桌面应用连接 (本机): how this computer connects to the host — the full host row
//   (ConnectionSettings HostConnectionSection). Outside the host frame: it works while the host is
//   offline (that is when you connect / re-pair it).
// - 主机互联 and the listen / CORS cards: other modules' `settings.section` items on page "access"
//   (peers, users.peers, remote-access). With full control only; otherwise one line says who manages it.
// 用户 (page "users", cutex 后端): the host's users with their grants and login devices, pending devices
// and the pairing code (users, remote-access.pairing). With full control only; otherwise your own user
// there (components/settings/MeOnHost). No part headings: every card has its own title.
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { useHostAccess } from "../../lib/hostAccess";
import { useHostOwnership } from "../../lib/hostOwnership";
import { hostPickerMode } from "../../lib/hostPick";
import { setSettingsHost, useSettingsTarget } from "../../lib/settingsHost";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";
import { useHostScope } from "../../lib/useHostScope";
import { SettingsSections } from "../../modules/Outlet";
import { HostPicker } from "../HostPicker";
import { SettingsHostFrame } from "../SettingsHostFrame";
import { HostConnectionSection, ownerName } from "./ConnectionSettings";
import { EmptyState, PartSource, Section, useReportsHost } from "./Form";
import { HostInfoSection, HostRightsSection } from "./HostSections";
import { MeHereSection, OwnDevicesSection } from "./MeOnHost";
import { OwnerDevicesBanner } from "./OwnerDevices";

/** The tag picker of the host cards: 「cutex 后端 · HOST ▾」. */
function useHostTagPicker(hostId: string): ReactNode {
  const { t } = useI18n();
  const scope = useHostScope();
  const mode = hostPickerMode(scope, hostId);
  return <HostPicker chip value={hostId} onChange={(id) => setSettingsHost(id)} mode={mode === "none" ? "label" : mode} title={t("hostPicker.settingsTitle")} />;
}

/** Host cards that read through the host's API: on the Settings host (offline frame), each tagged. */
function HostCards({ hostId, children }: { hostId: string; children: ReactNode }) {
  const target = useSettingsTarget();
  const picker = useHostTagPicker(hostId);
  // The 混合设置 header names (and picks) the host these cards show.
  useReportsHost();
  return (
    <SettingsHostFrame key={hostId} target={target}>
      <PartSource source="host" cards picker={picker}>
        {children}
      </PartSource>
    </SettingsHostFrame>
  );
}

/** With full control there: manage it; otherwise one card saying who does. */
function ManagedBy({ hostId, what }: { hostId: string; what: "hosts" | "users" }) {
  const { t } = useI18n();
  const o = useHostOwnership(hostId);
  const access = useHostAccess(hostId);
  const host = useHostScope().host(hostId)?.label ?? hostId;
  const owner = ownerName(o.owner, t("host.own.ownerFallback"));
  return (
    <Section title={t(what === "hosts" ? "shell.access.peersTitle" : "shell.users.title")}>
      <EmptyState>{access.pending ? t("users.access.pendingSettings", { host }) : t(what === "hosts" ? "shell.access.managedBy" : "shell.users.managedBy", { owner })}</EmptyState>
    </Section>
  );
}

export function AccessPage() {
  // Old links (openSettings("peers") …) and settings search scroll to a card.
  useScrollToSettingsAnchor();
  const hostId = useSettingsTarget().hostId;
  const access = useHostAccess(hostId);
  const picker = useHostTagPicker(hostId);
  return (
    <>
      <PartSource source="host" cards picker={picker}>
        <HostInfoSection hostId={hostId} />
        <HostRightsSection hostId={hostId} />
      </PartSource>
      <HostConnectionSection hostId={hostId} />
      <HostCards hostId={hostId}>{access.isOwner ? <SettingsSections page="access" /> : <ManagedBy hostId={hostId} what="hosts" />}</HostCards>
    </>
  );
}

export function UsersHostPage() {
  const { t } = useI18n();
  useScrollToSettingsAnchor();
  const target = useSettingsTarget();
  const hostId = target.hostId;
  const access = useHostAccess(hostId);
  const o = useHostOwnership(hostId);
  const host = useHostScope().host(hostId)?.label ?? hostId;
  // One place (cutex 后端 · HOST in the header): the cards carry no tags of their own.
  return (
    <SettingsHostFrame key={hostId} target={target}>
      {/* New owner devices (full control): announced on top until acknowledged. */}
      <OwnerDevicesBanner hostId={hostId} />
      {access.isOwner ? (
        <>
          {o.ownerRightsOnly && <div className="mb-6 rounded-xl border border-border bg-surface-2/50 px-4 py-3 text-sm text-muted">{t("shell.users.notOwner", { host, owner: ownerName(o.owner, t("host.own.ownerFallback")) })}</div>}
          <SettingsSections page="users" />
        </>
      ) : (
        <>
          <ManagedBy hostId={hostId} what="users" />
          <MeHereSection hostId={hostId} />
          {!access.pending && <OwnDevicesSection hostId={hostId} />}
        </>
      )}
    </SettingsHostFrame>
  );
}
