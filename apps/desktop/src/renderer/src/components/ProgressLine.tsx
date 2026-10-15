// A thin (2px) progress bar under a capsule row (lib/capsuleRows): a neutral track, the fill in the
// accent (or the given tone). Decorative: the value is in the row's meta / tooltip.
import { progressWidth } from "../lib/capsuleRows";

export function ProgressLine({ ratio, tone = "bg-accent", className = "" }: { ratio: number; tone?: string; className?: string }) {
  return (
    <div aria-hidden className={`h-0.5 overflow-hidden rounded-full bg-surface-2 ${className}`}>
      <div className={`h-full rounded-full ${tone} transition-[width] duration-150 motion-reduce:transition-none`} style={{ width: progressWidth(ratio) }} />
    </div>
  );
}
