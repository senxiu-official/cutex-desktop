// Core connection module: Settings → 主机 (host list with the active connection, startup host,
// diagnostics). 远程访问 is its own page from the remote-access module.
import { Server } from "lucide-react";
import { HostsPage } from "../../components/settings/ConnectionSettings";
import { defineModule } from "../slots";

export default defineModule({
  id: "connection",
  titleKey: "connection.title",
  descriptionKey: "connection.description",
  required: true,
  contributes: {
    "settings.page": [{ id: "connection.hosts", page: "hosts", group: "connection", order: 100, icon: Server, titleKey: "connection.page", source: "local", Page: HostsPage, sections: [{ anchor: "hostList", titleKey: "host.list", keywords: ["titlebar.addSsh", "host.add.target", "host.add.port", "host.add.cutexPath", "host.color", "host.autoConnect"] }, { anchor: "hostGroups", titleKey: "hostGroups.title", keywords: ["hostGroups.new", "hostGroups.members", "hostGroups.color", "hostSwitcher.groups"] }, { anchor: "hostStartup", titleKey: "host.startup", keywords: ["host.startOn", "host.marksSingle", "host.markLocal"] }, { anchor: "diagnostics", titleKey: "connection.diagnostics", keywords: ["host.daemonHostId", "connection.features"] }] }],
  },
});
