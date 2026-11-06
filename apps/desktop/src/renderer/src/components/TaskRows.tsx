// Task rows (DESIGN §4.18): one mechanical line per cutex task action or delivery —
// 📋 verb [avatar] counterpart #N title. Own actions fold with other tools; deliveries don't.
import { useState } from "react";
import { ChevronDown, ChevronRight, CircleQuestionMark, ClipboardList, Hourglass, Loader2, ShieldCheck, ShieldX, X } from "lucide-react";
import type { MessageKey } from "../i18n";
import { useI18n } from "../i18n";
import { toolErrorText, unfinishedCreateAction, type TaskRowModel, type TaskRowOutcome } from "../lib/taskRows";
import { CreateAbandonButton } from "./CreateAbandonButton";
import { isFailed, isRunning } from "../lib/workGroups";
import type { RawItem } from "../lib/timeline";
import { formatSpan } from "../lib/delegations";
import { TaskTag, Who } from "./Parties";
import { useApp } from "../store";
import { convSessionOf, convSidebarOf, useConvHost, useConvScope } from "../lib/conversationScope";
import { approvalSubject, liveOutcome, useLiveApproval, type ShownOutcome, type ShownOutcomeKind } from "../lib/liveApproval";
import { sessionProfileName } from "../lib/agentLook";
import type { AgentHint } from "../lib/agentHint";
import { ToolErrorText } from "./ToolErrorText";
import { useUserLayoutToggle } from "../lib/userLayoutToggle";

/**
 * What is known of an agent an agent_create row creates (lib/taskRows counterpartHint): the call's project / Profile /
 * model, else the creating agent's (cutex's defaults: its project, `profile` "Default: yours") — so the chip is the
 * tile the sidebar will draw (owner 2026-11-01: wuwa-db-scout → DS in the model's colour, not a round W on a fill).
 */
function useCreateHint(task: TaskRowModel): AgentHint | null {
  const conv = useConvScope();
  const wanted = !!task.counterpartHint;
  const projectId = useApp((s) => {
    const id = wanted ? convSessionOf(conv, s) : null;
    return id ? (convSidebarOf(conv, s)?.hostRows[id]?.projectId ?? null) : null;
  });
  const profile = useApp((s) => {
    const id = wanted ? convSessionOf(conv, s) : null;
    const snapshot = id ? convSidebarOf(conv, s) : null;
    const session = snapshot ? [...snapshot.active, ...snapshot.retired].find((x) => x.cutexSessionId === id) : null;
    return session ? sessionProfileName(session) : null;
  });
  const hint = task.counterpartHint;
  return hint ? { projectId: hint.projectId ?? projectId, profile: hint.profile ?? profile, model: hint.model } : null;
}

/** The verb template with the counterpart spliced in at `{who}`. */
function Sentence({ task }: { task: TaskRowModel }) {
  const { t } = useI18n();
  const hint = useCreateHint(task);
  const [before, after = ""] = t(`taskrow.${task.verb}` as MessageKey).split("{who}");
  const who = task.counterpartId || task.counterpartName ? <Who id={task.counterpartId} name={task.counterpartName} hint={hint} /> : null;
  return (
    <>
      {before && <span className="shrink-0">{before.trim()}</span>}
      {who && <span className="inline-flex min-w-0 max-w-[35%] shrink-0">{who}</span>}
      {after.trim() && <span className="shrink-0">{after.trim()}</span>}
    </>
  );
}

function Tag({ task }: { task: TaskRowModel }) {
  const id = task.taskId ?? task.assignmentId;
  return id ? <TaskTag taskId={id} assignmentId={task.assignmentId ?? undefined} /> : null;
}

// The outcome word only (UI review #13): the reason after it stays muted, the row text too.
// approved / expired / decided: what became of a call that waited for the owner (lib/liveApproval).
const OUTCOME_TONE: Record<ShownOutcomeKind, string> = { failed: "text-danger", uncertain: "text-warn-text", approval: "text-warn-text", declined: "text-muted", approved: "text-ok-text", expired: "text-subtle", decided: "text-subtle" };

function RowIcon({ running, outcome }: { running: boolean; outcome: ShownOutcome | null }) {
  if (running) return <Loader2 size={13} className="shrink-0 animate-spin text-accent" />;
  // Same failed marker as other tool rows (WorkGroup ToolIcon).
  if (outcome?.kind === "failed") return <X size={13} className="shrink-0 text-danger" />;
  if (outcome?.kind === "uncertain") return <CircleQuestionMark size={13} className="shrink-0 text-warn" />;
  if (outcome?.kind === "approval") return <Hourglass size={13} className="shrink-0 text-warn" />;
  if (outcome?.kind === "declined") return <ShieldX size={13} className="shrink-0 text-subtle" />;
  if (outcome?.kind === "approved") return <ShieldCheck size={13} className="shrink-0 text-ok-text" />;
  return <ClipboardList size={13} className="shrink-0 text-subtle" />;
}

export function TaskToolRow({ item, task }: { item: RawItem; task: TaskRowModel }) {
  const { t } = useI18n();
  const userToggle = useUserLayoutToggle();
  const [open, setOpen] = useState(false);
  const running = isRunning(item);
  const replied: TaskRowOutcome | null = running ? null : (task.outcome ?? (isFailed(item) ? { kind: "failed" as const, code: null, detail: null } : null));
  // A call that waited for the owner (delegation review, profile approval) follows the host's lists, not the first reply.
  const live = useLiveApproval(useConvHost(), replied?.kind === "approval" ? approvalSubject(item) : null);
  const outcome = liveOutcome(replied, live);
  // The refusal reason ("code: detail") replaces the text on the collapsed line; expanding shows both.
  const reason = outcome ? [outcome.code, outcome.detail].filter(Boolean).join(": ") || null : null;
  // What the call returned, in full, when it says more than the reason (e.g. a Management envelope).
  const returned = outcome?.kind === "failed" ? toolErrorText(item) : null;
  const raw = returned && returned.trim() !== outcome?.detail?.trim() ? returned : null;
  const body = [task.text, task.detail].filter(Boolean).join("\n\n") || null;
  const full = [body, reason, raw].filter(Boolean).join("\n\n") || null;
  const long = !!full && (full.length > 80 || (!!reason && !!task.text) || !!task.detail || !!raw);
  const took = !running && typeof item.durationMs === "number" ? formatSpan(item.durationMs / 1000) : null;
  return (
    <div className="my-0.5 min-w-0 max-w-full text-xs" data-task-tool-row="">
      <button onClick={() => long && userToggle(() => setOpen(!open))} title={[task.counterpartName, full].filter(Boolean).join("\n") || undefined} className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-left text-muted hover:text-foreground">
        <RowIcon running={running} outcome={outcome} />
        <Sentence task={task} />
        <Tag task={task} />
        {outcome && <span className={`shrink-0 ${OUTCOME_TONE[outcome.kind]}`}>· {t(`taskrow.outcome.${outcome.kind}`)}</span>}
        {took && !outcome && !task.text && <span className="shrink-0 text-subtle tabular-nums">· {took}</span>}
        {!open && (reason ? <span className="min-w-0 truncate text-subtle">{reason.replace(/\s+/g, " ")}</span> : task.text && <span className="min-w-0 truncate text-subtle">{task.text.replace(/\s+/g, " ")}</span>)}
        {long && (open ? <ChevronDown size={13} className="ml-auto shrink-0" /> : <ChevronRight size={13} className="ml-auto shrink-0" />)}
      </button>
      {/* Design 028 (d): an unfinished agent_create (its own, or the one still holding the name). */}
      {outcome?.kind === "failed" && unfinishedCreateAction(item) && (
        <div className="mt-0.5 ml-5">
          <CreateAbandonButton actionId={unfinishedCreateAction(item)!} />
        </div>
      )}
      {open && full && (
        <div className="selectable message-body mt-1 ml-5 max-w-[75%] rounded-xl border border-dashed border-border px-3 py-1.5 whitespace-pre-wrap text-muted">
          {body}
          {reason && <div className={body ? "mt-1.5" : ""}>{reason}</div>}
          {raw && <ToolErrorText text={raw} className={body || reason ? "mt-1.5" : ""} />}
        </div>
      )}
    </div>
  );
}

/** An assignment or change request delivered to this agent; never folded. */
export function TaskDeliveryRow({ task, body }: { task: TaskRowModel; body: string }) {
  const [open, setOpen] = useState(false);
  const userToggle = useUserLayoutToggle();
  const tone = task.verb === "changesRequested" ? "text-warn" : "text-accent";
  return (
    <div className="my-2 min-w-0 max-w-full text-xs">
      <button onClick={() => userToggle(() => setOpen(!open))} title={body} className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-left text-muted hover:text-foreground">
        <ClipboardList size={13} className={`shrink-0 ${tone}`} />
        <Sentence task={task} />
        <Tag task={task} />
        {task.text && <span className="min-w-0 truncate text-foreground">{task.text.replace(/\s+/g, " ")}</span>}
        {open ? <ChevronDown size={13} className="ml-auto shrink-0" /> : <ChevronRight size={13} className="ml-auto shrink-0" />}
      </button>
      {open && <div className="selectable message-body mt-1 ml-5 max-w-[75%] rounded-xl border border-border bg-peer px-3 py-1.5 text-caption/[inherit] whitespace-pre-wrap">{body}</div>}
    </div>
  );
}
