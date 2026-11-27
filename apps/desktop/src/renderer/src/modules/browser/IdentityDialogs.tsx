// 浏览器身份 confirmations (design browser-profiles v3 §3): 清除浏览数据 (which host, what, which sites, history range),
// the whole-identity 退出所有登录 / 删除 confirm and the one-host 退出登录 / removed host's 清除 confirm. Portals into the owner window's document, like the module's other popovers.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { useOwnerDocument } from "../../lib/ownerContext";
import { btn } from "../../components/Button";
import { Checkbox, SettingsGroup } from "../../components/settings/Form";
import { BROWSER_HISTORY_RANGES, type BrowserClearDataType, type BrowserHistoryRange, type BrowserIdentityView } from "../../../../shared/browserIdentity";
import { identityRequest } from "./identities";

function Modal({ title, label, busy, onClose, children, footer }: { title: ReactNode; label: string; busy: boolean; onClose(): void; children: ReactNode; footer: ReactNode }) {
  const { t } = useI18n();
  const doc = useOwnerDocument();
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/30 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={label} className="flex max-h-[76vh] w-[28rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-surface p-4 shadow-2xl"
        onKeyDown={(e) => { if (e.key === "Escape" && !busy) onClose(); }}>
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
          <button type="button" title={t("browser.identity.page.cancel")} aria-label={t("browser.identity.page.cancel")} disabled={busy} onClick={onClose}
            className="shrink-0 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground disabled:opacity-50"><X size={15} /></button>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto text-sm">{children}</div>
        <div className="mt-4 flex justify-end gap-2">{footer}</div>
      </div>
    </div>,
    doc.body,
  );
}

const errorCode = (e: unknown): string => /([a-z_]+)$/.exec(e instanceof Error ? e.message : String(e))?.[1] ?? "failed";

/** A signed-in cookie domain (".outlook.com") as the origin main clears with its subdomains. */
export const siteOrigin = (domain: string): string => `https://${domain.replace(/^\./, "")}`;

/** One kind of data in 清除浏览数据 (a box, its name and what clearing it does). */
function TypeRow({ checked, onChange, label, hint }: { checked: boolean; onChange(v: boolean): void; label: string; hint?: string }) {
  return (
    <SettingsGroup agents="none" source="local">
      <label className="flex cursor-pointer items-start gap-2 py-1">
        <span className="pt-0.5"><Checkbox checked={checked} onChange={onChange} label={label} /></span>
        <span className="min-w-0"><span className="block">{label}</span>{hint && <span className="block text-xs text-subtle">{hint}</span>}</span>
      </label>
    </SettingsGroup>
  );
}

/** A configured host holding data of the identity (the storage rows minus removed hosts). */
export interface ClearDataHost { id: string; name: string }

/** `sites`: signed-in cookie domains per host; the list follows the chosen host (所有主机: every host's). */
export function ClearDataDialog({ identity, hosts, sites: sitesByHost, onClose, onDone }: { identity: BrowserIdentityView; hosts: readonly ClearDataHost[]; sites: Readonly<Record<string, readonly string[]>>; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [host, setHost] = useState<string>("all");
  const chosen = hosts.find((h) => h.id === host);
  const sites = [...new Set(chosen ? sitesByHost[chosen.id] ?? [] : Object.values(sitesByHost).flat())].sort();
  const [types, setTypes] = useState<ReadonlySet<BrowserClearDataType>>(() => new Set<BrowserClearDataType>(["siteData", "cache"]));
  const [range, setRange] = useState<BrowserHistoryRange>("all");
  const [only, setOnly] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const toggle = (type: BrowserClearDataType, on: boolean) => setTypes((s) => { const n = new Set(s); if (on) n.add(type); else n.delete(type); return n; });
  const origins = only ? [...picked].filter((site) => sites.includes(site)).map(siteOrigin) : [];
  async function run() {
    if (!types.size || busy || (only && !origins.length)) return;
    setBusy(true); setError(null);
    try {
      await identityRequest((ids) => ids.clearData({ identityId: identity.id, hostId: chosen?.id ?? "all", types: [...types], ...(origins.length ? { origins } : {}), ...(types.has("history") ? { historyRange: range } : {}) }));
      onDone(); onClose();
    } catch (e) { setError(errorCode(e)); } finally { setBusy(false); }
  }
  const title = t("browser.identity.clear.title", { name: identity.name });
  const row = (type: BrowserClearDataType, label: MessageKey, hint?: MessageKey) => <TypeRow checked={types.has(type)} onChange={(v) => toggle(type, v)} label={t(label)} hint={hint && t(hint)} />;
  return (
    <Modal title={title} label={title} busy={busy} onClose={onClose}
      footer={<>
        <button type="button" className={btn({ variant: "ghost", size: "sm" })} disabled={busy} onClick={onClose}>{t("browser.identity.page.cancel")}</button>
        <button type="button" data-identity-clear-do className={btn({ size: "sm", danger: true })} disabled={busy || !types.size || (only && !origins.length)} onClick={() => void run()}>{t("browser.identity.clear.do")}</button>
      </>}>
      <SettingsGroup agents="none" source="local"><div data-identity-clear-dialog>
        {hosts.length > 1 && (
          <div className="mb-2 border-b border-border pb-2">
            <p className="text-xs text-muted">{t("browser.identity.clear.host")}</p>
            <div role="radiogroup" aria-label={t("browser.identity.clear.host")} data-identity-clear-hosts className="mt-1 flex flex-wrap gap-1">
              {[{ id: "all", name: t("browser.identity.clear.allHosts") }, ...hosts].map((h) => (
                <button key={h.id} type="button" role="radio" aria-checked={host === h.id} data-identity-clear-host={h.id} onClick={() => setHost(h.id)}
                  className={`rounded-md border px-2 py-0.5 text-xs ${host === h.id ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted hover:bg-surface-2"}`}>{h.name}</button>
              ))}
            </div>
          </div>
        )}
        {row("siteData", "browser.identity.clear.siteData", "browser.identity.clear.siteDataHint")}
        {row("cache", "browser.identity.clear.cache")}
        {row("history", "browser.identity.clear.history")}
        {types.has("history") && (
          <div role="radiogroup" aria-label={t("browser.identity.clear.history")} className="mt-1 ml-6 flex flex-wrap gap-1">
            {BROWSER_HISTORY_RANGES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={range === r} onClick={() => setRange(r)}
                className={`rounded-md border px-2 py-0.5 text-xs ${range === r ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted hover:bg-surface-2"}`}>{t(`browser.identity.clear.range.${r}` as MessageKey)}</button>
            ))}
          </div>
        )}
        {sites.length > 0 && (
          <div className="mt-3 border-t border-border pt-2">
            <label className="flex cursor-pointer items-center gap-2 py-1">
              <Checkbox checked={only} onChange={setOnly} label={t("browser.identity.clear.onlySites")} />
              <span>{t("browser.identity.clear.onlySites")}</span>
            </label>
            <p className="ml-6 text-xs text-subtle">{t("browser.identity.clear.onlySitesHint")}</p>
            {only && <div className="mt-1 ml-6 flex flex-col">
              {sites.map((site) => (
                <label key={site} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs">
                  <Checkbox checked={picked.has(site)} label={site} onChange={(v) => setPicked((s) => { const n = new Set(s); if (v) n.add(site); else n.delete(site); return n; })} />
                  <span className="min-w-0 truncate">{site.replace(/^\./, "")}</span>
                </label>
              ))}
            </div>}
          </div>
        )}
        {chosen && <p data-identity-clear-scope-host className="mt-3 text-xs text-subtle">{t("browser.identity.clear.scopeHost", { host: chosen.name })}</p>}
        <p className={`${chosen ? "mt-1" : "mt-3"} text-xs text-subtle`}>{t("browser.identity.clear.scope")}</p>
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      </div></SettingsGroup>
    </Modal>
  );
}

type ConfirmKind = "signOut" | "remove" | "signOutHost" | "clearLeftover";
const CONFIRM: Record<ConfirmKind, { title: MessageKey; text: MessageKey }> = {
  signOut: { title: "browser.identity.page.signOutDo", text: "browser.identity.page.signOutConfirm" },
  remove: { title: "browser.identity.page.removeDo", text: "browser.identity.page.removeConfirm" },
  signOutHost: { title: "browser.identity.page.hostSignOutDo", text: "browser.identity.page.hostSignOutConfirm" },
  clearLeftover: { title: "browser.identity.page.leftoverDo", text: "browser.identity.page.leftoverConfirm" },
};

/** 退出所有登录 / 删除这个身份, and one host's 退出登录 / a removed host's 清除 (`host`: which; its name is in the title and
 *  the sentence): the sentence says what goes; the red button repeats the action. */
export function IdentityConfirmDialog({ identity, kind, passwords, host, onClose, onDone }: { identity: BrowserIdentityView; kind: ConfirmKind; passwords: number; host?: { id: string; name: string }; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [kind]);
  async function run() {
    setBusy(true); setError(null);
    try {
      await identityRequest((ids) => kind === "signOut" ? ids.signOut(identity.id)
        : kind === "remove" ? ids.remove(identity.id)
        : kind === "signOutHost" ? ids.signOutHost(identity.id, host!.id)
        : ids.clearLeftover(identity.id, host!.id));
      onDone(); onClose();
    } catch (e) { setError(errorCode(e)); } finally { setBusy(false); }
  }
  const title = t(CONFIRM[kind].title);
  const text = t(CONFIRM[kind].text, { name: identity.name, n: identity.openTabs, passwords, host: host?.name ?? "" });
  return (
    <Modal title={host ? `${title} · ${identity.name} · ${host.name}` : `${title} · ${identity.name}`} label={title} busy={busy} onClose={onClose}
      footer={<>
        <button type="button" className={btn({ variant: "ghost", size: "sm" })} disabled={busy} onClick={onClose}>{t("browser.identity.page.cancel")}</button>
        <button type="button" data-identity-confirm={kind} className={btn({ size: "sm", danger: true })} disabled={busy} onClick={() => void run()}>{title}</button>
      </>}>
      <p data-identity-confirm-text className="leading-relaxed">{text}</p>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </Modal>
  );
}
