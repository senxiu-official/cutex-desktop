// Settings → 用户 → 对端主机 (docs/research/identity-settings-review-20261015.md §4.2): every cutex host
// paired through 互联 (cutex `peers-v2`), flat, with the user it belongs to — its delegations run with
// that user's grant (a select rebinds it: `PUT /v2/users/peer-bindings/{id}`). Pairing, policy and
// removal stay on 互联 (linked). Only on a host with `peers-v2`. A user's 「1 个对端主机」 narrows it to
// that user (显示全部 widens it again).
import { useState } from "react";
import { Network } from "lucide-react";
import type { UsersList } from "../../../../shared/users";
import { EmptyState, ErrorNote, ListRow, Section, Select, TextLink } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi } from "../../lib/targetHost";
import { useApp } from "../../store";
import { PEERS_ANCHOR, userOptions, type Write } from "./shared";

/** cutex peer states with words (the 互联 module's `peers.state.*`). */
const PEER_STATES: ReadonlySet<string> = new Set(["pending", "online", "unreachable", "credentialRejected", "identityChanged", "versionMismatch", "disabled", "removedByPeer"]);

export function PeersSection({ list, write, userId, onAll }: { list: UsersList; write: Write; userId: string | null; onAll(): void }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const [error, setError] = useState<string | null>(null);
  const users = userOptions(list.users);
  const openPeers = () => useApp.getState().openSettings("peers");
  const peers = userId ? list.peers.filter((p) => p.userId === userId) : list.peers;
  return (
    <Section id={settingsAnchorId(PEERS_ANCHOR)} title={t("users.peers")} hint={t("users.peers.hint")} actions={
        <>
          {userId && (
            <button type="button" className="text-xs text-accent hover:underline" onClick={onAll}>
              {t("users.peers.showAll")}
            </button>
          )}
          <TextLink onClick={openPeers}>{t("users.peers.manage")}</TextLink>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      {peers.length === 0 && <EmptyState>{t("users.noPeers")}</EmptyState>}
      {peers.map((peer) => (
        <ListRow
          key={peer.peerId}
          leading={<Network size={15} className="shrink-0 text-subtle" />}
          title={peer.label}
          detail={`${peer.hostId} · ${PEER_STATES.has(peer.status) ? t(`peers.state.${peer.status}` as MessageKey) : peer.status}`}
          actions={<Select<string> value={peer.userId} options={users} label={t("users.rebind")} width="w-36" onChange={(to) => void write(() => api.bindUserPeer(peer.peerId, to), setError)} />}
        />
      ))}
    </Section>
  );
}
