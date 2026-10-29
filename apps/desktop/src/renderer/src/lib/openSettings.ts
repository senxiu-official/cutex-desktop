// ⚙ 设置 (sidebar footer, identity menu, Ctrl+,): opens 运行时 directly while agents run an old
// runtime, else 通用. The shell module's nav entry and the core shell share it. Settings is the Settings
// Shelf (lib/settingsShelf, owner 2026-10-21): Ctrl+, and the footer entry toggle it.
import { RUNTIME_PACKAGES_FEATURE } from "./runtimePackages";
import { useRuntimePackages } from "./runtimePackageStore";
import { outdatedClaudeRuntimeAgents } from "./claudeRuntimeBatch";
import { closeSettingsShelf, useSettingsShelf } from "./settingsShelf";
import { useApp } from "../store";
import { currentWindow } from "./windowScope";
import { services } from "../modules/app";

export function openSettingsFromNav() {
  const s = useApp.getState();
  const supported = s.daemon.kind === "connected" && s.features.has(RUNTIME_PACKAGES_FEATURE);
  const native = supported ? (useRuntimePackages.getState().byHost[s.hosts?.active ?? ""]?.view?.agents.length ?? 0) : 0;
  const claude = supported ? outdatedClaudeRuntimeAgents(s.features, s.sidebar).length : 0;
  const outdated = native + claude;
  services.ui.openSettings(outdated > 0 ? "runtime" : "general");
}

/** Ctrl+, / the footer ⚙: open the Settings Shelf (as above), or close it when it is open (a live edit ends too). */
export function toggleSettingsFromNav() {
  // Open in another app window (multi-window P3): it comes to this one instead of closing there.
  const shelf = useSettingsShelf.getState();
  if (!shelf.open || shelf.win !== currentWindow()) return openSettingsFromNav();
  if (useApp.getState().customize) useApp.getState().closeCustomize();
  closeSettingsShelf();
}
