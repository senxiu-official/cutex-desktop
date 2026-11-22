// 备忘 · 要处理: where a memo leads. Its detail opens in the 备忘 card (bound to the memo's host and id); 回到原处 goes to
// the turn it was pinned in, or to the agent's conversation when there is no turn, always on the memo's own host.
// services.refs.open opens refs of the active or the viewed host only, so a memo of another host first brings its host
// into view by opening its agent there in place, then opens the ref; a ref that still cannot open says why. Only a host
// already in the device scope is opened that way: for one outside it openAgent would widen the scope to 所有设备 (main
// keeps that and picks the active host again), so the owner is told instead and nothing changes.
import type { OwnerPin } from "../../../../../shared/ownerPins";
import { translate, type MessageKey } from "../../../i18n";
import type { RefOpener } from "../../../lib/refOpenVia";
import { turnRef } from "../../../lib/refs";
import { inViewScope } from "../../../lib/scopedAgentOpen";
import { agentHost, useApp } from "../../../store";
import { services } from "../../app";
import type { CutexRef, RefOpenResult } from "../../slots";
import { BOOKMARKS, type ListState } from "../model";

const inView = (hostId: string) => {
  const s = useApp.getState();
  return hostId === (s.hosts?.active ?? "local") || hostId === agentHost(s);
};

/** Opening an agent of this host selects it in place (the focus host or one in the current scope). */
const inScope = inViewScope;

function outOfScope(hostId: string): void {
  const host = useApp.getState().hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId;
  services.ui.notice(translate("bookmarks.memo.outOfScope", { host }), "info");
}

/** The memo's agent opened on its host without touching the device scope; false (and the owner told) when it cannot. */
async function openOnHost(hostId: string, pin: OwnerPin): Promise<boolean> {
  if (!inScope(hostId)) return (outOfScope(hostId), false);
  await useApp.getState().openAgent(pin.agentId, hostId);
  return true;
}

/** The memo's host in view: its agent opened there when the host is neither the active nor the viewed one. */
async function bringIntoView(hostId: string, pin: OwnerPin): Promise<boolean> {
  return inView(hostId) || openOnHost(hostId, pin);
}

function explain(r: RefOpenResult): RefOpenResult {
  if (r.status === "opened") return r;
  const reason = r.status === "stale" ? "stale" : r.reason;
  services.ui.notice(translate("bookmarks.memo.openFailed", { reason: translate(`bookmarks.unavailable.${reason}` as MessageKey) }), "error");
  return r;
}

/** The memo Markdown's `cutex:` link opener (components/CutexLink explains a failure itself: a host outside the
 *  scope reads 「属于另一台主机」). */
export const pinRefOpener = (hostId: string, pin: OwnerPin): RefOpener => async (ref, opts) => {
  if (!inView(hostId)) {
    if (!inScope(hostId)) return { status: "unavailable", reason: "host-changed" };
    await useApp.getState().openAgent(pin.agentId, hostId);
  }
  return services.refs.open(ref, opts);
};

/** A ref the memo carries (its turn, an artifact link in its text), opened on the memo's host. */
export async function openPinRef(hostId: string, pin: OwnerPin, ref: CutexRef, opts: { how?: "auto" | "peek" | "page" | "jump" } = {}): Promise<RefOpenResult> {
  if (!(await bringIntoView(hostId, pin))) return { status: "stale" };
  return explain(await services.refs.open(ref, opts));
}

export function jumpToPin(hostId: string, pin: OwnerPin): Promise<unknown> {
  if (!pin.turnId) return openOnHost(hostId, pin);
  return openPinRef(hostId, pin, turnRef({ hostId, sessionId: pin.agentId, turnId: pin.turnId, agentName: pin.agentName ?? pin.agentId }), { how: "jump" });
}

/** The conversation with the memo's agent, on its host (要你定: the owner answers there). */
export function openPinAgent(hostId: string, pin: OwnerPin): void {
  void openOnHost(hostId, pin);
}

/** The detail in the 备忘 card, from anywhere (the widget, the tool strip). */
export function openPinDetail(hostId: string, pinId: string): void {
  const params: ListState = { tab: "pins", pin: { hostId, pinId } };
  services.side.open(BOOKMARKS, params, { binding: { kind: "host", hostId: useApp.getState().hosts?.active ?? hostId } });
}
