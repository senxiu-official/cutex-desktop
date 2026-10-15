// The host's Claude accounts for the 账户 selects (profile editor, 添加 profile form; core, so not the
// claude-accounts module's data hook): read once when shown, again on demand (an account was added
// beside the select, or cutex said the chosen one is gone). The host is the page's target host
// (lib/targetHost: Settings' host, else the focus host).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeAccount } from "../../../shared/claudeAccounts";
import { useTargetApi, useTargetHostId } from "./targetHost";

export function useClaudeAccountList(enabled = true) {
  const hostId = useTargetHostId();
  const api = useTargetApi();
  /** null until read (or when the host has no accounts route): the select then offers default + the current binding. */
  const [list, setList] = useState<ClaudeAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const alive = useRef(true);
  const current = useRef(hostId);
  current.current = hostId;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // Another host: start over (no accounts of one host offered for another).
  useEffect(() => {
    setList(null);
    setLoadError(null);
  }, [hostId]);
  const load = useCallback(async () => {
    const host = hostId;
    try {
      const reply = await api.claudeAccounts();
      if (!alive.current || current.current !== host) return;
      setList(reply ? reply.accounts : null);
      setLoadError(null);
    } catch (e) {
      if (alive.current && current.current === host) setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [api, hostId]);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  return { list, loadError, load };
}
