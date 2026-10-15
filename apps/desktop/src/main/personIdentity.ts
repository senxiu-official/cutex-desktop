// P2 person identity in main (docs/research/person-identity-p2-20261014.md §2, §3; shared/personIdentity.ts):
// owns the person key (main/personKey.ts) and presents it to every connected host with cutex
// `person-identity`: `GET /v2/identity/challenge` (→ nonce, cutex host id and the caller's token id as
// cutex sees it — `root` for the root credential), sign `cutex-identity-v1\n<hostId>\n<nonce>\n<tokenId>`
// here, `POST /v2/identity/claim {publicKey, signature, nonce, displayName?}`. Every connection claims,
// the local root one too (cutex then puts the key on owner). Done once per host + credential + key
// (remembered in `<userData>/identity/claims.json`): a re-pairing or an imported key claims again, an
// upgrade claims once for every connected host, and a still-pending device again when 「你」's name
// changes (its pending card shows it). Errors are never remembered: `challenge_invalid` is retried at
// once with a fresh challenge, busy / unavailable stores a minute later, anything else on the next
// connect. Signing never crosses IPC — the renderer only sees the public key, the fingerprint and the
// per-host claim state; export / import go through main's own file dialogs, and the identity key
// string (main/personKey.ts) goes straight to / comes from the clipboard here: copyKeyString never
// returns it, importKeyString only receives what the person pasted. Never log the string or the key.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clipboard, dialog, type BrowserWindow } from "electron";
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { CLAIM_RETRY_LATER, CLAIM_RETRY_ONCE, claimDecision, claimDisplayName, claimedView, type ClaimRecord, type HostClaimView, type IdentityChallenge, type IdentityClaimResult, type IdentityFileResult, type IdentityImportTexts, type IdentityKeyCopyResult, type PersonIdentityView } from "../shared/personIdentity";
import { encodePersonKeyString, loadOrCreatePersonKey, parseKeyJson, parsePersonKey, parsePersonKeyString, PersonKeyStringError, serializePersonKey, signClaim, writePersonKeyFile, type PersonKey } from "./personKey";

/** A connected host the key can be presented to. */
export interface ClaimTarget {
  hostId: string;
  /** The desktop's name for the connection's credential (shared ClaimRecord.credential). */
  credential: string;
  /** The connection (a reconnect re-reads the capabilities). */
  epoch: string;
  client: {
    capabilities(): Promise<{ featureList?: readonly string[] } | null>;
    identityChallenge(): Promise<IdentityChallenge>;
    identityClaim(claim: { publicKey: string; signature: string; nonce: string; displayName?: string | null }): Promise<IdentityClaimResult>;
  };
}

/** How long a copied identity key string stays on the clipboard. */
export const IDENTITY_KEY_CLIPBOARD_MS = 60_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

export class PersonIdentityService {
  private key: PersonKey | null = null;
  private keyError: string | undefined;
  private claims: Record<string, ClaimRecord> = {};
  /** 「你」's name, sent with claims (the renderer pushes it: setDisplayName; kept in claims.json). */
  private displayName: string | null = null;
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>();
  private live: Record<string, HostClaimView> = {};
  private readonly running = new Map<string, Promise<void>>();
  /** Hosts asked to claim again while their claim was running (an import or a new name meanwhile). */
  private readonly rerun = new Map<string, ClaimTarget>();
  /** `hostId|epoch` connections already found without `person-identity`. */
  private readonly unsupported = new Set<string>();
  private readonly claimsPath: string;
  /** Pending clipboard clears of copied key strings (each clears only its own string). */
  private readonly clipboardClears = new Map<ReturnType<typeof setTimeout>, string>();

  constructor(
    private readonly dir: string,
    private readonly emit: (view: PersonIdentityView) => void,
    private readonly window: () => BrowserWindow | null,
    private readonly targets: () => ClaimTarget[],
  ) {
    this.claimsPath = join(dir, "claims.json");
    try {
      this.key = loadOrCreatePersonKey(dir);
    } catch (error) {
      this.keyError = message(error);
      console.warn("[cutex-desktop] person identity unavailable", this.keyError);
    }
    try {
      const raw = JSON.parse(readFileSync(this.claimsPath, "utf8")) as { claims?: Record<string, ClaimRecord>; displayName?: unknown };
      this.displayName = claimDisplayName(raw.displayName);
      for (const [hostId, r] of Object.entries(raw.claims ?? {})) if (r && typeof r.publicKey === "string" && typeof r.credential === "string" && typeof r.tokenId === "string") this.claims[hostId] = r;
    } catch {
      // none yet
    }
  }

  view(): PersonIdentityView {
    return { publicKey: this.key?.publicKey ?? null, fingerprint: this.key?.fingerprint ?? null, ...(this.keyError ? { error: this.keyError } : {}), claims: { ...this.live } };
  }

  /** A host connection is up (every daemonState `connected`): claim when it is due. */
  onConnected(target: ClaimTarget): void {
    if (this.running.has(target.hostId)) {
      // A claim is in flight (maybe for the old key or name): run once more after it, with the latest target.
      this.rerun.set(target.hostId, target);
      return;
    }
    const run = this.claim(target).finally(() => {
      this.running.delete(target.hostId);
      const again = this.rerun.get(target.hostId);
      if (again) {
        this.rerun.delete(target.hostId);
        this.onConnected(again);
      }
    });
    this.running.set(target.hostId, run);
  }

  /** 「你」's name changed (renderer): remembered, and pending devices are claimed again with it. */
  setDisplayName(name: unknown): void {
    const next = claimDisplayName(name);
    if (next === this.displayName) return;
    this.displayName = next;
    this.saveClaims();
    this.claimAll();
  }

  /** A host was removed or disconnected for good: drop its live state (the record stays for a re-add of the same id only). */
  forget(hostId: string, removed = false): void {
    delete this.live[hostId];
    this.rerun.delete(hostId);
    if (removed && this.claims[hostId]) {
      delete this.claims[hostId];
      this.saveClaims();
    }
    this.publish();
  }

  private setLive(hostId: string, view: HostClaimView): void {
    this.live[hostId] = view;
    this.publish();
  }

  private publish(): void {
    this.emit(this.view());
  }

  private async claim(target: ClaimTarget): Promise<void> {
    const key = this.key;
    const { hostId, credential } = target;
    const record = this.claims[hostId];
    const displayName = this.displayName;
    const base = { credential, publicKey: key?.publicKey ?? null, record, displayName };
    let decision = claimDecision({ ...base, features: this.unsupported.has(`${hostId}|${target.epoch}`) ? new Set() : null });
    if (decision === "claim") {
      try {
        const caps = await target.client.capabilities();
        decision = claimDecision({ ...base, features: new Set(caps?.featureList ?? []) });
      } catch (error) {
        return this.setLive(hostId, { state: "failed", error: message(error) });
      }
    }
    if (decision === "unsupported") this.unsupported.add(`${hostId}|${target.epoch}`);
    if (decision !== "claim" || !key) {
      return this.setLive(hostId, decision === "done" ? claimedView(record!) : { state: decision === "unsupported" ? "unsupported" : "noKey" });
    }
    this.setLive(hostId, { state: "claiming" });
    const attempt = async () => {
      const challenge = await target.client.identityChallenge();
      // Sign the token id cutex names (`root` for the root credential), never a locally stored one.
      const signature = signClaim(key, { hostId: challenge.hostId, nonce: challenge.nonce, tokenId: challenge.tokenId });
      const result = await target.client.identityClaim({ publicKey: key.publicKey, signature, nonce: challenge.nonce, displayName });
      return { challenge, result };
    };
    try {
      let done: Awaited<ReturnType<typeof attempt>>;
      try {
        done = await attempt();
      } catch (error) {
        // The nonce expired or was spent meanwhile: once more with a fresh challenge.
        if (!(error instanceof CutexApiError && CLAIM_RETRY_ONCE.has(error.code))) throw error;
        done = await attempt();
      }
      // The key was replaced meanwhile: this claim is stale (claimAll after the import queued a rerun).
      if (this.key !== key) return;
      const { challenge, result } = done;
      const next: ClaimRecord = { publicKey: key.publicKey, credential, tokenId: challenge.tokenId, outcome: result.outcome, at: new Date().toISOString(), userId: result.userId, pending: result.pending, personUserId: result.personUserId, displayName };
      this.claims[hostId] = next;
      this.saveClaims();
      this.setLive(hostId, claimedView(next));
    } catch (error) {
      const code = error instanceof CutexApiError ? error.code : undefined;
      this.setLive(hostId, { state: "failed", ...(code ? { errorCode: code } : {}), error: message(error) });
      if (code && CLAIM_RETRY_LATER.has(code)) this.retryLater(hostId);
    }
  }

  /** One more try a minute later, if that host is still connected then. */
  private retryLater(hostId: string): void {
    if (this.retries.has(hostId)) return;
    const timer = setTimeout(() => {
      this.retries.delete(hostId);
      const target = this.targets().find((t) => t.hostId === hostId);
      if (target) this.onConnected(target);
    }, 60_000);
    timer.unref?.();
    this.retries.set(hostId, timer);
  }

  /** Present the (new) key to every connected host where it is due. */
  private claimAll(): void {
    for (const target of this.targets()) this.onConnected(target);
  }

  private saveClaims(): void {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      writeFileSync(`${this.claimsPath}.tmp`, `${JSON.stringify({ version: 2, displayName: this.displayName, claims: this.claims }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(`${this.claimsPath}.tmp`, this.claimsPath);
    } catch (error) {
      console.warn("[cutex-desktop] saving identity claims failed", message(error));
    }
  }

  /** 导出身份: the key file through a save dialog. */
  async exportIdentity(title: unknown): Promise<IdentityFileResult> {
    const key = this.key;
    if (!key) return { ok: false, error: this.keyError ?? "no identity" };
    const win = this.window();
    const options = { title: clip(title, 200) || undefined, defaultPath: `cutex-identity-${key.fingerprint}.json`, filters: [{ name: "Cutex identity", extensions: ["json"] }] };
    const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
    try {
      // `mode` only applies to a new file: an existing one is made owner-only before the key goes in
      // (and again after). Windows has no POSIX modes (chmod only toggles read-only): the file keeps
      // the ACL of the folder the person picked.
      const ownerOnly = () => (process.platform === "win32" ? Promise.resolve() : chmod(picked.filePath!, 0o600));
      await ownerOnly().catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await writeFile(picked.filePath, serializePersonKey(key), { encoding: "utf8", mode: 0o600 });
      await ownerOnly();
      return { ok: true, path: picked.filePath };
    } catch (error) {
      return { ok: false, error: message(error) };
    }
  }

  /** 导入身份: an exported key file replaces this desktop's key after a confirm dialog; then every host is claimed again. */
  async importIdentity(texts: Partial<IdentityImportTexts> | null | undefined): Promise<IdentityFileResult> {
    const win = this.window();
    const openOptions = { title: clip(texts?.title, 200) || undefined, properties: ["openFile" as const], filters: [{ name: "Cutex identity", extensions: ["json"] }] };
    const picked = win ? await dialog.showOpenDialog(win, openOptions) : await dialog.showOpenDialog(openOptions);
    const path = picked.filePaths[0];
    if (picked.canceled || !path) return { ok: false, canceled: true };
    let next: PersonKey;
    try {
      next = parsePersonKey(parseKeyJson(await readFile(path, "utf8")));
    } catch (error) {
      return { ok: false, error: message(error) };
    }
    const result = await this.replaceKey(next, texts);
    return result.ok ? { ...result, path } : result;
  }

  /** 复制身份密钥: the key string goes onto the clipboard here (never to the renderer) and is cleared after a minute if still there. */
  async copyKeyString(): Promise<IdentityKeyCopyResult> {
    const key = this.key;
    if (!key) return { ok: false, error: this.keyError ?? "no identity" };
    let text: string;
    try {
      text = encodePersonKeyString(key);
      await clipboard.writeText(text);
    } catch (error) {
      return { ok: false, error: message(error) };
    }
    // A successful copy owns a fresh minute, even when the key string is unchanged.
    // Failed writes leave the previous clear in place.
    for (const pending of this.clipboardClears.keys()) clearTimeout(pending);
    this.clipboardClears.clear();
    const timer = setTimeout(() => void this.clearCopiedKey(timer), IDENTITY_KEY_CLIPBOARD_MS);
    timer.unref?.();
    this.clipboardClears.set(timer, text);
    return { ok: true, clearAfterMs: IDENTITY_KEY_CLIPBOARD_MS };
  }

  /** Clear the clipboard if it still holds the string this timer copied (the person may have copied something else since). */
  private async clearCopiedKey(timer: ReturnType<typeof setTimeout>): Promise<void> {
    const text = this.clipboardClears.get(timer);
    if (text === undefined) return;
    try {
      // A newer copy may have completed while this clipboard read was pending.
      if ((await clipboard.readText()) === text && this.clipboardClears.has(timer)) clipboard.clear();
    } catch {
      // the clipboard is gone (quitting): nothing to clear
    } finally {
      this.clipboardClears.delete(timer);
    }
  }

  /** A copied key string is still waiting for its clear (quitting clears it first: the clipboard outlives the app). */
  hasPendingKeyClears(): boolean {
    return this.clipboardClears.size > 0;
  }

  /** On quit: clear every copied key string still on the clipboard now (bounded, so quitting never hangs). */
  async clearCopiedKeysNow(): Promise<void> {
    const timers = [...this.clipboardClears.keys()];
    for (const timer of timers) clearTimeout(timer);
    const all = Promise.all(timers.map((timer) => this.clearCopiedKey(timer)));
    await Promise.race([all, new Promise((resolve) => setTimeout(resolve, 1000))]);
    // A clear that missed the bound must not hold the next quit attempt again.
    this.clipboardClears.clear();
  }

  /** 粘贴身份密钥: a pasted key string replaces this desktop's key after the same confirm dialog as a file import. */
  async importKeyString(text: unknown, texts: Partial<IdentityImportTexts> | null | undefined): Promise<IdentityFileResult> {
    let next: PersonKey;
    try {
      next = parsePersonKeyString(typeof text === "string" ? text.slice(0, 4096) : "");
    } catch (error) {
      return error instanceof PersonKeyStringError ? { ok: false, errorCode: error.code, error: error.message } : { ok: false, error: message(error) };
    }
    return this.replaceKey(next, texts);
  }

  /**
   * The one replace path (file import and key string): nothing when it is already this desktop's key;
   * otherwise main's confirm dialog (`{old}` / `{new}` = fingerprints), then store it and claim every
   * connected host again.
   */
  private async replaceKey(next: PersonKey, texts: Partial<IdentityImportTexts> | null | undefined): Promise<IdentityFileResult> {
    if (next.publicKey === this.key?.publicKey) return { ok: true, changed: false };
    const win = this.window();
    const fill = (v: unknown) => clip(v, 600).replaceAll("{old}", this.key?.fingerprint ?? "—").replaceAll("{new}", next.fingerprint);
    const confirmOptions = { type: "warning" as const, title: fill(texts?.title), message: fill(texts?.message) || `${this.key?.fingerprint ?? "—"} → ${next.fingerprint}`, detail: fill(texts?.detail) || undefined, buttons: [clip(texts?.cancel, 40) || "Cancel", clip(texts?.replace, 40) || "Replace"], defaultId: 0, cancelId: 0, noLink: true };
    const answer = win ? await dialog.showMessageBox(win, confirmOptions) : await dialog.showMessageBox(confirmOptions);
    if (answer.response !== 1) return { ok: false, canceled: true };
    try {
      writePersonKeyFile(join(this.dir, "person-key.json"), next);
    } catch (error) {
      return { ok: false, error: message(error) };
    }
    this.key = next;
    this.keyError = undefined;
    this.unsupported.clear();
    this.publish();
    this.claimAll();
    return { ok: true, changed: true };
  }
}
