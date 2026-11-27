// 默认助理 (owner 2026-11-27): the first assistant created is the default and the owner can switch it; the title-bar
// button opens its conversation. Kept on this device for now (assumed contract: a person-level preference the layout
// sync or the host keeps later, same shape). A stored default that no longer exists falls back to the first one.
import { useSyncExternalStore } from "react";
import type { PaRow } from "./paHooks";

const KEY = "cutex-desktop.personal-assistants.default";

export interface DefaultAssistantRef {
  hostId: string;
  assistantId: string;
}

const listeners = new Set<() => void>();
let cached: DefaultAssistantRef | null | undefined;

function read(): DefaultAssistantRef | null {
  if (cached !== undefined) return cached;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<DefaultAssistantRef> | null;
    cached = v && typeof v.hostId === "string" && typeof v.assistantId === "string" ? { hostId: v.hostId, assistantId: v.assistantId } : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function getDefaultAssistant(): DefaultAssistantRef | null {
  return read();
}

export function setDefaultAssistant(ref: DefaultAssistantRef | null): void {
  cached = ref;
  try {
    if (ref) localStorage.setItem(KEY, JSON.stringify(ref));
    else localStorage.removeItem(KEY);
  } catch {
    // this device only
  }
  for (const l of listeners) l();
}

/** Set it only when none is set yet (the first assistant created becomes the default). */
export function adoptFirstAssistant(ref: DefaultAssistantRef): void {
  if (!read()) setDefaultAssistant(ref);
}

export function useDefaultAssistantRef(): DefaultAssistantRef | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => null,
  );
}

/** The default among the rows read: the stored one, else the first (rail order). */
export function defaultRow<R extends Pick<PaRow, "hostId" | "assistant">>(rows: readonly R[], stored: DefaultAssistantRef | null): R | null {
  return (stored && rows.find((r) => r.hostId === stored.hostId && r.assistant.id === stored.assistantId)) || rows[0] || null;
}

/** For tests: forget the cached value. */
export function resetDefaultAssistantCache(): void {
  cached = undefined;
}
