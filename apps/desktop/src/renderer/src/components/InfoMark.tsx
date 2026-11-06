// The ⓘ beside a control whose action is not obvious (design 040 §2.1): hover or keyboard focus shows how it works
// as a tip (lib/tips). Used for the how-to text that used to sit in a native `title` ("右键…", "拖动…").
import { Info } from "lucide-react";

export function InfoMark({ text, size = 12, className = "" }: { text: string; size?: number; className?: string }) {
  return (
    <span role="img" tabIndex={0} aria-label={text} data-tip={text} data-info-mark="" className={`inline-flex shrink-0 cursor-help items-center text-subtle outline-none hover:text-muted focus-visible:text-foreground ${className}`}>
      <Info aria-hidden size={size} />
    </span>
  );
}
