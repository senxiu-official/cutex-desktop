// users (docs/research/user-isolation-p1-20261014.md §5): a message a non-owner user sent is
// announced by cutex as `cutex/userInput/routeAccepted` with `actingUser: {id, name}` — management
// layer only, never shown to the agent. Kept per host + agent + clientUserMessageId (cute-codex echoes
// that id as the timeline user message's `clientId`) so the timeline can say 「由 X 发送」. Live events
// only: a message sent before this window opened shows no label.
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { create } from "zustand";
import { actingUserOf, type ActingUser } from "../../../shared/users";
import { bridge } from "../bridge";
import { onHostReset } from "./hostSwitch";

/** Kept per host (oldest dropped first). */
const MAX_PER_HOST = 500;

const useActing = create<Record<string, Record<string, ActingUser>>>(() => ({}));

const keyOf = (sessionId: string, clientUserMessageId: string) => `${sessionId}|${clientUserMessageId}`;

/** Record the acting user of a routeAccepted event of `hostId` (no-op for anything else). */
export function noteActingUser(hostId: string, envelope: EventEnvelope): void {
  const found = actingUserOf(envelope);
  if (!found) return;
  useActing.setState((s) => {
    const entries = Object.entries({ ...s[hostId], [keyOf(found.sessionId, found.clientUserMessageId)]: found.user });
    return { ...s, [hostId]: Object.fromEntries(entries.slice(-MAX_PER_HOST)) };
  });
}

let following = false;
/** Follow the host and session feeds once (first use). */
function follow(): void {
  if (following || typeof bridge?.on !== "function") return;
  following = true;
  bridge.on("hostEvent", ({ hostId, envelope }) => noteActingUser(hostId, envelope));
  bridge.on("sessionEvent", ({ hostId, envelope }) => noteActingUser(hostId, envelope));
  onHostReset((hostId) => useActing.setState((s) => (s[hostId] ? Object.fromEntries(Object.entries(s).filter(([id]) => id !== hostId)) : s), true));
}

/** Who sent this user message, when it was not the owner (null otherwise / unknown). */
export function useActingUser(hostId: string, sessionId: string, clientUserMessageId: string | undefined): ActingUser | null {
  follow();
  return useActing((s) => (clientUserMessageId ? s[hostId]?.[keyOf(sessionId, clientUserMessageId)] ?? null : null));
}

/** Start following at app start (main.tsx): events before the first user row renders count too. */
export function followActingUsers(): void {
  follow();
}
