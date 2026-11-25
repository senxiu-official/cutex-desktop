// WhatsApp (owner-only service, backend feat/whatsapp-browser-notifications): main watches one owner browser
// tab on the official https://web.whatsapp.com/ page on THIS desktop and posts generic service notifications.
// The renderer only reads main's watcher view (tab key, on/off, preview, status enum) and opens the tab;
// it never reads page content, QR codes or message text, and the tab is never offered to agents.
//
// 打开 WhatsApp: the saved tab key, else a fresh owner key main reserves (reserveOwnerTab: owner provenance
// lives in main); the tab opens in the owner's side area, and once main has mounted it on the WhatsApp page the
// key is bound with setWhatsAppWatch (main refuses a second key).
import { create } from "zustand";
import { LOCAL_HOST_ID } from "../../../../shared/hosts";
import { bridge } from "../../bridge";
import type { ModuleServices } from "../slots";
import { WHATSAPP_URL, type WhatsAppWatch } from "./model";

/** The browser module's tab component (lib/sideKinds names only its service card). */
const BROWSER_TAB = "browser.tab";
const BIND_WAIT_MS = 30_000;
const BIND_STEP_MS = 750;

/** The calls this module uses (HostBrowserBridge; the WhatsApp ones are optional there: an older desktop main lacks them). */
export interface WhatsAppBridge {
  whatsAppWatch(): Promise<WhatsAppWatch>;
  setWhatsAppWatch(tabKey: string, enabled: boolean, preview: boolean): Promise<WhatsAppWatch>;
  unbindWhatsAppWatch?(tabKey: string): Promise<WhatsAppWatch>;
  reserveOwnerTab(): Promise<{ tabKey: string }>;
  list(): Promise<{ tabKey: string; url: string }[]>;
}

/** The preview's stand-in (mock.ts installs it; never in a production bundle). */
declare global {
  interface Window {
    __cutexMockWhatsApp?: WhatsAppBridge;
  }
}

/** main's watcher on this desktop; null = this app has none (older desktop main, or no browser). */
export function whatsAppBridge(): WhatsAppBridge | null {
  const host = bridge.browser?.forHost(LOCAL_HOST_ID);
  if (host?.whatsAppWatch && host.setWhatsAppWatch) {
    const { whatsAppWatch, setWhatsAppWatch, unbindWhatsAppWatch } = host;
    return {
      whatsAppWatch: () => whatsAppWatch.call(host),
      setWhatsAppWatch: (tabKey, enabled, preview) => setWhatsAppWatch.call(host, tabKey, enabled, preview),
      ...(unbindWhatsAppWatch ? { unbindWhatsAppWatch: (tabKey: string) => unbindWhatsAppWatch.call(host, tabKey) } : {}),
      reserveOwnerTab: () => host.reserveOwnerTab(),
      list: () => host.list(),
    };
  }
  if (import.meta.env.DEV && !bridge.browser && typeof window !== "undefined") return window.__cutexMockWhatsApp ?? null;
  return null;
}

interface WatchStore {
  watch: WhatsAppWatch | null;
  /** The bridge exists (false: hide the WhatsApp parts). */
  available: boolean;
  error: string | null;
  opening: boolean;
}

export const useWhatsApp = create<WatchStore>(() => ({ watch: null, available: false, error: null, opening: false }));

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function refreshWhatsApp(): Promise<void> {
  const api = whatsAppBridge();
  if (!api) return useWhatsApp.setState({ available: false, watch: null });
  try {
    useWhatsApp.setState({ available: true, watch: await api.whatsAppWatch(), error: null });
  } catch (e) {
    useWhatsApp.setState({ available: true, error: errorText(e) });
  }
}

/** Polls main's view while something shows it (status changes come from the page, not from the owner). */
export function watchWhatsApp(signal: AbortSignal, everyMs = 5_000): void {
  void refreshWhatsApp();
  const timer = setInterval(() => void refreshWhatsApp(), everyMs);
  signal.addEventListener("abort", () => clearInterval(timer));
}

export async function setWhatsAppPreview(preview: boolean): Promise<void> {
  const api = whatsAppBridge();
  const w = useWhatsApp.getState().watch;
  if (!api || !w?.tabKey) return;
  try {
    useWhatsApp.setState({ watch: await api.setWhatsAppWatch(w.tabKey, w.enabled, preview), error: null });
  } catch (e) {
    useWhatsApp.setState({ error: errorText(e) });
  }
}

/** 停止读取 / 恢复读取: keeps the tab key (re-linking reuses the same owner tab). */
export async function setWhatsAppEnabled(enabled: boolean): Promise<void> {
  const api = whatsAppBridge();
  const w = useWhatsApp.getState().watch;
  if (!api || !w?.tabKey) return;
  try {
    useWhatsApp.setState({ watch: await api.setWhatsAppWatch(w.tabKey, enabled, w.preview), error: null });
  } catch (e) {
    useWhatsApp.setState({ error: errorText(e) });
  }
}

/**
 * 解除绑定: main forgets the tab (tabKey null, reading off); the page, the WhatsApp login and the history stay. The next
 * 打开 WhatsApp binds a fresh owner tab. Closing the bound tab releases it too (main), seen on the next refresh.
 */
export function canUnbindWhatsApp(): boolean {
  return !!whatsAppBridge()?.unbindWhatsAppWatch && !!useWhatsApp.getState().watch?.tabKey;
}

export async function unbindWhatsApp(): Promise<void> {
  const api = whatsAppBridge();
  const w = useWhatsApp.getState().watch;
  if (!api?.unbindWhatsAppWatch || !w?.tabKey) return;
  try {
    useWhatsApp.setState({ watch: await api.unbindWhatsAppWatch(w.tabKey), error: null });
  } catch (e) {
    useWhatsApp.setState({ error: errorText(e) });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const onWhatsApp = (url: string) => {
  try {
    return new URL(url).origin === new URL(WHATSAPP_URL).origin;
  } catch {
    return false;
  }
};

/**
 * 打开 WhatsApp: shows the owner tab (re-opening a closed one with its key) and binds it the first time.
 * Returns false when the tab could not open (browser module off): the caller says so.
 */
export async function openWhatsApp(side: Pick<ModuleServices["side"], "open">): Promise<boolean> {
  const api = whatsAppBridge();
  if (!api) return false;
  useWhatsApp.setState({ opening: true, error: null });
  try {
    const current = useWhatsApp.getState().watch ?? (await api.whatsAppWatch());
    const tabKey = current.tabKey ?? (await api.reserveOwnerTab()).tabKey;
    const opened = side.open(BROWSER_TAB, { url: WHATSAPP_URL, tabKey, ownerTab: true }, { binding: { kind: "host", hostId: LOCAL_HOST_ID }, reveal: true, focus: true });
    if (opened.status !== "opened") return false;
    if (current.tabKey === tabKey && current.enabled) return true;
    // First time (or after 停止读取): bind once main has mounted the tab on the WhatsApp page.
    const until = Date.now() + BIND_WAIT_MS;
    while (Date.now() < until) {
      const tabs = await api.list().catch(() => []);
      if (tabs.some((t) => t.tabKey === tabKey && onWhatsApp(t.url))) {
        useWhatsApp.setState({ watch: await api.setWhatsAppWatch(tabKey, true, current.preview) });
        return true;
      }
      await sleep(BIND_STEP_MS);
    }
    useWhatsApp.setState({ error: "timeout" });
    return true;
  } catch (e) {
    useWhatsApp.setState({ error: errorText(e) });
    return true;
  } finally {
    useWhatsApp.setState({ opening: false });
  }
}
