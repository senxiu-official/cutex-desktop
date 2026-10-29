import { useEffect } from "react";
import { Download, FileText, FolderOpen, RefreshCw } from "lucide-react";
import { useI18n } from "../../i18n";
import { useApp } from "../../store";
import { Button, btnFace, btnShape } from "../../components/Button";
import { ArmedButton } from "../../components/ArmedButton";
import { formatSize } from "../../lib/docPreview";
import { openSide } from "../../lib/sideOpen";
import type { RemoteCopy } from "../../../../shared/remoteCopies";
import { canOpenCopy } from "../../../../shared/remoteCopyRequests";
import { canDownload, dismissCopy, refreshCopies, requestCopy, runCopyAction, startPrepared, useCopies } from "../../lib/remoteCopies";

export function CopyPage() {
  const { t } = useI18n();
  const { state, pending, busy, starting, error } = useCopies();
  useEffect(() => {
    void refreshCopies();
    const timer = window.setInterval(() => void refreshCopies(), 700);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="flex h-full min-h-0 flex-col" data-remote-copies>
    <div className="flex items-start gap-2 border-b border-border/60 p-3">
      <p className="min-w-0 flex-1 text-xs text-muted">{t("remote-copies.hint")}</p>
      <Button size="sm" variant="ghost" aria-label={t("remote-copies.refresh")} onClick={() => void refreshCopies()}><RefreshCw size={14} data-icon="inline-start" /></Button>
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {busy && <div className="flex items-center justify-between gap-2 py-2"><p className="text-xs text-muted" role="status">{t("remote-copies.preparing")}</p><Button size="sm" variant="ghost" onClick={dismissCopy}>{t("remote-copies.cancel")}</Button></div>}
      {error && <p role="alert" className="mb-3 break-words text-xs text-danger">{t("remote-copies.error", { error })}</p>}
      {pending && <section aria-label={t("remote-copies.confirm")} className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3" data-copy-confirm>
        <h3 className="text-sm font-medium">{t("remote-copies.confirm")}</h3>
        <p className="break-all text-xs">{pending.meta.name} · {formatSize(pending.meta.size)}</p>
        <p className="break-all text-xs text-muted">{pending.source.hostLabel} · {pending.source.path}</p>
        <p className="text-xs text-muted">{t("remote-copies.confirmHint")}</p>
        <div className="flex gap-2"><Button size="sm" variant="primary" disabled={starting} onClick={() => void startPrepared()}><Download size={14} data-icon="inline-start" />{t("remote-copies.start")}</Button><Button size="sm" variant="ghost" onClick={dismissCopy}>{t("remote-copies.cancel")}</Button></div>
      </section>}
      {state?.copies.length === 0 && !pending && !busy && <div className="flex flex-col items-center gap-2 py-12 text-center text-muted"><Download size={28} /><p className="text-sm">{t("remote-copies.empty")}</p><p className="text-xs">{t("remote-copies.emptyHint")}</p></div>}
      <div className="flex flex-col gap-3">{state?.copies.map(copy => <CopyRow key={copy.id} copy={copy} />)}</div>
    </div>
  </div>;
}

function CopyRow({ copy }: { copy: RemoteCopy }) {
  const { t } = useI18n();
  const host = useApp(s => s.hosts?.hosts.find(h => h.id === copy.source.hostId));
  const connected = host?.conn?.daemon;
  const remote = canDownload(copy.source.hostId) && connected?.kind === "connected" && connected.hostId === copy.source.hostIdentity;
  const local = copy.status === "complete" || !!copy.downloadedAt && copy.status !== "expired" && copy.status !== "missing";
  const active = copy.status === "downloading";
  const date = (value: string) => new Date(value).toLocaleString();
  return <article className="flex flex-col gap-2 rounded-lg border border-border/70 p-3" data-copy-row={copy.id}>
    <div className="flex items-start gap-2"><FileText size={17} className="mt-0.5 shrink-0 text-muted" /><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-medium" title={copy.name}>{copy.name}</h3><p className="mt-0.5 break-all text-xs text-muted">{host?.label ?? copy.source.hostLabel} · {copy.source.path}{copy.source.artifact ? ` @${copy.source.artifact.version}` : ""}</p></div><span className="shrink-0 text-xs text-muted">{formatSize(copy.size)}</span></div>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted"><span>{t(`remote-copies.${copy.status}`)}</span>{copy.kept ? <span>{t("remote-copies.kept")}</span> : copy.expiresAt ? <span>{t("remote-copies.expires", { at: date(copy.expiresAt) })}</span> : null}</div>
    {copy.downloadedAt && <p className="text-xs text-subtle">{t("remote-copies.downloaded", { at: date(copy.downloadedAt) })}</p>}
    {active && <div className="flex items-center gap-2"><progress className="h-1.5 min-w-0 flex-1 accent-accent" value={copy.received} max={Math.max(copy.size, 1)} aria-label={t("remote-copies.downloading")} /><span className="text-xs tabular-nums text-muted">{formatSize(copy.received)} / {formatSize(copy.size)}</span></div>}
    {copy.error && <p className="break-words text-xs text-danger" role="status">{copy.error}</p>}
    <div className="flex flex-wrap gap-1">
      <Button size="sm" disabled={!local || !canOpenCopy(copy.name)} onClick={() => void runCopyAction({ kind: "open", id: copy.id })}>{t("remote-copies.open")}</Button>
      <Button size="sm" variant="ghost" disabled={!local} onClick={() => void runCopyAction({ kind: "reveal", id: copy.id })}><FolderOpen size={14} data-icon="inline-start" />{t("remote-copies.reveal")}</Button>
      <Button size="sm" variant="ghost" disabled={!remote} title={!remote ? t("remote-copies.offline") : undefined} onClick={() => {
        if (copy.source.artifact) openSide("artifacts.view", { ref: `${copy.source.artifact.id}@${copy.source.artifact.version}` }, { binding: { kind: "host", hostId: copy.source.hostId } });
        else openSide("workspace.preview", { path: copy.source.path, host: !copy.source.scope, ...(copy.source.scope ? { scope: { ...copy.source.scope } } : {}) }, { binding: { kind: "host", hostId: copy.source.hostId } });
      }}>{t("remote-copies.original")}</Button>
      {active ? <Button size="sm" variant="ghost" onClick={() => void runCopyAction({ kind: "cancel", id: copy.id })}>{t("remote-copies.cancel")}</Button> : <Button size="sm" variant="ghost" disabled={!remote} title={!remote ? t("remote-copies.offline") : undefined} onClick={() => void requestCopy(copy.source.hostId, copy.source.path, copy.source.scope, copy.source.artifact, copy.id, copy.source)}>{t("remote-copies.refresh")}</Button>}
      <Button size="sm" variant="ghost" disabled={!local} onClick={() => void runCopyAction({ kind: "keep", id: copy.id, value: !copy.kept })}>{t(copy.kept ? "remote-copies.unkeep" : "remote-copies.keep")}</Button>
      <ArmedButton shape={btnShape({ size: "sm" })} idle={btnFace({ variant: "ghost", danger: true })} hint={t("remote-copies.removeConfirm")} disabled={active} onConfirm={() => void runCopyAction({ kind: "remove", id: copy.id })}>{t("remote-copies.remove")}</ArmedButton>
    </div>
  </article>;
}
