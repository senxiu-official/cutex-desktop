import { memo } from "react";
import { classifyFontRuns, hasSharedQuote } from "../lib/fontRuns";

/**
 * Plain display text only. Keep native inputs and code in their own font stacks. Text without a
 * shared curly quote renders as-is: the spans would not change any glyph (see hasSharedQuote).
 */
export const ScriptText = memo(function ScriptText({ text, ownerLang }: { text: string; ownerLang?: string }) {
  if (!hasSharedQuote(text)) return <>{text}</>;
  let offset = 0;
  return <>{classifyFontRuns(text, ownerLang).map((run) => {
    const start = offset;
    offset += run.text.length;
    return <span key={`${start}:${run.kind}`} className={`font-run-${run.kind}`}>{run.text}</span>;
  })}</>;
});
