// Text helpers of the Director rotation UI (kept out of the .tsx files for Fast Refresh).
import type { CutexRefusal } from "../../../../shared/ipc";
import type { MessageKey, useI18n } from "../../i18n";

type T = ReturnType<typeof useI18n>["t"];

const REFUSALS = new Set(["rotation_in_progress", "stale_project_authority", "rotation_not_cancellable", "rotation_not_waiting"]);

/** A cutex refusal in words (known codes) or as `code: message`. */
export function refusalText(error: CutexRefusal, t: T): string {
  return REFUSALS.has(error.code) ? t(`projects.rotation.refused.${error.code}` as MessageKey) : `${error.code}: ${error.message}`;
}

export function minutesLabel(n: number, t: T): string {
  return n >= 60 && n % 60 === 0 ? t("projects.rotation.hours", { n: n / 60 }) : t("projects.rotation.minutes", { n });
}
