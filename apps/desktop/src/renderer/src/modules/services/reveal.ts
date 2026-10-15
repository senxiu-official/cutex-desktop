// cutex `cutex/services/revealRequested` (service_register with reveal: true; cutex rate-limits it,
// services/reveal.rs): an agent asks the owner to look at a service. Pure parsing (tested in
// test/serviceReveal.test.ts); live.ts turns it into a card in that agent's conversation.
import { isLiveEvent, receivedAtOf } from "../../lib/liveEvents";

export const SERVICE_REVEAL_EVENT = "cutex/services/revealRequested";
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface ServiceReveal {
  /** The desktop's host id (the envelope's connection), not cutex's host name in the params. */
  hostId: string;
  eventId: string;
  slug: string;
  /** Always starts with "/"; "/" when cutex's path is missing or unusable. */
  path: string;
  /** The agent that owns the service (its conversation gets the card); null = none. */
  sessionId: string | null;
  receivedAt: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A path the `cutex:service/<slug><path>` link form accepts (else "/"). */
export function revealPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.length > 1000 || CONTROL.test(raw) || raw.includes("\\") || /\s|#/.test(raw)) return "/";
  try {
    decodeURIComponent(raw);
  } catch {
    return "/";
  }
  return raw;
}

export function parseServiceReveal(hostId: string, envelope: unknown): ServiceReveal | null {
  if (!isRecord(envelope) || !isRecord(envelope.cutex) || envelope.cutex.method !== SERVICE_REVEAL_EVENT) return null;
  const p = envelope.cutex.params;
  if (!isRecord(p) || typeof p.slug !== "string" || !SLUG.test(p.slug)) return null;
  const owner = typeof p.ownerCutexSessionId === "string" && p.ownerCutexSessionId && p.ownerCutexSessionId.length <= 200 ? p.ownerCutexSessionId : null;
  return {
    hostId,
    eventId: typeof envelope.eventId === "string" ? envelope.eventId : `${p.slug}@${String(p.requestedAt)}`,
    slug: p.slug,
    path: revealPath(p.path),
    sessionId: owner,
    receivedAt: receivedAtOf(envelope as { receivedAt?: unknown }),
  };
}

/** Owner browser tab target: `cutex:service/<slug><path>` (the browser module resolves it per host). */
export function serviceLink(r: Pick<ServiceReveal, "slug" | "path">): string {
  return `cutex:service/${r.slug}${r.path}`;
}

export function revealIsLive(r: Pick<ServiceReveal, "receivedAt">, now: number, startedAt: number): boolean {
  return isLiveEvent(r.receivedAt, now, startedAt);
}
