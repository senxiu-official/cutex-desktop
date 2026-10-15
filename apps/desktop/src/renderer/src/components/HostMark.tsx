// Host identity marks (multi-host RFC §7, §8.2): the OS icon, the color dot with its status ring and
// the `● name` chip. The only way the UI draws "which host": sidebar group headers, list rows, the
// switcher and Settings → 主机 all use these. Data: lib/hostScope `HostLook` (useHostScope / useHostLook).
import { Server } from "lucide-react";
import type { HostPlatform } from "../../../shared/hosts";
import type { HostLook } from "../lib/hostScope";
import type { HostStatus } from "../lib/hosts";

/** OS line icons (lucide has no brand icons, RFC §7.2); `null` (never connected) = a generic server. */
export function HostPlatformIcon({ platform, size = 14, className = "" }: { platform: HostPlatform | null; size?: number; className?: string }) {
  if (!platform) return <Server size={size} className={`shrink-0 ${className}`} aria-hidden />;
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className: `shrink-0 ${className}`, "aria-hidden": true };
  if (platform === "windows")
    return (
      <svg {...common}>
        <path d="M3.5 5.6 10.5 4.6v6.9h-7z" />
        <path d="M13 4.2 20.5 3v8.5H13z" />
        <path d="M3.5 13.5h7v6.9l-7-1z" />
        <path d="M13 13.5h7.5V21L13 19.8z" />
      </svg>
    );
  if (platform === "linux")
    return (
      <svg {...common}>
        <path d="M12 3c-2.4 0-3.6 2-3.6 4.4 0 1.5-.5 2.6-1.4 3.9-1.1 1.6-1.9 3.4-1.6 5.6" />
        <path d="M12 3c2.4 0 3.6 2 3.6 4.4 0 1.5.5 2.6 1.4 3.9 1.1 1.6 1.9 3.4 1.6 5.6" />
        <ellipse cx="12" cy="15.2" rx="2.9" ry="4" />
        <path d="M5.5 20.5c1.2-.9 2.6-1.3 4-1M18.5 20.5c-1.2-.9-2.6-1.3-4-1" />
        <path d="M10.6 7.2h.01M13.4 7.2h.01" />
        <path d="M11 9.3h2l-1 1z" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M16.4 12.7c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.3.8-.7 0-1.8-.8-2.9-.8-1.5 0-2.9.9-3.7 2.2-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.5-.7 2.9-.7 1.3 0 1.7.7 2.9.7 1.2 0 1.9-1.1 2.7-2.2.8-1.2 1.2-2.4 1.2-2.5-.1 0-2.4-.9-2.4-3.8z" />
      <path d="M14.2 5.6c.6-.7 1-1.7.9-2.6-.9 0-1.9.6-2.5 1.3-.6.6-1 1.6-.9 2.6 1 .1 1.9-.5 2.5-1.3z" />
    </svg>
  );
}

/**
 * The host's color dot; the ring tells its status (RFC §7.1): online = solid, connecting / retrying =
 * solid with a pulsing amber ring, error = solid with a red ring, offline / not connected = hollow.
 */
export function HostDot({ color, status = "online", size = 8, title }: { color: string; status?: HostStatus; size?: number; title?: string }) {
  const hollow = status === "offline" || status === "disconnected";
  const ring = status === "error" ? "ring-2 ring-danger" : status === "connecting" || status === "retrying" ? "ring-2 ring-warn animate-pulse" : "";
  return (
    <span
      title={title}
      className={`inline-block shrink-0 rounded-full ${ring}`}
      style={{ width: size, height: size, background: hollow ? "transparent" : color, boxShadow: hollow ? `inset 0 0 0 1.5px ${color}` : undefined }}
    />
  );
}

/** `● name` chip (group headers, list rows); `dotOnly` = just the dot with the name as tooltip (dense rows). */
export function HostMark({ host, dotOnly = false, className = "" }: { host: Pick<HostLook, "label" | "color" | "indicator">; dotOnly?: boolean; className?: string }) {
  if (dotOnly) return <HostDot color={host.color} status={host.indicator.status} title={host.label} />;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 rounded px-1 text-[11px] text-muted ${className}`} title={host.label}>
      <HostDot color={host.color} status={host.indicator.status} size={7} />
      <span className="truncate">{host.label}</span>
    </span>
  );
}
