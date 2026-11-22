// ⚙ 设置 (sidebar footer, identity menu, Ctrl+,): opens 运行时 directly while agents run an old
// runtime, else 通用. The shell module's nav entry and the core shell share it. Settings is the Settings
// Shelf (lib/settingsShelf, owner 2026-10-21): Ctrl+, and the footer entry toggle it.
import { RUNTIME_PACKAGES_FEATURE } from "./runtimePackages";
import { useRuntimePackages } from "./runtimePackageStore";
import { outdatedClaudeRuntimeAgents } from "./claudeRuntimeBatch";
import { closeSettingsShelf, settingsShelfCovers, useSettingsShelf } from "./settingsShelf";
import { useApp } from "../store";
import { currentWindow, inWindow } from "./windowScope";
import { confirmLeaveWithDrafts, hasSettingsDrafts } from "./settingsDrafts";
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

/**
 * Settings covers this window's work row (maximised, or a portrait window): it closes (a live edit ends too), so what
 * a window-bar entry opens next is seen — before, the entry opened its page / Shelf pane under Settings and the
 * click looked like nothing (owner 2026-11-18). Settings opened in another app window does not cover this one.
 * `go` (the entry's own action) runs once Settings is out of the way. With an unsaved draft in Settings (lib/settingsDrafts)
 * it is never closed silently: an in-place confirm next to `anchor` (the clicked button) offers 保存并前往 / 放弃并前往 /
 * 取消 (Director 2026-11-18); `go` runs only after save or discard.
 */
export function leaveCoveringSettings(go: () => void, anchor?: HTMLElement | null): void {
  const origin = currentWindow();
  if (!settingsShelfCovers() || useSettingsShelf.getState().win !== origin) return go();
  // Bound to the window it was asked in (review 2026-11-18): after an awaited save the owner may be in another app
  // window; Settings closes only if it still is this window's, and `go` acts on this window.
  const leave = () =>
    inWindow(origin, () => {
      const shelf = useSettingsShelf.getState();
      if (shelf.open && shelf.win === origin) {
        if (useApp.getState().customize) useApp.getState().closeCustomize();
        closeSettingsShelf();
      }
      go();
    });
  if (hasSettingsDrafts()) confirmLeaveWithDrafts(anchor, leave);
  else leave();
}
