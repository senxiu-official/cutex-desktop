// Settings hook for agentSecurity (helpers in agentSecurity.ts).
import { useEffect, useState } from "react";
import type { AgentSecurity, AgentSecurityPatch } from "../../../shared/ipc";
import { useTargetApi } from "./targetHost";

/** `agentSecurity` from the target host's `/v2/settings` (lib/targetHost) and a patcher (errors kept for the page to show). */
export function useAgentSecurity(enabled: boolean): { security: AgentSecurity | null; error: string | null; saving: boolean; patch(p: AgentSecurityPatch): Promise<boolean> } {
  const [security, setSecurity] = useState<AgentSecurity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const api = useTargetApi();
  useEffect(() => {
    if (!enabled) return;
    api.getSettings().then(
      (s) => setSecurity(s.agentSecurity ?? null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [api, enabled]);
  const patch = async (p: AgentSecurityPatch) => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.patchAgentSecurity(p);
      setSecurity(next.agentSecurity ?? null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { security, error, saving, patch };
}
