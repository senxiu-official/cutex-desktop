// The add flow of Claude accounts, used by the Claude 账户 section (Settings → Profile) and, as a
// dialog, by 「+ 添加订阅」 beside the profile editor's / 添加 profile form's 账户 select (this module's
// `profile.fieldAction`): name (+ API settings) → cutex creates the account → the terminal guide
// (login command, or the hidden key command) → 完成 asks cutex for the status. The desktop never runs
// the login and never sees a credential (docs/research/claude-multi-account.md decision 2).
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Copy, Plus, X } from "lucide-react";
import { CLAUDE_KEY_ENVS, type ClaudeAccount, type ClaudeAccountKind, type ClaudeKeyEnv } from "../../../../shared/claudeAccounts";
import { Button, IconButton, Segmented, Select, SettingRow, TextArea, TextInput } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { useOverlayState } from "../../lib/contextMenu";
import { useTrackOverlay } from "../../lib/openOverlays";
import { services } from "../app";
import type { ProfileFieldActionProps } from "../slots";
import { accountCreateRequest, apiKeyCommand, guessKeyShell, type KeyShell } from "./accountView";
import { errorText, useAccountTitle, useHostLabel, useRefusalText } from "./hooks";
import { useTargetApi } from "../../lib/targetHost";

/** One command to copy (the whole line selects on click too). */
function CommandBox({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
      <code className="min-w-0 flex-1 font-mono text-xs break-all select-all">{text}</code>
      <IconButton label={t("claude-accounts.guide.copy")} onClick={() => void navigator.clipboard.writeText(text).catch(() => {})}>
        <Copy size={13} />
      </IconButton>
    </div>
  );
}

/** `onClose` absent: no × (the dialog has its own). */
function GuideFrame({ title, onClose, children }: { title: string; onClose?(): void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2.5">
      <div className="mb-2 flex min-h-6 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{title}</p>
        {onClose && (
          <IconButton label={t("common.close")} onClick={onClose}>
            <X size={13} />
          </IconButton>
        )}
      </div>
      <ol className="space-y-2.5 text-xs">{children}</ol>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-medium text-accent">{n}</span>
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
    </li>
  );
}

/** The 完成 step: ask cutex, then say what it found. */
function useCheckStep(account: ClaudeAccount, onChecked: (a: ClaudeAccount) => void, done: (a: ClaudeAccount) => boolean, onDone: (a: ClaudeAccount) => void) {
  const api = useTargetApi();
  const refusalText = useRefusalText();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (describe: (a: ClaudeAccount, ok: boolean) => string) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.checkClaudeAccount(account.id);
      if (!r.ok) return setResult({ ok: false, text: refusalText(r.error) });
      onChecked(r.account);
      const ok = done(r.account);
      if (ok) onDone(r.account);
      else setResult({ ok, text: describe(r.account, ok) });
    } catch (error) {
      setResult({ ok: false, text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, result, run };
}

type LoginShell = "cutex" | "powershell" | "posix";

interface GuideProps {
  account: ClaudeAccount;
  onChecked(a: ClaudeAccount): void;
  /** After a successful 完成, and from the guide's × (absent: no ×). */
  onClose(): void;
  closable?: boolean;
}

function LoginGuide({ account: a, onChecked, onClose, closable = true }: GuideProps) {
  const { t } = useI18n();
  const host = useHostLabel();
  const titleOf = useAccountTitle();
  const [shell, setShell] = useState<LoginShell>("cutex");
  const check = useCheckStep(
    a,
    onChecked,
    (next) => next.status?.loggedIn === true,
    (next) => {
      const who = [next.status?.email, next.status?.orgName].filter(Boolean).join(" · ") || titleOf(next);
      services.ui.notice(t("claude-accounts.guide.loggedInAs", { who }));
      onClose();
    },
  );
  const commands = a.loginCommand;
  return (
    <GuideFrame title={t("claude-accounts.guide.loginTitle", { label: titleOf(a) })} onClose={closable ? onClose : undefined}>
      <Step n={1}>
        <p>{t("claude-accounts.guide.step1", { host })}</p>
        {commands ? (
          <>
            <Segmented
              label={t("claude-accounts.guide.shell")}
              value={shell}
              onChange={setShell}
              options={[
                { value: "cutex", label: "cutex" },
                { value: "powershell", label: "PowerShell" },
                { value: "posix", label: "bash / zsh" },
              ]}
            />
            <CommandBox text={commands[shell]} />
            <p className="truncate text-[11px] text-subtle" title={commands.claudeConfigDir}>
              {t("claude-accounts.guide.home")}: <span className="font-mono">{commands.claudeConfigDir}</span>
            </p>
          </>
        ) : (
          <CommandBox text={`cutex human claude account login ${a.id}`} />
        )}
      </Step>
      <Step n={2}>
        <p>{t("claude-accounts.guide.step2")}</p>
      </Step>
      <Step n={3}>
        <p>{t("claude-accounts.guide.step3")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button primary disabled={check.busy} onClick={() => void check.run((next) => (next.status?.error ? t("claude-accounts.guide.stillOutError", { error: next.status.error }) : t("claude-accounts.guide.stillOut")))}>
            {t("claude-accounts.guide.done")}
          </Button>
          {check.busy && <span className="animate-pulse text-subtle">{t("common.loading")}</span>}
          {check.result && <span className={check.result.ok ? "text-ok-text" : "text-warn"}>{check.result.text}</span>}
        </div>
      </Step>
    </GuideFrame>
  );
}

function KeyGuide({ account: a, onChecked, onClose, closable = true }: GuideProps) {
  const { t } = useI18n();
  const host = useHostLabel();
  const titleOf = useAccountTitle();
  const [shell, setShell] = useState<KeyShell>(() => guessKeyShell(a.home));
  const check = useCheckStep(
    a,
    onChecked,
    (next) => next.api?.apiKeyPresent === true,
    () => {
      services.ui.notice(t("claude-accounts.guide.keyStored"));
      onClose();
    },
  );
  const command = apiKeyCommand(a.id, shell);
  return (
    <GuideFrame title={t("claude-accounts.guide.keyTitle", { label: titleOf(a) })} onClose={closable ? onClose : undefined}>
      <Step n={1}>
        <p>{t("claude-accounts.guide.keyStep1", { host })}</p>
        <Segmented
          label={t("claude-accounts.guide.shell")}
          value={shell}
          onChange={setShell}
          options={[
            { value: "powershell", label: "PowerShell" },
            { value: "posix", label: "bash / zsh" },
          ]}
        />
        {command && <CommandBox text={command} />}
      </Step>
      <Step n={2}>
        <p>{t("claude-accounts.guide.keyStep2")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button primary disabled={check.busy} onClick={() => void check.run(() => t("claude-accounts.guide.keyMissing"))}>
            {t("claude-accounts.guide.done")}
          </Button>
          {check.busy && <span className="animate-pulse text-subtle">{t("common.loading")}</span>}
          {check.result && <span className="text-warn">{check.result.text}</span>}
        </div>
      </Step>
    </GuideFrame>
  );
}

/** The terminal guide of an account: log in (subscription) or store the key (API). */
export function AccountGuide(props: GuideProps) {
  return props.account.kind === "api" ? <KeyGuide {...props} /> : <LoginGuide {...props} />;
}

/**
 * The add form for one kind (the button chose it): a name; API accounts also take a base URL, the key
 * header and extra settings (never the key). `dialog`: laid out for the dialog instead of a card row.
 */
export function AddForm({ kind, onCancel, onCreated, dialog }: { kind: ClaudeAccountKind; onCancel(): void; onCreated(account: ClaudeAccount): void; dialog?: boolean }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const refusalText = useRefusalText();
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [keyEnv, setKeyEnv] = useState<ClaudeKeyEnv>("ANTHROPIC_API_KEY");
  const [envText, setEnvText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const r = accountCreateRequest(kind, { label, baseUrl, keyEnv, envText });
    if ("error" in r) return setProblem(r.error === "badLabel" ? t("claude-accounts.form.badLabel") : t("claude-accounts.form.envBad", { lines: r.lines.join(", ") }));
    setBusy(true);
    setProblem(null);
    try {
      const created = await api.createClaudeAccount(r.request);
      if (created.ok) onCreated(created.account);
      else setProblem(refusalText(created.error));
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const keyEnvLabel: Record<ClaudeKeyEnv, MessageKey> = { ANTHROPIC_API_KEY: "claude-accounts.form.keyEnvApiKey", ANTHROPIC_AUTH_TOKEN: "claude-accounts.form.keyEnvAuthToken" };
  return (
    <div className={dialog ? "@container px-5 pt-1" : "@container -mx-4 border-b border-border bg-surface-2/40 px-4 pt-1"}>
      <SettingRow label={t("claude-accounts.form.label")} hint={t(kind === "api" ? "claude-accounts.form.apiNote" : "claude-accounts.form.subscriptionNote")}>
        <TextInput
          autoFocus
          width="w-64"
          label={t("claude-accounts.form.label")}
          maxLength={64}
          value={label}
          placeholder={t(kind === "api" ? "claude-accounts.form.labelPlaceholderApi" : "claude-accounts.form.labelPlaceholder")}
          onChange={(v) => (setLabel(v), setProblem(null))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && kind === "subscription") void submit();
            if (e.key === "Escape") onCancel();
          }}
        />
      </SettingRow>
      {kind === "api" && (
        <>
          <SettingRow label={t("claude-accounts.form.baseUrl")} hint={t("claude-accounts.form.baseUrlHint")}>
            <TextInput mono width="w-64" label={t("claude-accounts.form.baseUrl")} value={baseUrl} placeholder="https://api.deepseek.com/anthropic" onChange={(v) => (setBaseUrl(v), setProblem(null))} />
          </SettingRow>
          <SettingRow label={t("claude-accounts.form.keyEnv")}>
            <Select width="w-64" label={t("claude-accounts.form.keyEnv")} value={keyEnv} onChange={setKeyEnv} options={CLAUDE_KEY_ENVS.map((k) => ({ value: k, label: t(keyEnvLabel[k]) }))} />
          </SettingRow>
          <SettingRow label={t("claude-accounts.form.env")} hint={t("claude-accounts.form.envHint")}>
            <TextArea mono width="w-64" rows={3} label={t("claude-accounts.form.env")} value={envText} placeholder="ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro" onChange={(v) => (setEnvText(v), setProblem(null))} />
          </SettingRow>
        </>
      )}
      <div className={`flex flex-wrap items-center gap-2 py-2.5 ${dialog ? "justify-end" : ""}`}>
        {problem && <span className={`text-xs text-danger ${dialog ? "mr-auto" : "order-last"}`}>{problem}</span>}
        {dialog && <Button onClick={onCancel}>{t("dialog.cancel")}</Button>}
        <Button primary disabled={busy || !label.trim()} onClick={() => void submit()}>
          {t("claude-accounts.form.create")}
        </Button>
        {!dialog && <Button onClick={onCancel}>{t("dialog.cancel")}</Button>}
      </div>
    </div>
  );
}

/**
 * 添加 Claude 订阅 as a dialog over the profile editor / 添加 profile form: the form, then — once cutex
 * created the account and it sits in the profile's draft — the login guide. Closing it at any point
 * keeps what was done (an account that still needs its login shows 需要登录 in the select).
 */
function AddSubscriptionDialog({ onPicked, onClose }: { onPicked(id: string): void | Promise<void>; onClose(): void }) {
  const { t } = useI18n();
  const titleOf = useAccountTitle();
  const [account, setAccount] = useState<ClaudeAccount | null>(null);
  const overlay = useOverlayState();
  const overlayOpen = !!(overlay.menu || overlay.dialog);
  useTrackOverlay(true);
  // Esc closes (not while a menu / confirm of its own is open); the capture phase keeps it from the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || overlayOpen) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, overlayOpen]);
  const title = t("claude-accounts.addSubscription");
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label={title} className="flex max-h-[80vh] w-[34rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
          <IconButton label={t("common.close")} onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        {account ? (
          <div className="space-y-3 overflow-y-auto px-5 py-4">
            <p className="text-xs text-subtle">{t("claude-accounts.dialog.picked", { label: titleOf(account) })}</p>
            {/* A check changed the status: pick it again, so the select behind re-reads the list (需要登录 → 已登录). */}
            <AccountGuide account={account} onChecked={(next) => (setAccount(next), void onPicked(next.id))} onClose={onClose} closable={false} />
            <div className="flex justify-end">
              <Button onClick={onClose}>{t("claude-accounts.dialog.later")}</Button>
            </div>
          </div>
        ) : (
          <div className="overflow-y-auto">
            <AddForm
              dialog
              kind="subscription"
              onCancel={onClose}
              onCreated={(created) => {
                setAccount(created);
                void onPicked(created.id);
              }}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** `profile.fieldAction` on `claudeAccount`: 「+ 添加订阅」 beside the 账户 select. */
export function AddSubscriptionAction({ pick, disabled }: ProfileFieldActionProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-0.5 rounded text-xs whitespace-nowrap text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:opacity-40 disabled:hover:no-underline"
      >
        <Plus size={12} />
        {t("claude-accounts.addSubscriptionShort")}
      </button>
      {open && <AddSubscriptionDialog onPicked={pick} onClose={() => setOpen(false)} />}
    </>
  );
}
