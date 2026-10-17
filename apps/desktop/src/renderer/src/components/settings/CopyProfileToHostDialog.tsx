// 复制到其他主机 (cutex `profile-transfer`; docs/research/profile-migration-design-20261016.md §7): one
// page — target host (connected hosts whose cutex imports), new name (the source name, else a free
// one on the target), the credential row of this profile's kind (API key: 「同时复制 API key」, on by
// default; ChatGPT: log in again on the target; Claude: the target's account is used), 复制, then the
// result's warnings and 「在 <host> 上打开」. main moves the bundle (HostApi copyProfileToHost): this
// dialog sends names and gets a secret-free result.
import { useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import type { ProfileItem } from "../../../../shared/ipc";
import { transferName, type ProfileTransferResult } from "../../../../shared/profileTransfer";
import { api } from "../../bridge";
import { useI18n } from "../../i18n";
import { transferWarningText } from "../../lib/profileTransfer";
import { useTransferTargets } from "../../lib/useTransferTargets";
import { setSettingsHost } from "../../lib/settingsHost";
import { daemonApiOf } from "../../lib/targetHost";
import { useHostScope } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { Checkbox } from "./Form";

export function CopyProfileToHostDialog({ item, sourceHostId, onClose }: { item: ProfileItem; sourceHostId: string; onClose(): void }) {
  const { t } = useI18n();
  const scope = useHostScope();
  const focus = useApp((s) => s.hosts?.active ?? "");
  const openSettings = useApp((s) => s.openSettings);
  const targets = useTransferTargets(sourceHostId);
  const label = (id: string) => scope.host(id)?.label ?? id;
  const sourceLabel = label(sourceHostId);
  const [target, setTarget] = useState(targets[0] ?? "");
  const [name, setName] = useState(item.name);
  const [edited, setEdited] = useState(false);
  const [taken, setTaken] = useState<string[]>([]);
  // As cutex decides (a logged-out ChatGPT profile is still one: `source: official`).
  const kind =
    item.cliKind === "claude" ? "claude"
    : item.privateChatgptAuthFile || item.authKind === "chatgpt" || (item.authKind === "none" && item.source === "official") ? "chatgpt"
    : item.authKind === "apiKey" || item.source === "api-key" ? "apiKey"
    : "none";
  const hasKey = kind === "apiKey" && item.authPresent;
  const [includeKey, setIncludeKey] = useState(hasKey);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProfileTransferResult | null>(null);

  // The target's profile names: the suggested name avoids them (the copy never overwrites).
  useEffect(() => {
    if (!target) return;
    let live = true;
    daemonApiOf(target, focus)
      .listProfiles()
      .then(
        (list) => {
          if (!live) return;
          const names = list?.profiles.map((p) => p.name) ?? [];
          setTaken(names);
          if (!edited) setName(transferName(item.name, sourceLabel, names));
        },
        () => live && setTaken([]),
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read per target only
  }, [target]);

  const trimmed = name.trim();
  const clash = taken.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const canCopy = !!target && !!trimmed && trimmed.length <= 64 && !/[/\\]/.test(trimmed) && !clash && !busy;

  const copy = async () => {
    if (!canCopy) return;
    setBusy(true);
    try {
      setResult(await api.copyProfileToHost({ sourceHostId, profile: item.id || item.name, targetHostId: target, name: trimmed, includeApiKey: hasKey && includeKey }));
    } catch (e) {
      setResult({ ok: false, stage: "request", error: { code: "error", message: e instanceof Error ? e.message : String(e) } });
    } finally {
      setBusy(false);
    }
  };
  const openCopy = (profile: string) => {
    setSettingsHost(target);
    openSettings("profiles", { profile });
    onClose();
  };
  const button = "rounded-md px-3 py-1 text-sm disabled:opacity-50";
  const field = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent";
  const credentialText =
    kind === "chatgpt" ? t("agent-config.profile.transfer.chatgpt")
    : kind === "claude" ? t("agent-config.profile.transfer.claude")
    : kind === "apiKey" ? (hasKey ? null : t("agent-config.profile.transfer.apiKeyMissing"))
    : t("agent-config.profile.transfer.none");

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 pt-[14vh]" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-transfer-title"
        data-testid="profile-transfer-dialog"
        className="w-[30rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-4 shadow-2xl"
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <div id="profile-transfer-title" className="mb-1 flex items-center gap-2 text-sm font-medium">
          <ArrowRightLeft size={16} className="shrink-0 text-muted" />
          <span className="min-w-0 break-words">{t("agent-config.profile.transfer.title", { name: item.name })}</span>
        </div>
        <p className="mb-4 text-xs text-subtle">{t("agent-config.profile.transfer.intro", { host: sourceLabel })}</p>

        {result?.ok ? (
          <div role="status" className="flex flex-col gap-2 text-sm">
            <p>{t("agent-config.profile.transfer.done", { host: label(target), name: result.profile.name })}</p>
            {result.credentialsCopied && <p className="text-xs text-subtle">{t("agent-config.profile.transfer.keyCopied")}</p>}
            {result.warnings.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-warn-text">
                {result.warnings.map((w, i) => (
                  <li key={i}>{transferWarningText(w, t)}</li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button autoFocus onClick={onClose} className={`${button} text-muted hover:bg-surface-2`}>
                {t("agent-config.profile.transfer.close")}
              </button>
              <button onClick={() => openCopy(result.profile.name)} className={`${button} bg-accent text-white`}>
                {t("agent-config.profile.transfer.open", { host: label(target) })}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void copy();
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t("agent-config.profile.transfer.target")}
              <select value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)} className={field}>
                {targets.map((id) => (
                  <option key={id} value={id}>
                    {label(id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t("agent-config.profile.transfer.name")}
              <input
                autoFocus
                value={name}
                maxLength={64}
                disabled={busy}
                spellCheck={false}
                onChange={(e) => (setName(e.target.value), setEdited(true))}
                className={field}
              />
              {clash && <span className="text-danger">{t("agent-config.profile.transfer.nameTaken")}</span>}
            </label>
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-muted">{t("agent-config.profile.transfer.credentials")}</span>
              {hasKey && (
                <div className="flex items-start gap-2">
                  <span className="mt-0.5">
                    <Checkbox checked={includeKey} disabled={busy} onChange={setIncludeKey} label={t("agent-config.profile.transfer.apiKey")} />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm">{t("agent-config.profile.transfer.apiKey")}</span>
                    <span className="text-subtle">{t("agent-config.profile.transfer.apiKeyHint", { host: sourceLabel })}</span>
                  </span>
                </div>
              )}
              {credentialText && <span className="text-subtle">{credentialText}</span>}
            </div>
            {result && !result.ok && (
              <p role="alert" className="text-xs text-danger">
                {result.error.code === "credentials_loopback_only"
                  ? t("agent-config.profile.transfer.loopbackOnly", { host: sourceLabel })
                  : t("agent-config.profile.transfer.failed", { message: result.error.message || result.error.code })}
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={onClose} className={`${button} text-muted hover:bg-surface-2`}>
                {t("agent-config.profile.transfer.cancel")}
              </button>
              <button type="submit" disabled={!canCopy} className={`${button} bg-accent text-white`}>
                {busy ? t("agent-config.profile.transfer.copying") : t("agent-config.profile.transfer.copy")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
