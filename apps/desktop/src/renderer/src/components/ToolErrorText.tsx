// The full text a failed tool call returned, shown when its row is expanded: monospace, scrollable,
// with a copy button (the row's one-line reason is often a truncated summary of it).
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useI18n } from "../i18n";
import { copyQuietly } from "../lib/copyFeedback";

export function ToolErrorText({ text, className = "" }: { text: string; className?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <div className={`group relative ${className}`}>
      <pre className="max-h-72 overflow-auto rounded-md bg-surface p-2 pr-8 font-mono text-[11px] whitespace-pre-wrap text-muted">{text}</pre>
      <button
        type="button"
        title={done ? t("reply.copied") : t("tool.copyError")}
        aria-label={t("tool.copyError")}
        onClick={() => void copyQuietly(text).then(() => setDone(true), () => {})}
        className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground"
      >
        {done ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
      </button>
    </div>
  );
}
