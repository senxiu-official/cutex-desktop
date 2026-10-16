// Mock cutex Job Service jobs (作业) for the renderer preview: a few running / finished jobs of Eva,
// Lead and Mika, cancellable, with synthetic output that grows while a job runs. Jobs only exist on
// Linux hosts (Workstation); the mock pretends the host has a Job Service with every human operation.
import type { JobListPage, JobOutputPage, JobResult, JobRow, JobServiceCapabilities, JobStream } from "../../../../shared/ipc";
import type { DesktopApi } from "../../../../shared/ipc";
import { COMPONENTS_FEATURE, readComponentOperation, readComponentsList } from "../../../../shared/components";
import type { ModuleMock } from "../../dev/mockTypes";

const now = () => Math.floor(Date.now() / 1000);
const T0 = now();
let n = 0;
const id = () => `job_${(0x1deb0000 + n++).toString(16)}a7c94e2b8f6d4153b0e9c2d7a1f3`;

function job(sessionId: string, agentName: string, state: string, startedAgo: number, opts: Partial<JobRow> & { tookSeconds?: number } = {}): JobRow {
  const { tookSeconds, ...rest } = opts;
  const createdAt = T0 - startedAgo;
  return {
    jobId: id(),
    actionId: "",
    sessionId,
    agentName,
    state,
    createdAt,
    updatedAt: tookSeconds !== undefined ? createdAt + tookSeconds : createdAt,
    exitCode: null,
    cwd: "/mnt/data/Projects/Cutex/cutex",
    stdout: { retainedBytes: 0, observedBytes: 0, truncated: false },
    stderr: { retainedBytes: 0, observedBytes: 0, truncated: false },
    revision: 1,
    delivery: "awaiting_terminal",
    ...rest,
  };
}

const jobs: JobRow[] = [
  job("eva", "Eva", "running", 12 * 60 + 14, { actionId: "build-native-r51", command: "cargo build --release --locked -p codex-cli", revision: 2 }),
  job("eva", "Eva", "running", 3 * 60 + 2, { actionId: "test-management-v2", command: "cargo test --locked management::v2 -- --test-threads 4" }),
  job("eva", "Eva", "exited", 50 * 60, { actionId: "lint", command: "cargo clippy --all-targets -- -D warnings", exitCode: 0, tookSeconds: 4 * 60 + 31, revision: 3, stdout: { retainedBytes: 18432, observedBytes: 18432, truncated: false } }),
  job("eva", "Eva", "exited", 2 * 3600, { actionId: "e2e-asks", command: "python3 scripts/reviewed_job_vm.py --suite asks", exitCode: 2, tookSeconds: 17 * 60, revision: 3 }),
  job("eva", "Eva", "cancelled", 5 * 3600, { actionId: "bench-sqlite", command: "cargo bench --bench sqlite_store", tookSeconds: 40 * 60, revision: 4 }),
  job("eva", "Eva", "interrupted", 26 * 3600, { actionId: "build-r208", command: "./build.sh release r208", tookSeconds: 9 * 60, revision: 3 }),
  job("eva", "Eva", "launch_unknown", 30 * 3600, { actionId: "deploy-dry-run", tookSeconds: 1, revision: 2 }),
  job("lead", "Lead", "launch_pending", 4, { actionId: "train-small", command: "python train.py --config configs/small.yaml" }),
  job("lead", "Lead", "failed", 3 * 3600, { actionId: "fetch-dataset", command: "rsync -a workstation:/data/ifm ./data", tookSeconds: 12, revision: 3 }),
  job("mika", "Mika", "exited", 20 * 60, { actionId: "vitest", command: "pnpm -C apps/desktop test", exitCode: 0, tookSeconds: 95, revision: 3 }),
  // External NCI Gadi PBS jobs (prepare_remote / register_remote): no local command / output.
  job("lead", "Lead", "running", 3 * 3600, { actionId: "", command: null, cwd: null, source: "nci", remoteId: "148203117.gadi-pbs", remoteName: `cx${"4f1c".repeat(8)}`, lastSourceEventAt: T0 - 2 * 3600, revision: 3, delivery: "awaiting_terminal" }),
  job("lead", "Lead", "registered", 40 * 60, { actionId: "", command: null, cwd: null, source: "nci", remoteId: "148209554.gadi-pbs", remoteName: "relax-mof5-cx91aa0d7e3d2c1f6a5b4c3d2e1f0a9b8c", revision: 1 }),
  job("eva", "Eva", "running", 31 * 3600, { actionId: "", command: null, cwd: null, source: "nci", remoteId: "148011870.gadi-pbs", remoteName: `cx${"07de".repeat(8)}`, lastSourceEventAt: T0 - 30 * 3600, stale: true, revision: 2 }),
  job("eva", "Eva", "exited", 9 * 3600, { actionId: "", command: null, cwd: null, source: "nci", remoteId: "147998201.gadi-pbs", remoteName: "md-npt-cx2b3e9a0b7e3d2c1f6a5b4c3d2e1f0a9b", exitCode: 0, tookSeconds: 5 * 3600, lastSourceEventAt: T0 - 4 * 3600, revision: 4 }),
];
const byId = new Map(jobs.map((j) => [j.jobId, j]));
/** Multi-host P1: workstation (another host) has its own jobs, so the merged 作业 page shows two hosts. */
const remoteJobs = new Map<string, Map<string, JobRow>>();
function remoteJobsOf(hostId: string): Map<string, JobRow> {
  let m = remoteJobs.get(hostId);
  if (!m) {
    const rows = [
      job("wave", "Wave-Director", "running", 7 * 60, { actionId: "waveline-e2e", command: "pnpm -C apps/api test:e2e", cwd: "/home/alex/projects/waveline" }),
      job("wave", "Wave-Director", "exited", 90 * 60, { actionId: "waveline-build", command: "pnpm -r build", exitCode: 0, tookSeconds: 140, revision: 3, cwd: "/home/alex/projects/waveline" }),
      job("scratch", "scratch", "failed", 4 * 3600, { actionId: "gpu-probe", command: "nvidia-smi --query-gpu=name --format=csv", tookSeconds: 2, revision: 3, cwd: "/home/alex/scratch" }),
    ];
    remoteJobs.set(hostId, (m = new Map(rows.map((j) => [j.jobId, j]))));
  }
  return m;
}

const LINES = [
  "   Compiling serde v1.0.228",
  "   Compiling tokio v1.48.0",
  "   Compiling codex-core v0.160.0 (/mnt/data/Projects/Cutex/cute-codex/codex-rs/core)",
  "warning: unused variable: `turn`",
  "   Compiling codex-app-server v0.160.0",
  "test management::v2::job_service::cancel_validates_body ... ok",
  "test management::v2::job_service::output_maps_unknown_method ... ok",
];

/** Output so far: grows with the job's age while it runs. */
function outputOf(j: JobRow, stream: JobStream): string {
  if (stream === "stderr") return j.state === "exited" && j.exitCode ? "Traceback (most recent call last):\n  File \"scripts/reviewed_job_vm.py\", line 88, in <module>\nAssertionError: asks e2e: 1 of 14 cases failed\n" : "";
  const age = (j.state === "running" ? now() : j.updatedAt) - j.createdAt;
  const lines = Math.min(4000, Math.max(3, Math.floor(age / 2)));
  return Array.from({ length: lines }, (_, i) => `[${String(i).padStart(4, "0")}] ${LINES[i % LINES.length]}`).join("\n") + "\n";
}

const ok = <T,>(value: T): JobResult<T> => ({ ok: true, value: structuredClone(value) });
const delay = () => new Promise((r) => setTimeout(r, 120));

function mockJobApi(byId: Map<string, JobRow>) {
  return {
    async jobs(params: { query?: string; cursor?: string | null; limit?: number }): Promise<JobResult<JobListPage>> {
      await delay();
      const q = (params.query ?? "").toLowerCase();
      const limit = params.limit ?? 50;
      const rows = [...byId.values()]
        .filter((j) => !q || [j.jobId, j.actionId, j.sessionId].some((s) => s.toLowerCase().includes(q)))
        .sort((a, b) => b.createdAt - a.createdAt || (a.jobId < b.jobId ? 1 : -1));
      const start = params.cursor ? Number(params.cursor.split(":")[1] ?? 0) : 0;
      const page = rows.slice(start, start + limit).map((j) => {
        const out = outputOf(j, "stdout").length;
        const err = outputOf(j, "stderr").length;
        return { ...j, stdout: { retainedBytes: out, observedBytes: out, truncated: false }, stderr: { retainedBytes: err, observedBytes: err, truncated: false } };
      });
      return ok({ data: page, nextCursor: start + limit < rows.length ? `${rows[start + limit - 1]?.createdAt ?? 0}:${start + limit}` : null });
    },
    async jobServiceCapabilities(): Promise<JobResult<JobServiceCapabilities>> {
      return ok({ schema: "cutex/job-service-capabilities/v1", humanOperations: ["list", "cancel", "readOutput", "markExternal"], sources: ["nci"], externalNotifyFile: true });
    },
    async cancelJob(jobId: string, expectedRevision: number): Promise<JobResult<unknown>> {
      await delay();
      const j = byId.get(jobId);
      if (!j) return { ok: false, code: "job_not_found", message: "unknown job" };
      if (j.revision !== expectedRevision) return { ok: false, code: "job_conflict", message: "job revision mismatch" };
      if (j.state === "running" || j.state === "launch_pending") Object.assign(j, { state: "cancelled", updatedAt: now(), revision: j.revision + 1 });
      return ok(j);
    },
    async markExternalJob(input: { jobId: string; expectedRevision: number; state: string; exitCode?: number }): Promise<JobResult<unknown>> {
      await delay();
      const j = byId.get(input.jobId);
      if (!j) return { ok: false, code: "job_not_found", message: "unknown job" };
      if (j.revision !== input.expectedRevision || !["running", "registered"].includes(j.state)) return { ok: false, code: "job_conflict", message: "job revision mismatch or already terminal" };
      Object.assign(j, { state: input.state, exitCode: input.exitCode ?? null, updatedAt: now(), revision: j.revision + 1, stale: false });
      return ok(j);
    },
    async jobOutput(jobId: string, stream: JobStream, offset: number): Promise<JobResult<JobOutputPage>> {
      await delay();
      const j = byId.get(jobId);
      if (!j) return { ok: false, code: "job_not_found", message: "unknown job" };
      const text = outputOf(j, stream);
      const page = text.slice(offset, offset + 8192);
      const running = j.state === "running" || j.state === "launch_pending";
      return ok({ jobId, stream, fromOffset: offset, nextOffset: offset + page.length, text: page, eof: !running && offset + page.length >= text.length, truncated: false, gap: false, omittedBytes: 0 });
    },
  };
}

/**
 * Optional components (cutex `components`, GET /v2/components; components spec v2). Served here for both
 * components (the routes are host-wide; one module mock owns them). The 作业 page shows the job-service
 * card until it is ready; Claude profiles, the new-agent flow and Claude 账户 show the claude-runtime one.
 * `?component=` (job-service) / `?claude=` (claude-runtime) pick the state:
 * (none) ready · missing (安装 → progress events → ready) · fail (安装 → degraded) · refused (安装 →
 * 409 upgrade_blocked) · needsUser · restartPending · degraded · degradedWorking · unmanaged · source ·
 * unsupported · external · notInManifest · readError (one failed read) · nocap (a cutex without
 * `components`; `?component=nocap` only: on the Windows mock host "not on Windows", with `&nolocal`
 * the Linux host says "update cutex"). unmanaged / source apply to the host, so to both components.
 */
const QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
const COMPONENT_MODE = QUERY.get("component") ?? "";
const CLAUDE_MODE = QUERY.get("claude") ?? "";
const HOST_MODE = [COMPONENT_MODE, CLAUDE_MODE].find((m) => m === "unmanaged" || m === "source") ?? "";

const STEPS: Record<string, string[]> = {
  "job-service": ["Enable lingering for your user so the service keeps running after you log out: loginctl enable-linger", "Then press Check again here."],
  "claude-runtime": ["Install the Claude Code CLI on the host (npm install -g @anthropic-ai/claude-code).", "Log in once in a terminal on the host: claude", "Then press Check again here."],
};
const VERSIONS: Record<string, { old: string; next: string; size: number }> = {
  "job-service": { old: "0.1.1", next: "0.1.2", size: 9_437_184 },
  "claude-runtime": { old: "claude-r10", next: "claude-r11", size: 31_457_280 },
};

function mockComponent(name: string, mode: string) {
  const v = VERSIONS[name]!;
  const STATES: Record<string, string> = { needsUser: "needsUser", restartPending: "restartPending", degraded: "degraded", degradedWorking: "degraded", external: "external", notInManifest: "notInManifest" };
  const state = mode === "" || mode === "nocap" ? "ready" : (STATES[mode] ?? "missing");
  const selected = state === "ready" ? v.old : mode === "restartPending" ? v.next : mode === "degradedWorking" ? v.old : null;
  return {
    name,
    supported: mode !== "unsupported",
    state,
    selected,
    available: v.next,
    origin: selected ? "signed" : null,
    versions: selected ? [{ version: selected, pinnedBy: 3, sizeBytes: v.size }] : [],
    error: mode.startsWith("degraded") ? `${name} ${v.next}: did not answer within 10 s` : null,
    steps: mode === "needsUser" ? STEPS[name]! : [],
  } as { name: string; supported: boolean; state: string; selected: string | null; available: string; origin: string | null; versions: { version: string; pinnedBy: number; sizeBytes: number }[]; error: string | null; steps: string[] };
}

function mockComponents(emitHost: (method: string, params: Record<string, unknown>) => void): Partial<DesktopApi> {
  const modes: Record<string, string> = { "job-service": COMPONENT_MODE, "claude-runtime": CLAUDE_MODE };
  const items = [mockComponent("job-service", COMPONENT_MODE), mockComponent("claude-runtime", CLAUDE_MODE)];
  let operation: Record<string, unknown> | null = null;
  const list = () => ({
    managed: HOST_MODE !== "unmanaged",
    installFrom: HOST_MODE === "source" ? "source-only" : HOST_MODE === "unmanaged" ? "none" : "release",
    components: items,
    operation,
  });
  const publish = (name: string, reason: "operation" | "state") =>
    emitHost("cutex/components/updated", { name, reason, state: items.find((c) => c.name === name)!.state, operation });
  let failedReads = 0;
  return {
    async components() {
      await delay();
      if ((COMPONENT_MODE === "readError" || CLAUDE_MODE === "readError") && failedReads++ < 1) throw new Error("connect ECONNRESET");
      return readComponentsList(structuredClone(list()));
    },
    async componentAction(name, action) {
      await delay();
      const c = items.find((x) => x.name === name);
      if (!c) return { ok: false, error: { code: "component_unknown", message: `no component named \`${name}\``, status: 404 } };
      if (action === "remove") return { ok: false, error: { code: name === "job-service" ? "jobs_running" : "component_pinned", message: "refused by the mock", status: 409 } };
      if (modes[name] === "refused") return { ok: false, error: { code: "upgrade_blocked", message: "a backend upgrade or another component operation is running", status: 409, reason: "run_in_progress" } };
      const id = `cop-${Date.now().toString(16)}`;
      const steps = ["download", "verify", "prepare", "select"];
      const v = VERSIONS[name]!;
      operation = { id, name, action, state: "running", step: steps[0], error: null };
      Object.assign(c, { state: "installing", error: null });
      publish(name, "operation");
      steps.forEach((step, i) =>
        setTimeout(() => {
          if (i < steps.length - 1) operation = { id, name, action, state: "running", step: steps[i + 1], error: null };
          else if (modes[name] === "fail") {
            const error = "prepare: socket path too long (112 > 107 bytes)";
            operation = { id, name, action, state: "failed", step, error };
            Object.assign(c, { state: "degraded", error });
          } else {
            operation = { id, name, action, state: "done", step: null, error: null };
            Object.assign(c, { state: "ready", selected: v.next, origin: "signed", versions: [{ version: v.next, pinnedBy: 0, sizeBytes: v.size }] });
          }
          publish(name, "operation");
        }, 1200 * (i + 1)),
      );
      return { ok: true, value: readComponentOperation(structuredClone(operation)) };
    },
  };
}

export const mock: ModuleMock = {
  api: (core) => ({ ...mockJobApi(byId), ...mockComponents((method, params) => core.emitHost(method, params)) }),
  remote: (hostId, emitHost) => ({ ...mockJobApi(remoteJobsOf(hostId)), ...mockComponents(emitHost) }),
  // The NCI rows above are plain Job Service data; inbound mail / the Gadi check are modules/nci/mock.ts.
  features: { new: ["job-external", ...(COMPONENT_MODE === "nocap" ? [] : [COMPONENTS_FEATURE])] },
};
