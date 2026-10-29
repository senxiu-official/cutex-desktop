// Kimi accounts (cutex `kimi-accounts`, r266; docs/design/049) as core code sees them: the 添加 Profile form's and the
// Profile editor's Kimi 账户 select (core) and the Kimi 账户 section of Settings → Profile (the kimi-accounts module)
// both read the host's accounts from here (modules never import each other; core never imports a module).
import { useCallback, useEffect, useRef, useState } from "react";
import type { KimiAccount } from "../../../shared/kimiAccounts";
import { useTargetApi, useTargetHostId } from "./targetHost";

/** The kimi-accounts module's `settings.section` id on page `profiles` (also its settings anchor). */
export const KIMI_ACCOUNTS_SECTION = "kimi-accounts.accounts";

/** The host's Kimi accounts, read when shown and again on demand (`load`). null: not read / no route. */
export function useKimiAccountList(enabled = true) {
  const hostId = useTargetHostId();
  const api = useTargetApi();
  const [list, setList] = useState<KimiAccount[] | null>(null);
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
  useEffect(() => {
    setList(null);
    setLoadError(null);
  }, [hostId]);
  const load = useCallback(async () => {
    const host = hostId;
    try {
      const reply = await api.kimiAccounts();
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

export interface KimiAccountOption {
  id: string;
  label: string;
  /** Logged in now (a usable OAuth credential is stored). */
  ready: boolean;
  /** The chosen id is not in the host's list. */
  missing: boolean;
}

/** Select options: the host's accounts, plus the current choice when the list does not have it. */
export function kimiAccountOptions(list: readonly KimiAccount[] | null, current: string | null): KimiAccountOption[] {
  const out: KimiAccountOption[] = (list ?? []).map((a) => ({ id: a.id, label: a.label, ready: a.credentialsPresent, missing: false }));
  if (current && !out.some((o) => o.id === current)) out.push({ id: current, label: current, ready: false, missing: true });
  return out;
}
