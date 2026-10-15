// 接入 (cutex listen-settings / device-pairing): its own page Settings → 接入 (group 连接, after 用户) with
// listen addresses, CORS (the same listener, so right after it) and device pairing as sections. 互联
// (module peers) is its own page; the old link row at the end was dropped (settings audit 2026-10-15 #59). A cutex without the capability gets 「需要升级 cutex」 instead (CORS just hides).
import { MonitorSmartphone } from "lucide-react";
import { CorsSection, PairingSection, RemoteAccessPage, RemoteAccessSection } from "../../components/settings/RemoteAccess";
import { LISTEN_FEATURE, PAIRING_FEATURE } from "../../lib/remoteAccess";
import { defineModule } from "../slots";

export default defineModule({
  id: "remote-access",
  titleKey: "remote-access.title",
  descriptionKey: "remote-access.description",
  contributes: {
    "settings.page": [{ id: "remote-access.page", page: "remote", group: "connection", order: 260, icon: MonitorSmartphone, titleKey: "remote-access.title", source: "host", Page: RemoteAccessPage }],
    "settings.section": [
      { id: "remote-access.listen", page: "remote", order: 100, requires: { capabilities: [LISTEN_FEATURE] }, unavailable: "notice", titleKey: "remote.title", keywords: ["remote.addAddress"], Section: RemoteAccessSection },
      { id: "remote-access.pairing", page: "remote", order: 200, requires: { capabilities: [PAIRING_FEATURE] }, unavailable: "notice", titleKey: "remote.pair.title", keywords: ["remote.pair.label", "remote.pair.devicesInUsers"], Section: PairingSection },
      { id: "remote-access.cors", page: "remote", order: 150, requires: { capabilities: [LISTEN_FEATURE] }, titleKey: "remote.cors.title", keywords: ["remote.cors.add"], Section: CorsSection },
    ],
  },
});
