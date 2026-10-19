// 互联 (cutex peers-v2, P0.1): Settings → 访问管理 → 别的主机 (host-scoped; formerly its own page 互联,
// folded into 访问管理 in the 连接 restructure 2026-10-19 — old `openSettings("peers")` links land there)
// — global peer settings, invite / join, the peer list and one peer's detail (policy, remote agents,
// audit, delete). The delegation side (peer requesters, mirror sync state, late answers, hops) is core
// (lib/delegations, components/Delegation*), since delegations are shown without this module too.
// Hidden on a cutex without `peers-v2`. P1 (docs/handoff/gpt-accounts.md) moves exports / accept /
// review onto per-user grants; the policy editor is one component so it can be swapped for the user's grant then.
import { PEERS_FEATURE } from "../../../../shared/peers";
import { defineModule } from "../slots";
import { PeersPage } from "./PeersPage";

export default defineModule({
  id: "peers",
  titleKey: "peers.title",
  descriptionKey: "peers.description",
  requires: { capabilities: [PEERS_FEATURE] },
  contributes: {
    "settings.section": [
      {
        id: "peers.access",
        page: "access",
        order: 200,
        titleKey: "peers.title",
        keywords: ["peers.policy.exports", "peers.policy.review", "peers.audit"],
        sections: [
          { anchor: "peers-settings", titleKey: "peers.settings", keywords: ["peers.enabled", "peers.maxHops"] },
          { anchor: "peers-pair", titleKey: "peers.pair", keywords: ["peers.invite", "peers.join"] },
          { anchor: "peers-list", titleKey: "peers.list" },
        ],
        Section: PeersPage,
      },
    ],
  },
});
