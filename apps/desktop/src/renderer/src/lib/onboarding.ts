// Onboarding and 「新功能」 (owner 2026-10-19; TODO 开源前清单): a one-time introduction (what an agent and a
// project are, the first Profile, the wording preset) and, once per desktop version, that version's
// changelog summary. Per device (localStorage, like the changelog's seen version); Settings → 关于 turns the
// 新功能 dialog off / on and replays either one. components/OnboardingDialog renders what `pending` says.
import { useSyncExternalStore } from "react";
import { compareVersions, parseVersion } from "../../../shared/binaryUpdate";
import type { ChangelogRelease } from "../../../shared/changelog";

/**
 * Bump when the introduction changes enough that everyone should see it again. 3 = the merged 0.2.0 flow (owner
 * 2026-10-24: every user walks it once at 0.2.0, upgraders from 0.1.x included, their choices preselected).
 */
export const ONBOARDING_REVISION = 3;

const KEY = "cutex-desktop.onboarding";

export interface OnboardingState {
  /** The introduction revision last finished or skipped (0 = never). */
  doneRevision: number;
  /** Show a version's 新功能 once after updating to it. */
  whatsNew: boolean;
  /** The desktop version whose 新功能 was last shown (or skipped); null = none yet. */
  lastWhatsNew: string | null;
  /** Testing (development builds only, Settings → 关于): every new build shows the whole introduction, then the newest 新功能. */
  testEveryBuild: boolean;
  /** The build (`version@commit`) the testing switch last showed it for. */
  lastTestBuild: string | null;
}

/** `auto`: opened by itself at start (not a replay) — the first one on a device asks 「要看引导和提示吗？」 first (lib/guides). */
export type OnboardingView =
  | { kind: "intro"; /** Testing switch: record this build and show `whatsNew` (a version) afterwards. */ test?: { build: string; whatsNew: string | null }; auto?: boolean; /** The card to open at (回到引导). */ at?: string }
  | { kind: "whatsNew"; version: string; auto?: boolean; at?: string };

const DEFAULTS: OnboardingState = { doneRevision: 0, whatsNew: true, lastWhatsNew: null, testEveryBuild: false, lastTestBuild: null };

function load(): OnboardingState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<OnboardingState> | null;
    if (!raw || typeof raw !== "object") return DEFAULTS;
    return {
      doneRevision: typeof raw.doneRevision === "number" ? raw.doneRevision : 0,
      whatsNew: typeof raw.whatsNew === "boolean" ? raw.whatsNew : true,
      lastWhatsNew: typeof raw.lastWhatsNew === "string" ? raw.lastWhatsNew : null,
      testEveryBuild: raw.testEveryBuild === true,
      lastTestBuild: typeof raw.lastTestBuild === "string" ? raw.lastTestBuild : null,
    };
  } catch {
    return DEFAULTS;
  }
}

let state = load();
/** What is open now (an explicit replay from 关于, or the automatic one). */
let open: OnboardingView | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function save(next: OnboardingState): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: the dialog may show again next start
  }
  emit();
}

// The bundled changelog's releases, provided by the about module (it owns the bundled copy;
// modules/about/index.ts) so the shell dialog and the onboarding card need no module import.
let releases: readonly ChangelogRelease[] = [];

export function provideReleases(list: readonly ChangelogRelease[]): void {
  releases = list;
}

export function bundledReleases(): readonly ChangelogRelease[] {
  return releases;
}

export function getOnboarding(): OnboardingState {
  return state;
}

export function useOnboarding(): OnboardingState {
  return useSyncExternalStore(subscribe, () => state);
}

export function useOnboardingView(): OnboardingView | null {
  return useSyncExternalStore(subscribe, () => open);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * What to show by itself at start, for this desktop `version` (null = unknown, e.g. a dev build) and the
 * versions the bundled changelog lists: the introduction until it was finished once; else this version's
 * 新功能 when it is listed, newer than the last one shown, and the switch is on. A first run never also
 * shows 新功能 (the introduction marks the version as seen).
 */
export function automaticView(s: OnboardingState, version: string | null, listed: readonly string[]): OnboardingView | null {
  if (s.doneRevision < ONBOARDING_REVISION) return { kind: "intro" };
  if (!s.whatsNew || !version || !listed.includes(version) || s.lastWhatsNew === version) return null;
  const now = parseVersion(version);
  const last = s.lastWhatsNew ? parseVersion(s.lastWhatsNew) : null;
  if (now && last && compareVersions(now, last) <= 0) return null;
  return { kind: "whatsNew", version };
}

/**
 * The testing switch's view for this `build` (`version@commit`; null = unknown): the whole introduction once
 * per new build, followed by the newest listed release's 新功能. Null when the switch is off or the build was
 * shown already.
 */
export function testView(s: OnboardingState, build: string | null, listed: readonly string[]): OnboardingView | null {
  if (!s.testEveryBuild || !build || s.lastTestBuild === build) return null;
  return { kind: "intro", test: { build, whatsNew: listed[0] ?? null } };
}

/** Opens a view (关于 → 重新看一遍 / 这个版本的新功能, or the automatic start). */
export function openOnboarding(view: OnboardingView): void {
  open = view;
  aside = null;
  emit();
}

/** The flow stepped aside for one of its actions (lib/guideActions): 「回到引导」 reopens it at that card. */
let aside: OnboardingView | null = null;

export function useOnboardingAside(): OnboardingView | null {
  return useSyncExternalStore(subscribe, () => aside);
}

/**
 * A card's action (试一试 …) runs: the flow closes the way 关闭 does (counted as seen; the testing switch's
 * 新功能 waits for the way back), and 「回到引导」 can bring it back at `step`.
 */
export function stepAsideOnboarding(version: string | null, step: string): void {
  const view = open;
  if (!view) return;
  const back: OnboardingView = view.kind === "intro" ? { kind: "intro", at: step } : { kind: "whatsNew", version: view.version, at: step };
  if (view.kind === "intro" && view.test) {
    open = null;
    save({ ...state, doneRevision: ONBOARDING_REVISION, lastTestBuild: view.test.build });
  } else closeOnboarding(version);
  aside = back;
  emit();
}

/** 「回到引导」: the flow again at the card it left from. */
export function resumeOnboarding(): void {
  if (aside) openOnboarding(aside);
}

/** The pill's ✕: no way back (Settings → 帮助 still replays it). */
export function dismissOnboardingAside(): void {
  aside = null;
  emit();
}

/** Closes the dialog; `finished` records the introduction / the version's 新功能 as seen. */
export function closeOnboarding(version: string | null): void {
  const view = open;
  open = null;
  if (view?.kind === "intro" && view.test) {
    save({ ...state, doneRevision: ONBOARDING_REVISION, lastTestBuild: view.test.build });
    if (view.test.whatsNew) openOnboarding({ kind: "whatsNew", version: view.test.whatsNew });
  } else if (view?.kind === "intro") save({ ...state, doneRevision: ONBOARDING_REVISION, lastWhatsNew: version ?? state.lastWhatsNew });
  else if (view?.kind === "whatsNew") save({ ...state, lastWhatsNew: view.version });
  else emit();
}

/**
 * 跳过所有引导 (lib/guides): the introduction counts as finished and `version`'s 新功能 as seen, without opening
 * anything; closes what is open.
 */
export function finishOnboarding(version: string | null): void {
  open = null;
  save({ ...state, doneRevision: ONBOARDING_REVISION, lastWhatsNew: version ?? state.lastWhatsNew });
}

export function setWhatsNewEnabled(on: boolean): void {
  save({ ...state, whatsNew: on });
}

/** Testing switch (development builds): on = the next new build shows everything again. */
export function setTestEveryBuild(on: boolean): void {
  save({ ...state, testEveryBuild: on, lastTestBuild: on ? state.lastTestBuild : null });
}

/** Tests: start from a clean state. */
export function resetOnboardingForTest(): void {
  open = null;
  state = load();
  emit();
}
