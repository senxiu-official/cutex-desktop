// Fixed style avatars written into cutex (portrait picking rules in lib/portraitPacks): a new agent's picture
// (NewAgentPage), the agent menu's 显示头像, Settings → 外观 → 拟人头像's 「都换成勾选的主题」 and 「重新分配」. Each bulk write
// keeps one undo (the avatars as they were), offered next to the button until the next bulk write.
// avatarStyleAssign plans both portrait/emoji changes and explicit letter clears;
// the legacy portrait planners remain available for missing-picture repair.
import { useSyncExternalStore } from "react";
import type { AvatarMode, SessionAvatar, SessionResource } from "@cutex-desktop/protocol";
import { featuresOf, sidebarOf, useApp } from "../store";
import { agentIndex, lookOf, portraitsWornIn, sessionProfileName } from "./agentLook";
import { avatarThemesOverride, getUiPrefs } from "./prefs";
import { writeMetadataRetrying } from "./metadataRetry";
import { profileLookOf } from "./profileLooks";
import { pickForNewAgent, portraitIndexNow, type PortraitFamily } from "./portraitPacks";
import type { StyleAgent, StyleAvatarChange } from "./avatarStyleAssign";

/** Every agent the app holds (all followed hosts), with what picking needs. */
export function agentsForPortraits(): StyleAgent[] {
  const out: StyleAgent[] = [];
  for (const [seed, entry] of agentIndex(useApp.getState())) {
    if (entry.session.avatarMode === "inherit") continue;
    const profile = profileLookOf(entry.hostId, sessionProfileName(entry.session));
    const look = lookOf(entry, profile, profile ? avatarThemesOverride(entry.hostId, profile.id) : null);
    out.push({ seed, hostId: entry.hostId, projectId: entry.row?.projectId ?? null, profileId: profile?.id ?? null, family: look.family, avatarMode: entry.session.avatarMode ?? null, avatar: entry.session.avatar ?? null });
  }
  return out;
}

/** A new agent's 拟人头像 (themes enabled, the owner picked no avatar): skips pictures worn in its project. */
export function newAgentPortrait(enabled: readonly string[], seed: string, hostId: string, projectId: string | null, family: PortraitFamily | null): SessionAvatar | null {
  if (!enabled.length) return null;
  // The same pictures components/Avatar skips while the agent has no avatar yet, so storing this changes nothing on screen.
  return pickForNewAgent(portraitIndexNow(), enabled, family, seed, portraitsWornIn(agentIndex(useApp.getState()), hostId, projectId));
}

/**
 * 显示头像 (agent menu, 默认头像 = 仅重要智能体) with themes enabled: the 拟人头像 agent `seed` gets, picked like a
 * new agent's (its family's pool, skipping pictures worn in its project); null = no theme applies (unknown agent,
 * no picture for its family) → the caller falls back to the theme emoji.
 */
export function shownPortrait(seed: string, hostId: string, enabled: readonly string[] = getUiPrefs().portraitPacks): SessionAvatar | null {
  if (!enabled.length) return null;
  const agent = agentsForPortraits().find((a) => a.seed === seed && a.hostId === hostId);
  return agent ? newAgentPortrait(enabled, seed, hostId, agent.projectId, agent.family) : null;
}

/** A session as its host has it now (the host's sidebar re-read); null when gone. */
export async function rereadSession(hostId: string, id: string): Promise<SessionResource | null> {
  await useApp.getState().refreshHostSidebar(hostId);
  const sidebar = sidebarOf(useApp.getState(), hostId);
  return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === id) ?? null;
}

/**
 * One avatar change, fenced by the session revision (the store adds it). A revision moved by a turn or a
 * status change, or cutex's store CAS lost to another writer: retried against the fresh session while the
 * avatar is still `from` (lib/metadataRetry).
 */
async function writeAvatar(seed: string, hostId: string, from: SessionAvatar | null, avatar: SessionAvatar | null, fromMode: AvatarMode = null, mode: AvatarMode = "fixed"): Promise<void> {
  const capable = featuresOf(useApp.getState(), hostId).has("session-avatar-mode");
  await writeMetadataRetrying<SessionResource>({
    write: (fresh) => {
      const entry = agentIndex(useApp.getState()).get(seed);
      const current = fresh ?? (entry?.hostId === hostId ? entry.session : null);
      if (!current || current.avatarMode === "inherit" || (capable && (current.avatarMode ?? null) !== fromMode) || JSON.stringify(current.avatar ?? null) !== JSON.stringify(from)) throw new Error("avatar changed meanwhile");
      return useApp.getState().sessionAction(seed, "cutex/session/metadata/update", { avatar, expectedRevision: current.revision, ...(capable ? { avatarMode: mode } : {}) }, hostId);
    },
    reread: () => rereadSession(hostId, seed),
    before: { avatar: from, ...(capable ? { avatarMode: fromMode } : {}) },
    fenced: true,
    changed: () => new Error("avatar changed meanwhile"),
  });
}

export interface PortraitUndo {
  /** What the write was (Settings words the undo by it). */
  kind: "replace" | "reassign";
  changes: StyleAvatarChange[];
}

let undo: PortraitUndo | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Writes the changes (sequentially, so a host is not flooded); returns how many failed. The written ones become the undo. */
export async function applyPortraitChanges(kind: PortraitUndo["kind"], changes: readonly StyleAvatarChange[]): Promise<{ written: number; failed: number }> {
  const done: StyleAvatarChange[] = [];
  let failed = 0;
  for (const c of changes) {
    try {
      await writeAvatar(c.seed, c.hostId, c.before, c.after, c.beforeMode ?? null, c.afterMode ?? "fixed");
      done.push(c);
    } catch {
      failed++;
    }
  }
  undo = done.length ? { kind, changes: done } : undo;
  emit();
  return { written: done.length, failed };
}

/** Puts the avatars of the last bulk write back (one level). */
export async function undoPortraitChanges(): Promise<{ written: number; failed: number }> {
  const last = undo;
  if (!last) return { written: 0, failed: 0 };
  undo = null;
  emit();
  let failed = 0;
  for (const c of last.changes) {
    try {
      await writeAvatar(c.seed, c.hostId, c.after, c.before, c.afterMode ?? (featuresOf(useApp.getState(), c.hostId).has("session-avatar-mode") ? "fixed" : null), c.beforeMode ?? null);
    } catch {
      failed++;
    }
  }
  return { written: last.changes.length - failed, failed };
}

export function usePortraitUndo(): PortraitUndo | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => undo,
    () => null,
  );
}
