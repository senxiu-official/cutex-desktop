// 粘贴身份密钥 (P2 person identity, main/personKey.ts parsePersonKeyString): a masked input for the
// `cutex-id-…` string the person copied on another computer. Main checks it (prefix / length /
// checksum, refused inline here), then shows the same replace confirmation as an identity file import;
// a cancelled confirmation leaves this dialog open. The pasted text lives only in this dialog's state.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, X } from "lucide-react";
import type { IdentityFileResult, IdentityImportTexts } from "../../../../shared/personIdentity";
import { api } from "../../bridge";
import { useI18n } from "../../i18n";
import { Button, IconButton } from "./Form";

const ERROR_KEYS = {
  prefix: "identity.person.keyErrorPrefix",
  length: "identity.person.keyErrorLength",
  checksum: "identity.person.keyErrorChecksum",
  key: "identity.person.keyErrorKey",
} as const;

export function IdentityKeyDialog({ texts, onClose, onDone }: { texts: IdentityImportTexts; onClose(): void; onDone(result: IdentityFileResult & { ok: true }): void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const hintId = useId();
  const errorId = useId();
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    input.current?.focus();
    return () => el.close();
  }, []);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.importIdentityKey(text, texts);
      if (r.ok) return onDone(r);
      if (r.canceled) return;
      setError(r.errorCode ? t(ERROR_KEYS[r.errorCode], { message: r.error ?? "" }) : t("identity.person.failed", { message: r.error ?? "" }));
    } catch (e) {
      setError(t("identity.person.failed", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-0 m-auto w-[480px] max-w-[95vw] rounded-2xl border border-border bg-surface p-5 text-foreground shadow-2xl backdrop:bg-black/40"
    >
      <div className="mb-2 flex items-center">
        <h3 id={titleId} className="font-semibold">{t("identity.person.pasteTitle")}</h3>
        <span className="ml-auto">
          <IconButton label={t("settings.cancel")} disabled={busy} onClick={onClose}>
            <X size={15} />
          </IconButton>
        </span>
      </div>
      <p id={hintId} className="mb-3 text-xs text-subtle">{t("identity.person.pasteHint")}</p>
      <div>
        <div className="flex items-center gap-1.5">
          <input
            ref={input}
            type={shown ? "text" : "password"}
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="cutex-id-…"
            aria-label={t("identity.person.pasteTitle")}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-testid="identity-key-input"
            className={`min-w-0 flex-1 rounded-md border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50 ${error ? "border-danger" : "border-border"}`}
          />
          <IconButton label={t(shown ? "mask.hide" : "mask.reveal")} onClick={() => setShown((v) => !v)}>
            {shown ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconButton>
        </div>
        {error && (
          <p id={errorId} role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button disabled={busy} onClick={onClose}>{t("settings.cancel")}</Button>
          <Button primary disabled={busy || !text.trim()} onClick={() => void submit()}>{t("identity.person.pasteSubmit")}</Button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
