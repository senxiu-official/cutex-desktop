import type { HostClaudeRuntime, SessionLifecycle } from "@cutex-desktop/protocol";

/** Owner-only transport. Canonical revisions are NOT SessionResource revisions. */
export const SESSION_DELTAS_FEATURE = "session-deltas-v1";
/** Authoritative host metadata + exact-ID host row projection, additive to session-deltas-v1. */
export const SESSION_DELTAS_HOST_FEATURE = "session-deltas-host-v1";
export interface SessionPageQuery {
  lifecycle?: SessionLifecycle;
  cursor?: string;
  limit?: number;
  maxBytes?: number;
}
export interface SessionCatalogPage {
  sessions: { cutexSessionId: string; revision: number }[];
  nextCursor: string | null;
  changeCursor: string | null;
  oversizeFirst: boolean;
  claudeRuntime?: HostClaudeRuntime;
  hostId?: string;
}
export interface SessionResync {
  resyncRequired: true;
  reason: string;
  watermark?: number;
  hostId?: string;
  claudeRuntime?: HostClaudeRuntime;
}
export interface SessionChangePage {
  resyncRequired: false;
  changes: { seq: number; key: string; deleted: boolean; revision: number }[];
  nextCursor: string;
  watermark: number;
  more: boolean;
  oversizeFirst: boolean;
  claudeRuntime?: HostClaudeRuntime;
  hostId?: string;
}
