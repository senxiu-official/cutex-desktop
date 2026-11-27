// 「今日」 in a portrait / narrow window (owner 2026-11-27): a band over the top of an assistant's conversation, folded
// into one line (待你确认 / 在办 counts) that opens the compact view. `conversation.overlay`, mounted for every agent,
// so this file stays small and loads the view only when the band is opened.
import { useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useI18n } from "../../i18n";
import { useConvHost } from "../../lib/conversationScope";
import { lazyPage } from "../../lib/lazyPage";
import { useOwnerWindow } from "../../lib/ownerContext";
import { requestGroup } from "../../lib/personalAssistants";
import { usePa } from "../../lib/personalAssistantStore";
import type { OverlayLayout } from "../slots";
import { setBandOpen, useBandOpen, useBandWindow, useTodayPaneShown } from "./todayModel";

const TodayView = lazyPage(() => import("./TodayView").then((m) => m.TodayView));

/** `conversation.overlay`: 今日 folded into a line over an assistant's conversation when the window is portrait / narrow. */
export function TodayBand({ sessionId, reserve }: { sessionId: string; reserve(layout: OverlayLayout | null): void }) {
  const { t } = useI18n();
  const hostId = useConvHost();
  const win = useOwnerWindow();
  const narrow = useBandWindow(win);
  const assistant = usePa((s) => s.byHost[hostId]?.assistants.find((a) => a.sessionId === sessionId) ?? null);
  const counts = usePa((s) => {
    const list = assistant ? s.byHost[hostId]?.requests[assistant.id] ?? [] : [];
    return `${list.filter((r) => requestGroup(r.state) === "decide").length}/${list.filter((r) => requestGroup(r.state) === "open").length}`;
  });
  const open = useBandOpen();
  // A 今日 pane already on screen (the window kept its right view): no band.
  const paneShown = useTodayPaneShown();
  const shown = narrow && !!assistant && !paneShown;
  useEffect(() => {
    reserve(shown ? { anchor: "top", overColumn: true } : null);
    return () => reserve(null);
  }, [shown, reserve]);
  if (!shown || !assistant) return null;
  const [decide, inFlight] = counts.split("/").map(Number);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-[5] flex justify-center px-3" data-pa-today-band={open ? "open" : "closed"}>
      <div className="pointer-events-auto w-full max-w-[44rem] rounded-lg border border-border bg-surface/95 shadow-md backdrop-blur">
        <button type="button" className="press flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left" onClick={() => setBandOpen(!open)} aria-expanded={open} data-pa-today-band-toggle="">
          <span className="text-ui/[inherit] font-semibold">{t("personal-assistants.todayView.title")}</span>
          <span className={`text-caption/[inherit] ${decide ? "font-medium text-attention" : "text-subtle"}`}>{t("personal-assistants.todayView.bandDecide", { n: decide ?? 0 })}</span>
          <span className="text-caption/[inherit] text-subtle">· {t("personal-assistants.todayView.bandOpen", { n: inFlight ?? 0 })}</span>
          <span className="flex-1" />
          {open ? <ChevronUp size={14} className="text-subtle" aria-hidden /> : <ChevronDown size={14} className="text-subtle" aria-hidden />}
        </button>
        {open && (
          <div className="max-h-[min(45vh,28rem)] overflow-y-auto border-t border-border px-3 pt-2" data-pa-today-band-body="">
            <TodayView hostId={hostId} assistant={assistant} compact />
          </div>
        )}
      </div>
    </div>
  );
}
