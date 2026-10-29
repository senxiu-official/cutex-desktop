import { memo, useMemo, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StorageCleanupAction, StorageCleanupPreview, StorageCleanupRun } from "../../../../shared/storageCleanup";
import { Button, ErrorNote, Section, SettingsGroup } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { useTrackOverlay } from "../../lib/openOverlays";
import { useNow } from "../../lib/time";
import { useApp } from "../../store";
import { highRisk, selectedBytes, type CleanupController } from "./cleanupController";
import { cleanupReason } from "./cleanupReason";
import { useCleanup } from "./cleanupHooks";
import { formatBytes } from "./model";
import { isHTMLElement } from "../../lib/ownerWindow";
import { useOwnerDocument } from "../../lib/ownerContext";
const ACTIONS: readonly StorageCleanupAction[] = ["orphan-homes", "retired-homes", "old-backups", "old-logs", "vacuum"];

function DeleteConfirmation({ preview, count, bytes, host, busy, expired, close, submit }: { preview: StorageCleanupPreview; count: number; bytes: string; host: string; busy: boolean; expired: boolean; close(): void; submit(text: string): void }) {
  const doc = useOwnerDocument();
  const { t } = useI18n(); const [text, setText] = useState(""); const dialog = useRef<HTMLDialogElement>(null); const input = useRef<HTMLInputElement>(null); const title = useId();
  useTrackOverlay(true);
  useEffect(() => { const previous = doc.activeElement; const node = dialog.current!; node.showModal(); input.current?.focus(); return () => { node.close(); if (isHTMLElement(previous) && previous.isConnected) previous.focus(); }; }, []);
  return createPortal(<dialog ref={dialog} aria-labelledby={title} data-cleanup-confirm="" onCancel={(event) => { event.preventDefault(); if (!busy) close(); }} className="fixed inset-0 m-auto w-[480px] max-w-[95vw] rounded-dialog border border-border bg-surface p-5 text-ui text-foreground shadow-e3 backdrop:bg-foreground/30">
    <h2 id={title} className="text-title">{t("storage.cleanup.delete", { n: count, bytes })}</h2>
    <p className="mt-2 text-meta text-muted">{t("storage.cleanup.target", { host })}</p>
    <p className="mt-2 text-ui text-muted">{t(`storage.cleanup.${preview.action}` as MessageKey)}</p>
    {preview.action === "retired-homes" && <p className="mt-3 text-ui">{t("storage.cleanup.retiredHint")}</p>}
    <label className="mt-4 block text-ui">{t("storage.cleanup.type", { text: "删除" })}<input ref={input} value={text} onChange={(event) => setText(event.target.value)} disabled={busy} autoComplete="off" className="mt-2 block w-full rounded-ctl border border-border bg-background px-3 py-2 outline-none focus:border-accent" /></label>
    {expired && <p role="status" className="mt-2 text-meta text-warn-text">{t("storage.cleanup.expired")}</p>}
    <div className="mt-4 flex justify-end gap-2"><Button disabled={busy} onClick={close}>{t("storage.cleanup.cancel")}</Button><button type="button" disabled={text !== "删除" || !count || busy || expired} onClick={() => submit(text)} className="rounded-ctl bg-danger-solid px-3 py-1.5 text-ui text-on-accent disabled:opacity-40">{t(busy ? "storage.cleanup.busy" : "storage.cleanup.delete", { n: count, bytes })}</button></div>
  </dialog>, doc.body);
}
function RunResult({ run }: { run: StorageCleanupRun }) {
  const { t, locale } = useI18n();
  const label = (key: string) => t(`storage.cleanup.${key}` as MessageKey);
  return <div data-cleanup-result={run.runId} className="space-y-2">
    <p className="text-ui font-medium">{label(run.state)} · {t("storage.cleanup.freed", { bytes: formatBytes(run.freedBytes, locale) })}</p>
    {run.error && <ErrorNote>{run.error}</ErrorNote>}
    <ul>{run.items.map((item) => { const changed = item.code === "changed"; const outcome = changed ? "skipped" : item.outcome ?? item.state; return <li key={item.id} data-cleanup-outcome={outcome} className="border-t border-border py-2 text-meta"><div className="flex flex-wrap justify-between gap-2"><span className="min-w-0 break-all font-mono">{item.path}</span><span>{label(outcome)}</span></div><p className="mt-1 text-muted" title={item.reason ?? undefined}>{cleanupReason(item.code, item.reason, t)}</p>{item.freedBytes > 0 && <p className="mt-1 text-muted">{t("storage.cleanup.freed", { bytes: formatBytes(item.freedBytes, locale) })}</p>}{item.retainedPath && <p className="mt-1 break-all text-warn-text">{t("storage.cleanup.retained", { path: item.retainedPath })}</p>}</li>; })}</ul>
  </div>;
}
/** Clock ticks and history events do not rebuild a potentially large preview list. */
const PreviewItems = memo(function PreviewItems({ preview, selected, locked, controller }: { preview: StorageCleanupPreview; selected: readonly string[]; locked: boolean; controller: CleanupController }) {
  const { t, locale } = useI18n();
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const label = (key: string) => t(`storage.cleanup.${key}` as MessageKey);
  return <ul className="mt-2 max-h-80 overflow-y-auto">{preview.items.map((item) => <li key={item.id} className="border-t border-border py-2 text-meta"><label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={selectedSet.has(item.id)} disabled={!item.eligible || locked} onChange={(event) => controller.select(item.id, event.target.checked)} /><span className="min-w-0 flex-1"><span className="block break-all font-mono">{item.path}</span><span className="mt-1 flex flex-wrap gap-x-3 text-muted"><span>{formatBytes(item.bytes, locale)}</span><span>{t("storage.cleanup.files", { n: item.files })}</span><span>{label(item.eligible ? "eligible" : "blocked")}</span></span><span className="mt-1 block text-muted" title={item.reason ?? undefined}>{cleanupReason(item.code, item.reason, t)}</span>{item.mtime && <span className="mt-1 block text-subtle">{t("storage.cleanup.mtime", { time: new Date(item.mtime).toLocaleString(locale) })}</span>}</span></label></li>)}</ul>;
});

export function CleanupSection() {
  const cleanup = useCleanup(); const { t, locale } = useI18n();
  const [action, setAction] = useState<StorageCleanupAction>("orphan-homes"); const [days, setDays] = useState(30); const [confirming, setConfirming] = useState(false);
  const { preview, selected, controller } = cleanup;
  const now = useNow(!!preview);
  const signature = `${preview?.previewId ?? ""}:${selected.join(",")}:${cleanup.allowed}`;
  const [armed, setArmed] = useArmed(signature);
  const host = useApp((s) => s.hosts?.hosts.find((h) => h.id === cleanup.hostId)?.label ?? cleanup.hostId);
  useEffect(() => { setConfirming(false); setArmed(false); }, [signature, setArmed]);
  const running = cleanup.run?.state === "running" || cleanup.history.some((run) => run.state === "running");
  const locked = cleanup.executing || !!cleanup.pending || running;
  const expired = !!preview && Date.parse(preview.expiresAt) <= now;
  const bytes = preview ? formatBytes(selectedBytes(preview, selected), locale) : "—";
  const label = (key: string) => t(`storage.cleanup.${key}` as MessageKey);
  const error = (value: string) => value.startsWith("storage.cleanup.") ? t(value as MessageKey) : value;
  if (!cleanup.supported) return null;
  const medium = () => { if (!cleanup.allowed || expired) return; if (!armed) setArmed(true); else { setArmed(false); void controller.execute(); } };
  return <div className="space-y-4" data-storage-cleanup="">
    <Section title={label("title")} hint={label("hint")}>
      <SettingsGroup agents="none" source="host">
      <p className="mb-3 text-meta text-muted">{t("storage.cleanup.target", { host })}</p>
      {!cleanup.allowed ? <p className="text-ui text-muted">{label("desktopOnly")}</p> : cleanup.pending ? null : <>
        <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-meta">{label("action")}<select aria-label={label("action")} value={action} disabled={locked || cleanup.loading} onChange={(event) => { setAction(event.target.value as StorageCleanupAction); controller.clearPreview(); }} className="mt-1 block w-full rounded-ctl border border-border bg-background px-2 py-1.5 text-ui">{ACTIONS.map((id) => <option key={id} value={id}>{label(id)}</option>)}</select></label>
          {action === "old-logs" && <label className="text-meta">{label("days")}<select aria-label={label("days")} value={days} disabled={locked || cleanup.loading} onChange={(event) => { setDays(Number(event.target.value)); controller.clearPreview(); }} className="mt-1 block rounded-ctl border border-border bg-background px-2 py-1.5 text-ui">{[7, 30, 90].map((n) => <option key={n} value={n}>{t("storage.cleanup.dayOption", { n })}</option>)}</select></label>}
          <Button disabled={locked || cleanup.loading} onClick={() => { void controller.preview({ action, ...(action === "old-logs" ? { olderThanDays: days } : {}) }); }}>{label(cleanup.loading ? "previewing" : "preview")}</Button></div>
        {["retired-homes", "vacuum", "old-logs"].includes(action) && <p className="mt-3 text-ui text-muted">{label(action === "retired-homes" ? "retiredHint" : action === "vacuum" ? "vacuumHint" : "logsHint")}</p>}
      </>}
      {cleanup.executing && <p role="status" className="mt-3 text-ui text-muted">{label("busy")}</p>}
      {cleanup.error && <div className="mt-3"><ErrorNote>{error(cleanup.error)}</ErrorNote></div>}
      {cleanup.pending && !cleanup.executing && <div className="mt-3 space-y-2"><p className="text-ui text-warn-text">{label("uncertain")}</p><Button disabled={!cleanup.allowed || cleanup.executing} onClick={() => { void controller.retry(); }}>{label(cleanup.executing ? "busy" : "retry")}</Button></div>}
      {preview && cleanup.allowed && <div className="mt-4 border-t border-border pt-3" data-cleanup-preview={preview.previewId}>
        <h3 className="text-title">{label("previewTitle")}</h3>
        {preview.complete === false && <p role="status" className="mt-2 text-meta text-muted" data-cleanup-partial="">{label("partialNotice")}</p>}
        <p className="mt-2 text-ui font-medium">{t(preview.action === "vacuum" ? "storage.cleanup.vacuumTotal" : "storage.cleanup.total", { n: selected.length, bytes })}</p>
        {preview.action === "vacuum" && <p className="mt-1 text-meta text-muted">{t(preview.complete === false ? "storage.cleanup.partialVacuumEstimate" : "storage.cleanup.vacuumEstimate", { bytes: formatBytes(preview.freeableBytes, locale) })}</p>}
        <p className="mt-1 text-meta text-subtle">{t("storage.cleanup.expires", { time: new Date(preview.expiresAt).toLocaleTimeString(locale) })}</p>
        {!preview.items.length && <p className="mt-3 text-ui text-muted">{label(preview.complete === false ? "partialEmpty" : "empty")}</p>}
        <PreviewItems preview={preview} selected={selected} locked={locked} controller={controller} />
        {expired && <p role="status" className="mt-2 text-ui text-warn-text">{label("expired")}</p>}
        <div className="mt-3">{highRisk(preview) ? <Button disabled={!selected.length || locked || expired} onClick={() => setConfirming(true)}>{label("confirm")}</Button> : <button type="button" disabled={!selected.length || locked || expired} onClick={medium} className={armed ? ARMED_FORM_BUTTON : "rounded-ctl border border-border bg-surface-2 px-3 py-1.5 text-ui disabled:opacity-40"}>{t(preview.action === "vacuum" ? armed ? "storage.cleanup.confirmVacuum" : "storage.cleanup.startVacuum" : armed ? "storage.cleanup.confirmMedium" : "storage.cleanup.delete", { n: selected.length, bytes })}</button>}</div>
      </div>}
      </SettingsGroup>
    </Section>
    {cleanup.run && <Section title={label("result")}><RunResult run={cleanup.run} /></Section>}
    <Section title={label("history")} actions={<Button disabled={!cleanup.connected || cleanup.historyLoading} onClick={() => { void controller.loadHistory(); }}>{label("refreshHistory")}</Button>}>
      {cleanup.historyError && <ErrorNote>{cleanup.historyError}</ErrorNote>}
      {!cleanup.historyLoading && !cleanup.history.length && <p className="text-ui text-muted">{label("noHistory")}</p>}
      <ul>{cleanup.history.map((run) => <li key={run.runId} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-meta first:border-0"><span className="min-w-0 flex-1">{run.action ? label(run.action) : label("unknownAction")} · {label(run.state)}<span className="block text-subtle">{run.createdAt || run.startedAt ? new Date(run.createdAt ?? run.startedAt!).toLocaleString(locale) : run.runId}</span>{run.error && <span className="mt-1 block break-words text-warn-text">{run.error}</span>}</span><span>{formatBytes(run.freedBytes, locale)}</span><Button disabled={!cleanup.connected} onClick={() => { void controller.loadRun(run.runId); }}>{label("details")}</Button></li>)}</ul>
    </Section>
    {confirming && preview && cleanup.allowed && <SettingsGroup agents="none" source="host"><DeleteConfirmation key={signature} preview={preview} count={selected.length} bytes={bytes} host={host} busy={cleanup.executing} expired={expired} close={() => setConfirming(false)} submit={(text) => { setConfirming(false); void controller.execute(text); }} /></SettingsGroup>}
  </div>;
}
