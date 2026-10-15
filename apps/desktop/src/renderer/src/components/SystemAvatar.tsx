// The avatar of a system sender (lib/systemSenders): a square logo instead of an agent's round
// letter. The ONE place that picks the icon — swap the import (or map a kind to its own asset).
import type { SessionAvatar } from "@cutex-desktop/protocol";
import cutexLogo from "../assets/cutex-logo-64.png";
import { systemSender, type SystemSender } from "../lib/systemSenders";
import { selectedSidebar, useApp } from "../store";
import { rowsOf } from "../lib/viewHost";
import { Avatar } from "./Avatar";

const ICON: Record<SystemSender, string> = {
  delegation: cutexLogo,
  alarm: cutexLogo,
  job: cutexLogo,
  cutex: cutexLogo,
};

export function SystemAvatar({ kind, size = 28 }: { kind: SystemSender; size?: number }) {
  return (
    <img
      src={ICON[kind]}
      alt=""
      aria-hidden
      draggable={false}
      data-system-avatar={kind}
      className="shrink-0 select-none rounded-[22%] bg-surface-2 object-cover"
      style={{ width: size, height: size }}
    />
  );
}

/** A message sender's avatar: the system logo for cutex services (lib/systemSenders), else the agent's. */
export function SenderAvatar({ id, sourceKind, name, avatar, size = 28 }: { id: string | null | undefined; sourceKind?: string | null; name: string; avatar?: SessionAvatar | null; size?: number }) {
  const system = systemSender(id, sourceKind);
  // The sender's own avatar when the caller has none (timeline messages carry only the id).
  const own = useApp((s) => (avatar === undefined && id && !system ? (rowsOf(s.sidebar, selectedSidebar(s)).find((r) => r.cutexSessionId === id)?.avatar ?? null) : null));
  return system ? <SystemAvatar kind={system} size={size} /> : <Avatar name={name} avatar={avatar ?? own} seed={id} size={size} />;
}
