import type { SessionForkPreview, SessionForkTarget, SessionForkResult } from "../../../shared/sessionFork";
import type { AutoPickPreview } from "../../../shared/profileAutoPick";
import type { MessageKey } from "../i18n";

/** Eligibility comes from the daemon (including frozen Claude account identity). */
export function forkTargets(preview: SessionForkPreview | null): SessionForkTarget[] {
  return preview?.targets.filter((p) => p.eligible && p.name !== preview.sourceProfile) ?? [];
}
export function forkQuota(preview: AutoPickPreview | null, profile: string): number | null {
  const remaining = preview?.providers.flatMap((p) => p.pick?.candidates ?? []).find((p) => p.profile === profile)?.remainingPercent;
  return typeof remaining === "number" && Number.isFinite(remaining) ? Math.max(0, Math.min(100, remaining)) : null;
}
/** Only the explicit fork provenance wrapper establishes that both histories were preserved. */
export function isForkSignatureRejection(text: string): boolean {
  return text.includes("The target account rejected encrypted reasoning or a thinking signature in this fork's copied history");
}
export function forkErrorKey(error: unknown): MessageKey | null {
  const text = error instanceof Error ? error.message : String(error);
  if (/fork_history_signature_rejected/.test(text) || isForkSignatureRejection(text) || /encrypted.{0,40}(reasoning|decrypt)|(?:thinking|reasoning).{0,40}signature/i.test(text)) return "fork.error.signature";
  if (/provider_family_mismatch|profile_switch_cli_mismatch/.test(text)) return "fork.error.family";
  if (/profile_preview_unavailable/.test(text)) return "fork.error.previewUnavailable";
  if (/profile_fork_disallowed/.test(text)) return "fork.error.disallowed";
  if (/profile_not_found/.test(text)) return "fork.error.profileMissing";
  if (/session_not_found/.test(text)) return "fork.error.sourceMissing";
  if (/fork_busy|session_busy|active_turn|structural_operation/.test(text)) return "fork.error.busy";
  if (/forkProfileDefaults/.test(text)) return "fork.error.runtimeUpgrade";
  if (/unsupported|not_available|unknown_method/.test(text)) return "fork.error.unsupported";
  return null;
}
export function forkHistorySize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) return null;
  const units = ["B", "KiB", "MiB", "GiB"];
  const unit = bytes ? Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
}

/** Successful forks stay successful. Translate warning codes rather than showing backend English. */
export function forkCompletionNotice(result: SessionForkResult, name: string, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  const notes = new Set<MessageKey>();
  if (result.historyBytes === null) notes.add("fork.profile.historyUnknown");
  for (const warning of result.warnings ?? []) {
    notes.add(warning.code === "fork_history_size_unavailable" ? "fork.profile.historyUnknown"
      : warning.code === "claude_runtime_restart_failed" ? "fork.warning.runtimeRestart"
      : "fork.warning.other");
  }
  return [t("fork.done", { name }), ...[...notes].map((key) => t(key))].join("\n");
}
