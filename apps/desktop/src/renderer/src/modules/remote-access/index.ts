// 接入 (cutex listen-settings / device-pairing): Settings → 访问管理 → 接入方式 (formerly its own page 接入,
// folded into 访问管理 in the 连接 restructure 2026-10-19 — old `openSettings("remote")` links land there)
// with listen addresses, CORS (the same listener, so right after it) and device pairing as sections. A
// cutex without the capability gets 「需要升级 cutex」 instead (CORS just hides). On 用户: 在线的桌面
// (client-remote-close; hidden on an older cutex) before 配对设备.
import { CorsSection, PairingSection, RemoteAccessSection } from "../../components/settings/RemoteAccess";
import { OnlineDesktopsSection } from "../../components/settings/OnlineDesktops";
import { LISTEN_FEATURE, PAIRING_FEATURE } from "../../lib/remoteAccess";
import { ONLINE_DESKTOPS_ANCHOR } from "../../lib/remoteClose";
import { REMOTE_CLOSE_FEATURE } from "../../../../shared/remoteClose";
import { defineModule } from "../slots";

export default defineModule({
  id: "remote-access",
  titleKey: "remote-access.title",
  descriptionKey: "remote-access.description",
  contributes: {
    "settings.section": [
      { id: "remote-access.listen", page: "access", order: 300, requires: { capabilities: [LISTEN_FEATURE] }, unavailable: "notice", titleKey: "remote.title", keywords: ["remote.addAddress"], Section: RemoteAccessSection },
      { id: "remote-access.cors", page: "access", order: 310, requires: { capabilities: [LISTEN_FEATURE] }, titleKey: "remote.cors.title", keywords: ["remote.cors.add"], Section: CorsSection },
      // client-remote-close: the cutex desktops registered on the host, 「关闭」 for each (after 已登录设备, 110).
      {
        id: "remote-access.onlineDesktops",
        page: "users",
        order: 115,
        requires: { capabilities: [REMOTE_CLOSE_FEATURE] },
        titleKey: "remoteClose.list",
        sections: [{ anchor: ONLINE_DESKTOPS_ANCHOR, titleKey: "remoteClose.list", keywords: ["remoteClose.close", "remoteClose.thisComputer", "remoteClose.listHint"] }],
        Section: OnlineDesktopsSection,
      },
      { id: "remote-access.pairing", page: "users", order: 120, requires: { capabilities: [PAIRING_FEATURE] }, unavailable: "notice", titleKey: "remote.pair.title", keywords: ["remote.pair.label", "remote.pair.devicesInUsers"], Section: PairingSection },
    ],
  },
});
