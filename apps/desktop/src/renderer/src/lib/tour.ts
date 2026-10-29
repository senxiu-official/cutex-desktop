// The illustrated 0.2.0 tour (owner 2026-10-23): shown instead of the text 新功能 for 0.2.0 only (later versions keep the
// text list), replayable from Settings → 关于. Pure parts here (tested: test/tour.test.tsx); components/OnboardingFlow draws it.
//
// 拟人头像 (owner): the user answers 用 / 先不用 himself — no 「帮我决定」 for that question and 「都帮我决定」 leaves it
// unanswered; Next waits for an answer; Skip / Esc = today's look (nothing written). Once 用: the theme picker's
// 「帮我决定」 = every theme (混合); 用 needs at least one theme to go on.

/** The versions with a tour (their 新功能 is the tour). */
export const TOUR_VERSIONS: readonly string[] = ["0.2.0"];

/** Whether `version`'s 新功能 is a tour (0.2.0 and its pre-releases). */
export function hasTour(version: string | null | undefined): boolean {
  if (!version) return false;
  return TOUR_VERSIONS.some((v) => version === v || version.startsWith(`${v}-`));
}

/** The answer to 「要不要用拟人头像」: null = not answered yet. */
export interface PortraitAnswer {
  use: boolean | null;
  themes: string[];
}

/**
 * Where the question starts (owner 2026-10-24: 用 preselected, every theme on, so 下一步 alone goes on): the themes
 * already on (from Settings), else every installed one (`all`). The flow applies it when the user moves past the card;
 * skipping the flow writes nothing.
 */
export function initialPortraitAnswer(enabled: readonly string[], all: readonly string[] = [], preserveExisting = false): PortraitAnswer {
  return { use: preserveExisting ? enabled.length > 0 : true, themes: [...(enabled.length || preserveExisting ? enabled : all)] };
}

/** Next is allowed: 极简风格, or 用 with at least one theme. */
export function portraitAnswered(a: PortraitAnswer): boolean {
  return a.use === false || (a.use === true && a.themes.length > 0);
}

/** The enabled themes an answer means (极简风格 / unanswered = none: emoji or letters). */
export function portraitThemesFor(a: PortraitAnswer): string[] {
  return a.use ? a.themes : [];
}

/** The theme picker's 「帮我决定」 (only after 用): every installed theme. */
export function decidePortraitThemes(a: PortraitAnswer, all: readonly string[]): PortraitAnswer {
  return a.use ? { use: true, themes: [...all] } : a;
}
