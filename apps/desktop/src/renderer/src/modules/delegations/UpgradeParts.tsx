import type { UpgradeTreeParty } from "./upgradeTypes";
import { useI18n } from "../../i18n";
// Small pieces shared by the delegation-upgrade surfaces (tree rows, members, the archive dialog).
import { Avatar } from "../../components/Avatar";
import { agentIndex } from "../../lib/agentLook";
import { useApp } from "../../store";

/** An agent's avatar (its stored picture when the store knows it), drawn like the 委托 list's parties. */
export function AgentAvatar({ id, name, size = 16 }: { id: string; name: string; size?: number }) {
  const avatar = useApp((s) => agentIndex(s).get(id)?.session.avatar ?? null);
  return <Avatar name={name} avatar={avatar} seed={id} size={size} />;
}

/** An agent as [avatar] name; plain text (no link), `title` = name and host. */
export function Party({ id, hostId, name }: { id: string; hostId: string; name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1" title={`${name}\n${hostId}`}>
      <AgentAvatar id={id} name={name} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function TreeParty({ party }: { party: UpgradeTreeParty | null }) {
  const { t } = useI18n();
  if (party && "id" in party) return <Party {...party} />;
  return <span className="truncate">{t(!party || party.kind === "owner" ? "delegations.upgrade.tree.owner" : "delegations.upgrade.routing.actorRedacted")}</span>;
}
