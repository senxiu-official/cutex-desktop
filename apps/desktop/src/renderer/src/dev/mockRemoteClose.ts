// Browser preview of remote close (cutex `client-remote-close`): what main does for this desktop —
// the countdown (shared/remoteClose.ts RemoteCloseCountdown, the same class main uses) behind the shell
// ops `remoteClose` / `answerRemoteClose` / `setAllowRemoteClose`. The 在线的桌面 list itself is
// modules/remote-access/mock.ts. `?remoteclose[=s]`: s seconds (default 3)
// after start, host-a asks this desktop to close (the countdown shows; 取消 keeps it, 立即关闭 / the
// deadline "quits" — the preview only logs that and clears the dialog). Only dev/mockBridge.ts imports this.
import { CLIENT_CLOSE_REQUESTED_EVENT, CLIENT_STATE_CHANGED_EVENT } from "@cutex-desktop/cutex-client";
import type { ShellBridge, ShellState } from "../../../shared/ipc";
import { RemoteCloseCountdown, type RemoteCloseView } from "../../../shared/remoteClose";

/** This preview desktop's instance id — the same literal as modules/remote-access/mock.ts (neither may import the other). */
const MOCK_SELF_INSTANCE = "5b1e0c7a-0000-4000-8000-00000000self";

export function mockRemoteCloseShell(deps: {
  state: ShellState;
  emitView(view: RemoteCloseView | null): void;
  emitHost(method: string, params: Record<string, unknown>): void;
}): Pick<ShellBridge, "setAllowRemoteClose" | "remoteClose" | "answerRemoteClose"> {
  const countdown = new RemoteCloseCountdown({
    now: () => Date.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    report: async (_hostId, instanceId, outcome) => deps.emitHost(CLIENT_STATE_CHANGED_EVENT, { instanceId, state: outcome }),
    quit: () => {
      console.info("[mock] remote close: the desktop app would quit now (cutex keeps running)");
      setTimeout(() => deps.emitView(null), 1500);
    },
    onChange: (view) => deps.emitView(view),
  });
  const param = typeof location !== "undefined" ? new URLSearchParams(location.search).get("remoteclose") : null;
  if (param !== null) {
    const seconds = Number(param) > 0 ? Number(param) : 3;
    setTimeout(() => {
      const request = { instanceId: MOCK_SELF_INSTANCE, requestedBy: { deviceName: "host-a", userId: "owner", local: false }, graceSeconds: 15, at: new Date().toISOString() };
      deps.emitHost(CLIENT_CLOSE_REQUESTED_EVENT, request);
      if (deps.state.prefs.allowRemoteClose === false) deps.emitHost(CLIENT_STATE_CHANGED_EVENT, { instanceId: MOCK_SELF_INSTANCE, state: "cancelled" });
      else countdown.request("local", request);
    }, seconds * 1000);
  }
  return {
    async setAllowRemoteClose(value) {
      if (value) delete deps.state.prefs.allowRemoteClose;
      else deps.state.prefs.allowRemoteClose = false;
      if (!value && countdown.view()) void countdown.cancel();
      return structuredClone(deps.state);
    },
    async remoteClose() {
      return countdown.view();
    },
    async answerRemoteClose(action) {
      await countdown.answer(action);
    },
  };
}
