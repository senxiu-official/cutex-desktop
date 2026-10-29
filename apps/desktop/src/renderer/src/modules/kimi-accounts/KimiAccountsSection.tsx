// Settings → Profile → Kimi 账户 (cutex kimi-accounts, r266; docs/design/049): the host's Kimi accounts — one private
// Kimi Code login each — with their sign-in state, bound Profiles and agents. Add (name + region) → the device-code login
// starts right away (LoginPanel); 登录 / 重新登录, 退出登录 (two clicks: running agents stop at their next request),
// 检查 (cutex re-reads the local state), rename, remove (refused while used). The desktop never sees a token.
import { isImeComposing } from "../../lib/ime";
import { useCallback, useEffect, useState } from "react";
import { Pencil, UserRound } from "lucide-react";
import { kimiAccountLabel, type KimiAccount, type KimiRegion } from "../../../../shared/kimiAccounts";
import type { CutexRefusal } from "../../../../shared/ipc";
import { AddButton, ArmedRemove, Button, ErrorNote, IconButton, Loading, RefreshButton, Section, Segmented, SettingRow, SettingsGroup, TextInput, type SettingsRowDecoration } from "../../components/settings/Form";
import { ComponentNotice } from "../../components/ComponentCard";
import { KIMI_RUNTIME_COMPONENT } from "../../lib/componentCard";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { formatWhen, useClock } from "../../lib/time";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { useKimiAccountList } from "../../lib/kimiAccounts";
import { services } from "../app";
import { useApp } from "../../store";
import { activeLogin, kimiAccountState, sortKimiAccounts, STATE_TONE, type KimiAccountState, type StateTone } from "./accountView";
import { LoginPanel } from "./LoginPanel";

const TONE_TAG: Record<StateTone, string> = {
  ok: "bg-ok/15 text-ok-text",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  muted: "bg-surface-2 text-subtle",
};
const TAG = "inline-flex h-4 shrink-0 items-center rounded px-1 text-caption/[inherit] whitespace-nowrap";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useRefusalText() {
  const { t } = useI18n();
  return (error: CutexRefusal) => {
    const key = `kimi-accounts.refusal.${error.code}` as MessageKey;
    if (t(key) === key) return error.message;
    const names = error.sessions?.map((s) => s.displayName).join(", ");
    return names ? t("kimi-accounts.refusal.withNames", { text: t(key), names }) : t(key);
  };
}

export function KimiAccountsSection() {
  const hostId = useTargetHostId();
  return <AccountsSection key={hostId} hostId={hostId} />;
}

function AccountsSection({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const accounts = useKimiAccountList();
  const [adding, setAdding] = useState(false);
  /** The account whose login panel is open. */
  const [login, setLogin] = useState<string | null>(null);
  const [list, setList] = useState<KimiAccount[] | null>(null);
  useEffect(() => setList(accounts.list), [accounts.list]);
  // A login running on the host (opened elsewhere, or before a reload) shows its panel.
  useEffect(() => {
    if (login === null) {
      const running = list?.find((a) => activeLogin(a));
      if (running) setLogin(running.id);
    }
  }, [list, login]);
  const put = useCallback((a: KimiAccount) => setList((l) => (l ? (l.some((x) => x.id === a.id) ? l.map((x) => (x.id === a.id ? a : x)) : [...l, a]) : [a])), []);
  const drop = useCallback((id: string) => setList((l) => (l ? l.filter((x) => x.id !== id) : l)), []);
  const sorted = list ? sortKimiAccounts(list) : null;
  return (
    <Section
      title={t("kimi-accounts.section")}
      hint={t("kimi-accounts.sectionHint")}
      actions={
        <>
          <RefreshButton onClick={() => void accounts.load()} />
          <AddButton primary disabled={adding || !list} onClick={() => setAdding(true)}>{t("kimi-accounts.add")}</AddButton>
        </>
      }
    >
      <div data-kimi-accounts="">
        {/* Logging in needs Kimi Code on this host (the kimi-runtime component). */}
        <ComponentNotice name={KIMI_RUNTIME_COMPONENT} hostId={hostId} className="mb-2" />
        {adding && <AddForm onCancel={() => setAdding(false)} onCreated={(a) => (put(a), setAdding(false), setLogin(a.id))} />}
        {!list && !accounts.loadError && <Loading rows={2} />}
        {list && list.length === 0 && !adding && <p className="py-2 text-xs text-subtle">{t("kimi-accounts.empty")}</p>}
        {sorted?.map((a) => (
          <SettingsGroup key={a.id} agents="next" source="host">{(decoration) => (
            <AccountRow decoration={decoration} account={a} loginOpen={login === a.id} onLogin={(open) => setLogin(open ? a.id : null)} onChanged={put} onRemoved={() => (drop(a.id), login === a.id && setLogin(null))} onStale={() => void accounts.load()} />
          )}</SettingsGroup>
        ))}
        {accounts.loadError && <ErrorNote>{accounts.loadError}</ErrorNote>}
      </div>
    </Section>
  );
}

function AddForm({ onCancel, onCreated }: { onCancel(): void; onCreated(a: KimiAccount): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const refusalText = useRefusalText();
  const [label, setLabel] = useState("");
  const [region, setRegion] = useState<KimiRegion>("mainland-cn");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const create = async () => {
    const clean = kimiAccountLabel(label);
    if (!clean) return setProblem(t("kimi-accounts.form.badLabel"));
    setBusy(true);
    setProblem(null);
    try {
      const r = await api.createKimiAccount({ label: clean, region });
      if (r.ok) onCreated(r.account);
      else setProblem(refusalText(r.error));
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-2 rounded-lg border border-border px-3 py-1" data-kimi-account-add="">
      <SettingRow agents="none" source="host" label={t("kimi-accounts.form.label")}>
        <TextInput autoFocus width="w-48" value={label} maxLength={64} placeholder={t("kimi-accounts.form.labelPlaceholder")} disabled={busy} onChange={(v) => (setLabel(v), setProblem(null))}
          onKeyDown={(e) => { if (!isImeComposing(e) && e.key === "Enter") void create(); }} />
      </SettingRow>
      <SettingRow agents="none" source="host" label={t("kimi-accounts.form.region")} hint={t("kimi-accounts.form.regionHint")}>
        <Segmented value={region} options={(["mainland-cn", "global"] as const).map((r) => ({ value: r, label: t(`kimi-accounts.region.${r}`) }))} onChange={setRegion} disabled={busy} />
      </SettingRow>
      <div className="flex items-center justify-end gap-2 py-2">
        {problem && <span className="min-w-0 flex-1 truncate text-xs text-danger" title={problem}>{problem}</span>}
        <Button onClick={onCancel}>{t("dialog.cancel")}</Button>
        <Button primary disabled={busy || !label.trim()} onClick={() => void create()}>{t("kimi-accounts.form.create")}</Button>
      </div>
    </div>
  );
}

function AccountRow({ decoration, account: a, loginOpen, onLogin, onChanged, onRemoved, onStale }: {
  decoration: SettingsRowDecoration;
  account: KimiAccount;
  loginOpen: boolean;
  onLogin(open: boolean): void;
  onChanged(a: KimiAccount): void;
  onRemoved(): void;
  onStale(): void;
}) {
  const api = useTargetApi();
  const { t, locale } = useI18n();
  const now = useClock();
  const refusalText = useRefusalText();
  const [busy, setBusy] = useState<null | "check" | "logout" | "rename" | "remove">(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [logoutArmed, setLogoutArmed] = useArmed(`${a.id}:${a.status?.state ?? ""}`);
  const state = kimiAccountState(a);

  const run = async (kind: "check" | "logout" | "rename" | "remove", call: () => Promise<{ ok: true } | { ok: false; error: CutexRefusal }>, after?: () => void) => {
    setBusy(kind);
    setProblem(null);
    try {
      const r = await call();
      if (r.ok) after?.();
      else {
        setProblem(refusalText(r.error));
        if (r.error.code === "kimi_account_not_found") onStale();
      }
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const check = () => run("check", async () => { const r = await api.checkKimiAccount(a.id); if (r.ok) onChanged(r.account); return r; });
  const logout = () => run("logout", async () => { const r = await api.logoutKimiAccount(a.id); if (r.ok) { onChanged(r.account); services.ui.notice(t("kimi-accounts.loggedOut", { label: a.label })); } return r; });
  const rename = () => {
    const label = kimiAccountLabel(draft);
    if (!label) return setProblem(t("kimi-accounts.form.badLabel"));
    if (label === a.label) return setRenaming(false);
    return run("rename", async () => { const r = await api.renameKimiAccount(a.id, label); if (r.ok) onChanged(r.account); return r; }, () => setRenaming(false));
  };
  const remove = () => run("remove", async () => {
    const r = await api.deleteKimiAccount(a.id);
    if (r.ok) services.ui.notice(r.removed.keptHome ? t("kimi-accounts.removed", { label: a.label, home: r.removed.keptHome }) : t("kimi-accounts.removedPlain", { label: a.label }));
    return r;
  }, onRemoved);
  const reread = async () => {
    try {
      const r = await api.checkKimiAccount(a.id);
      if (r.ok) onChanged(r.account);
    } catch {
      onStale();
    }
  };

  const expires = a.status?.expiresAt ? Date.parse(a.status.expiresAt) / 1000 : NaN;
  const checked = a.status?.checkedAt ? Date.parse(a.status.checkedAt) / 1000 : NaN;
  const detail = [
    t(`kimi-accounts.region.${a.region === "global" ? "global" : "mainland-cn"}` as MessageKey),
    ...(state === "loggedIn" && Number.isFinite(expires) ? [t("kimi-accounts.expiresAt", { time: new Date(expires * 1000).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) })] : []),
    ...(a.models.length ? [t("kimi-accounts.models", { n: a.models.length })] : []),
    ...(Number.isFinite(checked) ? [t("kimi-accounts.checkedAt", { time: formatWhen(checked, now, locale) })] : []),
  ];
  const loginLabel: MessageKey = state === "loggedIn" || state === "revoked" ? "kimi-accounts.relogin" : "kimi-accounts.login";
  return (
    <div {...decoration.attributes} className="-mx-4 border-b border-border px-4 py-2.5 last:border-b-0" data-kimi-account={a.id} data-kimi-account-state={state}>
      <div className="flex min-h-7 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"><UserRound size={14} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            {renaming ? (
              <>
                <TextInput autoFocus width="w-48" label={t("kimi-accounts.rename")} value={draft} maxLength={64} disabled={busy === "rename"} onChange={(v) => (setDraft(v), setProblem(null))}
                  onKeyDown={(e) => {
                    if (isImeComposing(e)) return;
                    if (e.key === "Enter") void rename();
                    if (e.key === "Escape") (e.preventDefault(), setRenaming(false), setProblem(null));
                  }} />
                <Button primary disabled={busy === "rename" || !draft.trim()} onClick={() => void rename()}>{t("settings.save")}</Button>
                <Button onClick={() => (setRenaming(false), setProblem(null))}>{t("dialog.cancel")}</Button>
              </>
            ) : (
              <span className="truncate" title={a.home ?? undefined}>{a.label}</span>
            )}
            {decoration.marker}
            <StateTag state={state} />
          </div>
          <div className="truncate text-xs text-subtle" title={detail.join(" · ")}>{detail.join(" · ")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button disabled={busy !== null} title={t("kimi-accounts.checkHint")} onClick={() => void check()}>{t("kimi-accounts.check")}</Button>
          {!loginOpen && <Button primary={state !== "loggedIn"} disabled={busy !== null} onClick={() => onLogin(true)}>{t(loginLabel)}</Button>}
          {state === "loggedIn" && (logoutArmed ? (
            <button className={ARMED_FORM_BUTTON} disabled={busy !== null} title={t("kimi-accounts.logoutHint")} onClick={() => (setLogoutArmed(false), void logout())}>{t("kimi-accounts.logoutAgain")}</button>
          ) : (
            <Button disabled={busy !== null} title={t("kimi-accounts.logoutHint")} onClick={() => setLogoutArmed(true)}>{t("kimi-accounts.logout")}</Button>
          ))}
          <IconButton label={t("kimi-accounts.rename")} disabled={busy !== null || renaming} onClick={() => (setDraft(a.label), setRenaming(true), setProblem(null))}>
            <Pencil size={13} />
          </IconButton>
          <ArmedRemove title={a.removable ? t("kimi-accounts.remove") : t("kimi-accounts.removeBlocked")} disabled={busy !== null || !a.removable} onRemove={() => void remove()} />
        </div>
      </div>
      <div className="mt-1 space-y-1.5 pl-[2.375rem]">
        <UsedBy account={a} />
        {loginOpen && <LoginPanel account={a} initial={activeLogin(a)} onDone={() => void reread()} onClose={() => onLogin(false)} />}
        {problem && <ErrorNote>{problem}</ErrorNote>}
      </div>
    </div>
  );
}

function StateTag({ state }: { state: KimiAccountState }) {
  const { t } = useI18n();
  return <span className={`${TAG} ${TONE_TAG[STATE_TONE[state]]}`}>{t(`kimi-accounts.state.${state}` as MessageKey)}</span>;
}

function UsedBy({ account: a }: { account: KimiAccount }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
      <span className="text-subtle">{t("kimi-accounts.profiles")}</span>
      {a.profiles.length === 0 ? (
        <>
          <span className="text-subtle">{t("kimi-accounts.noProfiles")}</span>
          <button className="rounded text-accent hover:underline" onClick={() => useApp.getState().openSettings("profiles", { create: true, kimiAccount: a.id })}>{t("kimi-accounts.newProfile")}</button>
        </>
      ) : (
        a.profiles.map((p) => (
          <button key={p.id} title={t("kimi-accounts.openProfile", { name: p.name })} onClick={() => services.ui.openSettings("profiles", { profile: p.name })}
            className="max-w-40 truncate rounded bg-surface-2 px-1.5 py-px hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
            {p.name}
          </button>
        ))
      )}
      <span className="text-subtle">·</span>
      <span className={a.sessions.active ? "" : "text-subtle"}>{a.sessions.active ? t("kimi-accounts.agents", { active: a.sessions.active, online: a.sessions.online }) : t("kimi-accounts.noAgents")}</span>
    </div>
  );
}
