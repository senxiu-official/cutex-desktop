// main keeps its own copy of the WhatsApp module switch (userData/whatsapp-module.json; main/browser/whatsAppObserver.ts)
// and decides from it — it never waits for the renderer to stop. This app-side glue keeps that copy in step with the
// owner's module choice (Settings → 模块):
// 1. Once (marker key): an install whose WhatsApp watch was already on (main's own migration turned its copy on) and
//    that has no saved choice for `whatsapp` keeps the module on — the module is new and off by default.
// 2. Then main gets the module's state now and on every change.
// Not module code: a module that is off never runs, so this lives with the module host (modules/app.ts).
import { MODULES_PREFS_KEY, type KeyValueStorage } from "./types";

export const WHATSAPP_MODULE_ID = "whatsapp";
export const WHATSAPP_MIGRATION_MARKER = "cutex-desktop.modules.migrate.whatsapp-on";

export interface WhatsAppModuleBridge {
  whatsAppModule?(enabled?: boolean): Promise<{ enabled: boolean }>;
}

export interface WhatsAppModuleHost {
  isEnabled(id: string): boolean;
  setEnabled(id: string, on: boolean): unknown;
  subscribe(listener: () => void): () => void;
}

/** The saved choice for `whatsapp` in the module prefs record, if the owner ever made one. */
function savedChoice(storage: KeyValueStorage): boolean | undefined {
  try {
    const value = JSON.parse(storage.getItem(MODULES_PREFS_KEY) ?? "null") as { enabled?: Record<string, unknown> } | null;
    const choice = value?.enabled?.[WHATSAPP_MODULE_ID];
    return typeof choice === "boolean" ? choice : undefined;
  } catch {
    return undefined;
  }
}

/** Runs once the module host is up; returns the unsubscribe. A desktop main without the call: nothing to do. */
export async function syncWhatsAppModule(host: WhatsAppModuleHost, storage: KeyValueStorage, browser: WhatsAppModuleBridge | null | undefined): Promise<() => void> {
  const call = browser?.whatsAppModule?.bind(browser);
  if (!call) return () => {};
  if (storage.getItem(WHATSAPP_MIGRATION_MARKER) === null) {
    try {
      const main = await call();
      if (main.enabled && savedChoice(storage) === undefined && !host.isEnabled(WHATSAPP_MODULE_ID)) await host.setEnabled(WHATSAPP_MODULE_ID, true);
      storage.setItem(WHATSAPP_MIGRATION_MARKER, "1");
    } catch {
      // main unreachable right now: try again on the next start (nothing is sent until then).
      return () => {};
    }
  }
  let sent: boolean | null = null;
  const send = () => {
    const on = host.isEnabled(WHATSAPP_MODULE_ID);
    if (on === sent) return;
    sent = on;
    void call(on).catch(() => { sent = null; });
  };
  send();
  return host.subscribe(send);
}
