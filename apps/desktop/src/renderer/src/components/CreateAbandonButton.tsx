// 「放弃这次新建」 on an unfinished agent_create row (design 028 (d), cutex agent-create-abandon): a dry run
// first, then the app confirm dialog naming the name it frees and what it removes, then the abandon.
// Owner only (the route is root-only; a Director cannot reach it through the desktop).
import { useState } from "react";
import { useI18n } from "../i18n";
import { confirmDialog } from "../lib/contextMenu";
import { hostApi } from "../lib/hostLists";
import { useConvHost } from "../lib/conversationScope";
import { useApp, featuresOf } from "../store";
import { CREATE_ABANDON_FEATURE, type CreateAbandonPlan, type CreateAbandonResult } from "../../../shared/createAbandon";

type T = ReturnType<typeof useI18n>["t"];

/** The confirm text: the name, what goes, that it cannot be undone. */
export function abandonConfirmText(plan: CreateAbandonPlan, t: T): string {
  const lines = [t("createAbandon.confirm.title", { name: plan.reserved_name ?? plan.action_id })];
  const what: string[] = [];
  if (plan.durable_session) what.push(t("createAbandon.confirm.session", { id: plan.durable_session }));
  else if (plan.native_thread) what.push(t("createAbandon.confirm.thread", { id: plan.native_thread }));
  if (!what.length) what.push(t("createAbandon.confirm.nothing"));
  lines.push(what.join("\n"));
  lines.push(t("createAbandon.confirm.final"));
  return lines.join("\n\n");
}

export function abandonOutcomeText(result: CreateAbandonResult, t: T): { text: string; tone: "info" | "error" } {
  if (!result.ok) return { text: t("createAbandon.refused", { code: result.code ?? "error", detail: result.detail ?? "" }), tone: "error" };
  const name = result.receipt?.plan.reserved_name ?? result.receipt?.plan.action_id ?? "";
  return { text: t(result.receipt?.replayed ? "createAbandon.already" : "createAbandon.done", { name }), tone: "info" };
}

export function CreateAbandonButton({ actionId }: { actionId: string }) {
  const { t } = useI18n();
  const hostId = useConvHost();
  const on = useApp((s) => featuresOf(s, hostId).has(CREATE_ABANDON_FEATURE));
  const [busy, setBusy] = useState(false);
  if (!on) return null;
  const run = async () => {
    setBusy(true);
    try {
      const api = hostApi(hostId);
      const preview = await api.abandonAgentCreate(actionId, true);
      if (!preview.ok || !preview.receipt) {
        const shown = abandonOutcomeText(preview, t);
        useApp.getState().notify(shown.text, shown.tone);
        return;
      }
      if (!(await confirmDialog(abandonConfirmText(preview.receipt.plan, t), true, { ok: t("createAbandon.confirm.ok"), cancel: t("dialog.cancel") }))) return;
      const shown = abandonOutcomeText(await api.abandonAgentCreate(actionId, false), t);
      useApp.getState().notify(shown.text, shown.tone);
    } catch (e) {
      useApp.getState().notify(t("createAbandon.refused", { code: "error", detail: e instanceof Error ? e.message : String(e) }), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button disabled={busy} onClick={(e) => { e.stopPropagation(); void run(); }} data-testid="create-abandon" className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-caption/[inherit] text-foreground hover:text-danger disabled:opacity-50">
      {busy ? t("createAbandon.busy") : t("createAbandon.button")}
    </button>
  );
}
