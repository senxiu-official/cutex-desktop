// Settings → Profile → Claude 账户 (cutex claude-accounts; owner 2026-10-10: a section after the
// profile list, not a page of its own): the host's Claude accounts — the shared default home,
// subscription logins and API accounts — with their status, bound profiles, agents and quota.
// Add / rename / remove go through cutex; logging in and storing an API key happen in a terminal on
// the host (the guide shows the command, 完成 asks cutex for the status). The desktop never sees a
// credential (docs/research/claude-multi-account.md decision 2), and nothing here moves agents or
// profiles between accounts (decision 8). The add flow and the guides are AccountFlow.tsx.
import { useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, KeyRound, Pencil, UserRound } from "lucide-react";
import { claudeAccountLabel, type ClaudeAccount, type ClaudeAccountKind, type ClaudeAccountQuota } from "../../../../shared/claudeAccounts";
import type { CutexRefusal } from "../../../../shared/ipc";
import { GaugeChip } from "../../components/GaugeBar";
import { AddButton, ArmedRemove, Button, ErrorNote, IconButton, Loading, Notice, RefreshButton, Section, TextInput } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { formatWhen, useClock } from "../../lib/time";
import { formatTokens } from "../../lib/usage";
import { services } from "../app";
import { CLAUDE_ACCOUNTS_SECTION, sortClaudeAccounts } from "../../lib/claudeAccounts";
import { useOnSettingsReveal } from "../../lib/settingsSearchView";
import { AccountGuide, AddForm } from "./AccountFlow";
import { accountsNeedingAttention, accountState, accountSummary, checkedAtSeconds, formatCost, needsTerminal, quotaNote, STATE_TONE, type AccountState, type StateTone } from "./accountView";
import { errorText, useAccountTitle, useRefusalText } from "./hooks";
import { useClaudeAccounts } from "./useClaudeAccounts";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";

const TONE_TAG: Record<StateTone, string> = {
  ok: "bg-ok/15 text-ok-text",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  muted: "bg-surface-2 text-subtle",
};
const TAG = "inline-flex h-4 shrink-0 items-center rounded px-1 text-[10px] whitespace-nowrap";

/** The `settings.section` body (its anchor is the item id, set by `<SettingsSections>`). */
export function ClaudeAccountsSection() {
  // Keyed by host: switching hosts starts over (no late reply from the previous host lands here).
  const hostId = useTargetHostId();
  return <AccountsSection key={hostId} />;
}

// Collapsed by default (owner 2026-10-10); the choice is this viewer's convenience, kept in localStorage.
const OPEN_KEY = "cutex-desktop.claude-accounts.open";
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* private window / blocked storage: stays per session */
  }
}

function AccountsSection() {
  const { t } = useI18n();
  const data = useClaudeAccounts();
  const titleOf = useAccountTitle();
  const [open, setOpen] = useState(readOpen);
  const toggle = (next: boolean) => (setOpen(next), writeOpen(next));
  // 管理账户 in the profile editor and settings search land here: open without changing the saved choice.
  useOnSettingsReveal(CLAUDE_ACCOUNTS_SECTION, () => setOpen(true));
  /** The open add form's kind (the button that opened it). */
  const [adding, setAdding] = useState<ClaudeAccountKind | null>(null);
  // At most one guide open (login or key, by the account's kind).
  const [guide, setGuide] = useState<string | null>(null);
  const addDisabled = adding !== null || !data.list;
  const add = (kind: ClaudeAccountKind) => (setOpen(true), setAdding(kind));
  const sorted = data.list ? sortClaudeAccounts(data.list) : null;
  const attention = sorted ? accountsNeedingAttention(sorted) : 0;
  return (
    <Section
      title={t("claude-accounts.section")}
      hint={t("claude-accounts.sectionHint")}
      actions={
        <>
          <IconButton label={t(open ? "claude-accounts.collapse" : "claude-accounts.expand")} onClick={() => toggle(!open)}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </IconButton>
          <RefreshButton onClick={() => void data.load()} disabled={data.loading} />
          <AddButton disabled={addDisabled} onClick={() => add("api")}>
            {t("claude-accounts.addApi")}
          </AddButton>
          <AddButton primary disabled={addDisabled} onClick={() => add("subscription")}>
            {t("claude-accounts.addSubscription")}
          </AddButton>
        </>
      }
    >
      {!open && (
        <button type="button" aria-expanded={false} onClick={() => toggle(true)} className="flex w-full min-w-0 items-center gap-2 py-2.5 text-left text-sm hover:text-foreground">
          <ChevronRight size={14} className="shrink-0 text-subtle" />
          <span className="min-w-0 flex-1 truncate text-muted">
            {sorted ? t("claude-accounts.collapsed", { n: sorted.length, names: sorted.map(titleOf).join(" · ") }) : data.error ? data.error : "…"}
          </span>
          {attention > 0 && <span className="shrink-0 text-xs text-warn">{t("claude-accounts.collapsedAttention", { n: attention })}</span>}
        </button>
      )}
      {open && <AccountsBody data={data} adding={adding} setAdding={setAdding} guide={guide} setGuide={setGuide} sorted={sorted} />}
    </Section>
  );
}

function AccountsBody({ data, adding, setAdding, guide, setGuide, sorted }: {
  data: ReturnType<typeof useClaudeAccounts>;
  adding: ClaudeAccountKind | null;
  setAdding(kind: ClaudeAccountKind | null): void;
  guide: string | null;
  setGuide(id: string | null): void;
  sorted: ClaudeAccount[] | null;
}) {
  const { t } = useI18n();
  return (
    <>
      {adding && (
        <AddForm
          key={adding}
          kind={adding}
          onCancel={() => setAdding(null)}
          onCreated={(account) => {
            data.put(account);
            setAdding(null);
            setGuide(account.id);
          }}
        />
      )}
      {!data.list && !data.error && !data.unsupported && <Loading rows={3} />}
      {data.unsupported && <Notice>{t("claude-accounts.unsupported")}</Notice>}
      {sorted?.map((account) => (
        <AccountRow
          key={account.id}
          account={account}
          quota={data.quotas[account.id]}
          guideOpen={guide === account.id}
          onGuide={(open) => setGuide(open ? account.id : null)}
          onChanged={(next) => {
            data.put(next);
            void data.loadQuota(next);
          }}
          onRemoved={() => {
            data.drop(account.id);
            if (guide === account.id) setGuide(null);
          }}
          onStale={() => void data.load()}
        />
      ))}
      {data.error && <ErrorNote>{data.error}</ErrorNote>}
    </>
  );
}

interface RowProps {
  account: ClaudeAccount;
  quota: ClaudeAccountQuota | null | undefined;
  guideOpen: boolean;
  onGuide(open: boolean): void;
  onChanged(account: ClaudeAccount): void;
  onRemoved(): void;
  /** The account vanished or the list is out of date: reload it. */
  onStale(): void;
}

function AccountRow({ account: a, quota, guideOpen, onGuide, onChanged, onRemoved, onStale }: RowProps) {
  const api = useTargetApi();
  const { t, locale } = useI18n();
  const now = useClock();
  const refusalText = useRefusalText();
  const titleOf = useAccountTitle();
  const [busy, setBusy] = useState<null | "check" | "rename" | "remove">(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const state = accountState(a);
  const api_ = a.kind === "api";
  const summary = accountSummary(a);
  const checked = checkedAtSeconds(a);
  const title = titleOf(a);

  const refused = (error: CutexRefusal) => {
    setProblem(refusalText(error));
    if (error.code === "claude_account_not_found") onStale();
  };
  const check = async () => {
    setBusy("check");
    setProblem(null);
    try {
      const r = await api.checkClaudeAccount(a.id);
      if (r.ok) onChanged(r.account);
      else refused(r.error);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(null);
    }
  };
  const rename = async () => {
    const label = claudeAccountLabel(draft);
    if (!label) return setProblem(t("claude-accounts.form.badLabel"));
    if (label === a.label) return setRenaming(false);
    setBusy("rename");
    setProblem(null);
    try {
      const r = await api.renameClaudeAccount(a.id, label);
      if (r.ok) {
        onChanged(r.account);
        setRenaming(false);
      } else refused(r.error);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("remove");
    setProblem(null);
    try {
      const r = await api.deleteClaudeAccount(a.id);
      if (r.ok) {
        services.ui.notice(r.removed.keptHome ? t("claude-accounts.removed", { label: title, home: r.removed.keptHome }) : t("claude-accounts.removedPlain", { label: title }));
        onRemoved();
      } else refused(r.error);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const Icon = api_ ? KeyRound : UserRound;
  const terminalLabel: MessageKey = api_ ? (state === "keyReady" ? "claude-accounts.replaceKey" : "claude-accounts.setKey") : state === "loggedIn" ? "claude-accounts.relogin" : "claude-accounts.login";
  const detail = [...summary, ...(!summary.length && a.isDefault ? [t("claude-accounts.defaultHint")] : []), ...(checked && !api_ ? [t("claude-accounts.checkedAt", { time: formatWhen(checked, now, locale) })] : [])];
  return (
    <div className="-mx-4 border-b border-border px-4 py-2.5 last:border-b-0">
      <div className="flex min-h-7 items-center gap-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${a.isDefault ? "bg-accent/12 text-accent" : "bg-surface-2 text-muted"}`}>
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            {renaming ? (
              <>
                <TextInput
                  autoFocus
                  width="w-48"
                  label={t("claude-accounts.rename")}
                  value={draft}
                  maxLength={64}
                  disabled={busy === "rename"}
                  onChange={(v) => (setDraft(v), setProblem(null))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void rename();
                    if (e.key === "Escape") (e.preventDefault(), setRenaming(false), setProblem(null));
                  }}
                />
                <Button primary disabled={busy === "rename" || !draft.trim()} onClick={() => void rename()}>
                  {t("settings.save")}
                </Button>
                <Button onClick={() => (setRenaming(false), setProblem(null))}>{t("dialog.cancel")}</Button>
              </>
            ) : (
              <span className="truncate" title={a.home ?? undefined}>
                {title}
              </span>
            )}
            <span className={`${TAG} bg-surface-2 text-muted`}>{t(api_ ? "claude-accounts.kind.api" : "claude-accounts.kind.subscription")}</span>
            <StateTag state={state} />
          </div>
          {detail.length > 0 && (
            <div className="truncate text-xs text-subtle" title={detail.join(" · ")}>
              {detail.join(" · ")}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button disabled={busy !== null} title={t(api_ ? "claude-accounts.checkKeyHint" : "claude-accounts.checkHint")} onClick={() => void check()}>
            {busy === "check" ? <span className="animate-pulse">{t("claude-accounts.check")}</span> : t("claude-accounts.check")}
          </Button>
          <Button primary={needsTerminal(state) && !guideOpen} onClick={() => onGuide(!guideOpen)}>
            {t(terminalLabel)}
          </Button>
          {!a.isDefault && (
            <>
              <IconButton label={t("claude-accounts.rename")} disabled={busy !== null || renaming} onClick={() => (setDraft(a.label ?? ""), setRenaming(true), setProblem(null))}>
                <Pencil size={13} />
              </IconButton>
              <ArmedRemove title={a.removable ? t("claude-accounts.remove") : t("claude-accounts.removeBlocked")} disabled={busy !== null || !a.removable} onRemove={() => void remove()} />
            </>
          )}
        </div>
      </div>
      <div className="mt-1 space-y-1.5 pl-[2.375rem]">
        {state === "error" && a.status?.error && (
          <p className="truncate text-xs text-danger" title={a.status.error}>
            {a.status.error}
          </p>
        )}
        <UsedBy account={a} />
        <QuotaLine quota={quota} />
        {guideOpen && <AccountGuide account={a} onChecked={onChanged} onClose={() => onGuide(false)} />}
        {problem && <ErrorNote>{problem}</ErrorNote>}
      </div>
    </div>
  );
}

function StateTag({ state }: { state: AccountState }) {
  const { t } = useI18n();
  return <span className={`${TAG} ${TONE_TAG[STATE_TONE[state]]}`}>{t(`claude-accounts.state.${state}` as MessageKey)}</span>;
}

/** Bound profiles (open their editor) and how many agents run on the account. */
function UsedBy({ account: a }: { account: ClaudeAccount }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
      <span className="text-subtle">{t("claude-accounts.profiles")}</span>
      {a.profiles.length === 0 ? (
        <span className="text-subtle">{t("claude-accounts.noProfiles")}</span>
      ) : (
        a.profiles.map((p) => (
          <button
            key={p.id}
            title={t("claude-accounts.openProfile", { name: p.name })}
            onClick={() => services.ui.openSettings("profiles", { profile: p.name })}
            className="max-w-40 truncate rounded bg-surface-2 px-1.5 py-px hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          >
            {p.name}
          </button>
        ))
      )}
      <span className="text-subtle">·</span>
      <span className={a.sessions.active ? "" : "text-subtle"}>{a.sessions.active ? t("claude-accounts.agents", { active: a.sessions.active, online: a.sessions.online }) : t("claude-accounts.noAgents")}</span>
    </div>
  );
}

/** 5h / 7d windows of a subscription account, or the ledger totals of an API account. */
function QuotaLine({ quota }: { quota: ClaudeAccountQuota | null | undefined }) {
  const { t } = useI18n();
  if (!quota) return null;
  if (quota.kind === "apiUsage") {
    const u = quota.apiUsage;
    if (!u) return null;
    const windows = [
      ["claude-accounts.usage.today", u.today],
      ["claude-accounts.usage.week", u.last7Days],
      ["claude-accounts.usage.month", u.last30Days],
    ] as const;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
        <span className="text-subtle">{t("claude-accounts.usage")}</span>
        {windows.map(([key, w]) => (
          <span key={key} className="text-muted" title={t("claude-accounts.usage.turns", { n: w.turns })}>
            {t(key)} <span className="text-foreground">{w.estimatedCost !== null ? formatCost(w.estimatedCost, u.currency) : w.total > 0 ? t("claude-accounts.usage.unpriced") : formatCost(0, u.currency)}</span>
            {w.total > 0 && <span className="text-subtle"> · {formatTokens(w.total)}</span>}
          </span>
        ))}
      </div>
    );
  }
  const note = quotaNote(quota);
  const noteText = note ? (note.error !== undefined ? t(note.key, { error: note.error }) : t(note.key)) : "";
  const noteTone = note?.tone === "warn" ? "text-warn" : "text-subtle";
  if (!quota.gauges.length) {
    return (
      <p className={`truncate text-xs ${noteTone}`} title={noteText}>
        {noteText}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1.5">
      {quota.gauges.map((g) => (
        <GaugeChip key={g.id} gauge={g} />
      ))}
      {note && (
        <span className={`self-center truncate text-xs ${noteTone}`} title={noteText}>
          {noteText}
        </span>
      )}
    </div>
  );
}
