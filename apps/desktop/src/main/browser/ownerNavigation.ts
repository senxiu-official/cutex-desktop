import { randomBytes } from "node:crypto";
import { parsePublicBrowserUrl } from "./egressAddress";

const INPUT_MS = 750, CHAIN_MS = 60_000;
export const OWNER_NAVIGATION_WORLD = 1012;
function target(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 8000 || /[\x00-\x1f\x7f]/.test(raw)) return null;
  try { const url = new URL(raw); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null; url.hash = ""; return url.href; } catch { return null; }
}

/** Main's native input corroborates an isolated-world trusted click/submit receipt. Neither a
 * page event flag nor the app renderer can mint one. A redirect continuation additionally needs
 * the same Chromium request id; another request cannot borrow a navigation's user intent. */
export class BrowserOwnerNavigation {
  private nativeAt = -Infinity;
  private receipt: { url: string; kind: "navigation" | "popup"; at: number } | undefined;
  private chain: { url: string; at: number; request?: string; prepared?: boolean; privateStart: boolean; redirected: boolean } | undefined;
  constructor(private readonly owner: () => boolean, private readonly agent: () => boolean, private readonly now = () => performance.now(),
    private readonly policy: { privateTarget?(url: string): boolean; admitted?(url: string): boolean } = {}) {}
  private isPrivate(url: string): boolean { return !parsePublicBrowserUrl(url) || this.policy.privateTarget?.(url) === true; }
  /** Called again after DNS classification, BEFORE a new private target is admitted. */
  canAdmitPrivate(raw: string): boolean {
    const url = target(raw), chain = this.chain;
    return !!url && !!chain && chain.url === url && (!chain.redirected || chain.privateStart || this.policy.admitted?.(url) === true);
  }
  private eligible(): boolean { return this.owner() && !this.agent(); }
  native(type: string): void {
    if (!this.eligible()) { this.receipt = undefined; this.nativeAt = -Infinity; return; }
    if (["mouseUp", "keyDown", "rawKeyDown"].includes(type)) this.nativeAt = this.now();
  }
  trustedReceipt(raw: unknown): void {
    if (!this.eligible() || !raw || typeof raw !== "object") return;
    const r = raw as { url?: unknown; kind?: unknown }, url = target(r.url), age = this.now() - this.nativeAt;
    if (url && (r.kind === "navigation" || r.kind === "popup") && age >= 0 && age <= INPUT_MS)
      this.receipt = { url, kind: r.kind, at: this.now() };
  }
  navigation(raw: string, kind: "navigation" | "redirect" | "popup"): boolean {
    const url = target(raw), now = this.now();
    if (!url || !this.eligible()) return false;
    if (kind !== "popup" && this.chain && now - this.chain.at <= CHAIN_MS) {
      if (kind === "navigation" && this.chain.url === url && this.chain.request === undefined) return true; // duplicate navigation events before the request starts
      if (kind === "redirect" && this.chain.request) {
        if (this.isPrivate(url) && !this.chain.privateStart && this.policy.admitted?.(url) !== true) { this.chain = undefined; return false; }
        this.chain.url = url; this.chain.prepared = false; this.chain.redirected = true; return true;
      }
    }
    const receipt = this.receipt;
    if (kind === "redirect" || !receipt || receipt.url !== url || receipt.kind !== kind || now - receipt.at > INPUT_MS) return false;
    this.receipt = undefined;
    if (kind !== "popup") this.chain = { url, at: now, privateStart: this.isPrivate(url), redirected: false };
    return true;
  }
  /** Address bar / explicit app retry: main already attributed this navigation to its owner. */
  ownerNavigation(raw: string): void { const url = target(raw); this.receipt = undefined; this.chain = url && this.owner() ? { url, at: this.now(), prepared: true, privateStart: this.isPrivate(url), redirected: false } : undefined; }
  get prepared(): boolean { return this.chain?.prepared === true; }
  markPrepared(): void { if (this.chain) { this.chain.prepared = true; if (!this.chain.redirected) this.chain.privateStart = this.isPrivate(this.chain.url); } }
  request(id: string, raw: string): boolean {
    const chain = this.chain, url = target(raw);
    if (!chain || !url || !this.eligible() || this.now() - chain.at > CHAIN_MS || chain.url !== url || (chain.request !== undefined && chain.request !== id)) return false;
    if (this.isPrivate(url) && !this.canAdmitPrivate(url)) return false;
    chain.request = id; return true;
  }
  ended(id: string): void { if (this.chain?.request === id) this.chain = undefined; }
  document(): void { this.receipt = undefined; this.nativeAt = -Infinity; }
  reset(): void { this.document(); this.chain = undefined; }
}

/** The only producer of trustedReceipt. Installed by main in an isolated world, without a
 * preload or page-exposed API. No debugger ownership is needed. A per-document private prefix
 * binds console receipts to this main-installed closure; ordinary page console messages cannot
 * impersonate it. Main never logs or publishes these messages. */
export function ownerNavigationScript(prefix: string): string {
  return `(()=>{const emit=console.debug.bind(console),prefix=${JSON.stringify(prefix)};let form=null;
const send=(url,popup)=>emit(prefix+JSON.stringify({url,kind:popup?'popup':'navigation'}));
const popup=t=>!!t&&!['_self','_top','_parent'].includes(t.toLowerCase());
const formClick=f=>{form=f;setTimeout(()=>{if(form===f)form=null},0)};
addEventListener('click',e=>{if(!e.isTrusted||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;const p=e.composedPath(),a=p.find(n=>n instanceof HTMLAnchorElement&&n.href);
if(a&&!a.download)send(a.href,popup(a.target));const b=p.find(n=>(n instanceof HTMLButtonElement&&n.type==='submit')||(n instanceof HTMLInputElement&&['submit','image'].includes(n.type)));if(b?.form)formClick(b.form)},true);
addEventListener('keydown',e=>{if(!e.isTrusted||e.key!=='Enter')return;const n=e.target;if(n instanceof HTMLAnchorElement&&n.href)send(n.href,popup(n.target));if(n?.form)formClick(n.form)},true);
addEventListener('submit',e=>{if(!e.isTrusted||e.target!==form)return;const f=e.target,s=e.submitter;try{const u=new URL(s?.hasAttribute('formaction')?s.formAction:f.action,document.baseURI),m=(s?.hasAttribute('formmethod')?s.formMethod:f.method).toLowerCase();if(m==='get'){u.search='';for(const[k,v]of new FormData(f,s||undefined))u.searchParams.append(k,typeof v==='string'?v:v.name)}send(u.href,popup(s?.formTarget||f.target));form=null}catch{}},true)})();`;
}

interface IntentGuest {
  mainFrame: unknown;
  isDestroyed(): boolean;
  on(name: string, listener: (...args: any[]) => void): unknown;
  removeListener(name: string, listener: (...args: any[]) => void): unknown;
  executeJavaScriptInIsolatedWorld(world: number, scripts: { code: string }[], gesture: boolean): Promise<unknown>;
}
export function observeOwnerNavigation(guest: IntentGuest, intent: BrowserOwnerNavigation): () => void {
  let prefix = "", live = true;
  const install = () => {
    intent.document();
    prefix = `cutex-owner-navigation:${randomBytes(24).toString("hex")}:`;
    if (guest.isDestroyed()) return;
    try { void guest.executeJavaScriptInIsolatedWorld(OWNER_NAVIGATION_WORLD, [{ code: ownerNavigationScript(prefix) }], false).catch(() => {}); }
    catch { prefix = ""; } // A guest torn down during installation grants nothing.
  };
  const message = (details: { frame?: unknown; message?: unknown }) => {
    if (!live || guest.isDestroyed() || !prefix || details.frame !== guest.mainFrame || typeof details.message !== "string" || !details.message.startsWith(prefix) || details.message.length > prefix.length + 16_000) return;
    try { intent.trustedReceipt(JSON.parse(details.message.slice(prefix.length))); } catch { /* Not a receipt. */ }
  };
  const gone = () => { prefix = ""; intent.document(); };
  guest.on("dom-ready", install); guest.on("console-message", message); guest.on("render-process-gone", gone);
  install();
  return () => { live = false; prefix = ""; intent.reset(); guest.removeListener("dom-ready", install); guest.removeListener("console-message", message); guest.removeListener("render-process-gone", gone); };
}
