// Kimi accounts (cutex capability `kimi-accounts`, r266; contract cutex docs/development/r266-kimi-profiles.md §3):
// the wire shapes of `/v2/kimi/accounts` and the request bodies the main process sends.
//
// A Kimi account is one private KIMI_CODE_HOME owned by cutex where the official `kimi login` (RFC 8628 device code)
// ran once. cutex drives the login itself and answers with the verification URL and user code; the desktop shows them,
// may open the URL in the owner's browser (main's http(s)-only `openExternal`), and polls the login until it ends. No
// token ever reaches the desktop: items say `credentialsPresent` / `status` only. The sanitizers rebuild every body
// from known fields.
import type { CutexRefusal } from "./ipc";

/** cutex capability of `/v2/kimi/accounts`. */
export const KIMI_ACCOUNTS_FEATURE = "kimi-accounts";
/** cutex capability: runtime `kimi` in variants / compatibility, `POST /v2/profiles {kind:"kimi"}`, `kimiAccount` fields. */
export const KIMI_RUNTIME_PROFILES_FEATURE = "kimi-runtime-profiles";
/** `ka-` + 1–32 lowercase letters / digits. */
export const KIMI_ACCOUNT_ID = /^ka-[a-z0-9]{1,32}$/;
/** `kl-` + 32 hex. */
export const KIMI_LOGIN_ID = /^kl-[0-9a-f]{32}$/;
export const MAX_KIMI_ACCOUNT_LABEL = 64;
export const KIMI_REGIONS = ["mainland-cn", "global"] as const;
export type KimiRegion = (typeof KIMI_REGIONS)[number];
/** Kimi reasoning efforts (contract §1; null = the model's default). */
export const KIMI_EFFORTS = ["off", "low", "medium", "high", "max"] as const;
export type KimiEffort = (typeof KIMI_EFFORTS)[number];

// ---------- wire ----------

export type KimiLoginState = "starting" | "pending" | "succeeded" | "failed" | "expired" | "denied" | "cancelled";

export interface KimiLogin {
  loginId: string;
  accountId: string;
  state: KimiLoginState | (string & {});
  /** https URL with the code embedded (verification_uri_complete); null until Kimi printed it. */
  verificationUri: string | null;
  userCode: string | null;
  expiresAt: string | null;
  /** Poll hint, seconds. */
  interval: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
}

export interface KimiAccountStatus {
  state: "loggedIn" | "loggedOut" | "revoked" | (string & {});
  loggedIn: boolean;
  /** Access-token expiry; agents refresh it themselves. */
  expiresAt: string | null;
  scope: string | null;
  checkedAt: string | null;
}

export interface KimiAccountModel {
  id: string;
  displayName?: string | null;
  inputModalities?: string[];
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string | null;
  isDefault?: boolean;
}

/** One account of `GET /v2/kimi/accounts` (no secret). */
export interface KimiAccount {
  id: string;
  label: string;
  kind: "subscription";
  region: KimiRegion | (string & {});
  home: string | null;
  createdAt: string | null;
  credentialsPresent: boolean;
  status: KimiAccountStatus | null;
  /** The pending / last finished login of this daemon run. */
  login: KimiLogin | null;
  /** The account's provisioned catalog (empty before the first login). */
  models: KimiAccountModel[];
  profiles: { id: string; name: string }[];
  sessions: { active: number; online: number; retired: number };
  removable: boolean;
}

export interface KimiAccountList {
  contractVersion: number;
  accounts: KimiAccount[];
}

export interface KimiAccountRemoved {
  id: string;
  removed: true;
  homeDeleted: boolean;
  keptHome: string | null;
}

export type KimiAccountResult = { ok: true; account: KimiAccount } | { ok: false; error: CutexRefusal };
export type KimiAccountRemoveResult = { ok: true; removed: KimiAccountRemoved } | { ok: false; error: CutexRefusal };
export type KimiLoginResult = { ok: true; login: KimiLogin } | { ok: false; error: CutexRefusal };

/** A login that will not change any more (stop polling). */
export function kimiLoginFinal(state: string | null | undefined): boolean {
  return state === "succeeded" || state === "failed" || state === "expired" || state === "denied" || state === "cancelled";
}

// ---------- request bodies (main validates what the renderer sends) ----------

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || [...v].length > max || /[\u0000-\u001f\u007f]/.test(v)) return undefined;
  return v;
}

export function kimiAccountId(id: unknown): string {
  if (typeof id !== "string" || !KIMI_ACCOUNT_ID.test(id)) throw new Error("bad Kimi account id");
  return id;
}

export function kimiLoginId(id: unknown): string {
  if (typeof id !== "string" || !KIMI_LOGIN_ID.test(id)) throw new Error("bad Kimi login id");
  return id;
}

/** A label cutex can store (1–64 visible characters), or null. */
export function kimiAccountLabel(value: unknown): string | null {
  return cleanText(value, MAX_KIMI_ACCOUNT_LABEL) ?? null;
}

/** `POST /v2/kimi/accounts {label, region?}`. */
export function kimiAccountCreateBody(input: unknown): { label: string; region?: KimiRegion } {
  const r = (input ?? {}) as Record<string, unknown>;
  const label = kimiAccountLabel(r.label);
  if (!label) throw new Error("bad Kimi account label");
  if (r.region === undefined) return { label };
  if (!(KIMI_REGIONS as readonly unknown[]).includes(r.region)) throw new Error("bad Kimi region");
  return { label, region: r.region as KimiRegion };
}

export function kimiAccountRenameBody(label: unknown): { label: string } {
  const clean = kimiAccountLabel(label);
  if (!clean) throw new Error("bad Kimi account label");
  return { label: clean };
}

/** A Kimi effort, or undefined. */
export function kimiEffortOf(value: string | null | undefined): KimiEffort | undefined {
  return (KIMI_EFFORTS as readonly string[]).includes(value ?? "") ? (value as KimiEffort) : undefined;
}

/**
 * The verification URL the desktop may open: https only (cutex already refuses anything else; a debug cutex may
 * answer http on loopback for the fake OAuth server). Null when it is not one.
 */
export function kimiVerificationUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    if (u.protocol === "https:") return u.href;
    if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]")) return u.href;
  } catch {
    // not a URL
  }
  return null;
}
