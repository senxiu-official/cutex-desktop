// Owner certificate exceptions (B5, 2026-11-17). Chromium refused the certificate of a LAN / loopback origin the
// owner opened (a router, NAS or `vite --https` with a self-signed certificate); the owner clicked 「仍然打开」 in
// that tab's notice, which main redeemed by id. Main remembers exactly that host connection + origin + SHA-256
// certificate fingerprint (one per origin; a different certificate asks again; 10.0.0.1 behind another host is
// another machine). Public origins never get an exception, the agent partition never consults this store, and
// nothing here is writable by the renderer, a page or an agent.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_BROWSER_IDENTITY_ID as DEFAULT_ID, isBrowserIdentityId } from "../../shared/browserIdentity";

interface Io { read(path: string): string; write(path: string, text: string): void }
const defaultIo: Io = {
  read: path => readFileSync(path, "utf8"),
  write: (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text, { mode: 0o600 }); renameSync(`${path}.tmp`, path); },
};
/** Electron's Certificate.fingerprint ("sha256/<base64>"). */
const FINGERPRINT = /^sha256\/[A-Za-z0-9+/]{43}=$/;
const ORIGIN = /^https:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9.-]{1,253})(?::[0-9]{1,5})?$/;
const HOST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
export const BROWSER_CERTIFICATE_EXCEPTION_LIMIT = 128;

export function isBrowserCertificateFingerprint(value: unknown): value is string { return typeof value === "string" && FINGERPRINT.test(value); }
/** "sha256/<base64>" → "AB:CD:…" (32 bytes, shown to the owner). */
export function browserCertificateFingerprintHex(value: string): string | undefined {
  if (!isBrowserCertificateFingerprint(value)) return;
  return [...Buffer.from(value.slice(7), "base64")].map(byte => byte.toString(16).padStart(2, "0").toUpperCase()).join(":");
}
/** Store key: "<hostId> <https origin>" (neither part may contain a space). */
function exceptionKey(hostId: unknown, origin: unknown, identityId = DEFAULT_ID): string | undefined {
  return typeof hostId === "string" && typeof origin === "string" && HOST_ID.test(hostId) && ORIGIN.test(origin) && isBrowserIdentityId(identityId)
    ? `${identityId} ${hostId} ${origin}` : undefined;
}

/** Legacy `exceptions` belong to the default identity; other identities use their own keys. */
export class BrowserCertificateExceptionStore {
  private entries: Map<string, string> | undefined;
  constructor(private readonly file: string | null, private readonly io: Io = defaultIo) {}
  private read(): Map<string, string> {
    if (this.entries) return this.entries;
    const entries = new Map<string, string>();
    if (this.file) try {
      const parsed = JSON.parse(this.io.read(this.file)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const fields = parsed as Record<string, unknown>;
        for (const [name, withIdentity] of [["exceptions", false], ["identityExceptions", true]] as const) {
          const stored = fields[name];
          if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;
          for (const [raw, fingerprint] of Object.entries(stored).slice(-BROWSER_CERTIFICATE_EXCEPTION_LIMIT)) {
            const parts = raw.split(" ");
            if (parts.length !== (withIdentity ? 3 : 2)) continue;
            const [identityId, hostId, origin] = withIdentity ? parts : [DEFAULT_ID, ...parts];
            if (withIdentity && identityId === DEFAULT_ID) continue;
            const key = exceptionKey(hostId, origin, identityId);
            if (key && isBrowserCertificateFingerprint(fingerprint)) entries.set(key, fingerprint);
          }
        }
      }
    } catch { /* Missing or malformed: no exceptions (fail closed). */ }
    return this.entries = entries;
  }
  matches(hostId: string, origin: string, fingerprint: string, identityId = DEFAULT_ID): boolean {
    try {
      const key = exceptionKey(hostId, origin, identityId);
      return !!key && isBrowserCertificateFingerprint(fingerprint) && this.read().get(key) === fingerprint;
    } catch { return false; }
  }
  /** Remembers (or replaces) the one certificate the owner accepted for this origin; oldest entries fall off. */
  set(hostId: string, origin: string, fingerprint: string, identityId = DEFAULT_ID): void {
    const key = exceptionKey(hostId, origin, identityId);
    if (!key || !isBrowserCertificateFingerprint(fingerprint)) throw new Error("invalid_certificate_exception");
    const entries = new Map(this.read());
    entries.delete(key); entries.set(key, fingerprint);
    while (entries.size > BROWSER_CERTIFICATE_EXCEPTION_LIMIT) entries.delete(entries.keys().next().value!);
    this.save(entries);
  }
  forget(identityId?: string, hostId?: string): void {
    const entries = new Map(this.read());
    for (const key of entries.keys()) {
      const [id, host] = key.split(" ");
      if ((identityId === undefined || id === identityId) && (hostId === undefined || host === hostId)) entries.delete(key);
    }
    if (entries.size !== this.read().size) this.save(entries);
  }
  private save(entries: Map<string, string>): void {
    const exceptions = Object.fromEntries([...entries].filter(([key]) => key.startsWith(`${DEFAULT_ID} `))
      .map(([key, fp]) => [key.slice(DEFAULT_ID.length + 1), fp]));
    const identityExceptions = Object.fromEntries([...entries].filter(([key]) => !key.startsWith(`${DEFAULT_ID} `)));
    if (this.file) this.io.write(this.file, `${JSON.stringify({ exceptions, ...(Object.keys(identityExceptions).length ? { identityExceptions } : {}) }, null, 2)}\n`);
    this.entries = entries;
  }
}
