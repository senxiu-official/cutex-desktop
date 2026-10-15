// 已安装的运行时 (cutex runtimes-view): native cute-codex releases and Claude runtimes on the
// connected host with the agents pinned to each, in Settings → 运行时. A cutex without the
// capability gets 「需要升级 cutex」 instead.
import { RUNTIMES_FEATURE } from "../../../../shared/runtimes";
import { defineModule } from "../slots";
import { RuntimesSection } from "./RuntimesSection";

export default defineModule({
  id: "runtimes",
  titleKey: "runtimes.title",
  descriptionKey: "runtimes.description",
  contributes: {
    "settings.section": [{ id: "runtimes.installed", page: "runtime", order: 200, requires: { capabilities: [RUNTIMES_FEATURE] }, unavailable: "notice", titleKey: "runtimes.installed", keywords: ["runtimes.native", "runtimes.claude"], Section: RuntimesSection }],
  },
});
