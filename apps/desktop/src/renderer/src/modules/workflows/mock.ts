// Browser-preview data for 工作流 (cutex workflows): one run of every state, the cutex workflow API
// and a little live progress (the running run finishes steps; an agent-started run waits for the
// plan approval, whose decision the approvals mock reports through `cutex/approvals/changed`).
// Collected by dev/mockModules.ts (dev/mockTypes.ts).
import type { WorkflowLogLine, WorkflowPhaseMeta, WorkflowRunState, WorkflowRunSummary, WorkflowRunView, WorkflowStepView } from "../../../../shared/workflows";
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
const LIMITS = { maxAgents: 30, maxConcurrency: 4, maxTokens: 2_000_000, hardStop: false };
const counts = (steps: WorkflowStepView[]) => ({
  total: steps.length,
  queued: steps.filter((s) => s.state === "queued" || s.state === "starting").length,
  running: steps.filter((s) => s.state === "running").length,
  done: steps.filter((s) => s.state === "done").length,
  failed: steps.filter((s) => s.state === "failed").length,
  cached: steps.filter((s) => s.state === "cached").length,
});

interface MockRun {
  view: WorkflowRunView;
  script: string;
  result?: unknown;
}

const REVIEW_PHASES: WorkflowPhaseMeta[] = [
  { title: "Find", detail: "one reader per area of the diff" },
  { title: "Verify", detail: "two skeptics per finding" },
  { title: "Report" },
];

const REVIEW_SCRIPT = `export const meta = {
  name: "review-queue-flush",
  description: "Review the queue flush change: find issues per area, verify each, report",
  phases: [
    { title: "Find", detail: "one reader per area of the diff" },
    { title: "Verify", detail: "two skeptics per finding" },
    { title: "Report" },
  ],
}

const FINDINGS = { type: "object", properties: { findings: { type: "array", items: { type: "string" } } }, required: ["findings"] }
phase("Find")
const areas = args.areas
const found = await parallel(areas.map((a) => () => agent(\`Read the \${a} part of the diff and list real problems.\`, { label: a, schema: FINDINGS })))
const all = found.filter(Boolean).flatMap((r) => r.findings)
log(\`\${all.length} findings\`)
phase("Verify")
const kept = await pipeline(all, (f) => agent(\`Try to refute: \${f}\`, { label: "verify" }))
phase("Report")
return await agent("Write a short report of the confirmed findings:\\n" + kept.filter(Boolean).join("\\n"))
`;

function step(runId: string, i: number, phase: string, label: string, state: WorkflowStepView["state"], over: Partial<WorkflowStepView> = {}): WorkflowStepView {
  return {
    runId,
    stepKey: `${(0x3a9f00 + i * 7919).toString(16)}e1c2d4b6a8#${i % 3}`,
    callIndex: i,
    phase,
    label,
    prompt: `${label}: read the relevant part of the change and answer with the facts only.`,
    profile: "gamma",
    sessionId: state === "queued" ? null : `cutex.wf${i}`,
    askId: state === "queued" ? null : `ask-wf-${runId.slice(3, 9)}-${i}`,
    state,
    resultPreview: state === "done" ? (over.resultPreview ?? '{"findings":["flush retries without the CAS revision"]}') : null,
    error: null,
    tokens: state === "queued" ? 0 : state === "running" ? 18_400 + i * 900 : 41_000 + i * 1_300,
    repairs: 0,
    cachedFrom: null,
    activity: state === "running" ? "reading src/user_input/flush.rs" : null,
    createdAt: iso(600 - i * 10),
    startedAt: state === "queued" ? null : iso(590 - i * 10),
    endedAt: state === "done" || state === "failed" || state === "cached" ? iso(400 - i * 10) : null,
    ...over,
  };
}

function view(base: Omit<WorkflowRunSummary, "counts" | "tokens" | "revision" | "hasResult" | "resultPreview" | "warnings" | "scriptSha256" | "models" | "stepProfiles"> & Partial<WorkflowRunSummary>, steps: WorkflowStepView[], log: [number, string, string?][]): WorkflowRunView {
  const phases = base.phases;
  const lines: WorkflowLogLine[] = log.map(([ago, text, level], i) => ({ seq: i + 1, at: iso(ago), text, level: level ?? "info" }));
  return {
    scriptSha256: "9c1f".repeat(16),
    stepProfiles: ["gamma"],
    models: [],
    warnings: [],
    hasResult: false,
    resultPreview: null,
    revision: 4,
    ...base,
    counts: counts(steps),
    tokens: steps.reduce((n, s) => n + s.tokens, 0),
    steps,
    phaseProgress: phases.map((p) => {
      const mine = steps.filter((s) => s.phase === p.title);
      return { title: p.title, detail: p.detail ?? null, total: mine.length, done: mine.filter((s) => s.state === "done" || s.state === "cached").length, running: mine.filter((s) => s.state === "running").length, failed: mine.filter((s) => s.state === "failed").length };
    }),
    log: lines,
  };
}

const LEAD = { kind: "agent" as const, cutex_session_id: "lead", name: "Lead" };

function initialRuns(): MockRun[] {
  const runningId = "wr-2b7c41e0-aa01";
  const running = view(
    {
      runId: runningId, seq: 7, name: "review-queue-flush", description: "Review the queue flush change: find issues per area, verify each, report", phases: REVIEW_PHASES,
      author: LEAD, projectId: "desktop", cwd: "/home/sam/Projects/cutex", args: { areas: ["dispatch", "persistence", "events", "tests"] }, limits: LIMITS,
      approvalId: "apr-wf000007", state: "running", currentPhase: "Verify", createdAt: iso(640), startedAt: iso(600), draftPath: "/home/sam/Projects/cutex/.cutex/workflow-drafts/review-queue-flush-1.js",
    },
    [
      step(runningId, 0, "Find", "dispatch", "done"),
      step(runningId, 1, "Find", "persistence", "done", { repairs: 1 }),
      step(runningId, 2, "Find", "events", "done", { resultPreview: '{"findings":[]}' }),
      step(runningId, 3, "Find", "tests", "failed", { error: { code: "schema_mismatch", message: "the answer did not match the schema after one repair" }, tokens: 22_000 }),
      step(runningId, 4, "Verify", "verify", "running"),
      step(runningId, 5, "Verify", "verify", "running"),
      step(runningId, 6, "Verify", "verify", "queued"),
    ],
    [[598, "Find: 4 readers"], [430, "3 findings"], [428, "tests reader gave up: schema mismatch", "warn"]],
  );
  const pendingId = "wr-5f10c9d2-bb02";
  const pending = view(
    {
      runId: pendingId, seq: 8, name: "audit-i18n-catalogs", description: "Check every locale catalog for missing or stale keys and propose fixes", phases: [{ title: "Scan", detail: "one reader per locale" }, { title: "Fix", detail: "one patch per locale with gaps" }],
      author: { kind: "agent", cutex_session_id: "mika", name: "Mika" }, projectId: "desktop", cwd: "/home/sam/Projects/cutex-desktop", args: { locales: 11 },
      limits: { maxAgents: 24, maxConcurrency: 4, maxTokens: 1_500_000, hardStop: false }, stepProfiles: ["gamma", "Iota"], approvalId: "apr-wf000008",
      state: "pendingApproval", createdAt: iso(50), draftPath: "/home/sam/Projects/cutex-desktop/.cutex/workflow-drafts/audit-i18n-catalogs-1.js",
      warnings: ["line 14: agent() inside a while loop without a budget check"],
    },
    [],
    [],
  );
  const doneId = "wr-0a33e7b1-cc03";
  const completed = view(
    {
      runId: doneId, seq: 6, name: "map-agent-bus", description: "Map the agent bus: one reader per module, then one summary", phases: [{ title: "Read" }, { title: "Summarize" }],
      author: { kind: "owner" }, projectId: null, cwd: "/home/sam/Projects/cutex", limits: LIMITS, state: "completed", createdAt: iso(7600), startedAt: iso(7600), endedAt: iso(6900),
      hasResult: true, resultPreview: '"The agent bus has three layers: transport (mcp.rs), policy (tool_policy.rs) and delivery (asks)…"',
    },
    [step(doneId, 0, "Read", "mcp.rs", "done"), step(doneId, 1, "Read", "tool_policy.rs", "done"), step(doneId, 2, "Read", "asks", "done"), step(doneId, 3, "Summarize", "summary", "done", { resultPreview: '"The agent bus has three layers…"' })],
    [[7590, "Read: 3 modules"], [6950, "summary written"]],
  );
  const stoppedId = "wr-77d0f2a4-dd04";
  const stopped = view(
    {
      runId: stoppedId, seq: 5, name: "bench-claude-vs-codex", description: "Run the same five tasks on a Claude and a Codex profile and compare", phases: [{ title: "Run" }, { title: "Compare" }],
      author: LEAD, projectId: "desktop", cwd: "/home/sam/Projects/cutex", limits: { ...LIMITS, maxTokens: 400_000 }, stepProfiles: ["gamma", "Iota"],
      state: "stopped", stopReason: "provider", error: { code: "provider_blocked", message: "every running step was blocked by the account for 120 s (quota)" }, createdAt: iso(90000), startedAt: iso(89900), endedAt: iso(88000),
    },
    [step(stoppedId, 0, "Run", "codex-1", "done"), step(stoppedId, 1, "Run", "claude-1", "failed", { profile: "Iota", error: { code: "provider_blocked", message: "Claude subscription quota reached" } })],
    [[89890, "Run: 10 steps"], [88010, "stopped: provider blocked", "warn"]],
  );
  const rejectedId = "wr-91c4aa50-ee05";
  const rejected = view(
    {
      runId: rejectedId, seq: 4, name: "rewrite-docs", description: "Rewrite every doc page in a new voice", phases: [{ title: "Rewrite" }],
      author: { kind: "agent", cutex_session_id: "alden", name: "Alden" }, projectId: "desktop", cwd: "/home/sam/Projects/cutex-desktop", limits: LIMITS, state: "rejected", createdAt: iso(180000), endedAt: iso(179000),
    },
    [],
    [],
  );
  return [running, pending, completed, stopped, rejected].map((v) => ({ view: v, script: REVIEW_SCRIPT, result: v.hasResult ? "The agent bus has three layers: transport (mcp.rs), policy (tool_policy.rs) and delivery (asks). Messages enter through …" : undefined }));
}

const runs: MockRun[] = initialRuns();

const summaryOf = (run: WorkflowRunView): WorkflowRunSummary => {
  const { steps: _steps, phaseProgress: _progress, log: _log, logTail: _tail, script: _script, result: _result, ...summary } = run;
  return summary;
};

function refresh(run: MockRun) {
  const v = run.view;
  Object.assign(v, { counts: counts(v.steps), tokens: v.steps.reduce((n, s) => n + s.tokens, 0), revision: v.revision + 1 });
  v.phaseProgress = v.phases.map((p) => {
    const mine = v.steps.filter((s) => s.phase === p.title);
    return { title: p.title, detail: p.detail ?? null, total: mine.length, done: mine.filter((s) => s.state === "done" || s.state === "cached").length, running: mine.filter((s) => s.state === "running").length, failed: mine.filter((s) => s.state === "failed").length };
  });
}

function changed(core: MockCore, run: MockRun) {
  refresh(run);
  core.emitHost("cutex/workflow/run/changed", { runId: run.view.runId, state: run.view.state });
}

function setState(core: MockCore, run: MockRun, state: WorkflowRunState, extra: Partial<WorkflowRunView> = {}) {
  Object.assign(run.view, { state, ...extra });
  changed(core, run);
}

function log(run: MockRun, text: string, level = "info") {
  const lines = run.view.log ?? (run.view.log = []);
  lines.push({ seq: lines.length + 1, at: new Date().toISOString(), text, level });
}

/** The running review advances one step every few seconds, then reports. */
function tickRunning(core: MockCore) {
  const run = runs.find((r) => r.view.runId === "wr-2b7c41e0-aa01");
  if (!run || run.view.state !== "running") return;
  const steps = run.view.steps;
  const live = steps.find((s) => s.state === "running");
  if (live) {
    Object.assign(live, { state: "done", tokens: live.tokens + 21_000, activity: null, endedAt: new Date().toISOString(), resultPreview: '"confirmed"' });
    const next = steps.find((s) => s.state === "queued");
    if (next) Object.assign(next, { state: "running", sessionId: "cutex.wf-next", startedAt: new Date().toISOString(), tokens: 9_000, activity: "reading the finding" });
  } else if (!steps.some((s) => s.phase === "Report")) {
    run.view.currentPhase = "Report";
    log(run, "Report: writing the summary");
    steps.push(step(run.view.runId, steps.length, "Report", "report", "running", { tokens: 12_000 }));
  } else {
    const report = steps.find((s) => s.phase === "Report")!;
    if (report.state === "running") {
      Object.assign(report, { state: "done", tokens: 36_000, activity: null, resultPreview: '"Two confirmed findings: …"' });
      run.result = "Two confirmed findings:\n1. flush retries without the CAS revision\n2. the persistence write is not inside the transaction";
      log(run, "done");
      setState(core, run, "completed", { endedAt: new Date().toISOString(), hasResult: true, resultPreview: JSON.stringify(run.result).slice(0, 200), currentPhase: null });
      return;
    }
  }
  changed(core, run);
}

export const mock: ModuleMock = {
  features: { new: ["workflows", "workflow-resume"] },
  api: (core) => ({
    async workflowRuns(query) {
      if (core.legacy) return null;
      const state = query?.state ?? "open";
      const open = (s: WorkflowRunState) => s === "pendingApproval" || s === "running" || s === "stopping";
      const list = runs.filter((r) => state === "all" || (state === "open" ? open(r.view.state) : !open(r.view.state)));
      return { hostId: "local", runs: list.map((r) => structuredClone(summaryOf(r.view))) };
    },
    async workflowRun(runId, include) {
      const run = runs.find((r) => r.view.runId === runId);
      if (!run) throw new Error("workflow_run_not_found: no workflow run has this id");
      const out: WorkflowRunView = structuredClone(run.view);
      if (!include.includes("log")) {
        out.logTail = out.log?.slice(-20);
        delete out.log;
      }
      if (include.includes("script")) out.script = run.script;
      if (include.includes("result")) out.result = run.result ?? null;
      return out;
    },
    async workflowRunAction(runId, action) {
      const i = runs.findIndex((r) => r.view.runId === runId);
      const run = runs[i];
      if (!run) return { ok: false, error: { code: "workflow_run_not_found", message: "no workflow run has this id" } };
      const open = run.view.state === "pendingApproval" || run.view.state === "running" || run.view.state === "stopping";
      if (action === "stop") {
        if (!open) return { ok: false, error: { code: "workflow_run_finished", message: "the run already finished" } };
        log(run, "stop requested by the owner", "warn");
        setState(core, run, "stopping");
        setTimeout(() => {
          for (const s of run.view.steps) if (s.state === "running" || s.state === "queued") Object.assign(s, { state: "failed", error: { code: "stopped", message: "stopped by the owner" }, activity: null });
          setState(core, run, "stopped", { stopReason: "user", endedAt: new Date().toISOString() });
        }, 1200);
        return { ok: true };
      }
      if (action === "delete") {
        if (open) return { ok: false, error: { code: "workflow_run_open", message: "stop the run before deleting it" } };
        runs.splice(i, 1);
        core.emitHost("cutex/workflow/run/changed", { runId, deleted: true });
        return { ok: true };
      }
      // resume: a new run that reuses the finished steps
      if (open) return { ok: false, error: { code: "workflow_run_open", message: "the run is still open" } };
      const seq = Math.max(...runs.map((r) => r.view.seq)) + 1;
      const id = `wr-${(Date.now() % 0xffffffff).toString(16).padStart(8, "0")}-r${seq}`;
      const next: MockRun = structuredClone(run);
      Object.assign(next.view, { runId: id, seq, state: "running", stopReason: null, error: null, resumedFrom: runId, createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), endedAt: null, approvalId: null, log: [] });
      next.view.steps = next.view.steps.map((s) => (s.state === "done" ? { ...s, runId: id, state: "cached", cachedFrom: runId, tokens: 0 } : { ...s, runId: id, state: "queued", error: null, tokens: 0, sessionId: null }));
      log(next, `resumed from ${runId}: ${next.view.steps.filter((s) => s.state === "cached").length} steps reused`);
      runs.unshift(next);
      changed(core, next);
      return { ok: true };
    },
  }),
  start(core) {
    if (core.legacy) return;
    setInterval(() => tickRunning(core), 6000);
    // The plan decision: the approvals mock (which may not import this directory) calls this hook.
    (globalThis as { __cutexMockWorkflowDecision?: (approvalId: string, approved: boolean) => void }).__cutexMockWorkflowDecision = (approvalId, approved) => decide(core, approvalId, approved);
  },
};

/** A `workflow_run` approval was decided in the approvals mock: the run starts or is rejected. */
function decide(core: MockCore, approvalId: string, approved: boolean) {
  const run = runs.find((r) => r.view.approvalId === approvalId && r.view.state === "pendingApproval");
  if (!run) return;
  if (!approved) {
    setState(core, run, "rejected", { endedAt: new Date().toISOString() });
    return;
  }
  log(run, "plan approved; Scan: 11 readers");
  run.view.steps = Array.from({ length: 4 }, (_, i) => step(run.view.runId, i, "Scan", ["de-DE", "en-AU", "es-ES", "fr-FR"][i] ?? "locale", i < 2 ? "running" : "queued"));
  setState(core, run, "running", { startedAt: new Date().toISOString(), currentPhase: "Scan" });
}
