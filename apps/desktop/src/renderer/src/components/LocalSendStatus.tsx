// The status of a send this desktop holds before the host's first record for it (O0), in Next Up and on the timeline:
// registry state (sending / unconfirmed / failed) and its buttons — Resend and the local, durable 「不再显示」 — from the
// Next Up registry only (lib/inputLedger/nextUpRegistry localSendView). Never a row without a button (Director
// 2026-11-14); failures say so in plain words, the raw code goes to the diagnostic log.
import { useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { LedgerOwnerOutbox } from "../lib/inputLedger/owner";
import { LOCAL_HIDE_FAILED, NEXT_UP_EFFECTS, NEXT_UP_STATES, langOf, localSendView, stateLabelKey, type NextUpEffectId } from "../lib/inputLedger/nextUpRegistry";
import { REFUSAL_TEXT } from "../lib/inputLedger/actionResult";
import { bridge } from "../bridge";
import { useApp } from "../store";

const TONE = { neutral: "text-subtle", warn: "text-warn-text", danger: "text-danger-text" } as const;
const RESEND_FAILED = { zh: "没能重新发送，这一行还在", en: "Could not resend; the row stays" } as const;

export function LocalSendStatus({ entry, sessionId, hostId, readOnly = false }: { entry: LedgerOwnerOutbox; sessionId: string; hostId: string; readOnly?: boolean }) {
  const { t, locale } = useI18n();
  const lang = langOf(locale);
  const [busy, setBusy] = useState(false);
  const view = localSendView(entry.phase === "sending" ? "sending" : "unconfirmed", entry.error);
  const def = NEXT_UP_STATES[view.state];
  const tell = (text: { zh: string; en: string }) => useApp.getState().notify(text[lang], "error", { hostId, sessionId });
  const effects: Partial<Record<NextUpEffectId, () => Promise<void> | void>> = {
    retry: async () => {
      try {
        const result = await useApp.getState().retryLedgerOutbox(sessionId, entry.inputId, hostId);
        if (result && !result.ok && REFUSAL_TEXT[result.reason]) tell(REFUSAL_TEXT[result.reason]!);
      } catch (error) {
        bridge.shell?.logError({ kind: "reported", message: `local resend failed (${entry.inputId}): ${error instanceof Error ? error.message : String(error)}` });
        tell(RESEND_FAILED);
      }
    },
    hideLocal: () => { if (!useApp.getState().discardLedgerOutbox(sessionId, entry.inputId, hostId)) tell(LOCAL_HIDE_FAILED); },
  };
  const run = async (effect: NextUpEffectId) => {
    if (busy) return;
    setBusy(true);
    try { await effects[effect]?.(); } finally { setBusy(false); }
  };
  return <>
    <span className={`truncate text-caption ${TONE[def.tone]}`} data-tip={def.meaning[lang]} data-next-up-state={view.state} data-testid="local-send-label">{t(stateLabelKey(view.state) as MessageKey)}</span>
    {view.buttons.map(effect => {
      const e = NEXT_UP_EFFECTS[effect];
      const tip = "tip" in e ? e.tip[lang] : undefined;
      return <button key={effect} type="button" disabled={readOnly || busy} className="h-5 shrink-0 rounded px-1 text-caption hover:bg-surface-2 disabled:opacity-50" data-effect={effect} data-tip={tip} aria-label={tip ? `${e.label[lang]} — ${tip}` : undefined} onClick={() => void run(effect)}>{e.label[lang]}</button>;
    })}
  </>;
}
