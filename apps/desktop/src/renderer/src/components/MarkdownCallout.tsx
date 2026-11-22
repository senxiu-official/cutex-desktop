// A callout quote as a card (教学模式, docs/design/teaching-mode.md P1; lib/markdownCallouts marks the quote). With
// 教学模式 off — and for every quote without a marker — streamdown's own blockquote renders, exactly as before.
import { useSyncExternalStore, type ComponentType, type HTMLAttributes, type ReactNode } from "react";
import { CircleAlert, Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { defaultComponents } from "streamdown";
import { useI18n, type MessageKey } from "../i18n";
import { getUiPrefs, subscribeUiPrefs } from "../lib/prefs";
import { CALLOUT_KINDS, type CalloutKind } from "../lib/markdownCallouts";

type QuoteProps = HTMLAttributes<HTMLQuoteElement> & { node?: unknown; children?: ReactNode; "data-callout"?: string; "data-callout-title"?: string };
const teachingOn = () => getUiPrefs().teachingMode;
const DefaultQuote = defaultComponents.blockquote as ComponentType<QuoteProps>;

const LOOK: Record<CalloutKind, { icon: LucideIcon; box: string; head: string }> = {
  explain: { icon: Lightbulb, box: "border-accent/30 bg-accent/5", head: "text-accent" },
  note: { icon: Info, box: "border-accent/25 bg-accent/5", head: "text-accent" },
  tip: { icon: Lightbulb, box: "border-ok/30 bg-ok/5", head: "text-ok-text" },
  important: { icon: MessageSquareWarning, box: "border-accent/40 bg-accent/10", head: "text-accent" },
  warning: { icon: TriangleAlert, box: "border-warn/40 bg-warn/5", head: "text-warn-text" },
  caution: { icon: OctagonAlert, box: "border-danger/40 bg-danger/5", head: "text-danger-text" },
};

export function MarkdownCallout(props: QuoteProps) {
  const teaching = useSyncExternalStore(subscribeUiPrefs, teachingOn, teachingOn);
  const { t } = useI18n();
  const kind = props["data-callout"] as CalloutKind | undefined;
  if (!teaching || !kind || !(CALLOUT_KINDS as readonly string[]).includes(kind)) return <DefaultQuote {...props} />;
  const { node: _node, children, className: _className, "data-callout-title": title, ...rest } = props;
  const look = LOOK[kind] ?? { icon: CircleAlert, box: "border-border", head: "" };
  const Icon = look.icon;
  return (
    <blockquote {...rest} data-callout={kind} className={`markdown-callout my-3 rounded-xl border px-4 py-2.5 not-italic ${look.box}`}>
      <div data-callout-title="" className={`mb-1 flex items-center gap-1.5 text-[0.95em] font-semibold ${look.head}`}>
        <Icon size={15} className="shrink-0" aria-hidden />
        <span className="min-w-0">{title || t(`markdown.callout.${kind}` as MessageKey)}</span>
      </div>
      {children}
    </blockquote>
  );
}
