// 互联 (cutex peers-v2, P0.1): its own page Settings → 互联 (group 连接 right after 接入, host-scoped;
// settings audit 2026-10-15, lead decision 3; 接入 ends with a row linking here) — global peer settings,
// invite / join, the peer list and one peer's detail (policy, remote agents, audit, delete). The
// delegation side (peer requesters, mirror sync state, late answers, hops) is core (lib/delegations,
// components/Delegation*), since delegations are shown without this module too. Hidden on a cutex
// without `peers-v2`. P1 (docs/handoff/gpt-accounts.md) moves exports / accept / review onto per-user
// grants; the policy editor is one component so it can be swapped for the user's grant then.
import { Network } from "lucide-react";
import { PEERS_FEATURE } from "../../../../shared/peers";
import { defineModule } from "../slots";
import { PeersPage } from "./PeersPage";

export default defineModule({
  id: "peers",
  titleKey: "peers.title",
  descriptionKey: "peers.description",
  requires: { capabilities: [PEERS_FEATURE] },
  contributes: {
    "settings.page": [
      {
        id: "peers.page",
        page: "peers",
        group: "connection",
        order: 270,
        icon: Network,
        titleKey: "peers.title",
        source: "host",
        Page: PeersPage,
        keywords: ["peers.policy.exports", "peers.policy.review", "peers.audit"],
        sections: [
          { anchor: "peers-settings", titleKey: "peers.settings", keywords: ["peers.enabled", "peers.maxHops"] },
          { anchor: "peers-pair", titleKey: "peers.pair", keywords: ["peers.invite", "peers.join"] },
          { anchor: "peers-list", titleKey: "peers.list" },
        ],
      },
    ],
  },
});
