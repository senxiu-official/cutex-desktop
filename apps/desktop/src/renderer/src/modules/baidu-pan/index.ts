// 百度网盘 (cutex capability baidu-pan, owner-only): a Shelf page per host to browse / search the owner's
// Baidu Netdisk and download files into a folder on that host, plus the host's download list. The daemon
// holds the account and runs the downloads; hidden on hosts without the capability. No upload / delete.
import { Cloud } from "lucide-react";
import { BAIDU_PAN_FEATURE } from "../../../../shared/baiduPan";
import { useI18n } from "../../i18n";
import { lazyPage } from "../../lib/lazyPage";
import { defineModule } from "../slots";
import { PAN_PAGE } from "./model";
import type { PanState } from "./PanPage";

const PanPage = lazyPage(() => import("./PanPage").then((m) => m.PanPage));
function useTab() {
  const { t } = useI18n();
  return { title: t("baidu-pan.title") };
}
const parse = (raw: unknown): PanState => {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const dirs = r.targetDirs && typeof r.targetDirs === "object" ? Object.fromEntries(Object.entries(r.targetDirs as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].length <= 1024).slice(0, 16)) : {};
  return { hostId: typeof r.hostId === "string" ? r.hostId : null, targetDirs: dirs };
};

export default defineModule({
  id: "baidu-pan",
  titleKey: "baidu-pan.title",
  descriptionKey: "baidu-pan.description",
  requires: { capabilities: [BAIDU_PAN_FEATURE] },
  contributes: {
    "side.component": [{
      id: PAN_PAGE, titleKey: "baidu-pan.title", icon: Cloud, instances: "singleton", defaultBinding: "host",
      placement: { home: "reference", order: 460 }, parseParams: () => ({}), init: (_p: unknown, previous: PanState | null) => previous ?? {},
      restore: (raw) => parse(raw), useTab, Body: PanPage, launcher: { category: "content", order: 460, params: () => ({}) },
    }],
  },
});
