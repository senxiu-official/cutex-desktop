// 「Director 头像」 (owner 2026-10-21): portraits meant for Directors, shown first in a Director's avatar
// picker (others can still pick them, further down). Two sources (shared/directorAvatars.ts):
// - bundled: assets/avatars/director/ (PNG / JPEG / WebP / SVG, eager glob: a missing folder or file just
//   yields fewer entries); README there says how to add images;
// - personal: `<userData>/avatars/director/`, read by main and handed over as small PNG data URLs.
// An agent wearing one stores `{kind: "icon", value: "director:<bundled|user>/<stem>"}` in cutex; the
// picture is resolved on this device (a device without the file shows the default avatar, as with
// uploaded pictures). Bundled ones come first, then personal ones, each by name.
import { useEffect, useSyncExternalStore } from "react";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import type { PreloadBridge } from "../../../shared/ipc";
import { isPortraitAvatar } from "../../../shared/portraitPacks";
import { avatarStem, directorAvatarIdOf, isDirectorAvatar, type DirectorAvatarFile, type DirectorAvatarsBridge, type DirectorAvatarSource, type DirectorAvatarsState } from "../../../shared/directorAvatars";

export interface DirectorAvatar {
  /** `<source>/<stem>`: what follows `director:` in the stored avatar value. */
  id: string;
  source: DirectorAvatarSource;
  stem: string;
  url: string;
}

/** The cutex avatar for a portrait (icon kind; ≤ 64 chars). */
export function directorAvatarOf(portrait: Pick<DirectorAvatar, "id">): SessionAvatar {
  return { kind: "icon", value: `director:${portrait.id}` };
}

export { directorAvatarIdOf, isDirectorAvatar };

/** A picture from a collection (「Director 头像」 or a 拟人头像包): the 编辑信息 portrait tab's, not an upload. */
export const isGalleryAvatar = (avatar: SessionAvatar | null | undefined): boolean => isDirectorAvatar(avatar) || isPortraitAvatar(avatar);

const byName = (a: { stem: string }, b: { stem: string }) => a.stem.localeCompare(b.stem, "en", { numeric: true });

/** Glob result (path → URL) → bundled portraits by name; duplicate stems (cat.png + cat.svg) keep the first path. */
export function bundledDirectorAvatars(urls: Record<string, string>): DirectorAvatar[] {
  const seen = new Set<string>();
  const out: DirectorAvatar[] = [];
  for (const [path, url] of Object.entries(urls).sort(([a], [b]) => a.localeCompare(b))) {
    const stem = avatarStem(path.slice(path.lastIndexOf("/") + 1));
    if (!stem || seen.has(stem) || typeof url !== "string" || !url) continue;
    seen.add(stem);
    out.push({ id: `bundled/${stem}`, source: "bundled", stem, url });
  }
  return out.sort(byName);
}

/** The whole collection: bundled, then personal (main's files, re-checked), each by name. */
export function directorAvatarList(bundled: readonly DirectorAvatar[], user: readonly DirectorAvatarFile[] | null | undefined): DirectorAvatar[] {
  const seen = new Set<string>();
  const mine = (user ?? [])
    .filter((f) => typeof f?.stem === "string" && /^[a-z0-9_-]{1,40}$/.test(f.stem) && typeof f.url === "string" && f.url.startsWith("data:image/png;base64,"))
    .filter((f) => !seen.has(f.stem) && (seen.add(f.stem), true))
    .map((f): DirectorAvatar => ({ id: `user/${f.stem}`, source: "user", stem: f.stem, url: f.url }))
    .sort(byName);
  return [...bundled, ...mine];
}

/** The picker's sections in order: a Director sees its portraits first, every other agent the emoji first. */
export type AvatarPickerSection = "director" | "emoji";
export function avatarPickerSections(isDirector: boolean): AvatarPickerSection[] {
  return isDirector ? ["director", "emoji"] : ["emoji", "director"];
}

/** 编辑信息's avatar tabs (components/AgentInfoDialog). */
export type AvatarTab = "default" | "emoji" | "color" | "picture" | "portrait";

/** The tabs in order: a Director's portraits first, everyone else's last. */
export function avatarTabs(isDirector: boolean): AvatarTab[] {
  return isDirector ? ["portrait", "default", "emoji", "color", "picture"] : ["default", "emoji", "color", "picture", "portrait"];
}

/** The tab the dialog opens on: the stored avatar's; a Director without one of its own opens on its portraits. */
export function initialAvatarTab(avatar: SessionAvatar | null | undefined, isDirector: boolean): AvatarTab {
  if (!avatar) return isDirector ? "portrait" : "default";
  if (avatar.kind === "icon") return isGalleryAvatar(avatar) ? "portrait" : "picture";
  return avatar.kind;
}

// ── the collection, loaded once per window ─────────────────────────────────────────────────────────

export const BUNDLED_DIRECTOR_AVATARS: readonly DirectorAvatar[] = bundledDirectorAvatars(
  import.meta.glob<string>("../assets/avatars/director/*.{png,jpg,jpeg,webp,svg}", { eager: true, query: "?url", import: "default" }),
);

export interface DirectorAvatarsView {
  list: readonly DirectorAvatar[];
  /** The personal folder (null until main answered / no bridge). */
  dir: string | null;
  skipped: number;
  /** Main answered (or there is no bridge). */
  ready: boolean;
}

function bridge(): DirectorAvatarsBridge | undefined {
  return (globalThis as { cutex?: PreloadBridge }).cutex?.directorAvatars;
}

let view: DirectorAvatarsView = { list: BUNDLED_DIRECTOR_AVATARS, dir: null, skipped: 0, ready: false };
let byId = new Map(view.list.map((p) => [p.id, p.url]));
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function apply(state: DirectorAvatarsState | null): void {
  view = { list: directorAvatarList(BUNDLED_DIRECTOR_AVATARS, state?.files), dir: typeof state?.dir === "string" ? state.dir : null, skipped: state?.skipped ?? 0, ready: true };
  byId = new Map(view.list.map((p) => [p.id, p.url]));
  for (const l of listeners) l();
}

/** Reads the personal folder once (later calls: no-op unless `refresh`). */
export function loadDirectorAvatars(refresh = false): Promise<void> {
  if (loading) return loading;
  if (view.ready && !refresh) return Promise.resolve();
  const source = bridge();
  if (!source) {
    apply(null);
    return Promise.resolve();
  }
  loading = source
    .list()
    .then(apply, () => apply(null))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Opens the personal folder (created on demand) in the file manager, then re-reads it. */
export async function openDirectorAvatarFolder(): Promise<void> {
  const source = bridge();
  if (!source) return;
  apply(await source.openFolder());
}

export const canOpenDirectorAvatarFolder = (): boolean => !!bridge();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const snapshot = () => view;

/** The whole collection (reads the personal folder on first use). */
export function useDirectorAvatars(): DirectorAvatarsView {
  useEffect(() => {
    void loadDirectorAvatars();
  }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The picture of a portrait avatar on this device (null: not a portrait, or not here). Non-reactive. */
export function directorAvatarUrl(avatar: SessionAvatar | null | undefined): string | null {
  const id = directorAvatarIdOf(avatar);
  return id ? (byId.get(id) ?? null) : null;
}

/** Reactive directorAvatarUrl: a personal portrait shows once main has read the folder. */
export function useDirectorAvatarUrl(avatar: SessionAvatar | null | undefined): string | null {
  const id = directorAvatarIdOf(avatar);
  useEffect(() => {
    if (id?.startsWith("user/")) void loadDirectorAvatars();
  }, [id]);
  return useSyncExternalStore(subscribe, () => (id ? (byId.get(id) ?? null) : null), () => null);
}

/** Tests. */
export function resetDirectorAvatarsForTest(): void {
  view = { list: BUNDLED_DIRECTOR_AVATARS, dir: null, skipped: 0, ready: false };
  byId = new Map(view.list.map((p) => [p.id, p.url]));
  loading = null;
}
