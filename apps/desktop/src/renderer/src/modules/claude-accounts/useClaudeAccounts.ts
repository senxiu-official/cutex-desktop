// Data for Settings → Profile → Claude 账户: the connected host's accounts (`GET /v2/claude/accounts`)
// and each account's quota, read through one profile bound to it (`GET /v2/profiles/{p}/quota`: 5h /
// 7d windows, or the API usage totals of an API account). Loaded when the section shows and after
// each change; no polling (the section component is keyed by host, so a host switch starts over).
import { useCallback, useEffect, useRef, useState } from "react";
import { claudeAccountQuota, type ClaudeAccount, type ClaudeAccountQuota } from "../../../../shared/claudeAccounts";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { useHostData } from "../../lib/useHostScope";

export interface AccountsData {
  /** null until the first reply. */
  list: ClaudeAccount[] | null;
  /** The daemon has no accounts route (404 / 405). */
  unsupported: boolean;
  error: string | null;
  loading: boolean;
}

/** Per account id: undefined = not read (no bound profile), null = no Claude reading. */
export type AccountQuotas = Record<string, ClaudeAccountQuota | null | undefined>;

/** One re-read after cutex said it is reading the account right now. */
const REFRESHING_REREAD_MS = 4000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useClaudeAccounts() {
  const api = useTargetApi();
  const connected = useHostData(useTargetHostId())?.daemon.kind === "connected";
  const [data, setData] = useState<AccountsData>({ list: null, unsupported: false, error: null, loading: false });
  const [quotas, setQuotas] = useState<AccountQuotas>({});
  const alive = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const loadQuota = useCallback(async (account: ClaudeAccount, reread = true) => {
    const profile = account.profiles[0]?.id;
    if (!profile) {
      setQuotas((q) => ({ ...q, [account.id]: undefined }));
      return;
    }
    try {
      const quota = claudeAccountQuota(await api.profileQuotaDetail(profile));
      if (!alive.current) return;
      setQuotas((q) => ({ ...q, [account.id]: quota }));
      if (quota?.refreshing && reread) {
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          if (alive.current) void loadQuota(account, false);
        }, REFRESHING_REREAD_MS);
        timers.current.add(timer);
      }
    } catch {
      // keep the last reading
    }
  }, []);

  const load = useCallback(async () => {
    setData((d) => ({ ...d, loading: true }));
    try {
      const reply = await api.claudeAccounts();
      if (!alive.current) return;
      if (!reply) {
        setData({ list: null, unsupported: true, error: null, loading: false });
        return;
      }
      setData({ list: reply.accounts, unsupported: false, error: null, loading: false });
      for (const account of reply.accounts) void loadQuota(account);
    } catch (error) {
      if (alive.current) setData((d) => ({ ...d, error: message(error), loading: false }));
    }
  }, [loadQuota]);

  useEffect(() => {
    if (connected) void load();
  }, [connected, load]);

  /** Put a fresh item from a mutation reply into the list (appended when new). */
  const put = useCallback((account: ClaudeAccount) => {
    setData((d) => {
      if (!d.list) return d;
      const i = d.list.findIndex((a) => a.id === account.id);
      const list = i < 0 ? [...d.list, account] : d.list.map((a) => (a.id === account.id ? account : a));
      return { ...d, list };
    });
  }, []);

  const drop = useCallback((id: string) => {
    setData((d) => (d.list ? { ...d, list: d.list.filter((a) => a.id !== id) } : d));
    setQuotas((q) => {
      const next = { ...q };
      delete next[id];
      return next;
    });
  }, []);

  return { ...data, quotas, load, loadQuota, put, drop };
}
