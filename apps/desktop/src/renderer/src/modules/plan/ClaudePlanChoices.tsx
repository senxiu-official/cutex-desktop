// Claude Code's plan approval choices on a Claude agent's latest plan card (its ExitPlanMode dialog):
// - 执行，自动接受编辑: leave plan mode in acceptEdits, then "Implement the plan."
// - 执行，编辑逐个审批: leave plan mode in default (asks before edits and commands), then implement
// - 执行，保持<完全访问|自动>: only when that was the mode under plan mode
// - 继续规划: stay in plan mode; optional feedback is sent as the next message
// Mode and plan mode change in one thread/settings/update (lib/claudePermissionModes); the message
// goes only when the native took the change (else a resumed native would just plan again).
import { useState, type ReactNode } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { agentFeaturesOf } from "../../lib/agentFeatures";
import { planApprovalPatch, planKeepMode } from "../../lib/claudePermissionModes";
import { useApp } from "../../store";
import { convSidebarOf, convViewOf, useConvScope, useConvViewHost } from "../../lib/conversationScope";

/** Same user message the TUI sends (PLAN_IMPLEMENTATION_CODING_MESSAGE). */
const IMPLEMENT_MESSAGE = "Implement the plan.";

/** Claude agents: ClaudePlanChoices; any other agent: `children` (the TUI's implement / keep planning). */
export function PlanChoicesGate({ sessionId, current, onDecided, children }: { sessionId: string; current: () => boolean; onDecided: () => void; children: ReactNode }) {
  const conv = useConvScope();
  const claude = useApp((s) => agentFeaturesOf(convSidebarOf(conv, s)?.active.find((r) => r.cutexSessionId === sessionId)).runtime === "claude");
  return claude ? <ClaudePlanChoices sessionId={sessionId} current={current} onDecided={onDecided} /> : <>{children}</>;
}

export function ClaudePlanChoices({ sessionId, current, onDecided }: { sessionId: string; current: () => boolean; onDecided: () => void }) {
  const { t } = useI18n();
  const conv = useConvScope();
  const hostId = useConvViewHost(sessionId);
  const settings = useApp((s) => convViewOf(conv, s, sessionId)?.timeline.settings ?? null);
  const keep = planKeepMode(settings);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const implement = async (then: "acceptEdits" | "default" | "keep") => {
    if (!current() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const app = useApp.getState();
      const applied = await app.updateSettings(planApprovalPatch(then, convViewOf(conv, app, sessionId)?.timeline.settings ?? null), sessionId, hostId);
      if (!current()) return;
      if (!applied) return setError(t("plan.defaultUnavailable"));
      onDecided();
      // Optimistic send (lib/outbox): a failure stays on the message with retry / edit / discard.
      await app.submit(IMPLEMENT_MESSAGE, "auto", [], { sessionId, hostId }).catch(() => {});
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const keepPlanning = async () => {
    if (!current()) return;
    const text = feedback?.trim() ?? "";
    onDecided();
    if (text) await useApp.getState().submit(text, "auto", [], { sessionId, hostId }).catch(() => {});
  };

  const button = "rounded-md px-2.5 py-1 text-left text-xs disabled:opacity-50";
  return (
    <div className="mt-3 border-t border-border pt-2.5" data-testid="claude-plan-choices">
      <div className="mb-1.5 text-xs text-subtle">{t("plan.question")}</div>
      <div className="flex flex-col gap-1">
        <button disabled={busy} onClick={() => void implement("acceptEdits")} title={t("plan.claude.acceptEditsHint")} className={`${button} bg-accent text-white`}>
          <span className="mr-1.5 opacity-70">1</span>{t("plan.claude.acceptEdits")}
        </button>
        <button disabled={busy} onClick={() => void implement("default")} title={t("plan.claude.manualHint")} className={`${button} bg-surface-2 text-foreground hover:bg-surface-2/70`}>
          <span className="mr-1.5 opacity-70">2</span>{t("plan.claude.manual")}
        </button>
        {keep && (
          <button disabled={busy} onClick={() => void implement("keep")} title={t("plan.claude.keepHint")} className={`${button} bg-surface-2 text-foreground hover:bg-surface-2/70`}>
            <span className="mr-1.5 opacity-70">3</span>{t("plan.claude.keep", { mode: t(`composer.claudeMode.${keep}` as MessageKey) })}
          </button>
        )}
        {feedback === null ? (
          <button disabled={busy} onClick={() => setFeedback("")} title={t("plan.stayHint")} className={`${button} text-muted hover:bg-surface-2 hover:text-foreground`}>
            <span className="mr-1.5 opacity-70">{keep ? 4 : 3}</span>{t("plan.claude.keepPlanning")}
          </button>
        ) : (
          <div className="flex flex-col gap-1 rounded-md bg-surface-2 p-1.5">
            <textarea
              autoFocus
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void keepPlanning();
                } else if (e.key === "Escape") setFeedback(null);
              }}
              rows={2}
              placeholder={t("plan.claude.feedbackPlaceholder")}
              aria-label={t("plan.claude.feedbackPlaceholder")}
              className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
            />
            <div className="flex justify-end gap-1.5">
              <button onClick={() => setFeedback(null)} className="rounded-md px-2 py-0.5 text-xs text-muted hover:text-foreground">{t("plan.claude.feedbackCancel")}</button>
              <button onClick={() => void keepPlanning()} className="rounded-md bg-accent px-2 py-0.5 text-xs text-white">
                {feedback.trim() ? t("plan.claude.feedbackSend") : t("plan.stay")}
              </button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
