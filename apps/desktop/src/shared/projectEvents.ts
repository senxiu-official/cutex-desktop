// Project 「动态」 over IPC (cutex `project-events`, docs/design/022 §「桌面接口约定」): the shapes main
// passes to the renderer. Rows / pages / the running-now list are cutex's own (cutex-client types).
import type { ProjectEvent } from "@cutex-desktop/cutex-client";

export type { BackgroundAgent, BackgroundItem, BackgroundStop, ProjectBackground, ProjectEvent, ProjectEventPage } from "@cutex-desktop/cutex-client";
export { projectNextCursor } from "@cutex-desktop/cutex-client";

export const PROJECT_EVENTS_FEATURE = "project-events";
/** Host-feed hint `{projectId, cursor}` (≤ once per project every 5 s). */
export const PROJECT_EVENTS_APPENDED = "cutex/projectEvents/appended";

/**
 * A read's outcome. Codes: `cursor_expired` (409: drop the cursor, read the newest page), `project_not_found`
 * (404: no such project or not visible), `project_events_unavailable` (503: try later), `invalid_request`
 * (400), `unsupported` (the host has no such route), else cutex's code / `unreachable`.
 */
export type ProjectEventsResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export interface ProjectEventsQuery {
  before?: string | null;
  after?: string | null;
  limit?: number;
  /** `kinds=` prefixes (turn, ask, subagent, background, approval, artifact, workflow, ownerNotify, job, runtime, member, journal). */
  kinds?: string[];
  sessionId?: string | null;
  streamId?: string | null;
}

export interface ProjectEventsWatch {
  kinds?: string[];
  sessionId?: string | null;
  /** Deliver rows after this cursor (the first page's `cursor`); null = only future rows. */
  after: string | null;
  streamId?: string | null;
}

/** Live rows of one watch (main `watchProjectEvents`), oldest first. */
export type ProjectEventsMessage =
  | { watchId: string; kind: "event"; event: ProjectEvent }
  | { watchId: string; kind: "status"; status: "connecting" | "live" | "retrying" }
  /** 409: the cursor expired or the journal was recreated; the watch ended — read the newest page again. */
  | { watchId: string; kind: "reset" }
  /** A refusal retrying won't fix (404 / 400 / 401 / 403); the watch ended. */
  | { watchId: string; kind: "failed"; code: string; message: string };
