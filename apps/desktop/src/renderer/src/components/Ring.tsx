// A small usage ring (quota, goal token budget, context window): grey track, arc coloured by how
// much is used. Quota gauges can pass view="remaining": the arc then shows what is LEFT and the
// colour warns when little is left (lib/quota fillColor).
import { fillColor, type QuotaView } from "../lib/quota";

export function Ring({ ratio, size = 14, view = "used" }: { ratio: number; size?: number; view?: QuotaView }) {
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
