// A small usage ring (quota, goal token budget, context window): grey track, arc coloured by how
// much is used. Quota gauges can pass view="remaining": the arc then shows what is LEFT and the
// colour warns when little is left (lib/quota fillColor).
import { fillColor, type QuotaView } from "../lib/quota";

export function Ring({ ratio, size = 14, view = "used", segments }: {
  ratio: number;
  size?: number;
  view?: QuotaView;
  segments?: readonly { id: string; ratio: number; label: string; stale?: boolean }[];
}) {
  if (segments && segments.length > 1) {
    // Shared position, distinct radii: a fuller window must not cover another
    // model's lower value. Grow only for 3+ members so inner arcs remain legible.
    const diameter = Math.max(size, 10 + 4 * (segments.length - 1));
    const mid = diameter / 2;
    return (
      <svg width={diameter} height={diameter} viewBox={`0 0 ${diameter} ${diameter}`} className="block shrink-0" role="img" aria-label={segments.map((segment) => segment.label).join("; ")}>
        {segments.map((segment, index) => {
          const r = mid - 1.5 - index * 2;
          const c = 2 * Math.PI * r;
          return (
            <g key={segment.id} opacity={segment.stale ? 0.5 : undefined}>
              <title>{segment.label}</title>
              <circle cx={mid} cy={mid} r={r} fill="none" stroke="var(--border)" strokeWidth="1.5" />
              <circle cx={mid} cy={mid} r={r} fill="none" stroke={fillColor(segment.ratio, view)} strokeWidth="1.5"
                strokeDasharray={`${c * Math.max(0, Math.min(1, segment.ratio))} ${c}`} transform={`rotate(-90 ${mid} ${mid})`} strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
    );
  }
  const r = size / 2 - 1.5;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  return (
    // block: never an inline box on a text baseline (a wrapper span would grow by the descent and
    // push the ring off its row's centre line).
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block shrink-0">
      <circle cx={mid} cy={mid} r={r} fill="none" stroke="var(--border)" strokeWidth="2" />
      <circle
        cx={mid}
        cy={mid}
        r={r}
        fill="none"
        stroke={fillColor(ratio, view)}
        strokeWidth="2"
        strokeDasharray={`${c * Math.min(1, ratio)} ${c}`}
        transform={`rotate(-90 ${mid} ${mid})`}
        strokeLinecap="round"
      />
    </svg>
  );
}
