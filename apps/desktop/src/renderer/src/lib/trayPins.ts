// The tray's pin list (canvas principles §7, §25.3; not the desktop's icons since owner 2026-10-24) as the shell sees it:
// the module that keeps that list (built-in `home`) registers itself here on activate, so shell code can pin
// something without naming that module (断开 on a linked service pane pins the service, lib/serviceLink).
// No provider (the module is off): nothing can be pinned. Shell code: names no feature.
//
// A module's own page (a pane kind such as a project's overview) is pinned as kind `page` with the key
// `<pageId>:<argument>` (lib/pagePins draws and opens it); `supports("page")` says whether the list's host
// can keep such a pin now (an older host refuses them), so callers hide their pin action otherwise.
import { useSyncExternalStore } from "react";
import type { MenuEntry } from "./contextMenu";
import { useApp } from "../store";

/** What can be pinned: an agent (`key` = its session id), a service (its slug), an artifact (its ref), a page (`<pageId>:<argument>`). */
export interface TrayPinRef {
  hostId: string;
  kind: "agent" | "service" | "artifact" | "page";
  key: string;
  title?: string;
}

export interface TrayPins {
  isPinned(ref: TrayPinRef): boolean;
  /** Pinned (already pinned: true, unchanged). False: it could not be (no home host, the list is full, a write failed). */
  pin(ref: TrayPinRef): Promise<boolean>;
  unpin(ref: TrayPinRef): Promise<boolean>;
  /** Whether a pin of this kind can be kept now (absent: every kind but `page`). */
  supports?(kind: TrayPinRef["kind"]): boolean;
  /** Called whenever the list (or where it lives) changes; returns the unsubscribe. */
  subscribe?(listener: () => void): () => void;
  /** 「＋ 固定」 on the empty tray: the same picker as the desktop's (what can be pinned now, a click pins it). */
  pickerEntries?(): Promise<MenuEntry[]>;
  /**
   * The tray's entry that takes the screen when the last workspace on it closes (owner 2026-10-23: the tray is the
   * taskbar of what is open; like a browser closing its active tab): the right neighbour, in the tray's order, of the
   * entry holding `closing`, else its left one. Its name and its open (the same as its click in the tray); null:
   * nothing else is in the tray (the desktop shows).
   */
  nextAfterClose?(closing: readonly TrayAgent[]): TrayNext | null;
}

export interface TrayAgent {
  hostId: string;
  sessionId: string;
}

export interface TrayNext {
  name: string;
  open(): void;
}

/** The tray's next entry after `closing` closes (lib/workspaces closeWorkspace); null: none (no keeper, nothing else open). */
export function trayNextAfterClose(closing: readonly TrayAgent[]): TrayNext | null {
  return provider?.nextAfterClose?.(closing) ?? null;
}

let provider: TrayPins | null = null;
const providerListeners = new Set<() => void>();

/** The keeper of the list registers (null: it stopped). */
export function setTrayPins(next: TrayPins | null): void {
  provider = next;
  for (const l of [...providerListeners]) l();
}

/** The list's keeper now (null: none — the module is off). */
export function trayPins(): TrayPins | null {
  return provider;
}

/** Whether `kind` can be pinned now (a keeper exists and keeps that kind). */
export function trayPinSupported(kind: TrayPinRef["kind"]): boolean {
  if (!provider) return false;
  return provider.supports ? provider.supports(kind) : kind !== "page";
}

function subscribeAll(listener: () => void): () => void {
  providerListeners.add(listener);
  let inner = provider?.subscribe?.(listener) ?? null;
  const resubscribe = () => {
    inner?.();
    inner = provider?.subscribe?.(listener) ?? null;
  };
  providerListeners.add(resubscribe);
  // Host capabilities (where the list lives, what it may hold) change with the app state.
  const offApp = useApp.subscribe(listener);
  return () => {
    providerListeners.delete(listener);
    providerListeners.delete(resubscribe);
    inner?.();
    offApp();
  };
}

/** Live: whether `ref` can be pinned now and whether it is pinned (null ref: neither). */
export function useTrayPin(ref: TrayPinRef | null): { available: boolean; pinned: boolean } {
  const snap = useSyncExternalStore(subscribeAll, () => {
    if (!ref) return "00";
    const available = trayPinSupported(ref.kind);
    const pinned = !!provider && provider.isPinned(ref);
    return `${available ? 1 : 0}${pinned ? 1 : 0}`;
  });
  return { available: snap[0] === "1", pinned: snap[1] === "1" };
}

function subscribeProvider(listener: () => void): () => void {
  providerListeners.add(listener);
  return () => {
    providerListeners.delete(listener);
  };
}

/** Live: the list's keeper (null: none — the module is off); the empty tray's 「＋ 固定」 uses its picker. */
export function useTrayPinKeeper(): TrayPins | null {
  return useSyncExternalStore(subscribeProvider, () => provider);
}
