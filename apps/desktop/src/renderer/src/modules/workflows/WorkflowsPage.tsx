// 工作流 page (cutex workflows, W1), focus host: the run list (进行中 / 已结束 / 全部) as one-line rows
// built like the delegation rows (status glyph + word · #N name · who started it · phase · steps ·
// tokens / cap · when); a row opens its detail in place: the plan approval card while the run waits
// for the owner (批准并运行 / 拒绝 + note), usage against the limits, phases, steps grouped by phase,
// the log, the result and the script (folded); 停止 (two clicks) while open, 继续 (a new run reusing
// the finished steps) and 删除 (two clicks) once finished. Live from the workflow host events.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Workflow } from "lucide-react";
import { WORKFLOW_RESUME_FEATURE, WORKFLOWS_FEATURE, isWorkflowRunOpen, type WorkflowRunState, type WorkflowRunSummary, type WorkflowRunView, type WorkflowStepView } from "../../../../shared/workflows";
import { useI18n, type MessageKey } from "../../i18n";
import { copyText } from "../../lib/menus";
import { refusalText } from "../../lib/profileCreate";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { featuresOf, useApp } from "../../store";
import { hostData } from "../../lib/hostScope";
import { PageBody, PageToolbar } from "../../components/Page";
import { Button, Segmented } from "../../components/settings/Form";
import { services } from "../app";
import type { PageParams } from "../slots";
import { autoExpandWaiting } from "./model";
import { loadRun, loadRuns, useFocusHost, useRunDetailState, useRuns } from "./store";

type Scope = "open" | "closed" | "all";

const GLYPH: Record<WorkflowRunState, { glyph: string; tone: string }> = {
  pendingApproval: { glyph: "○", tone: "text-warn" },
  running: { glyph: "●", tone: "text-accent" },
  stopping: { glyph: "◌", tone: "text-muted" },
  completed: { glyph: "✓", tone: "text-ok" },
  errored: { glyph: "✕", tone: "text-danger" },
  stopped: { glyph: "◌", tone: "text-muted" },
  rejected: { glyph: "✕", tone: "text-subtle" },
  expired: { glyph: "◌", tone: "text-subtle" },
};

const STEP_TONE: Record<WorkflowStepView["state"], string> = {
  queued: "text-subtle",
  starting: "text-muted",
  running: "text-accent",
  done: "text-ok-text",
  failed: "text-danger",
  cached: "text-muted",
};

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n));

function When({ iso }: { iso: string | null | undefined }) {
  const { locale } = useI18n();
  const now = useClock();
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  return (
    <span className="shrink-0 text-[11px] text-subtle tabular-nums" title={formatAbsolute(ms / 1000)}>
      {formatWhen(ms / 1000, now, locale)}
    </span>
  );
}

function StateWord({ run }: { run: Pick<WorkflowRunSummary, "state" | "stopReason"> }) {
  const { t } = useI18n();
  const look = GLYPH[run.state] ?? GLYPH.stopped;
  const reason = run.state === "stopped" && run.stopReason ? ` · ${t(`workflows.stopReason.${run.stopReason}` as MessageKey)}` : "";
  return (
    <span className={`flex shrink-0 items-center gap-1 text-xs ${look.tone}`}>
      <span aria-hidden className={run.state === "running" ? "animate-pulse" : ""}>{look.glyph}</span>
      {t(`workflows.state.${run.state}` as MessageKey)}
      {reason && <span className="text-subtle">{reason}</span>}
    </span>
  );
}

function useAuthorName(run: WorkflowRunSummary): string {
  const { t } = useI18n();
  const sidebar = useApp((s) => s.sidebar);
  if (run.author.kind === "owner") return t("workflows.byOwner");
  const id = run.author.cutex_session_id;
  const session = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === id);
  return t("workflows.by", { name: session?.displayName ?? run.author.name ?? id });
}

function RunRow({ run, open, onToggle }: { run: WorkflowRunSummary; open: boolean; onToggle(): void }) {
  const { t } = useI18n();
  const author = useAuthorName(run);
  const phaseIndex = run.currentPhase ? run.phases.findIndex((p) => p.title === run.currentPhase) : -1;
  const finished = run.counts.done + run.counts.cached;
  return (
    <button onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2/60" aria-expanded={open}>
      {open ? <ChevronDown size={14} className="shrink-0 text-subtle" /> : <ChevronRight size={14} className="shrink-0 text-subtle" />}
      <Workflow size={14} strokeWidth={1.75} className="shrink-0 text-muted" />
      <span className="shrink-0 text-xs text-subtle tabular-nums">#{run.seq}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={run.description}>
        {run.name}
        <span className="ml-2 text-xs font-normal text-subtle">{author}</span>
      </span>
      {run.currentPhase && (
        <span className="hidden shrink-0 truncate text-xs text-muted sm:inline" title={run.currentPhase}>
          {phaseIndex >= 0 ? t("workflows.phaseOf", { i: phaseIndex + 1, n: run.phases.length }) : run.currentPhase}
        </span>
      )}
      {run.counts.total > 0 && <span className="shrink-0 text-xs text-muted tabular-nums">{t("workflows.stepsDone", { done: finished, total: run.counts.total })}</span>}
      {run.counts.running > 0 && <span className="shrink-0 text-xs text-accent tabular-nums">{t("workflows.running", { n: run.counts.running })}</span>}
      <span className="shrink-0 text-xs text-subtle tabular-nums">{t("workflows.tokens", { spent: compact(run.tokens), cap: compact(run.limits.maxTokens) })}</span>
      <StateWord run={run} />
      <When iso={run.endedAt ?? run.startedAt ?? run.createdAt} />
    </button>
  );
}

function Bar({ value, cap }: { value: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={`h-full rounded-full ${pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium tracking-wide text-subtle uppercase">
        <span>{title}</span>
        <span className="flex-1" />
        {right}
      </div>
      {children}
    </div>
  );
}

function Mono({ text, max = "max-h-64" }: { text: string; max?: string }) {
  return <pre className={`${max} overflow-auto rounded-lg bg-surface-2/60 px-3 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap`}>{text}</pre>;
}

const pretty = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

function ScriptFold({ hostId, runId }: { hostId: string; runId: string }) {
  const { t } = useI18n();
  const [script, setScript] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || script !== null) return;
    void services
      .daemonFor(hostId)
      .workflowRun(runId, ["script"])
      .then((r) => setScript(r.script ?? ""))
      .catch((e) => setScript(String(e)));
  }, [open, script, hostId, runId]);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs text-muted hover:text-foreground">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t(open ? "workflows.plan.hideScript" : "workflows.plan.showScript")}
      </button>
      {open && <div className="mt-1">{script === null ? <p className="text-xs text-subtle">…</p> : <Mono text={script} max="max-h-96" />}</div>}
    </div>
  );
}

/** The plan card while the run waits for the owner (approval kind workflow_run). */
function PlanCard({ hostId, run, claude }: { hostId: string; run: WorkflowRunView; claude: readonly string[] }) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "approve" | "deny") => {
    if (!run.approvalId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await services.daemonFor(hostId).decideApproval(run.approvalId, decision, note || undefined);
      if (!r.ok) setError(r.error.code === "approval_not_pending" ? t("workflows.alreadyDecided") : refusalText(r.error, t));
      void loadRuns(hostId);
      void loadRun(hostId, run.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const fact = (label: string, value: React.ReactNode, mono = false) => (
    <div className="contents">
      <dt className="text-subtle">{label}</dt>
      <dd className={`min-w-0 break-words ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
  return (
    <section className="mt-1 rounded-xl border border-warn/40 bg-warn/5 px-4 py-3">
      <div className="text-sm font-medium">{t("workflows.plan")}</div>
      <p className="mt-0.5 text-xs text-muted">{run.description}</p>
      <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {run.phases.length > 0 &&
          fact(
            t("workflows.plan.phases"),
            <ol className="list-decimal pl-4">
              {run.phases.map((p) => (
                <li key={p.title}>
                  {p.title}
                  {p.detail && <span className="text-subtle"> — {p.detail}</span>}
                </li>
              ))}
            </ol>,
          )}
        {fact(
          t("workflows.plan.profiles"),
          <span>
            {run.stepProfiles.join(", ") || "—"}
            {run.models.length > 0 && <span className="text-subtle"> · {run.models.join(", ")}</span>}
            {claude.length > 0 && <span className="mt-0.5 block text-warn">{t("workflows.plan.claude")}</span>}
          </span>,
        )}
        {fact(
          t("workflows.plan.limits"),
          <span>
            {t("workflows.plan.limitsValue", { agents: run.limits.maxAgents, concurrency: run.limits.maxConcurrency, tokens: run.limits.maxTokens.toLocaleString() })}
            {run.limits.hardStop && <span className="block text-subtle">{t("workflows.plan.hardStop")}</span>}
          </span>,
        )}
        {fact(t("workflows.plan.cwd"), run.cwd, true)}
        {run.args !== undefined && run.args !== null && fact(t("workflows.plan.args"), <span className="whitespace-pre-wrap">{JSON.stringify(run.args)}</span>, true)}
        {run.draftPath && fact(t("workflows.plan.draft"), run.draftPath, true)}
        {run.resumedFrom && fact("↻", t("workflows.plan.resumedFrom", { run: run.resumedFrom }))}
      </dl>
      <ScriptFold hostId={hostId} runId={run.runId} />
      <p className="mt-2 text-xs text-muted">{t("workflows.approveHint")}</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 1000))}
          placeholder={t("workflows.notePlaceholder")}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
        />
        <Button disabled={busy || !run.approvalId} onClick={() => void decide("deny")}>{t("workflows.reject")}</Button>
        <Button primary disabled={busy || !run.approvalId} onClick={() => void decide("approve")}>{t("workflows.approve")}</Button>
      </div>
      <p className="mt-1 h-4 truncate text-xs text-danger" title={error ?? undefined}>{error}</p>
    </section>
  );
}

function StepRow({ step }: { step: WorkflowStepView }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const title = step.label || step.prompt.split("\n")[0] || step.stepKey;
  const detail = step.error ? `${step.error.message} (${step.error.code})` : step.activity;
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 py-1.5 text-left text-xs hover:bg-surface-2/40">
        <span className={`w-14 shrink-0 ${STEP_TONE[step.state]}`}>{t(`workflows.step.${step.state}` as MessageKey)}</span>
        <span className="min-w-0 flex-1 truncate" title={step.prompt}>{title}</span>
        {step.repairs > 0 && <span className="shrink-0 text-warn" title={t("workflows.step.repaired")}>↺</span>}
        {step.profile && <span className="shrink-0 text-subtle">{step.profile}</span>}
        {detail && !open && <span className="max-w-[40%] shrink truncate text-subtle" title={detail}>{detail}</span>}
        {step.tokens > 0 && <span className="shrink-0 text-subtle tabular-nums">{t("workflows.step.tokens", { n: compact(step.tokens) })}</span>}
      </button>
      {open && (
        <div className="pb-2 pl-16 text-xs">
          <Mono text={step.prompt} max="max-h-40" />
          {detail && <p className="mt-1 text-subtle">{detail}</p>}
          {step.resultPreview && <div className="mt-1"><Mono text={step.resultPreview} max="max-h-40" /></div>}
          {step.cachedFrom && <p className="mt-1 text-subtle">↻ {step.cachedFrom}</p>}
        </div>
      )}
    </div>
  );
}

function RunDetail({ hostId, summary }: { hostId: string; summary: WorkflowRunSummary }) {
  const { t } = useI18n();
  const { run, gone } = useRunDetailState(hostId, summary.runId);
  const resumeSupported = useApp((s) => featuresOf(s, hostId).has(WORKFLOW_RESUME_FEATURE));
  const [armed, setArmed] = useState<"stop" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResult, setShowResult] = useState<unknown>(undefined);
  // One action at a time (a double-click on 继续 would start two runs); a ref so a second click before
  // the re-render is refused too.
  const acting = useRef(false);
  const [busy, setBusy] = useState(false);
  // The run has no runtimes; the pending approval's details say which step profiles are Claude.
  const approval = useApp((s) => (summary.approvalId ? (hostData(s, hostId)?.approvals ?? []).find((a) => a.approvalId === summary.approvalId) : undefined));
  const claude = useMemo(() => {
    const names = approval?.details?.claudeProfiles;
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : [];
  }, [approval]);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  if (!run) return <p className="px-3 py-3 text-xs text-subtle">{gone ? t("workflows.runGone") : "…"}</p>;
  const act = async (action: "stop" | "resume" | "delete") => {
    if ((action === "stop" || action === "delete") && armed !== action) {
      setArmed(action);
      return;
    }
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setArmed(null);
    setError(null);
    try {
      const r = await services.daemonFor(hostId).workflowRunAction(run.runId, action);
      if (!r.ok) setError(refusalText(r.error, t));
      void loadRuns(hostId);
      if (action !== "delete") void loadRun(hostId, run.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };
  const loadResult = async () => {
    try {
      const full = await services.daemonFor(hostId).workflowRun(run.runId, ["result"]);
      setShowResult(full.result ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const open = isWorkflowRunOpen(run.state);
  const agentsUsed = run.steps.filter((s) => s.state !== "cached").reduce((n, s) => n + 1 + (s.repairs ?? 0), 0);
  const groups = new Map<string, WorkflowStepView[]>();
  for (const step of run.steps) {
    const key = step.phase ?? "";
    groups.set(key, [...(groups.get(key) ?? []), step]);
  }
  const log = run.log ?? run.logTail ?? [];
  return (
    <div className="border-t border-border bg-background/40 px-4 pt-1 pb-3">
      {run.state === "pendingApproval" && <PlanCard hostId={hostId} run={run} claude={claude} />}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted">{run.state === "pendingApproval" ? null : run.description}</p>
        <button onClick={() => copyText(run.runId)} title={t("workflows.copyId")} className="flex items-center gap-1 text-[11px] text-subtle hover:text-foreground">
          <Copy size={11} /> {run.runId}
        </button>
        {open && run.state !== "pendingApproval" && (
          <Button onClick={() => void act("stop")} disabled={busy || run.state === "stopping"}>{t(armed === "stop" ? "workflows.stopConfirm" : "workflows.stop")}</Button>
        )}
        {!open && resumeSupported && ["stopped", "errored", "expired"].includes(run.state) && (
          <Button onClick={() => void act("resume")} disabled={busy} title={t("workflows.resumeHint")}>{t("workflows.resume")}</Button>
        )}
        {!open && <Button onClick={() => void act("delete")} disabled={busy}>{t(armed === "delete" ? "workflows.deleteConfirm" : "workflows.delete")}</Button>}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{t("workflows.actionFailed", { error })}</p>}
      {run.state !== "pendingApproval" && (
        <Section title={t("workflows.usage")}>
          <div className="grid grid-cols-[1fr_max-content] items-center gap-x-3 gap-y-1 text-xs">
            <Bar value={run.tokens} cap={run.limits.maxTokens} />
            <span className="text-subtle tabular-nums">{t("workflows.tokens", { spent: compact(run.tokens), cap: compact(run.limits.maxTokens) })}</span>
            <Bar value={agentsUsed} cap={run.limits.maxAgents} />
            <span className="text-subtle tabular-nums">{t("workflows.agentsUsed", { used: agentsUsed, cap: run.limits.maxAgents })}</span>
          </div>
        </Section>
      )}
      {run.error && (
        <Section title={t("workflows.error")}>
          <Mono text={`${run.error.code}: ${run.error.message}`} max="max-h-40" />
        </Section>
      )}
      {run.warnings.length > 0 && (
        <Section title={t("workflows.warnings")}>
          <ul className="list-disc pl-5 text-xs text-muted">
            {run.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Section>
      )}
      {run.phaseProgress.length > 0 && run.state !== "pendingApproval" && (
        <Section title={t("workflows.phases")}>
          <div className="flex flex-col gap-1">
            {run.phaseProgress.map((p) => (
              <div key={p.title || "-"} className="flex items-center gap-2 text-xs">
                <span className={`w-2 shrink-0 ${p.running > 0 ? "animate-pulse text-accent" : p.total > 0 && p.done + p.failed === p.total ? "text-ok" : "text-subtle"}`}>●</span>
                <span className="min-w-0 flex-1 truncate" title={p.detail ?? undefined}>
                  {p.title || t("workflows.ungrouped")}
                  {p.detail && <span className="ml-2 text-subtle">{p.detail}</span>}
                </span>
                <span className="shrink-0 text-subtle tabular-nums">
                  {p.done}/{p.total}
                  {p.failed > 0 && <span className="ml-1 text-danger">✕{p.failed}</span>}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {run.state !== "pendingApproval" && (
        <Section title={t("workflows.steps")}>
          {run.steps.length === 0 ? (
            <p className="text-xs text-subtle">{t("workflows.noSteps")}</p>
          ) : (
            [...groups.entries()].map(([phase, steps]) => (
              <div key={phase || "-"} className="mb-1">
                {groups.size > 1 && <div className="mt-1 text-[11px] text-subtle">{phase || t("workflows.ungrouped")}</div>}
                {steps.map((s) => (
                  <StepRow key={s.stepKey} step={s} />
                ))}
              </div>
            ))
          )}
        </Section>
      )}
      {run.state !== "pendingApproval" && (
        <Section title={t("workflows.log")}>
          {log.length === 0 ? (
            <p className="text-xs text-subtle">{t("workflows.noLog")}</p>
          ) : (
            <div className="max-h-48 overflow-auto rounded-lg bg-surface-2/60 px-3 py-1.5 font-mono text-[11px] leading-relaxed">
              {log.map((l) => (
                <div key={l.seq} className={l.level === "warn" ? "text-warn" : ""}>
                  <span className="mr-2 text-subtle">{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  {l.text}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
      {run.hasResult && (
        <Section
          title={t("workflows.result")}
          right={showResult === undefined && <button onClick={() => void loadResult()} className="text-[11px] normal-case text-accent hover:underline">{t("workflows.showFullResult")}</button>}
        >
          <Mono text={showResult !== undefined ? pretty(showResult) : (run.resultPreview ?? "")} />
        </Section>
      )}
      {run.state !== "pendingApproval" && (
        <Section title={t("workflows.plan.script")}>
          {run.draftPath && <p className="mb-1 font-mono text-[11px] text-subtle">{run.draftPath}</p>}
          <ScriptFold hostId={hostId} runId={run.runId} />
        </Section>
      )}
    </div>
  );
}

export function WorkflowsPage({ params }: { params: PageParams }) {
  const { t } = useI18n();
  const hostId = useFocusHost();
  const supported = useApp((s) => featuresOf(s, hostId).has(WORKFLOWS_FEATURE));
  const { runs, loaded, error } = useRuns(hostId);
  const [scope, setScope] = useState<Scope>("open");
  const initial = typeof params?.runId === "string" ? params.runId : null;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initial ? [initial] : []));
  const openCount = runs.filter((r) => isWorkflowRunOpen(r.state)).length;
  const shown = runs.filter((r) => (scope === "all" ? true : scope === "open" ? isWorkflowRunOpen(r.state) : !isWorkflowRunOpen(r.state)));
  // Runs waiting for approval open by themselves (the card is the point of coming here) — once each,
  // so one the owner collapsed stays collapsed through the next polls.
  const autoOpened = useRef<ReadonlySet<string>>(new Set(initial ? [initial] : []));
  useEffect(() => {
    const waiting = runs.filter((r) => r.state === "pendingApproval").map((r) => r.runId);
    const next = autoExpandWaiting(waiting, autoOpened.current);
    if (next.open.length === 0) return;
    autoOpened.current = next.seen;
    setExpanded((prev) => new Set([...prev, ...next.open]));
  }, [runs]);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (!supported) {
    return (
      <PageBody>
        <p className="py-8 text-center text-sm text-subtle">{t("workflows.unsupported")}</p>
      </PageBody>
    );
  }
  return (
    <PageBody>
      <PageToolbar>
        <span className="mr-auto text-xs text-subtle">{t("workflows.hint")}</span>
        <Segmented<Scope>
          value={scope}
          options={[
            { value: "open", label: t("workflows.scope.open", { n: openCount }) },
            { value: "closed", label: t("workflows.scope.closed") },
            { value: "all", label: t("workflows.scope.all") },
          ]}
          onChange={setScope}
        />
      </PageToolbar>
      {error && <p className="mb-3 text-xs text-danger">{t("workflows.loadFailed", { error })}</p>}
      {!loaded ? (
        <p className="py-8 text-center text-sm text-subtle">…</p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-sm text-subtle">
          <Workflow size={22} strokeWidth={1.5} />
          {t(scope === "open" ? "workflows.emptyOpen" : "workflows.empty")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {shown.map((run) => (
            <div key={run.runId} className="border-b border-border last:border-b-0">
              <RunRow run={run} open={expanded.has(run.runId)} onToggle={() => toggle(run.runId)} />
              {expanded.has(run.runId) && <RunDetail hostId={hostId} summary={run} />}
            </div>
          ))}
        </div>
      )}
    </PageBody>
  );
}
