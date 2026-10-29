// Full Profile styles live on capable hosts; older hosts keep this desktop's copy.
// The app default always stays local. Legacy emoji themes are a separate field.
import { useSyncExternalStore } from "react";
import type { ProfileItem } from "../../../shared/ipc";
import { featuresOf, useApp } from "../store";
import { AVATAR_THEME_IDS, type AvatarThemeId } from "./avatarThemes";
import { hostKey, parseHostKey } from "./hostKeys";
import { avatarThemesOverride, getUiPrefs, setAvatarThemeOverride, setUiPref, subscribeUiPrefs } from "./prefs";
import { onProfileLooksNoted, patchProfileLook, profileLookOf, profileLooksApi, subscribeProfileLooks } from "./profileLooks";
import { onHostReset, onHostSwitch } from "./hostSwitch";
import { isPortraitThemeKey, migratePortraitThemes } from "../../../shared/portraitDefaults";

export type AvatarStyle =
  | { kind: "portrait"; portraitThemes: string[] }
  | { kind: "emoji"; emojiThemes: AvatarThemeId[] | null }
  | { kind: "letter" };

export const AVATAR_STYLE_STORAGE_KEY = "cutex-desktop.avatarStyle";
type State = { version: 1; app: AvatarStyle; profiles: Record<string, AvatarStyle | null>; portraitThemes: string[]; imported?: Record<string, true> };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const owns = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key);

function portraits(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 200 || !value.every(isPortraitThemeKey)) return null;
  return migratePortraitThemes(value);
}

function validStyle(value: unknown): AvatarStyle | null {
  if (!record(value)) return null;
  if (value.kind === "letter") return { kind: "letter" };
  if (value.kind === "portrait") {
    const themes = portraits(value.portraitThemes);
    return themes ? { kind: "portrait", portraitThemes: themes } : null;
  }
  if (value.kind !== "emoji") return null;
  if (value.emojiThemes === null) return { kind: "emoji", emojiThemes: null };
  if (!Array.isArray(value.emojiThemes) || !value.emojiThemes.every((v) => AVATAR_THEME_IDS.includes(v as AvatarThemeId))) return null;
  const themes = AVATAR_THEME_IDS.filter((v) => (value.emojiThemes as unknown[]).includes(v));
  return { kind: "emoji", emojiThemes: themes.length ? themes : null };
}

const copyStyle = (style: AvatarStyle): AvatarStyle => style.kind === "portrait"
  ? { kind: "portrait", portraitThemes: [...style.portraitThemes] }
  : style.kind === "emoji" ? { kind: "emoji", emojiThemes: style.emojiThemes ? [...style.emojiThemes] : null } : { kind: "letter" };

let state: State | null = null;
let readable = true;
let version = 0;
const listeners = new Set<() => void>();
// Missing profiles can acquire a legacy host override when their first profile list arrives.
const waiting = new Map<string, [string, string]>();
let stopSources: (() => void) | null = null;

function notify(): void { version++; for (const listener of [...listeners]) listener(); }

function persist(next: State, strict: boolean): void {
  try { localStorage.setItem(AVATAR_STYLE_STORAGE_KEY, JSON.stringify(next)); }
  catch (error) { if (strict) throw error; }
  state = next;
}

function current(): State {
  if (state) return state;
  const prefs = getUiPrefs();
  const themes = portraits(prefs.portraitPacks) ?? [];
  const app: AvatarStyle = themes.length ? { kind: "portrait", portraitThemes: themes }
    : prefs.agentAvatarDefault === "letter" ? { kind: "letter" } : { kind: "emoji", emojiThemes: null };
  const fallback: State = { version: 1, app, profiles: {}, portraitThemes: themes };
  try {
    const raw = localStorage.getItem(AVATAR_STYLE_STORAGE_KEY);
    if (raw === null) { persist(fallback, false); return state!; }
    const parsed: unknown = JSON.parse(raw);
    const savedApp = record(parsed) ? validStyle(parsed.app) : null;
    if (!record(parsed) || parsed.version !== 1 || !savedApp || !record(parsed.profiles)) { readable = false; return state = fallback; }
    const profiles: State["profiles"] = {};
    for (const [key, value] of Object.entries(parsed.profiles)) {
      const scope = parseHostKey(key);
      if (!scope || hostKey(...scope) !== key) { readable = false; continue; }
      const style = value === null ? null : validStyle(value);
      if (value === null || style) profiles[key] = style;
      else readable = false;
    }
    const imported = record(parsed.imported) ? Object.fromEntries(Object.entries(parsed.imported).filter(([key, value]) => value === true && !!parseHostKey(key)).map(([key]) => [key, true as const])) : {};
    return state = { version: 1, app: savedApp, profiles, imported, portraitThemes: portraits(parsed.portraitThemes) ?? (savedApp.kind === "portrait" ? savedApp.portraitThemes : []) };
  } catch { readable = false; return state = fallback; }
}

function migrateProfile(hostId: string, profileId: string): AvatarStyle | null {
  const saved = current();
  const key = hostKey(hostId, profileId);
  if (owns(saved.profiles, key)) return saved.profiles[key]!;
  const legacy = avatarThemesOverride(hostId, profileId);
  const style = legacy ? validStyle({ kind: "emoji", emojiThemes: legacy }) : null;
  if (!style) { waiting.set(key, [hostId, profileId]); return null; }
  waiting.delete(key);
  const next = { ...saved, profiles: { ...saved.profiles, [key]: style } };
  if (readable) persist(next, false); else state = next; // Do not erase malformed storage on a read.
  return style;
}

/** App-wide default, migrated from legacy portrait packs before the old letter/emoji preference. */
export function getAppAvatarStyle(): AvatarStyle { return copyStyle(current().app); }

/** A saved Profile choice, or null to inherit the app style. Host/Profile ids are exact. */
export function getProfileAvatarStyle(hostId: string, profileId: string): AvatarStyle | null {
  if (profileAvatarStyleSupported(hostId)) {
    return validStyle(profileLookOf(hostId, profileId)?.appearance.avatarStyle);
  }
  const style = migrateProfile(hostId, profileId);
  return style ? copyStyle(style) : null;
}

export const profileAvatarStyleSupported = (hostId: string): boolean => featuresOf(useApp.getState(), hostId).has("profile-avatar-style");

/** A successful host save also fences a later one-time local import. */
export function noteProfileAvatarStyleSaved(hostId: string, profile: Pick<ProfileItem, "id" | "appearance">): void {
  patchProfileLook(hostId, profile.id, { appearance: profile.appearance });
  const saved = current(), key = hostKey(hostId, profile.id);
  const profiles = { ...saved.profiles };
  delete profiles[key];
  persist({ ...saved, profiles, imported: { ...saved.imported, [key]: true } }, false);
  notify();
}

/** The old local value is a draft, never the effective style on a capable host. */
export function pendingLocalProfileAvatarStyle(hostId: string, profileId: string): AvatarStyle | null {
  if (!profileAvatarStyleSupported(hostId)) return null;
  const saved = current(), key = hostKey(hostId, profileId), profile = profileLookOf(hostId, profileId);
  if (!profile || saved.imported?.[key] || profile.appearance.avatarStyle != null || profile.appearanceRevisions?.avatarStyle?.updatedAt != null) return null;
  const style = saved.profiles[key];
  return style ? copyStyle(style) : null;
}

/** An explicit owner click uses the normal save, including hosts without atomic import support. */
export async function saveLocalProfileAvatarStyle(hostId: string, profileId: string): Promise<void> {
  const style = pendingLocalProfileAvatarStyle(hostId, profileId), api = profileLooksApi(hostId);
  if (!style || !api) return;
  const currentHost = epochs.get(hostId) ?? 0;
  const next = await api.patchProfile(profileId, { avatarStyle: style });
  if ((epochs.get(hostId) ?? 0) === currentHost && profileAvatarStyleSupported(hostId)) noteProfileAvatarStyleSaved(hostId, next);
}

const importing = new Set<string>();
const epochs = new Map<string, number>();
onHostReset((id) => epochs.set(id, (epochs.get(id) ?? 0) + 1));
onHostSwitch(() => { for (const id of epochs.keys()) epochs.set(id, (epochs.get(id) ?? 0) + 1); });

/** Import only an existing full local choice, once, after rechecking the host's current clock. */
export async function importLocalProfileAvatarStyles(hostId: string, profiles: readonly Pick<ProfileItem, "id" | "appearance" | "appearanceRevisions">[]): Promise<void> {
  if (!profileAvatarStyleSupported(hostId)) return;
  const api = profileLooksApi(hostId);
  if (!api) return;
  const epoch = epochs.get(hostId) ?? 0;
  epochs.set(hostId, epoch);
  const isCurrent = () => epochs.get(hostId) === epoch && profileAvatarStyleSupported(hostId);
  for (const profile of profiles) {
    const key = hostKey(hostId, profile.id), saved = current();
    if (saved.imported?.[key] || importing.has(key) || !owns(saved.profiles, key) || !saved.profiles[key]) continue;
    if (profile.appearance.avatarStyle != null || profile.appearanceRevisions?.avatarStyle?.updatedAt != null) {
      if (isCurrent()) noteProfileAvatarStyleSaved(hostId, profile);
      continue;
    }
    // The atomic condition is separately advertised. A GET followed by an ordinary
    // PATCH could overwrite an owner save from another device between those calls.
    if (!featuresOf(useApp.getState(), hostId).has("profile-avatar-style-import-if-unset")) continue;
    importing.add(key);
    try {
      const fresh = await api.getProfile(profile.id);
      if (!isCurrent()) continue;
      if (fresh.appearance.avatarStyle != null || fresh.appearanceRevisions?.avatarStyle?.updatedAt != null) {
        noteProfileAvatarStyleSaved(hostId, fresh);
        continue;
      }
      const style = current().profiles[key];
      if (!style || current().imported?.[key]) continue;
      if (!featuresOf(useApp.getState(), hostId).has("profile-avatar-style-import-if-unset")) continue;
      const next = await api.patchProfile(profile.id, { avatarStyle: copyStyle(style), avatarStyleImportIfUnset: true });
      if (isCurrent()) noteProfileAvatarStyleSaved(hostId, next);
    } catch (error) {
      // The IPC error preserves the code, not necessarily the canonical response body.
      // Re-read it instead; the conflicting owner value remains authoritative.
      if (/avatar_style_already_set/.test(error instanceof Error ? error.message : String(error)) && isCurrent()) {
        try { const fresh = await api.getProfile(profile.id); if (isCurrent()) noteProfileAvatarStyleSaved(hostId, fresh); } catch { /* Retain the draft on failed refresh. */ }
      }
      // Other failures keep the draft for retry on the next successful Profile refresh.
    }
    finally { importing.delete(key); }
  }
}
onProfileLooksNoted((hostId, profiles) => { void importLocalProfileAvatarStyles(hostId, profiles).catch(() => {}); });

export function effectiveAvatarStyle(hostId: string, profileId: string | null): AvatarStyle {
  return (profileId !== null ? getProfileAvatarStyle(hostId, profileId) : null) ?? getAppAvatarStyle();
}

/** Last app portrait selection, retained locally when switching to emoji or letter. */
export function getSavedPortraitThemes(): string[] { return [...current().portraitThemes]; }

export function setAppAvatarStyle(style: AvatarStyle): void {
  const nextStyle = validStyle(style);
  if (!nextStyle) throw new TypeError("Invalid avatar style");
  const saved = current();
  persist({ ...saved, app: nextStyle, portraitThemes: nextStyle.kind === "portrait" ? nextStyle.portraitThemes : saved.portraitThemes }, true);
  readable = true;
  // Retain the old keys for older desktops, but never leave portraits enabled in another mode.
  setUiPref("portraitPacks", nextStyle.kind === "portrait" ? [...nextStyle.portraitThemes] : []);
  // The separate important-only/dot preference is independent of full style.
  if (getUiPrefs().agentAvatarDefault !== "important") setUiPref("agentAvatarDefault", nextStyle.kind === "letter" ? "letter" : "emoji");
  notify();
}

export function setProfileAvatarStyle(hostId: string, profileId: string, style: AvatarStyle | null): void {
  const nextStyle = style === null ? null : validStyle(style);
  if (style !== null && !nextStyle) throw new TypeError("Invalid avatar style");
  const saved = current();
  const key = hostKey(hostId, profileId);
  persist({ ...saved, profiles: { ...saved.profiles, [key]: nextStyle } }, true);
  readable = true;
  waiting.delete(key);
  // Only an explicit emoji save uses the pre-existing local/host emoji write path.
  // Inherit is a durable null tombstone; it must not clear or re-import the old override.
  if (nextStyle?.kind === "emoji") setAvatarThemeOverride(hostId, profileId, nextStyle.emojiThemes);
  notify();
}

export function subscribeAvatarStyles(listener: () => void): () => void {
  listeners.add(listener);
  if (!stopSources) {
    const changed = () => {
      let migrated = false;
      for (const [host, profile] of [...waiting.values()]) if (migrateProfile(host, profile)) migrated = true;
      if (migrated) notify();
    };
    const stopPrefs = subscribeUiPrefs(changed);
    const stopLooks = subscribeProfileLooks(() => { const before = version; changed(); if (version === before) notify(); });
    const capabilityKey = (source: Parameters<typeof featuresOf>[0]) => JSON.stringify([
      source.hosts?.active ?? "local",
      source.features?.has("profile-avatar-style") ?? false,
      source.features?.has("profile-avatar-style-import-if-unset") ?? false,
      Object.entries(source.byHost).map(([id, slice]) => [id, slice.features?.has("profile-avatar-style") ?? false, slice.features?.has("profile-avatar-style-import-if-unset") ?? false]),
    ]);
    const stopApp = useApp.subscribe((next, prev) => { if (capabilityKey(next) !== capabilityKey(prev)) notify(); });
    stopSources = () => { stopPrefs(); stopLooks(); stopApp(); };
    changed(); // Close the read-to-subscribe gap if a host list arrived during render.
  }
  return () => { listeners.delete(listener); if (!listeners.size) { stopSources?.(); stopSources = null; } };
}

export function useAvatarStyleVersion(): number {
  return useSyncExternalStore(subscribeAvatarStyles, () => version, () => version);
}

/** Test isolation only: drop module caches without deleting the persisted owner preference. */
export function resetAvatarStyleForTest(): void {
  state = null;
  readable = true;
  waiting.clear();
  importing.clear();
  epochs.clear();
  notify();
}
