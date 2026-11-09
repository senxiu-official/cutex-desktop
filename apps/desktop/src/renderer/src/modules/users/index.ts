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
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const UsersPeoplePart = lazyPage(() => import("./UsersPage").then((m) => m.UsersPeoplePart));
const UsersDevicesPart = lazyPage(() => import("./UsersPage").then((m) => m.UsersDevicesPart));
const UsersAllDevicesPart = lazyPage(() => import("./UsersPage").then((m) => m.UsersAllDevicesPart));
const UsersPeersPart = lazyPage(() => import("./UsersPage").then((m) => m.UsersPeersPart));

export default defineModule({
  id: "users",
  titleKey: "users.title",
  descriptionKey: "users.description",
  requires: { capabilities: [USERS_FEATURE] },
  contributes: {
    // Before 设置 (500): who sees the project, beside its members.
    "project.tab": [{ id: "users.projectTab", tab: "users", order: 450, titleKey: "users.project.tab", Body: ProjectUsersTab }],
    // The 访问管理 page is the shell's (a member sees their own part there); this module adds the owner's
    // management as three of its parts: 人, 设备 and, with peers, 别的主机 → 对端主机. One `/v2/users` read
    // (UsersPeoplePart) feeds all three.
    "settings.section": [
      {
        id: "users.people",
        page: "access",
        order: 100,
        titleKey: "users.list",
        sections: [{ anchor: USERS_ANCHOR, titleKey: "users.list", keywords: ["users.grant", "users.alias", "users.add", "users.selfName", "users.person.title"] }],
        Section: UsersPeoplePart,
      },
      {
        id: "users.devices",
        page: "access",
        order: 110,
        titleKey: "users.devices",
        sections: [{ anchor: DEVICES_ANCHOR, titleKey: "users.devices", keywords: ["users.devices.hint", "users.devices.pendingChip", "users.devices.pair", "users.ownerRequiresApproval", "users.revoke"] }],
        Section: UsersDevicesPart,
      },
      // 全部设备: the whole list, on the host page's sub-page.
      {
        id: "users.allDevices",
        page: "access",
        order: 111,
        titleKey: "shell.access.sub.devices",
        sections: [{ anchor: "users-all-devices", titleKey: "shell.access.sub.devices" }],
        Section: UsersAllDevicesPart,
      },
      {
        id: "users.peers",
        page: "access",
        // After 互联's own cards (peers.access, 200): which user each linked host belongs to.
        order: 250,
        titleKey: "users.peers",
        requires: { capabilities: [PEERS_FEATURE] },
        sections: [{ anchor: PEERS_ANCHOR, titleKey: "users.peers", keywords: ["users.peers.hint", "users.peers.manage"] }],
        Section: UsersPeersPart,
      },
    ],
  },
});
