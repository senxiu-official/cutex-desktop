// A module's cards of lib/agentToasts.ts for the agent in view, rendered from its `conversation.overlay`
// into one shared stack (bottom right of the conversation, above the composer). Never takes focus.
// Long text wraps (at most three lines, the whole text in the tooltip), never a sideways scrollbar;
// hovering or focusing a card holds its timer.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileBox, Globe, X } from "lucide-react";
import { useI18n } from "../i18n";
import { dismissAgentToast, holdAgentToast, releaseAgentToast, useAgentToasts, type AgentToast } from "../lib/agentToasts";
import { agentHost, useApp } from "../store";

const STACK = "data-agent-toasts";

/** The shared stack inside the conversation (created by the first overlay that needs it). */
function stackFor(anchor: HTMLElement): HTMLElement | null {
  const root = anchor.closest("[data-overlay-root]")?.parentElement;
  if (!root) return null;
  let stack = root.querySelector<HTMLElement>(`:scope > [${STACK}]`);
  if (!stack) {
    stack = document.createElement("div");
    stack.setAttribute(STACK, "");
    stack.className = "pointer-events-none absolute right-4 bottom-16 z-[7] flex max-w-[min(26rem,calc(100%-2rem))] flex-col items-end gap-1.5";
    root.append(stack);
  }
  return stack;
}

function Card({ toast }: { toast: AgentToast }) {
  const { t } = useI18n();
  const Icon = toast.icon === "service" ? Globe : FileBox;
  return (
    <div
      role="status"
      className="pointer-events-auto flex max-w-full min-w-0 items-start gap-2 rounded-lg border border-card-border bg-surface px-2.5 py-1.5 text-xs shadow-lg"
      data-agent-toast={toast.icon}
      onPointerEnter={() => holdAgentToast(toast.id)}
      onPointerLeave={() => releaseAgentToast(toast.id)}
      onFocus={() => holdAgentToast(toast.id)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) releaseAgentToast(toast.id);
      }}
    >
      <Icon size={13} className="mt-0.5 shrink-0 text-accent" />
      <span className="line-clamp-3 min-w-0 flex-1 leading-[18px] [overflow-wrap:anywhere] text-foreground" title={toast.text}>
        {toast.text}
      </span>
      {toast.action && (
        <button
          onMouseDown={(e) => e.preventDefault() /* keep the composer's caret */}
          onClick={() => {
            toast.action!.run();
            dismissAgentToast(toast.id);
          }}
          className="shrink-0 rounded px-1.5 py-0.5 font-medium text-accent hover:bg-hover"
        >
          {toast.action.label}
        </button>
      )}
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => dismissAgentToast(toast.id)} title={t("agentToast.dismiss")} aria-label={t("agentToast.dismiss")} className="shrink-0 rounded p-0.5 text-subtle hover:bg-hover hover:text-foreground">
        <X size={12} />
      </button>
    </div>
  );
}

export function AgentToasts({ owner, sessionId, reserve }: { owner: string; sessionId: string; reserve(layout: null): void }) {
  const hostId = useApp(agentHost);
  const all = useAgentToasts((s) => s.toasts);
  const toasts = all.filter((t) => t.owner === owner && t.hostId === hostId && t.sessionId === sessionId);
  const anchor = useRef<HTMLSpanElement>(null);
  const [stack, setStack] = useState<HTMLElement | null>(null);
  useEffect(() => {
    reserve(null);
    return () => reserve(null);
  }, [reserve]);
  useEffect(() => {
    if (anchor.current) setStack(stackFor(anchor.current));
  }, []);
  return (
    <>
      <span ref={anchor} hidden aria-hidden="true" />
      {stack && toasts.length > 0 && createPortal(toasts.map((toast) => <Card key={toast.id} toast={toast} />), stack)}
    </>
  );
}
