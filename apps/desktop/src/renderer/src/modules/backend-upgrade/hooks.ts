// Hooks of the 后端更新 page: refusal wording, one action at a time with its error, `/v2/host`'s
// serviceManager / runtimes blocks of the target host.
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostServiceInfo, UpgradeRefusal, UpgradeResult } from "../../../../shared/backendUpgrade";
import { useI18n, type MessageKey } from "../../i18n";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { useHostData } from "../../lib/useHostScope";
import { refusalKey } from "./model";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A refusal in our words (known codes / reasons), else `code: message`. */
export function useRefusalText(): (r: UpgradeRefusal) => string {
  const { t } = useI18n();
  return useCallback(
    (r: UpgradeRefusal) => {
      const key = refusalKey(r);
      if (!key) return r.message ? `${r.code}: ${r.message}` : r.code;
      const text = t(`backend-upgrade.refusal.${key}` as MessageKey, { runId: r.runId ?? "", message: r.message });
      return key === "blocked.other" || key === "upgrade_unavailable" || key === "invalid_request" ? `${text} (${r.message || r.reason || r.code})` : text;
    },
    [t],
  );
}

/**
 * Runs one upgrade call at a time: `busy` while it runs, `error` = the refusal / failure in words.
 * Returns the value, or null after reporting.
 */
export function useUpgradeAction() {
  const words = useRefusalText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async <T>(call: () => Promise<UpgradeResult<T>>, onRefusal?: (r: UpgradeRefusal) => boolean): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        const r = await call();
        if (r.ok) return r.value;
        // onRefusal → true: the caller shows it its own way.
        if (!onRefusal?.(r.error)) setError(words(r.error));
        return null;
      } catch (e) {
        setError(errorText(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [words],
  );
  return { busy, error, setError, run };
}

/** `/v2/host` `serviceManager` / `runtimes` of the target host (null each on an older cutex). */
export function useHostServiceInfo(reloadKey: unknown): HostServiceInfo | null {
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const connected = useHostData(hostId)?.daemon.kind === "connected";
  const [info, setInfo] = useState<HostServiceInfo | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    if (!connected) return;
    api.hostServiceInfo().then(
      (v) => mine === seq.current && setInfo(v),
      () => mine === seq.current && setInfo(null),
    );
  }, [api, hostId, connected, reloadKey]);
  return info;
}
