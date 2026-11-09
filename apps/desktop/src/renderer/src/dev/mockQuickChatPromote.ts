// Mock cutex quick-chat-promote-v1 (lib/quickChatPromote, components/QuickChatPromoteDialog). Only with `?promote`
// (dev/mockFeatures): without it the mock host lacks the capability, as today. Names the mock refuses, so every
// message can be previewed: another agent's own name → agent_name_conflict · "Nova" → agent_name_reserved ·
// "director", "x@host", "cutex.…" → agent_name_invalid. A running chat → quick_chat_running.
// `?promotebusy`: the first request answers admission_busy (503, same request again).
// `?promoteincomplete`: the first two answers are complete:false (promoted, roster step unfinished).
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../../../shared/ipc";
import type { PromoteRequest, PromoteResult } from "../../../shared/quickChatPromote";

const Q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
let busy = Q.has("promotebusy");
let incomplete = Q.has("promoteincomplete") ? 2 : 0;
const replies = new Map<string, { body: string; reply: PromoteResult }>();

const refuse = (code: string, message: string, retrySame = false): PromoteResult => ({ ok: false, error: { code, message, retrySame } });

/** Applies a promotion to `snapshot`; returns the new snapshot (unchanged on a refusal) and the answer. */
export function mockPromote(snapshot: SidebarSnapshot, id: string, request: PromoteRequest): { snapshot: SidebarSnapshot; reply: PromoteResult } {
  const body = JSON.stringify([request.expectedRevision, request.name, request.projectId]);
  const seen = replies.get(`${id}\n${request.requestId}`);
  if (seen && seen.reply.ok && seen.reply.result.complete) return { snapshot, reply: seen.body === body ? seen.reply : refuse("request_id_payload_conflict", "requestId reused with another body") };
  if (seen && seen.body !== body) return { snapshot, reply: refuse("request_id_payload_conflict", "requestId reused with another body") };
  if (busy) {
    busy = false;
    return { snapshot, reply: refuse("admission_busy", "management admission is busy", true) };
  }
  const session = snapshot.active.find((s) => s.cutexSessionId === id);
  if (!session) return { snapshot, reply: refuse("session_not_found", `no session ${id}`) };
  const promotedHere = seen?.reply.ok === true;
  if (!promotedHere) {
    if (session.formalAgentName || session.registrationClass !== "local_only") return { snapshot, reply: refuse("not_quick_chat", "not a quick chat") };
    if (session.runtime.status === "online" || session.runtime.status === "starting") return { snapshot, reply: refuse("quick_chat_running", "stop the quick chat first") };
    if (session.revision !== request.expectedRevision) return { snapshot, reply: refuse("revision_conflict", "the session revision moved") };
    const name = request.name.trim();
    if (/^director$/i.test(name) || name.includes("@") || name.startsWith("cutex.")) return { snapshot, reply: refuse("agent_name_invalid", "reserved form") };
    if (name === "Nova") return { snapshot, reply: refuse("agent_name_reserved", "a former name of another agent") };
    if ([...snapshot.active, ...snapshot.retired].some((s) => s.cutexSessionId !== id && (s.formalAgentName ?? "").toLowerCase() === name.toLowerCase()))
      return { snapshot, reply: refuse("agent_name_conflict", "name in use on this host") };
    if (request.projectId) {
      const project = snapshot.projects?.projects.find((p) => p.project_id === request.projectId);
      if (!project) return { snapshot, reply: refuse("project_not_found", "no such project") };
      if (project.lifecycle !== "active") return { snapshot, reply: refuse("project_not_active", "project is not active") };
    }
  }
  const revision = request.expectedRevision + 1;
  const complete = incomplete === 0;
  if (incomplete > 0) incomplete -= 1;
  const promoted: SessionResource = { ...session, formalAgentName: request.name.trim(), registrationClass: "persistent" as SessionResource["registrationClass"], revision };
  const row = snapshot.hostRows[id];
  const next: SidebarSnapshot = {
    ...snapshot,
    active: snapshot.active.map((s) => (s.cutexSessionId === id ? promoted : s)),
    hostRows: complete ? { ...snapshot.hostRows, [id]: { ...row!, kind: "Agent", projectId: request.projectId, projectName: request.projectId ? snapshot.projects?.projects.find((p) => p.project_id === request.projectId)?.presentation.display_name ?? null : null } } : snapshot.hostRows,
  };
  const reply: PromoteResult = { ok: true, result: { cutexSessionId: id, name: request.name.trim(), projectId: request.projectId, revision, complete, error: complete ? null : "roster import pending" } };
  replies.set(`${id}\n${request.requestId}`, { body, reply });
  return { snapshot: next, reply };
}
