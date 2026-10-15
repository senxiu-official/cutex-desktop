// ⚙ 设置 (sidebar footer, identity menu, Ctrl+,): opens 运行时 directly while agents run an old
// runtime, else 通用. The shell module's nav entry and the core shell share it.
import { RUNTIME_PACKAGES_FEATURE } from "./runtimePackages";
import { useRuntimePackages } from "./runtimePackageStore";
import { useApp } from "../store";
import { services } from "../modules/app";

export function openSettingsFromNav() {
  const s = useApp.getState();
  const supported = s.daemon.kind === "connected" && s.features.has(RUNTIME_PACKAGES_FEATURE);
  const outdated = supported ? (useRuntimePackages.getState().byHost[s.hosts?.active ?? ""]?.view?.agents.length ?? 0) : 0;
  services.ui.openSettings(outdated > 0 ? "runtime" : "general");
}
