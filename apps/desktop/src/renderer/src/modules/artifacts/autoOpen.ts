// Auto-open of an agent's live publish (docs/research/agent-side-display-20261013.md §3.1, §3.2 B, §4
// quick win 2; pure, tested in test/artifactAutoOpen.test.ts). Fed by live events of this app run:
// - a host with cutex capability `artifact-show`: only `cutex/artifact/showRequested` (the agent asked
//   with `artifact_publish {show: true}`); its plain `cutex/artifact/published` events open nothing;
// - an older host: every agent `cutex/artifact/published` (the pre-r228 behaviour).
//
// Rules, in order:
// - only an explicit agent publish (not the owner's, not an auto capture), and only a live event
//   (received after this run started, not older than a couple of minutes: no history replays);
// - setting 不提示 → nothing; only the agent the owner is looking at (others keep their timeline card);
// - setting 只提示 → a card in the conversation with 「查看」, nothing opens;
// - the owner closed the right column in this conversation in the last 10 min, or is typing (composer
//   focused with a draft), or the file is not visual → a background tab (page button flashes) + card;
// - otherwise reveal `af-…@latest` on the right (column opens, tab shown); never focus: the caret stays.
// A republish of the same artifact reuses the same `@latest` tab, which follows the new version in place.
import { ARTIFACT_ID, ARTIFACT_PUBLISHED_EVENT, ARTIFACT_SHOW_FEATURE, ARTIFACT_SHOW_REQUESTED_EVENT, type ArtifactKind } from "../../../../shared/artifactStore";
import { isLiveEvent, receivedAtOf } from "../../lib/liveEvents";
import { previewKind } from "./model";

export type AutoOpenSetting = "open" | "notify" | "off";
export const AUTO_OPEN_SETTINGS: readonly AutoOpenSetting[] = ["open", "notify", "off"];
export const DEFAULT_AUTO_OPEN: AutoOpenSetting = "open";
export const AUTO_OPEN_PREF = "autoOpen";
/** An explicit close of the right column keeps auto-opens in the background this long. */
export const CLOSED_QUIET_MS = 10 * 60_000;

export function autoOpenSetting(raw: unknown): AutoOpenSetting {
  return (AUTO_OPEN_SETTINGS as readonly unknown[]).includes(raw) ? (raw as AutoOpenSetting) : DEFAULT_AUTO_OPEN;
}

export interface LivePublish {
  hostId: string;
  eventId: string;
  artifactId: string;
  version: number;
  name: string;
  kind: ArtifactKind | string;
  /** The producing agent; null = owner / auto capture. */
  sessionId: string | null;
  agentName: string | null;
  /** ms; null = unknown. */
  receivedAt: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A `cutex/artifact/published` host event → what auto-open needs (null = malformed / not this event). */
export function parsePublished(hostId: string, envelope: unknown, method: string): LivePublish | null {
  if (!isRecord(envelope) || !isRecord(envelope.cutex) || envelope.cutex.method !== method) return null;
  const p = envelope.cutex.params;
  if (!isRecord(p) || typeof p.artifactId !== "string" || !ARTIFACT_ID.test(p.artifactId)) return null;
  if (typeof p.version !== "number" || !Number.isSafeInteger(p.version) || p.version < 1 || typeof p.name !== "string") return null;
  const producer = isRecord(p.producer) ? p.producer : {};
  const agent = producer.kind === "agent" && typeof producer.sessionId === "string" && producer.sessionId ? producer.sessionId : null;
  return {
    hostId,
    eventId: typeof envelope.eventId === "string" ? envelope.eventId : `${p.artifactId}@${p.version}`,
    artifactId: p.artifactId,
    version: p.version,
    name: p.name.slice(0, 200),
    kind: typeof p.kind === "string" ? p.kind : "other",
    sessionId: agent,
    agentName: agent && typeof producer.displayName === "string" && producer.displayName.trim() ? producer.displayName.trim().slice(0, 100) : null,
    receivedAt: receivedAtOf(envelope),
  };
}

/** A `cutex/artifact/showRequested` host event (capability `artifact-show`) → what auto-open needs. */
export function parseShowRequested(hostId: string, envelope: unknown): LivePublish | null {
  if (!isRecord(envelope) || !isRecord(envelope.cutex) || envelope.cutex.method !== ARTIFACT_SHOW_REQUESTED_EVENT) return null;
  const p = envelope.cutex.params;
  if (!isRecord(p) || typeof p.artifactId !== "string" || !ARTIFACT_ID.test(p.artifactId)) return null;
  if (typeof p.version !== "number" || !Number.isSafeInteger(p.version) || p.version < 1 || typeof p.name !== "string") return null;
  if (typeof p.cutexSessionId !== "string" || !p.cutexSessionId) return null;
  return {
    // The envelope's host (the connection the event came on); `params.hostId` is cutex's machine name.
    hostId,
    eventId: typeof envelope.eventId === "string" ? envelope.eventId : `show:${p.artifactId}@${p.version}`,
    artifactId: p.artifactId,
    version: p.version,
    name: p.name.slice(0, 200),
    kind: typeof p.kind === "string" ? p.kind : "other",
    sessionId: p.cutexSessionId,
    agentName: typeof p.displayName === "string" && p.displayName.trim() ? p.displayName.trim().slice(0, 100) : null,
    receivedAt: receivedAtOf(envelope),
  };
}

/**
 * The live publish a host event asks auto-open to consider, by the host's capabilities: with
 * `artifact-show` only an explicit show request, otherwise every publish (null = nothing to consider).
 */
export function autoOpenEvent(hostId: string, envelope: unknown, features: ReadonlySet<string>): LivePublish | null {
  return features.has(ARTIFACT_SHOW_FEATURE) ? parseShowRequested(hostId, envelope) : parsePublished(hostId, envelope, ARTIFACT_PUBLISHED_EVENT);
}

/** Something to look at: a page, a picture or a figure (a report / table opens in the background). */
export function isVisual(name: string, kind: string): boolean {
  const preview = previewKind("", name);
  return preview === "html" || preview === "image" || kind === "figure" || /\.(svg|png|jpe?g|gif|webp)$/i.test(name);
}

export interface AutoOpenContext {
  setting: AutoOpenSetting;
  now: number;
  startedAt: number;
  /** The agent whose conversation is on screen (null: a page such as 设置 is open, or no agent). */
  viewing: { hostId: string; sessionId: string } | null;
  /** The composer has focus and a non-empty draft. */
  typing: boolean;
  /** When the owner last closed the right column in this agent's conversation (ms), if they did. */
  closedAt: number | null;
}

export type AutoOpenDecision =
  | { action: "none"; reason: "replay" | "not-agent" | "off" | "other-agent" }
  | { action: "notify" }
  | { action: "background"; why: "closed" | "typing" | "not-visual" }
  | { action: "reveal" };

export function decideAutoOpen(ev: Pick<LivePublish, "hostId" | "sessionId" | "name" | "kind" | "receivedAt">, ctx: AutoOpenContext): AutoOpenDecision {
  if (!ev.sessionId) return { action: "none", reason: "not-agent" };
  if (!isLiveEvent(ev.receivedAt, ctx.now, ctx.startedAt)) return { action: "none", reason: "replay" };
  if (ctx.setting === "off") return { action: "none", reason: "off" };
  if (!ctx.viewing || ctx.viewing.hostId !== ev.hostId || ctx.viewing.sessionId !== ev.sessionId) return { action: "none", reason: "other-agent" };
  if (ctx.setting === "notify") return { action: "notify" };
  if (ctx.closedAt !== null && ctx.now - ctx.closedAt < CLOSED_QUIET_MS) return { action: "background", why: "closed" };
  if (ctx.typing) return { action: "background", why: "typing" };
  if (!isVisual(ev.name, ev.kind)) return { action: "background", why: "not-visual" };
  return { action: "reveal" };
}
