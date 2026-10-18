// Renderer side of the desktop shell (tray): report the attention count and UI locale to main,
// and react to tray commands. No-op in the browser preview without `bridge.shell`.
import { useEffect } from "react";
import { bridge } from "../bridge";
import type { Locale } from "../i18n";
import { focusSessionViews, useApp } from "../store";
import { pendingByAgent } from "./sidebar";
import { useOwnerNotify } from "./ownerNotifyStore";
import { isPending, OWNER_NOTIFY_FEATURE } from "../../../shared/ownerNotify";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { sumHosts } from "./hostScope";

/** The tray / taskbar attention count: agents waiting for an answer, owner approvals waiting for a
 *  decision, pending agent → owner messages — of every connected host (multi-host RFC §10: hosts
 *  outside the scope count too). */
export function appAttention(state = useApp.getState(), notes = useOwnerNotify.getState().byId, others = useOwnerNotify.getState().others): number {
  return sumHosts(Object.values(attentionByHost(state, notes, others)), (n) => n);
}

type AttentionState = Pick<ReturnType<typeof useApp.getState>, "sessions" | "approvals" | "features" | "byHost" | "hosts"> & Partial<Pick<ReturnType<typeof useApp.getState>, "hostWaiting">>;

/** appAttention per connected host (the focus host under its id; 需要你 「其他主机 N 项」 sums the hosts outside the scope). */
export function attentionByHost(state: AttentionState = useApp.getState(), notes = useOwnerNotify.getState().byId, others = useOwnerNotify.getState().others): Record<string, number> {
  const pending = (records: Record<string, Parameters<typeof isPending>[0]>) => Object.values(records).filter(isPending).length;
  const out: Record<string, number> = { [state.hosts?.active ?? LOCAL_HOST_ID]: // An open agent of another host is counted with that host (its slice), not here.
    Object.keys(pendingByAgent(focusSessionViews(state), state.hostWaiting)).length + (state.approvals?.length ?? 0) + (state.features.has(OWNER_NOTIFY_FEATURE) ? pending(notes) : 0) };
  for (const [hostId, slice] of Object.entries(state.byHost ?? {})) {
    out[hostId] = Object.keys(slice.waiting).length + (slice.approvals?.length ?? 0) + (slice.features.has(OWNER_NOTIFY_FEATURE) ? pending(others[hostId] ?? {}) : 0);
  }
  return out;
}

/** How long attention changes settle before the tray / taskbar count is updated. */
const ATTENTION_SETTLE_MS = 50;

export function useDesktopShell(locale: Locale): void {
  useEffect(() => {
    void bridge.shell?.setLocale(locale).catch(() => {});
  }, [locale]);
  useEffect(() => {
    const shell = bridge.shell;
    if (!shell) return;
    let last = -1;
    const report = (count: number) => {
      if (count === last) return;
      last = count;
      void shell.setAttention(count).catch(() => {});
    };
    report(appAttention());
    // Coalesced: a focus switch moves counts between the shown host and its slice in several steps
    // (some after the host notification is delivered); the tray shows the settled count only.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        report(appAttention());
      }, ATTENTION_SETTLE_MS);
    };
    const unsubscribe = useApp.subscribe((state, previous) => {
      if (state.sessions !== previous.sessions || state.approvals !== previous.approvals || state.features !== previous.features || state.byHost !== previous.byHost) schedule();
    });
    const unsubscribeNotes = useOwnerNotify.subscribe((state, previous) => {
      if (state.byId !== previous.byId || state.others !== previous.others) schedule();
    });
    const off = bridge.on("shellCommand", ({ command }) => {
      if (command === "newChat") void useApp.getState().newQuickChat();
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      unsubscribeNotes();
      off();
    };
  }, []);
}
