// The owner's guide choice on the host (cutex `guides.preferences`, r258; owner 2026-10-24): 全部跳过 on one device is
// remembered by the host for every device of that owner. A device that has not answered 「要看引导和提示吗？」 yet reads
// it at start and does not ask when the owner already skipped through the current guides (lib/guides applyHostSkip);
// 全部跳过 and 重置所有提示 write it back. Which tip was seen stays per device. The first question waits for the answer
// for a moment (at most START_WAIT_MS after start, then it goes on without it — an older host, or offline).
import { useEffect, useRef } from "react";
import { apiFor } from "../bridge";
import { featuresOf, useApp } from "../store";
import { applyHostSkip, getGuides, setGuidesHostPending, setGuidesHostTarget, registerGuidesHostWriter } from "./guides";
import { useUpdateStatus } from "./update";

export const GUIDES_PREFERENCES_FEATURE = "guides.preferences";
/** How long the first question waits for the host at start. */
export const START_WAIT_MS = 3000;

/** Mounted once (components/FirstUseTips): reads the host's choice for the focus host, wires the write-back. */
export function useGuidesHostSync(): void {
  const host = useApp((s) => s.hosts?.active ?? null);
  const has = useApp((s) => featuresOf(s, s.hosts?.active).has(GUIDES_PREFERENCES_FEATURE));
  const version = useUpdateStatus()?.current?.version ?? null;
  const deadline = useRef(Date.now() + START_WAIT_MS);

  // Until the capabilities are known, the question waits (bounded).
  useEffect(() => {
    setGuidesHostTarget(() => useApp.getState().hosts?.active ?? null);
    const remaining = deadline.current - Date.now();
    setGuidesHostPending(!getGuides().asked && remaining > 0);
    const timer = setTimeout(() => setGuidesHostPending(false), Math.max(0, remaining));
    return () => {
      setGuidesHostTarget(null);
      clearTimeout(timer);
      setGuidesHostPending(false);
    };
  }, []);

  useEffect(() => {
    if (!has || !host) return;
    const api = apiFor(host);
    return registerGuidesHostWriter(host, (skippedThrough) => api.putGuidesPreferences(skippedThrough));
  }, [has, host]);

  useEffect(() => {
    if (!has || !host || getGuides().asked) return;
    let live = true;
    // The mount effect owns the only wait window. A late capability / host change can
    // fetch in the background, but must never suspend guides again after that window.
    apiFor(host)
      .guidesPreferences()
      .then((p) => live && applyHostSkip(p?.skippedThrough ?? null, version))
      .catch(() => {})
      .finally(() => live && setGuidesHostPending(false));
    return () => {
      live = false;
    };
  }, [has, host, version]);
}
