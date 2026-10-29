// 钉到托盘 / 取消固定 (`ref.action` home.pin; the tray's pins — the desktop's icons are their own list since owner 2026-10-24,
// model 「The desktop's icons」): on the agent menu, a service (服务 page row menu, the reveal
// card in a conversation), an artifact tab and a browser tab. The pin goes into the home document of the
// home page source host (store.ts: optimistic, revision-checked).
import type { HomeDoc, HomePin } from "../../../../shared/home";
import { HOME_MAX_PINS } from "../../../../shared/home";
import { translate } from "../../i18n";
import { services } from "../app";
import type { CutexRef } from "../slots";
import { homeSourceNow } from "./hooks";
import { isPinned, pinId, pinOfRef, pinsOf, withPin, withPinToggled, withoutPin } from "./model";
import { homeStore } from "./store";

/** The source host with its document read (null: no connected owner host). */
async function sourceNow(): Promise<string | null> {
  let hostId = homeSourceNow();
  if (!hostId) return null;
  if (!homeStore().entry(hostId)) {
    await homeStore().load(hostId);
    // Its settings may name another home host.
    hostId = homeSourceNow() ?? hostId;
    if (!homeStore().entry(hostId)) await homeStore().load(hostId);
  }
  return hostId;
}

export function pinnedNow(pin: HomePin): boolean {
  const hostId = homeSourceNow();
  return !!hostId && isPinned(homeStore().entry(hostId)?.doc ?? null, pin);
}

/** Pins (or unpins) what `ref` points at; a notice says what happened. */
export async function togglePinOfRef(ref: CutexRef): Promise<void> {
  const pin = pinOfRef(ref);
  if (!pin) return;
  await togglePin(pin);
}

export async function togglePin(pin: HomePin): Promise<void> {
  const hostId = await sourceNow();
  if (!hostId) {
    services.ui.notice(translate("home.pinUnavailable"), "error");
    return;
  }
  const doc = homeStore().entry(hostId)?.doc ?? null;
  const name = pin.title ?? pin.key;
  if (!isPinned(doc, pin) && pinsOf(doc).length >= HOME_MAX_PINS) {
    services.ui.notice(translate("home.pinFull"), "error");
    return;
  }
  const was = isPinned(doc, pin);
  const ok = await homeStore().update(hostId, (d: HomeDoc) => withPinToggled(d, pin));
  if (ok) services.ui.notice(translate(was ? "home.unpinnedShared" : "home.pinnedShared", { name }));
  else services.ui.notice(translate("home.saveFailed", { error: homeStore().entry(hostId)?.error ?? "" }), "error");
}

export async function addPin(hostId: string, pin: HomePin): Promise<boolean> {
  return homeStore().update(hostId, (d) => withPin(d, pin));
}

export async function removePin(hostId: string, pin: HomePin): Promise<boolean> {
  return homeStore().update(hostId, (d) => withoutPin(d, pinId(pin)));
}

/**
 * Pins without toggling (the shell's shared pin list, lib/trayPins: 断开 on a linked service pane). Already
 * pinned = true; no home host / the list full / a failed write = false.
 */
export async function pinOnSource(pin: HomePin): Promise<boolean> {
  const hostId = await sourceNow();
  if (!hostId) return false;
  const doc = homeStore().entry(hostId)?.doc ?? null;
  if (isPinned(doc, pin)) return true;
  if (pinsOf(doc).length >= HOME_MAX_PINS) return false;
  return addPin(hostId, pin);
}

/** Unpins from the source host (an undo of pinOnSource). */
export async function unpinOnSource(pin: HomePin): Promise<boolean> {
  const hostId = await sourceNow();
  if (!hostId) return false;
  return removePin(hostId, pin);
}
