// Owner switch 「浏览器通过系统代理上网」 (B7, 2026-11-17; default OFF). Main-only state, like 「允许浏览外部网页」:
// the renderer may read / flip it through the app-frame-only browser channel; only main stores it and N2 re-reads it
// per connection. While on, N2 forwards PUBLIC targets through the proxy the OS settings name for that URL (Chromium's
// resolveProxy on a non-browser, in-memory session in "system" mode: Windows / macOS proxy incl. PAC / WPAD, Linux
// desktop settings and *_PROXY env); DIRECT when the OS says so. LAN / loopback / admitted targets never go upstream.
//
// Default off (not "system" like the updater's Settings → 网络代理): with the switch on, N2 no longer sees the address
// the proxy dials for a public name (it only pre-checks its own DNS answer), so the owner opts in to that trade.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { browserUpstreamProxy, type BrowserUpstreamProxy } from "./egressUpstream";

interface Io { read(path: string): string; write(path: string, text: string): void }
const defaultIo: Io = {
  read: path => readFileSync(path, "utf8"),
  write: (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text, { mode: 0o600 }); renameSync(`${path}.tmp`, path); },
};

/** userData/browser-system-proxy.json = { "systemProxy": boolean }. Missing, unreadable or malformed = off. */
export class BrowserSystemProxyStore {
  private value: boolean | undefined;
  constructor(private readonly file: string | null, private readonly io: Io = defaultIo) {}
  get(): boolean {
    if (this.value !== undefined) return this.value;
    if (!this.file) return this.value = false;
    try {
      const parsed = JSON.parse(this.io.read(this.file)) as unknown;
      const stored = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).systemProxy : undefined;
      return this.value = stored === true;
    } catch { return this.value = false; }
  }
  set(enabled: boolean): void {
    if (!enabled) this.value = false; // Off takes effect in memory even when the write fails.
    if (this.file) this.io.write(this.file, `${JSON.stringify({ systemProxy: enabled }, null, 2)}\n`);
    this.value = enabled;
  }
}

/** resolve: Chromium's answer for the URL ("PROXY h:p; DIRECT", "SOCKS5 h:p", "DIRECT"). */
export function createBrowserSystemProxy(options: { store: BrowserSystemProxyStore; resolve(url: string): Promise<string> }) {
  const enabled = (): boolean => { try { return options.store.get() === true; } catch { return false; } };
  return {
    enabled,
    view: () => ({ enabled: enabled() }),
    set(value: boolean) { options.store.set(value); return { enabled: enabled() }; },
    /** N2's upstream for one public URL: null = direct (switch off or the OS says DIRECT), undefined = unusable. */
    async upstream(url: string): Promise<BrowserUpstreamProxy | null | undefined> {
      if (!enabled()) return null;
      let answer: string;
      try { answer = await options.resolve(url); } catch { return undefined; }
      return enabled() ? browserUpstreamProxy(answer) : null;
    },
  };
}
