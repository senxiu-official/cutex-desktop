// The connected host's `agentBus.wakeBusyWaitSecs` (lib/wakeBusyWait.ts) for the 待读留言 label:
// read from `/v2/settings` once per capabilities load (a reconnect or host switch replaces the
// `features` set, which reloads it); the Settings row writes the new value through `setWakeBusyWait`.
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../bridge";
import { useI18n } from "../i18n";
import { useApp } from "../store";
import { pendingWakeLabel, readWakeBusyWait, WAKE_BUSY_WAIT_FEATURE, wakeHintOf, type WakeBusyWait } from "./wakeBusyWait";

const useWakeBusyWaitStore = create<{ wait: WakeBusyWait; loadedFor: ReadonlySet<string> | null }>(() => ({ wait: undefined, loadedFor: null }));

/** The Settings row saved a new value (the PATCH answer's view). */
export function setWakeBusyWait(wait: WakeBusyWait): void {
  useWakeBusyWaitStore.setState({ wait, loadedFor: useApp.getState().features });
}

/** `{supported, wait}` for the connected host; loads when `enabled` and the capability is there. */
export function useWakeBusyWait(enabled: boolean): { supported: boolean; wait: WakeBusyWait } {
  const features = useApp((s) => s.features);
  const supported = features.has(WAKE_BUSY_WAIT_FEATURE);
  const { wait, loadedFor } = useWakeBusyWaitStore();
  useEffect(() => {
    if (!enabled || !supported || useWakeBusyWaitStore.getState().loadedFor === features) return;
    useWakeBusyWaitStore.setState({ wait: undefined, loadedFor: features });
    api.getSettings().then(
      (s) => {
        if (useWakeBusyWaitStore.getState().loadedFor === features) useWakeBusyWaitStore.setState({ wait: readWakeBusyWait(s) });
      },
      () => {},
    );
  }, [enabled, supported, features]);
  return { supported, wait: supported && loadedFor === features ? wait : undefined };
}

/**
 * The 唤醒 tooltip of a timeline bus-message row whose recipient runs `runtime`: what a wake really
 * does to a busy recipient on this host (wake-busy-wait), the old after-turn hint without the capability.
 * `undefined` when the row is no wake (nothing is loaded for it, KindTag keeps its own default).
 */
export function useWakeHint(isWake: boolean, runtime: "codex" | "claude"): string | undefined {
  const { t } = useI18n();
  const { supported, wait } = useWakeBusyWait(isWake);
  if (!isWake) return undefined;
  const hint = wakeHintOf(pendingWakeLabel(supported, runtime, wait));
  return hint.n === undefined ? t(hint.key) : t(hint.key, { n: hint.n });
}
