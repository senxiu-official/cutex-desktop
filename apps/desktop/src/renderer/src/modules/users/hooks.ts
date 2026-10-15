// Data of Settings → 用户 for the settings target host (lib/targetHost): `GET /v2/users` (users, every
// token with its binding, peers, settings), re-read after each write and on `cutex/access/changed`
// (another owner device may have changed bindings). Writes come back as values (UsersResult).
import { useCallback, useEffect, useRef, useState } from "react";
import type { UsersList, UsersResult } from "../../../../shared/users";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { useHostData } from "../../lib/useHostScope";
import { refusalText } from "./model";

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface UsersData {
  list: UsersList | null;
  unsupported: boolean;
  error: string | null;
}

export function useUsers() {
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const connected = useHostData(hostId)?.daemon.kind === "connected";
  const [data, setData] = useState<UsersData>({ list: null, unsupported: false, error: null });
  // A reply from before a host switch / a newer read is dropped.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const reply = await api.users();
      if (mine !== seq.current) return;
      setData(reply ? { list: reply, unsupported: false, error: null } : { list: null, unsupported: true, error: null });
    } catch (e) {
      if (mine === seq.current) setData((d) => ({ ...d, error: message(e) }));
    }
  }, [api]);
  useEffect(() => {
    setData({ list: null, unsupported: false, error: null });
    if (connected) void load();
  }, [hostId, connected, load]);
  useEffect(() => {
    if (typeof bridge.on !== "function") return;
    return bridge.on("accessChanged", ({ hostId: from }) => {
      if (from === hostId) void load();
    });
  }, [hostId, load]);
  return { ...data, load };
}

/**
 * Run a users write: a refusal is reported in words (and the list re-read: it may be stale), a thrown
 * error as its message. Returns the value, or null after reporting.
 */
export function useUsersWrite(reload: () => Promise<void>) {
  const { t } = useI18n();
  return useCallback(
    async <V,>(run: () => Promise<UsersResult<V>>, report: (text: string) => void, userName?: string, nameOf?: (userId: string) => string): Promise<V | null> => {
      try {
        const r = await run();
        void reload();
        if (r.ok) return r.value;
        report(refusalText(r.error, (key, vars) => t(key as never, vars), userName, nameOf));
        return null;
      } catch (e) {
        report(t("users.error.other", { message: message(e) }));
        return null;
      }
    },
    [reload, t],
  );
}
