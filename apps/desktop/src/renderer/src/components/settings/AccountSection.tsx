// Profile account rows (cutex profile-login, inside the editor's 账户 section): who this profile is signed in as, sign in with ChatGPT
// (browser flow) or an API key, sign out. Replaces logging in from the TUI. Never shows secrets.
import { useEffect, useRef, useState } from "react";
import type { ProfileAccountView, ProfileLogin } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { updateCachedProfile } from "../../lib/profileSnapshot";
import { Button, SettingRow, TextInput } from "./Form";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `initial`: the account view the editor already fetched with the profile (lib/profileSnapshot), so the
 *  rows render in the same paint; undefined = fetch here. */
export function AccountRows({ profile, initial, onChanged }: { profile: string; initial?: ProfileAccountView | null; onChanged?(): void }) {
  const api = useTargetApi();
  const targetHost = useTargetHostId();
  const { t } = useI18n();
  const [view, setViewState] = useState<ProfileAccountView | null | undefined>(initial);
  const setView = (v: ProfileAccountView | null | undefined) => {
    setViewState(v);
    if (v !== undefined) updateCachedProfile(profile, { account: v }, targetHost);
  };
  const [login, setLogin] = useState<ProfileLogin | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 退出登录 is click-twice in place (lib/armedConfirm), no dialog.
  const [logoutArmed, setLogoutArmed] = useArmed(profile);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = () =>
    api.profileAccount(profile).then(
      (v) => (setView(v), onChanged?.()),
      (e: unknown) => (setView(null), setError(errorText(e))),
    );
  const stopPolling = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  // While a ChatGPT login is pending, poll about once a second (cutex has no push event for it).
  // A few failed reads in a row (daemon restart, network blip) are tolerated before giving up.
  const poll = (loginId: string) => {
    stopPolling();
    let failures = 0;
    timer.current = setInterval(() => {
      api.profileLoginStatus(profile, loginId).then(
        (l) => {
          failures = 0;
          setLogin(l);
          if (l.status !== "pending") {
            stopPolling();
            void refresh();
          }
        },
        () => {
          if (++failures >= 5) {
            stopPolling();
            void refresh();
          }
        },
      );
    }, 1000);
  };

  // A background refresh of the profile snapshot hands in a newer view (not while a login is running).
  useEffect(() => {
    if (initial !== undefined && login?.status !== "pending") setViewState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  useEffect(() => {
    if (initial !== undefined) {
      if (initial?.activeLogin?.status === "pending") {
        setLogin(initial.activeLogin);
        poll(initial.activeLogin.loginId);
      }
      return stopPolling;
    }
    void api.profileAccount(profile).then(
      (v) => {
        setView(v);
        if (v?.activeLogin?.status === "pending") {
          setLogin(v.activeLogin);
          poll(v.activeLogin.loginId);
        }
      },
      () => setView(null),
    );
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  if (view === undefined || view === null) return null; // unsupported (Claude / older cutex) → hide
  const a = view.account;
  const pending = login?.status === "pending";

  const startChatGpt = async () => {
    setError(null);
    try {
      const l = await api.profileLogin(profile, { type: "chatgpt" });
      setLogin(l);
      if (l.authUrl) await api.openExternal(l.authUrl);
      poll(l.loginId);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const submitKey = async () => {
    setError(null);
    try {
      const l = await api.profileLogin(profile, { type: "apiKey", apiKey: apiKey.trim() });
      setApiKey("");
      setLogin(l);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const logout = async () => {
    setLogoutArmed(false);
    setError(null);
    try {
      setView(await api.profileLogout(profile));
      onChanged?.();
      setLogin(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <SettingRow label={t("account.status")}>
        <span className="text-sm">
          {a.loggedIn ? t(`account.mode.${a.authMode}` as MessageKey) : <span className="text-subtle">{t("account.signedOut")}</span>}
          {a.email && <span className="ml-2 text-muted">{a.email}</span>}
          {a.planType && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{a.planType}</span>}
        </span>
        {a.loggedIn &&
          (logoutArmed ? (
            <button className={ARMED_FORM_BUTTON} title={t("account.logoutConfirm")} onClick={() => void logout()}>
              {t("account.logoutAgain")}
            </button>
          ) : (
            <Button onClick={() => setLogoutArmed(true)}>{t("account.logout")}</Button>
          ))}
      </SettingRow>
      {view.supportedLoginTypes.includes("chatgpt") && (
        <SettingRow label="ChatGPT" hint={pending ? t("account.pendingHint") : undefined}>
          {pending ? (
            <>
              {login?.authUrl && <Button onClick={() => void api.openExternal(login.authUrl!)}>{t("account.reopen")}</Button>}
              <Button onClick={() => void api.profileLoginCancel(profile, login!.loginId).then((l) => (stopPolling(), setLogin(l)))}>{t("account.cancel")}</Button>
            </>
          ) : (
            <Button primary={!a.loggedIn} onClick={() => void startChatGpt()}>{t(a.loggedIn ? "account.relogin" : "account.chatgpt")}</Button>
          )}
        </SettingRow>
      )}
      {/* Official profiles only: signing in with an OpenAI API key instead of ChatGPT writes the
          same auth.json slot (switches the auth mode). API-key profiles use the editor's key field. */}
      {view.supportedLoginTypes.includes("apiKey") && view.supportedLoginTypes.includes("chatgpt") && (
        <SettingRow label={t("account.useKeyInstead")} hint={t("account.useKeyInsteadHint")}>
          <TextInput mono width="w-48" type="password" value={apiKey} onChange={setApiKey} placeholder="sk-…" />
          <Button disabled={!apiKey.trim()} onClick={() => void submitKey()}>{t("account.useKey")}</Button>
        </SettingRow>
      )}
      {login && login.status !== "pending" && (
        <p className={`py-1 text-xs ${login.status === "succeeded" ? "text-ok-text" : "text-danger"}`}>
          {t(`account.result.${login.status}` as MessageKey)}
          {login.error ? ` — ${login.error}` : ""}
          {login.warning ? ` (${login.warning})` : ""}
        </p>
      )}
      {error && <p className="py-1 text-xs text-danger">{error}</p>}
      <p className="py-1 text-[11px] text-subtle">{t("account.nextLaunch")}</p>
    </>
  );
}
