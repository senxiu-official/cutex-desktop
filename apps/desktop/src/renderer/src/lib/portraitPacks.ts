// 拟人头像包 (docs/design/040 §3.2; format and ids in shared/portraitPacks.ts). Two sources:
// - shipped: the manifest at assets/avatars/portraits/<pack>.json (eager glob, so adding a pack needs no code) and the
//   WebP pictures as plain files under public/avatars/portraits/<pack>/ (copied as they are, no module per picture),
//   both written by scripts/avatar-pack-import.mjs;
// - the owner's: <userData>/avatars/portraits/<pack>/, listed by main; its pictures arrive as data URLs on demand.
//   A pack there with a shipped pack's id replaces it (the update path for a regenerated pack).
// Settings → 外观 → 拟人头像 (UiPrefs.portraitPacks, lib/portraitThemes) enables themes (`pack/theme`, any number,
// across packs); none = 不用 (today's look). Which picture an agent shows (Avatar):
// - a stored `portrait:` avatar → that picture; gone (the pack was replaced with fewer / renamed pictures) →
//   resolvePortrait's fallback, for display only;
// - no stored avatar and themes enabled → pickPortrait by the agent's id hash in the enabled themes' pool for its
//   model family, skipping pictures stored in its project — the same pick a new agent stores (not written back here);
//   an unknown family ("other": the model / Profile is not known yet) picks nothing and waits, and a family the
//   themes have no pictures for never borrows another family's face (owner 2026-10-28: GPT agents drew GLM faces);
// - a new agent (NewAgentPage) → the same pick, skipping pictures already worn in its project, stored in cutex.
import { useEffect, useSyncExternalStore } from "react";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import type { PreloadBridge } from "../../../shared/ipc";
import {
  familyOfModel,
  modelOfStem,
  parsePackManifest,
  portraitAvatarOf,
  portraitKey,
  portraitRefOf,
  type PortraitFamily,
  type PortraitImageKind,
  type PortraitName,
  type PortraitPackData,
  type PortraitPacksBridge,
  type PortraitPacksState,
  type PortraitRef,
} from "../../../shared/portraitPacks";

export { familyOfModel, portraitAvatarOf, portraitKey, portraitRefOf };
export type { PortraitFamily, PortraitRef };

export interface PortraitPicture extends PortraitRef {
  /** `pack/theme/stem`. */
  key: string;
  family: PortraitFamily;
  source: "bundled" | "user";
  /** Shipped pictures: their URLs; the owner's: null (loaded on demand, usePortraitImage). */
  full: string | null;
  preview: string | null;
}

export interface PortraitTheme {
  id: string;
  name: string;
  /** The manifest's per-theme metadata (shared/portraitPacks PortraitPackTheme). */
  names?: PortraitName;
  subtitle?: PortraitName;
  cover?: string;
  pictures: PortraitPicture[];
}

export interface PortraitPack {
  id: string;
  name: PortraitName | null;
  source: "bundled" | "user";
  themes: PortraitTheme[];
}

/** A pack's data + where its files are → pictures (`urlOf`: shipped files; undefined = no such file). */
export function packOf(id: string, data: PortraitPackData, source: "bundled" | "user", urlOf?: (path: string) => string | undefined): PortraitPack {
  const themes: PortraitTheme[] = [];
  for (const theme of data.themes) {
    const pictures: PortraitPicture[] = [];
    for (const e of theme.entries) {
      if (`portrait:${id}/${theme.id}/${e.stem}`.length > 64) continue;
      const full = urlOf ? (urlOf(e.avatarPath) ?? null) : null;
      if (urlOf && !full) continue;
      const preview = urlOf && e.previewPath ? (urlOf(e.previewPath) ?? null) : null;
      pictures.push({ pack: id, theme: theme.id, stem: e.stem, key: `${id}/${theme.id}/${e.stem}`, family: e.family, source, full, preview });
    }
    if (pictures.length) themes.push({ id: theme.id, name: theme.name, ...(theme.names ? { names: theme.names } : {}), ...(theme.subtitle ? { subtitle: theme.subtitle } : {}), ...(theme.cover ? { cover: theme.cover } : {}), pictures });
  }
  return { id, name: data.name, source, themes };
}

/** Glob result (`…/portraits/<pack>.json` → manifest) → shipped packs by id, pictures at `<base>avatars/portraits/<pack>/<path>`. */
export function bundledPacks(manifests: Record<string, unknown>, base: string): PortraitPack[] {
  const out: PortraitPack[] = [];
  for (const [path, json] of Object.entries(manifests)) {
    const m = /\/portraits\/([a-z0-9][a-z0-9-]{0,19})\.json$/.exec(path);
    const data = m ? parsePackManifest(json) : null;
    if (!m || !data) continue;
    const pack = packOf(m[1]!, data, "bundled", (p) => `${base}avatars/portraits/${m[1]}/${p}`);
    if (pack.themes.length) out.push(pack);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Shipped, then the owner's; an owner's pack with a shipped id takes its place. */
export function mergePacks(bundled: readonly PortraitPack[], user: readonly PortraitPack[]): PortraitPack[] {
  const mine = new Map(user.map((p) => [p.id, p]));
  const merged = bundled.map((p) => mine.get(p.id) ?? p);
  return [...merged, ...user.filter((p) => !bundled.some((b) => b.id === p.id)).sort((a, b) => a.id.localeCompare(b.id))];
}

/** Family names as the owner reads them (pickers, Settings counts). */
export const FAMILY_LABEL: Record<PortraitFamily, string> = { claude: "Claude", openai: "GPT", gemini: "Gemini", deepseek: "DeepSeek", kimi: "Kimi", glm: "GLM", other: "…" };

/** The display name of a pack (its manifest's, else its id). */
export function packName(pack: Pick<PortraitPack, "id" | "name">, locale: string): string {
  const n = pack.name;
  if (!n) return pack.id;
  if (typeof n === "string") return n;
  return (locale.startsWith("zh") ? (n["zh-CN"] ?? n.en) : (n.en ?? n["zh-CN"])) ?? pack.id;
}

// ── lookup, fallback, picking (pure) ─────────────────────────────────────────────────────────────────

export interface PortraitIndex {
  packs: readonly PortraitPack[];
  byKey: Map<string, PortraitPicture>;
  /** `pack/theme/family`, `pack/*\/family`, `*\/family` → pictures in pack / manifest order. */
  pools: Map<string, PortraitPicture[]>;
  /** Pools of enabled-theme sets, built on first use. */
  unions: Map<string, PortraitPicture[]>;
}

export function indexPacks(packs: readonly PortraitPack[]): PortraitIndex {
  const byKey = new Map<string, PortraitPicture>();
  const pools = new Map<string, PortraitPicture[]>();
  const add = (k: string, p: PortraitPicture) => {
    const list = pools.get(k);
    if (list) list.push(p);
    else pools.set(k, [p]);
  };
  for (const pack of packs)
    for (const theme of pack.themes)
      for (const p of theme.pictures) {
        byKey.set(p.key, p);
        add(`${pack.id}/${theme.id}/${p.family}`, p);
        add(`${pack.id}/*/${p.family}`, p);
        add(`*/${p.family}`, p);
      }
  return { packs, byKey, pools, unions: new Map() };
}

/** FNV-1a: a stable 32-bit hash of an agent id. */
export function seedHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** From hash(seed) on, the first picture not in `used` (all used → the hash's own); null for an empty pool. */
export function pickPortrait(pool: readonly PortraitPicture[] | undefined, seed: string, used?: ReadonlySet<string>): PortraitPicture | null {
  if (!pool?.length) return null;
  const start = seedHash(seed) % pool.length;
  if (used?.size) for (let i = 0; i < pool.length; i++) {
    const p = pool[(start + i) % pool.length]!;
    if (!used.has(p.key)) return p;
  }
  return pool[start]!;
}

/**
 * The pool of the enabled themes (`pack/theme` keys) for a family: their pictures in pack and theme order (so a
 * pick does not depend on the order the owner ticked them); empty when none is enabled / installed, the family is
 * unknown ("other": wait for the model / Profile instead of guessing) or the themes hold no picture of it — a
 * portrait is never another family's face (owner 2026-10-28).
 */
export function poolFor(index: PortraitIndex, enabled: readonly string[] | null | undefined, family: PortraitFamily | null | undefined): PortraitPicture[] {
  if (!enabled?.length || !family) return [];
  const on = new Set(enabled);
  const key = `${family}|${[...on].sort().join(",")}`;
  let pool = index.unions.get(key);
  if (!pool) {
    pool = [];
    for (const pack of index.packs) for (const theme of pack.themes) if (on.has(`${pack.id}/${theme.id}`)) pool.push(...(index.pools.get(`${pack.id}/${theme.id}/${family}`) ?? []));
    index.unions.set(key, pool);
  }
  return pool;
}

export interface Resolved {
  picture: PortraitPicture;
  /** The stored picture is gone: this is a stand-in (same theme → same pack → any pack, by the agent's hash). */
  fallback: boolean;
}

/**
 * A stored picture → what to show: itself; gone → by hash(seed) in the same pack + theme + family, else the same
 * pack + family, else any installed pack's family; null = nothing fits (the default avatar). Never written back.
 */
export function resolvePortrait(index: PortraitIndex, ref: PortraitRef, seed: string): Resolved | null {
  const exact = index.byKey.get(portraitKey(ref));
  if (exact) return { picture: exact, fallback: false };
  const family = familyOfModel(ref.stem.replace(/[-_]v?\d+$/, ""));
  for (const k of [`${ref.pack}/${ref.theme}/${family}`, `${ref.pack}/*/${family}`, `*/${family}`]) {
    const p = pickPortrait(index.pools.get(k), seed);
    if (p) return { picture: p, fallback: true };
  }
  return null;
}

/**
 * What an agent shows from the packs: its stored picture (or stand-in), or the enabled themes' pick when it has none.
 * `usedInProject` (lib/agentLook portraitsWornIn): the pictures stored by its project's members — the pick skips them
 * like the one the 新建 page / lib/portraitSave stores (pickForNewAgent), so storing it changes nothing on screen.
 */
export function portraitFor(index: PortraitIndex, avatar: SessionAvatar | null | undefined, seed: string | null | undefined, family: PortraitFamily | null | undefined, enabled: readonly string[] | null | undefined, usedInProject?: ReadonlySet<string>): Resolved | null {
  if (!seed) return null;
  const ref = portraitRefOf(avatar);
  if (ref) return resolvePortrait(index, ref, seed);
  if (avatar) return null;
  const p = pickPortrait(poolFor(index, enabled, family), seed, usedInProject);
  return p ? { picture: p, fallback: false } : null;
}

export interface AgentForPortrait {
  seed: string;
  hostId: string;
  projectId: string | null;
  family: PortraitFamily | null;
  avatar: SessionAvatar | null;
}

export interface AvatarChange {
  seed: string;
  hostId: string;
  before: SessionAvatar | null;
  after: SessionAvatar;
}

const projectOf = (a: Pick<AgentForPortrait, "hostId" | "projectId">) => `${a.hostId}\u0000${a.projectId ?? ""}`;

/**
 * 「都换成勾选的主题」: every agent without an avatar or wearing a pack picture gets a new pick from the
 * enabled themes (hash start, skipping pictures already given in its project); emoji / colour / uploaded / Director
 * avatars are left alone. Agents whose pick equals what they wear are left out.
 */
export function planReplaceAll(index: PortraitIndex, agents: readonly AgentForPortrait[], enabled: readonly string[]): AvatarChange[] {
  const used = new Map<string, Set<string>>();
  const out: AvatarChange[] = [];
  for (const a of [...agents].sort((x, y) => x.seed.localeCompare(y.seed))) {
    if (a.avatar && !portraitRefOf(a.avatar)) continue;
    const taken = used.get(projectOf(a)) ?? new Set<string>();
    used.set(projectOf(a), taken);
    const p = pickPortrait(poolFor(index, enabled, a.family), a.seed, taken);
    if (!p) continue;
    taken.add(p.key);
    const after = portraitAvatarOf(p);
    if (a.avatar?.value !== after.value) out.push({ seed: a.seed, hostId: a.hostId, before: a.avatar, after });
  }
  return out;
}

/** Agents whose stored picture is gone and that show a stand-in now. */
export function fallenBack(index: PortraitIndex, agents: readonly AgentForPortrait[]): AgentForPortrait[] {
  return agents.filter((a) => {
    const ref = portraitRefOf(a.avatar);
    return !!ref && !index.byKey.has(portraitKey(ref));
  });
}

/**
 * Agents whose stored picture is another family's face than their own (owner 2026-10-28: a picture picked while
 * the family read "other" — a GPT agent wearing a GLM face). Judged only when the agent's own family is known.
 */
export function familyMismatched(index: PortraitIndex, agents: readonly AgentForPortrait[]): AgentForPortrait[] {
  return agents.filter((a) => {
    const ref = portraitRefOf(a.avatar);
    if (!ref) return false;
    const family = a.family ?? familyOfModel(modelOfStem(ref.stem));
    return family !== "other" && familyOfModel(modelOfStem(ref.stem)) !== family;
  });
}

/**
 * 「重新分配」 (修复缺图): agents whose picture is gone, or that wear another family's face, get a picture of
 * their stored theme (else pack, else any pack) for their family, skipping pictures already worn in their project;
 * nothing fits = left alone (default avatar). The owner presses the button — nothing is rewritten silently.
 */
export function planReassign(index: PortraitIndex, agents: readonly AgentForPortrait[]): AvatarChange[] {
  const used = new Map<string, Set<string>>();
  const mismatched = new Set(familyMismatched(index, agents).map((a) => `${projectOf(a)}\u0000${a.seed}`));
  for (const a of agents) {
    const ref = portraitRefOf(a.avatar);
    if (ref && index.byKey.has(portraitKey(ref)) && !mismatched.has(`${projectOf(a)}\u0000${a.seed}`)) {
      const set = used.get(projectOf(a)) ?? new Set<string>();
      set.add(portraitKey(ref));
      used.set(projectOf(a), set);
    }
  }
  const out: AvatarChange[] = [];
  const targets = [...new Map([...fallenBack(index, agents), ...familyMismatched(index, agents)].map((a) => [`${projectOf(a)}\u0000${a.seed}`, a])).values()].sort((x, y) => x.seed.localeCompare(y.seed));
  for (const a of targets) {
    const ref = portraitRefOf(a.avatar)!;
    const family = a.family ?? familyOfModel(ref.stem.replace(/[-_]v?\d+$/, ""));
    const taken = used.get(projectOf(a)) ?? new Set<string>();
    used.set(projectOf(a), taken);
    let p: PortraitPicture | null = null;
    for (const k of [`${ref.pack}/${ref.theme}/${family}`, `${ref.pack}/*/${family}`, `*/${family}`]) if ((p = pickPortrait(index.pools.get(k), a.seed, taken))) break;
    if (!p) continue;
    taken.add(p.key);
    out.push({ seed: a.seed, hostId: a.hostId, before: a.avatar, after: portraitAvatarOf(p) });
  }
  return out;
}

/** A new agent's picture (NewAgentPage): the enabled themes' pool for its family, skipping pictures worn in its project. */
export function pickForNewAgent(index: PortraitIndex, enabled: readonly string[], family: PortraitFamily | null, seed: string, usedInProject: ReadonlySet<string>): SessionAvatar | null {
  const p = pickPortrait(poolFor(index, enabled, family), seed, usedInProject);
  return p ? portraitAvatarOf(p) : null;
}

// ── the collection, loaded once per window ─────────────────────────────────────────────────────────

export const BUNDLED_PORTRAIT_PACKS: readonly PortraitPack[] = bundledPacks(
  import.meta.glob("../assets/avatars/portraits/*.json", { eager: true, import: "default" }),
  // "/" in dev, "./" in the packaged app (index.html loads from file://).
  import.meta.env.BASE_URL,
);

export interface PortraitPacksView {
  packs: readonly PortraitPack[];
  index: PortraitIndex;
  /** The owner's folder (null until main answered / no bridge). */
  dir: string | null;
  skipped: number;
  ready: boolean;
}

function bridge(): PortraitPacksBridge | undefined {
  return (globalThis as { cutex?: PreloadBridge }).cutex?.portraitPacks;
}

const viewOf = (packs: readonly PortraitPack[], dir: string | null, skipped: number, ready: boolean): PortraitPacksView => ({ packs, index: indexPacks(packs), dir, skipped, ready });

let view = viewOf(BUNDLED_PORTRAIT_PACKS, null, 0, false);
let loading: Promise<void> | null = null;
const images = new Map<string, string | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

function apply(state: PortraitPacksState | null): void {
  const user = (state?.packs ?? []).map((p) => packOf(p.id, p, "user"));
  view = viewOf(mergePacks(BUNDLED_PORTRAIT_PACKS, user), typeof state?.dir === "string" ? state.dir : null, state?.skipped ?? 0, true);
  images.clear();
  emit();
}

/** Reads the owner's folder once (later calls: no-op unless `refresh`). */
export function loadPortraitPacks(refresh = false): Promise<void> {
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

export async function openPortraitPackFolder(): Promise<void> {
  const source = bridge();
  if (!source) return;
  apply(await source.openFolder());
}

export const canOpenPortraitPackFolder = (): boolean => !!bridge();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const snapshot = () => view;

/** Called when the installed packs change (outside React: lib/portraitSave). */
export const subscribePortraitPacks = subscribe;

/** Every installed pack (reads the owner's folder on first use). */
export function usePortraitPacks(): PortraitPacksView {
  useEffect(() => {
    void loadPortraitPacks();
  }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The index without subscribing to the owner's folder being read (outside React: menus, creation). */
export const portraitIndexNow = (): PortraitIndex => view.index;

/** Which file to show at `size` px: the 64 px preview up to 32 px, else the full picture. */
export const imageKindFor = (size: number): PortraitImageKind => (size <= 32 ? "preview" : "full");

function imageNow(p: PortraitPicture, kind: PortraitImageKind): string | null {
  if (p.source === "bundled") return (kind === "preview" ? p.preview : null) ?? p.full;
  return images.get(`${p.key}|${kind}`) ?? null;
}

function requestImage(p: PortraitPicture, kind: PortraitImageKind): void {
  const k = `${p.key}|${kind}`;
  if (p.source === "bundled" || images.has(k) || pending.has(k)) return;
  const source = bridge();
  if (!source) return;
  pending.add(k);
  void source
    .image(p, kind)
    .then(
      (url) => images.set(k, typeof url === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(url) ? url : null),
      () => images.set(k, null),
    )
    .finally(() => {
      pending.delete(k);
      emit();
    });
}

/** A picture's URL at `size` (the owner's pictures: loaded on first use; null meanwhile / when gone). */
export function usePortraitImage(picture: PortraitPicture | null | undefined, size: number): string | null {
  const kind = imageKindFor(size);
  useEffect(() => {
    if (picture) requestImage(picture, kind);
  }, [picture, kind]);
  return useSyncExternalStore(subscribe, () => (picture ? imageNow(picture, kind) : null), () => null);
}

/** Tests. */
export function resetPortraitPacksForTest(packs: readonly PortraitPack[] = BUNDLED_PORTRAIT_PACKS): void {
  view = viewOf(packs, null, 0, true);
  images.clear();
  pending.clear();
  loading = null;
  emit();
}
