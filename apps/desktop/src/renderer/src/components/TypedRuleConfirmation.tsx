// Shared typed confirmation for host-owned approval rules.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ApprovalRuleDraft } from "../../../shared/ipc";
import { Button } from "./Button";
import { useI18n } from "../i18n";
import { useTrackOverlay } from "../lib/openOverlays";
import { isHTMLElement } from "../lib/ownerWindow";
import { useOwnerDocument } from "../lib/ownerContext";

const phraseFor = (draft: ApprovalRuleDraft) => `AUTO ${draft.subject.displayName || draft.subject.cutexSessionId} ${[...draft.highRiskKindsExplicit].sort().join(",")}`;

export function TypedRuleConfirmation({ draft, busy, close, submit }: { draft: ApprovalRuleDraft; busy: boolean; close(): void; submit(text: string): void }) {
  const doc = useOwnerDocument();
  const { t } = useI18n();
  const phrase = phraseFor(draft);
  const [typed, setTyped] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const title = useId();
  useTrackOverlay(true);
  useEffect(() => {
    const previous = doc.activeElement;
    dialog.current?.showModal();
    input.current?.focus();
    return () => {
      dialog.current?.close();
      if (isHTMLElement(previous) && previous.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog ref={dialog} aria-labelledby={title} onCancel={(event) => { event.preventDefault(); if (!busy) close(); }} className="fixed inset-0 m-auto w-[520px] max-w-[95vw] rounded-dialog border border-border bg-surface p-5 text-ui text-foreground shadow-e3 backdrop:bg-foreground/30">
      <h2 id={title} className="text-title">{t("approvals.rules.confirm.title")}</h2>
      <p className="mt-2 text-ui text-muted">{t("approvals.rules.confirm.hint")}</p>
      <code className="mt-3 block select-all break-all rounded-ctl bg-background px-3 py-2 text-meta">{phrase}</code>
      <label className="mt-4 block text-meta">{t("approvals.rules.confirm.type")}
        <input ref={input} value={typed} onChange={(event) => setTyped(event.target.value)} disabled={busy} autoComplete="off" className="mt-2 block w-full rounded-ctl border border-border bg-background px-3 py-2 font-mono outline-none focus:border-accent" />
      </label>
      <div className="mt-4 flex justify-end gap-2"><Button disabled={busy} onClick={close}>{t("approvals.rules.cancel")}</Button><Button variant="primary" disabled={busy || typed !== phrase} onClick={() => submit(typed)}>{t("approvals.rules.confirm.create")}</Button></div>
    </dialog>,
    doc.body,
  );
}
