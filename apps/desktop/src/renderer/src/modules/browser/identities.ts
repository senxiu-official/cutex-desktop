// 浏览器身份 in the renderer (design browser-profiles v3): main's identity list, the switcher's current identity and
// the global prefs, kept fresh by browserIdentityEvent. Display data only; every change is a request main re-checks.
// A main without the identities service answers unsupported_operation: `supported` stays false and the UI shows
// today's single (default) identity.
import { create } from "zustand";
import { bridge } from "../../bridge";
import {
  DEFAULT_BROWSER_IDENTITY_ID, DEFAULT_BROWSER_IDENTITY_PREFS,
  type BrowserIdentityBridge, type BrowserIdentityEvent, type BrowserIdentityPrefs, type BrowserIdentityState, type BrowserIdentityView,
} from "../../../../shared/browserIdentity";

interface IdentityStore {
  supported: boolean;
  state: BrowserIdentityState | null;
  prefs: BrowserIdentityPrefs;
  /** Last request error code (shown inline where the request was made). */
  error: string | null;
}

export const useBrowserIdentities = create<IdentityStore>(() => ({ supported: false, state: null, prefs: { ...DEFAULT_BROWSER_IDENTITY_PREFS }, error: null }));

/** Which identity the Settings sub-pages (identity / passwords) show; null = the default one. */
export const useIdentityPage = create<{ id: string | null }>(() => ({ id: null }));

export const identityBridge = (): BrowserIdentityBridge | undefined => bridge.browser?.identities ?? previewBridge();
/** Dev preview only (mock.ts `?browserIdentities`): the in-memory identities while the preview has no browser bridge. */
const previewBridge = (): BrowserIdentityBridge | undefined =>
  import.meta.env.DEV && typeof window !== "undefined" ? (window as { __cutexPreviewBrowserIdentities?: BrowserIdentityBridge }).__cutexPreviewBrowserIdentities : undefined;

const errorCode = (e: unknown): string => {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, "");
};

/** Reads the list and prefs once and follows main's events; returns the unsubscribe. */
export function watchBrowserIdentities(): () => void {
  const ids = identityBridge();
  if (!ids) return () => {};
  let live = true;
  void ids.state().then((state) => {
    if (live) useBrowserIdentities.setState({ supported: true, state });
  }, () => { if (live) useBrowserIdentities.setState({ supported: false, state: null }); });
  void ids.prefs().then((prefs) => { if (live) useBrowserIdentities.setState({ prefs }); }, () => {});
  const off = ids.subscribe((event: BrowserIdentityEvent) => {
    if (event.kind === "identities") useBrowserIdentities.setState({ supported: true, state: event.state });
    for (const listener of extra) listener(event);
  });
  return () => { live = false; off(); };
}

const extra = new Set<(event: BrowserIdentityEvent) => void>();
/** Other parts of the module (history page, password prompts) follow the same event stream. */
export function onBrowserIdentityEvent(listener: (event: BrowserIdentityEvent) => void): () => void {
  extra.add(listener);
  return () => extra.delete(listener);
}

/** Runs an identity request; records its error code (and rethrows) so the caller's row can show it. */
export async function identityRequest<T>(run: (ids: BrowserIdentityBridge) => Promise<T>): Promise<T> {
  const ids = identityBridge();
  if (!ids) throw new Error("unsupported_operation");
  try {
    const value = await run(ids);
    useBrowserIdentities.setState({ error: null });
    return value;
  } catch (e) {
    useBrowserIdentities.setState({ error: errorCode(e) });
    throw e;
  }
}

export async function setBrowserPrefs(patch: Partial<BrowserIdentityPrefs>): Promise<void> {
  const prefs = await identityRequest((ids) => ids.prefs(patch));
  useBrowserIdentities.setState({ prefs });
}

export function identityById(id: string | undefined | null): BrowserIdentityView | undefined {
  const list = useBrowserIdentities.getState().state?.identities;
  return list?.find((i) => i.id === (id || DEFAULT_BROWSER_IDENTITY_ID));
}

/** The identity new owner tabs use. */
export const currentIdentityId = (): string => useBrowserIdentities.getState().state?.current ?? DEFAULT_BROWSER_IDENTITY_ID;

/** Several identities exist: the switcher, chips and tints show (one identity = today's look, no new chrome). */
export const useIdentitiesShown = (): boolean => useBrowserIdentities((s) => s.supported && (s.state?.identities.length ?? 0) > 1);

export function useIdentity(id: string | undefined | null): BrowserIdentityView | undefined {
  return useBrowserIdentities((s) => s.state?.identities.find((i) => i.id === (id || DEFAULT_BROWSER_IDENTITY_ID)));
}

/** The CSS colour of an identity (theme variable; light / dark pairs in styles.css); undefined = untinted. */
export const identityColor = (view: Pick<BrowserIdentityView, "color"> | undefined): string | undefined =>
  view?.color ? `var(--identity-${view.color})` : undefined;
