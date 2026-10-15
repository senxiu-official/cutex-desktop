// 升级 agent: runtime package upgrades (cutex runtime-package-upgrade) in Settings → 运行时.
import { RuntimePackagesSection } from "../../components/settings/RuntimePackagesSection";
import { RUNTIME_PACKAGES_FEATURE } from "../../lib/runtimePackages";
import { defineModule } from "../slots";

export default defineModule({
  id: "runtime-packages",
  titleKey: "runtime-packages.title",
  descriptionKey: "runtime-packages.description",
  requires: { capabilities: [RUNTIME_PACKAGES_FEATURE] },
  contributes: {
    "settings.section": [{ id: "runtime-packages.settings", page: "runtime", order: 100, titleKey: "runtimePackages.title", Section: RuntimePackagesSection }],
  },
});
