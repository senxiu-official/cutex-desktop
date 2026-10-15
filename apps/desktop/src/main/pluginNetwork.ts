// Network containment for external plugin frames (docs/desktop-modules.md §10.1).
//
// Plugin documents are opaque, sandboxed subframes of the app window, so they share its
// webContents and the default session. CSP covers fetch / XHR / WebSocket / EventSource /
// beacon / WebTransport / media / CSS / fonts, but not WebRTC (STUN/TURN over UDP and TCP,
// ICE-TCP to remote candidates) and not <link rel=dns-prefetch> (a speculative DNS lookup in
// the network service). Those are closed here, in Chromium, rather than in page script, which a
// plugin could sidestep (e.g. through a same-origin about:blank child frame).
//
// - Every webContents gets the WebRTC IP policy `disable_non_proxied_udp` (no UDP at all).
//   The app itself never uses WebRTC, so this is unconditional.
// - Before the first plugin document is served, the default session gets a black-hole proxy
//   (TCP: TURN-over-TCP, ICE-TCP, preconnect) and the network service a secure-only DNS
//   resolver pointing at a dead endpoint (no plaintext DNS: dns-prefetch, TURN hostnames).
//   The app's own renderer only loads file:// (or the dev server) and the main process talks to
//   daemons through Node, so this does not change the app; the one Chromium download it does
//   stop is Linux hunspell spellchecker dictionaries, for the rest of that app run.
//   It is lazy so that an owner who never opens a plugin page keeps Chromium networking as is.

/** Port 9 (discard) is on Chromium's unsafe-port list and nothing listens there. */
export const BLACKHOLE = "127.0.0.1:9";
export const PLUGIN_WEBRTC_POLICY = "disable_non_proxied_udp" as const;

export interface LockdownProxy { mode: "fixed_servers"; proxyRules: string; proxyBypassRules: string }

/** Everything through a dead SOCKS proxy, loopback included, except the dev renderer server. */
export function lockdownProxy(devRendererUrl?: string): LockdownProxy {
  const bypass = ["<-loopback>"];
  if (devRendererUrl) {
    try {
      const url = new URL(devRendererUrl);
      const port = url.port || (url.protocol === "https:" ? "443" : "80");
      if (url.hostname) bypass.push(`${url.hostname}:${port}`);
    } catch { /* No dev bypass for an unparsable URL. */ }
  }
  return { mode: "fixed_servers", proxyRules: `socks5://${BLACKHOLE}`, proxyBypassRules: bypass.join(";") };
}

export const LOCKDOWN_DNS = {
  enableBuiltInResolver: true,
  secureDnsMode: "secure" as const,
  secureDnsServers: [`https://${BLACKHOLE}/dns-query{?dns}`],
};

interface LockdownDeps {
  setProxy(config: LockdownProxy): Promise<void>;
  configureHostResolver(options: typeof LOCKDOWN_DNS): void;
  devRendererUrl?: string;
}

/** Idempotent; a failed attempt is retried by the next call and never reports success. */
export function createPluginNetworkLockdown(deps: LockdownDeps) {
  let done: Promise<void> | null = null;
  let engaged = false;
  return {
    /** Containment has been started in this run (its process-wide DNS setting stays until exit). */
    engaged: (): boolean => engaged,
    ensure(): Promise<void> {
      engaged = true;
      done ??= (async () => {
        deps.configureHostResolver(LOCKDOWN_DNS);
        await deps.setProxy(lockdownProxy(deps.devRendererUrl));
      })().catch(error => { done = null; throw error; });
      return done;
    },
  };
}
