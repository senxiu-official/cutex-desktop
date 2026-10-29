/**
 * cutex's own pages take the app's light / dark (owner 2026-10-23: 「我们的页面跟我们的，别人的他自己」): a browser
 * tab showing a cutex service is told the APP's colour scheme (`prefers-color-scheme`); every other site keeps the
 * OS preference, like a normal browser. `nativeTheme.themeSource` is never touched (that would change every site).
 *
 * Per guest, through the guest's CDP session (`Emulation.setEmulatedMedia`), only while it is wanted — an own page
 * whose app scheme differs from the OS one; otherwise nothing is attached or sent. The debugger is exclusive and the
 * agent provider and a background carrier's dialog guard own it first: this never takes it from them. It attaches
 * only when nobody holds it (and the caller allows: not on a carrier, whose guard must own it), lets go before the
 * provider attaches (`yieldTo`), and sends through whoever holds it otherwise; a new session (provider attach,
 * guard resume) starts without emulation, so the hooks call `resync`.
 */
export type PageScheme = "light" | "dark";

export interface SchemeDebugger {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  detach(): void;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
}
export interface SchemeGuest {
  isDestroyed(): boolean;
  debugger: SchemeDebugger;
}

/** What an own page must be told: the app's scheme when the page would not see it anyway (the OS differs), else nothing. */
export function wantedScheme(own: boolean, app: PageScheme, os: PageScheme): PageScheme | null {
  return own && app !== os ? app : null;
}

/** `Emulation.setEmulatedMedia` parameters: the scheme, or "" (no override). */
export function emulatedMediaParams(scheme: PageScheme | null): Record<string, unknown> {
  return { features: [{ name: "prefers-color-scheme", value: scheme ?? "" }] };
}

export interface GuestSchemeEmulation {
  readonly wanted: PageScheme | null;
  /** The scheme this guest's page should see now (null = its own, the OS one). */
  set(scheme: PageScheme | null): void;
  /** A debugger session began or ended (provider attach / detach, guard resume): send again. */
  resync(): void;
  /** Another holder is about to attach: let go of a session this owns. */
  yieldTo(): void;
  dispose(): void;
}

export function emulateGuestScheme(guest: SchemeGuest, options: { canOwn(): boolean }): GuestSchemeEmulation {
  const debug = guest.debugger;
  let wanted: PageScheme | null = null;
  let owned = false;
  let disposed = false;
  /** What the current session holds (undefined = unknown: send). */
  let sent: PageScheme | null | undefined;
  const send = (scheme: PageScheme | null) => {
    if (sent === scheme) return;
    sent = scheme;
    void Promise.resolve(debug.sendCommand("Emulation.setEmulatedMedia", emulatedMediaParams(scheme))).catch(() => {
      sent = undefined;
    });
  };
  const release = () => {
    if (!owned) return;
    owned = false;
    sent = undefined;
    try {
      if (!guest.isDestroyed() && debug.isAttached()) debug.detach();
    } catch {
      /* Already detached. */
    }
  };
  const sync = () => {
    if (disposed || guest.isDestroyed()) return;
    if (debug.isAttached()) {
      // Ours and no longer wanted: detaching ends the emulation with the session.
      if (owned && !wanted) return release();
      // Someone else's session (agent binding, carrier guard), or ours: set it, or clear what this session got.
      if (wanted) send(wanted);
      else if (sent) send(null);
      return;
    }
    // Not attached (ours was detached from outside, or another holder let go): no emulation is in force.
    owned = false;
    sent = undefined;
    if (!wanted || !options.canOwn()) return;
    try {
      debug.attach("1.3");
      owned = true;
    } catch {
      return;
    }
    send(wanted);
  };
  return {
    get wanted() {
      return wanted;
    },
    set(scheme) {
      wanted = scheme;
      sync();
    },
    resync() {
      sent = undefined;
      sync();
    },
    yieldTo: release,
    dispose() {
      disposed = true;
      release();
    },
  };
}
