// Thread goal (`/goal`). GoalCard is the detail card (objective, status, pause / resume / edit /
// clear), shared by the status capsule (StatusCapsule: display + 暂停 / 继续 only) and the
// status row above the input (GoalBar: one line expanding to the card). Editing always happens in
// GoalBar, next to the input — also when the goal's line is not shown there (Settings → 状态显示).
// The goal module (modules/goal) mounts GoalBar as its status-row part.
// Live from thread/goal/updated|cleared.
import { useEffect, useRef, useState } from "react";
import type { ThreadGoal } from "@cutex-desktop/protocol/codex/v2";
import { useI18n, type MessageKey } from "../i18n";
import { ARMED_BUTTON, ARMED_FRAME, useArmed } from "../lib/armedConfirm";
import { budgetText, formatGoalSeconds as formatSeconds, formatGoalTokens as formatTokens, parseBudget } from "../lib/goalBudget";
import { goalTone } from "../lib/goalStatus";
import { useTrackOverlay } from "../lib/openOverlays";
import { goalRequest, useUiSignal, type GoalRequest } from "../lib/uiSignal";
import type { RevealIntent } from "../modules/slots";
import { useApp } from "../store";
import { useConvHost, useConvSession } from "../lib/conversationScope";
import { GoalMark } from "./GoalMark";

/**
 * Goal details with its actions. Edit and clear-confirm happen inside the card; clearing is
 * click-twice (lib/armedConfirm: the card turns red). Esc steps out of edit / replace first (and
 * swallows that Esc, so the surrounding panel stays open).
 */
export function GoalCard({ goal, request, pauseOnly = false, className, idleBorder = "border-border", title = true }: { goal: ThreadGoal; request: GoalRequest | null; /** Capsule: display + 暂停/继续 only (edit / clear live in the status row). */ pauseOnly?: boolean; className: string; idleBorder?: string; title?: boolean }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<GoalRequest["mode"]>(request?.mode ?? "view");
  const [draft, setDraft] = useState(request?.draft ?? "");
  // Token budget, edited together with the objective ("" = none / ∞).
  const [budgetDraft, setBudgetDraft] = useState(budgetText(goal.tokenBudget));
  const budget = parseBudget(budgetDraft);
  const budgetChanged = budget !== undefined && budget !== (goal.tokenBudget ?? null);
  const save = () => void act(() => setGoal({ objective: draft.trim(), ...(budgetChanged ? { tokenBudget: budget } : {}) }));
  const canSave = !!draft.trim() && budget !== undefined;
  const [armed, setArmed] = useArmed();
  // The conversation's agent (lib/conversationScope): its goal, whichever agent is selected.
  const sessionId = useConvSession() ?? undefined;
  const hostId = useConvHost();
  const store = useApp.getState;
  const setGoal = (patch: Parameters<ReturnType<typeof store>["setGoal"]>[0]) => store().setGoal(patch, sessionId, hostId);
  const clearGoal = () => store().clearGoal(sessionId, hostId);
  const replaceGoal = (objective: string) => store().replaceGoal(objective, sessionId, hostId);
  useEffect(() => {
    if (!request) return;
    setMode(request.mode);
    setDraft(request.draft);
    setBudgetDraft(budgetText(goal.tokenBudget));
    setArmed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);
  useEffect(() => {
    if (mode === "view") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setMode("view");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode]);
  const status = t(`goal.status.${goal.status}` as MessageKey);
  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      setMode("view");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const active = goal.status === "active";
  const btn = "shrink-0 rounded-md bg-surface-2 px-2 py-1 text-xs hover:text-foreground";
  // Edit / replace action row: same height, actions on the right (a hint, if any, takes the left);
  // the view row carries the stats on its left instead.
  const ACTIONS = "flex h-7 items-center justify-end gap-1.5";
  const VIEW_ROW = "flex min-h-7 items-center gap-1.5";
  const STATS = "mr-auto flex min-w-0 flex-wrap gap-x-3 text-xs text-subtle";
  const stats = (
    <>
      <span className={active ? "" : goalTone(goal.status)}>{status}</span>
      {mode === "edit" ? (
        <label className="flex items-center gap-1">
          {formatTokens(goal.tokensUsed)} /
          <input
            value={budgetDraft}
            onChange={(e) => setBudgetDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) save();
            }}
            placeholder="∞"
            title={t("goal.budgetHint")}
            aria-label={t("goal.budget")}
            className={`-my-px h-[18px] w-16 rounded border bg-background px-1 text-xs leading-4 outline-none ${budget === undefined ? "border-danger" : "border-border focus:border-accent"}`}
          />
          tokens
        </label>
      ) : (
        <span>{t("goal.tokens", { used: formatTokens(goal.tokensUsed), budget: goal.tokenBudget ? formatTokens(goal.tokenBudget) : "∞" })}</span>
      )}
      <span>{t("goal.time", { time: formatSeconds(goal.timeUsedSeconds) })}</span>
    </>
  );
  return (
    <div className={`${className} border transition-colors ${armed ? ARMED_FRAME : idleBorder}`}>
      {title && <div className="mb-1 text-xs text-subtle">{t("goal.title")}</div>}
      {mode === "replace" ? (
        <div className="mb-2 rounded-lg border border-accent/40 bg-accent/5 px-2 py-1.5">
          <div className="mb-0.5 text-xs text-subtle">{t("goal.replaceWith")}</div>
          <p className="whitespace-pre-wrap">{draft}</p>
        </div>
      ) : mode === "edit" ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSave) save();
          }}
          rows={1}
          className="-mx-[9px] -mt-[7px] mb-[1px] block max-h-48 w-[calc(100%+18px)] resize-none overflow-y-auto rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none [field-sizing:content] focus:border-accent"
        />
      ) : (
        <p className="mb-2 whitespace-pre-wrap">{goal.objective}</p>
      )}
      {/* Edit / replace keep the stats on their own line (the budget field, the hint); in view they
          share the action row: status bottom-left, buttons on the right. */}
      {mode !== "view" && <div className="mb-2 flex flex-wrap gap-x-4 text-xs text-subtle">{stats}</div>}
      {mode === "edit" ? (
        <div className={ACTIONS}>
          <span className="mr-auto text-xs text-subtle">Ctrl+Enter</span>
          <button className={btn} onClick={() => setMode("view")}>{t("goal.cancel")}</button>
          <button className="rounded-md bg-accent px-2 py-1 text-xs text-white disabled:opacity-50" disabled={!canSave} onClick={save}>
            {t("goal.save")}
          </button>
        </div>
      ) : mode === "replace" ? (
        <div className={ACTIONS}>
          <span className="mr-auto text-xs text-subtle">{t("goal.replaceHint")}</span>
          <button className={btn} onClick={() => setMode("view")}>{t("goal.cancel")}</button>
          <button className="rounded-md bg-accent px-2 py-1 text-xs text-white" autoFocus onClick={() => void act(() => replaceGoal(draft))}>
            {t("goal.replace")}
          </button>
        </div>
      ) : pauseOnly ? (
        <div className={VIEW_ROW}>
          <div className={STATS}>{stats}</div>
          {active ? (
            <button className={btn} onClick={() => void act(() => setGoal({ status: "paused" }))}>{t("goal.pause")}</button>
          ) : (
            goal.status !== "complete" && <button className={btn} onClick={() => void act(() => setGoal({ status: "active" }))}>{t("goal.resume")}</button>
          )}
        </div>
      ) : (
        <div className={VIEW_ROW}>
          {/* Armed: the confirm hint takes the stats' place until it disarms. */}
          {armed ? (
            <span className="mr-auto text-xs text-danger">{t("goal.clearAgain")}</span>
          ) : (
            <div className={STATS}>{stats}</div>
          )}
          {!armed && (
            <>
              {active ? (
                <button className={btn} onClick={() => void act(() => setGoal({ status: "paused" }))}>{t("goal.pause")}</button>
              ) : (
                goal.status !== "complete" && <button className={btn} onClick={() => void act(() => setGoal({ status: "active" }))}>{t("goal.resume")}</button>
              )}
              <button
                className={btn}
                onClick={() => {
                  setDraft(goal.objective);
                  setBudgetDraft(budgetText(goal.tokenBudget));
                  setMode("edit");
                }}
              >
                {t("goal.edit")}
              </button>
            </>
          )}
          <button className={armed ? `${ARMED_BUTTON} py-1` : `${btn} text-danger`} onClick={() => (armed ? void act(clearGoal) : setArmed(true))}>
            {t("goal.clear")}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Status-row goal: one line (`inline`), the card floats up over the timeline. Without the line it
 *  still opens the card for edit / replace requests (intent "edit": always here); "show" requests
 *  go where `reveal` picks — the capsule when only it shows the goal, else this card. */
export function GoalBar({ goal, inline, reveal }: { goal: ThreadGoal | null; inline: boolean; reveal(intent: RevealIntent, openBarPanel: () => void): unknown }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<GoalRequest | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useTrackOverlay(open && !!goal);
  useUiSignal("goal", (arg) => {
    if (!goal) return;
    const next = goalRequest(arg, goal.objective);
    reveal(next.mode === "view" ? "view" : "edit", () => {
      setRequest(next);
      setOpen(true);
    });
  });
  useEffect(() => {
    if (!open) {
      setRequest(null);
      return;
    }
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!goal) return null;
  // Opens from its trigger (left of the status row) and only as wide as it needs, so its actions stay
  // near where the click was; the plan / background popovers do the same from the right.
  const card = open && <GoalCard goal={goal} request={request} className="absolute bottom-full left-6 z-30 w-[28rem] max-w-[calc(100%-3rem)] rounded-xl bg-surface p-2.5 text-sm shadow-xl" />;
  if (!inline) return card ? <div ref={root}>{card}</div> : null;
  const active = goal.status === "active";
  return (
    <div ref={root} className="min-w-0 flex-1">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 py-1 text-left text-xs text-muted hover:text-foreground" title={goal.objective}>
        <GoalMark status={goal.status} size={13} />
        <span className="shrink-0">{t("goal.label")}</span>
        <span className="min-w-0 truncate text-foreground">{goal.objective}</span>
        <span className={`shrink-0 ${active ? "text-subtle" : goalTone(goal.status)}`}>· {t(`goal.status.${goal.status}` as MessageKey)}</span>
      </button>
      {card}
    </div>
  );
}
