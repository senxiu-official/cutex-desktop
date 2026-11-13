// Browser-preview data for projects (dev/mockTypes.ts): cutex `project-optional-director`
// (create_project / assign_director / clear_director; the mutations live in dev/mockBridge.ts with
// the rest of the project state). `?legacy` drops it: a Director is then required on create.
//
// `owner-rotation` (轮换主管): /v2/director-rotations with a scripted state machine. The successor
// is created and the seat moved through the core's own createAgent / projectMutation, so the sidebar
// and the project page follow. `?rot=` picks the script:
//   (none)    the note arrives after 5 s, then one step every 1.4 s → done
//   timeout   the note never comes; the deadline is 8 s in → timeout (继续 / 取消)
//   fail      the seat move is refused → failed (the successor stays a member)
//   wait      the note never comes; the deadline is the chosen one (stays 等待交接)
//   running   kks starts with a rotation waiting for its note (banner, 查看 opens the progress)
import type { DesktopApi, DirectorRotation, DirectorRotationResult, DirectorRotationStart, DirectorRotationState, ProjectMemoryMutation, ProjectMemoryView } from "../../../../shared/ipc";
import { isTerminalRotation, nextSuccessorName, ROTATION_UPDATED_METHOD, rotationCancellable, rotationWaiting } from "../../../../shared/directorRotation";
import type { MockCore, ModuleMock } from "../../dev/mockTypes";
import { indexLineReferences, MEMORY_INDEX_FILE, memoryDraftProblems, memoryFileProblem, nextMemoryIndex, parseMemory } from "../../../../shared/projectMemory";
import { OPERATOR_ACTION_SCHEMA, type OperatorActionReceipt, type OperatorActionRequest, type OperatorGrant, type OperatorProjectMember, type OperatorProjectWorkspace } from "@cutex-desktop/cutex-client";

interface OperatorState {
  revisions: Map<string, number>;
  grants: Map<string, Map<string, OperatorGrant>>;
  receipts: Map<string, { digest: string; receipt: OperatorActionReceipt }>;
  required: Map<string, number>;
  seeded: boolean;
}
const operatorStates = new WeakMap<MockCore, OperatorState>();
function operatorState(core: MockCore): OperatorState {
  let state = operatorStates.get(core);
  if (!state) {
    state = { revisions: new Map(), grants: new Map(), receipts: new Map(), required: new Map(), seeded: false };
    operatorStates.set(core, state);
  }
  return state;
}
function operatorQuery(): URLSearchParams {
  return new URLSearchParams(typeof location === "undefined" ? "" : location.search);
}
function projectRecord(core: MockCore, id: string) {
  const snapshot = core.projectRecords();
  const project = [...(snapshot.projects?.projects ?? []), ...(snapshot.projects?.archived_projects ?? [])].find(p => p.project_id === id);
  if (!project) throw Error("project_not_authorized");
  return project;
}
function operatorMember(session: ReturnType<MockCore["projectRecords"]>["active"][number]): OperatorProjectMember {
  return { agent: { cutex_session_id: session.cutexSessionId, spec: { name: session.displayName ?? session.cutexSessionId }, retired_at: session.lifecycle === "retired" ? "2026-10-24T12:00:00Z" : null },
    lifecycle: session.runtime.status === "online" ? "online" : "offline",
    runtime: { active: session.runtime.status === "online", runtime_generation: session.runtime.runtimeGeneration } };
}
function syncOperators(core: MockCore): void {
  if (core.legacy) return;
  const snapshot = core.projectRecords(), state = operatorState(core);
  snapshot.projectOperators = {};
  for (const project of [...(snapshot.projects?.projects ?? []), ...(snapshot.projects?.archived_projects ?? [])]) {
    const grants = state.grants.get(project.project_id);
    for (const id of grants?.keys() ?? []) {
      if (!snapshot.active.some(s => s.cutexSessionId === id) || snapshot.hostRows[id]?.projectId !== project.project_id || id === project.director_cutex_session_id) {
        grants!.delete(id); state.revisions.set(project.project_id, (state.revisions.get(project.project_id) ?? 0) + 1);
      }
    }
    const ids = [...(grants?.keys() ?? [])].sort();
    snapshot.projectOperators[project.project_id] = ids;
    project.operator_count = ids.length;
  }
  for (const [id, generation] of state.required) {
    const session = snapshot.active.find(s => s.cutexSessionId === id);
    if (!session || session.runtime.status !== "online" || session.runtime.runtimeGeneration !== generation) state.required.delete(id);
  }
  snapshot.operatorRestartRequired = [...state.required.keys()].sort();
}
function seedOperator(core: MockCore): void {
  const state = operatorState(core), q = operatorQuery();
  if (state.seeded || core.legacy || !q.has("operator")) return;
  state.seeded = true;
  const project = projectRecord(core, "desktop"), snapshot = core.projectRecords();
  const id = q.get("operator") === "idle" ? "mika" : "alden";
  const session = snapshot.active.find(s => s.cutexSessionId === id);
  if (!session || !project.director_cutex_session_id) return;
  state.grants.set("desktop", new Map([[id, { project_id: "desktop", operator_cutex_session_id: id, grant_revision: 1,
    granted_at: "2026-10-24T12:00:00Z", granted_by_primary_director_session: project.director_cutex_session_id, performed_by_human_management: true }]]));
  state.revisions.set("desktop", 1);
  if (id === "alden") {
    core.markBusy(id, "operator-demo-turn"); session.runtime.activeTurnId = "operator-demo-turn";
    state.required.set(id, session.runtime.runtimeGeneration);
  }
  syncOperators(core);
}
function readOperatorProject(core: MockCore, id: string): OperatorProjectWorkspace {
  syncOperators(core);
  const snapshot = core.projectRecords(), p = projectRecord(core, id), state = operatorState(core);
  const members = snapshot.active.filter(s => snapshot.hostRows[s.cutexSessionId]?.projectId === id).map(operatorMember);
  // Like the daemon: a member holding this project's Operator grant is listed under agent_operators only.
  const grants = core.legacy ? new Map<string, OperatorGrant>() : state.grants.get(id) ?? new Map<string, OperatorGrant>();
  const active = members.filter(m => !grants.has(m.agent.cutex_session_id));
  const retired = snapshot.retired.filter(s => snapshot.hostRows[s.cutexSessionId]?.projectId === id).map(operatorMember);
  const director = p.director_cutex_session_id ? { cutex_session_id: p.director_cutex_session_id, member: members.find(m => m.agent.cutex_session_id === p.director_cutex_session_id) } : undefined;
  return structuredClone({ project_id: id, authority_epoch: p.authority_epoch, project_revision: p.project_revision ?? 0,
    lifecycle: p.lifecycle, access_role: "human_management", director, presentation: p.presentation,
    active_agents: active, retired_agents: retired, archived_agents: [], workspace_root: p.workspace_root,
    ...(core.legacy ? {} : { operator_grant_revision: state.revisions.get(id) ?? 0,
      agent_operators: [...grants.values()].map(grant => ({ grant, member: members.find(m => m.agent.cutex_session_id === grant.operator_cutex_session_id)! })) }),
  });
}
async function actOperator(core: MockCore, request: OperatorActionRequest): Promise<OperatorActionReceipt> {
  if (core.legacy) throw Error("unsupported_route: operator-actions");
  if (request.schema !== OPERATOR_ACTION_SCHEMA || !["grant", "revoke"].includes(request.operation)) throw Error("invalid_request");
  const actionId = request.action_id ?? `human-${crypto.randomUUID()}`;
  const digest = JSON.stringify({ schema: request.schema, action_id: actionId, project_id: request.project_id,
    expected_authority_epoch: request.expected_authority_epoch, expected_grant_revision: request.expected_grant_revision,
    operation: request.operation, operator_cutex_session_id: request.operator_cutex_session_id });
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digest)))].map(n => n.toString(16).padStart(2, "0")).join("");
  const state = operatorState(core), prior = state.receipts.get(actionId);
  if (prior) { if (prior.digest !== digest) throw Error("conflict: action_id_payload_conflict"); return structuredClone(prior.receipt); }
  const workspace = readOperatorProject(core, request.project_id);
  if (workspace.lifecycle !== "active" || !workspace.director) throw Error("project_not_authorized");
  if (request.expected_authority_epoch !== undefined && request.expected_authority_epoch !== workspace.authority_epoch) throw Error("conflict: stale_project_authority");
  const previous = workspace.operator_grant_revision!;
  if (request.expected_grant_revision !== undefined && request.expected_grant_revision !== previous) throw Error("conflict: operator_grant_revision_conflict");
  const id = request.operator_cutex_session_id;
  if (workspace.director.cutex_session_id === id) throw Error("conflict: primary_director_cannot_be_operator");
  const grants = state.grants.get(request.project_id) ?? new Map<string, OperatorGrant>();
  if (request.operation === "grant" && grants.has(id)) throw Error("conflict: operator_already_granted");
  if (request.operation === "grant" && !workspace.active_agents.some(m => m.agent.cutex_session_id === id)) throw Error("conflict: operator_must_be_active_managed_agent");
  if (request.operation === "revoke" && !grants.has(id)) throw Error("conflict: operator_not_granted");
  const revision = previous + 1, at = new Date().toISOString();
  const grant: OperatorGrant | undefined = request.operation === "grant" ? { project_id: request.project_id, operator_cutex_session_id: id,
    grant_revision: revision, granted_at: at, granted_by_primary_director_session: workspace.director.cutex_session_id, performed_by_human_management: true } : undefined;
  if (grant) grants.set(id, grant); else grants.delete(id);
  state.grants.set(request.project_id, grants); state.revisions.set(request.project_id, revision);
  const session = core.projectRecords().active.find(s => s.cutexSessionId === id);
  if (session?.runtime.status === "online") state.required.set(id, session.runtime.runtimeGeneration);
  syncOperators(core);
  const receipt: OperatorActionReceipt = { schema: OPERATOR_ACTION_SCHEMA, action_id: actionId, request_sha256: hash,
    operation: request.operation, project_id: request.project_id, authority_epoch: workspace.authority_epoch,
    primary_director_cutex_session_id: workspace.director.cutex_session_id, operator_cutex_session_id: id,
    previous_grant_revision: previous, grant_revision: revision, ...(grant ? { grant } : {}),
    roster: { grant_revision: revision, operators: [...grants.values()] }, committed_at: at,
    audit_event: { event_id: `human-management:${actionId}:operator-grant:${revision}`, action_id: actionId,
      project_id: request.project_id, operator_cutex_session_id: id, kind: request.operation === "grant" ? "granted" : "revoked",
      previous_grant_revision: previous, grant_revision: revision, primary_director_cutex_session_id: workspace.director.cutex_session_id,
      performed_by_human_management: true, committed_at: at } };
  state.receipts.set(actionId, { digest, receipt: structuredClone(receipt) });
  return structuredClone(receipt);
}

const SCENARIO = typeof location !== "undefined" ? (new URLSearchParams(location.search).get("rot") ?? "") : "";
const NOTE_MS = 5000;
const STEP_MS = 1400;
const MOCK_TIMEOUT_MS = 8000;

const rotations: DirectorRotation[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const refuse = (code: string, message: string): DirectorRotationResult => ({ ok: false, error: { code, message } });
const stamp = (ms = Date.now()) => iso(ms).replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

function publish(core: MockCore, r: DirectorRotation): void {
  r.revision += 1;
  r.updatedAt = iso();
  core.emitHost(ROTATION_UPDATED_METHOD, { rotation: structuredClone(r) });
}

function to(core: MockCore, r: DirectorRotation, state: DirectorRotationState, note?: string): void {
  r.state = state;
  r.attempts = 0;
  r.history.push({ state, at: iso(), ...(note ? { note } : {}) });
  if (isTerminalRotation(state)) r.finishedAt = iso();
  publish(core, r);
}

function later(r: DirectorRotation, ms: number, run: () => void): void {
  const list = timers.get(r.rotationId) ?? [];
  list.push(setTimeout(run, ms));
  timers.set(r.rotationId, list);
}

function clearTimers(r: DirectorRotation): void {
  for (const timer of timers.get(r.rotationId) ?? []) clearTimeout(timer);
  timers.delete(r.rotationId);
}

/** successor_created → authority_rebound → predecessor_disposed → done, through the core api. */
function proceed(core: MockCore, r: DirectorRotation): void {
  r.successorCreateStartedAt = iso();
  later(r, STEP_MS, () => {
    void (async () => {
      const spec = r.successorSpec;
      const created = await window.cutex.api.createAgent({ name: spec.name, projectId: r.projectId, cwd: spec.cwd, ...(spec.profile ? { profile: spec.profile } : {}), start: false });
      r.successorCutexSessionId = created.cutexSessionId;
      to(core, r, "successor_created");
      later(r, STEP_MS, () => {
        void (async () => {
          if (SCENARIO === "fail") {
            r.error = { code: "rebind_failed", message: `conflict: successor_not_director_candidate: ${spec.name} cannot hold the Director seat (Operator grant)` };
            r.warnings.push(`${spec.name} was created and stays a member of ${r.projectName}`);
            return to(core, r, "failed");
          }
          const expected = { authorityEpoch: r.expectedAuthorityEpoch, projectRevision: 0 };
          await window.cutex.api.projectMutation(r.projectId, expected, { kind: "clear_director" });
          await window.cutex.api.projectMutation(r.projectId, expected, { kind: "assign_director", cutex_session_id: created.cutexSessionId });
          r.authorityEpoch = r.expectedAuthorityEpoch + 1;
          to(core, r, "authority_rebound");
          later(r, STEP_MS, () => {
            if (r.disposition === "archive") r.warnings.push(`${r.predecessor.name}: 2 open delegations were cancelled with the archive`);
            to(core, r, "predecessor_disposed");
            later(r, STEP_MS, () => to(core, r, "done"));
          });
        })();
      });
    })();
  });
}

function waitForNote(core: MockCore, r: DirectorRotation): void {
  const deadline = Date.parse(r.handoff.deadline!);
  if (SCENARIO === "" || SCENARIO === "fail") {
    later(r, NOTE_MS, () => {
      r.handoff.writtenAt = iso();
      to(core, r, "handoff_written");
      proceed(core, r);
    });
    return;
  }
  later(r, Math.max(0, deadline - Date.now()), () => to(core, r, "timeout", "no handoff note before the deadline"));
}

async function start(core: MockCore, request: DirectorRotationStart): Promise<DirectorRotationResult> {
  if (rotations.some((x) => !isTerminalRotation(x.state) && (x.projectId === request.projectId || x.predecessor.cutexSessionId === request.expectedDirectorCutexSessionId))) {
    return refuse("rotation_in_progress", "rotation is still running for this Project or Director");
  }
  const replay = rotations.find((x) => x.requestId === request.requestId);
  if (replay) return { ok: true, rotation: structuredClone(replay) };
  const sidebar = await window.cutex.api.sidebar();
  const project = sidebar.projects?.projects.find((p) => p.project_id === request.projectId);
  if (!project) return refuse("project_not_found", "the Project does not exist on this host");
  if (project.director_cutex_session_id !== request.expectedDirectorCutexSessionId || project.authority_epoch !== request.expectedAuthorityEpoch) {
    return refuse("stale_project_authority", `the Project's Director is ${project.director_cutex_session_id} at epoch ${project.authority_epoch}; reload and try again`);
  }
  const director = [...sidebar.active, ...sidebar.retired].find((s) => s.cutexSessionId === request.expectedDirectorCutexSessionId);
  const name = director?.formalAgentName || director?.displayName || request.expectedDirectorCutexSessionId;
  const cwd = request.successor.cwd ?? director?.cwd ?? project.workspace_root ?? "D:\\Programs";
  const base = project.workspace_root ?? director?.cwd ?? cwd;
  const now = Date.now();
  const timeoutSecs = request.handoffTimeoutSecs ?? 600;
  const deadline = SCENARIO === "timeout" ? now + MOCK_TIMEOUT_MS : now + timeoutSecs * 1000;
  const r: DirectorRotation = {
    rotationId: `rot-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    requestId: request.requestId,
    projectId: project.project_id,
    projectName: project.presentation.display_name,
    state: "requested",
    predecessor: { cutexSessionId: request.expectedDirectorCutexSessionId, name },
    expectedAuthorityEpoch: request.expectedAuthorityEpoch,
    disposition: request.predecessor,
    successorSpec: {
      name: request.successor.name ?? nextSuccessorName(name),
      profile: request.successor.profile ?? director?.profile ?? null,
      model: request.successor.model ?? null,
      reasoningEffort: request.successor.reasoningEffort ?? null,
      cwd,
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
    },
    handoff: { path: `${base}\\handoff\\${stamp(now)}.md`, timeoutSecs, requestedAt: null, deadline: null, writtenAt: null, skipped: false },
    successorCutexSessionId: null,
    successorCreateStartedAt: null,
    authorityEpoch: null,
    predecessorDelegations: project.project_id === "desktop" ? { requested: 2, handling: 1 } : { requested: 0, handling: 0 },
    attempts: 0,
    error: null,
    warnings: [],
    history: [{ state: "requested", at: iso(now) }],
    createdAt: iso(now),
    updatedAt: iso(now),
    finishedAt: null,
    revision: 1,
  };
  rotations.unshift(r);
  later(r, 400, () => {
    r.handoff.requestedAt = iso();
    r.handoff.deadline = iso(deadline);
    to(core, r, "handoff_requested");
    waitForNote(core, r);
  });
  return { ok: true, rotation: structuredClone(r) };
}

export const mock: ModuleMock = {
  // project-icon: the presentation stores the 项目图标 (seeded on waveline / notes in dev/mockBridge.ts).
  // project-memory: the 记忆 tab's 新建 / 编辑 / 删除 (memoryApi below; `?legacy` keeps the list read-only).
  features: { new: ["project-optional-director", "owner-rotation", "project-create-workspace-root", "project-icon", "project-memory"] },
  api(core) {
    seedOperator(core);
    return {
      ...memoryApi(),
      async projectRead(projectId) { return readOperatorProject(core, projectId); },
      async operatorAction(request) { return actOperator(core, request); },
      async operatorRuntimeNotice(projectId, sessionId) {
        const workspace = readOperatorProject(core, projectId);
        if (core.legacy || ![...workspace.active_agents, ...(workspace.agent_operators ?? []).map(o => o.member)].some(m => m.agent.cutex_session_id === sessionId)) throw Error("operator_unavailable");
        const session = core.projectRecords().active.find(s => s.cutexSessionId === sessionId)!;
        const state = operatorState(core);
        if (session.runtime.status !== "online") { state.required.delete(sessionId); syncOperators(core); return { state: "offline" }; }
        state.required.set(sessionId, session.runtime.runtimeGeneration); syncOperators(core);
        return { state: "required" };
      },
      async directorRotations(projectId) {
        if (core.legacy) return null;
        return structuredClone(rotations.filter((r) => r.projectId === projectId));
      },
      async directorRotation(rotationId) {
        const r = rotations.find((x) => x.rotationId === rotationId);
        return r ? structuredClone(r) : null;
      },
      async startDirectorRotation(request) {
        return start(core, request);
      },
      async cancelDirectorRotation(rotationId) {
        const r = rotations.find((x) => x.rotationId === rotationId);
        if (!r) return refuse("rotation_not_found", "no such rotation");
        if (r.state === "cancelled") return { ok: true, rotation: structuredClone(r) };
        if (!rotationCancellable(r)) return refuse("rotation_not_cancellable", `the rotation is ${r.state}; the successor is already being created`);
        clearTimers(r);
        to(core, r, "cancelled", "cancelled by the owner");
        return { ok: true, rotation: structuredClone(r) };
      },
      async continueDirectorRotation(rotationId) {
        const r = rotations.find((x) => x.rotationId === rotationId);
        if (!r) return refuse("rotation_not_found", "no such rotation");
        if (r.handoff.skipped) return { ok: true, rotation: structuredClone(r) };
        if (!rotationWaiting(r)) return refuse("rotation_not_waiting", `the rotation is ${r.state}`);
        clearTimers(r);
        r.handoff.skipped = true;
        publish(core, r);
        proceed(core, r);
        return { ok: true, rotation: structuredClone(r) };
      },
    };
  },
  sidebar(snapshot, core) {
    syncOperators(core);
    if (core.legacy) return snapshot;
    const canonical = core.projectRecords();
    return { ...snapshot, projectOperators: canonical.projectOperators, operatorRestartRequired: canonical.operatorRestartRequired };
  },
  start(core) {
    if (SCENARIO !== "running" || core.legacy) return;
    // kks: a rotation already waiting for kks-director's note (the page shows the banner).
    // Deferred: window.cutex is installed after the module mocks start.
    setTimeout(() => {
      void start(core, {
        requestId: "mock-kks-rotation",
        projectId: "kks",
        expectedDirectorCutexSessionId: "kks-dir",
        expectedAuthorityEpoch: 1,
        predecessor: "member",
        handoffTimeoutSecs: 1200,
        successor: {},
      });
    }, 0);
  },
};
// ---------- project memory ----------
// Browser-preview project memory (cutex `project-memory`): GET / PUT / DELETE /v2/projects/{id}/memory[/{file}] on an
// in-memory store with content revisions and cutex's refusals (invalid file / content, revision_conflict with the
// current revision, memory_not_found). `?memoryconflict`: the first save of an existing entry finds it changed by
// "an agent" (its body gets a line), so the conflict notice can be seen.

type Doc = { content: string; updatedAt: string };
type Store = { dir: string; files: Map<string, Doc> };

function revisionOf(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) h = Math.imul(h ^ content.charCodeAt(i), 0x01000193) >>> 0;
  return `sha256:mock${h.toString(16).padStart(8, "0")}${content.length.toString(16)}`;
}

const entry = (name: string, description: string, type: string, body: string) => `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`;

function seed(projectId: string): Store {
  const dir = `C:\\Users\\sam\\.cutex\\projects\\${projectId}\\memory`;
  const files = new Map<string, Doc>();
  if (projectId === "desktop") {
    files.set("decisions.md", { content: entry("decisions", "architecture choices the team agreed on", "project", "# Decisions\n\n- cutex is the daemon; desktop is a client.\n- One agent = one session = one native thread.\n- Tokens stay in the main process.\n\n**Why:** a remote host must work the same as the local one.\n**How to apply:** new desktop features go through daemon APIs."), updatedAt: "2026-10-06T09:40:00Z" });
    files.set("windows-acl.md", { content: entry("windows-acl", "why dev homes live under the user profile", "reference", "# Windows ACL\n\ncutex requires owner-private ACLs, so dev homes must live under `%USERPROFILE%`."), updatedAt: "2026-10-05T22:03:00Z" });
    files.set("feedback-plain-words.md", { content: entry("feedback-plain-words", "owner wants plain words in reports, no jargon", "feedback", "Write reports in plain words.\n\n**Why:** the owner reads them on a phone between meetings.\n**How to apply:** short sentences, name the decision first."), updatedAt: "2026-11-02T08:15:00Z" });
    files.set(MEMORY_INDEX_FILE, {
      content: "- [Plain words](feedback-plain-words.md) — owner wants plain words in reports, no jargon\n- [Decisions](decisions.md) — architecture choices the team agreed on\n- [Windows ACL](windows-acl.md) — why dev homes live under the user profile\n",
      updatedAt: "2026-11-02T08:15:00Z",
    });
  }
  return { dir, files };
}

/** The memory part of the projects module's mock api (one store per project, kept for the page's lifetime). */
export function memoryApi(): Pick<DesktopApi, "projectMemory" | "projectMemoryFile" | "projectMemoryWrite" | "projectMemoryDelete"> {
  const stores = new Map<string, Store>();
  const store = (projectId: string) => stores.get(projectId) ?? (stores.set(projectId, seed(projectId)), stores.get(projectId)!);
  let conflictOnce = new URLSearchParams(location.search).has("memoryconflict");
  const view = (projectId: string): ProjectMemoryView => {
    const s = store(projectId);
    const index = s.files.get(MEMORY_INDEX_FILE);
    return {
      contractVersion: 2,
      projectId,
      dir: s.dir,
      index: index?.content ?? null,
      indexRevision: index ? revisionOf(index.content) : null,
      entries: [...s.files.entries()]
        .filter(([f]) => f !== MEMORY_INDEX_FILE)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, d]) => {
          const fm = parseMemory(d.content);
          return { file, name: fm.name || file, description: fm.description || null, type: fm.type || null, bytes: new TextEncoder().encode(d.content).length, updatedAt: d.updatedAt, revision: revisionOf(d.content) };
        }),
    };
  };
  const refuse = (code: "invalid_memory_file" | "invalid_memory_content" | "memory_not_found" | "other", message: string): ProjectMemoryMutation => ({ ok: false, code, message });
  return {
    async projectMemory(projectId) {
      return view(projectId);
    },
    async projectMemoryFile(projectId, file) {
      const d = store(projectId).files.get(file);
      if (!d) throw new Error("memory_not_found: memory file not found");
      return { file, content: d.content, bytes: d.content.length, updatedAt: d.updatedAt, revision: revisionOf(d.content) };
    },
    async projectMemoryWrite(projectId, file, content, expectedRevision, updateIndex) {
      const s = store(projectId);
      if (file !== MEMORY_INDEX_FILE) {
        if (memoryFileProblem(file)) return refuse("invalid_memory_file", "memory file names must match [a-z0-9][a-z0-9._-]*.md");
        const fm = parseMemory(content);
        if (!fm.frontmatter || memoryDraftProblems(fm).length) return refuse("invalid_memory_content", "frontmatter needs a kebab-case name, a one-line description and metadata.type");
      }
      const existing = s.files.get(file);
      if (conflictOnce && existing && file !== MEMORY_INDEX_FILE && expectedRevision) {
        conflictOnce = false;
        existing.content = `${existing.content.replace(/\n?$/, "\n")}\n(An agent added this line meanwhile.)\n`;
        existing.updatedAt = new Date().toISOString();
      }
      const current = existing ? revisionOf(existing.content) : null;
      if (expectedRevision !== current) return { ok: false, code: "revision_conflict", currentRevision: current, message: "revision_conflict: memory file revision does not match expectedRevision" };
      s.files.set(file, { content, updatedAt: new Date().toISOString() });
      let indexUpdated = false;
      if (updateIndex && file !== MEMORY_INDEX_FILE) {
        const fm = parseMemory(content);
        const next = nextMemoryIndex(s.files.get(MEMORY_INDEX_FILE)?.content, file, null, fm);
        if (next !== null) (s.files.set(MEMORY_INDEX_FILE, { content: next, updatedAt: new Date().toISOString() }), (indexUpdated = true));
      }
      return { ok: true, file, revision: revisionOf(content), indexUpdated };
    },
    async projectMemoryDelete(projectId, file, expectedRevision) {
      const s = store(projectId);
      if (file === MEMORY_INDEX_FILE) return refuse("invalid_memory_content", "MEMORY.md cannot be deleted");
      const existing = s.files.get(file);
      if (!existing) return refuse("memory_not_found", "memory file not found");
      const current = revisionOf(existing.content);
      if (expectedRevision !== current) return { ok: false, code: "revision_conflict", currentRevision: current, message: "revision_conflict" };
      s.files.delete(file);
      const index = s.files.get(MEMORY_INDEX_FILE);
      let indexUpdated = false;
      if (index) {
        const kept = index.content.split("\n").filter((l) => !indexLineReferences(l, file));
        if (kept.length !== index.content.split("\n").length) (s.files.set(MEMORY_INDEX_FILE, { content: kept.join("\n"), updatedAt: new Date().toISOString() }), (indexUpdated = true));
      }
      return { ok: true, file, revision: null, indexUpdated };
    },
  };
}
