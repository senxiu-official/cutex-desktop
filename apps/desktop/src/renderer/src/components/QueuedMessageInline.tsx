// A queued owner message in its one-line 接下来 row (owner 2026-11-18): after the ↵ icon, the message in its own order —
// text, then each image as a small thumbnail where it sits, skills / file mentions as `$name` / `@name`. Never an item
// type as text (the old 「[localImage]」). The text shrinks first so a trailing thumbnail stays visible.
import { Fragment, type ReactNode } from "react";
import { Image as ImageIcon } from "lucide-react";
import { inputSegments, type InputPart } from "../../../shared/inputPreview";
import { mentionPlainText } from "../lib/mentionWire";
import { rowText } from "../lib/queueRow";
import { ImageThumb } from "./ImageThumbs";

/**
 * `textWrap`: wrap each run of words (text and mentions between images) in its own element — the row's full-text
 * trigger, a button, every run opening the same full text — with the thumbnails (buttons themselves once loaded) as
 * siblings between them, in message order, never inside a trigger (no button in a button). An image-only message has
 * no trigger.
 */
export function QueuedMessageInline({ input, hostId, className = "", textWrap }: { input: readonly InputPart[]; hostId?: string | null; className?: string; textWrap?: (text: ReactNode) => ReactNode }) {
  const segments = inputSegments(input);
  const nodes = segments.map((seg, i) => {
        if (seg.kind === "image") {
          const name = seg.image.kind === "path" ? seg.image.path.split(/[\\/]/).pop() || seg.image.path : undefined;
          return (
            <ImageThumb
              key={i}
              image={seg.image}
              hostId={hostId}
              title={name}
              className="h-4 w-4 shrink-0 overflow-hidden rounded-sm border border-border"
              imgClassName="h-full w-full object-cover"
              bounds={{ maxWidth: 16, maxHeight: 16 }}
              fallback={<span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-subtle" title={name} data-testid="queued-image-fallback"><ImageIcon size={10} aria-hidden /></span>}
            />
          );
        }
        const text = seg.kind === "text" ? rowText(mentionPlainText(seg.text)) : seg.text;
        if (!text) return null;
        return <span key={i} className={`min-w-0 truncate ${seg.kind === "ref" ? "text-muted" : ""}`} title={seg.kind === "ref" ? seg.path : undefined}>{text}</span>;
  });
  const outer = `flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap text-ui ${className}`;
  if (!textWrap) return <span className={outer} data-testid="queued-message-inline">{nodes}</span>;
  // Message order kept: [words…] image [words…] image … — each non-empty run of words is one trigger.
  const parts: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = () => {
    if (run.length) parts.push(<Fragment key={`run-${parts.length}`}>{textWrap(run)}</Fragment>);
    run = [];
  };
  nodes.forEach((node, i) => {
    if (segments[i]!.kind === "image") { flush(); parts.push(node); }
    else if (node !== null) run.push(node);
  });
  flush();
  return <span className={outer} data-testid="queued-message-inline">{parts}</span>;
}
