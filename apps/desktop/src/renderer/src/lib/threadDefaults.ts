// cutex `/v2/settings` newThreadDefaults (feature new-thread-defaults): load + patch per kind.
import { useEffect, useState } from "react";
import { readNewThreadDefaults, type LaunchField, type LaunchPermissions, type NewThreadDefaults, type ThreadKind } from "../../../shared/launch";
import { useTargetApi, useTargetFeatures } from "./targetHost";

export type ThreadDefaultsPatch = { [K in LaunchField]?: LaunchPermissions[K] | null };

export function useThreadDefaults(): {
  supported: boolean;
  state: { current: NewThreadDefaults; builtin: NewThreadDefaults } | null;
  error: string | null;
  patch(kind: ThreadKind, fields: ThreadDefaultsPatch): Promise<void>;
} {
  // The target host (Settings → 新建默认 of the picked host; lib/targetHost).
  const api = useTargetApi();
  const supported = useTargetFeatures().has("new-thread-defaults");
  const [state, setState] = useState<{ current: NewThreadDefaults; builtin: NewThreadDefaults } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!supported) return;
    api.getSettings().then((s) => setState(readNewThreadDefaults(s)), (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [supported, api]);
  const patch = async (kind: ThreadKind, fields: ThreadDefaultsPatch) => {
    setError(null);
    try {
      setState(readNewThreadDefaults(await api.patchNewThreadDefaults({ [kind]: fields })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return { supported, state, error, patch };
}
