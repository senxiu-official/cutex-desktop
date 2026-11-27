// Small view helpers for Settings → 你 → 设置同步 (components/settings/SettingsSync.tsx).
import { create } from "zustand";
import type { MessageKey } from "../../i18n";
import type { SettingsSyncState } from "./engine";

/** 「以后再说」 hides the question for these categories until the app starts again. */
const useDismissed = create<{ ids: ReadonlySet<string> }>(() => ({ ids: new Set() }));
export const useSyncAskDismissed = (): ReadonlySet<string> => useDismissed((s) => s.ids);
export function dismissSyncAsk(ids: readonly string[]): void {
  useDismissed.setState((s) => ({ ids: new Set([...s.ids, ...ids]) }));
}

/** The one line under 记忆主机: where the synced settings are and how current this computer is. */
export function syncStatusLine(s: SettingsSyncState, locale: string): { key: MessageKey; vars?: Record<string, string | number> } {
  const host = s.memoryHost?.label ?? "";
  switch (s.status) {
    case "noHost": return { key: "settingsSync.status.noHost" };
    case "missing": return { key: "settingsSync.status.missing", vars: { host } };
    case "offline": return { key: "settingsSync.status.offline", vars: { host } };
    case "unsupported": return { key: "settingsSync.status.unsupported", vars: { host } };
    case "loading": return { key: "settingsSync.status.loading", vars: { host } };
    case "synced":
      if (s.pending > 0) return { key: "settingsSync.status.pending", vars: { n: s.pending } };
      if (s.lastSync) return { key: "settingsSync.status.lastSync", vars: { time: new Date(s.lastSync).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) } };
      return { key: "settingsSync.status.synced" };
  }
}
