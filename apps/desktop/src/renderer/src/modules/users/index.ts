// 用户 (cutex `users`, P1 users and grants; docs/research/user-isolation-p1-20261014.md §9): the
// management part of Settings → 用户 (the page is the shell's, with 「你」 on top; host-scoped, owner
// only): users (with the name / avatar each set on their own desktop) and their grants, each device's and peer's user,
// pending devices, the pairing switch. The rest of the P1 desktop side is core, since it applies with
// this module off too: lib/hostAccess (who this device is per host), shared/users hostFeatureSet (a
// non-owner connection loses the owner-only capabilities, so their modules and entries hide), the
// restricted agent / project menus, the read-only composer, components/AccessNotices, lib/actingUsers.
// `users` itself is owner-only: this module is unavailable on a host where this device is not the owner.
// 项目页 → 可见用户 (`project.tab`, ProjectUsersTab): the same grants seen from one project (a switch per
// non-owner user), on the project's own host.
import { PEERS_FEATURE } from "../../../../shared/peers";
import { USERS_FEATURE } from "../../../../shared/users";
import { defineModule } from "../slots";
import { ProjectUsersTab } from "./ProjectUsersTab";
import { DEVICES_ANCHOR, PEERS_ANCHOR, USERS_ANCHOR } from "./shared";
import { UsersPage } from "./UsersPage";

export default defineModule({
  id: "users",
  titleKey: "users.title",
  descriptionKey: "users.description",
  requires: { capabilities: [USERS_FEATURE] },
  contributes: {
    // Before 设置 (500): who sees the project, beside its members.
    "project.tab": [{ id: "users.projectTab", tab: "users", order: 450, titleKey: "users.project.tab", Body: ProjectUsersTab }],
    // The 用户 page itself is the shell's (「你」 shows for every connection); this module adds the
    // owner's management under it.
    "settings.section": [
      {
        id: "users.manage",
        page: "users",
        order: 100,
        titleKey: "users.list",
        // Settings search finds its three cards (UsersPage, DevicesSection, PeersSection) rather than the whole section.
        sections: [
          { anchor: USERS_ANCHOR, titleKey: "users.list", keywords: ["users.grant", "users.alias", "users.add", "users.selfName", "users.person.title"] },
          { anchor: DEVICES_ANCHOR, titleKey: "users.devices", keywords: ["users.devices.hint", "users.devices.pendingChip", "users.devices.pair", "users.ownerRequiresApproval", "users.revoke"] },
          { anchor: PEERS_ANCHOR, titleKey: "users.peers", keywords: ["users.peers.hint", "users.peers.manage"], requires: { capabilities: [PEERS_FEATURE] } },
        ],
        Section: UsersPage,
      },
    ],
  },
});
