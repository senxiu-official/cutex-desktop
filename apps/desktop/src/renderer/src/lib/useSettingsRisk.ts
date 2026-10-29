import { useEffect, useRef, useState } from "react";
import type { AgentSecurity, AgentSecurityPatch } from "../../../shared/ipc";
import { apiFor } from "../bridge";
import { useApp } from "../store";
import { hostData } from "./hostScope";
import { useTargetHostId } from "./targetHost";
import { SettingsRiskGate, settingsRiskFingerprint } from "./settingsRisk";
import { settingsRiskText } from "./settingsRiskText";

function hostMark(hostId: string): string {
  const state = useApp.getState();
  const host = state.hosts?.hosts.find(item => item.id === hostId);
  return settingsRiskFingerprint([host?.label, host?.conn, host?.connectAs, hostData(state, hostId)?.daemon]);
}

export function useSettingsRisk(signature: unknown, local = false): SettingsRiskGate {
  const hostId = useTargetHostId();
  const gate = useRef(new SettingsRiskGate()).current;
  const mark = useApp(() => local ? "desktop" : hostMark(hostId));
  gate.update(settingsRiskFingerprint([local ? "desktop" : hostId, mark, signature]));
  useEffect(() => {
    let previous = local ? "desktop" : hostMark(hostId);
    const unsubscribe = useApp.subscribe(() => {
      const next = local ? "desktop" : hostMark(hostId);
      if (previous !== next) { previous = next; gate.invalidate(); }
    });
    return () => { unsubscribe(); gate.invalidate(); };
  }, [gate, hostId, local]);
  return gate;
}

/** Pinned host API and generation-fenced reads/writes for the security editors.
 * Do not let a focus-host proxy or a late old-host response retarget an approval. */
export function useRiskAgentSecurity(enabled: boolean) {
  const hostId = useTargetHostId();
  const [security, setSecurity] = useState<AgentSecurity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const requestOwner = useRef(0);
  const gate = useSettingsRisk([enabled]);
  const connection = useApp(() => hostMark(hostId));
  const currentHost = useRef(hostId); currentHost.current = hostId;
  useEffect(() => {
    requestOwner.current += 1;
    const valid = gate.capture();
    setSecurity(null); setError(null); setSaving(false); busy.current = false;
    if (enabled) {
      void apiFor(hostId).getSettings().then(next => { if (valid()) setSecurity(next.agentSecurity ?? null); },
        reason => { if (valid()) setError(String(reason)); });
    }
    return () => { requestOwner.current += 1; };
  }, [hostId, enabled, gate, connection]);
  const patch = async (change: AgentSecurityPatch, guard?: { expected: AgentSecurity; valid(): boolean }): Promise<boolean> => {
    if (currentHost.current !== hostId || busy.current || (guard && !guard.valid())) return false;
    const valid = gate.capture();
    const owner = ++requestOwner.current;
    busy.current = true;
    setSaving(true); setError(null);
    try {
      if (guard) {
        const current = await apiFor(hostId).getSettings();
        if (!valid() || !guard.valid()) return false;
        if (settingsRiskFingerprint(current.agentSecurity) !== settingsRiskFingerprint(guard.expected)) {
          setSecurity(current.agentSecurity ?? null);
          setError(settingsRiskText("settingsRisk.changed")); return false;
        }
      }
      if (!valid() || (guard && !guard.valid())) return false;
      const next = await apiFor(hostId).patchAgentSecurity(change);
      if (!valid()) return false;
      setSecurity(next.agentSecurity ?? null); return true;
    } catch (reason) { if (valid()) setError(String(reason)); return false; }
    // Approval expiry refuses the write, but must still release this request's
    // lock. A host reset/new request owns a different sequence and is untouched.
    finally { if (requestOwner.current === owner) { busy.current = false; setSaving(false); } }
  };
  return { security, error, saving, patch };
}
