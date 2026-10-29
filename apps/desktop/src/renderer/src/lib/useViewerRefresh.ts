import { useEffect, useRef, useState } from "react";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { bridge } from "../bridge";
import { sidebarOf, useApp } from "../store";
import { useUiPrefs } from "./prefs";
import { rootFor } from "./workspace";
import { completedViewerPaths, ViewerRefresh, viewerPath } from "./viewerRefresh";

export function useViewerRefresh(hostId: string | undefined, path: string, root: string | null, visible = true, dirty = false) {
  const enabled = useUiPrefs().viewerAutoRefresh;
  const [revision, setRevision] = useState(0);
  const [changed, setChanged] = useState(false);
  const controller = useRef<ViewerRefresh | null>(null);
  const view = useRef({ visible, dirty });
  view.current = { visible, dirty };
  const absolute = viewerPath(path, root);
  useEffect(() => {
    setChanged(false);
    if (!enabled || !hostId || !absolute) return;
    const refresh = new ViewerRefresh(() => setRevision((n) => n + 1), setChanged);
    controller.current = refresh;
    refresh.setView(view.current.visible, view.current.dirty);
    // Suppress replay of an already handled completion; bound memory to 128 items per open viewer.
    const seen = new Set<string>();
    const off = bridge.on("sessionEvent", (event) => {
      if ((event.hostId ?? LOCAL_HOST_ID) !== hostId) return;
      const message = event.envelope.native?.message;
      if (message?.method !== "item/completed") return;
      const params = message.params as { item?: { id?: string; type?: string; status?: string }; turnId?: string } | undefined;
      if (params?.item?.type !== "fileChange" || params.item.status !== "completed") return;
      const cwd = rootFor(sidebarOf(useApp.getState(), hostId), { kind: "session", id: event.sessionId });
      if (!completedViewerPaths(params?.item, cwd).includes(absolute)) return;
      const id = params?.item?.id ? JSON.stringify([event.sessionId, params.turnId, params.item.id]) : null;
      if (id && seen.has(id)) return;
      if (id) { seen.add(id); if (seen.size > 128) seen.delete(seen.values().next().value!); }
      refresh.invalidate();
    });
    return () => { off(); refresh.dispose(); controller.current = null; };
  }, [enabled, hostId, absolute]);
  useEffect(() => controller.current?.setView(visible, dirty), [visible, dirty]);
  return { revision, changed, reload: () => controller.current?.accept() };
}
