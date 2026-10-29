// What the Kimi 账户 section shows for an account and its device-code login (docs/design/049). Pure, unit-tested.
import { kimiLoginFinal, kimiVerificationUrl, type KimiAccount, type KimiLogin } from "../../../../shared/kimiAccounts";

export type KimiAccountState = "loggedIn" | "loggedOut" | "revoked" | "loggingIn";
export type StateTone = "ok" | "warn" | "danger" | "muted";

export const STATE_TONE: Record<KimiAccountState, StateTone> = { loggedIn: "ok", loggedOut: "warn", revoked: "danger", loggingIn: "muted" };

/** A login still running (not in a final state). */
export function activeLogin(a: Pick<KimiAccount, "login">): KimiLogin | null {
  return a.login && !kimiLoginFinal(a.login.state) ? a.login : null;
}

export function kimiAccountState(a: Pick<KimiAccount, "credentialsPresent" | "status" | "login">): KimiAccountState {
  if (activeLogin(a)) return "loggingIn";
  if (a.credentialsPresent && a.status?.loggedIn !== false) return "loggedIn";
  return a.status?.state === "revoked" ? "revoked" : "loggedOut";
}

/** Accounts that need the owner (not logged in, or logged out by cutex / Kimi). */
export function accountsNeedingLogin(list: readonly KimiAccount[]): number {
  return list.filter((a) => {
    const s = kimiAccountState(a);
    return s === "loggedOut" || s === "revoked";
  }).length;
}

export type LoginPhase = "starting" | "waiting" | "succeeded" | "failed" | "expired" | "denied" | "cancelled";

export interface LoginView {
  phase: LoginPhase;
  /** The URL to open (https; loopback http only from a debug cutex), or null until Kimi printed it. */
  url: string | null;
  code: string | null;
  /** Seconds until the code expires (null: unknown). */
  remaining: number | null;
  /** cutex's error of a failed login (code + message, never a token). */
  error: { code: string; message: string } | null;
}

/** The login as the panel shows it. `now`: epoch seconds. */
export function loginView(login: KimiLogin, now: number): LoginView {
  const FINAL: readonly LoginPhase[] = ["succeeded", "failed", "expired", "denied", "cancelled"];
  const state = String(login.state);
  const phase: LoginPhase = state === "starting" ? "starting" : FINAL.includes(state as LoginPhase) ? (state as LoginPhase) : "waiting";
  const expires = login.expiresAt ? Date.parse(login.expiresAt) / 1000 : NaN;
  const remaining = Number.isFinite(expires) ? Math.max(0, Math.round(expires - now)) : null;
  return { phase, url: kimiVerificationUrl(login.verificationUri), code: login.userCode?.trim() || null, remaining, error: login.error };
}

/** Next poll after `login` (cutex's `interval` hint, 2–30 s; 1 s while Kimi has not printed the code yet). */
export function nextPollMs(login: Pick<KimiLogin, "state" | "interval">): number | null {
  if (kimiLoginFinal(login.state)) return null;
  if (login.state === "starting") return 1000;
  const s = typeof login.interval === "number" && Number.isFinite(login.interval) ? login.interval : 5;
  return Math.min(30, Math.max(2, s)) * 1000;
}

/** "mm:ss" of a countdown. */
export function countdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Accounts in a stable order: logged-in first, then by label. */
export function sortKimiAccounts(list: readonly KimiAccount[]): KimiAccount[] {
  const rank = (a: KimiAccount) => (kimiAccountState(a) === "loggedIn" ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}
