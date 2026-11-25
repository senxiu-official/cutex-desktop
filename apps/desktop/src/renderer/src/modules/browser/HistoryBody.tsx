// 浏览历史 page (design browser-profiles v3 §11, sketch history.png): search (title or address), the identity, day
// groups of time · title · address, and per row ⋯ (在新标签打开 / 删除这一条 / 删除这个网站的全部历史). A click opens the
// page in a new tab of the same identity. Main answers every query; agents have no way to read it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, MoreHorizontal, Search } from "lucide-react";
import { useI18n } from "../../i18n";
import { openMenuFrom } from "../../lib/contextMenu";
import { openSide } from "../../lib/sideOpen";
import type { SideBodyProps } from "../slots";
import type { BrowserHistoryEntry } from "../../../../shared/browserIdentity";
import { identityRequest, onBrowserIdentityEvent, useBrowserIdentities, useIdentity } from "./identities";
import { IdentityBadge } from "./IdentityBadge";
import { groupByDay, historyOrigin, type BrowserHistoryState } from "./historyState";
import { BROWSER_TAB } from "./browserState";

const PAGE = 100;

export function HistoryBody({ instance, hostId, setState, revealed }: SideBodyProps<BrowserHistoryState>) {
  const { t, locale } = useI18n();
  const identityId = instance.state.identityId;
  const identity = useIdentity(identityId);
  const identities = useBrowserIdentities((s) => s.state?.identities ?? []);
  const retentionOff = useBrowserIdentities((s) => s.prefs.historyRetention === "off");
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<BrowserHistoryEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [revealed]);

  const load = useCallback(async (before?: number) => {
    if (!hostId) return;
    const page = await identityRequest((ids) => ids.history({ identityId, hostId, ...(text.trim() ? { text: text.trim() } : {}), ...(before ? { before } : {}), limit: PAGE }));
    setEntries((old) => (before && old ? [...old, ...page.entries] : page.entries));
    setNext(page.nextBefore);
  }, [hostId, identityId, text]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => { void load().then(() => { if (live) setError(null); }, (e) => { if (live) setError(e instanceof Error ? e.message : String(e)); }); }, text ? 180 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [load, refresh, text]);
  useEffect(() => onBrowserIdentityEvent((event) => {
    if (event.kind === "history" && event.identityId === identityId && event.hostId === hostId) setRefresh((n) => n + 1);
  }), [identityId, hostId]);

  const groups = useMemo(() => groupByDay(entries ?? []), [entries]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayLabel = (day: number) => day === today.getTime() ? t("browser.history.today") : day === today.getTime() - 86_400_000 ? t("browser.history.yesterday")
    : new Date(day).toLocaleDateString(locale, { month: "long", day: "numeric", weekday: "short", ...(new Date(day).getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  const time = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const open = (url: string) => openSide(BROWSER_TAB, { url, browserIdentityId: identityId }, { focus: true, reveal: true });
  const remove = (target: { ids: string[] } | { origin: string }): void => {
    if (hostId) void identityRequest((ids) => ids.historyDelete({ identityId, hostId, ...target })).then(() => setRefresh((n) => n + 1), () => {});
  };

  return (
    <div data-browser-history={identityId} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-ctl border border-border bg-background px-2 focus-within:border-subtle">
          <Search size={13} className="shrink-0 text-subtle" aria-hidden />
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("browser.history.search")} aria-label={t("browser.history.search")}
            spellCheck={false} className="h-full min-w-0 flex-1 bg-transparent text-meta text-foreground outline-none placeholder:text-subtle" />
        </div>
        {identities.length > 1 && (
          <button type="button" data-browser-history-identity data-tip={t("browser.history.identity")} aria-haspopup="menu"
            onClick={(e) => openMenuFrom(e.currentTarget, identities.map((i) => ({ label: i.name, icon: <IdentityBadge view={i} size={16} />, hint: i.id === identityId ? "✓" : "", onSelect: () => setState({ identityId: i.id }) })))}
            className="flex h-7 max-w-[9rem] shrink-0 items-center gap-1.5 rounded-ctl border border-border px-2 text-xs text-muted hover:bg-hover hover:text-foreground">
            <IdentityBadge view={identity} size={16} /><span className="min-w-0 truncate">{identity?.name}</span>
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {retentionOff && <p role="status" className="px-2 pt-2 text-xs text-subtle">{t("browser.history.off")}</p>}
        {error && <p role="alert" className="px-2 pt-2 text-xs text-danger">{error}</p>}
        {entries && entries.length === 0 && !error && <p className="px-2 pt-3 text-xs text-subtle">{t(text.trim() ? "browser.history.noMatch" : "browser.history.empty")}</p>}
        {groups.map((g) => (
          <section key={g.day} data-browser-history-day={g.day}>
            <h3 className="sticky top-0 z-[1] bg-surface px-2 pt-3 pb-1 text-caption font-medium text-subtle">{dayLabel(g.day)}</h3>
            {g.entries.map((e) => {
              const origin = historyOrigin(e.url);
              return (
                <div key={e.id} data-browser-history-row={e.id} className="group/hist flex min-w-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-hover">
                  <span className="w-11 shrink-0 text-caption text-subtle tabular-nums">{time(e.visitedAt)}</span>
                  <Globe size={13} className="shrink-0 text-subtle" aria-hidden />
                  <button type="button" onClick={() => open(e.url)} title={e.url} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
                    <span className="min-w-0 truncate text-xs text-foreground">{e.title || e.url}</span>
                    <span className="min-w-0 shrink-[2] truncate text-caption text-subtle">{origin ? new URL(e.url).host : e.url}</span>
                  </button>
                  <button type="button" aria-label={t("browser.history.more")} data-tip={t("browser.history.more")} aria-haspopup="menu"
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 group-hover/hist:opacity-100 focus-visible:opacity-100 hover:bg-hover hover:text-foreground"
                    onClick={(ev) => openMenuFrom(ev.currentTarget, [
                      { label: t("browser.identity.newTabIn"), onSelect: () => open(e.url) },
                      "separator",
                      { label: t("browser.history.deleteOne"), onSelect: () => remove({ ids: [e.id] }) },
                      origin && { label: t("browser.history.deleteSite", { site: new URL(origin).host }), danger: true, onSelect: () => remove({ origin }) },
                    ])}>
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              );
            })}
          </section>
        ))}
        {next !== null && entries && <div className="px-2 pt-2"><button type="button" className="text-xs text-accent hover:underline" onClick={() => void load(next).catch(() => {})}>{t("browser.history.loadMore")}</button></div>}
      </div>
    </div>
  );
}
