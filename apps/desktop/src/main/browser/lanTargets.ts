// Owner-typed LAN / tailnet targets (0.1.3). Main admits exactly the authority the owner opened, per
// tab; the N2 proxy then dials it (LAN DNS answers allowed for it alone), and the URL policy keeps
// every other page in the host-level partition away from it (per-request tab attribution).
import { lookup as systemLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isAllowedEgressAddress, isLanEgressAddress, parseLanBrowserUrl, parsePublicBrowserUrl } from "./egressAddress";

export type BrowserLanLookup = (hostname: string) => Promise<readonly { address: string; family: number }[]>;
export interface BrowserLanTarget { key: string; origin: string; hostname: string; port: number }
const DNS_TIMEOUT_MS = 2500, CACHE_MS = 60_000, CACHE_MAX = 256;

/** Key shared with the proxy: bare hostname (IPv6 without brackets) + port. */
export function browserLanKey(hostname: string, port: number): string { return `${hostname.toLowerCase()}:${port}`; }

export class BrowserLanTargets {
  private readonly tabs = new Map<string, Set<string>>(); // key → guestIds
  private readonly cache = new Map<string, { lan: boolean; at: number }>();
  constructor(private readonly lookup: BrowserLanLookup = async hostname => systemLookup(hostname, { all: true, verbatim: true }),
    private readonly now = () => Date.now()) {}
  has(hostname: string, port: number): boolean { return this.tabs.has(browserLanKey(hostname, port)); }
  get size(): number { return this.tabs.size; }
  admit(guestId: string, target: BrowserLanTarget): void {
    let set = this.tabs.get(target.key);
    if (!set) this.tabs.set(target.key, set = new Set());
    set.add(guestId);
  }
  release(guestId: string): void {
    for (const [key, set] of this.tabs) { set.delete(guestId); if (!set.size) this.tabs.delete(key); }
  }
  clear(): void { this.tabs.clear(); this.cache.clear(); }
  /**
   * Is this URL a LAN-class target the owner may open? Literal LAN addresses and LAN-style names
   * (single label, .local, .lan, .home.arpa …) by syntax; any other name only when every DNS answer
   * is LAN or public and at least one is LAN (a tailnet DNS name). Loopback / link-local / reserved
   * answers never qualify. Never a renderer decision; no per-domain rule.
   */
  async classify(raw: string): Promise<BrowserLanTarget | null> {
    let url: URL;
    try { url = new URL(raw); } catch { return null; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const target = { key: browserLanKey(hostname, port), origin: `${url.protocol}//${url.host}`, hostname, port };
    if (isIP(hostname)) return isLanEgressAddress(hostname) ? target : null;
    if (!parseLanBrowserUrl(url.href)) return null;
    if (!parsePublicBrowserUrl(url.href)) return target; // nas.local, router, printer.lan
    return await this.resolvesToLan(hostname) ? target : null;
  }
  private async resolvesToLan(hostname: string): Promise<boolean> {
    const cached = this.cache.get(hostname);
    if (cached && this.now() - cached.at < CACHE_MS) return cached.lan;
    let lan = false;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const answers = await Promise.race([this.lookup(hostname), new Promise<never>((_yes, no) => { timer = setTimeout(() => no(new Error("timeout")), DNS_TIMEOUT_MS); timer.unref?.(); })])
        .finally(() => clearTimeout(timer));
      lan = Array.isArray(answers) && answers.length > 0 && answers.length <= 32
        && answers.every(item => isAllowedEgressAddress(item.address, true)) && answers.some(item => isLanEgressAddress(item.address));
    } catch { lan = false; /* Unresolvable here: the public path (and its own DNS check) decides. */ }
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(hostname, { lan, at: this.now() });
    return lan;
  }
}
