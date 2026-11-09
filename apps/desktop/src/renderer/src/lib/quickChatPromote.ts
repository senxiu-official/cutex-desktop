// 转为智能体… (components/QuickChatPromoteDialog): a quick chat becomes an agent, standalone or in a project, with
// the same session, thread and history (cutex quick-chat-promote-v1, shared/quickChatPromote). Owner-only, on a
// host with the capability, for an active quick chat. cutex refuses while a runtime is bound, so a running chat is
// stopped first (the dialog asks). An uncertain answer (no reply, 503) and `complete: false` (promoted, roster /
// project step unfinished) are only ever followed by the identical request; a definitive refusal ends it. On
// success the sidebar is read again, so the conversation shows as an agent in place (same host + session ID).
import type { SessionResource } from "@cutex-desktop/protocol";
import { formalNameProblem } from "../../../shared/agentRename";
import { QUICK_CHAT_PROMOTE_FEATURE, type PromoteDone, type PromoteError, type PromoteRequest } from "../../../shared/quickChatPromote";
import { featuresOf, hostApi, sidebarOf, useApp } from "../store";
import { isOwnerFeatures } from "../../../shared/users";
import { isQuickChat } from "./sidebar";

/** Offered for an active quick chat on a host with the capability, to the owner only. */
export function promoteOffered(features: ReadonlySet<string>, session: SessionResource, host: Parameters<typeof isQuickChat>[1]): boolean {
  return features.has(QUICK_CHAT_PROMOTE_FEATURE) && isOwnerFeatures(features) && session.lifecycle !== "retired" && isQuickChat(session, host);
}

export function promoteOfferedOn(hostId: string, session: SessionResource): boolean {
  const app = useApp.getState();
  return promoteOffered(featuresOf(app, hostId), session, sidebarOf(app, hostId)?.hostRows?.[session.cutexSessionId]);
}

/** A runtime is bound (cutex: quick_chat_running): it has to stop first. */
export function chatRunning(session: Pick<SessionResource, "runtime">): boolean {
  return session.runtime.status === "online" || session.runtime.status === "starting";
}

export function newPromoteRequest(session: Pick<SessionResource, "revision">, name: string, projectId: string | null): PromoteRequest {
  return { requestId: `promote-${crypto.randomUUID()}`, expectedRevision: session.revision, name: name.trim(), projectId };
}

/**
 * Local check of the name before sending; null = send it (cutex has the final word: rules, reserved names,
 * host-wide uniqueness). `taken`: another agent on this host already has it as its own name.
 */
export function promoteNameProblem(raw: string, takenNames: ReadonlySet<string>): "empty" | "tooLong" | "control" | "taken" | null {
  const problem = formalNameProblem(raw, "\u0000");
  if (problem === "unchanged") return null;
  if (problem) return problem;
  return takenNames.has(raw.trim().toLocaleLowerCase()) ? "taken" : null;
}

/** Own names in use on the host (lower-cased), for the local hint. */
export function takenNamesOn(hostId: string, except: string): Set<string> {
  const sidebar = sidebarOf(useApp.getState(), hostId);
  const names = new Set<string>();
  for (const s of [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])])
    if (s.cutexSessionId !== except && s.formalAgentName?.trim()) names.add(s.formalAgentName.trim().toLocaleLowerCase());
  return names;
}

export type PromoteOutcome =
  | { ok: true; result: PromoteDone }
  /** `request`: what 重试 sends (the identical one when `error.retrySame`, else a new request is needed). */
  | { ok: false; error: PromoteError; request: PromoteRequest; incomplete?: PromoteDone };

const INCOMPLETE_RETRIES = 2;
const RETRY_DELAY_MS = 800;

/**
 * Sends `request`; `complete: false` is followed by the identical request a couple of times before it is
 * reported (cutex also resumes it on its next start). The sidebar is read again either way.
 */
export async function sendPromote(hostId: string, id: string, request: PromoteRequest, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<PromoteOutcome> {
  const api = hostApi(hostId);
  let incomplete: PromoteDone | undefined;
  try {
    for (let attempt = 0; ; attempt++) {
      const result = await api.promoteQuickChat(id, request);
      if (!result.ok) return { ok: false, error: result.error, request, ...(incomplete ? { incomplete } : {}) };
      if (result.result.complete) return { ok: true, result: result.result };
      incomplete = result.result;
      if (attempt >= INCOMPLETE_RETRIES)
        return { ok: false, error: { code: "incomplete", message: result.result.error ?? "", retrySame: true }, request, incomplete };
      await wait(RETRY_DELAY_MS * (attempt + 1));
    }
  } finally {
    await useApp.getState().refreshHostSidebar(hostId).catch(() => undefined);
  }
}

/** Stops the chat's runtime (the menu's 停止运行时 call), then waits for the sidebar to show it stopped. */
export async function stopChat(hostId: string, session: SessionResource): Promise<void> {
  const app = useApp.getState();
  await app.sessionAction(session.cutexSessionId, "cutex/runtime/offline", { expectedRuntimeGeneration: session.runtime.runtimeGeneration }, hostId);
  await app.refreshHostSidebar(hostId).catch(() => undefined);
}

export function sessionOn(hostId: string, id: string): SessionResource | null {
  const sidebar = sidebarOf(useApp.getState(), hostId);
  return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === id) ?? null;
}
