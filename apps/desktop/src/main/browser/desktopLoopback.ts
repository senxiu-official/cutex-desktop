import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { DEFAULT_BROWSER_IDENTITY_ID as DEFAULT_ID, isBrowserIdentityId } from "../../shared/browserIdentity";

interface Io { read(path: string): string; write(path: string, text: string): void }
const defaultIo: Io = {
  read: path => readFileSync(path, "utf8"),
  write: (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text, { mode: 0o600 }); renameSync(`${path}.tmp`, path); },
};

/** Desktop-local owner choice, scoped to the SSH host whose tab showed the explanation. */
export class BrowserDesktopLoopbackStore {
  private hosts: Set<string> | undefined;
  constructor(private readonly file: string | null, private readonly io: Io = defaultIo) {}
  private read(): Set<string> {
    if (this.hosts) return this.hosts;
    if (!this.file) return this.hosts = new Set();
    let text: string;
    try { text = this.io.read(this.file); }
    catch { return this.hosts = new Set(); }
    try {
      const parsed = JSON.parse(text) as unknown;
      const fields = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      const hosts = new Set<string>();
      for (const [name, withIdentity] of [["desktopLoopback", false], ["identityDesktopLoopback", true]] as const) {
        const stored = fields[name];
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;
        for (const [key, enabled] of Object.entries(stored)) {
          if (enabled !== true) continue;
          const [identityId, hostId, extra] = withIdentity ? key.split(" ") : [DEFAULT_ID, key];
          if (isBrowserIdentityId(identityId) && (!withIdentity || identityId !== DEFAULT_ID) && hostId && !/\s/.test(hostId) && extra === undefined)
            hosts.add(`${identityId} ${hostId}`);
        }
      }
      return this.hosts = hosts;
    } catch { return this.hosts = new Set(); }
  }
  enabled(hostId: string, identityId = DEFAULT_ID): boolean {
    try { return this.read().has(`${identityId} ${hostId}`); } catch { return false; }
  }
  set(hostId: string, enabled: boolean, identityId = DEFAULT_ID): { enabled: boolean } {
    if (!isBrowserIdentityId(identityId) || !hostId || /\s/.test(hostId)) throw Error("invalid_browser_identity");
    const hosts = new Set(this.read()), key = `${identityId} ${hostId}`;
    if (enabled) hosts.add(key); else { hosts.delete(key); this.hosts = hosts; }
    this.save(hosts);
    return { enabled };
  }
  /** Every host of the identity, or one. */
  forgetIdentity(identityId: string, hostId?: string): void {
    const hosts = new Set([...this.read()].filter(key => hostId === undefined ? !key.startsWith(`${identityId} `) : key !== `${identityId} ${hostId}`));
    if (hosts.size !== this.read().size) { this.hosts = hosts; this.save(hosts); }
  }
  retain(hostIds: Iterable<string>): void {
    const keep = new Set(hostIds), hosts = new Set([...this.read()].filter(key => keep.has(key.split(" ")[1]!)));
    if (hosts.size === this.read().size) return;
    this.hosts = hosts;
    this.save(hosts);
  }
  private save(hosts: Set<string>): void {
    const keys = [...hosts].sort();
    const defaults = keys.filter(key => key.startsWith(`${DEFAULT_ID} `)).map(key => [key.slice(DEFAULT_ID.length + 1), true]);
    const named = keys.filter(key => !key.startsWith(`${DEFAULT_ID} `)).map(key => [key, true]);
    if (this.file) this.io.write(this.file, `${JSON.stringify({ desktopLoopback: Object.fromEntries(defaults),
      ...(named.length ? { identityDesktopLoopback: Object.fromEntries(named) } : {}) }, null, 2)}\n`);
    this.hosts = hosts;
  }
}

const challengeKey = (hostId: string, tabKey: string, origin: string) => JSON.stringify([hostId, tabKey, origin]);
function exactOrigin(raw: string): string | null {
  try { const url = new URL(raw); return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null; }
  catch { return null; }
}

/** A remote_loopback refusal mints the only proof a one-click retry may redeem. */
export class BrowserDesktopLoopbackChallenges {
  private entries = new Map<string, { nonce: string; expires: number }>();
  constructor(private readonly now = () => Date.now(), private readonly mint = () => randomBytes(32).toString("hex")) {}
  private prune(): void {
    for (const [key, entry] of this.entries) if (entry.expires <= this.now()) this.entries.delete(key);
  }
  issue(hostId: string, tabKey: string, rawUrl: string): void {
    const origin = exactOrigin(rawUrl); if (!origin) return;
    this.prune();
    while (this.entries.size >= 64) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(challengeKey(hostId, tabKey, origin), { nonce: this.mint(), expires: this.now() + 30_000 });
  }
  nonce(hostId: string, tabKey: string, rawUrl: string): string | null {
    const origin = exactOrigin(rawUrl); if (!origin) return null;
    this.prune();
    return this.entries.get(challengeKey(hostId, tabKey, origin))?.nonce ?? null;
  }
  consume(hostId: string, tabKey: string, rawUrl: string, nonce: string): boolean {
    const origin = exactOrigin(rawUrl); if (!origin) return false;
    this.prune();
    const key = challengeKey(hostId, tabKey, origin), entry = this.entries.get(key);
    if (!entry || entry.nonce !== nonce) return false;
    this.entries.delete(key);
    return true;
  }
}
