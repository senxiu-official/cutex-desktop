// Held data of a Settings target host that went offline (UI-01, review 2026-10-15). Kept apart from
// lib/targetHost so gating code can read it without that module's store / bridge imports.
import { createContext, useContext } from "react";
import type { SidebarSnapshot } from "../../../shared/ipc";

/**
 * The last data read from a Settings target host that is offline now (components/SettingsHostFrame,
 * UI-01): its pages keep showing what they showed — sections stay, drafts stay — instead of emptying,
 * while the frame takes no edits. Null outside such a frame / while the host is online.
 */
export interface HeldHostData {
  hostId: string;
  features: ReadonlySet<string>;
  featuresKnown: boolean;
  sidebar: SidebarSnapshot | null;
}
export const HeldHostDataContext = createContext<HeldHostData | null>(null);

/** The held data of `hostId` when its live data is gone / not read (null: use the live data). */
export function useHeldHostData(hostId: string | null | undefined, liveKnown: boolean): HeldHostData | null {
  const held = useContext(HeldHostDataContext);
  return held && hostId != null && held.hostId === hostId && !liveKnown ? held : null;
}
