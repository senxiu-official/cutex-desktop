// Unreachable hosts (owner 2026-11-17): they are not in the 花名册; the footer's host / account switcher
// (components/IdentityMenu) carries a dot and, in its menu, each one's 连不上 · 重连 (未连接 · 连接 when switched
// off) and 主机设置.
import type { HostLook } from "./hostScope";
import type { HostSidebarState } from "./scopedSidebarView";

/** Not reachable now: switched off (⏻), or its connection is not online (lib/scopedSidebarView "offline"). */
export function hostUnreachable(h: Pick<HostLook, "connected" | "indicator">): boolean {
  return !h.connected || h.indicator.status !== "online";
}

/** The switcher's dot: red when a host that should be connected is not, grey when only switched-off hosts; null = none. */
export function unreachableDot(hosts: readonly Pick<HostLook, "connected">[]): "danger" | "subtle" | null {
  if (!hosts.length) return null;
  return hosts.some((h) => h.connected) ? "danger" : "subtle";
}

/**
 * The host-only rows the 花名册 still shows: a host of the scope without rows that is loading, or live with nothing
 * to list (several hosts in view). Never one that cannot be reached.
 */
export function rosterHostRows<T extends { state: HostSidebarState; hasRows: boolean }>(hosts: readonly T[], multi: boolean): T[] {
  return hosts.filter((h) => !h.hasRows && h.state !== "offline" && (multi || h.state !== "live"));
}
