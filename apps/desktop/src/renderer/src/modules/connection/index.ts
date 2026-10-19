// Core connection module: Settings → 设备管理 (formerly 主机: my hosts / hosts I can access, add, groups,
// startup host, diagnostics). Access to a host (users, devices, peers, ways in) is Settings → 访问管理.
import { Server } from "lucide-react";
import { HostsPage } from "../../components/settings/ConnectionSettings";
import { defineModule } from "../slots";

export default defineModule({
  id: "connection",
  titleKey: "connection.title",
  descriptionKey: "connection.description",
  required: true,
  contributes: {
    "settings.page": [{ id: "connection.hosts", page: "hosts", group: "connection", order: 100, icon: Server, titleKey: "connection.page", source: "local", hintKey: "connection.pageHint", Page: HostsPage, keywords: ["host.list"], sections: [{ anchor: "hostList", titleKey: "connection.mine", keywords: ["host.color", "host.autoConnect", "connection.thisDevice"] }, { anchor: "hostOthers", titleKey: "connection.others", keywords: ["connection.member"] }, { anchor: "hostAdd", titleKey: "connection.add", keywords: ["titlebar.addSsh", "host.add.target", "host.add.port", "host.add.cutexPath"] }, { anchor: "hostGroups", titleKey: "hostGroups.title", keywords: ["hostGroups.new", "hostGroups.members", "hostGroups.color", "hostSwitcher.groups"] }, { anchor: "hostStartup", titleKey: "host.startup", keywords: ["host.startOn", "host.marksSingle", "host.markLocal"] }, { anchor: "diagnostics", titleKey: "connection.diagnostics", keywords: ["host.daemonHostId", "connection.features"] }] }],
  },
});
