// `/v2/sessions?includeHidden=true` (owner): which hidden rows the desktop keeps. A persistent agent
// hidden only by the retired IM flag (`expose_to_im: false`, e.g. created by another agent) is shown;
// hidden local-only sessions (old CLI sessions, `cutex session unmanage`) stay out, as before.
import type { SessionResource } from "@cutex-desktop/protocol";

export function shownSessions<T extends Pick<SessionResource, "visible" | "registrationClass">>(sessions: readonly T[]): T[] {
  return sessions.filter((s) => s.visible !== false || s.registrationClass === "persistent");
}
