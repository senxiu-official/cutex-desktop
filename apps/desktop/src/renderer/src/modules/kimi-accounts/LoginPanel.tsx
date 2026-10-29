// The device-code login of one Kimi account (cutex `POST /v2/kimi/accounts/{id}/login`, r266 §3.1; docs/design/049):
// cutex runs the official `kimi login` on the host and answers with the verification URL and user code; this panel
// shows them, opens the URL in the owner's browser on request (main's http(s)-only openExternal; never automatically),
// and polls `GET …/login/{loginId}` at cutex's interval until the login ends. Cancel = `DELETE …/login/{loginId}`.
// No token ever reaches the desktop; on success the account item says `credentialsPresent`.
import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, X } from "lucide-react";
import type { KimiAccount, KimiLogin } from "../../../../shared/kimiAccounts";
import { Button, IconButton } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { useTargetApi, useTargetHostLabel } from "../../lib/targetHost";
import { countdown, loginView, nextPollMs } from "./accountView";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LoginPanel({ account, initial, onDone, onClose }: {
  account: KimiAccount;
  /** A login already running (the account item's `login`), else one is started. */
  initial: KimiLogin | null;
  /** The login ended (any final state): re-read the account. */
  onDone(): void;
  onClose(): void;
}) {
  const api = useTargetApi();
  const { t } = useI18n();
  const host = useTargetHostLabel();
  const [login, setLogin] = useState<KimiLogin | null>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  // Request generation fence: a poll answer is applied only while its generation is current. A cancel, a retry, a
  // newer poll or unmount moves it on, so a GET that was in flight when the DELETE answered `cancelled` cannot put the
  // panel back to waiting (QA r265b-kimi, login cancel race).
  const generation = useRef(0);
  // While a DELETE is out, no poll starts (its answer would be fenced out anyway).
  const cancelling = useRef(false);
  // (StrictMode mounts twice: set it again on every mount, not only at creation.)
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  // Start (or take over) the login.
  useEffect(() => {
    if (attempt === 0 && initial) return;
    generation.current += 1;
    let stop = false;
    setProblem(null);
    setLost(false);
    setLogin(null);
    void api.startKimiLogin(account.id).then(
      (r) => {
        if (stop || !alive.current) return;
        if (r.ok) setLogin(r.login);
        else setProblem(refusal(r.error.code, r.error.message));
      },
      (e) => !stop && alive.current && setProblem(errorText(e)),
    );
    return () => void (stop = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Poll until final.
  const loginId = login?.loginId ?? null;
  const delay = login ? nextPollMs(login) : null;
  useEffect(() => {
    if (!loginId || delay === null) return;
    const timer = setTimeout(() => {
      if (cancelling.current) return;
      const fence = generation.current;
      const current = () => alive.current && generation.current === fence;
      void api.kimiLogin(account.id, loginId).then(
        (r) => {
          if (!current()) return;
          if (r.ok) {
            setLogin(r.login);
            if (nextPollMs(r.login) === null) onDone();
          } else if (r.error.code === "kimi_login_not_found") {
            setLost(true);
            setLogin(null);
            onDone();
          } else setProblem(refusal(r.error.code, r.error.message));
        },
        (e) => current() && setProblem(errorText(e)),
      );
    }, delay);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginId, login, delay]);

  // The countdown.
  const waiting = !!login && nextPollMs(login) !== null;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  function refusal(code: string, message: string): string {
    const key = `kimi-accounts.refusal.${code}` as MessageKey;
    return t(key) === key ? message : t(key);
  }

  const cancel = async () => {
    if (!login) return onClose();
    // From here no earlier poll answer is applied; the DELETE's answer decides the state.
    generation.current += 1;
    cancelling.current = true;
    try {
      const r = await api.cancelKimiLogin(account.id, login.loginId);
      cancelling.current = false;
      if (!alive.current) {
        // Unmounted meanwhile: nothing to show.
      } else if (r.ok) setLogin(r.login);
      else {
        setProblem(refusal(r.error.code, r.error.message));
        // Not cancelled: keep following the login (a fresh object re-arms the poll).
        setLogin({ ...login });
      }
    } catch (e) {
      cancelling.current = false;
      if (alive.current) {
        setProblem(errorText(e));
        setLogin({ ...login });
      }
    }
    onDone();
  };

  const view = login ? loginView(login, now) : null;
  const final = view && ["succeeded", "failed", "expired", "denied", "cancelled"].includes(view.phase);
  const errorLine = view?.error ? (t(`kimi-accounts.loginError.${view.error.code}` as MessageKey) === `kimi-accounts.loginError.${view.error.code}` ? view.error.message : t(`kimi-accounts.loginError.${view.error.code}` as MessageKey)) : null;
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2.5" data-kimi-login={view?.phase ?? (lost ? "lost" : problem ? "error" : "starting")}>
      <div className="mb-2 flex min-h-6 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{t("kimi-accounts.login.title", { label: account.label })}</p>
        <IconButton label={t("kimi-accounts.login.close")} onClick={() => (waiting ? void cancel().then(onClose) : onClose())}>
          <X size={13} />
        </IconButton>
      </div>
      {(!view || view.phase === "starting") && !problem && !lost && <p className="animate-pulse text-xs text-subtle">{t("kimi-accounts.login.starting")}</p>}
      {view && view.phase === "waiting" && (
        <ol className="space-y-2.5 text-xs">
          <li className="flex gap-2">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-caption/[inherit] font-medium text-accent">1</span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p>{t("kimi-accounts.login.step1")}</p>
              {view.url && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
                  <code className="min-w-0 flex-1 font-mono text-xs break-all select-all" data-kimi-login-url="">{view.url}</code>
                  <IconButton label={t("kimi-accounts.login.copy")} onClick={() => void navigator.clipboard.writeText(view.url!).catch(() => {})}>
                    <Copy size={13} />
                  </IconButton>
                </div>
              )}
              {view.url && (
                <Button primary onClick={() => void api.openExternal(view.url!).catch((e) => setProblem(errorText(e)))}>
                  <span className="inline-flex items-center gap-1"><ExternalLink size={12} />{t("kimi-accounts.login.open")}</span>
                </Button>
              )}
            </div>
          </li>
          <li className="flex gap-2">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-caption/[inherit] font-medium text-accent">2</span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p>{t("kimi-accounts.login.step2")}</p>
              {view.code && <p className="font-mono text-lg font-semibold tracking-[0.2em] select-all" data-kimi-login-code="">{view.code}</p>}
            </div>
          </li>
          <li className="flex items-center gap-2 pl-6">
            <span className="min-w-0 flex-1 text-subtle" role="status">
              {view.remaining !== null ? t("kimi-accounts.login.waiting", { time: countdown(view.remaining) }) : t("kimi-accounts.login.waitingPlain")}
            </span>
            <Button onClick={() => void cancel()}>{t("kimi-accounts.login.cancel")}</Button>
          </li>
        </ol>
      )}
      {view?.phase === "succeeded" && <p role="status" className="text-xs text-ok-text">{t("kimi-accounts.login.succeeded")}</p>}
      {view && final && view.phase !== "succeeded" && (
        <p role="status" className={`text-xs ${view.phase === "cancelled" ? "text-subtle" : "text-danger"}`}>
          {view.phase === "failed" ? t("kimi-accounts.login.failed", { error: errorLine ?? "—" }) : t(`kimi-accounts.login.${view.phase}` as MessageKey)}
        </p>
      )}
      {lost && <p role="status" className="text-xs text-warn">{t("kimi-accounts.login.lost")}</p>}
      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
      {((final && view?.phase !== "succeeded") || lost || problem) && (
        <div className="mt-2"><Button onClick={() => setAttempt((n) => n + 1)}>{t("kimi-accounts.login.retry")}</Button></div>
      )}
      <p className="mt-2 text-caption/[inherit] text-subtle">{t("kimi-accounts.login.hostNote", { host })}</p>
    </div>
  );
}
