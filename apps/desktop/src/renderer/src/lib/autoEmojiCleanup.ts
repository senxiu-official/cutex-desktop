// One-time cleanup (owner 2026-10-25): from 00cc3744 until fix/no-avatar-fallback the first-seen saver (lib/portraitSave)
// and the 新建 page stored the emoji default as an agent's own avatar, so agents without an avatar kept a fixed emoji
// everywhere (no initial tile in 仅重要智能体). Once per device this clears those again — only for agents this device
// handled (its `cutex-desktop.portraitSaved` list) and only while the stored avatar is still exactly a default emoji
// the planner would have written for that agent (its seed's pick in its family / style emoji pool, moved on by at
// most one place per other member of its project: the worn skip). Anything else stays: a portrait, an icon, a
// colour, an emoji with its own colour, one the owner or another device changed since, an agent in another state.
//
// The write is the same fenced metadata update as 隐藏头像 (lib/menus), back to the state before the write: no avatar,
// and on hosts with session-avatar-mode a null mode (the legacy no-avatar record; `fixed` + null would pin a letter).
// An agent whose host is not loaded / not writable / whose Profile list is unknown, or a write that fails, stays
// pending and is tried again later (this run, or the next start); a conflict means it changed meanwhile: kept.
// Done when nothing is pending. A quiet notice only when something was cleared.
import type { AvatarMode, SessionAvatar } from "@cutex-desktop/protocol";
import { featuresOf, sidebarOf, useApp } from "../store";
import { translate } from "../i18n";
import { agentIndex, lookOf, sessionProfileName } from "./agentLook";
import { AVATAR_THEME_IDS, themedEmoji, themesEmoji, type AvatarThemeId } from "./avatarThemes";
import { familyThemes } from "./avatarStyleAssign";
import { effectiveAvatarStyle } from "./avatarStyle";
import { isRevisionConflict, isStoreConflict, writeMetadataRetrying } from "./metadataRetry";
import { rereadSession } from "./portraitAssign";
import { loadSaved } from "./portraitSave";
import { avatarThemesOverride } from "./prefs";
import { onProfileLooksNoted, profileLookOf, profileLooksKnown } from "./profileLooks";
import type { PortraitFamily } from "./portraitPacks";

export const AUTO_EMOJI_CLEANUP_KEY = "cutex-desktop.autoEmojiCleanup";
interface CleanupState {
  version: 1;
  /** `portraitSaved` keys (`host\0seed`) not decided yet. */
  pending: string[];
  /** Agents cleared so far (all runs). */
  cleared: number;
}

export function loadCleanupState(): CleanupState {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTO_EMOJI_CLEANUP_KEY) ?? "null") as Partial<CleanupState> | null;
    if (raw && raw.version === 1 && Array.isArray(raw.pending)) {
      return { version: 1, pending: raw.pending.filter((k): k is string => typeof k === "string"), cleared: typeof raw.cleared === "number" ? raw.cleared : 0 };
    }
  } catch {
    // Unreadable: start over from the list (clearing is idempotent).
  }
  return { version: 1, pending: [...loadSaved()], cleared: 0 };
}

function saveCleanupState(state: CleanupState): void {
  try {
    localStorage.setItem(AUTO_EMOJI_CLEANUP_KEY, JSON.stringify(state));
  } catch {
    // Not saved: the next start decides again (only exact defaults are ever cleared).
  }
}

/**
 * Pure: whether `avatar` is exactly a default emoji the planner picks for `seed` from one of `themeSets`
 * (lib/avatarStyleAssign pickStyleAvatar: the seed's pick, else the next ones its project did not wear yet — at most
 * `skips` places on). No colour of its own, emoji only.
 */
export function isDefaultEmoji(avatar: SessionAvatar | null | undefined, seed: string, themeSets: readonly (readonly AvatarThemeId[])[], skips: number): boolean {
  if (!avatar || avatar.kind !== "emoji" || avatar.color) return false;
  for (const themes of themeSets) {
    const pool = themesEmoji(themes);
    const first = themedEmoji(seed, themes);
    const start = pool.findIndex((e) => e.glyph === first.glyph);
    const at = pool.findIndex((e) => e.glyph === avatar.value);
    if (start < 0 || at < 0) continue;
    if ((at - start + pool.length) % pool.length <= skips) return true;
  }
  return false;
}

/** The emoji pools an auto write for this agent could have used: its family's, its current style's, every theme. */
export function defaultThemeSets(family: PortraitFamily | null, styleThemes: readonly AvatarThemeId[] | null): AvatarThemeId[][] {
  const sets = [familyThemes(family), [...AVATAR_THEME_IDS]];
  if (styleThemes?.length) sets.unshift([...styleThemes]);
  return sets;
}

export type CleanupDecision = { key: string; action: "clear"; hostId: string; seed: string; avatar: SessionAvatar; avatarMode: AvatarMode | null } | { key: string; action: "keep" } | { key: string; action: "wait" };

/** What to do with each pending key now (from the app's current state). */
export function decideCleanup(pending: readonly string[]): CleanupDecision[] {
  const app = useApp.getState();
  const index = agentIndex(app);
  const out: CleanupDecision[] = [];
  for (const key of pending) {
    const cut = key.indexOf("\u0000");
    if (cut <= 0) { out.push({ key, action: "keep" }); continue; }
    const hostId = key.slice(0, cut), seed = key.slice(cut + 1);
    // Its host not loaded yet (offline, not followed this start): later.
    if (!sidebarOf(app, hostId)) { out.push({ key, action: "wait" }); continue; }
    const entry = index.get(seed);
    if (!entry || entry.hostId !== hostId) { out.push({ key, action: "keep" }); continue; }
    const session = entry.session;
    const avatar = session.avatar ?? null;
    if (!avatar || avatar.kind !== "emoji" || avatar.color || session.lifecycle !== "active" || session.avatarMode === "inherit") { out.push({ key, action: "keep" }); continue; }
    if (!featuresOf(app, hostId).has("session-metadata") || !profileLooksKnown(hostId)) { out.push({ key, action: "wait" }); continue; }
    const profile = profileLookOf(hostId, sessionProfileName(session));
    const look = lookOf(entry, profile, profile ? avatarThemesOverride(hostId, profile.id) : null);
    const style = effectiveAvatarStyle(hostId, profile?.id ?? null);
    const projectId = entry.row?.projectId ?? null;
    let skips = 0;
    for (const other of index.values()) if (other !== entry && other.hostId === hostId && (other.row?.projectId ?? null) === projectId) skips++;
    const sets = defaultThemeSets(look.family, style.kind === "emoji" ? style.emojiThemes : null);
    out.push(isDefaultEmoji(avatar, seed, sets, skips)
      ? { key, action: "clear", hostId, seed, avatar, avatarMode: session.avatarMode ?? null }
      : { key, action: "keep" });
  }
  return out;
}

class Changed extends Error {}

/** 隐藏头像's write, back to no avatar; throws Changed when the avatar moved on meanwhile. */
async function clearAvatar(d: Extract<CleanupDecision, { action: "clear" }>): Promise<void> {
  const capable = featuresOf(useApp.getState(), d.hostId).has("session-avatar-mode");
  const before = { avatar: d.avatar, avatarMode: d.avatarMode };
  const revision = agentIndex(useApp.getState()).get(d.seed)?.session.revision ?? 0;
  await writeMetadataRetrying<{ avatar?: SessionAvatar | null; avatarMode?: AvatarMode; revision: number }>({
    write: (fresh) => {
      if (fresh && JSON.stringify(fresh.avatar ?? null) !== JSON.stringify(d.avatar)) throw new Changed();
      return useApp.getState().sessionAction(d.seed, "cutex/session/metadata/update", { avatar: null, ...(capable ? { avatarMode: null } : {}), expectedRevision: fresh?.revision ?? revision }, d.hostId);
    },
    reread: () => rereadSession(d.hostId, d.seed),
    before,
    fenced: true,
    changed: () => new Changed(),
  });
}

/** One pass: clear what matches, keep what does not, leave the rest pending. Returns how many were cleared. */
export async function runCleanupPass(state: CleanupState, write: (d: Extract<CleanupDecision, { action: "clear" }>) => Promise<void> = clearAvatar): Promise<number> {
  let cleared = 0;
  const next = new Set(state.pending);
  for (const d of decideCleanup(state.pending)) {
    if (d.action === "keep") next.delete(d.key);
    if (d.action !== "clear") continue;
    try {
      await write(d);
      cleared++;
      next.delete(d.key);
    } catch (error) {
      // Changed meanwhile (or a lost revision race we gave up on): someone set it; keep theirs. Offline / other: later.
      if (error instanceof Changed || isRevisionConflict(error) || isStoreConflict(error)) next.delete(d.key);
    }
  }
  state.pending = [...next];
  state.cleared += cleared;
  saveCleanupState(state);
  if (cleared) console.info(`[autoEmojiCleanup] cleared ${cleared} auto-generated emoji avatar(s); ${state.pending.length} pending`);
  return cleared;
}

/** Startup: runs until nothing is pending (this start or a later one); the notice only when something was cleared. */
export function startAutoEmojiCleanup(): () => void {
  const state = loadCleanupState();
  saveCleanupState(state);
  if (!state.pending.length) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let stopped = false;
  const offs: (() => void)[] = [];
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    for (const off of offs.splice(0)) off();
  };
  const pass = async () => {
    timer = null;
    if (stopped) return;
    if (running) { again = true; return; }
    running = true;
    try {
      const cleared = await runCleanupPass(state);
      if (cleared && !stopped) useApp.getState().notify(translate("avatar.autoEmojiCleared", { n: String(cleared) }), "info");
      if (!state.pending.length) stop();
    } finally {
      running = false;
      if (again && !stopped) { again = false; schedule(); }
    }
  };
  const schedule = () => {
    if (stopped) return;
    timer ??= setTimeout(() => void pass(), 2000);
  };
  offs.push(useApp.subscribe((s, p) => { if (s.sidebar !== p.sidebar || s.byHost !== p.byHost || s.features !== p.features) schedule(); }), onProfileLooksNoted(schedule));
  schedule();
  return stop;
}
