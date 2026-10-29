// Tool and reasoning steps and their folding (DESIGN §4.14): a work group is one summary line, open (nothing after it
// yet) or closed — while it runs the line carries a spinner and the current step, so it never folds from several rows
// to one when the next message arrives (owner 2026-10-24: rows above the newest jumped). Its steps are one click away;
// failures stay visible under the line.
import { memo, useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronDown, ChevronRight, Loader2, ShieldAlert, X } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { useUiPrefs } from "../lib/prefs";
import { reasoningLastLine, reasoningText, type ReasoningEntry } from "../lib/reasoning";
import { useNow } from "../lib/time";
import { autoReviewOf, type RawItem } from "../lib/timeline";
import { AutoReviewLine } from "./AutoReview";
import { isFailed, isRunning, toolDetail, type StepEntry, type WorkSummary } from "../lib/workGroups";
import { safetyNoteOfItem } from "../lib/ownerNotify";
import { useHostOwnerNotes } from "../lib/ownerNotifyStore";
import { useConvHost } from "../lib/conversationScope";
import { useHeldBusy } from "../lib/busyHold";
import { Markdown } from "./Markdown";
import { ToolOutlet } from "../modules/TimelineOutlet";
import { useUserLayoutToggle } from "../lib/userLayoutToggle";

function formatMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * A reasoning step: 推理 (full reasoning or summaries, one label) · how long it took (when seen
 * live), opening to the text in a dim, height-capped box that follows the stream while it grows.
 * Open by default only when Settings → 推理过程 = 展开 (default 折叠, also while streaming); the
 * row's own toggle overrides. A live row shimmers.
 */
export function ReasoningRow({ entry }: { entry: ReasoningEntry }) {
  const { t } = useI18n();
  const userToggle = useUserLayoutToggle();
  const { reasoningView } = useUiPrefs();
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? reasoningView === "expanded";
  const body = reasoningText(entry);
  const live = entry.streaming;
  const now = useNow(live);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && live && stick.current) el.scrollTop = el.scrollHeight;
  }, [body?.text, live, open]);
  if (!body) return null;
  const end = live ? now / 1000 : entry.completedAt;
  const seconds = entry.startedAt !== null && end !== null ? Math.max(0, end - entry.startedAt) : null;
  const label = live ? t("reasoning.live") : t("reasoning.done");
  return (
    <div className="my-0.5 text-xs" data-tool-row="reasoning">
      <button onClick={() => userToggle(() => setToggled(!open))} aria-expanded={open} className="flex max-w-full items-center gap-1.5 text-muted hover:text-foreground">
        {live ? <Loader2 size={13} className="shrink-0 animate-spin text-accent" /> : <Brain size={13} className="shrink-0 text-subtle" />}
        {/* While live, one shimmer band sweeps across label · time › current line (styles.css). */}
        <span className={`flex min-w-0 items-center gap-1.5 ${live ? "text-shimmer" : ""}`}>
          <span className="shrink-0 font-medium">{label}</span>
          {seconds !== null && <span className={`shrink-0 tabular-nums ${live ? "" : "text-subtle"}`}>· {formatMs(seconds * 1000)}</span>}
          {open ? <ChevronDown size={13} className="shrink-0 text-subtle" /> : <ChevronRight size={13} className="shrink-0 text-subtle" />}
          {!open && <span className={`min-w-0 truncate ${live ? "" : "text-subtle"}`}>{reasoningLastLine(entry)}</span>}
        </span>
      </button>
      {open && (
        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
          }}
          className="mt-1 mb-1.5 ml-1.5 max-h-60 overflow-y-auto border-l border-border pl-3 text-subtle"
        >
          <Markdown text={body.text} streaming={live} compact />
        </div>
      )}
    </div>
  );
}

function StepRow({ step, sessionId }: { step: StepEntry; sessionId: string }) {
  return step.kind === "reasoning" ? <ReasoningRow entry={step} /> : <ToolRow item={step.item} sessionId={sessionId} />;
}

export function ToolRow({ item, sessionId }: { item: RawItem; sessionId: string }) {
  const review = autoReviewOf(item);
  if (!review) return <ToolOutlet item={item} sessionId={sessionId} />;
  return (
    <>
      <ToolOutlet item={item} sessionId={sessionId} />
      <AutoReviewLine review={review} />
    </>
  );
}

function summaryText(s: WorkSummary, t: (k: MessageKey, v?: Record<string, string | number>) => string): string {
  const parts = [
    s.commands && t("work.commands", { n: s.commands }),
    s.files && t("work.files", { n: s.files }),
    s.tools && t("work.tools", { n: s.tools }),
    s.agents && t("work.agents", { n: s.agents }),
  ].filter(Boolean);
  // Reasoning folds with the tools but is only named when there is nothing else to name.
  return (parts.length ? parts : [s.reasoning && t("work.reasoning", { n: s.reasoning })].filter(Boolean)).join(" · ");
}

/** How long a running turn's work group keeps its working look after a step ends (the next one usually follows). */
const STEP_GAP_HOLD_MS = 1000;

// Steps are timeline entries (replaced, never mutated) and the summary derives from them: a group
// whose steps are the same objects renders the same.
export const WorkGroup = memo(WorkGroupView, (a, b) => a.sessionId === b.sessionId && a.open === b.open && a.steps.length === b.steps.length && a.steps.every((s, i) => s === b.steps[i]));

function WorkGroupView({ steps, open: openGroup, summary, sessionId }: { steps: StepEntry[]; open: boolean; summary: WorkSummary; sessionId: string }) {
  const { t } = useI18n();
  const userToggle = useUserLayoutToggle();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const notes = useHostOwnerNotes(useConvHost());
  // Still working (the group is open and its newest step runs): the spinner and that step on the summary line.
  // Between two steps of a running turn (the group still open) it stays 「working」 for up to a second: the
  // done look (✓ · 1s) flashed for ~0.17 s before the next step started (flicker recorder 2026-10-26).
  const last = steps[steps.length - 1]!;
  const live = useHeldBusy(openGroup && (last.kind === "tool" ? isRunning(last.item) : last.streaming), openGroup, STEP_GAP_HOLD_MS);
  // A single step gains nothing from folding.
  if (steps.length === 1) return <StepRow sessionId={sessionId} step={steps[0]!} />;
  const open = expanded === true;
  const current = live ? (last.kind === "tool" ? toolDetail(last.item) : t("reasoning.live")) : null;
  const failedRows = steps.filter((e) => e.kind === "tool" && isFailed(e.item));
  // Calls a safety check stopped (claude-safety-grants notice) are not failures: 已拦截, not red.
  const blocked = failedRows.filter((e) => e.kind === "tool" && safetyNoteOfItem(notes, sessionId, e.item.id)?.safetyBlock).length;
  const failedCount = Math.max(0, summary.failed - blocked);
  return (
    <div className="my-1 min-w-0 max-w-full">
      <button onClick={() => userToggle(() => setExpanded(!open))} className="my-0.5 flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted hover:text-foreground">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {live ? <Loader2 size={13} className="shrink-0 animate-spin text-accent" /> : failedCount ? <X size={13} className="text-danger" /> : blocked ? <ShieldAlert size={13} className="text-warn-text" /> : <Check size={13} className="text-ok" />}
        <span className="truncate">{summaryText(summary, t)}</span>
        {current && <span data-work-current="" className="min-w-0 truncate font-mono text-subtle">· {current}</span>}
        {failedCount > 0 && <span className="shrink-0 text-danger">· {t("work.failed", { n: failedCount })}</span>}
        {blocked > 0 && <span className="shrink-0 text-muted">· {t("work.safetyBlocked", { n: blocked })}</span>}
        {summary.durationMs !== null && !live && <span className="shrink-0 text-subtle">· {formatMs(summary.durationMs)}</span>}
      </button>
      {open ? (
        <div className="ml-2 min-w-0 border-l border-border pl-2.5">
          {steps.map((e) => (
            <StepRow sessionId={sessionId} key={e.id} step={e} />
          ))}
        </div>
      ) : (
        failedRows.length > 0 && (
          <div className={`ml-2 border-l pl-2.5 ${failedCount ? "border-danger/40" : "border-border"}`}>
            {failedRows.map((e) => (
              <StepRow sessionId={sessionId} key={e.id} step={e} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
