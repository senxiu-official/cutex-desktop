// 桌面 / 个人页 — the home document's pure model (docs/research/home-page-20261019.md; cutex `user-home`):
// defaults, blocks, pins (the tray's: add / remove / reorder), the desktop's icons and which host holds the settings. Unit-tested
// in test/homeModel.test.ts. The document is the client's: unknown keys are kept as they are.
import type { HomeBlock, HomeDoc, HomePin, HomePinKind, HomeTileSize } from "../../../../shared/home";
import { HOME_MAX_PINS, readHomePin, USER_HOME_FEATURE, USER_HOME_PAGE_PINS_FEATURE } from "../../../../shared/home";
import { parseArtifactRef } from "../../../../shared/artifactStore";
import type { CutexRef } from "../slots";

/** The desktop's blocks, in their default order (编辑主页 shows / hides and reorders them). */
export const BLOCK_IDS = ["profile", "clock", "needs", "stats", "tiles"] as const;
export type BlockId = (typeof BLOCK_IDS)[number];
/** The layout id written to `home.layout` (the owner chose 「C 的背景 + A/B 的结构」). */
export const LAYOUT_ID = "desk-c1";

export interface BlockView {
  id: BlockId;
  visible: boolean;
}

/** The blocks in display order: stored ones first (known ids only), missing ones appended, visible. */
export function homeBlocks(doc: HomeDoc | null): BlockView[] {
  const stored = (doc?.blocks ?? []).filter((b): b is HomeBlock & { id: BlockId } => (BLOCK_IDS as readonly string[]).includes(b.id));
  const seen = new Set(stored.map((b) => b.id));
  return [...stored.map((b) => ({ id: b.id, visible: b.visible })), ...BLOCK_IDS.filter((id) => !seen.has(id)).map((id) => ({ id, visible: true }))];
}

export const blockVisible = (doc: HomeDoc | null, id: BlockId): boolean => homeBlocks(doc).find((b) => b.id === id)?.visible ?? true;

/** The blocks with one shown / hidden (unknown stored blocks of a newer desktop are kept at the end). */
export function withBlockVisible(doc: HomeDoc, id: BlockId, visible: boolean): HomeDoc {
  return withBlocks(doc, homeBlocks(doc).map((b) => (b.id === id ? { ...b, visible } : b)));
}

/** Moves a block one step up (-1) or down (+1). */
export function withBlockMoved(doc: HomeDoc, id: BlockId, step: -1 | 1): HomeDoc {
  const blocks = homeBlocks(doc);
  const i = blocks.findIndex((b) => b.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= blocks.length) return doc;
  const next = [...blocks];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return withBlocks(doc, next);
}

function withBlocks(doc: HomeDoc, blocks: BlockView[]): HomeDoc {
  const others = (doc.blocks ?? []).filter((b) => !(BLOCK_IDS as readonly string[]).includes(b.id));
  const kept = new Map((doc.blocks ?? []).map((b) => [b.id, b]));
  return { ...doc, blocks: [...blocks.map((b) => ({ ...kept.get(b.id), id: b.id, visible: b.visible })), ...others] };
}

/** 没有窗格时显示桌面 (default on). */
export const showWhenEmpty = (doc: HomeDoc | null): boolean => doc?.showWhenEmpty !== false;
/** The 「桌面」 entry at the top of the sidebar (default on: the owner wanted both entrances). */
export const sidebarEntry = (doc: HomeDoc | null): boolean => doc?.sidebarEntry !== false;

// ── Pins ────────────────────────────────────────────────────────────────────────────────────────

export const pinId = (p: Pick<HomePin, "hostId" | "kind" | "key">): string => `${p.hostId}\n${p.kind}\n${p.key}`;
export const pinsOf = (doc: HomeDoc | null): HomePin[] => doc?.pins ?? [];
export const isPinned = (doc: HomeDoc | null, p: Pick<HomePin, "hostId" | "kind" | "key">): boolean => pinsOf(doc).some((x) => pinId(x) === pinId(p));

/** The default tile size per kind: services and pages medium (icon + name + state), the rest small. */
export const defaultSize = (kind: HomePinKind): HomeTileSize => (kind === "service" || kind === "page" ? "m" : "s");
export const sizeOf = (p: HomePin): HomeTileSize => p.size ?? defaultSize(p.kind);

/** Pinned (appended; already pinned = unchanged; full = unchanged). */
export function withPin(doc: HomeDoc, pin: HomePin): HomeDoc {
  if (isPinned(doc, pin) || pinsOf(doc).length >= HOME_MAX_PINS) return doc;
  return trayChange(doc, { ...doc, pins: [...pinsOf(doc), pin] });
}

export function withoutPin(doc: HomeDoc, id: string): HomeDoc {
  const pins = pinsOf(doc);
  const next = pins.filter((p) => pinId(p) !== id);
  return next.length === pins.length ? doc : trayChange(doc, { ...doc, pins: next });
}

/** Moves the pin `id` to index `to` (drag to reorder; clamped). */
export function withPinMoved(doc: HomeDoc, id: string, to: number): HomeDoc {
  const pins = [...pinsOf(doc)];
  const from = pins.findIndex((p) => pinId(p) === id);
  if (from < 0) return doc;
  const [pin] = pins.splice(from, 1);
  const at = Math.max(0, Math.min(pins.length, to));
  if (at === from) return doc;
  pins.splice(at, 0, pin!);
  return trayChange(doc, { ...doc, pins });
}

/**
 * Moves pin `id` to just before pin `beforeId` (the tray's pinned agents, owner 2026-10-24); `beforeId` null = after
 * the last pin of `id`'s kind (the end of its group: agents stay before the apps they share the list with). The
 * same document when nothing moves. Pure.
 */
export function withPinBefore(doc: HomeDoc, id: string, beforeId: string | null): HomeDoc {
  const pins = pinsOf(doc);
  const from = pins.findIndex((p) => pinId(p) === id);
  if (from < 0 || beforeId === id) return doc;
  const rest = pins.filter((_, i) => i !== from);
  let at: number;
  if (beforeId === null) {
    const kind = pins[from]!.kind;
    let last = -1;
    rest.forEach((p, i) => (p.kind === kind ? (last = i) : undefined));
    at = last + 1;
  } else {
    at = rest.findIndex((p) => pinId(p) === beforeId);
    if (at < 0) return doc;
  }
  if (at === from) return doc;
  return trayChange(doc, { ...doc, pins: [...rest.slice(0, at), pins[from]!, ...rest.slice(at)] });
}

/** Pinned again at `index` (取消固定's 撤销; already pinned = unchanged). */
export function withPinAt(doc: HomeDoc, pin: HomePin, index: number): HomeDoc {
  const next = withPin(doc, pin);
  return next === doc ? doc : withPinMoved(next, pinId(pin), index);
}

/** 固定到托盘 / 取消固定 in one step (the tray's pins only: the desktop's icons are their own list). */
export function withPinToggled(doc: HomeDoc, pin: HomePin): HomeDoc {
  return isPinned(doc, pin) ? withoutPin(doc, pinId(pin)) : withPin(doc, pin);
}

// ── The desktop's icons ─────────────────────────────────────────────────────────────────────────
// Owner 2026-10-24: the tray's pins and the desktop's icons are two lists. Pinning in the tray puts nothing on the
// desktop and unpinning there never removes an icon; an icon goes onto the desktop when an avatar is dragged there from
// the tray (or 放到桌面 / the desktop's 添加图标) and leaves by the desktop's own 从桌面移除. `HomeDoc.deskIcons` (a
// client key cutex keeps as it is) holds them. Absent (a document from before): the desktop shows the pins, as it did;
// the first change of either list copies the pins in once, so nothing the owner sees disappears. An older desktop
// ignores the key and still shows the pins.

/** Whether the document has its own desktop icon list yet. */
export const deskIconsStored = (doc: HomeDoc | null): boolean => Array.isArray(doc?.deskIcons);

/** The desktop's icons in order (malformed entries and repeats dropped); before the split: the tray's pins. */
export function deskIconsOf(doc: HomeDoc | null): HomePin[] {
  if (!doc) return [];
  if (!Array.isArray(doc.deskIcons)) return pinsOf(doc);
  const seen = new Set<string>();
  const out: HomePin[] = [];
  for (const raw of doc.deskIcons) {
    const pin = readHomePin(raw);
    if (!pin || seen.has(pinId(pin))) continue;
    seen.add(pinId(pin));
    out.push(pin);
  }
  return out;
}

export const isOnDesk = (doc: HomeDoc | null, p: Pick<HomePin, "hostId" | "kind" | "key">): boolean => deskIconsOf(doc).some((x) => pinId(x) === pinId(p));

const withIcons = (doc: HomeDoc, icons: HomePin[]): HomeDoc => ({ ...doc, deskIcons: icons as unknown as HomeDoc["deskIcons"] });

/** A change of the tray's pins: the desktop's icons are fixed first (the one copy of the pins, see above). */
function trayChange(before: HomeDoc, next: HomeDoc): HomeDoc {
  return deskIconsStored(before) ? next : withIcons(next, pinsOf(before));
}

/** An icon on the desktop (appended; already there or full = unchanged). */
export function withDeskIcon(doc: HomeDoc, pin: HomePin): HomeDoc {
  const icons = deskIconsOf(doc);
  if (icons.some((x) => pinId(x) === pinId(pin)) || icons.length >= HOME_MAX_PINS) return doc;
  return withIcons(doc, [...icons, pin]);
}

/** The desktop's 从桌面移除 (the tray keeps its pin). */
export function withoutDeskIcon(doc: HomeDoc, id: string): HomeDoc {
  const icons = deskIconsOf(doc);
  const next = icons.filter((p) => pinId(p) !== id);
  return next.length === icons.length ? doc : withIcons(doc, next);
}

/** An icon's tile size (older desktops read it as the nearest preset). */
export function withDeskIconSize(doc: HomeDoc, id: string, size: HomeTileSize): HomeDoc {
  const icons = deskIconsOf(doc);
  return icons.some((p) => pinId(p) === id) ? withIcons(doc, icons.map((p) => (pinId(p) === id ? { ...p, size } : p))) : doc;
}

/**
 * Whether the home page source keeps `page` pins: a host with `user-home` only with `user-home-page-pins`
 * (an older one refuses them: 400 invalid_home), a host without `user-home` keeps the list on this device
 * (any kind). Unknown capabilities (not connected / not read yet): no.
 */
export function pagePinsKept(features: ReadonlySet<string> | null): boolean {
  if (!features) return false;
  return !features.has(USER_HOME_FEATURE) || features.has(USER_HOME_PAGE_PINS_FEATURE);
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SERVICE_LINK = /^cutex:service\/([a-z0-9][a-z0-9-]{0,62})(?:\/|$)/;

/** The ref kinds 固定到主页 applies to (the agent menu, a service, an artifact tab, a browser tab). */
export const PIN_REF_KINDS = ["agent", "service", "artifact", "artifacts.view", "browser.tab"] as const;

/** A referable thing → its pin (null: not pinnable). */
export function pinOfRef(ref: CutexRef): HomePin | null {
  const title = ref.title?.trim().slice(0, 200) || undefined;
  const base = (kind: HomePinKind, key: string): HomePin => ({ hostId: ref.hostId, kind, key, ...(title ? { title } : {}) });
  switch (ref.kind) {
    case "agent":
      return ref.key ? base("agent", ref.key) : null;
    case "service": {
      const slug = ref.key.split("/")[0]!;
      return SLUG.test(slug) ? base("service", slug) : null;
    }
    case "artifact":
    case "artifacts.view": {
      const key = ref.kind === "artifacts.view" ? (ref.params.ref ?? ref.key) : ref.key;
      return parseArtifactRef(key) ? base("artifact", key) : null;
    }
    case "browser.tab": {
      const url = ref.params.url ?? ref.key;
      const service = SERVICE_LINK.exec(url);
      if (service) return base("service", service[1]!);
      return /^https?:\/\//i.test(url) && url.length <= 2048 ? base("url", url) : null;
    }
    default:
      return null;
  }
}

// ── The home host ───────────────────────────────────────────────────────────────────────────────

export interface HostChoice {
  id: string;
  connected: boolean;
  /** This desktop is the host's owner (unknown counts as the owner). */
  owner: boolean;
  local: boolean;
}

/**
 * Where the settings are read first: this machine's host if it is connected, else the first connected
 * owner host (switcher order). null: no connected owner host.
 */
export function bootHost(hosts: readonly HostChoice[]): string | null {
  const local = hosts.find((h) => h.local && h.connected && h.owner);
  return local?.id ?? hosts.find((h) => h.connected && h.owner)?.id ?? null;
}

/** The host the desktop treats as the home page source: the boot host's `homeHost` when that host is connected and owned, else the boot host. */
export function homeHostOf(boot: string | null, stored: string | null | undefined, hosts: readonly HostChoice[]): string | null {
  if (!boot) return null;
  if (stored && stored !== boot && hosts.some((h) => h.id === stored && h.connected && h.owner)) return stored;
  return boot;
}
