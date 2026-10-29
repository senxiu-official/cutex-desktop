import { Link2 } from "lucide-react";
import type { ProfileItem } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { useProfileAccountLinks } from "../lib/profileAccountLinks";
import { useProfileLinkAppearance } from "../lib/profileLinkAppearance";
import { useHostScope } from "../lib/useHostScope";

/** 「同一账号 · X 也在用」 (042 profile-link): on the Profile card and page and 用量 only — never in the input area (owner 2026-10-25). */
export function ProfileAccountBadge({ hostId, profile }: { hostId: string; profile: ProfileItem | string }) {
  const { self, peers } = useProfileAccountLinks(hostId, profile);
  const scope = useHostScope();
  if (!peers.length) return null;
  return typeof profile === "string" ? <Badge hostId={hostId} self={self} peers={peers} scope={scope} sync={null} /> : <LinkedBadge hostId={hostId} profile={profile} self={self} peers={peers} scope={scope} />;
}

type Links = ReturnType<typeof useProfileAccountLinks>;
type BadgeProps = { hostId: string; self: Links["self"]; peers: Links["peers"]; scope: ReturnType<typeof useHostScope> };

/** With the Profile itself: its appearance sync state joins the tooltip (外观已同步 · …), no row of its own. */
function LinkedBadge({ hostId, profile, ...rest }: BadgeProps & { profile: ProfileItem }) {
  const { t } = useI18n();
  const state = useProfileLinkAppearance(hostId, rest.self?.profile ?? profile);
  const others = state.members.filter((m) => m.hostId !== hostId).map((m) => m.hostName);
  const kind = state.notice?.kind;
  const sync = !state.linked || !others.length ? null : state.conflict || kind === "newerChange" ? t("settings.profile.link.appearance.conflict")
    : kind === "pending" || kind === "error" || kind === "storageError" ? t(`settings.profile.link.appearance.${kind}`, { hosts: (state.notice?.hosts.length ? state.notice.hosts : others).join(", ") })
    : t("settings.profile.link.appearance.inSync", { hosts: [...new Set(others)].join(", ") });
  return <Badge hostId={hostId} {...rest} sync={sync} />;
}

function Badge({ self, peers, scope, sync }: BadgeProps & { sync: string | null }) {
  const { t } = useI18n();
  const hosts = [...new Set(peers.map((ref) => ref.hostName))].join(", ");
  const details = [self, ...peers].filter((ref) => !!ref).map((ref) => `${ref.hostName} · ${ref.profile.name}`).join(" / ");
  return <span data-profile-account-link className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-subtle" title={[`${details} · ${t(self?.profile.link?.source === "manual" ? "settings.profile.link.manual" : "settings.profile.link.auto")}`, sync].filter(Boolean).join("\n")}>
    <Link2 size={12} className="shrink-0" />
    <span aria-hidden className="flex shrink-0 gap-0.5">{[...new Set(peers.map((ref) => ref.hostId))].slice(0, 4).map((id) => <span key={id} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: scope.host(id)?.color ?? "currentColor" }} />)}</span>
    <span className="truncate">{t("settings.profile.link.alsoUsed", { hosts })}</span>
  </span>;
}
