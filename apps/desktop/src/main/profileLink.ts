// 042: main owns the random link secret and the only two daemon secret routes.
// Never retain remote errors/bodies in status, emit them, log them or expose the key through IPC.
import { createHash, randomBytes } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { deviceScopeOf, hostUserAccessOf } from "../shared/users";
import { PROFILE_ACCOUNT_LINK_FEATURE, type ProfileLinkHostSync, type ProfileLinkState } from "../shared/profileLink";

const ROUTE = "/v2/profile-link/secret";
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[a-f0-9]{8}$/;

export interface ProfileLinkTarget {
  hostId: string;
  /** Changes on every reconnect, including reconnects to the same host. */
  epoch: string;
  client: {
    capabilities(): Promise<{ featureList?: readonly string[]; user?: unknown } | null>;
    request<T = unknown>(method: "GET" | "PUT", path: string, body?: unknown): Promise<T>;
  };
}
/** Injectable only from main/tests. Production defaults to Electron's OS-backed encryption. */
export interface ProfileLinkEncryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export interface ProfileLinkOptions {
  userData: string;
  /** Connected targets only, independent of the current renderer scope. */
  targets(): readonly ProfileLinkTarget[];
  emit?(state: ProfileLinkState): void;
  encryption?: ProfileLinkEncryption;
}

function secretId(secret: string): string {
  return createHash("sha256").update(Buffer.from(secret, "base64url")).digest("hex").slice(0, 8);
}
function validSecret(value: unknown): value is string {
  return typeof value === "string" && SECRET.test(value) && Buffer.from(value, "base64url").toString("base64url") === value;
}
function replyStatus(value: unknown, allowNull: boolean): { secretId: string | null; disabled: boolean } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  if (r.contractVersion !== 2) return undefined;
  if ("disabled" in r && typeof r.disabled !== "boolean") return undefined;
  // A durable off marker wins even if a crash left an old ID/file behind.
  // Never copy an unvalidated remote ID (or other body fields) into safe status.
  if (r.disabled === true) return { secretId: null, disabled: true };
  if (typeof r.secretId === "string" && ID.test(r.secretId)) return { secretId: r.secretId, disabled: false };
  return allowNull && r.secretId === null ? { secretId: null, disabled: false } : undefined;
}
function accessRefusal(capabilities: Awaited<ReturnType<ProfileLinkTarget["client"]["capabilities"]>>): "unsupported" | "ineligible" | null {
  if (!capabilities?.featureList?.includes(PROFILE_ACCOUNT_LINK_FEATURE)) return "unsupported";
  const rawUser = capabilities.user as Record<string, unknown> | null | undefined;
  const access = hostUserAccessOf(capabilities);
  if (!rawUser || rawUser.isOwner !== true || rawUser.pending === true || !access.isOwner || deviceScopeOf(access) !== "full"
    || !(access.ownerLocal === true || access.token?.scope === "full")) return "ineligible";
  return null;
}

export class ProfileLinkService {
  #secret: string | null = null;
  #error: "storage_unavailable" | undefined;
  #generation = 0;
  #disposed = false;
  #targets = new Map<string, ProfileLinkTarget>();
  #states = new Map<string, ProfileLinkHostSync>();
  #running = new Map<string, Promise<void>>();
  #wanted = new Set<string>();
  #encryption: ProfileLinkEncryption;
  #dir: string;
  #file: string;

  constructor(private readonly options: ProfileLinkOptions) {
    this.#encryption = options.encryption ?? safeStorage;
    this.#dir = join(options.userData, "profile-link");
    this.#file = join(this.#dir, "secret-v1.json");
  }

  view(): ProfileLinkState {
    return { secretId: this.#secret ? secretId(this.#secret) : null,
      hosts: Object.fromEntries([...this.#states].map(([id, value]) => [id, { ...value }])),
      ...(this.#error ? { error: this.#error } : {}) };
  }
  #emit(): void {
    if (!this.#disposed) this.options.emit?.(this.view());
  }
  #encryptionReady(): void {
    // Electron's backend selector is Linux-only; the injected test adapter may
    // expose it on any platform. Never accept Linux's plaintext fallback.
    const plaintext = (process.platform === "linux" || this.options.encryption !== undefined)
      && this.#encryption.getSelectedStorageBackend?.() === "basic_text";
    if (!this.#encryption.isEncryptionAvailable() || plaintext) throw new Error("storage_unavailable");
  }
  #persist(secret: string): void {
    this.#encryptionReady();
    mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
    const temporary = join(this.#dir, `${randomBytes(16).toString("hex")}.tmp`);
    let fd: number | undefined;
    let published = false;
    try {
      fd = openSync(temporary, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ version: 1, encrypted: this.#encryption.encryptString(secret).toString("base64") }));
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      renameSync(temporary, this.#file);
      published = true;
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (!published) rmSync(temporary, { force: true });
    }
  }
  #load(): boolean {
    if (this.#secret) return true;
    try {
      this.#encryptionReady();
      let secret: string;
      let exists = true;
      try {
        const stat = lstatSync(this.#file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error("storage_unavailable");
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") exists = false;
        else throw error;
      }
      if (exists) {
        const stored = JSON.parse(readFileSync(this.#file, "utf8")) as { version?: unknown; encrypted?: unknown };
        if (stored.version !== 1 || typeof stored.encrypted !== "string") throw new Error("storage_unavailable");
        secret = this.#encryption.decryptString(Buffer.from(stored.encrypted, "base64"));
        if (!validSecret(secret)) throw new Error("storage_unavailable");
      } else {
        secret = randomBytes(32).toString("base64url");
        this.#persist(secret);
      }
      this.#secret = secret; this.#error = undefined;
      return true;
    } catch {
      this.#error = "storage_unavailable";
      return false;
    }
  }

  async reconcile(): Promise<ProfileLinkState> {
    if (this.#disposed) return this.view();
    const targets = this.options.targets();
    const connected = new Set(targets.map(t => t.hostId));
    for (const [id, target] of this.#targets) if (!connected.has(id)) this.onDisconnected(id, target.epoch);
    await Promise.all(targets.map(target => this.onConnected(target)));
    return this.view();
  }
  onDisconnected(hostId: string, epoch?: string): void {
    const target = this.#targets.get(hostId);
    if (epoch !== undefined && target?.epoch !== epoch) return;
    this.#targets.delete(hostId);
    this.#wanted.delete(hostId);
    if (this.#states.has(hostId)) this.#states.set(hostId, { state: "pending", secretId: null });
    this.#emit();
  }
  onConnected(target: ProfileLinkTarget): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#targets.set(target.hostId, target);
    this.#wanted.add(target.hostId);
    this.#states.set(target.hostId, { state: "pending", secretId: null });
    this.#emit();
    const running = this.#running.get(target.hostId);
    if (running) return running;
    const work = this.#drain(target.hostId).finally(async () => {
      this.#running.delete(target.hostId);
      const latest = this.#targets.get(target.hostId);
      if (!this.#disposed && latest && this.#wanted.has(target.hostId)) await this.onConnected(latest);
    });
    this.#running.set(target.hostId, work);
    return work;
  }
  async #drain(id: string): Promise<void> {
    while (!this.#disposed && this.#wanted.has(id)) {
      this.#wanted.delete(id);
      const target = this.#targets.get(id);
      if (!target) return;
      const generation = this.#generation;
      const current = () => !this.#disposed && this.#generation === generation && this.#targets.get(id) === target;
      const set = (value: ProfileLinkHostSync) => { if (current()) { this.#states.set(id, value); this.#emit(); } };
      try {
        const capabilities = await target.client.capabilities();
        if (!current()) continue;
        const refusal = accessRefusal(capabilities);
        if (refusal) { set({ state: refusal, secretId: null }); continue; }
        if (!this.#load()) { set({ state: "error", code: "storage_unavailable", secretId: null }); continue; }
        const secret = this.#secret!;
        const expected = secretId(secret);
        const status = replyStatus(await target.client.request("GET", ROUTE), true);
        if (!current()) continue;
        if (status === undefined) { set({ state: "error", code: "bad_response", secretId: null }); continue; }
        if (status.disabled) { set({ state: "ineligible", code: "host_disabled", secretId: null }); continue; }
        const remote = status.secretId;
        if (remote !== expected) {
          // Scope/owner access can change while GET is pending without changing
          // the transport epoch. Re-read immediately before sending any secret.
          const refreshed = await target.client.capabilities();
          if (!current()) continue;
          const denied = accessRefusal(refreshed);
          if (denied) { set({ state: denied, secretId: null }); continue; }
          // Full paired owner devices may initialize an unset host, but an
          // existing secret can only be replaced by an owner-local connection.
          if (remote !== null && hostUserAccessOf(refreshed).ownerLocal !== true) {
            set({ state: "error", code: "owner_local_required", secretId: null });
            continue;
          }
          const pushed = replyStatus(await target.client.request("PUT", ROUTE, { secret }), false);
          if (!current()) continue;
          if (pushed?.disabled) { set({ state: "ineligible", code: "host_disabled", secretId: null }); continue; }
          if (pushed?.secretId !== expected) { set({ state: "error", code: "bad_response", secretId: null }); continue; }
        }
        set({ state: "synced", secretId: expected });
      } catch (error) {
        // An unset host may have been initialized between GET and PUT. Never
        // retry the overwrite or expose the refusal's message/body/details.
        const code = error instanceof CutexApiError && error.status === 403 && error.code === "owner_local_only"
          ? "owner_local_required" : "sync_failed";
        set({ state: "error", code, secretId: null });
      }
    }
  }
  async reset(): Promise<ProfileLinkState> {
    if (this.#disposed) return this.view();
    try {
      const secret = randomBytes(32).toString("base64url");
      this.#persist(secret);
      this.#secret = secret;
      this.#error = undefined;
      this.#generation++;
      for (const id of this.#states.keys()) this.#states.set(id, { state: "pending", secretId: null });
      this.#emit();
    } catch {
      this.#error = "storage_unavailable";
      this.#emit();
      return this.view();
    }
    return this.reconcile();
  }
  dispose(): void {
    this.#disposed = true;
    this.#generation++;
    this.#secret = null;
    this.#targets.clear(); this.#wanted.clear();
  }
}
