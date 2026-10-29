// Sidebar footer button next to 设置: hidden while the install is current; shows when the update
// source has newer commits, runs the update after a confirm dialog (pull → install → build → package →
// switch → relaunch; design 013) and shows the running step or the failure.
import { ArrowUpCircle, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { bridge } from "../bridge";
import { useI18n, type MessageKey } from "../i18n";
import { confirmDialog } from "../lib/contextMenu";
import { updateButtonVisible, updateSummary, useUpdateStatus } from "../lib/update";

export function UpdateButton({ iconOnly = false }: { iconOnly?: boolean } = {}) {
  const { t } = useI18n();
  const status = useUpdateStatus();
  if (!updateButtonVisible(status) || !status) return null;
  const latest = status.latest;
  const summary = latest ? updateSummary(t, latest, status.channel) : "";
  if (status.state === "updating" || status.state === "ready") {
    const label = status.state === "ready" ? t("update.restarting") : t(`update.step.${status.step ?? "pull"}` as MessageKey);
    return (
      <span data-update-button="" className={`ml-auto flex items-center gap-1.5 rounded py-1 text-accent ${iconOnly ? "px-1.5" : "px-2"}`} title={iconOnly ? [label, summary].filter(Boolean).join("\n") : summary}>
        <Loader2 size={13} className="animate-spin" />
        {!iconOnly && label}
      </span>
    );
  }
  const failed = status.state === "error";
  return (
    <button
      data-update-button=""
      // Design 013: an app update is big and rare — one click asks first (it restarts the app).
      onClick={() => void confirmDialog(t("update.confirm", { summary: [summary || t("update.button"), latest?.sourceBuild ? t("update.sourceConfirm", { branch: status.channel ?? "main" }) : ""].filter(Boolean).join("\n\n") }), false, { ok: t("update.confirmOk"), cancel: t("settings.cancel") }).then((yes) => yes && void bridge.update?.apply())}
      title={failed ? `${t("update.failed")}\n${status.error ?? ""}` : iconOnly ? [t("update.button"), summary].filter(Boolean).join("\n") : summary}
      aria-label={iconOnly ? t(failed ? "update.retry" : "update.button") : undefined}
      // `iconOnly`: the sidebar's avatar rail (the label in the tooltip).
      className={`ml-auto flex items-center gap-1.5 rounded py-1 hover:bg-surface-2 ${iconOnly ? "px-1.5" : "px-2"} ${failed ? "text-danger" : "text-accent"}`}
    >
      {failed ? <TriangleAlert size={13} /> : <ArrowUpCircle size={13} />}
      {!iconOnly && (failed ? t("update.retry") : t("update.button"))}
      {failed && !iconOnly && <RotateCw size={11} />}
    </button>
  );
}
