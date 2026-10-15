import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { useArmed } from "../../lib/armedConfirm";
import { useModulePref } from "../react";
import type { SideBodyProps } from "../slots";
import { forkInput, initSide, sideStart, takeSideText, type SideState } from "./cardState";
import { useTurnLabel } from "./hooks";
import { closeSideInstance, isSideGone, loadSide, openSideChat, setSideDraft, showSide, sideKey, useSides } from "./state";
import { SideChatBody } from "./SideChatBody";
import { useModuleHostGate } from "../../lib/hostGatingView";
import { sideErrorText } from "./errors";

/** A host without side-chat routes (older cutex): a calm notice, no calls. */
export function SideChatCard(props: SideBodyProps<SideState>) {
  const { t } = useI18n();
  const gate = useModuleHostGate("side-chat", props.hostId);
  if (props.hostId && !gate.ok) return <p data-side-unsupported className="p-4 text-xs text-subtle">{t(gate.waiting ? "side-chat.loading" : "side-chat.unsupportedHost")}</p>;
  return <SideChatCardBody {...props} />;
}

function SideChatCardBody(props: SideBodyProps<SideState>) {
  const { instance, hostId, sessionId, setState, visible, revealed } = props;
  const { t } = useI18n();
  const [scope] = useModulePref("side-chat", "forkScope", "all");
  const [model] = useModulePref("side-chat", "model", "");
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reopening, setReopening] = useState(false);
  const [armed, setArmed] = useArmed();
  const { chatId, start, request } = instance.state;
  const params = sideStart(request ?? start);
  const view = useSides(s => hostId && chatId ? s.views[sideKey(hostId, chatId)] : undefined);
  const oldLabel = useTurnLabel(hostId ?? "", sessionId ?? "", view?.chat.anchorTurnId ?? view?.chat.forkedThroughTurnId);
  const newLabel = useTurnLabel(hostId ?? "", sessionId ?? "", params.turnId);
  const ended = gone || view?.chat.status === "closed" || view?.chat.status === "stale";
  const differs = !!params.turnId && !!view && params.turnId !== (view.chat.anchorTurnId ?? view.chat.forkedThroughTurnId);
  useEffect(() => {
    if (!visible || !hostId || !sessionId) return;
    let disposed = false;
    setError(null); setGone(false);
    const task = chatId ? loadSide(hostId, sessionId, chatId) : openSideChat(instance.id, hostId, sessionId, forkInput(sideStart(start), String(scope), String(model)), sideStart(start).text ?? "").then(id => {
      takeSideText(start);
      if (!disposed) setState({ chatId: id, ...(start ? { request: start } : {}) });
    });
    void task.catch(e => { if (!disposed) { setGone(isSideGone(e)); setError(e instanceof Error ? e.message : String(e)); } });
    return () => { disposed = true; };
  }, [instance.id, hostId, sessionId, chatId, start, visible, retry]);
  useEffect(() => {
    if (!visible || !hostId || !chatId) return;
    const hide = showSide(hostId, chatId);
    const text = takeSideText(request); if (text.trim()) setSideDraft(hostId, chatId, text);
    return hide;
  }, [hostId, chatId, visible, request]);
  const reopen = async () => {
    if (!hostId || !sessionId || reopening) return;
    setReopening(true);
    try {
      if (await closeSideInstance(instance.id, hostId, sessionId, chatId)) {
        setGone(false); setError(null); setArmed(false);
        setState(initSide(params, null));
      }
    } finally { setReopening(false); }
  };
  if (!hostId || !sessionId) return <p className="p-4 text-sm text-muted">{t("side-chat.missingSession")}</p>;
  if (ended) return <div className="p-4 text-sm text-muted">{t("side-chat.ended")} · <button className="text-accent hover:underline" disabled={reopening} onClick={() => void reopen()}>{t("side-chat.new")}</button></div>;
  return <div className="flex h-full min-h-0 flex-col">
    {differs && <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2 text-xs text-muted">
      <span>{t("side-chat.existingAnchor", { turn: oldLabel })}</span>
      <button className={armed ? "text-danger" : "text-accent"} disabled={reopening} onClick={() => armed ? void reopen() : setArmed(true)}>{armed ? t("side-chat.reopenConfirm") : t("side-chat.reopenFrom", { turn: newLabel })}</button>
    </div>}
    {error && <p role="alert" className="p-4 text-xs text-danger">{sideErrorText(error, t)} <button className="underline" onClick={() => setRetry(n => n + 1)}>{t("side-chat.retry")}</button></p>}
    {chatId ? <SideChatBody hostId={hostId} sessionId={sessionId} chatId={chatId} visible={visible} revealed={revealed} /> : !error && <p className="p-4 text-sm text-muted">{t("side-chat.loading")}</p>}
  </div>;
}
