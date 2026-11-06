import { useRef, useState } from "react";
import type { InputRecord } from "@cutex-desktop/protocol";
import { useI18n } from "../i18n";
import { featuresOf, useApp } from "../store";
import { useConvHost } from "../lib/conversationScope";
import { usesOwnerCarries } from "../lib/deliveryMode";

export function InputHoldControl({ record, sessionId, hostId }: { record: InputRecord; sessionId: string; hostId?: string }) {
  const convHost = useConvHost();
  const host = hostId ?? convHost;
  const enabled = useApp(s => usesOwnerCarries([...featuresOf(s, host)]));
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  if (!enabled || record.surface !== "nextUp" || record.kind === "owner" || record.kind === "delegationRequest") return null;
  // Offered actions are authoritative, including after a reconnect.
  const held = record.actions?.includes("releaseHold");
  if (!held && !record.actions?.includes("hold")) return null;
  const act = async () => {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try { await useApp.getState().holdInput(sessionId, record.inputId, !held, host); }
    catch (error) { useApp.getState().notify(String(error), "error", { hostId: host, sessionId }); }
    finally { busy.current = false; setPending(false); }
  };
  return <button type="button" disabled={pending} onClick={() => void act()} className="h-5 shrink-0 rounded px-1 text-caption hover:bg-surface-2 disabled:opacity-50">{t(held ? "inputLedger.releaseHold" : "inputLedger.hold")}</button>;
}
