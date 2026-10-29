// Design 028 (c)/(d): an agent create's effort fallback (cutex `agent-create-effort-fallback`) and the
// owner abandon of an unfinished create (cutex `agent-create-abandon`,
// `POST /v2/agent-management/create-abandon {action_id, dry_run?}`).

export const EFFORT_FALLBACK_FEATURE = "agent-create-effort-fallback";
export const CREATE_ABANDON_FEATURE = "agent-create-abandon";

/** The profile default effort the model does not offer, and the level the agent uses. */
export interface EffortFallback {
  model: string;
  requested: string;
  used: string;
  reason: string;
}

export function effortFallbackOf(raw: unknown): EffortFallback | null {
  const r = (raw ?? null) as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const s = (k: string) => (typeof r[k] === "string" && (r[k] as string).length <= 200 ? (r[k] as string) : null);
  const model = s("model"), requested = s("requested"), used = s("used");
  return model && requested && used ? { model, requested, used, reason: s("reason") ?? "not_offered_by_model" } : null;
}

export interface CreateAbandonPlan {
  action_id: string;
  project_id: string;
  phase: string;
  reserved_name: string | null;
  reserved_cwd: string | null;
  durable_session: string | null;
  successor_session: string | null;
  native_thread: string | null;
  roster_entry: boolean;
}

export interface CreateAbandonResult {
  ok: boolean;
  /** Refusal: action_completed | action_in_progress | action_already_finished | not_a_create | action_not_found | … */
  code?: string;
  detail?: string;
  receipt?: { plan: CreateAbandonPlan; dry_run: boolean; replayed: boolean; removed: string[]; abandoned_at: string | null };
}

/** cutex action ids: `[A-Za-z0-9._:/@-]`, at most 256. */
export function validActionId(id: string): boolean {
  return /^[A-Za-z0-9._:/@-]{1,256}$/.test(id);
}
