// Mock cutex Job Service jobs (作业) for the renderer preview: a few running / finished jobs of Eva,
// Lead and Mika, cancellable, with synthetic output that grows while a job runs. Jobs only exist on
// Linux hosts (Workstation); the mock pretends the host has a Job Service with every human operation.
import type { JobListPage, JobOutputPage, JobResult, JobRow, JobServiceCapabilities, JobStream } from "../../../../shared/ipc";
import type { DesktopApi } from "../../../../shared/ipc";
import { COMPONENT_INDEX_FEATURE, COMPONENTS_FEATURE, EXTERNAL_RUNTIME_ROOT_FEATURE, readComponentOperation, readComponentsList, type ComponentStatus } from "../../../../shared/components";
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
// `?jobprocess`: Job Service 0.1.2 reports the observed process of running jobs.
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("jobprocess")) {
  jobs[0]!.observedProcessState = { state: "stopped", observedAtEpochMillis: (T0 - 40) * 1000 };
  jobs[1]!.observedProcessState = { state: "exited", observedAtEpochMillis: (T0 - 3) * 1000 };
  jobs.push(job("mika", "Mika", "running", 90, { actionId: "index", command: "python index.py --all", observedProcessState: { state: "sleeping", observedAtEpochMillis: T0 * 1000 } }));
}
// `?projectview` (modules/project-view/mock.ts): three running jobs of the cutex-dev project's agents.
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("projectview"))
  jobs.push(
    job("pv-qa", "ui-tester", "running", 5 * 60 + 12, { actionId: "shots", command: "chrome --headless --screenshot shots/topbar-split" }),
    job("pv-perf", "sidebar-perf", "running", 12 * 60 + 4, { actionId: "vitest", command: "pnpm vitest --watch" }),
    job("pv-rh", "remote-hosts", "running", 4 * 60 + 2, { actionId: "build", command: "cargo build --release -p cutex-server" }),
  );
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
if (typeof location !== "undefined") new URLSearchParams((location.hash ?? "").replace(/^#\??/, "")).forEach((value, key) => QUERY.set(key, value));
const COMPONENT_MODE = QUERY.get("component") ?? "";
const CLAUDE_MODE = QUERY.get("claude") ?? "";
const HOST_MODE = [COMPONENT_MODE, CLAUDE_MODE].find((m) => m === "unmanaged" || m === "source") ?? "";

const STEPS: Record<string, string[]> = {
  "dsh-runtime": ["Configure DEEPSEEK_API_KEY in the host environment.", "Then press Check again here."],
  "job-service": ["Enable lingering for your user so the service keeps running after you log out: loginctl enable-linger", "Then press Check again here."],
  "claude-runtime": ["Install the Claude Code CLI on the host (npm install -g @anthropic-ai/claude-code).", "Log in once in a terminal on the host: claude", "Then press Check again here."],
};
const VERSIONS: Record<string, { old: string; next: string; size: number }> = {
  "dsh-runtime": { old: "0.2.1-rc.3", next: "0.2.1-rc.3", size: 9_437_184 },
  "kimi-runtime": { old: "kimi-r1", next: "kimi-r1", size: 41_943_040 },
  "job-service": { old: "0.1.1", next: "0.1.2", size: 9_437_184 },
  "claude-runtime": { old: "claude-r10", next: "claude-r11", size: 31_457_280 },
};

function mockComponent(name: string, mode: string, windowsHost = false) {
  const v = VERSIONS[name]!;
  const STATES: Record<string, string> = { installing: "installing", needsUser: "needsUser", restartPending: "restartPending", degraded: "degraded", degradedWorking: "degraded", external: "external", notInManifest: "notInManifest" };
  const state = mode === "" || mode === "ready" || mode === "nocap" ? "ready" : (STATES[mode] ?? "missing");
  const indexed = INDEX_VERSIONS[name] && CINDEX ? INDEX_VERSIONS[name] : null;
  // `?ext` on a needsUser adapter: the r3 adapter is the selected one whose dependencies fail (no r2 to fall back to).
  const selected = EXT.length && EXT_FOR !== "candidate" && mode === "needsUser" && ADAPTER_NEXT[name] ? ADAPTER_NEXT[name]! : indexed && state === "ready" ? indexed[0]! : state === "ready" ? v.old : mode === "restartPending" ? v.next : mode === "degradedWorking" ? v.old : null;
  return {
    name,
    ...(name === "dsh-runtime" ? { dsh: { version: "0.2.1-rc.3", node: { minimum: "24.9.0", range: ">=24.9.0 <25", version: QUERY.get("dshNode") === "missing" ? null : "v24.21.0", ready: QUERY.get("dshNode") !== "missing" } } } : {}),
    ...(name === "kimi-runtime" ? { kimi: { version: "2.3.3", node: { minimum: "24.9.0", range: ">=24.9.0 <25", version: QUERY.get("kimiNode") === "missing" ? null : "v24.21.0", ready: QUERY.get("kimiNode") !== "missing" } } } : {}),
    supported: mode !== "unsupported",
    state,
    selected,
    available: v.next,
    origin: selected ? "signed" : null,
    versions: indexed && selected ? indexed.map((version, i) => ({ version, pinnedBy: 3 - i, sizeBytes: v.size })) : selected ? [{ version: selected, pinnedBy: 3, sizeBytes: v.size }] : [],
    error: mode.startsWith("degraded") ? `${name} ${v.next}: did not answer within 10 s` : null,
    // Onboarding's needsUser fixture has a verified CLI, but is not signed in yet.
    steps: mode === "needsUser" ? (name === "claude-runtime" && QUERY.get("step") === "profile" ? STEPS[name]!.slice(1) : STEPS[name]!) : [],
    ...(name === "claude-runtime" && ["both", "bundled", "system"].includes(QUERY.get("claudeCli") ?? "") ? { claudeCli: {
      selected: QUERY.get("claudeCli") === "system" ? "system" : "bundled",
      bundled: { version: "2.1.301" }, system: QUERY.get("claudeCli") === "bundled" ? null : { version: "2.1.299" },
    } } : {}),
    ...mockExternal(name, mode, windowsHost, selected),
    ...mockIndex(name, selected),
  } as ComponentStatus;
}

/**
 * r269 (contract frozen: shared/componentIndex.ts; the daemon side is not built yet, so this is a MOCK of it; `configure`
 * is Moth's route). Gates: both capabilities are on unless `?nogate` (then nothing new shows).
 * - `?ext=<code>[,<code>…]|all|none` adds those failed external-install checks to dsh-runtime / kimi-runtime (kimi_* codes
 *   only on Kimi; `none`: no issues). Default: the selected r3 adapter is `needsUser` (`?dsh=needsUser&ext=…`).
 *   `&extFor=candidate`: r3 is a staged candidate while r2 stays selected and ready (`?dsh=ready&ext=…&extFor=candidate`).
 *   `&extFor=selected`: the selected adapter itself is ready and checked (`?dsh=ready&ext=none&extFor=selected`; add
 *   `&extStored=1` for ready + stored: 恢复默认 inside the collapsed 路径设置).
 *   `&extChecked=never`: `checkedAt: null` (unverified, never ready).
 * - `?cindex=update|cutex|incompatible|yanked|yankedGone|yankedNoSafe|current|stale|staleNoCache|manifest|none` adds an `index`
 *   to dsh / kimi / claude (`&cindexSource=privateKit|releaseManifest`); `&cindexCheck=fail`: 检查更新 fails (stale).
 * 保存并检测 drops the checks the new paths fix; 重新检测 only refreshes the time; 更新 / 改用 / 用于新 agent install that
 * version (outcome needsUser, not selected, while its dependencies are not ready). Operations end with a `result`.
 * r270 (cutex component-external-ui-v1): `&extStored=1` adds `storedConfig` (a stored root, node / rg discovered) and
 * `resolved` (configure keeps both up to date: changed fields only, null clears; `&extNoStore`: nothing stored); `&extDiag=1` gives every issue a compact
 * `actual` plus `diagnostics` (a stack); `&srcOnly=1|<version>`: an empty install refuses with `component_source_only`
 * (`<version>`: cutex suggests that explicit version). Fresh host (DSH card without the runtime): `?nofeat=dsh-runtime&cindex=update`.
 * ae9cced9: `?component=source&cindex=update` is a kit base (managed + source-only) whose card offers 安装 {version};
 * `dsh.node` / `kimi.node` carry a plain minimum + `range`, `external.nodeVersion` the observed version.
 */
const NO_GATE = QUERY.has("nogate");
const EXT = (QUERY.get("ext") ?? "").split(",").filter(Boolean);
const EXT_FOR = QUERY.get("extFor") ?? "";
const EXT_NEVER = QUERY.get("extChecked") === "never";
const CINDEX = QUERY.get("cindex") ?? "";
const EXT_STORED = QUERY.has("extStored");
const EXT_DIAG = QUERY.has("extDiag");
const SRC_ONLY = QUERY.get("srcOnly");
/** The adapter release that needs user-installed dependencies. */
const ADAPTER_NEXT: Record<string, string> = { "dsh-runtime": "dsh-r3", "kimi-runtime": "kimi-r3" };
/** The signed `cutex/external-runtime/v1` objects of the r3 adapters (as in cutex docs/contracts/component-index-v1.example.json). */
const EXTERNAL_RUNTIME: Record<string, { rt: Record<string, unknown>; sha: string }> = {
  "dsh-runtime": {
    rt: { schema: "cutex/external-runtime/v1", name: "dsh-runtime", version: "dsh-r3", payload: "adapter-v1", externalRoot: { kind: "npm-prefix", packages: { "@deepseek-ai/dsh": "0.2.1-rc.3", "@deepseek-ai/dsh-session-format-catalog": "0.2.1-rc.3", ws: "8.22.0" }, cliEntry: "node_modules/@deepseek-ai/dsh/lib/bin.js", catalogEntry: "node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js" }, node: { range: ">=24.9.0 <25", recommended: "24.21.0", features: ["node:sqlite"] }, checks: { rg: false, nodePty: false }, environment: { installRoot: "DSH_INSTALL_ROOT" } },
    sha: "91c61f8240f09e9b964616e4794712e1fefae60b21c9c7fe887c88de70facc4f",
  },
  "kimi-runtime": {
    rt: { schema: "cutex/external-runtime/v1", name: "kimi-runtime", version: "kimi-r3", payload: "adapter-v1", externalRoot: { kind: "npm-prefix", packages: { "@moonshot-ai/kimi-code": "2.3.3", ws: "8.22.0" }, cliEntry: "node_modules/@moonshot-ai/kimi-code/dist/main.mjs" }, node: { range: ">=24.9.0 <25", recommended: "24.21.0", features: ["node:sqlite"] }, checks: { rg: true, nodePty: true }, environment: { installRoot: "KIMI_INSTALL_ROOT" } },
    sha: "d6a01e5acd1f9bdabfd382fb600f83bd9fad191782af47b3eeb39cf106e11262",
  },
};
/** `?cindex`: the new-agent default, then older versions agents stay pinned to (3, 2, 1 agents); the index recommends the next one. */
const INDEX_VERSIONS: Record<string, string[]> = { "dsh-runtime": ["dsh-r2", "dsh-r1"], "kimi-runtime": ["kimi-r2", "kimi-r1"], "claude-runtime": ["claude-r11", "claude-r10", "claude-r9"] };
const EXT_ISSUES: Record<string, { expected: string | null; actual: string | null; path: (short: string) => string | null; steps?: string[] }> = {
  external_root_missing: { expected: null, actual: "missing", path: (s) => `/home/alex/.local/share/cutex-external/${s}` },
  external_root_invalid: { expected: "node_modules/@deepseek-ai/dsh/bin/dsh.mjs", actual: "missing", path: (s) => `/home/alex/.local/share/cutex-external/${s}/old` },
  upstream_version_mismatch: { expected: "0.2.1-rc.3", actual: "0.2.0", path: (s) => `/home/alex/.local/share/cutex-external/${s}/0.2.0/node_modules/@deepseek-ai/dsh/package.json` },
  node_missing: { expected: ">=24.9.0 <25", actual: null, path: () => null, steps: ["cutex looked on PATH=/usr/local/bin:/usr/bin:/bin (the service PATH)."] },
  node_version_unsupported: { expected: ">=24.9.0 <25", actual: "22.11.0", path: () => "/usr/bin/node" },
  kimi_pty_unavailable: { expected: "node-pty 1.1.0 (loads under the configured Node)", actual: "Error: Cannot find module ../build/Release/pty.node", path: () => "/home/alex/.local/share/cutex-external/kimi/2.3.3/node_modules/node-pty" },
  kimi_rg_missing: { expected: "rg on PATH or --rg", actual: null, path: () => null },
};
const EXT_PACKAGES: Record<string, string[]> = {
  "dsh-runtime": ["@deepseek-ai/dsh@0.2.1-rc.3", "@deepseek-ai/dsh-session-format-catalog@0.2.1-rc.3", "ws@8.22.0"],
  "kimi-runtime": ["@moonshot-ai/kimi-code@2.3.3", "ws@8.22.0"],
};
const isoAgo = (s: number) => new Date(Date.now() - s * 1000).toISOString();
/** The Linux mock path as it would read on the Windows mock host (HOST-A). */
const hostPath = (p: string | null, windowsHost: boolean) => (p && windowsHost ? p.replace("/home/alex/.local/share/", "C:\\Users\\alex\\AppData\\Local\\").replace("/usr/bin/node", "C:\\Program Files\\nodejs\\node.exe").replace("/usr/bin/rg", "C:\\Users\\alex\\scoop\\shims\\rg.exe").replaceAll("/", "\\") : p);

function mockExternal(name: string, mode: string, windowsHost: boolean, selected: string | null): Record<string, unknown> {
  // A candidate next to a ready default, or (r270 fresh host) before anything is installed.
  if (!EXT_PACKAGES[name] || !EXT.length || !(EXT_FOR === "candidate" ? ["ready", "missing"] : EXT_FOR === "selected" ? ["ready"] : ["needsUser"]).includes(mode)) return {};
  const short = name === "dsh-runtime" ? "dsh" : "kimi";
  const codes = (EXT.includes("all") ? Object.keys(EXT_ISSUES) : EXT).filter((c) => c !== "none" && (short === "kimi" || !c.startsWith("kimi_")));
  const issues = codes.map((code) => {
    const i = EXT_ISSUES[code];
    if (!i) return { code, expected: null, actual: null, path: null, steps: ["cutex: a check this desktop does not know yet."] };
    const kimiVersion = short === "kimi" && code === "upstream_version_mismatch";
    const issue = { code, expected: kimiVersion ? "2.3.3" : i.expected, actual: kimiVersion ? "2.2.0" : i.actual, path: hostPath(i.path(short), windowsHost), steps: i.steps ?? [] };
    if (!EXT_DIAG || !issue.actual) return issue;
    const stack = ["Require stack:", `- ${hostPath(`/home/alex/.local/share/cutex-external/${short}/probe.cjs`, windowsHost)}`, "    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)", "    at Module._load (node:internal/modules/cjs/loader:1051:27)", "    at Object.<anonymous> (probe.cjs:3:13) {", "  code: 'MODULE_NOT_FOUND'", "}"];
    return { ...issue, diagnostics: [issue.actual, ...stack].join("\n") };
  });
  const root = codes.includes("external_root_missing") ? null : hostPath(`/home/alex/.local/share/cutex-external/${short}/${short === "dsh" ? "0.2.1-rc.3" : "2.3.3"}`, windowsHost);
  const version = EXT_FOR === "candidate" ? ADAPTER_NEXT[name]! : (selected ?? ADAPTER_NEXT[name]!);
  // r270: the owner stored a relative-looking root (kept exactly); cutex found node / rg itself.
  const node = codes.some((c) => c.startsWith("node_")) ? null : hostPath("/usr/bin/node", windowsHost);
  const rg = short === "kimi" && !codes.includes("kimi_rg_missing") ? hostPath("/usr/bin/rg", windowsHost) : null;
  const stored = EXT_STORED ? { storedConfig: { externalRoot: root && !QUERY.has("extNoStore") ? hostPath(`/home/alex/.local/share/cutex-external/${short}/../${short}/${short === "dsh" ? "0.2.1-rc.3" : "2.3.3"}`, windowsHost) : null, node: null, rg: null }, resolved: { externalRoot: root, node, rg } } : {};
  return { external: { version, root, node: EXT_STORED ? node : null, rg: EXT_STORED ? rg : null, packages: EXT_PACKAGES[name], nodeRange: ">=24.9.0 <25", nodeRecommended: "24.21.0", ...(EXT_NEVER || node === null ? {} : { nodeVersion: "v24.21.0" }), checkedAt: EXT_NEVER ? null : isoAgo(7 * 60), issues: EXT_NEVER ? [] : issues, ...stored } };
}

function mockIndex(name: string, selected: string | null): Record<string, unknown> {
  if (!CINDEX || name === "job-service") return {};
  const cur = selected ?? INDEX_VERSIONS[name]![0]!;
  const prev = INDEX_VERSIONS[name]![1]!;
  const next = name === "dsh-runtime" ? "dsh-r3" : name === "kimi-runtime" ? "kimi-r3" : "claude-r12";
  const req = name === "dsh-runtime" ? { upstream: "@deepseek-ai/dsh@0.2.1-rc.3", node: ">=24.9.0 <25" } : name === "kimi-runtime" ? { upstream: "@moonshot-ai/kimi-code@2.3.3", node: ">=24.9.0 <25", rg: "any" } : {};
  const yanked = CINDEX.startsWith("yanked");
  const adapter = EXTERNAL_RUNTIME[name];
  const bundled = { externalRuntime: null, externalRuntimeSha256: null };
  const nextIncompatible = CINDEX === "cutex" ? "capability:external-runtime-root-v2" : CINDEX === "incompatible" ? "platform" : null;
  const releases = [
    // `yankedGone`: the withdrawn default is no longer in the document; cutex still says selectedYanked.
    ...(CINDEX === "yankedGone" ? [] : [{ version: cur, yanked, yankReason: yanked ? "session resume loses tool results on Windows (#412)" : null, compatible: true, incompatibleReason: null, requirements: {}, ...bundled }]),
    { version: next, yanked: false, yankReason: null, compatible: !nextIncompatible, incompatibleReason: nextIncompatible, requirements: req, ...(adapter ? { externalRuntime: adapter.rt, externalRuntimeSha256: adapter.sha } : bundled) },
    { version: prev, yanked: false, yankReason: null, compatible: true, incompatibleReason: null, requirements: {}, ...bundled },
  ];
  const recommended = CINDEX === "current" || CINDEX === "stale" ? cur : CINDEX === "yanked" || CINDEX === "yankedGone" ? prev : CINDEX === "yankedNoSafe" || CINDEX === "none" ? null : next;
  const stale = CINDEX === "stale" || CINDEX === "staleNoCache";
  const signed = CINDEX !== "manifest" && CINDEX !== "staleNoCache";
  return { index: {
    source: CINDEX === "manifest" || CINDEX === "staleNoCache" ? "releaseManifest" : (QUERY.get("cindexSource") ?? "componentIndex"),
    channel: signed ? "public-stable" : null, sequence: signed ? 14 : null, publishedAt: signed ? isoAgo(2 * 86400) : null,
    fetchedAt: signed ? isoAgo(stale ? 3 * 86400 : 20 * 60) : null,
    stale, staleReason: stale ? "offline: github.com unreachable" : null, recommended, selectedYanked: yanked, releases,
  } };
}

function mockComponents(emitHost: (method: string, params: Record<string, unknown>) => void, settings?: Record<string, unknown>, windowsHost = false): Partial<DesktopApi> {
  const modes: Record<string, string> = { "job-service": COMPONENT_MODE, "claude-runtime": CLAUDE_MODE };
  const items = [mockComponent("job-service", COMPONENT_MODE), mockComponent("claude-runtime", CLAUDE_MODE), ...(!QUERY.has("legacy") ? [mockComponent("dsh-runtime", QUERY.get("dsh") ?? "missing", windowsHost), mockComponent("kimi-runtime", QUERY.get("kimi") ?? "missing", windowsHost)] : [])];
  modes["dsh-runtime"] = QUERY.get("dsh") ?? "missing";
  modes["kimi-runtime"] = QUERY.get("kimi") ?? "missing";
  let operation: Record<string, unknown> | null = CLAUDE_MODE === "installing" ? { id: "cop-preview", name: "claude-runtime", action: "install", state: "running", step: "download", error: null } : null;
  const list = () => ({
    managed: HOST_MODE !== "unmanaged",
    installFrom: HOST_MODE === "source" ? "source-only" : HOST_MODE === "unmanaged" ? "none" : "release",
    components: items.map(item => item.claudeCli ? { ...item, claudeCli: { ...item.claudeCli, selected: settings?.claudeCli === "system" && item.claudeCli.system ? "system" : settings?.claudeCli === "bundled" ? "bundled" : item.claudeCli.selected } } : item),
    operation,
    ...(NO_GATE ? {} : { indexOperation }),
  });
  let indexOperation: Record<string, unknown> | null = null;
  const publish = (name: string, reason: "operation" | "state") =>
    emitHost("cutex/components/updated", { name, reason, state: items.find((c) => c.name === name)!.state, operation });
  /** A terminal check / configure (instant in the mock): `done` + cutex's verdict, never a selection. */
  const finish = (c: ComponentStatus, action: string) => {
    const ext = c.external!;
    const ready = ext.checkedAt !== null && ext.issues.length === 0;
    operation = { id: `cop-${Date.now().toString(16)}`, name: c.name, action, state: "done", step: null, error: null, result: { outcome: ready ? "ready" : "needsUser", version: ext.version, selected: false } };
    publish(c.name, "operation");
    return { ok: true as const, value: readComponentOperation(structuredClone(operation)) };
  };
  let failedReads = 0;
  return {
    async components() {
      await delay();
      if ((COMPONENT_MODE === "readError" || CLAUDE_MODE === "readError") && failedReads++ < 1) throw new Error("connect ECONNRESET");
      return readComponentsList(structuredClone(list()));
    },
    async componentAction(name, action, opts) {
      await delay();
      const c = items.find((x) => x.name === name);
      if (!c) return { ok: false, error: { code: "component_unknown", message: `no component named \`${name}\``, status: 404 } };
      if (action === "check") {
        // cutex probed again (same issues in the mock): the time moves; an unverified adapter now has a verdict.
        if (!c.external) return { ok: false, error: { code: "component_not_external", message: `${name} has no external dependencies`, status: 409 } };
        c.external = { ...c.external, checkedAt: new Date().toISOString(), issues: EXT_NEVER && !EXT.includes("none") && !c.external.issues.length ? [{ code: "node_missing", expected: ">=24.9.0 <25", actual: null, path: null, steps: [] }] : c.external.issues };
        return finish(c, "check");
      }
      if (action === "remove") return { ok: false, error: { code: name === "job-service" ? "jobs_running" : "component_pinned", message: "refused by the mock", status: 409 } };
      if (modes[name] === "refused") return { ok: false, error: { code: "upgrade_blocked", message: "a backend upgrade or another component operation is running", status: 409, reason: "run_in_progress" } };
      // r270: a source / debug build refuses the empty (manifest) install; cutex may name a verified version to request explicitly.
      if (SRC_ONLY && action === "install" && !opts?.version)
        return { ok: false, error: { code: "component_source_only", message: `this source build has no release manifest for ${name}; select an explicit verified version`, status: 409, ...(SRC_ONLY !== "1" ? { offeredVersion: SRC_ONLY } : {}) } };
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
            const version = opts?.version ?? v.next;
            const ext = c.external;
            if (ext && ext.version === version && (ext.checkedAt === null || ext.issues.length) && c.selected) {
              // Dependency-blocked adapter: verified and staged (`done`), but the working version stays the default.
              operation = { id, name, action, state: "done", step: null, error: null, result: { outcome: "needsUser", version, selected: false } };
              Object.assign(c, { state: "ready" });
            } else {
              operation = { id, name, action, state: "done", step: null, error: null, result: { outcome: "selected", version, selected: true } };
              const pinned = c.versions.filter((x) => x.pinnedBy > 0 && x.version !== version);
              Object.assign(c, { state: "ready", selected: version, origin: "signed", versions: [{ version, pinnedBy: 0, sizeBytes: v.size }, ...pinned] });
              if (c.index) c.index = { ...c.index, selectedYanked: false };
            }
          }
          publish(name, "operation");
        }, 1200 * (i + 1)),
      );
      return { ok: true, value: readComponentOperation(structuredClone(operation)) };
    },
    // MOCK of the r269 owner action POST /v2/components/{name}/configure (Moth's route, not built yet).
    async componentConfigure(name, req) {
      await delay();
      const c = items.find((x) => x.name === name);
      if (!c?.external) return { ok: false, error: { code: "component_not_external", message: `${name} has no external dependencies`, status: 409 } };
      const ext = { ...c.external, ...(req.externalRoot !== undefined ? { root: req.externalRoot } : {}), ...(req.node !== undefined ? { node: req.node } : {}), ...(req.rg !== undefined ? { rg: req.rg } : {}), checkedAt: new Date().toISOString() };
      if (ext.storedConfig) {
        // r270: absent keeps the stored override, null clears it (cutex discovers again; the mock "finds" nothing then).
        const sc = { ...ext.storedConfig, ...req };
        ext.storedConfig = sc;
        ext.resolved = { externalRoot: sc.externalRoot, node: sc.node ?? c.external.resolved?.node ?? null, rg: sc.rg ?? c.external.resolved?.rg ?? null };
        Object.assign(ext, { root: ext.resolved.externalRoot, node: ext.resolved.node, rg: ext.resolved.rg });
      }
      const fixed = (code: string) => (code.startsWith("external_root") || code === "upstream_version_mismatch" ? !!req.externalRoot : code.startsWith("node_") ? !!req.node : code === "kimi_rg_missing" ? !!req.rg : false);
      ext.issues = ext.issues.filter((i) => !fixed(i.code));
      c.external = ext;
      // The selected adapter works once nothing fails; a candidate only becomes ready (selecting it is an install).
      if (!ext.issues.length && c.state === "needsUser") Object.assign(c, { state: "ready", steps: [] });
      return finish(c, "configure");
    },
    // MOCK of POST /v2/components/index/check: its own operation (`indexOperation`), then `cutex/components/indexUpdated`.
    async componentIndexCheck() {
      await delay();
      if (indexOperation?.state === "running") return { ok: false, error: { code: "upgrade_blocked", message: "an index refresh is running", status: 409, reason: "run_in_progress" } };
      const id = `cop-index-${Date.now().toString(16)}`;
      indexOperation = { id, name: null, action: "indexCheck", state: "running", step: "download", error: null };
      emitHost("cutex/components/indexUpdated", { channel: "public-stable", sequence: 14, stale: false, staleReason: null, operation: indexOperation });
      setTimeout(() => {
        const fail = QUERY.get("cindexCheck") === "fail";
        indexOperation = { id, name: null, action: "indexCheck", state: fail ? "failed" : "done", step: null, error: fail ? "download: github.com unreachable" : null };
        for (const c of items)
          if (c.index) c.index = fail ? { ...c.index, stale: true, staleReason: "offline: github.com unreachable" } : { ...c.index, stale: false, staleReason: null, fetchedAt: new Date().toISOString() };
        emitHost("cutex/components/indexUpdated", { channel: "public-stable", sequence: 14, stale: fail, staleReason: fail ? "offline: github.com unreachable" : null, operation: indexOperation });
      }, 1500);
      return { ok: true, value: readComponentOperation(structuredClone(indexOperation)) };
    },
  };
}

export const mock: ModuleMock = {
  api: (core) => ({ ...mockJobApi(byId), ...mockComponents((method, params) => core.emitHost(method, params), core.settings, true) }),
  remote: (hostId, emitHost) => ({ ...mockJobApi(remoteJobsOf(hostId)), ...mockComponents(emitHost) }),
  // The NCI rows above are plain Job Service data; inbound mail / the Gadi check are modules/nci/mock.ts.
  features: { new: ["job-external", ...(COMPONENT_MODE === "nocap" ? [] : [COMPONENTS_FEATURE]), ...(NO_GATE ? [] : [COMPONENT_INDEX_FEATURE, EXTERNAL_RUNTIME_ROOT_FEATURE])] },
};
