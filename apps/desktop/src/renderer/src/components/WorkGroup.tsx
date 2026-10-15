// Tool and reasoning steps and their folding (DESIGN §4.14): a closed work group is one summary line;
// an open group (nothing after it yet) shows its newest steps; failures stay visible even when folded.
import { memo, useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { useUiPrefs } from "../lib/prefs";
import { reasoningLastLine, reasoningText, type ReasoningEntry } from "../lib/reasoning";
import { useNow } from "../lib/time";
import type { RawItem } from "../lib/timeline";
import { isFailed, type StepEntry, type WorkSummary } from "../lib/workGroups";
import { Markdown } from "./Markdown";
import { ToolOutlet } from "../modules/TimelineOutlet";

const LIVE_VISIBLE = 3;

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
    <div className="my-0.5 text-xs">
      <button onClick={() => setToggled(!open)} aria-expanded={open} className="flex max-w-full items-center gap-1.5 text-muted hover:text-foreground">
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
  return <ToolOutlet item={item} sessionId={sessionId} />;
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

// Steps are timeline entries (replaced, never mutated) and the summary derives from them: a group
// whose steps are the same objects renders the same.
export const WorkGroup = memo(WorkGroupView, (a, b) => a.sessionId === b.sessionId && a.open === b.open && a.steps.length === b.steps.length && a.steps.every((s, i) => s === b.steps[i]));

function WorkGroupView({ steps, open: openGroup, summary, sessionId }: { steps: StepEntry[]; open: boolean; summary: WorkSummary; sessionId: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  // A single step gains nothing from folding.
  if (steps.length === 1) return <StepRow sessionId={sessionId} step={steps[0]!} />;
  if (openGroup && expanded === null) {
    const hidden = Math.max(0, steps.length - LIVE_VISIBLE);
    return (
      <div className="my-1">
        {hidden > 0 && (
          <button onClick={() => setExpanded(true)} className="my-0.5 flex items-center gap-1.5 text-xs text-subtle hover:text-foreground">
            <ChevronRight size={13} />
            {t("work.moreSteps", { n: hidden })}
          </button>
        )}
        {steps.slice(-LIVE_VISIBLE).map((e) => (
          <StepRow sessionId={sessionId} key={e.id} step={e} />
        ))}
      </div>
    );
  }
  const open = expanded === true;
  const failedRows = steps.filter((e) => e.kind === "tool" && isFailed(e.item));
  return (
    <div className="my-1">
      <button onClick={() => setExpanded(!open)} className="my-0.5 flex max-w-full items-center gap-1.5 text-xs text-muted hover:text-foreground">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {summary.failed ? <X size={13} className="text-danger" /> : <Check size={13} className="text-ok" />}
        <span className="truncate">{summaryText(summary, t)}</span>
        {summary.failed > 0 && <span className="shrink-0 text-danger">· {t("work.failed", { n: summary.failed })}</span>}
        {summary.durationMs !== null && <span className="shrink-0 text-subtle">· {formatMs(summary.durationMs)}</span>}
      </button>
      {open ? (
        <div className="ml-2 border-l border-border pl-2.5">
          {steps.map((e) => (
            <StepRow sessionId={sessionId} key={e.id} step={e} />
          ))}
        </div>
      ) : (
        failedRows.length > 0 && (
          <div className="ml-2 border-l border-danger/40 pl-2.5">
            {failedRows.map((e) => (
              <StepRow sessionId={sessionId} key={e.id} step={e} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
