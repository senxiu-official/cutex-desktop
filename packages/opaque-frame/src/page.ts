// Agent pages (an HTML artifact shown in artifacts.view): the agent's own HTML in an offline document.
// Unlike a plugin document there is no bootstrap bridge, no MessagePort and no nonce: the page can run
// its own inline scripts and styles, but it cannot load or send anything — loopback included — and
// it has nothing to call. The Electron host serves it with this CSP as a header too (plus
// `sandbox allow-scripts`); the meta copy keeps the same policy when a page is shown any other way.

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

/** Same bound as the artifact store's content page limit (ARTIFACT_CONTENT_MAX). */
export const OFFLINE_PAGE_MAX_BYTES = 4 * 1024 * 1024;

// CSP does not cover WebRTC; the Electron host disables UDP WebRTC and black-holes TCP / DNS for
// these frames (main/pluginNetwork.ts). Removing the constructors first is defence in depth only.
const STRIP_RTC = `for(const n of Object.getOwnPropertyNames(window)){if(/^(?:webkit)?RTC|^WebTransport/.test(n)){try{delete window[n]}catch{}}}`;

/**
 * The served document: our head (charset, CSP, referrer, RTC removal) and then the page as written.
 * A leading BOM / doctype of the page is dropped (the parser merges a later <html> / <head> into
 * ours); a page cannot loosen the policy, CSPs only add up.
 */
export function buildOfflinePageDocument(page: string): { html: string; csp: string } {
  if (typeof page !== "string") throw new Error("Page must be text");
  if (new TextEncoder().encode(page).length > OFFLINE_PAGE_MAX_BYTES) throw new Error("Page too large");
  const body = page.replace(/^﻿?\s*(?:<!doctype[^>]*>)?/i, "");
  const head = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${OFFLINE_PAGE_CSP}"><meta name="referrer" content="no-referrer"><script>${STRIP_RTC}</script>`;
  return { html: head + body, csp: OFFLINE_PAGE_CSP };
}
