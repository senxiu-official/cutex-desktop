import { ImageCacheSettings } from "./ImageCacheSettings";
import { CleanupSection } from "./CleanupSection";
import { useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import type { StorageItem, StorageStore } from "../../../../shared/storage";
import { Button, EmptyState, ErrorNote, Loading, Section } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { useClock } from "../../lib/time";
import { useStorage } from "./hooks";
import { formatBytes, measuredAgo, retentionText } from "./model";
import { zhCN } from "./i18n";

function knownLabel(kind: "group" | "store", id: string, fallback: string, t: ReturnType<typeof useI18n>["t"]): string {
  const key = `storage.${kind}.${id}`;
  return key in zhCN ? t(key as MessageKey) : fallback;
}
function ItemRow({ item }: { item: StorageItem }) {
  const { t, locale } = useI18n();
  const state = item.state && ["active", "retired", "deleted", "unknown"].includes(item.state) ? t(`storage.state.${item.state}` as MessageKey) : null;
  return <li className="border-t border-border/60 py-2 text-xs">
    <div className="flex flex-wrap items-baseline gap-2"><span className="min-w-0 flex-1 break-all">{item.name || item.path}</span>{state && <span className="text-subtle">{state}</span>}<span className="shrink-0 tabular-nums">{formatBytes(item.bytes, locale)}</span></div>
    {item.name && <div className="mt-1 break-all font-mono text-subtle">{item.path}</div>}
    {!!item.rolloutBytes && <div className="mt-1 text-subtle">{t("storage.rollout", { bytes: formatBytes(item.rolloutBytes, locale) })}</div>}
  </li>;
}
function StoreRow({ store, storage, now }: { store: StorageStore; storage: ReturnType<typeof useStorage>; now: number }) {
  const { t, locale } = useI18n();
  const tr = (key: string, vars?: Record<string, string | number>) => t(key as MessageKey, vars);
  const detail = storage.detail?.storeId === store.id ? storage.detail : null;
  return <div className="border-t border-border py-3 first:border-0">
    <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{knownLabel("store", store.id, store.label, t)}</p><p className="mt-1 break-all font-mono text-xs text-subtle">{store.path}</p></div><span className="text-sm tabular-nums">{store.measuredAt ? formatBytes(store.bytes, locale) : "—"}</span></div>
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"><span title={store.retention.detail}>{retentionText(store.retention, tr, locale)}</span><span>{t("storage.files", { n: store.files })}</span>{store.items.count != null && <span>{t("storage.count", { n: store.items.count })}</span>}</div>
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle"><span>{measuredAgo(store.measuredAt, now, tr)}</span>{store.newestAt && <span title={store.newestAt}>{t("storage.newest", { date: new Date(store.newestAt).toLocaleString(locale) })}</span>}{store.oldestAt && <span title={store.oldestAt}>{t("storage.oldest", { date: new Date(store.oldestAt).toLocaleDateString(locale) })}</span>}</div>
    {!!store.unreadable && <p className="mt-1 text-xs text-warn-text">{t("storage.unreadable", { n: store.unreadable })}</p>}
    {store.drillDown && <button type="button" className="mt-2 rounded text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent" aria-expanded={!!detail} onClick={() => { if (detail) storage.controller.closeDetails(); else void storage.controller.openDetails(store.id); }}>{t(detail ? "storage.close" : "storage.details")}</button>}
    {detail && <div className="mt-2 rounded border border-border bg-surface-2/30 px-3">{detail.error && <ErrorNote>{detail.error}</ErrorNote>}<ul>{detail.items.map((item) => <ItemRow key={item.id} item={item} />)}</ul>{detail.loading && <Loading rows={1} />}{!detail.loading && !detail.error && !detail.items.length && <p className="py-3 text-xs text-subtle">{t("storage.empty")}</p>}{detail.error && <div className="py-2"><Button onClick={() => { void storage.controller.openDetails(store.id); }}>{t("storage.retry")}</Button></div>}{detail.nextCursor && !detail.loading && <div className="py-2"><Button onClick={() => { void storage.controller.openDetails(store.id, true); }}>{t("storage.more")}</Button></div>}</div>}
  </div>;
}
export function StoragePage() {
  const storage = useStorage();
  const { t, locale } = useI18n();
  const now = useClock();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const tr = (key: string, vars?: Record<string, string | number>) => t(key as MessageKey, vars);
  if (!storage.supported || storage.unsupported) return <><ImageCacheSettings /><Section><div role="status"><EmptyState>{t("storage.unsupported")}</EmptyState></div></Section></>;
  if (!storage.connected && !storage.view) return <><ImageCacheSettings /><Section><div role="status"><EmptyState>{t("storage.offline")}</EmptyState></div></Section></>;
  const view = storage.view;
  const running = view?.walk.state === "running" || storage.refreshing;
  return <>
    <ImageCacheSettings />
    <Section title={t("storage.inventory")} actions={<Button disabled={!storage.connected || running} onClick={() => { void storage.controller.refresh(); }}><span className="inline-flex items-center gap-1.5"><RefreshCw size={13} className={running ? "animate-spin" : ""} />{t(running ? "storage.running" : "storage.refresh")}</span></Button>}>
      {storage.error && <ErrorNote>{storage.error}<button type="button" className="ml-2 underline" onClick={() => { void storage.controller.load(true); }}>{t("storage.retry")}</button></ErrorNote>}
      {!view && storage.loading && <Loading rows={3} />}
      {view && <div className="space-y-1 py-3"><p className="text-sm font-medium tabular-nums">{t("storage.total", { bytes: formatBytes(view.totals.bytes, locale), files: view.totals.files })}</p>{view.volume && <p className="text-xs text-muted">{t("storage.volume", { free: formatBytes(view.volume.freeBytes, locale), total: formatBytes(view.volume.totalBytes, locale) })}</p>}<p className="text-xs text-subtle">{measuredAgo(view.walk.finishedAt, now, tr)}</p>{view.walk.stale && <p className="text-xs text-warn-text">{t("storage.stale")}</p>}{running && <p role="status" className="text-xs text-accent">{t("storage.running")}{view.walk.progress?.entries != null && ` · ${t("storage.progress", { n: view.walk.progress.entries })}`}</p>}{view.walk.error && <ErrorNote>{view.walk.error}</ErrorNote>}</div>}
    </Section>
    <CleanupSection key={storage.hostId} />
    {/* Each group is a titled card: its name folds it (the card hides), its size and share sit in the header. */}
    {view?.groups.map((group) => { const closed = collapsed.has(group.id); const Chevron = closed ? ChevronRight : ChevronDown; const share = view.totals.bytes > 0 ? Math.min(100, 100 * group.bytes / view.totals.bytes) : 0; return <Section key={`${storage.hostId}:${group.id}`} collapsed={closed}
      title={<button type="button" aria-expanded={!closed} className="-ml-1 inline-flex items-center gap-1.5 rounded px-1 text-left focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setCollapsed((before) => { const next = new Set(before); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}><Chevron size={14} className="text-subtle" />{knownLabel("group", group.id, group.label, t)}</button>}
      actions={<span className="inline-flex items-center gap-2 text-xs tabular-nums text-muted"><span aria-hidden className="h-1 w-24 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-accent/60" style={{ width: `${share}%` }} /></span>{formatBytes(group.bytes, locale)}</span>}>
      {view.stores.filter((store) => store.group === group.id).map((store) => <StoreRow key={store.id} store={store} storage={storage} now={now} />)}
    </Section>; })}
  </>;
}
