// 浏览器身份 §10 in an owner tab: the address bar's suggestions (「用 Google 搜索 …」 and this identity's matching
// history — typing is never sent to the search engine) and the app-drawn new tab page (this identity's top sites).
import { useEffect, useRef, useState, type RefObject } from "react";
import { Globe, History, Search } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import type { BrowserHistoryEntry, BrowserSearchEngine, BrowserTopSite } from "../../../../shared/browserIdentity";
import { classifyAddress } from "./addressInput";
import { identityRequest, useBrowserIdentities, useIdentity } from "./identities";
import { IdentityBadge } from "./IdentityBadge";

type Item = { key: string; url: string; icon: "search" | "url" | "history"; label: string; detail?: string };

export function AddressSuggestions({ input, text, open, identityId, hostId, engine, onPick, onClose }: {
  input: RefObject<HTMLInputElement | null>; text: string; open: boolean; identityId: string; hostId: string | null; engine: BrowserSearchEngine;
  onPick(url: string): void; onClose(): void;
}) {
  const { t } = useI18n();
  const supported = useBrowserIdentities((s) => s.supported);
  const [history, setHistory] = useState<BrowserHistoryEntry[]>([]);
  const [cursor, setCursor] = useState(-1);
  const query = text.trim();
  useEffect(() => {
    setCursor(-1);
    if (!open || !supported || !hostId || query.length < 2) { setHistory([]); return; }
    let live = true;
    const timer = setTimeout(() => {
      void identityRequest((ids) => ids.history({ identityId, hostId, text: query, limit: 6 })).then((page) => { if (live) setHistory(page.entries); }, () => { if (live) setHistory([]); });
    }, 120);
    return () => { live = false; clearTimeout(timer); };
  }, [open, supported, hostId, identityId, query]);
  const typed = query ? classifyAddress(query, engine) : null;
  const items: Item[] = [];
  if (typed?.kind === "search") items.push({ key: "search", url: typed.url, icon: "search", label: t("browser.search.with", { engine: t(`browser.search.engine.${engine}` as MessageKey) }), detail: query });
  if (typed?.kind === "search" && typed.alt) items.push({ key: "alt", url: typed.alt, icon: "url", label: typed.alt });
  if (typed?.kind === "url") items.push({ key: "url", url: typed.url, icon: "url", label: typed.url });
  const seen = new Set(items.map((i) => i.url));
  for (const e of history) if (!seen.has(e.url)) { seen.add(e.url); items.push({ key: e.id, url: e.url, icon: "history", label: e.title || e.url, detail: e.url }); }
  const shown = open && query.length > 0 && items.length > 0;
  const latest = useRef({ items, cursor, shown });
  latest.current = { items, cursor, shown };
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const { items: list, cursor: at, shown: visible } = latest.current;
      if (!visible) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = list.length;
        setCursor(e.key === "ArrowDown" ? (at + 1 >= n ? -1 : at + 1) : (at - 1 < -1 ? n - 1 : at - 1));
      } else if (e.key === "Enter" && at >= 0 && at < list.length && !e.isComposing) {
        e.preventDefault(); e.stopPropagation(); onPick(list[at]!.url);
      } else if (e.key === "Escape") onClose();
    };
    el.addEventListener("keydown", onKey, true);
    return () => el.removeEventListener("keydown", onKey, true);
  }, [input, onPick, onClose]);
  if (!shown) return null;
  return (
    <div role="listbox" data-browser-suggestions="" aria-label={t("browser.address")} onMouseDown={(e) => e.preventDefault()}
      className="float absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden p-1">
      {items.map((item, i) => (
        <button key={item.key} type="button" role="option" aria-selected={i === cursor} data-browser-suggestion={item.icon} onClick={() => onPick(item.url)}
          className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs ${i === cursor ? "bg-hover" : "hover:bg-hover"}`}>
          {item.icon === "search" ? <Search size={13} className="shrink-0 text-subtle" /> : item.icon === "history" ? <History size={13} className="shrink-0 text-subtle" /> : <Globe size={13} className="shrink-0 text-subtle" />}
          <span className="min-w-0 truncate text-foreground">{item.label}</span>
          {item.detail && <span className="min-w-0 shrink-[2] truncate text-subtle">{item.icon === "search" ? `“${item.detail}”` : item.detail}</span>}
        </button>
      ))}
    </div>
  );
}

/** about:blank in an owner tab: this identity's 8 most visited sites (from its history), drawn by the app (no network). */
export function NewTabPage({ identityId, hostId, onOpen }: { identityId: string; hostId: string; onOpen(url: string): void }) {
  const { t } = useI18n();
  const identity = useIdentity(identityId);
  const [sites, setSites] = useState<BrowserTopSite[] | null>(null);
  useEffect(() => {
    let live = true;
    void identityRequest((ids) => ids.topSites(identityId, hostId, 8)).then((list) => { if (live) setSites(list); }, () => { if (live) setSites([]); });
    return () => { live = false; };
  }, [identityId, hostId]);
  const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
  return (
    <div data-browser-new-tab={identityId} className="absolute inset-0 z-[1] flex flex-col items-center overflow-y-auto bg-background px-6 pt-[12%] pb-6">
      {identity && !identity.isDefault && <div className="mb-3 flex items-center gap-1.5 text-xs text-muted"><IdentityBadge view={identity} size={18} />{identity.name}</div>}
      <p className="mb-5 text-xs text-subtle">{t("browser.newTab.hint")}</p>
      <h2 className="mb-2 w-full max-w-[34rem] text-caption font-medium text-subtle">{t("browser.newTab.topSites")}</h2>
      {sites && !sites.length && <p className="w-full max-w-[34rem] text-xs text-subtle">{t("browser.newTab.empty")}</p>}
      <div className="grid w-full max-w-[34rem] grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
        {sites?.map((s) => (
          <button key={s.url} type="button" data-browser-top-site={s.url} title={s.url} onClick={() => onOpen(s.url)}
            className="flex min-w-0 flex-col items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-3 hover:bg-hover">
            <span className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-muted">{[...host(s.url).replace(/^www\./, "")][0]?.toUpperCase()}</span>
            <span className="w-full truncate text-center text-xs text-foreground">{s.title || host(s.url)}</span>
            <span className="w-full truncate text-center text-caption text-subtle">{host(s.url)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
