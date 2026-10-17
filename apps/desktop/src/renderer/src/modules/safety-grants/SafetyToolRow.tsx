// The compact line under a tool row a runtime safety check declined (claude-safety-grants): 「已拦下，
// 等主人决定」 → 「主人已批准一次」 / 「主人未批准」, from the safety-block notice of that tool call. The row
// itself is the core one, read as 已拦截（安全检查） with the check's reason instead of 失败; a declined
// row without a block stays the plain fallback.
import { useContext } from "react";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { PlainToolRow } from "../../components/PlainToolRow";
import { useI18n } from "../../i18n";
import type { RawItem } from "../../lib/timeline";
import { safetyNoteOfItem } from "../../lib/ownerNotify";
import { focusOwnerNote, useHostOwnerNotes } from "../../lib/ownerNotifyStore";
import { agentHost, useApp } from "../../store";
import { TimelineFallbackContext } from "../timelineFallback";

export function SafetyToolRow({ item, sessionId }: { item: RawItem; sessionId: string }) {
  const { t } = useI18n();
  const fallback = useContext(TimelineFallbackContext);
  const host = useApp(agentHost);
  const notes = useHostOwnerNotes(host);
  const note = safetyNoteOfItem(notes, sessionId, item.id);
  const state = note?.safetyBlock?.state;
  if (!note || !state) return <>{fallback}</>;
  const open = state === "blocked";
  const Icon = state === "dismissed" ? ShieldX : open ? ShieldAlert : ShieldCheck;
  const tone = open ? "text-warn-text" : state === "dismissed" ? "text-subtle" : "text-ok-text";
  return (
    <>
      <PlainToolRow item={item} safetyBlock={{ reason: note.safetyBlock?.reason ?? null }} />
      <div data-safety-line={state} className={`-mt-0.5 mb-1 ml-6 flex items-center gap-1 text-[11.5px] ${tone}`}>
        <Icon size={12} aria-hidden />
        <span>{t(open ? "safety-grants.line.blocked" : state === "dismissed" ? "safety-grants.line.dismissed" : "safety-grants.line.granted")}</span>
        {open && (
          <button onClick={() => focusOwnerNote(sessionId, note.notificationId, host)} className="ml-1 rounded px-1 text-accent hover:underline">
            {t("safety-grants.line.open")}
          </button>
        )}
      </div>
    </>
  );
}
