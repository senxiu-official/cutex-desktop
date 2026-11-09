// Core connection module: Settings → 主机: the list of hosts, add, groups, startup. One host's own page (its
// connection, users, devices, peers, ways in) opens from a row (shell.access).
import { Server } from "lucide-react";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";
import { useOwnerDevicesNavBadge } from "../../components/settings/OwnerDevices";

// Loaded on first open (lib/lazyPage).
const HostsPage = lazyPage(() => import("../../components/settings/ConnectionSettings").then((m) => m.HostsPage));

export default defineModule({
  id: "connection",
  titleKey: "connection.title",
  descriptionKey: "connection.description",
  required: true,
  contributes: {
    "settings.page": [{ id: "connection.hosts", page: "hosts", group: "connection", order: 100, icon: Server, titleKey: "connection.page", source: "local", hintKey: "settings.pageHint.hosts", useBadge: useOwnerDevicesNavBadge, Page: HostsPage, keywords: ["host.list"], sections: [{ anchor: "hostList", titleKey: "connection.page", keywords: ["host.color", "host.autoConnect", "connection.thisDevice", "connection.member"] }, { anchor: "hostAdd", titleKey: "connection.add", keywords: ["titlebar.addSsh", "host.add.target", "host.add.port", "host.add.cutexPath"] }, { anchor: "hostGroups", titleKey: "hostGroups.title", keywords: ["hostGroups.new", "hostGroups.members", "hostGroups.color", "hostSwitcher.groups"] }, { anchor: "hostStartup", titleKey: "host.startup", keywords: ["host.startOn", "host.marksSingle", "host.markLocal"] }] }],
  },
});
