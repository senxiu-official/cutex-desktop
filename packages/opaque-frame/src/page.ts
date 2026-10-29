// Agent pages (an HTML artifact shown in artifacts.view): the agent's own HTML in an offline document.
// Unlike a plugin document there is no bootstrap bridge, no MessagePort and no nonce: the page can run
// its own inline scripts and styles, but it cannot load or send anything — loopback included. With
// `pageApi` it gets `window.cutexPage` (below): fixed-schema postMessage requests to its parent for
// its own storage, submit-after-owner-confirm and copy-during-a-gesture, all decided by the app.
// The Electron host serves it with this CSP as a header too (plus `sandbox allow-scripts`); the meta copy keeps the same policy when a page is shown any other way.
/** No network at all: inline script / style, data: / blob: images, fonts and media only. */
export const OFFLINE_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Default bound: the artifact store's content page limit (ARTIFACT_CONTENT_MAX); a caller that read a page in
 * several windows passes its own (larger) bound. */
export const OFFLINE_PAGE_MAX_BYTES = 4 * 1024 * 1024;

// CSP does not cover WebRTC; the Electron host disables UDP WebRTC and black-holes TCP / DNS for
// these frames (main/pluginNetwork.ts). Removing the constructors first is defence in depth only.
const STRIP_RTC = `for(const n of Object.getOwnPropertyNames(window)){if(/^(?:webkit)?RTC|^WebTransport/.test(n)){try{delete window[n]}catch{}}}`;

/**
 * The served document: our head (charset, CSP, referrer, RTC removal) and then the page as written.
 * A leading BOM / doctype of the page is dropped (the parser merges a later <html> / <head> into
 * ours); a page cannot loosen the policy, CSPs only add up.
 */
export function buildOfflinePageDocument(page: string, maxBytes = OFFLINE_PAGE_MAX_BYTES, options: { pageApi?: boolean } = {}): { html: string; csp: string } {
  if (typeof page !== "string") throw new Error("Page must be text");
  if (new TextEncoder().encode(page).length > maxBytes) throw new Error("Page too large");
  const body = page.replace(/^﻿?\s*(?:<!doctype[^>]*>)?/i, "");
  const head = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${OFFLINE_PAGE_CSP}"><meta name="referrer" content="no-referrer"><script>${STRIP_RTC}</script>${options.pageApi ? `<script>${PAGE_API_SCRIPT}</script>` : ""}`;
  return { html: head + body, csp: OFFLINE_PAGE_CSP };
}

// ---------- page API ----------
// The page side of an agent page's three channels (docs/desktop-modules.md §10.2): `window.cutexPage`,
// a thin promise wrapper over `parent.postMessage` with the fixed message schema the app's broker checks
// (apps/desktop shared/pageBridge.ts, tag `cutex-page/1`). It grants nothing by itself: a page could post
// the same messages by hand, and the app decides every one (main checks sizes, binds storage to this
// artifact, shows its own confirm dialog for submit, copies only during a user gesture). No network,
// MessagePort, nonce or token is involved. Outside Cutex the script is not there: pages test
// `window.cutexPage` and fall back (e.g. to localStorage / a copy box).

/** Same tag as the app's broker. */
export const PAGE_API_TAG = "cutex-page/1";

// Storage values are JSON (stringified here, parsed back on get); a submit is text or JSON.
const SOURCE = `(()=>{if(window.parent===window||window.cutexPage)return;const P=window.parent,T=${JSON.stringify(PAGE_API_TAG)},W=new Map();let n=0;
addEventListener("message",e=>{const d=e.data;if(e.source!==P||!d||d.tag!==T||typeof d.re!=="number")return;const w=W.get(d.re);if(!w)return;W.delete(d.re);clearTimeout(w.t);
if(d.ok)w.ok(d);else{const x=new Error(String(d.error||"unavailable"));x.code=String(d.error||"unavailable");if(d.scope)x.scope=d.scope;if(d.limit)x.limit=d.limit;w.no(x)}});
const call=(op,f,ms)=>new Promise((ok,no)=>{const id=++n,t=ms?setTimeout(()=>{W.delete(id);const x=new Error("unavailable");x.code="unavailable";no(x)},ms):0;W.set(id,{ok,no,t});P.postMessage(Object.assign({tag:T,id,op},f),"*")});
const parse=v=>{if(v==null)return null;try{return JSON.parse(v)}catch{return v}};
const storage=Object.freeze({get:k=>call("storage.get",{key:String(k)},15e3).then(d=>parse(d.value)),
set:(k,v)=>v===undefined?storage.remove(k):call("storage.set",{key:String(k),value:JSON.stringify(v)},15e3).then(()=>{}),
remove:k=>call("storage.remove",{key:String(k)},15e3).then(()=>{}),keys:()=>call("storage.keys",{},15e3).then(d=>d.value||[]),clear:()=>call("storage.clear",{},15e3).then(()=>{})});
const api=Object.freeze({available:true,version:1,storage,
submit:c=>call("submit",typeof c==="string"?{format:"text",text:c}:{format:"json",text:JSON.stringify(c,null,2)},0).then(d=>({sent:d.sent===true})),
copy:t=>call("copy",{text:String(t)},5e3).then(()=>{})});
Object.defineProperty(window,"cutexPage",{value:api,enumerable:true})})();`;

/** Inline script that defines `window.cutexPage` (runs before the page's own scripts). */
export const PAGE_API_SCRIPT = SOURCE;
