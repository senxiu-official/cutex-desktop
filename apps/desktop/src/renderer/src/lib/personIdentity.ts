// P2 person identity in the renderer (shared/personIdentity.ts): this desktop's public key /
// fingerprint and the per-host claim state, as main reports them (`identityState()` + the
// `identityState` event). The private key stays in main; export / import run main's dialogs.
// Fingerprints of other keys (a host's `tokenPersons`) are computed here (WebCrypto SHA-256).
import { useEffect, useState } from "react";
import { create } from "zustand";
import { base64UrlBytes, fingerprintOfDigest, type PersonIdentityView } from "../../../shared/personIdentity";
import { claimTransitions } from "./myAccess";
import { api, bridge } from "../bridge";

const EMPTY: PersonIdentityView = { publicKey: null, fingerprint: null, claims: {} };
const useIdentity = create<{ view: PersonIdentityView; loaded: boolean }>(() => ({ view: EMPTY, loaded: false }));

type ClaimToast = (hostId: string, outcome: "autoBound" | "ownerKeyAdded", userId: string | null) => void;
let claimToast: ClaimToast | null = null;
/** Who shows the claim toasts (main.tsx wires the store's notify; none in tests). */
export function onClaimTransition(show: ClaimToast): void {
  claimToast = show;
}

let started = false;
function start(): void {
  if (started) return;
  started = true;
  if (typeof bridge.on === "function")
    bridge.on("identityState", (view) => {
      const before = useIdentity.getState();
      // Only changes after the first read toast (not what was already true when the app started).
      if (before.loaded) for (const c of claimTransitions(before.view.claims, view.claims)) claimToast?.(c.hostId, c.outcome, c.userId);
      useIdentity.setState({ view, loaded: true });
    });
  if (typeof api.identityState !== "function") return;
  api.identityState().then(
    (view) => useIdentity.setState({ view, loaded: true }),
    () => useIdentity.setState({ loaded: true }),
  );
}

/** This desktop's person identity (null public key: unavailable, e.g. an older preload). */
export function usePersonIdentity(): PersonIdentityView & { loaded: boolean } {
  useEffect(start, []);
  const state = useIdentity();
  return { ...state.view, loaded: state.loaded };
}

/** Non-React: this desktop's public key right now (null until main answered). */
export function personPublicKeyNow(): string | null {
  start();
  return useIdentity.getState().view.publicKey;
}

const cache = new Map<string, string>();

/** First 16 hex of SHA-256 over a base64url public key (null: malformed / no WebCrypto). */
export async function fingerprintOf(publicKey: string): Promise<string | null> {
  const hit = cache.get(publicKey);
  if (hit) return hit;
  const bytes = base64UrlBytes(publicKey);
  if (!bytes || bytes.length !== 32 || !globalThis.crypto?.subtle) return null;
  const fp = fingerprintOfDigest(await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  cache.set(publicKey, fp);
  return fp;
}

/** The fingerprint of a key (`known`: a fingerprint the host already sent). */
export function useFingerprint(publicKey: string | null | undefined, known?: string | null): string | null {
  const [fp, setFp] = useState<string | null>(known ?? (publicKey ? (cache.get(publicKey) ?? null) : null));
  useEffect(() => {
    if (known) return setFp(known);
    if (!publicKey) return setFp(null);
    let live = true;
    void fingerprintOf(publicKey).then((v) => live && setFp(v));
    return () => {
      live = false;
    };
  }, [publicKey, known]);
  return fp;
}
