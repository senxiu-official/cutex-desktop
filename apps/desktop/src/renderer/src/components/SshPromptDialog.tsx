// The SSH question dialog (key passphrase, password, keyboard-interactive, unknown host key): one
// question at a time, oldest first, from any host / operation (lib/sshPrompts.ts).
import { useState } from "react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { answerSshPrompt, useSshPrompts } from "../lib/sshPrompts";
import type { SshPromptView } from "../../../shared/sshPrompt";

export function SshPromptDialog() {
  const prompts = useSshPrompts();
  const first = prompts[0];
  if (!first) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 pt-[18vh]">
      {/* role: Esc anywhere else stops the running turn unless a dialog is open (lib/escInterrupt). */}
      <div role="dialog" aria-modal="true" className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-4 shadow-2xl">
        <PromptBody key={first.id} prompt={first} more={prompts.length - 1} />
      </div>
    </div>
  );
}

function PromptBody({ prompt, more }: { prompt: SshPromptView; more: number }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const done = (answer: string | null) => {
    setValue("");
    answerSshPrompt(prompt.id, answer);
  };
  const title = t(`sshPrompt.title.${prompt.kind}` as MessageKey, { target: prompt.target });
  const button = "rounded-md px-3 py-1 text-sm";
  const footer = more > 0 ? <span className="mr-auto self-center text-xs text-subtle">{t("sshPrompt.more", { n: more })}</span> : null;
  const message = <div className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted select-text">{prompt.message.trim()}</div>;

  if (prompt.kind === "hostKey" || prompt.kind === "confirm" || prompt.kind === "notice") {
    const hostKey = prompt.kind === "hostKey";
    return (
      <div onKeyDown={(e) => e.key === "Escape" && done(null)}>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <ShieldAlert size={16} className="shrink-0 text-warn" />
          <span className="min-w-0 break-words">{title}</span>
        </div>
        {hostKey && prompt.fingerprint && (
          <div className="mb-3 rounded-md border border-border bg-background px-2.5 py-2">
            <div className="text-xs text-subtle">
              {t("sshPrompt.fingerprint")}
              {prompt.keyType ? ` · ${prompt.keyType}` : ""}
            </div>
            <div className="mt-0.5 break-all font-mono text-sm select-text">{prompt.fingerprint}</div>
          </div>
        )}
        {message}
        {hostKey && <div className="mb-3 text-xs text-subtle">{t("sshPrompt.hostKeyHint")}</div>}
        <div className="mt-4 flex justify-end gap-2">
          {footer}
          {prompt.kind === "notice" ? (
            <button autoFocus onClick={() => done(null)} className={`${button} bg-accent text-white`}>
              {t("sshPrompt.close")}
            </button>
          ) : (
            <>
              <button autoFocus onClick={() => done(hostKey ? "no" : null)} className={`${button} text-muted hover:bg-surface-2`}>
                {hostKey ? t("sshPrompt.reject") : t("sshPrompt.deny")}
              </button>
              <button onClick={() => done("yes")} className={`${button} bg-accent text-white`}>
                {hostKey ? t("sshPrompt.trust") : t("sshPrompt.allow")}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        done(value);
      }}
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <KeyRound size={16} className="shrink-0 text-muted" />
        <span className="min-w-0 break-words">{title}</span>
      </div>
      {message}
      <input
        autoFocus
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        maxLength={4096}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && done(null)}
        aria-label={title}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent"
      />
      <div className="mt-1.5 text-xs text-subtle">{t("sshPrompt.secretHint")}</div>
      <div className="mt-4 flex justify-end gap-2">
        {footer}
        <button type="button" onClick={() => done(null)} className={`${button} text-muted hover:bg-surface-2`}>
          {t("dialog.cancel")}
        </button>
        <button type="submit" className={`${button} bg-accent text-white`}>
          {t("sshPrompt.submit")}
        </button>
      </div>
    </form>
  );
}
