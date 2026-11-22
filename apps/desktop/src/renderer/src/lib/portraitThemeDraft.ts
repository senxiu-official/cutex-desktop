// A Profile's 头像风格 draft that its host cannot store (owner 2026-11-18: saving failed on bundled themes whose ids are
// longer than an older host's 20 characters; shared/profilePortraitThemes, main patchProfile). Save still saves every other
// field; the style stays a draft with a short named note (never the backend's error). The editor is keyed by the Profile's
// name, so a rename remounts it: the held draft lives here by host + Profile id until the owner changes or reverts it.
import type { ProfilePortraitThemeProblem } from "../../../shared/profilePortraitThemes";
import { isPortraitThemeKey } from "../../../shared/portraitDefaults";
import type { AvatarStyle } from "./avatarStyle";
import { hostKey } from "./hostKeys";

const held = new Map<string, { style: AvatarStyle | null; problem: ProfilePortraitThemeProblem | null }>();
/**
 * Each owner change of the style draft (a choice, 撤销) moves its revision. A save notes it when it starts and may hold or
 * clear the draft when it ends only if it has not moved: an older request never brings back a style the owner reverted or
 * replaced while it ran (cross-review 2026-11-18). Kept here, so it outlives the remount a rename causes.
 */
const revisions = new Map<string, number>();

/** Keep a draft for this host's Profile `id` across a remount: one the host refused (with why), or (problem null) a newer
 *  choice the owner made while a renaming save ran. */
export function holdBlockedStyle(hostId: string, profileId: string, style: AvatarStyle | null, problem: ProfilePortraitThemeProblem | null): void {
  held.set(hostKey(hostId, profileId), { style, problem });
}

/** The held draft and its problem, if any. */
export function heldBlockedStyle(hostId: string, profileId: string): { style: AvatarStyle | null; problem: ProfilePortraitThemeProblem | null } | undefined {
  return held.get(hostKey(hostId, profileId));
}

/** The owner changed, reverted or saved the style: nothing held any more, and the draft's revision moves. */
export function releaseBlockedStyle(hostId: string, profileId: string): void {
  const key = hostKey(hostId, profileId);
  held.delete(key);
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
}

/** The style draft's revision now (see `revisions`). */
export function styleDraftRevision(hostId: string, profileId: string): number {
  return revisions.get(hostKey(hostId, profileId)) ?? 0;
}

type Translate = (key: "avatarStyle.portrait.hostTooOld" | "avatarStyle.portrait.cannotSave" | "avatarStyle.portrait.duplicate" | "avatarStyle.portrait.empty" | "avatarStyle.portrait.tooMany", vars?: Record<string, string | number>) => string;

/**
 * The short note for a refused portrait choice. Theme ids longer than an old host's limit but valid for a newer one: the
 * host cannot store them yet (an upgrade can); otherwise what is wrong. `nameOf`: a theme key → its display name.
 */
export function portraitProblemText(problem: ProfilePortraitThemeProblem, nameOf: (key: string) => string, t: Translate): string {
  const themes = problem.references.map(nameOf).join("、");
  if (problem.kind === "emptyThemes") return t("avatarStyle.portrait.empty");
  if (problem.kind === "tooManyThemes") return t("avatarStyle.portrait.tooMany", { n: problem.references.length });
  if (problem.kind === "duplicateThemes") return t("avatarStyle.portrait.duplicate", { themes });
  const upgradeHelps = problem.maxThemeLength < 32 && problem.references.every((ref) => isPortraitThemeKey(ref) && ref.split("/")[1]!.length <= 32);
  return t(upgradeHelps ? "avatarStyle.portrait.hostTooOld" : "avatarStyle.portrait.cannotSave", { themes });
}
