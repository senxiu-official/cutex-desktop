// cutex global settings (`GET / PATCH /v2/settings`) for the Settings pages: load once, patch
// field by field, remember a restart notice when cutex says a change needs a daemon restart.
import { useEffect, useState } from "react";
import type { GlobalSettings } from "../../../shared/ipc";
import { useTargetApi } from "./targetHost";

/** cutex `agent-harness` (r218): 指令 → 运行环境说明; the agent message templates are gone. */
export const AGENT_HARNESS_FEATURE = "agent-harness";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useGlobalSettings() {
  const api = useTargetApi();
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    api.getSettings().then(setSettings, (e: unknown) => setError(errorText(e)));
  }, []);
  const patch = async (p: Partial<GlobalSettings>, restartNotice?: string) => {
    setError(null);
    try {
      const next = await api.patchSettings(p);
      setSettings(next);
      setNotice(next.restartRequired?.length && restartNotice ? restartNotice : null);
    } catch (e) {
      setError(errorText(e));
    }
  };
  /** Replace the view with one a narrower PATCH returned (patchOwnerNotify, …). */
  return { settings, error, notice, patch, replace: setSettings };
}
