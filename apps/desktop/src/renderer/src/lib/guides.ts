// Guides (owner 2026-10-24): ONE registry of everything that teaches — the onboarding flow, anchored first-use tips
// and inline panels — with a per-device seen state. The onboarding host (components/OnboardingDialog), the tip host
// (components/FirstUseTips), inline panels (components/InlineGuide) and Settings → 帮助 (modules/onboarding/HelpPage)
// all read it. Adding / retiring a guide: docs/desktop-modules.md § Guides.
//
// Rules: a tip shows once, small, beside its anchor, never as a blocking modal, only where behaviour is surprising, a
// gesture is hidden or there is a consequence to know right then. A guide is live from `since` on and never after
// `retireAfter` (it then also leaves 帮助). Seen state is a list of ids (schema 1), so adding a guide needs no
// migration; ids of retired guides are simply ignored. The first time any guide would show on a device, the user is
// asked once whether to see guides at all (「全部跳过」 — e.g. a second device); skip-all marks every live guide seen
// (帮助 still replays each); a guide added in a later version shows again unless skipped again (each tip carries its
// own 「跳过所有引导」). 「重置所有提示」 forgets what was seen.
//
// Panel guides (kind "panel", lib/panelGuides) are the exception: shown only when asked for (a panel's 「使用小指南」 or
// 帮助), so 全部跳过 / 重置 / the host's skip never touch them; finishing one records `panel.<id>@<version>`.
import { useSyncExternalStore } from "react";
import { compareVersions, parseVersion } from "../../../shared/binaryUpdate";
import type { MessageKey } from "../i18n";
import type { SettingsTab } from "../store";
import { finishOnboarding, openOnboarding } from "./onboarding";
import type { PanelGuideRequest, PanelId } from "./panelGuides";
import { isHTMLElement } from "./ownerWindow";
import { activeAppDocument } from "./appWindowSet";

export type GuideKind = "onboarding" | "tip" | "inline" | "panel";

/** How an anchored tip is triggered: `appear` = its anchor is on screen; `hover` = the pointer rests on it / it gets focus. */
export type TipTrigger = "appear" | "hover";

export interface Guide {
  id: string;
  kind: GuideKind;
  /** The version it was introduced in (it shows from there on). */
  since: string;
  /** Last version it shows in; later ones never show it and 帮助 leaves it out. */
  retireAfter?: string;
  /** Its name in 帮助. */
  title: MessageKey;
  /** What it says (terms-aware: {{agent}} / {{director}} …); 帮助 shows its first line. */
  text: MessageKey;
  /** Tips: the element it points at (CSS selector), and what shows it. */
  anchor?: string;
  trigger?: TipTrigger;
  /** Tips: a further check on a matching anchor (e.g. a Shelf with 2+ tabs). */
  when?: (anchor: HTMLElement) => boolean;
  /** Another guide it links to (「也看看：…」). */
  related?: string;
  /** Guides that count as seen once this one shows (it says what they say, and more). */
  covers?: readonly string[];
  /** A place in Settings it can link to. */
  settings?: SettingsTab;
  /** Onboarding guides: replay; panel guides: open. */
  replay?: () => void;
  /** Panel guides: which (lib/panelGuides). */
  panel?: PanelId;
}

const V02 = "0.2.0";

export const GUIDES: readonly Guide[] = [
  { id: "onboarding", kind: "onboarding", since: "0.1.0", title: "onboarding.guide.onboarding.title", text: "onboarding.guide.onboarding.text", replay: () => openOnboarding({ kind: "intro" }) },
  { id: "onboarding.v02", kind: "onboarding", since: V02, title: "onboarding.guide.v02.title", text: "onboarding.guide.v02.text", replay: () => openOnboarding({ kind: "whatsNew", version: V02 }) },
  // Inline panels (components/InlineGuide): the new-Profile form, one per type, until a Profile of that type exists.
  { id: "inline.profile.apiKey", kind: "inline", since: V02, title: "onboarding.guide.profile.apiKey.title", text: "onboarding.guide.profile.apiKey.text", settings: "profiles" },
  { id: "inline.profile.chatgpt", kind: "inline", since: V02, title: "onboarding.guide.profile.chatgpt.title", text: "onboarding.guide.profile.chatgpt.text", settings: "profiles" },
  { id: "inline.profile.claude", kind: "inline", since: V02, title: "onboarding.guide.profile.claude.title", text: "onboarding.guide.profile.claude.text", settings: "profiles" },
  // Anchored tips (components/FirstUseTips), in the order they are checked.
  // A Director created an agent on its own (cutex session-created-by): on that row. Without that record (older cutex,
  // sessions from before it) the tile's meaning is explained on any minor agent's row instead.
  { id: "tip.directorCreated", kind: "tip", since: V02, title: "onboarding.guide.directorCreated.title", text: "onboarding.guide.directorCreated.text", anchor: "[data-row-selectable][data-created-by=director]", settings: "sidebar", covers: ["tip.minorAgent"] },
  { id: "tip.minorAgent", kind: "tip", since: V02, title: "onboarding.guide.minorAgent.title", text: "onboarding.guide.minorAgent.text", anchor: "[data-row-selectable] [data-avatar=dot]", when: (el) => !el.closest("[data-row-selectable]")?.hasAttribute("data-created-by"), settings: "sidebar" },
  { id: "tip.project", kind: "tip", since: V02, title: "onboarding.guide.project.title", text: "onboarding.guide.project.text", anchor: "section[data-group-key] > div:first-child", when: (el) => isProjectGroup(el.parentElement) },
  { id: "tip.needsYou", kind: "tip", since: V02, title: "onboarding.guide.needsYou.title", text: "onboarding.guide.needsYou.text", anchor: "[data-needs-you-strip] [data-chip-tone=urgent], [data-tray-needs], [data-tail-tier=attention]:not([data-tail-tone=danger])" },
  { id: "tip.delegation", kind: "tip", since: V02, title: "onboarding.guide.delegation.title", text: "onboarding.guide.delegation.text", anchor: "[data-delegation-card]", related: "tip.rideAlong" },
  { id: "tip.rideAlong", kind: "tip", since: V02, title: "onboarding.guide.rideAlong.title", text: "onboarding.guide.rideAlong.text", anchor: "[data-testid=queue-next-step][data-ask-id], [data-testid=timing-wait], [data-testid=timing-starts-now]", settings: "collab", related: "tip.delegation" },
  { id: "tip.shelf", kind: "tip", since: V02, title: "onboarding.guide.shelf.title", text: "onboarding.guide.shelf.text", anchor: "[data-side-tab-row]", when: (el) => (el.closest("[data-side-card]")?.querySelectorAll("[role=tab]").length ?? 0) >= 2 || el.ownerDocument.querySelectorAll("[data-shelf]:not([data-shelf-collapsed])").length >= 2 },
  // Portrait (owner 2026-10-30, lib/portrait): the first time a window shows the stack — its divider (drag, double-click,
  // ⇅) and where the sidebar went; the way back to landscape.
  { id: "tip.portrait", kind: "tip", since: "0.2.3", title: "onboarding.guide.portrait.title", text: "onboarding.guide.portrait.text", anchor: "[data-portrait-divider]", settings: "appearance" },
  { id: "tip.tray", kind: "tip", since: V02, title: "onboarding.guide.tray.title", text: "onboarding.guide.tray.text", anchor: "[data-tray-item]", settings: "tray" },
  { id: "tip.service", kind: "tip", since: V02, title: "onboarding.guide.service.title", text: "onboarding.guide.service.text", anchor: "[data-cutex-ref=service], [data-service-link], [data-conv-item=network]" },
  { id: "tip.update", kind: "tip", since: V02, title: "onboarding.guide.update.title", text: "onboarding.guide.update.text", anchor: "[data-update-button], [data-host-switcher][data-hosts-version-differs]", settings: "updates" },
  { id: "tip.remote", kind: "tip", since: V02, title: "onboarding.guide.remote.title", text: "onboarding.guide.remote.text", anchor: "[data-host-switcher][data-hosts-remote]", settings: "hosts" },
  // Panel guides (lib/panelGuides, loaded when asked for): only on request; 帮助 opens them on the panel in view.
  ...(["shelf", "tray", "sidebar", "conversation"] as const).map(
    (panel): Guide => ({ id: `panel.${panel}`, kind: "panel", panel, since: V02, title: `onboarding.panel.${panel}.title` as MessageKey, text: `onboarding.panel.${panel}.text` as MessageKey, replay: () => void import("./panelGuides").then((m) => m.openPanelGuide(helpRequest(panel))) }),
  ),
];

/** 帮助 → a panel guide: the panel in view (the focused conversation, its Shelf). */
function helpRequest(panel: PanelId): PanelGuideRequest {
  if (typeof document === "undefined") return { panel };
  // The app window in front (a desk window's conversation, multi-window).
  const doc = activeAppDocument();
  const focused = doc.querySelector<HTMLElement>("[data-conv-pane][data-pane-focused] [data-conv-header], [data-conv-header]");
  const paneId = focused?.getAttribute("data-conv-header") ?? null;
  return { panel, paneId, opener: isHTMLElement(doc.activeElement) ? doc.activeElement : null };
}

/** The guides that prompt by themselves (everything but the panel guides): what 全部跳过 and the host's skip cover. */
const prompting = (g: Guide) => g.kind !== "panel";

/** A sidebar group of a project (not 独立 / 快速对话; the key may carry a host prefix). */
function isProjectGroup(el: Element | null): boolean {
  const key = el?.getAttribute("data-group-key") ?? "";
  return !!key && !/__(independent|chats)__$/.test(key);
}

/** The guides live in `version` (null = unknown, e.g. a dev build: all that are not retired by a known version). */
export function liveGuides(version: string | null, all: readonly Guide[] = GUIDES): Guide[] {
  const now = parseVersion(version);
  return all.filter((g) => {
    if (!now) return true;
    const since = parseVersion(g.since);
    const retire = g.retireAfter ? parseVersion(g.retireAfter) : null;
    return (!since || compareVersions(now, since) >= 0) && (!retire || compareVersions(now, retire) <= 0);
  });
}

export function guideById(id: string): Guide | undefined {
  return GUIDES.find((g) => g.id === id);
}

// ---- seen state (per device) ----

export const GUIDES_KEY = "cutex-desktop.guides";
/** The first-use tips of the first 0.2 draft (tray / shelf / home); their ids carry over. */
const LEGACY_TIPS_KEY = "cutex-desktop.first-use-tips";
const SCHEMA = 1;

export interface GuideState {
  schema: 1;
  /** Ids seen (shown once, dismissed, or skipped). */
  seen: string[];
  /** The one-time 「要看引导和提示吗？」 was answered. */
  asked: boolean;
}

function load(): GuideState {
  let raw: Partial<GuideState> | null = null;
  try {
    raw = JSON.parse(localStorage.getItem(GUIDES_KEY) ?? "null") as Partial<GuideState> | null;
  } catch {
    raw = null;
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.seen)) return { schema: SCHEMA, seen: raw.seen.filter((v): v is string => typeof v === "string"), asked: raw.asked === true };
  // First load of schema 1: the draft's tips (a list of ids) count as seen.
  let legacy: unknown = [];
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_TIPS_KEY) ?? "[]");
  } catch {
    legacy = [];
  }
  const seen = Array.isArray(legacy) ? legacy.filter((v): v is string => v === "tray" || v === "shelf").map((v) => `tip.${v}`) : [];
  return { schema: SCHEMA, seen, asked: false };
}

let state: GuideState = typeof localStorage === "undefined" ? { schema: SCHEMA, seen: [], asked: false } : load();
const listeners = new Set<() => void>();

function save(next: GuideState): void {
  state = next;
  try {
    localStorage.setItem(GUIDES_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: this run only
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getGuides(): GuideState {
  return state;
}

export function useGuideState(): GuideState {
  return useSyncExternalStore(subscribe, () => state);
}

export function guideSeen(id: string): boolean {
  return state.seen.includes(id);
}

export function markGuideSeen(id: string): void {
  const ids = [id, ...(guideById(id)?.covers ?? [])].filter((x) => !state.seen.includes(x));
  if (ids.length) save({ ...state, seen: [...state.seen, ...ids] });
}

/** 看: the user wants guides (asked once). */
export function answerGuides(): void {
  if (!state.asked) save({ ...state, asked: true });
}

/**
 * 跳过所有引导 / 全部跳过: every guide live in `version` counts as seen (the onboarding too). 帮助 still replays each;
 * one added later shows again.
 */
export function skipAllGuides(version: string | null): void {
  const ids = liveGuides(version).filter(prompting).map((g) => g.id);
  save({ schema: SCHEMA, asked: true, seen: [...new Set([...state.seen, ...ids])] });
  finishOnboarding(version);
  writeHostChoice(guidesVersion(version));
}

/** 重置所有提示: tips and inline panels show again (the onboarding is replayed from 帮助, not reset here). */
export function resetGuides(): void {
  // Panel guides keep their 「已看过」 (lib/panelGuides: `panel.<id>@<version>`): they never prompt.
  save({ schema: SCHEMA, asked: true, seen: state.seen.filter((id) => guideById(id)?.kind === "onboarding" || id.startsWith("panel.")) });
  writeHostChoice(null);
}

// ---- the owner's choice on the host (cutex guides.preferences; lib/guidesHost syncs it) ----

/** The guides version of `version`: the newest `since` among its live guides (what 全部跳过 covers). */
export function guidesVersion(version: string | null, all: readonly Guide[] = GUIDES): string | null {
  let best: ReturnType<typeof parseVersion> = null;
  let text: string | null = null;
  for (const g of liveGuides(version, all).filter(prompting)) {
    const v = parseVersion(g.since);
    if (v && (!best || compareVersions(v, best) > 0)) [best, text] = [v, g.since];
  }
  return text;
}

let hostWriter: ((skippedThrough: string | null) => void) | null = null;
// Pending choices are per target host, independent of when its capabilities arrive. Keep only
// the latest intent, but serialize requests so an older skip cannot finish after a newer reset.
export const GUIDES_HOST_INTENTS_KEY = "cutex-desktop.guides-host-intents";
type HostIntent = { revision: number; skippedThrough: string | null };
type HostWrite = (skippedThrough: string | null) => Promise<unknown>;
let hostTarget: (() => string | null) | null = null;
const hostIntents = new Map<string, HostIntent>();
let intentRevision = 0;
try {
  const saved: unknown = JSON.parse(localStorage.getItem(GUIDES_HOST_INTENTS_KEY) ?? "null");
  if (saved && typeof saved === "object" && "schema" in saved && saved.schema === 1 && "pending" in saved && Array.isArray(saved.pending)) {
    for (const row of saved.pending) {
      if (!row || typeof row !== "object" || typeof row.host !== "string" || !row.host || !Number.isSafeInteger(row.revision) || row.revision <= 0) continue;
      if (row.skippedThrough !== null && (typeof row.skippedThrough !== "string" || !parseVersion(row.skippedThrough))) continue;
      hostIntents.set(row.host, { revision: row.revision, skippedThrough: row.skippedThrough });
      intentRevision = Math.max(intentRevision, row.revision);
    }
  }
} catch { /* unavailable / corrupt local storage: keep choices for this run */ }
const hostWrites = new Map<string, HostWrite>();
const writingHosts = new Set<string>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryDelays = new Map<string, number>();

function persistHostIntents(): void {
  try {
    localStorage.setItem(GUIDES_HOST_INTENTS_KEY, JSON.stringify({ schema: 1, pending: [...hostIntents].map(([host, intent]) => ({ host, ...intent })) }));
  } catch { /* unavailable storage: the in-memory intent still retries */ }
}

function cancelHostRetry(host: string): void {
  clearTimeout(retryTimers.get(host));
  retryTimers.delete(host);
}

async function flushHostChoice(host: string): Promise<void> {
  if (writingHosts.has(host)) return;
  writingHosts.add(host);
  try {
    for (;;) {
      const write = hostWrites.get(host), intent = hostIntents.get(host);
      if (!write || !intent) return;
      try {
        await write(intent.skippedThrough);
      } catch {
        // A newer local choice supersedes a failed request immediately; otherwise retry while
        // this host remains supported. Unmounts / old daemons keep the durable intent for later.
        if (hostIntents.get(host) !== intent) continue;
        if (hostWrites.has(host)) {
          const delay = retryDelays.get(host) ?? 1000;
          retryDelays.set(host, Math.min(delay * 2, 30000));
          cancelHostRetry(host);
          retryTimers.set(host, setTimeout(() => { retryTimers.delete(host); void flushHostChoice(host); }, delay));
        }
        return;
      }
      retryDelays.delete(host);
      if (hostIntents.get(host) === intent) {
        hostIntents.delete(host);
        persistHostIntents();
      }
    }
  } finally {
    writingHosts.delete(host);
  }
}

function writeHostChoice(skippedThrough: string | null): void {
  const host = hostTarget?.();
  if (!host) { hostWriter?.(skippedThrough); return; }
  hostIntents.set(host, { revision: ++intentRevision, skippedThrough });
  persistHostIntents();
  cancelHostRetry(host);
  retryDelays.delete(host);
  void flushHostChoice(host);
}

/** Resolve the target at the gesture, even if React has not rendered a host switch yet. */
export function setGuidesHostTarget(target: (() => string | null) | null): void {
  hostTarget = target;
}

/** A host-pinned writer; registering capabilities also backfills a choice made while offline. */
export function registerGuidesHostWriter(host: string, write: HostWrite): () => void {
  hostWrites.set(host, write);
  cancelHostRetry(host);
  void flushHostChoice(host);
  return () => {
    if (hostWrites.get(host) !== write) return;
    hostWrites.delete(host);
    cancelHostRetry(host);
    retryDelays.delete(host);
  };
}

let hostPending = false;
/** The owner chose 全部跳过 on another device before (through an older version): the question preselects it. */
let hostSkippedBefore = false;

export function useHostSkippedBefore(): boolean {
  return useSyncExternalStore(subscribe, () => hostSkippedBefore);
}

/** Compatibility writer for callers without a target host; host sync uses the durable per-host writer above. */
export function setGuidesHostWriter(write: ((skippedThrough: string | null) => void) | null): void {
  hostWriter = write;
}

/** While the host's choice is being read, the first question waits (it may not be needed). */
export function setGuidesHostPending(pending: boolean): void {
  if (hostPending === pending) return;
  hostPending = pending;
  listeners.forEach((l) => l());
}

export function useGuidesHostPending(): boolean {
  return useSyncExternalStore(subscribe, () => hostPending);
}

export const guidesHostPending = (): boolean => hostPending;

/**
 * The owner chose 全部跳过 on another device through `skippedThrough`. Only a device that has not answered the question
 * yet takes it (per-device seen state stays local): the guides up to that version count as seen; when that covers every
 * live guide the question is not asked at all and the onboarding counts as done — newer guides still ask / show.
 * Returns whether everything live was covered.
 */
export function applyHostSkip(skippedThrough: string | null, version: string | null): boolean {
  const through = parseVersion(skippedThrough);
  if (state.asked || !through) return false;
  const live = liveGuides(version).filter(prompting);
  const covered = live.filter((g) => {
    const since = parseVersion(g.since);
    return !since || compareVersions(since, through) <= 0;
  });
  const all = covered.length === live.length;
  hostSkippedBefore = true;
  save({ schema: SCHEMA, asked: all, seen: [...new Set([...state.seen, ...covered.map((g) => g.id)])] });
  if (covered.some((g) => g.kind === "onboarding")) finishOnboarding(version);
  return all;
}

// ---- 再看一次 ----

const replayListeners = new Set<(id: string) => void>();

/** Shows a guide again: an onboarding guide replays; a tip / panel is forgotten and shown as soon as its anchor is there. */
export function replayGuide(id: string): void {
  const guide = guideById(id);
  if (!guide) return;
  if (guide.replay) return guide.replay();
  if (state.seen.includes(id)) save({ ...state, seen: state.seen.filter((x) => x !== id) });
  replayListeners.forEach((l) => l(id));
}

export function onGuideReplay(l: (id: string) => void): () => void {
  replayListeners.add(l);
  return () => replayListeners.delete(l);
}

/** Reads the state from storage again (tests, the preview's ?tips). */
export function reloadGuideState(): void {
  state = load();
  hostSkippedBefore = false;
  listeners.forEach((l) => l());
}
