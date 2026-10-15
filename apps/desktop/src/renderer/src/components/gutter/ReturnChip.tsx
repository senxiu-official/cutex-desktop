// 「回到」 next to 「到底部」 at the conversation's bottom centre (docs/desktop-modules.md §19.7): after a
// jump, back to where the owner was reading (Alt+← when focus is not in a text field). Also the
// jump's own notes: paging older history, and 「太早了：用参考卡片看这一轮」 when the turn is further back
// than a jump pages.
import { useEffect } from "react";
import { CornerUpLeft, Loader2, TextQuote, X } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { isEditableTarget } from "../../lib/escInterrupt";
import { dismissMiss, goBack, useJump } from "../../lib/jump";
import { getUiPrefs } from "../../lib/prefs";
import { returnLabel } from "../../lib/returnPoint";
import { sideOpenPeek } from "../../lib/sideServices";
import { TURN_PEEK } from "../../lib/sideKinds";
import { useApp } from "../../store";

const CHIP = "pointer-events-auto flex h-7 items-center gap-1.5 rounded-full border border-border bg-background pr-3 pl-2.5 text-xs text-foreground shadow-md hover:bg-surface";

export function ReturnChip({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const back = useJump((s) => s.back);
  const miss = useJump((s) => s.miss);
  const busy = useJump((s) => s.busy);
  const shown = !!back && (back.target.sessionId === sessionId || back.point.sessionId === sessionId);
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key !== "ArrowLeft" || e.defaultPrevented) return;
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      e.preventDefault();
      void goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);
  // The 太早了 note goes away by itself.
  useEffect(() => {
    if (!miss) return;
    const timer = setTimeout(dismissMiss, 12_000);
    return () => clearTimeout(timer);
  }, [miss]);
  const missHere = miss && miss.sessionId === sessionId ? miss : null;
  if (!shown && !missHere && !busy) return null;
  const label = back ? returnLabel(back, sessionId) : null;
  return (
    <>
      {busy && (
        <span className="pointer-events-auto flex h-7 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs text-muted shadow-md">
          <Loader2 size={13} className="animate-spin" />
          {t("gutter.paging")}
        </span>
      )}
      {missHere && (
        <span className="pointer-events-auto flex h-7 items-center gap-1 rounded-full border border-border bg-background pr-1 pl-3 text-xs text-muted shadow-md">
          {t(missHere.reason === "too-old" ? "gutter.tooOld" : "gutter.notFound")}
          {missHere.reason === "too-old" && (
            <button
              onClick={() => {
                dismissMiss();
                const r = sideOpenPeek(TURN_PEEK, { hostId: missHere.hostId, sessionId: missHere.sessionId, turnId: missHere.turnId }, getUiPrefs().peekTarget, { focus: true });
                if (r.status !== "opened") useApp.getState().notify(t("side.unavailable", { what: t("gutter.peek"), reason: t(r.status === "stale" ? "side.reason.stale" : (`side.reason.${r.reason}` as MessageKey)) }), "error");
              }}
              className="ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-accent hover:bg-hover"
            >
              <TextQuote size={12} />
              {t("gutter.tooOldOpen")}
            </button>
          )}
          <button onClick={dismissMiss} title={t("gutter.dismiss")} aria-label={t("gutter.dismiss")} className="flex h-5 w-5 items-center justify-center rounded-full text-subtle hover:bg-hover hover:text-foreground">
            <X size={12} />
          </button>
        </span>
      )}
      {shown && label && (
        <button onClick={() => void goBack()} title={t("gutter.returnHint")} className={CHIP}>
          <CornerUpLeft size={13} className="text-accent" />
          {t(label.key, label.vars)}
        </button>
      )}
    </>
  );
}
