// Browser preview of desk windows (multi-window P1, `?desks`): window.open makes a real popup here too, so
// the desk's content can be looked at without Electron. Stands in for main's ticket / focus / close and its
// `deskWindow` events (main/deskShell.ts); no admission check (that is main's, test/deskWindows.test.ts).
import type { DeskBridge, DeskWindowEvent } from "../../../shared/ipc";
import { useDesks } from "../lib/deskStore";

export function mockDeskBridge(emit: (event: DeskWindowEvent) => void): DeskBridge {
  let n = 0;
  // As main does: the main document going away (reload) closes its desks (they reopen from what was remembered).
  window.addEventListener("pagehide", () => {
    for (const d of useDesks.getState().desks) d.handle.win.close();
  });
  const watch = (deskId: string) => {
    const timer = setInterval(() => {
      const record = useDesks.getState().desks.find((d) => d.deskId === deskId);
      if (record && !record.handle.win.closed) return;
      clearInterval(timer);
      if (record) emit({ deskId, kind: "closed" });
    }, 300);
  };
  return {
    async ticket(deskId) {
      n++;
      const id = deskId ?? `d${n.toString(16).padStart(12, "0")}`;
      setTimeout(() => watch(id), 500);
      return { deskId: id, name: `cutex-desk-mock${n}` };
    },
    async focus(deskId) {
      const record = useDesks.getState().desks.find((d) => d.deskId === deskId);
      record?.handle.win.focus();
      return !!record || deskId === null;
    },
    async close(deskId) {
      useDesks.getState().desks.find((d) => d.deskId === deskId)?.handle.win.close();
    },
  };
}
