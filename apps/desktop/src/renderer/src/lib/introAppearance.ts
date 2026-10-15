// Timeline intro appearance (modules/intro, docs/desktop-modules.md §19.3): the opening portrait and
// greeting of a profile — the owner's "character entrance" above a conversation's first turn. Like
// profile avatars (lib/profileAvatar) this is a device-local preference; cutex stores nothing of it.
// The key is the hosts-list host id (the same id the timeline outlet and Settings → Profiles target
// carry), so an opening saved for a remote host's profile shows on that host's sessions too. A
// custom portrait wins over the provider's launcher artwork (lib/launchArt), a custom greeting over
// the provider greeting pool (lib/providerGreetings).
import { useSyncExternalStore } from "react";
import { LAUNCH_ART, type LaunchArt } from "./launchArt";
import { portraitProvider, type PortraitProvider } from "./launchPortraits";
import { providerGreetings } from "./providerGreetings";
import type { Provider } from "./provider";
import type { TermLocale } from "./terms";

const KEY = "cutex-desktop.introAppearance";
/** Source files the picker accepts (contract: PNG / JPEG / WebP only). */
const INTRO_PORTRAIT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
/** Largest source file the picker opens (decoded whole before scaling). */
const INTRO_PORTRAIT_SOURCE_BYTES = 2 * 1024 * 1024;
/** The stored edge: longer sides are scaled down to this before saving. */
const INTRO_PORTRAIT_PX = 1024;
/** One stored portrait's encoded cap (~1 MB); the encoder steps its quality down to stay under it. */
const INTRO_PORTRAIT_STORED_MAX = 1_048_576;
/** All stored portraits together (~3 MB): localStorage is small and shared, so this stays bounded. */
const INTRO_PORTRAIT_STORED_TOTAL = 3 * 1_048_576;
/** Custom greeting cap (characters, after trim). */
export const INTRO_GREETING_MAX = 300;

const PORTRAIT = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export interface IntroAppearance {
  portrait: string | null;
  greeting: string | null;
}

/** The settings editor's draft of an opening: `portrait` undefined = unchanged / null = remove; `greeting` undefined = unchanged. */
export interface IntroDraft {
  portrait: string | null | undefined;
  greeting: string | undefined;
}

type Store = Record<string, Record<string, IntroAppearance>>; // host id (hosts list) → profile id → appearance

/** Why an uploaded file cannot become the opening portrait; null = the picker may open it. */
export function introPortraitProblem(file: { type: string; size: number }): "type" | "tooLarge" | null {
  if (!INTRO_PORTRAIT_TYPES.has(file.type)) return "type";
  return file.size > INTRO_PORTRAIT_SOURCE_BYTES ? "tooLarge" : null;
}

/** Well-formed and within the stored cap; a bad entry is dropped, never rendered. */
export function validIntroPortrait(dataUrl: string): boolean {
  return dataUrl.length <= INTRO_PORTRAIT_STORED_MAX && PORTRAIT.test(dataUrl);
}

/** Trimmed, capped greeting; null when empty. */
export function cleanIntroGreeting(value: string): string | null {
  const text = [...value.trim()].slice(0, INTRO_GREETING_MAX).join("");
  return text || null;
}

/** Thrown by prepareIntroPortrait when no encoding step fits the stored cap — the editor reports
 *  it as "too large" instead of silently dropping the picture. */
export const INTRO_PORTRAIT_TOO_LARGE = "intro-portrait-too-large";

/** Decodes the picked file and encodes WebP (alpha survives) within the stored cap: the longest
 *  edge is scaled to ≤ INTRO_PORTRAIT_PX — via createImageBitmap's own resize options when the
 *  source is oversized (never a full-size canvas), else as-is — and the quality steps down until
 *  the encoded size fits; past the last step it rejects with INTRO_PORTRAIT_TOO_LARGE. */
export async function prepareIntroPortrait(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  let shrunk: ImageBitmap | null = null;
  try {
    let source: ImageBitmap = bitmap;
    let width = bitmap.width;
    let height = bitmap.height;
    const scale = Math.min(1, INTRO_PORTRAIT_PX / Math.max(width, height));
    if (scale < 1) {
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      try {
        shrunk = await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
        source = shrunk;
      } catch {
        // No decoder resize here (old engine?): the canvas draw below scales instead.
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    for (const quality of [0.92, 0.8, 0.6, 0.45]) {
      const encoded = canvas.toDataURL("image/webp", quality);
      if (encoded.length <= INTRO_PORTRAIT_STORED_MAX) return encoded;
    }
    throw new Error(INTRO_PORTRAIT_TOO_LARGE);
  } finally {
    shrunk?.close();
    bitmap.close();
  }
}

function cleanEntry(raw: unknown): IntroAppearance {
  const entry = (raw && typeof raw === "object" ? raw : {}) as { portrait?: unknown; greeting?: unknown };
  return {
    portrait: typeof entry.portrait === "string" && validIntroPortrait(entry.portrait) ? entry.portrait : null,
    greeting: typeof entry.greeting === "string" ? cleanIntroGreeting(entry.greeting) : null,
  };
}

function load(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: Store = {};
    for (const [host, profiles] of Object.entries(raw as Record<string, unknown>)) {
      if (!profiles || typeof profiles !== "object") continue;
      const cleaned = Object.fromEntries(Object.entries(profiles as Record<string, unknown>).map(([id, v]) => [id, cleanEntry(v)]));
      if (Object.keys(cleaned).length) out[host] = cleaned;
    }
    return out;
  } catch {
    return {};
  }
}

let current: Store = load();
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// Another window (or the preview seeding before this module inits) may rewrite the store: follow it.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== KEY) return;
    current = load();
    for (const l of listeners) l();
  });
}

/** Shared empty (a stable snapshot for useSyncExternalStore). */
const NO_INTRO: IntroAppearance = { portrait: null, greeting: null };

/** The opening appearance of `profileId` on `host` (either part null = not set). */
export function introAppearanceOf(host: string, profileId: string): IntroAppearance {
  return current[host]?.[profileId] ?? NO_INTRO;
}

/** Bytes of portrait this store holds (greetings are tiny; only the pictures matter). */
function storedPortraitBytes(): number {
  let total = 0;
  for (const profiles of Object.values(current)) for (const entry of Object.values(profiles)) total += entry.portrait?.length ?? 0;
  return total;
}

/** Sets one part (portrait / greeting; null or "" clears it), leaving the other as is. Returns
 *  false when the write was refused — the whole store would pass the shared ~3 MB cap, or
 *  localStorage refused (quota) — and nothing changed; the editor keeps its draft and reports it. */
export function setIntroAppearance(host: string, profileId: string, patch: Partial<IntroAppearance>): boolean {
  const prev = introAppearanceOf(host, profileId);
  const next: IntroAppearance = {
    portrait: patch.portrait !== undefined ? (patch.portrait && validIntroPortrait(patch.portrait) ? patch.portrait : null) : prev.portrait,
    greeting: patch.greeting !== undefined ? cleanIntroGreeting(patch.greeting ?? "") : prev.greeting,
  };
  if (next.portrait && storedPortraitBytes() - (prev.portrait?.length ?? 0) + next.portrait.length > INTRO_PORTRAIT_STORED_TOTAL) return false;
  const forHost = { ...(current[host] ?? {}) };
  if (next.portrait || next.greeting) forHost[profileId] = next;
  else delete forHost[profileId];
  const applied: Store = { ...current, [host]: forHost };
  try {
    localStorage.setItem(KEY, JSON.stringify(applied));
  } catch {
    // quota full: nothing changed anywhere
    return false;
  }
  current = applied;
  for (const l of listeners) l();
  return true;
}

/** `host`'s opening appearance for `profileId` (reactive; the host id the timeline outlet and the profile editor share). */
export function useIntroAppearanceOf(host: string, profileId: string | null | undefined): IntroAppearance {
  return useSyncExternalStore(subscribe, () => (profileId ? introAppearanceOf(host, profileId) : NO_INTRO));
}

// ── pure resolution (the intro item and the settings preview share it) ─────────────────────────

/** The portrait actually shown: the profile's custom one, else the provider's launcher artwork. */
export function resolveIntroPortrait(custom: string | null, provider: Provider | null, art: LaunchArt = LAUNCH_ART): string | null {
  if (custom && validIntroPortrait(custom)) return custom;
  const key: PortraitProvider | null = portraitProvider(provider);
  return key ? art[key]?.portrait ?? null : null;
}

export interface IntroGreetingInput {
  /** The profile's custom greeting (already cleaned); null = use the provider pool. */
  custom: string | null;
  provider: Provider | null;
  locale: TermLocale;
  /** Local time minute-of-day (the pool's time windows). */
  minute: number;
  /** The owner term (Settings → 通用 → 称呼) for `{{owner}}` — and the pool's `{name}` / `{称呼}`. */
  owner: string;
  /** The session's display name for `{{name}}`. */
  agentName: string | null;
  /** One stable random per visit, so editing a draft never rerolls the pool text. */
  sample: number;
}

/** The greeting text shown ("" = none). `{{owner}}` / `{{name}}` are the custom text's placeholders
 *  (plus single-brace `{owner}`); the provider pool keeps the launcher's single-brace `{name}` /
 *  `{称呼}` = the owner's address. */
export function resolveIntroGreeting({ custom, provider, locale, minute, owner, agentName, sample }: IntroGreetingInput): string {
  const pool = providerGreetings(provider, locale, minute);
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(sample * pool.length)));
  const template = custom ?? pool[index] ?? "";
  // Function replacers: a name containing $& / $` / $' must land literally, not as a pattern.
  return template
    .replaceAll("{{owner}}", () => owner)
    .replaceAll("{{name}}", () => agentName ?? "")
    .replace(/\{(?:name|称呼|owner)\}/g, () => owner);
}
