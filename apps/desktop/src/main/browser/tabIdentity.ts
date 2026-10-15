import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BrowserRelayError } from "./relayTypes";
export interface BrowserTabIdentityStorage { read(): string | undefined; write(content: string): void; reset?(content: string): void }
/** Nonsecret provenance only. A restored agent tab can never silently enter the owner's partition. */
export function createBrowserTabIdentity(storage: BrowserTabIdentityStorage) {
  const entries = new Set<string>(); let owners = new Set<string>(); let loaded = false, degraded = false, strict = false;
  const key = (hostId: string, tabKey: string) => { if (!/^[A-Za-z0-9._:-]{1,128}$/.test(hostId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tabKey)) throw Error("invalid_browser_identity"); return JSON.stringify([hostId, tabKey]); };
  function load(): void {
    if (loaded) return;
    try {
      const raw = storage.read();
      if (raw !== undefined) {
        if (Buffer.byteLength(raw) > 1024 * 1024) throw Error("invalid_browser_identity");
        const value: unknown = JSON.parse(raw);
        const readRows = (rows: unknown, target: Set<string>) => {
          if (!Array.isArray(rows) || rows.length > 4096) throw Error("invalid_browser_identity");
          for (const item of rows) { if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string" || typeof item[1] !== "string") throw Error("invalid_browser_identity"); target.add(key(item[0], item[1])); }
        };
        if (Array.isArray(value)) readRows(value, entries); // Healthy legacy store: absent rows were owner tabs.
        else {
          const v = value as Record<string, unknown> | null;
          if (!v || v.version !== 2 || v.strict !== true || Object.keys(v).some(k => !["version", "strict", "agent", "owner"].includes(k))) throw Error("invalid_browser_identity");
          strict = true; readRows(v.agent, entries); readRows(v.owner, owners);
          if ([...owners].some(id => entries.has(id))) throw Error("invalid_browser_identity");
        }
      }
    } catch { entries.clear(); owners.clear(); degraded = true; }
    // Preserve corrupt evidence. Unknown identities must use the isolated pool,
    // never be reclassified as owner-cookie tabs after a failed provenance read.
    loaded = true;
  }
  const rows = (set: Set<string>) => [...set].map(value => JSON.parse(value) as unknown);
  const encode = (agent: Set<string>, owner = owners) => JSON.stringify(strict ? { version: 2, strict: true, agent: rows(agent), owner: rows(owner) } : rows(agent));
  function write(next: Set<string>, owner = owners): void {
    if (degraded) return;
    try { const content = encode(next, owner); if (Buffer.byteLength(content) > 1024 * 1024) throw Error("size"); storage.write(content); }
    catch { throw new BrowserRelayError("browser_identity_unavailable"); }
  }
  return {
    degraded(): boolean { load(); return degraded; },
    requiresProof(): boolean { load(); return degraded || strict; },
    unproven(hostId: string, tabKey: string): boolean { load(); const id = key(hostId, tabKey); return !owners.has(id) && !entries.has(id) && (degraded || strict); },
    owner(hostId: string, tabKey: string): boolean { load(); return owners.has(key(hostId, tabKey)); },
    agent(hostId: string, tabKey: string): boolean { load(); const id = key(hostId, tabKey); return entries.has(id) || (!owners.has(id) && (degraded || strict)); },
    registerOwner(hostId: string, tabKey: string): void {
      load(); const id = key(hostId, tabKey);
      if (entries.has(id)) throw new BrowserRelayError("permission_denied");
      if (owners.has(id) && [...owners].at(-1) === id) return;
      const next = new Set(owners); next.delete(id); next.add(id);
      // Owner rows are ordered least-recently-used first. Eviction only isolates a
      // restored tab in strict mode; agent tombstones must never be evicted.
      if (next.size > 4096) next.delete(next.values().next().value!);
      if (strict) write(entries, next); // Legacy files contain only agent rows.
      owners = next;
    },
    reset(known: { hostId: string; tabKey: string; pool: "owner" | "agent" }[]): void {
      load();
      if (!degraded) return; // No destructive rewrite of a healthy store.
      const agent = new Set(entries), owner = new Set(owners);
      for (const record of known) {
        // Legacy non-UUID live tabs stay trusted in memory, never weaken the persisted key grammar.
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.tabKey)) continue;
        const id = key(record.hostId, record.tabKey);
        if (record.pool === "agent") { agent.add(id); owner.delete(id); } else if (!agent.has(id)) owner.add(id);
      }
      while (owner.size > 4096) owner.delete(owner.values().next().value!);
      if (agent.size > 4096 || !storage.reset) throw new BrowserRelayError("browser_identity_unavailable");
      try { const content = JSON.stringify({ version: 2, strict: true, agent: rows(agent), owner: rows(owner) });
        if (Buffer.byteLength(content) > 1024 * 1024) throw Error("size"); storage.reset(content); }
      catch { throw new BrowserRelayError("browser_identity_unavailable"); }
      entries.clear(); owners.clear(); for (const id of agent) entries.add(id); for (const id of owner) owners.add(id);
      strict = true; degraded = false;
    },
    register(hostId: string, tabKey: string): boolean {
      load(); const id = key(hostId, tabKey); if (owners.has(id)) throw new BrowserRelayError("permission_denied");
      if (entries.has(id)) return false; if (entries.size >= 4096) throw new BrowserRelayError("lease_limit");
      const next = new Set(entries).add(id); write(next); entries.add(id); return true;
    },
    rollback(hostId: string, tabKey: string): void { load(); const id = key(hostId, tabKey); if (!entries.has(id)) return; const next = new Set(entries); next.delete(id); write(next); entries.delete(id); },
    // Provenance tombstones deliberately survive close. Reviving stale renderer state must not
    // cross into owner cookies; only owner provenance may be safely evicted.
  };
}
export function browserTabIdentityStorage(userData: string): BrowserTabIdentityStorage {
  const directory = resolve(userData), file = join(directory, "browser-tab-origins.json");
  function check(): void {
    // Walk from the store file to the root and reject any symlinked component. On macOS the walk
    // legitimately crosses the system symlinks /var, /tmp and /etc (-> /private/*); everything else
    // — including any component between the store file and such a system link — must be a real
    // directory entry, so a swapped store or directory still fails closed.
    const systemLinks = process.platform === "darwin" ? ["/var", "/tmp", "/etc"] : [];
    for (let current = file; ; current = dirname(current)) {
      if (existsSync(current) && lstatSync(current).isSymbolicLink() && !systemLinks.includes(current)) throw Error("invalid_browser_identity");
      if (dirname(current) === current) break;
    }
  }
  return {
    read() { check(); if (!existsSync(file)) {
      if (existsSync(directory) && readdirSync(directory).some(name => /^browser-tab-origins\.corrupt-.*\.json$/.test(name))) throw Error("invalid_browser_identity");
      return;
    } const stat = lstatSync(file); if (!stat.isFile() || stat.size > 1024 * 1024) throw Error("invalid_browser_identity"); return readFileSync(file, "utf8"); },
    write(content) { check(); mkdirSync(directory, { recursive: true }); const temporary = join(directory, `browser-tab-origins-${randomUUID()}.tmp`); writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 }); check(); renameSync(temporary, file); },
    reset(content) {
      check(); mkdirSync(directory, { recursive: true });
      // Prepare the restrictive replacement before moving the original. Archive uses a same-dir
      // rename, preserving original bytes/ACL. A failed replacement leaves the archive intact.
      const temporary = join(directory, `browser-tab-origins-${randomUUID()}.tmp`);
      writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      try { check();
      if (existsSync(file)) {
        if (!lstatSync(file).isFile()) throw Error("invalid_browser_identity");
        const archive = join(directory, `browser-tab-origins.corrupt-${randomUUID()}.json`);
        renameSync(file, archive);
        try { renameSync(temporary, file); }
        catch (error) { try { if (!existsSync(file)) renameSync(archive, file); } catch { /* Preserve archived bytes; caller stays degraded. */ } throw error; }
      } else renameSync(temporary, file);
      } finally { if (existsSync(temporary)) { try { unlinkSync(temporary); } catch { /* Only this operation's exact temp path. */ } } }
    },
  };
}
