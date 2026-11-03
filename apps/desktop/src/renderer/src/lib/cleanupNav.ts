// Settings → 协作 → 高级 → 待清理 (modules/agent-bus CleanupSection): the one place where stale
// delegations, stuck messages and locally hidden receipts are listed and cleaned up by hand. Other
// views link here (接下来's menu) instead of showing their own cleanup rows.
import { create } from "zustand";
import { useApp } from "../store";
import { setSettingsHost } from "./settingsHost";
import { requestSettingsReveal } from "./settingsSearchView";

/** Anchor of the 待清理 section (settingsAnchorId). */
export const CLEANUP_ANCHOR = "agent-bus.cleanup";

export type CleanupCategory = "delegations" | "messages" | "receipts";

/** The category a link asked to open (the section opens it, then clears it). */
export const useCleanupFocus = create<{ category: CleanupCategory | null; nonce: number }>(() => ({ category: null, nonce: 0 }));

/** Open 待清理 on `hostId` with `category` expanded. */
export function openCleanup(hostId: string, category: CleanupCategory): void {
  setSettingsHost(hostId);
  useCleanupFocus.setState((s) => ({ category, nonce: s.nonce + 1 }));
  useApp.getState().openSettings("collab");
  requestSettingsReveal(CLEANUP_ANCHOR);
}
