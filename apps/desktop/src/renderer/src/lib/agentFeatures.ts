// Per-agent feature gating (cutex `claude-runtime-features`). A Claude agent's session resource has
// `native.schema.protocol === "claude-app-server-subset"` and `native.schema.capabilities.features`:
// the Codex v2 surfaces its adapter serves (false = unsupported, null / absent = unknown). Only an
// explicit `false` hides UI, except sideChat which requires Claude to declare support. Codex agents
// and other unknown features keep today's behaviour.
// Pure (no React, no store) so it is unit-tested.
import { CLAUDE_MAX_IMAGE_BYTES, MAX_IMAGE_BYTES } from "../../../shared/ipc";
import { parseUnsupported } from "../../../shared/unsupported";

export const CLAUDE_PROTOCOL = "claude-app-server-subset";
export const CLAUDE_FEATURES_CAPABILITY = "claude-runtime-features";

/** Feature names of the adapter's features.json the desktop gates on. */
export type AgentFeature =
  | "turnSteer"
  | "goals"
  | "review"
  | "skillInput"
  | "memoryMode"
  | "backgroundTerminals"
  | "fork"
  | "historyRevert"
  | "imageInput"
  | "planMode"
  | "compact"
  | "threadSearch"
  | "sideChat";
// Side needs an explicit Claude capability: its ephemeral fork is not part of the adapter subset.

export interface AgentFeatures {
  runtime: "codex" | "claude";
  /** The adapter's feature map; null = unknown (Codex agent, or an adapter without features.json). */
  map: Record<string, unknown> | null;
}

export const CODEX_FEATURES: AgentFeatures = { runtime: "codex", map: null };

type SchemaLike = { protocol?: unknown; capabilities?: unknown } | null | undefined;

/** Features of an agent from its session resource (`native.schema`). */
export function agentFeaturesOf(resource: { native?: { schema?: SchemaLike } | null } | null | undefined): AgentFeatures {
  const schema = resource?.native?.schema;
  if (!schema || schema.protocol !== CLAUDE_PROTOCOL) return CODEX_FEATURES;
  const features = (schema.capabilities as { features?: unknown } | null | undefined)?.features;
  return { runtime: "claude", map: features && typeof features === "object" && !Array.isArray(features) ? (features as Record<string, unknown>) : null };
}

/** Unsupported by the adapter; Claude must explicitly opt into ephemeral side chats. */
export function lacks(f: AgentFeatures, feature: AgentFeature): boolean {
  if (feature === "sideChat" && f.runtime === "claude") return f.map?.sideChat !== true;
  return f.map?.[feature] === false;
}

/** cutex `claude-session-skills`: `GET /v2/sessions/{id}/skills` lists a Claude agent's managed skills. */
export const CLAUDE_SESSION_SKILLS_CAPABILITY = "claude-session-skills";
/** cutex `claude-rewind-files`: `cutex/session/history/revert` takes `rewindFiles` for Claude agents. */
export const CLAUDE_REWIND_FILES_CAPABILITY = "claude-rewind-files";

type HostFeatures = { has(feature: string): boolean };

/** True only when a Claude adapter declares `feature` (absent / unknown = no). */
function declares(f: AgentFeatures, feature: string): boolean {
  return f.runtime === "claude" && f.map?.[feature] === true;
}

/**
 * Where the composer's skill picker reads skills for this agent: Codex agents the host's Codex catalog
 * (`skills/list`), Claude agents their own managed catalog when cutex lists it and the adapter loads
 * managed skills, otherwise none (cutex hides `skillInput` for Claude: the Codex catalog's paths would
 * be refused).
 */
export function skillSource(f: AgentFeatures, host: HostFeatures): "codex" | "claude" | null {
  if (f.runtime !== "claude") return lacks(f, "skillInput") ? null : "codex";
  return declares(f, "managedSkills") && host.has(CLAUDE_SESSION_SKILLS_CAPABILITY) ? "claude" : null;
}

/** 回退 can also restore files (Claude Code checkpoints): Claude adapter `fileRewind` + cutex `claude-rewind-files`. */
export function canRewindFiles(f: AgentFeatures, host: HostFeatures): boolean {
  return declares(f, "fileRewind") && host.has(CLAUDE_REWIND_FILES_CAPABILITY);
}

/** Claude Code fast mode through the Fast service tier (adapter `fastMode`; it keeps the choice itself). */
export function claudeFastMode(f: AgentFeatures): boolean {
  return declares(f, "fastMode");
}

/**
 * A Claude agent's foreground subagents (`claude:<session>:task:<id>`) open as read-only transcripts
 * (adapter `subagentTranscripts`: `thread/read` answers them). Older adapters: status rows only.
 */
export function opensClaudeSubagents(f: AgentFeatures): boolean {
  return declares(f, "subagentTranscripts");
}

/** cutex `claude-subagent-transcripts`: the adapter's live transcript frames reach the stream (else re-read). */
export const CLAUDE_SUBAGENT_TRANSCRIPTS_CAPABILITY = "claude-subagent-transcripts";

/** Claude adapter reports the model that actually answered (`claude/model/status`, `claude/model/observed`). */
export function observesModel(f: AgentFeatures): boolean {
  return declares(f, "modelObservation");
}

/** Per-image byte limit for this agent's composer. */
export function maxImageBytes(f: AgentFeatures): number {
  return f.runtime === "claude" ? CLAUDE_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES;
}

/** Strategy for a busy steer: an agent without same-turn steering queues instead (cutex does too). */
export function steerAction<A extends string>(action: A | "steer", f: AgentFeatures): A | "steer" | "queue" {
  return action === "steer" && lacks(f, "turnSteer") ? "queue" : action;
}

/**
 * Error text for the user. A "not available for this agent" error (main's unsupported marker)
 * becomes `notice(feature)` and is flagged so it can be shown as information, not as a failure.
 */
export function describeError(e: unknown, notice: (feature: string) => string): { text: string; unsupported: boolean } {
  const message = e instanceof Error ? e.message : String(e);
  const feature = parseUnsupported(message);
  return feature === null ? { text: message, unsupported: false } : { text: notice(feature), unsupported: true };
}
