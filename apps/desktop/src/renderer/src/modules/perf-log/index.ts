// 性能记录 (#27, docs/design/018-perf-log.md): stalls over 100 ms recorded on this device (when, what was on
// screen, the last action, the costliest code), viewed / exported on Settings → 更新与诊断 (design 006 v1 Q7; was 关于). Required (like 关于):
// its own switch turns the recording off; it starts here, at load, so the first stalls are seen too.
import { defineModule } from "../slots";
import { setScreenReader, startPerfLog } from "./recorder";
import { readScreen } from "./screen";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const PerfLogSection = lazyPage(() => import("./PerfLogSettings").then((m) => m.PerfLogSection));

setScreenReader(readScreen);
startPerfLog();

export default defineModule({
  id: "perf-log",
  titleKey: "perf-log.moduleTitle",
  descriptionKey: "perf-log.description",
  required: true,
  contributes: {
    "settings.section": [{ id: "perf-log.section", page: "updates", order: 100, titleKey: "perf-log.section", keywords: ["perf-log.enabled", "perf-log.code"], Section: PerfLogSection }],
  },
});
