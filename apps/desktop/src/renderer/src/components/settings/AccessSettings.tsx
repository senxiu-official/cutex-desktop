// One host's page (page "access", 混合设置; owner 2026-11-07: one 主机 entry, the list is page "hosts"): the host
// picked in Settings, named by the heading.
// - 这台电脑如何连接 (本机): the full host row (ConnectionSettings HostConnectionSection). Outside the host
//   frame: it works while the host is offline (that is when you connect / re-pair it).
// - The host's users and devices: other modules' `settings.section` items on page "access" (users,
//   remote-access). With full control only; otherwise your own user there (components/settings/MeOnHost).
// - 跨机协作 (peers, users.peers) and 高级 (主机信息, 你的权限, listen / CORS, 诊断) are sub-pages;
//   全部设备 too. Owner and permissions are kept apart.
import type { ReactNode } from "react";
import { useApp } from "../../store";
import { useSlot } from "../../modules/react";
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
import { Diagnostics, HostConnectionSection, ownerName } from "./ConnectionSettings";
import { EmptyState, PartSource, Section, SubPageRow } from "./Form";
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
  return (
    <SettingsHostFrame key={hostId} target={target}>
      <PartSource   picker={picker}>
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

const PEERS_SECTIONS = ["peers.access", "users.peers"];
const ADVANCED_SECTIONS = ["remote-access.listen", "remote-access.cors"];
const ALL_DEVICES_SECTIONS = ["users.allDevices"];
const NOT_ON_THE_PAGE = [...PEERS_SECTIONS, ...ADVANCED_SECTIONS, ...ALL_DEVICES_SECTIONS];

export function AccessPage() {
  const { t } = useI18n();
  // Old links and settings search scroll to a card.
  useScrollToSettingsAnchor();
  const openSettings = useApp((s) => s.openSettings);
  const target = useSettingsTarget();
  const hostId = target.hostId;
  const access = useHostAccess(hostId);
  const o = useHostOwnership(hostId);
  const host = useHostScope().host(hostId)?.label ?? hostId;
  const peers = useSlot("settings.section").some((e) => e.item.id === "peers.access" && e.mode === "show");
  return (
    <>
      <HostConnectionSection hostId={hostId} />
      <HostCards hostId={hostId}>
        {/* New owner devices (full control): announced on top until acknowledged. */}
        <OwnerDevicesBanner hostId={hostId} />
        {access.isOwner ? (
          <>
            {o.ownerRightsOnly && <div className="mb-6 rounded-xl border border-border bg-surface-2/50 px-4 py-3 text-sm text-muted">{t("shell.users.notOwner", { host, owner: ownerName(o.owner, t("host.own.ownerFallback")) })}</div>}
            <SettingsSections page="access" except={NOT_ON_THE_PAGE} />
          </>
        ) : (
          <>
            <ManagedBy hostId={hostId} what="users" />
            <MeHereSection hostId={hostId} />
            {!access.pending && <OwnDevicesSection hostId={hostId} />}
          </>
        )}
      </HostCards>
      <Section>
        {access.isOwner && peers && <SubPageRow title={t("shell.access.sub.peers")} summary={t("shell.access.sub.peersSummary")} onOpen={() => openSettings("access", { sub: "peers" })} />}
        <SubPageRow title={t("shell.access.sub.advanced")} summary={t("shell.access.sub.advancedSummary")} onOpen={() => openSettings("access", { sub: "advanced" })} />
      </Section>
    </>
  );
}

/** 跨机协作: the linked hosts and which user each belongs to. */
export function PeersSubPage() {
  useScrollToSettingsAnchor();
  const hostId = useSettingsTarget().hostId;
  const access = useHostAccess(hostId);
  return <HostCards hostId={hostId}>{access.isOwner ? <SettingsSections page="access" only={PEERS_SECTIONS} /> : <ManagedBy hostId={hostId} what="hosts" />}</HostCards>;
}

/** 高级: whose host it is and what you can do there, its listen addresses and origins, diagnostics. */
export function AdvancedSubPage() {
  useScrollToSettingsAnchor();
  const hostId = useSettingsTarget().hostId;
  const access = useHostAccess(hostId);
  const picker = useHostTagPicker(hostId);
  return (
    <>
      <PartSource picker={picker}>
        <HostInfoSection hostId={hostId} />
        <HostRightsSection hostId={hostId} />
      </PartSource>
      <HostCards hostId={hostId}>
        {access.isOwner && <SettingsSections page="access" only={ADVANCED_SECTIONS} />}
        <Diagnostics />
      </HostCards>
    </>
  );
}

/** 全部设备: every device of the host, with the user filter. */
export function DevicesSubPage() {
  const hostId = useSettingsTarget().hostId;
  return <HostCards hostId={hostId}><SettingsSections page="access" only={ALL_DEVICES_SECTIONS} /></HostCards>;
}
