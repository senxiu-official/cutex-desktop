// Plan mode's proposed plan as a card, with the TUI's "Implement this plan?" choices on the latest
// one; and the `update_plan` checklist. ("Clear context and implement" is left out: one agent =
// one thread, no /clear.) A Claude agent gets Claude Code's plan approval choices instead
// (ClaudePlanChoices: auto-accept edits / approve edits manually / keep planning with feedback).
import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Circle, CircleDot, ListChecks, NotebookPen } from "lucide-react";
import { useI18n } from "../../i18n";
import { useStatusPlacement } from "../../lib/statusItemsView";
import { shownSomewhere } from "../../lib/statusSurfaces";
import { planProgress, type PlanStep } from "../../lib/statusCapsule";
import { captureHostAction } from "../../lib/hostSwitch";
import { useApp } from "../../store";
import { convLiveOf, convViewOf, useConvScope, useConvViewHost } from "../../lib/conversationScope";
import { Markdown } from "../../components/Markdown";
import { PlanChoicesGate } from "./ClaudePlanChoices";

/** Same user message the TUI sends (PLAN_IMPLEMENTATION_CODING_MESSAGE). */
const IMPLEMENT_MESSAGE = "Implement the plan.";

export function PlanCard({ sessionId, text, streaming, actionable }: { sessionId: string; text: string; streaming: boolean; actionable: boolean }) {
  const { t } = useI18n();
  const [decided, setDecided] = useState(false);
  // Open while it streams and while it waits for a decision; folded to its title line afterwards
  // (and for older plans). A click on the header overrides either way.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const pending = actionable && !decided && !streaming;
  const open = userOpen ?? (streaming || pending);
  const title = text.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  const decide = () => {
    setDecided(true);
    setUserOpen(null);
  };
  const [error, setError] = useState<string | null>(null);
  // Bind the displayed plan, before a click or an awaited mode switch can outlive its host/view.
  const currentHost = captureHostAction();
  // The conversation showing the plan (lib/conversationScope): still this agent at call time.
  const conv = useConvScope();
  const hostId = useConvViewHost(sessionId);
  const threadId = convViewOf(conv, useApp.getState(), sessionId)?.timeline.threadId ?? null;
  const current = () => currentHost() && convLiveOf(conv).sessionId === sessionId &&
    (convViewOf(conv, useApp.getState(), sessionId)?.timeline.threadId ?? null) === threadId;
  const implement = async () => {
    if (!current()) return;
    setError(null);
    const app = useApp.getState();
    try {
      const available = await app.setCollabMode("default", sessionId, hostId);
      if (!current() || available === null) return;
      if (!available) return setError(t("plan.defaultUnavailable"));
      decide();
      // Optimistic send (lib/outbox): a failure stays on the message with retry / edit / discard.
      await app.submit(IMPLEMENT_MESSAGE, "auto", [], { sessionId, hostId }).catch(() => {});
    } catch (error) {
      if (current()) setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className={`my-3 rounded-xl border bg-surface px-4 py-2.5 ${open ? "border-accent/40" : "border-border"}`}>
      <button onClick={() => setUserOpen(!open)} className="flex h-5 w-full items-center gap-1.5 text-left text-xs text-subtle hover:text-foreground">
        <NotebookPen size={13} className="shrink-0 text-accent" />
        <span className="shrink-0">{t("plan.title")}</span>
        {!open && <span className="min-w-0 truncate text-sm text-foreground">{title}</span>}
        <span className="ml-auto shrink-0">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open && (
        <div className="mt-1.5">
          <Markdown text={text} streaming={streaming} />
        </div>
      )}
      {pending && (
        // A Claude agent gets Claude Code's plan approval choices instead of these (PlanChoicesGate).
        <PlanChoicesGate sessionId={sessionId} current={current} onDecided={decide}>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
          <span className="mr-auto text-xs text-subtle">{t("plan.question")}</span>
          <button onClick={decide} className="rounded-md bg-surface-2 px-2.5 py-1 text-xs text-muted hover:text-foreground" title={t("plan.stayHint")}>
            {t("plan.stay")}
          </button>
          <button onClick={() => void implement()} className="rounded-md bg-accent px-2.5 py-1 text-xs text-white" title={t("plan.implementHint")}>
            {t("plan.implement")}
          </button>
        </div>
        </PlanChoicesGate>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

/** One `update_plan` step (timeline checklist and the status capsule's 进程 section). */
/** `row`: marks it as a capsule item row (lib/capsuleRows). */
export function PlanStepRow({ step, className = "", row = false }: { step: PlanStep; className?: string; row?: boolean }) {
  const s = step;
  return (
    <li data-capsule-row={row ? "" : undefined} className={`flex items-start gap-2 ${s.status === "completed" ? "text-subtle line-through" : s.status === "inProgress" ? "text-foreground" : "text-muted"} ${className}`}>
      <span className="mt-0.5 shrink-0">
        {s.status === "completed" ? <Check size={14} className="text-accent" /> : s.status === "inProgress" ? <CircleDot size={14} className="text-accent" /> : <Circle size={14} />}
      </span>
      <span className="min-w-0 break-words">{s.step}</span>
    </li>
  );
}

export function Checklist({ explanation, steps }: { explanation: string | null; steps: PlanStep[] }) {
  const { t } = useI18n();
  const { done, total } = planProgress(steps);
  return (
    <div className="my-2 text-sm">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-subtle">
        <ListChecks size={13} />
        {t("plan.checklist", { done, total })}
      </div>
      {explanation && <p className="mb-1 text-xs text-muted italic">{explanation}</p>}
      <ul className="space-y-0.5">
        {steps.map((s, i) => (
          <PlanStepRow key={i} step={s} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Timeline entry for an `update_plan` snapshot. When 进程 is shown in the status row or the capsule
 * (the live list lives there) it is one line, "更新了进程 2/4", expandable to the full list; when
 * 进程 is shown nowhere — hidden, or only in a capsule that is off (effective placement, contract
 * 1.2) — the full checklist.
 */
export function ChecklistEntry({ explanation, steps }: { explanation: string | null; steps: PlanStep[] }) {
  const { t } = useI18n();
  // This module's status item, where it actually shows; null while the module is off — both keep
  // the full transcript list.
  const placement = useStatusPlacement("plan.status");
  const [open, setOpen] = useState(false);
  // The model emptied its list (update_plan with no steps): the capsule keeps the previous one.
  if (steps.length === 0)
    return (
      <div className="my-1.5 flex h-5 items-center gap-1.5 text-xs text-subtle">
        <ListChecks size={13} />
        {t("plan.clearedEntry")}
      </div>
    );
  if (!shownSomewhere(placement)) return <Checklist explanation={explanation} steps={steps} />;
  const { done, total } = planProgress(steps);
  return (
    <div className="my-1.5 text-sm">
      <button onClick={() => setOpen(!open)} className="flex h-5 items-center gap-1.5 text-xs text-subtle hover:text-foreground">
        <ListChecks size={13} />
        {t("plan.updated", { done, total })}
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="mt-1 ml-5">
          {explanation && <p className="mb-1 text-xs text-muted italic">{explanation}</p>}
          <ul className="space-y-0.5">
            {steps.map((s, i) => (
              <PlanStepRow key={i} step={s} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
