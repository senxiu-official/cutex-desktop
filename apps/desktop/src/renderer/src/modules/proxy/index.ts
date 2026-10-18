// 网络代理 (owner-approved proxy v1, docs/research/proxy-support-20261017.md): Settings → 连接 → 网络代理
// with this desktop's update proxy (本机) and the picked host's cutex proxy (cutex `proxy-modes`) side by
// side (Q8: separate settings, never synced). A Profile's own proxy is a card in the Profile editor
// (components/settings/ProfileProxy.tsx, cutex `profile-proxy`). A cutex without `proxy-modes` shows
// 「需要升级 cutex」 for the host card; the desktop card always works.
import { Network } from "lucide-react";
import { PROXY_MODES_FEATURE } from "../../../../shared/proxy";
import { defineModule } from "../slots";
import { HostProxySection, ProxyPage, UpdateProxySection } from "./ProxySections";

export default defineModule({
  id: "proxy",
  titleKey: "proxy.title",
  descriptionKey: "proxy.description",
  contributes: {
    "settings.page": [{ id: "proxy.page", page: "proxy", group: "connection", order: 270, icon: Network, titleKey: "proxy.page", source: null, hintKey: "proxy.pageHint", Page: ProxyPage }],
    "settings.section": [
      { id: "proxy.update", page: "proxy", order: 100, titleKey: "proxy.update.title", keywords: ["proxy.mode.system", "proxy.mode.manual", "proxy.url"], Section: UpdateProxySection },
      { id: "proxy.host", page: "proxy", order: 200, requires: { capabilities: [PROXY_MODES_FEATURE] }, unavailable: "notice", titleKey: "proxy.host.title", keywords: ["proxy.noProxy", "proxy.mode.none"], Section: HostProxySection },
    ],
  },
});
