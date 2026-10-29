import { useMemo, type ReactNode } from "react";
import { useApp, viewOf } from "../store";
import { createStreamRenderSource, StreamRenderContext } from "../lib/streamRender";

export function StreamRenderProvider({ hostId, sessionId, children }: { hostId: string; sessionId: string; children: ReactNode }) {
  const value = useMemo(() => ({
    sessionId,
    source: createStreamRenderSource(() => viewOf(useApp.getState(), hostId, sessionId), (listener) => useApp.subscribe(listener)),
  }), [hostId, sessionId]);
  return <StreamRenderContext.Provider value={value}>{children}</StreamRenderContext.Provider>;
}
