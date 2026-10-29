import type { CutexClient } from "@cutex-desktop/cutex-client";
import type { SessionForkPreview, SessionForkPreviewRequest, SessionForkRequest, SessionForkResult } from "../shared/sessionFork";
import { readForkWarnings } from "../shared/sessionFork";
export function forkPreview(client: Pick<CutexClient, "request">, sessionId: string, input: SessionForkPreviewRequest = {}): Promise<SessionForkPreview> {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(sessionId)) throw new Error("invalid fork source");
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !["afterTurnId", "profile"].includes(k))) throw new Error("invalid fork preview request");
  const query: Record<string, string> = {};
  for (const key of ["afterTurnId", "profile"] as const) {
    const value = input[key];
    if (key === "afterTurnId" && value == null) continue;
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 500 || /[\p{Cc}]/u.test(value)) throw new Error("invalid fork preview value");
    query[key] = value;
  }
  return client.request("GET", `/v2/sessions/${encodeURIComponent(sessionId)}/fork-preview`, { query });
}

export function forkRequestParams(request: SessionForkRequest): Record<string, unknown> {
  const params: Record<string, unknown> = { afterTurnId: request.afterTurnId ?? null };
  if (request.name?.trim()) params.name = request.name.trim();
  if (request.profile !== undefined) {
    if (typeof request.profile !== "string" || !request.profile.trim() || request.profile !== request.profile.trim() || request.profile.length > 200 || /[\p{Cc}]/u.test(request.profile)) throw new Error("invalid fork profile");
    params.profile = request.profile;
  }
  return params;
}
export function forkResult(value: unknown): SessionForkResult {
  const r = value as Partial<SessionForkResult> & { newCutexSessionId?: unknown; session?: { cutexSessionId?: unknown } } | null;
  const id = r?.newCutexSessionId ?? r?.session?.cutexSessionId ?? r?.cutexSessionId;
  if (typeof id !== "string" || !id) throw new Error("cutex/session/fork returned no session");
  return { cutexSessionId: id,
    ...(r?.historyBytes === null || (typeof r?.historyBytes === "number" && Number.isSafeInteger(r.historyBytes) && r.historyBytes >= 0) ? { historyBytes: r.historyBytes } : {}),
    ...(typeof r?.coldCache === "boolean" ? { coldCache: r.coldCache } : {}),
    ...(typeof r?.profile === "string" || r?.profile === null ? { profile: r.profile } : {}),
    ...(typeof r?.sourceProfile === "string" || r?.sourceProfile === null ? { sourceProfile: r.sourceProfile } : {}),
    ...(typeof r?.forkBoundaryNote === "string" ? { forkBoundaryNote: r.forkBoundaryNote } : {}),
    ...(Array.isArray(r?.warnings) ? { warnings: readForkWarnings(r.warnings) } : {}),
  };
}
