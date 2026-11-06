import { useEffect, useRef, useState } from "react";
import { useOwnerDocument } from "../lib/ownerContext";
import { useI18n } from "../i18n";
import { layoutStore } from "../lib/userLayout";
import { chooseMemoryHost, useLayoutView } from "../lib/userLayoutSync";
import { useHostAccess } from "../lib/hostAccess";
import { useHostScope } from "../lib/useHostScope";
import { lastKnownSidebar } from "../lib/scopedSidebarView";
import { refId, type LayoutRef } from "../lib/userLayoutModel";
import { noticeDialog } from "../lib/contextMenu";
import { Button, Section, SettingRow } from "./settings/Form";

/** On a cold offline start only the layout references are known. Show those without inventing
 * session/project resources; once a real sidebar snapshot arrives its normal rows take over. */
export function UserLayoutOfflineItems() {
  const { t } = useI18n(); const s = useLayoutView(); const scope = useHostScope();
  if (!s.doc) return null;
  const absent = s.hosts.filter(h => !h.online && scope.hostsInScope.some(v => v.id === h.id) && !lastKnownSidebar(h.id));
  const visible = (r: LayoutRef) => absent.find(h => h.instanceId === r.host);
  const refs = [...s.doc.sections.flatMap(section => section.members.map(ref => ({ ref, section: section.name }))), ...s.doc.projectOrder.map(ref => ({ ref, section: "" })), ...s.doc.starredProjects.map(ref => ({ ref, section: "" })), ...s.doc.pinned.map(ref => ({ ref, section: "" }))];
  const seen = new Set<string>();
  return <div className="max-h-48 overflow-y-auto px-2 text-xs text-muted">
    {refs.filter(({ ref }) => { const id = refId(ref); if (!visible(ref) || seen.has(id)) return false; seen.add(id); return true; }).map(({ ref, section }) => {
      const h = visible(ref)!;
      return <button key={refId(ref)} className="block w-full truncate rounded px-2 py-1.5 text-left opacity-50 grayscale hover:bg-hover" title={t("sidebar.hostRowOffline", { host: h.label })} onClick={() => void noticeDialog(t("sidebar.hostRowOffline", { host: h.label }))}>
        {section ? `${section} · ` : ""}{ref.id} · {h.label}
      </button>;
    })}
  </div>;
}

export function UserLayoutStatus() {
  const { t } = useI18n();
  const s = useLayoutView();
  const open = () => import("../store").then(({ useApp }) => useApp.getState().openSettings("sidebar"));
  if (!s.memoryHost || s.status === "synced" && !s.pending && !s.error) return null;
  const key = s.status === "missing" ? "layoutMemory.missing" : s.status === "unsupported" ? "layoutMemory.unsupported" : "layoutMemory.offline";
  return <button className="block w-full px-3 py-1.5 text-left text-caption leading-snug text-muted hover:text-foreground" onClick={() => void open()} title={s.error ?? undefined}>{t(key, { host: s.memoryHost.label })}</button>;
}

export function UserLayoutSettings() {
  const { t } = useI18n(); const s = useLayoutView();
  const access = useHostAccess(s.hosts.find(h => h.instanceId === s.memoryHost?.instanceId)?.id);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const choose = async (id: string) => {
    const host = s.hosts.find(h => h.id === id);
    if (!host?.instanceId) return;
    setBusy(true); setError(null);
    try { await chooseMemoryHost({ instanceId: host.instanceId, label: host.label }); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const value = s.hosts.find(h => h.instanceId === s.memoryHost?.instanceId)?.id ?? "";
  return <Section title={t("layoutMemory.title")}>
    <SettingRow agents="none" source="person" label={t("layoutMemory.title")} hint={t("layoutMemory.hint")}>
      <select aria-label={t("layoutMemory.title")} disabled={busy} value={value} onChange={e => void choose(e.target.value)} className="max-w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs">
        <option value="" disabled>{s.memoryHost?.label ?? t("layoutMemory.local")}</option>
        {s.hosts.filter(h => h.online && h.supported && h.eligible && h.instanceId).map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
      </select>
    </SettingRow>
    {s.memoryHost && access.known && access.isOwner && !s.ownerPersonConfirmed && <p className="px-3 py-2 text-xs text-muted">{t("layoutMemory.shared")}</p>}
    {(error || s.error) && <p role="alert" className="px-3 py-2 text-xs text-danger">{error ?? s.error}</p>}
    <UserLayoutStatus />
  </Section>;
}

/** Explicit first migration choice. Escape and the default action both keep the remote document. */
export function UserLayoutMigration() {
  const { t } = useI18n(); const s = useLayoutView();
  const doc = useOwnerDocument();
  const primary = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s.migration) primary.current?.focus(); }, [s.migration]);
  if (!s.migration) return null;
  const resolve = async (merge: boolean) => { setBusy(true); try { await layoutStore()?.resolveMigration(merge); } finally { setBusy(false); } };
  return <div className="fixed inset-0 z-[154] flex items-center justify-center bg-black/30 p-5" onKeyDown={e => {
    if (e.key === "Escape" && !busy) { e.preventDefault(); void resolve(false); }
    if (e.key === "Tab") {
      const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const at = buttons.indexOf(doc.activeElement as HTMLButtonElement);
      e.preventDefault(); buttons[(at + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
    }
  }}>
    <div role="dialog" aria-modal="true" aria-labelledby="layout-migration-title" className="w-full max-w-md rounded-xl border border-border bg-raised p-5 shadow-xl">
      <p id="layout-migration-title" className="mb-5 text-sm leading-relaxed">{t("layoutMemory.migrate", { host: s.memoryHost?.label ?? "" })}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={busy} onClick={() => void resolve(true)}>{t("layoutMemory.merge")}</Button>
        <button ref={primary} disabled={busy} onClick={() => void resolve(false)} className="rounded-md bg-accent px-3 py-1.5 text-xs text-white">{t("layoutMemory.useRemote", { host: s.memoryHost?.label ?? "" })}</button>
      </div>
    </div>
  </div>;
}
