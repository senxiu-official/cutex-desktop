// 添加主机 → 用令牌连接 (owner-approved 2026-11-10): a host someone else shared — its owner ran
// `cutex management client-token issue --user <id>` and sent the token. The desktop opens only the SSH tunnel
// (any ~/.ssh/config alias, e.g. remote-ema) to the remote management port and presents the token; no command
// runs over SSH. Also 重新导入令牌 on such a host's page, and the owner's hint on 用户 (the command + the
// user's id). The token is input-only: a password field, cleared after every submit, never shown back.
import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_REMOTE_PORT, type HostResult, type HostView, type SshErrorView } from "../../../../shared/hosts";
import { deviceScopeOf, type HostUserAccess } from "../../../../shared/users";
import { api } from "../../bridge";
import { useI18n, type MessageKey } from "../../i18n";
import { cleanToken, importedWho, issueTokenCommand, tokenProblemKey } from "../../lib/hostTokenImport";
import { useHostsData } from "../../lib/useHostScope";
import { grantChoices, grantSummary } from "../../lib/userGrants";
import { useApp } from "../../store";
import { Check, Copy } from "lucide-react";
import { copyText } from "../../lib/menus";
import { Button, RadioList, RowGroup, SettingRow, SettingsGroup, TextInput } from "./Form";
import { scopeLabel } from "./OwnerDevices";
import { HostDetails } from "./HostDetails";

type Mode = "pair" | "token";

/** 添加主机: pair over SSH (your own host) or connect with a token (a host someone shared with you). */
export function AddHostChooser({ pair, onDone }: { pair: ReactNode; onDone(): void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("pair");
  return (
    <>
      <RowGroup title={t("host.add.mode")}>
        <SettingsGroup agents="none" source="local">
          <RadioList<Mode>
            name="add-host-mode"
            label={t("host.add.mode")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "pair", label: t("host.add.mode.pair"), hint: t("host.add.mode.pairHint") },
              { value: "token", label: t("host.add.mode.token"), hint: t("host.add.mode.tokenHint") },
            ]}
          />
        </SettingsGroup>
      </RowGroup>
      <div data-add-host-mode={mode}>{mode === "pair" ? pair : <TokenImportForm onDone={onDone} />}</div>
    </>
  );
}

/** An import error in plain words (+ ssh's own lines under 详细信息). */
export function TokenProblemText({ error }: { error: SshErrorView }) {
  const { t } = useI18n();
  return (
    <div className="mt-1 text-xs text-danger" role="alert" data-token-problem={error.code}>
      <div>{t(tokenProblemKey(error) as MessageKey)}</div>
      {error.detail && <HostDetails><pre className="max-h-24 overflow-auto whitespace-pre-wrap">{error.detail}</pre></HostDetails>}
    </div>
  );
}

function TokenImportForm({ onDone }: { onDone(): void }) {
  const { t } = useI18n();
  const notify = useApp((s) => s.notify);
  const [aliases, setAliases] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [port, setPort] = useState("");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SshErrorView | null>(null);
  const [done, setDone] = useState<{ hostId: string; name: string; access?: Extract<HostResult, { ok: true }>["access"] } | null>(null);
  useEffect(() => {
    api.sshConfigHosts().then(setAliases, () => setAliases([]));
  }, []);
  const submit = async () => {
    const secret = cleanToken(token);
    // Never kept in the form once sent, whatever the answer.
    setToken("");
    setBusy(true);
    setError(null);
    try {
      const r = await api.importSshHostToken({ token: secret, target: target.trim(), remotePort: port ? Number(port) : undefined, label: label.trim() || undefined });
      if (!r.ok) return setError(r.error);
      const name = label.trim() || target.trim();
      notify(t("host.add.done", { host: name }));
      setDone({ hostId: r.hostId, name, access: r.access });
    } catch (e) {
      setError({ code: "exited", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  if (done) return <TokenImportResult host={done.name} hostId={done.hostId} user={done.access?.user} onDone={onDone} />;
  return (
    <div data-token-import-form="">
      <SettingRow agents="none" source="local" label={t("host.add.target")} hint={t("host.token.targetHint")}>
        <input
          list="cutex-ssh-aliases-token"
          value={target}
          autoFocus
          spellCheck={false}
          aria-label={t("host.add.target")}
          placeholder="remote-ema / me@host:22"
          onChange={(e) => setTarget(e.target.value)}
          className="w-64 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-accent"
        />
        <datalist id="cutex-ssh-aliases-token">
          {aliases.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("host.add.port")} hint={t("host.token.portHint")}>
        <TextInput width="w-24" mono label={t("host.add.port")} value={port} placeholder={String(DEFAULT_REMOTE_PORT)} onChange={(v) => setPort(v.replace(/\D/g, "").slice(0, 5))} />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("host.add.label")}>
        <TextInput width="w-64" label={t("host.add.label")} value={label} placeholder={t("host.add.labelPlaceholder")} onChange={setLabel} />
      </SettingRow>
      <SettingRow agents="access" source="local" label={t("host.token.token")} hint={t("host.token.tokenHint")}>
        <TextInput width="w-64" mono type="password" label={t("host.token.token")} value={token} placeholder={t("host.token.tokenPlaceholder")} onChange={setToken} />
      </SettingRow>
      {error && <TokenProblemText error={error} />}
      <div className="flex items-center justify-end gap-2 py-2.5">
        {busy && <span className="mr-auto text-xs text-subtle">{t("host.token.connecting")}</span>}
        <SettingsGroup navigation agents="none" source="local"><Button disabled={busy} onClick={onDone}>{t("dialog.cancel")}</Button></SettingsGroup>
        <SettingsGroup agents="access" source="local"><Button primary disabled={busy || !target.trim() || !cleanToken(token)} onClick={() => void submit()}>{t("host.token.submit")}</Button></SettingsGroup>
      </div>
    </div>
  );
}

/** After an import: who you are there, how far the token reaches and which projects you see — in words. */
export function TokenImportResult({ host, hostId, user, onDone }: { host: string; hostId: string; user?: HostUserAccess; onDone(): void }) {
  const { t } = useI18n();
  const sidebar = useHostsData([hostId])[0]?.sidebar ?? null;
  const projects = grantChoices(sidebar).projects;
  const who = user ? importedWho(user) : null;
  const scope = user ? deviceScopeOf(user) : undefined;
  const lines = !user
    ? [t("host.token.result.unknown")]
    : user.isOwner
      ? [t("host.token.result.owner")]
      : user.pending
        ? [t("host.token.result.pending")]
        : [
            who ? t("host.token.result.who", { name: who }) : t("host.token.result.whoUnknown"),
            t("host.token.result.scope", { scope: scopeLabel(t, scope ?? "full", false) }),
            grantSummary(user.grant, (key, vars) => t(key as never, vars), projects),
          ];
  return (
    <div className="py-3" data-token-import-result="">
      <p className="text-sm">{t("host.token.result.title", { host })}</p>
      <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end">
        <SettingsGroup navigation agents="none" source="local"><Button primary onClick={onDone}>{t("host.token.result.done")}</Button></SettingsGroup>
      </div>
    </div>
  );
}

/** A token host's page: paste a new token (the old one revoked / expired); the host keeps its pinned identity. */
export function ReimportToken({ host, onClose }: { host: Pick<HostView, "id" | "label">; onClose(): void }) {
  const { t } = useI18n();
  const notify = useApp((s) => s.notify);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SshErrorView | null>(null);
  const submit = async () => {
    const secret = cleanToken(token);
    setToken("");
    setBusy(true);
    setError(null);
    try {
      const r = await api.importSshHostToken({ hostId: host.id, token: secret });
      if (!r.ok) return setError(r.error);
      notify(t("host.token.reimported", { host: host.label }));
      onClose();
    } catch (e) {
      setError({ code: "exited", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 pl-6" data-token-reimport="">
      <div className="flex flex-wrap items-center gap-2">
        <TextInput width="w-64" mono type="password" autoFocus label={t("host.token.token")} value={token} placeholder={t("host.token.tokenPlaceholder")} onChange={setToken} />
        <Button primary disabled={busy || !cleanToken(token)} onClick={() => void submit()}>{busy ? t("host.token.connecting") : t("host.token.reimportSubmit")}</Button>
        <Button disabled={busy} onClick={onClose}>{t("dialog.cancel")}</Button>
      </div>
      <p className="mt-1 text-xs text-subtle">{t("host.token.reimportHint")}</p>
      {error && <TokenProblemText error={error} />}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <button type="button" data-copy={text} onClick={() => (copyText(text), setDone(true))} aria-label={t("menu.copy")} title={done ? t("mask.copied") : t("menu.copy")} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-subtle hover:bg-surface-2 hover:text-foreground">
      {done ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
    </button>
  );
}

/** 用户 → one user (owner): how to give them a token — the command to run on this host, and their id. */
export function IssueTokenHint({ userId }: { userId: string }) {
  const { t } = useI18n();
  const command = issueTokenCommand(userId);
  // The command is long: a line of its own under the name, not squeezed into the control column.
  return (
    <SettingsGroup readOnly agents="none" source="host"><div className="py-3" data-issue-token-hint="">
      <div className="text-sm">{t("users.tokenIssue")}</div>
      <p className="text-xs text-subtle">{t("users.tokenIssueHint")}</p>
      <div className="mt-1.5 flex min-w-0 items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-caption/[inherit]" title={command}>{command}</code>
        <CopyButton text={command} />
      </div>
      <div className="mt-1 flex items-center gap-1 text-xs text-subtle">
        {t("users.tokenIssueId")} <code className="font-mono">{userId}</code>
        <CopyButton text={userId} />
      </div>
    </div></SettingsGroup>
  );
}
