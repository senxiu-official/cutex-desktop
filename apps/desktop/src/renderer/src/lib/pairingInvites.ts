// Pairing v2 (QR invites; cutex contract rev 9.1) in the renderer: the capability check and the owner list of
// one host, polled while a device may be applying (components/settings/AddDevice.tsx). The list never carries a
// secret; only a created invite's `qr` does, and that stays in the panel that made it.
import { useCallback, useEffect, useRef, useState } from "react";
import { PAIRING_INVITE_FEATURES } from "@cutex-desktop/cutex-client";
import type { PairingInviteView } from "../../../shared/ipc";
import type { UsersRefusal } from "../../../shared/users";
import { apiFor } from "../bridge";

/** Poll fast while an invite is live or the panel is open (a phone applying shows within ~2 s), slowly otherwise. */
export const FAST_POLL_MS = 2000;
export const SLOW_POLL_MS = 15_000;

export function hasPairingInvites(features: ReadonlySet<string>): boolean {
  return PAIRING_INVITE_FEATURES.some((name) => features.has(name));
}

/** An invite a device still needs or just got a decision on (shown in the request list). */
export function isRequestRow(invite: PairingInviteView): boolean {
  return invite.request !== null && (invite.status === "pending" || invite.status === "approving" || invite.status === "approved");
}

/** An invite that may still change by itself (the poll stays fast). */
export function isLive(invite: PairingInviteView): boolean {
  return invite.status === "invited" || invite.status === "pending" || invite.status === "approving";
}

/** `123456` → `123 456`. */
export function spacedCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** Lower hex → groups of 4 (fingerprints in the request's details). */
export function groupedHex(hex: string): string {
  return hex.replace(/(.{4})(?=.)/g, "$1 ");
}

export interface PairingInvitesState {
  invites: PairingInviteView[] | null;
  error: UsersRefusal | null;
  reload(): Promise<PairingInviteView[] | null>;
}

/** One host's invite list; nothing is read while `enabled` is false (older host, or not owner-local). */
export function usePairingInvites(hostId: string, enabled: boolean, fast: boolean): PairingInvitesState {
  const [invites, setInvites] = useState<PairingInviteView[] | null>(null);
  const [error, setError] = useState<UsersRefusal | null>(null);
  const reads = useRef(0);
  const reload = useCallback(async () => {
    if (!enabled) return null;
    const request = ++reads.current;
    try {
      const r = await apiFor(hostId).pairingInvites();
      if (request !== reads.current) return null;
      if (r.ok) {
        setInvites(r.value);
        setError(null);
        return r.value;
      }
      setError(r.error);
    } catch (e) {
      if (request === reads.current) setError({ code: "unreachable", message: e instanceof Error ? e.message : String(e) });
    }
    return null;
  }, [hostId, enabled]);
  useEffect(() => {
    reads.current += 1;
    setInvites(null);
    setError(null);
  }, [hostId, enabled]);
  const live = invites?.some(isLive) ?? false;
  useEffect(() => {
    if (!enabled) return;
    void reload();
    const timer = setInterval(() => void reload(), fast || live ? FAST_POLL_MS : SLOW_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, fast, live, reload]);
  return { invites, error, reload };
}
