// Opening an agent from text another party wrote (scoped Markdown: a 备忘) never changes the device scope: an agent of
// the focus host or of a host in the current scope opens in place; for one outside it openAgent would widen the scope
// to 所有设备 (main keeps that and picks the active host again), so the caller says why instead.
import { scopeHosts } from "../../../shared/hosts";
import { useApp } from "../store";

export function inViewScope(hostId: string): boolean {
  const hosts = useApp.getState().hosts;
  return !hosts || hostId === hosts.active || scopeHosts(hosts).includes(hostId);
}

/** false: the host is outside the scope and nothing was opened. */
export function openAgentInScope(sessionId: string, hostId: string): boolean {
  if (!inViewScope(hostId)) return false;
  void useApp.getState().openAgent(sessionId, hostId);
  return true;
}
