// 浏览器身份 — main-side contract (package 0). Each work package implements one service; the channel
// (./channel.ts) routes renderer requests to them and refuses an op whose service is not installed yet with
// `unsupported_operation`. Design: artifact browser-profiles-design v3 §5, §9–§12.
//
//   A  (identities, partitions, clearing)     → BrowserIdentityService
//   C1 (history store)                         → BrowserHistoryService
//   E1 (capture on submit, fill)               → BrowserPasswordService, on top of a BrowserPasswordStore
//   notify-ui (secure store)                   → BrowserPasswordStore
import type { BrowserWindow, Session } from "electron";
import type {
  BrowserClearDataRequest, BrowserHistoryDelete, BrowserHistoryEntry, BrowserHistoryPage, BrowserHistoryQuery, BrowserIdentityColor,
  BrowserIdentityEvent, BrowserIdentityPrefs, BrowserIdentityState, BrowserIdentityStorage, BrowserIdentityView, BrowserPasswordPromptChoice,
  BrowserPasswordStoreStatus, BrowserSavedLoginView, BrowserTopSite, BrowserIdentitySyncState,
} from "../../../shared/browserIdentity";

export type EmitBrowserIdentityEvent = (event: BrowserIdentityEvent) => void;

/** Package A. Identity list (`userData/browser-identities.json`), partitions, cleanup, storage, clearing. */
export interface BrowserIdentityService {
  state(): BrowserIdentityState;
  create(name: string, color: BrowserIdentityColor, initial?: string): Promise<BrowserIdentityView>;
  /** Refuses with `revision_conflict` when expectedRevision is not the current one. */
  update(id: string, expectedRevision: number, change: { name?: string; color?: BrowserIdentityColor; initial?: string }): Promise<BrowserIdentityView>;
  setCurrent(id: string): Promise<BrowserIdentityState>;
  signOut(id: string): Promise<void>;
  /** signOut on one configured host (`stale_connection` otherwise). */
  signOutHost(id: string, hostId: string): Promise<void>;
  /** Removes the partition directory of a host no longer configured (`browser_identity_unavailable` if there is none). */
  clearLeftover(id: string, hostId: string): Promise<void>;
  /** Refuses the default identity (`default_identity`). Also asks history and passwords to drop the identity. */
  remove(id: string): Promise<void>;
  storage(id: string): Promise<BrowserIdentityStorage[]>;
  signedInSites(id: string, hostId: string): Promise<string[]>;
  /** siteData / cache (session.clearData by type + origins); history is routed to BrowserHistoryService by the channel. */
  clearData(request: BrowserClearDataRequest): Promise<void>;
  prefs(patch?: Partial<BrowserIdentityPrefs>): Promise<BrowserIdentityPrefs>;
  /** Partition of (identity, host); throws for an unknown identity (a deleted identity never falls back). */
  partition(identityId: string, hostId: string): string;
  /** Reverse lookup used by attach / network admission; undefined for a non-identity partition (the agent pool). */
  identityOfPartition(partition: string): { identityId: string; hostId: string } | undefined;
}

/** Package C1. One store per (identity, host): `userData/browser-history/<identityId>/<hostId>.sqlite` (node:sqlite). */
export interface BrowserHistoryService {
  /** Owner main-frame http/https commits only; the caller filters agent pools, services and local addresses. */
  record(entry: Omit<BrowserHistoryEntry, "id">): void;
  /** Title changes after the commit (same tab, same URL). */
  retitle(identityId: string, hostId: string, url: string, title: string): void;
  query(query: BrowserHistoryQuery): Promise<BrowserHistoryPage>;
  topSites(identityId: string, hostId: string, limit: number): Promise<BrowserTopSite[]>;
  remove(target: BrowserHistoryDelete): Promise<void>;
  /** Clear for a request with `history` among its types (range, origins, one host or all). */
  clear(request: BrowserClearDataRequest): Promise<void>;
  /** Identity deleted / host removed: drop the files. */
  dropIdentity(identityId: string): Promise<void>;
  dropHost(hostId: string, identityId?: string): Promise<void>;
}

/** A secret as main holds it: zeroed by the holder after use; never serialised to the renderer except passwordReveal. */
export type SecretBuffer = Buffer;

export interface SavedLogin extends BrowserSavedLoginView {
  /** Bumps on every change (sync). */
  revision: number;
}

/**
 * notify-ui: the secure store (Windows Credential Manager + a key only Windows Hello unlocks; safeStorage elsewhere).
 * Passwords are per identity, not per host. Tests and E2E use the dev-only in-memory store: no OS dialog (Hello,
 * credential prompt, WebAuthn) may appear in a test run. Refusals: auth_cancelled | auth_unavailable | key_lost.
 */
export interface BrowserPasswordStore {
  readonly kind: "secure" | "devMemory";
  list(identityId: string, origin?: string): Promise<SavedLogin[]>;
  save(identityId: string, origin: string, username: string, secret: SecretBuffer): Promise<SavedLogin>;
  update(id: string, change: { username?: string; secret?: SecretBuffer }): Promise<SavedLogin>;
  remove(id: string): Promise<void>;
  removeIdentity(identityId: string): Promise<number>;
  /** Windows Hello first (5-minute grace when the pref is on, main memory only), then hands the secret to `use` and
   *  zeroes it afterwards. `window`: the Hello prompt's owner window. */
  useForFill(id: string, use: (secret: SecretBuffer) => Promise<void>, options?: { window?: BrowserWindow | null }): Promise<void>;
  /** Show (main's native dialog) / copy (main's clipboard) in settings, after the same Hello check. */
  reveal(id: string, reason: "show" | "copy", options?: { window?: BrowserWindow | null }): Promise<SecretBuffer>;
  status(): Promise<BrowserPasswordStoreStatus>;
  neverSave: {
    list(identityId: string): Promise<string[]>;
    add(identityId: string, origin: string): Promise<void>;
    remove(identityId: string, origin: string): Promise<void>;
  };
}

/** Package E1. Capture on the owner's submit, prompts, fill offers; built on a store. */
export interface BrowserPasswordService {
  passwords(identityId: string): Promise<BrowserSavedLoginView[]>;
  update(id: string, username: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Main's native dialog shows the value; nothing returns to the renderer. */
  reveal(id: string): Promise<void>;
  status(): Promise<BrowserPasswordStoreStatus>;
  /** Writes the clipboard in main and clears it after 30 s if unchanged. */
  copy(id: string): Promise<void>;
  neverSave(identityId: string, remove?: string): Promise<string[]>;
  answer(promptId: string, choice: BrowserPasswordPromptChoice): Promise<void>;
  /** Re-checks: offer still open, owner's native focus, exact origin, tab not granted, owner pool. */
  fill(offerId: string, loginId: string): Promise<void>;
  dismiss(offerId: string): Promise<void>;
  /** Before prefs.passwordHelloGrace turns on: a fresh owner gesture and Windows Hello (refuses otherwise). */
  confirmGrace(): Promise<void>;
  /** After the pref changed: off forgets any remembered unlock at once. */
  graceChanged(on: boolean): void;
  removeIdentity(identityId: string): Promise<void>;
}

/**
 * Package A calls this once per (identity, host) session when it is first configured, after the browser hardening.
 * Placeholder for per-identity extensions (crosshost-study); never called for the agent pool.
 */
export type OnIdentitySession = (session: Session, identity: { identityId: string; hostId: string }) => void | Promise<void>;

/** 跨主机同步 (./sync.ts): cutex r297 directory per host; the local list follows one primary host's directory. */
export interface BrowserIdentitySyncService {
  state(): BrowserIdentitySyncState;
  setHostSync(hostId: string, enabled: boolean): Promise<BrowserIdentitySyncState>;
  confirmCleanup(identityId: string, deletionRevision: number): Promise<BrowserIdentitySyncState>;
}

export interface BrowserIdentityServices {
  identities?: BrowserIdentityService;
  sync?: BrowserIdentitySyncService;
  history?: BrowserHistoryService;
  passwords?: BrowserPasswordService;
  /** Extension / sync hooks (no implementation yet). */
  onIdentitySession: OnIdentitySession[];
  /** To the app renderer (main/index.ts sets it; a no-op before the window exists). */
  emit: EmitBrowserIdentityEvent;
}

/** The one registry the packages install their service into (main/browser/install.ts builds the channel on it). */
export const browserIdentityServices: BrowserIdentityServices = { onIdentitySession: [], emit: () => {} };
