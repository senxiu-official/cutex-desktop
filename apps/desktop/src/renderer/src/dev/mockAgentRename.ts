// Mock cutex formal-agent-name-rename-v1 (lib/agentRename, components/AgentOwnName). Only with `?rename`
// (dev/mockFeatures mockScenarioFeatures): without it the mock host lacks the capability, as today.
// Names the mock refuses, so every message can be previewed:
//   another agent's current name → agent_name_conflict · "Nova" (an old name of another agent) → agent_name_reserved
//   "director", "x@host", "cutex.…" → agent_name_invalid · exactly the current name → agent_name_unchanged
//   (a case-only change is a rename) · an archived agent can be renamed and stays archived
// `?restorenameblocked`: the archived agent's own name is a reserved old name of another agent, so 恢复 is
// refused (agent_name_reserved; agent_name_taken for another agent's current name) until it is renamed.
// `?renamestale` / `?renamebusy`: the first rename answers stale_session_revision (the revision moved) /
// admission_busy (503, same request again). An aliased agent (小侦探) has 57 history entries (two pages).
import type { SessionResource } from "@cutex-desktop/protocol";
import { restoreNameWire, type FormalRenameRequest, type FormalRenameResult, type NameHistoryEvent, type NameHistoryPage, type NameScope } from "../../../shared/agentRename";

type Sidebar = { active: SessionResource[]; retired: SessionResource[]; hostRows: Record<string, { projectId?: string | null } | undefined> };

const Q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
const history = new Map<string, NameHistoryEvent[]>();
const replies = new Map<string, { body: string; reply: FormalRenameResult }>();
let sequence = 0;
let stale = Q.has("renamestale");
let busy = Q.has("renamebusy");
let seeded = false;

const scopeOf = (sidebar: Sidebar, id: string): NameScope => {
  const projectId = sidebar.hostRows[id]?.projectId;
  return projectId ? { kind: "project", projectId } : { kind: "unassigned" };
};

function event(id: string, oldName: string, newName: string, scope: NameScope, at: Date, revision: number, requestId = `seed-${sequence + 1}`): NameHistoryEvent {
  sequence += 1;
  return { sequence, eventId: `rename-${sequence}`, requestId, cutexSessionId: id, oldName, newName, scope, committedAt: at.toISOString(), actor: "human-management", previousRevision: revision - 1, revision };
}

/** Own names for the agents (cutex agents have one): at startup, so 编辑信息… shows 自己的名字. */
export function seedMockNames(sidebar: Sidebar): void {
  for (const s of [...sidebar.active, ...sidebar.retired]) if (!s.formalAgentName && s.registrationClass !== "local_only") s.formalAgentName = s.displayNameOverride ? s.cutexSessionId : s.displayName;
}

/** The seeded history, on first use (after the mock has set its aliases). */
function seedMockRename(sidebar: Sidebar): void {
  if (seeded) return;
  seeded = true;
  seedMockNames(sidebar);
  // Long histories go to agents whose display name differs from their own name (both visible at once);
  // "Nova" is an old name of the first agent without one.
  const named = sidebar.active.filter((s) => s.formalAgentName);
  const aliased = named.filter((s) => s.displayNameOverride);
  const second = named.find((s) => !s.displayNameOverride);
  const day = 86_400_000;
  for (const first of aliased.length ? aliased : named.slice(0, 1)) {
    const events: NameHistoryEvent[] = [];
    let name = `${first.formalAgentName}-v0`;
    for (let i = 0; i < 56; i += 1) {
      const next = `${first.formalAgentName}-v${i + 1}`;
      events.push(event(first.cutexSessionId, name, next, i % 3 ? scopeOf(sidebar, first.cutexSessionId) : { kind: "unassigned" }, new Date(Date.now() - (80 - i) * day), i + 2));
      name = next;
    }
    events.push(event(first.cutexSessionId, name, first.formalAgentName!, scopeOf(sidebar, first.cutexSessionId), new Date(Date.now() - 2 * day), 58));
    history.set(first.cutexSessionId, events);
  }
  // An archived agent keeps its log (read-only in 编辑信息…).
  const archived = sidebar.retired.find((s) => s.registrationClass !== "local_only");
  if (archived) history.set(archived.cutexSessionId, [
    event(archived.cutexSessionId, "refactor-bot", "refactor", { kind: "unassigned" }, new Date(Date.now() - 40 * day), 3),
    event(archived.cutexSessionId, "refactor", archived.displayName, scopeOf(sidebar, archived.cutexSessionId), new Date(Date.now() - 31 * day), 6),
  ]);
  if (archived && second && Q.has("restorenameblocked")) history.set(second.cutexSessionId, [event(second.cutexSessionId, archived.formalAgentName ?? archived.displayName, second.formalAgentName!, scopeOf(sidebar, second.cutexSessionId), new Date(Date.now() - 3 * day), 3)]);
  if (second && !history.has(second.cutexSessionId)) history.set(second.cutexSessionId, [event(second.cutexSessionId, "Nova", second.formalAgentName!, scopeOf(sidebar, second.cutexSessionId), new Date(Date.now() - 5 * day), 4)]);
}

const fail = (code: string, message: string, retrySame = false, holderSessionIds?: string[]): FormalRenameResult => ({ ok: false, error: { code, message, retrySame, ...(holderSessionIds ? { holderSessionIds } : {}) } });

export async function mockRename(sidebar: Sidebar, id: string, request: FormalRenameRequest): Promise<FormalRenameResult> {
  await new Promise((r) => setTimeout(r, 350));
  seedMockRename(sidebar);
  const body = JSON.stringify([id, request.expectedRevision, request.name]);
  const stored = replies.get(request.requestId);
  if (stored) return stored.body === body ? (stored.reply.ok ? { ...stored.reply, replayed: true } : stored.reply) : fail("idempotency_conflict", "requestId reused with a different body");
  if (busy) {
    busy = false;
    return fail("admission_busy", "management admission is busy; retry the same request", true);
  }
  const s = [...sidebar.active, ...sidebar.retired].find((x) => x.cutexSessionId === id);
  if (!s) return fail("agent_not_found", "no such agent");
  if (!s.formalAgentName) return fail("not_formal_agent", "the session has no formal agent name");
  if (stale) {
    stale = false;
    s.revision += 1;
  }
  if (request.expectedRevision !== s.revision) return fail("stale_session_revision", `expected revision ${request.expectedRevision}, current ${s.revision}`);
  const name = request.name.trim();
  if (/^director$/i.test(name) || name.includes("@") || /^cutex\./i.test(name)) return fail("agent_name_invalid", "director address, @remote syntax and ID-shaped names are refused");
  if (name === s.formalAgentName) return fail("agent_name_unchanged", "that is the current name");
  const holder = sidebar.active.find((x) => x.cutexSessionId !== id && (x.formalAgentName ?? x.displayName).toLowerCase() === name.toLowerCase());
  if (holder) return fail("agent_name_conflict", `another active agent is named ${name}`, false, [holder.cutexSessionId]);
  const scope = scopeOf(sidebar, id);
  // Real cutex reserves old names per Project / unassigned scope; the mock reserves them host-wide.
  const reserved = [...history.entries()].find(([sid, events]) => sid !== id && events.some((e) => e.oldName.toLowerCase() === name.toLowerCase()));
  if (reserved) return fail("agent_name_reserved", `${name} is a former name of another agent in this scope`, false, [reserved[0]]);
  const old = s.formalAgentName;
  s.revision += 1;
  s.formalAgentName = name;
  // displayNameOverride stays exactly as the owner set it; without one the shown name follows.
  s.displayName = s.displayNameOverride ?? name;
  const committed = event(id, old, name, scope, new Date(), s.revision, request.requestId);
  history.set(id, [...(history.get(id) ?? []), committed]);
  const reply: FormalRenameResult = { ok: true, event: committed, replayed: false, session: structuredClone(s) };
  replies.set(request.requestId, { body, reply });
  return reply;
}

export async function mockNameHistory(sidebar: Sidebar, id: string, before: number | null, limit = 50): Promise<NameHistoryPage> {
  await new Promise((r) => setTimeout(r, 200));
  seedMockRename(sidebar);
  const newest = [...(history.get(id) ?? [])].reverse().filter((e) => before === null || e.sequence < before);
  const events = newest.slice(0, limit);
  return { events, next: newest.length > limit ? events[events.length - 1]!.sequence : null };
}


/** 恢复 of an archived agent whose own name is now another agent's (current or reserved old name): the wire refusal main would throw. */
export function mockRestoreRefusal(sidebar: Sidebar, id: string): string | null {
  seedMockRename(sidebar);
  const s = sidebar.retired.find((x) => x.cutexSessionId === id);
  const name = s?.formalAgentName?.toLowerCase();
  if (!s || !name) return null;
  const holder = sidebar.active.find((x) => x.cutexSessionId !== id && x.formalAgentName?.toLowerCase() === name);
  if (holder) return restoreNameWire({ code: "agent_name_taken", details: { holderSessionIds: [holder.cutexSessionId], renameRequired: true } });
  const reserved = [...history.entries()].find(([sid, events]) => sid !== id && events.some((e) => e.oldName.toLowerCase() === name));
  return reserved ? restoreNameWire({ code: "agent_name_reserved", details: { holderSessionIds: [reserved[0]], scope: scopeOf(sidebar, id), renameRequired: true } }) : null;
}
