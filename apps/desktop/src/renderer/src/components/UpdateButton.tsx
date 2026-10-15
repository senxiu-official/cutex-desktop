// Sidebar footer button next to 设置: hidden while the install is current; shows when the update
// source has newer commits, runs the update on click (pull → install → build → package → switch →
// relaunch) and shows the running step or the failure.
import { ArrowUpCircle, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { bridge } from "../bridge";
import { useI18n, type MessageKey } from "../i18n";
import { updateButtonVisible, updateSummary, useUpdateStatus } from "../lib/update";

export function UpdateButton() {
  const { t } = useI18n();
  const status = useUpdateStatus();
  if (!updateButtonVisible(status) || !status) return null;
  const latest = status.latest;
  const summary = latest ? updateSummary(t, latest, status.channel) : "";
  if (status.state === "updating" || status.state === "ready") {
    const label = status.state === "ready" ? t("update.restarting") : t(`update.step.${status.step ?? "pull"}` as MessageKey);
    return (
      <span className="ml-auto flex items-center gap-1.5 rounded px-2 py-1 text-accent" title={summary}>
        <Loader2 size={13} className="animate-spin" />
        {label}
      </span>
    );
  }
  const failed = status.state === "error";
  return (
    <button
      onClick={() => void bridge.update?.apply()}
      title={failed ? `${t("update.failed")}\n${status.error ?? ""}` : summary}
      className={`ml-auto flex items-center gap-1.5 rounded px-2 py-1 hover:bg-surface-2 ${failed ? "text-danger" : "text-accent"}`}
    >
      {failed ? <TriangleAlert size={13} /> : <ArrowUpCircle size={13} />}
      {failed ? t("update.retry") : t("update.button")}
      {failed && <RotateCw size={11} />}
    </button>
  );
}
