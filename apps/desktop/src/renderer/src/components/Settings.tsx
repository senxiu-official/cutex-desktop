// Settings page (DESIGN §4.5; layout per docs/research/settings-audit-20261008.md): grouped left
// nav (this machine → connection → the connected host); every page starts with a source tag saying
// where its settings live (本机 / 主机 · name / codex 配置 · name). Pages are `settings.page` items
// contributed by modules (docs/desktop-modules.md §9 step 1); this file owns only the group order
// and the outlets. Settings itself is the shell's `main.page` item `shell.settings` (params.tab), with
// SettingsNav as its Aside. Multi-host (P1 step 2c, RFC §9.3): host pages get a host picker in their
// header (lib/settingsHost) and read / write that host (lib/targetHost provider).
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft, Search, SlidersHorizontal, X } from "lucide-react";
import { bridge } from "../bridge";
import { useI18n, type MessageKey } from "../i18n";
import { resetDragonSize } from "../lib/aboutDragon";
import { SETTINGS_GROUP_ORDER, settingsTab } from "../lib/settingsNav";
import { firstResult, flattenResults, highlightParts, resultCount, searchSettings, type Ranges, type SettingsSearchHit } from "../lib/settingsSearch";
import { requestSettingsReveal, useSettingsReveal, useSettingsSearchIndex } from "../lib/settingsSearchView";
import { hostPickerMode } from "../lib/hostPick";
import { AllHostsContext, SETTINGS_HOST_PAGES, SETTINGS_MEMBER_PAGES, setSettingsHost, useSettingsHost, useSettingsTarget } from "../lib/settingsHost";
import { useSettingsAllHosts } from "../lib/settingsAllHosts";
import { TargetHostContext } from "../lib/targetHost";
import { useHostAccess } from "../lib/hostAccess";
import { useHostScope } from "../lib/useHostScope";
import { HostPicker } from "./HostPicker";
import { SettingsHostFrame } from "./SettingsHostFrame";
import { ItemBoundary } from "../modules/Outlet";
import { useSlot } from "../modules/react";
import type { AppSlotEntry, PageParams } from "../modules/slots";
import { useApp } from "../store";
import { noteCustomizeOpener, type CustomizeRegion } from "../lib/customize";
import { PageBody, SUBNAV_ITEM, SUBNAV_OFF, SUBNAV_ON } from "./Page";
import { EmptyState, Button, Section, SettingsPage, TextLink } from "./settings/Form";

function NavRow({ entry, current }: { entry: AppSlotEntry<"settings.page">; current: boolean }) {
  const { t } = useI18n();
  const openSettings = useApp((s) => s.openSettings);
  const { item } = entry;
  const badge = item.useBadge?.() ?? null;
  const Icon = item.icon;
  const disabled = entry.mode !== "show";
  return (
    <button
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      title={disabled && !entry.waiting ? t("modules.needsCapability", { list: entry.missing.join(", ") }) : undefined}
      onClick={() => openSettings(item.page)}
      className={`${SUBNAV_ITEM} ${current ? SUBNAV_ON : SUBNAV_OFF} ${disabled && !current ? "opacity-60" : ""} focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none`}
    >
      <Icon size={15} strokeWidth={1.75} className="shrink-0" />
      <span className="truncate">{t(item.titleKey)}</span>
      {badge?.dot && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-label={t("settings.about.attention")} />}
      {badge?.text && <span className="ml-auto shrink-0 rounded bg-surface-2 px-1 text-[10px] text-subtle">{badge.text}</span>}
    </button>
  );
}

/**
 * Settings nav, the full window height (App puts it left of the title bar): it replaces the app
 * sidebar and its title-bar row (host switcher, sidebar toggle), so 返回 is its first row, level
 * with the breadcrumb. The top row is a window drag region; on macOS it clears the traffic lights.
 */
export function SettingsNav({ params }: { params: PageParams }) {
  const tab = settingsTab(params);
  const { t } = useI18n();
  const closePage = useApp((s) => s.closePage);
  const pages = useSlot("settings.page");
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // Leaving Settings: the 关于 dragon starts small next time; the host pages edit the focus host again.
  useEffect(() => resetDragonSize, []);
  useEffect(() => () => setSettingsHost(null), []);
  // Ctrl+F (anywhere) or "/" (outside a text field) focuses the search box while Settings is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const find = mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f";
      const slash = e.key === "/" && !mod && !e.altKey && !isTextTarget(e.target);
      if (!find && !slash) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <nav aria-label={t("settings.title")} className="flex w-52 shrink-0 flex-col bg-transparent select-none">
      <div className={`flex h-10 shrink-0 items-center px-2 [app-region:drag] ${bridge.window?.nativeControls === "left" ? "pl-[76px]" : ""}`}>
        <button onClick={closePage} className={`${SUBNAV_ITEM} ${SUBNAV_OFF} [app-region:no-drag]`}>
          <ArrowLeft size={15} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">{t("settings.back")}</span>
        </button>
      </div>
      <div className="relative shrink-0 px-2 pt-1">
        <Search size={13} className="pointer-events-none absolute top-1/2 left-4 mt-0.5 -translate-y-1/2 text-subtle" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={query.trim() !== ""}
          aria-controls="settings-search-results"
          aria-label={t("shell.settingsSearch.placeholder")}
          title={t("shell.settingsSearch.title")}
          placeholder={t("shell.settingsSearch.placeholder")}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (query) setQuery("");
              else e.currentTarget.blur();
            }
          }}
          className="w-full rounded-md border border-border bg-background py-1 pr-6 pl-7 text-[13px] outline-none select-text placeholder:text-subtle focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            aria-label={t("shell.settingsSearch.clear")}
            title={t("shell.settingsSearch.clear")}
            onClick={() => (setQuery(""), input.current?.focus())}
            className="absolute top-1/2 right-3 mt-0.5 -translate-y-1/2 rounded p-0.5 text-subtle hover:text-foreground"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {query.trim() ? (
        <SettingsSearchResults query={query} input={input} current={tab} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
          {SETTINGS_GROUP_ORDER.map((group) => {
            const entries = pages.filter((e) => e.item.group === group);
            if (!entries.length) return null;
            return (
              <div key={group} className="mb-3">
                <div className="px-2 pt-1 pb-1 text-sm text-subtle">{t(`settings.group.${group}` as MessageKey)}</div>
                {entries.map((e) => (
                  <ItemBoundary key={e.item.id} moduleId={e.moduleId}>
                    <NavRow entry={e} current={tab === e.item.page} />
                  </ItemBoundary>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || (target.tagName === "INPUT" && !["checkbox", "radio", "range", "button"].includes((target as HTMLInputElement).type));
}

function Highlight({ text, ranges }: { text: string; ranges: Ranges }) {
  return (
    <>
      {highlightParts(text, ranges).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-accent/20 text-foreground">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Settings search results in place of the nav: grouped by page (the page row, then its matching
 * cards); ↑ / ↓ move, Enter / click opens the page and scrolls to + flashes the card. Unavailable
 * entries show greyed with the reason.
 */
function SettingsSearchResults({ query, input, current }: { query: string; input: RefObject<HTMLInputElement | null>; current: string }) {
  const { t } = useI18n();
  const openSettings = useApp((s) => s.openSettings);
  const docs = useSettingsSearchIndex();
  // Host page results say whose settings they open (RFC §9.3) when another host could be picked.
  const scope = useHostScope();
  const settingsHost = scope.host(useSettingsHost());
  const hostSuffix = (page: string) => (settingsHost && hostPickerMode(scope, settingsHost.id) === "picker" && SETTINGS_HOST_PAGES.has(page as never) ? settingsHost.label : null);
  const groups = useMemo(() => searchSettings(docs, query), [docs, query]);
  const regions = useSlot("customize.region");
  const regionOf = (page: string) => regions.find((e) => e.mode === "show" && e.item.settingsPage === page)?.item.region;
  const rows = useMemo(() => flattenResults(groups), [groups]);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // A new query selects the first available row.
  useEffect(() => setActive(firstResult(rows)), [rows]);
  const open = (i: number) => {
    const row = rows[i];
    if (!row || row.disabled) return;
    setActive(i);
    openSettings(row.page);
    if (row.anchor) requestSettingsReveal(row.anchor);
  };
  // Keys arrive at the search box (the focus stays there).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      e.preventDefault();
      if (e.key === "Enter") return open(active);
      const step = e.key === "ArrowDown" ? 1 : -1;
      for (let i = active + step; i >= 0 && i < rows.length; i += step) {
        if (!rows[i]!.disabled) return setActive(i);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    list.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  let index = 0;
  return (
    <div ref={list} id="settings-search-results" role="listbox" aria-label={t("shell.settingsSearch.placeholder")} className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
      <div className="px-2 pb-1 text-xs text-subtle" aria-live="polite">
        {groups.length ? t("shell.settingsSearch.count", { n: resultCount(rows) }) : t("shell.settingsSearch.empty")}
      </div>
      {groups.map((g) => {
        const pageIndex = index++;
        return (
          <div key={g.page} className="mb-2">
            <ResultRow index={pageIndex} active={active === pageIndex} disabled={g.disabled} current={current === g.page} onOpen={open} onHover={setActive}>
              <span className="truncate font-medium">
                <Highlight text={g.pageTitle} ranges={g.pageRanges} />
                {hostSuffix(g.page) && <span className="font-normal text-subtle"> · {hostSuffix(g.page)}</span>}
              </span>
              {g.pageHit && g.pageHit.text !== g.pageTitle && <Detail hit={g.pageHit} />}
              {regionOf(g.page) && !g.disabled && <CustomizeButton region={regionOf(g.page)!} small />}
            </ResultRow>
            {g.sections.map((h) => {
              const i = index++;
              const title = h.doc.sectionTitle?.current ?? "";
              const inTitle = h.text === title && !h.viaOther;
              return (
                <ResultRow key={h.doc.anchor} index={i} active={active === i} disabled={h.doc.disabled} indent onOpen={open} onHover={setActive}>
                  <span className="truncate">
                    <span className="text-subtle">› </span>
                    <Highlight text={title} ranges={inTitle ? h.ranges : []} />
                  </span>
                  {!inTitle && <Detail hit={h} />}
                </ResultRow>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** The matched keyword (or English text) under a result title. */
function Detail({ hit }: { hit: SettingsSearchHit }) {
  return (
    <span className="truncate text-[11px] text-subtle">
      <Highlight text={hit.text} ranges={hit.ranges} />
    </span>
  );
}

function ResultRow({ index, active, disabled, current, indent, onOpen, onHover, children }: { index: number; active: boolean; disabled: string | null; current?: boolean; indent?: boolean; onOpen(i: number): void; onHover(i: number): void; children: ReactNode }) {
  return (
    <div
      role="option"
      aria-selected={active}
      aria-disabled={disabled ? true : undefined}
      data-row={index}
      title={disabled ?? undefined}
      onMouseDown={(e) => e.preventDefault() /* keep the focus in the search box */}
      onMouseEnter={() => !disabled && onHover(index)}
      onClick={() => onOpen(index)}
      className={`flex w-full cursor-pointer flex-col rounded-md px-2 py-1 text-left text-[13px] ${indent ? "pl-4" : ""} ${active && !disabled ? "bg-surface-2 text-foreground" : current ? "text-foreground" : "text-muted"} ${disabled ? "cursor-default opacity-50" : "hover:text-foreground"}`}
    >
      {children}
      {disabled && <span className="truncate text-[11px] text-subtle">{disabled}</span>}
    </div>
  );
}

/** The 在主界面调整 region of a settings page (`customize.region` settingsPage), if it has one. */
function useCustomizeRegionOf(page: string): CustomizeRegion | undefined {
  return useSlot("customize.region").find((e) => e.mode === "show" && e.item.settingsPage === page)?.item.region;
}

/**
 * 「在主界面调整」: closes Settings and opens the region's panel beside it (lead 2026-10-18). On a page
 * header, and `small` in a settings search result of that page.
 */
function CustomizeButton({ region, small }: { region: CustomizeRegion; small?: boolean }) {
  const { t } = useI18n();
  const open = () => {
    // The button goes away with Settings: the focus goes to the region when the panel closes.
    noteCustomizeOpener(null);
    useApp.getState().openCustomize(region);
  };
  if (small) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          open();
        }}
        className="mt-0.5 inline-flex w-fit items-center gap-1 rounded text-[11px] text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
      >
        <SlidersHorizontal size={11} aria-hidden />
        {t("customize.openInMain")}
      </button>
    );
  }
  return (
    <Button title={t("customize.openInMainHint")} onClick={open}>
      <span className="inline-flex items-center gap-1.5">
        <SlidersHorizontal size={13} aria-hidden />
        {t("customize.openInMain")}
      </span>
    </Button>
  );
}

/** The selected settings page (its nav is `SettingsNav`). */
export function Settings({ params }: { params: PageParams }) {
  const tab = settingsTab(params);
  const { t } = useI18n();
  const openSettings = useApp((s) => s.openSettings);
  const pages = useSlot("settings.page");
  const entry = pages.find((e) => e.item.page === tab && e.mode === "show");
  const headerLink = entry?.item.headerLink;
  const linked = headerLink && pages.some((e) => e.item.page === headerLink.page && e.mode === "show") ? headerLink : null;
  const customize = useCustomizeRegionOf(tab);
  // A picked host that goes offline stays the target (shown unavailable, no edits; UI-01).
  const target = useSettingsTarget();
  const hostId = target.hostId;
  const scope = useHostScope();
  const mode = hostPickerMode(scope, hostId);
  const access = useHostAccess(hostId);
  const hostLabel = scope.host(hostId)?.label ?? hostId;
  // 「全部主机」 (SettingsPageItem.allHosts): offered by the page, remembered in its module's prefs.
  const allHosts = useSettingsAllHosts(entry?.moduleId, entry && SETTINGS_HOST_PAGES.has(entry.item.page) ? entry.item.allHosts?.capability : undefined);
  // A settings search result: scroll to + flash its card once the page has rendered it.
  useSettingsReveal();
  if (!entry) {
    return (
      <main className="flex min-w-0 flex-1">
        <PageBody>
          <Section>
            <EmptyState action={<Button onClick={() => openSettings("modules")}>{t("modules.openModules")}</Button>}>{t("modules.pageOff")}</EmptyState>
          </Section>
        </PageBody>
      </main>
    );
  }
  const { item } = entry;
  const Page = item.Page;
  const hostPage = SETTINGS_HOST_PAGES.has(item.page) && (item.source === "host" || item.source === "codex");
  // Another page, sub-page (Profile detail / 添加) or host opens at the top, not at the last page's offset.
  const scrollKey = [tab, hostPage ? hostId : "", params.profile ?? "", params.create ?? ""].join("|");
  return (
    <main className="flex min-w-0 flex-1">
      <PageBody
        scrollKey={scrollKey}
        aside={
          item.Aside ? (
            <ItemBoundary moduleId={entry.moduleId} resetKey={tab}>
              <item.Aside />
            </ItemBoundary>
          ) : undefined
        }
      >
        <TargetHostContext.Provider value={hostPage ? hostId : null}>
          <AllHostsContext.Provider value={hostPage && allHosts.on ? allHosts.offered : null}>
            {/* A page per host: switching hosts starts the page over (no state of one host shown for another). */}
            <SettingsPage
              key={hostPage ? `${tab}|${allHosts.on ? "*" : hostId}` : tab}
              source={item.source ?? undefined}
              agents={item.agents}
              hint={item.hintKey ? t(item.hintKey) : undefined}
              link={
                linked || customize ? (
                  <span className="flex items-center gap-3">
                    {linked && <TextLink onClick={() => openSettings(linked.page)}>{t(linked.labelKey)}</TextLink>}
                    {customize && <CustomizeButton region={customize} />}
                  </span>
                ) : undefined
              }
              host={
                hostPage && mode !== "none" ? (
                  <HostPicker
                    chip
                    value={hostId}
                    onChange={(id) => {
                      if (allHosts.on) allHosts.set(false);
                      setSettingsHost(id);
                    }}
                    mode={mode}
                    title={t("hostPicker.settingsTitle")}
                    all={allHosts.offered ? { label: t("hostPicker.allHosts"), hint: t("hostPicker.allHostsCount", { n: allHosts.offered.hostIds.length }), selected: allHosts.on, onSelect: () => allHosts.set(true) } : undefined}
                  />
                ) : undefined
              }
            >
              {hostPage && !access.isOwner && !SETTINGS_MEMBER_PAGES.has(item.page) ? (
                // users: host settings are the host owner's; this device is another user (or pending) there.
                <Section>
                  <EmptyState>{t(access.pending ? "users.access.pendingSettings" : "users.access.notOwnerSettings", { host: hostLabel })}</EmptyState>
                </Section>
              ) : (
                <ItemBoundary moduleId={entry.moduleId} resetKey={`${tab}|${hostId}`}>
                  {hostPage && !allHosts.on ? (
                    <SettingsHostFrame target={target}>
                      <Page />
                    </SettingsHostFrame>
                  ) : (
                    <Page />
                  )}
                </ItemBoundary>
              )}
            </SettingsPage>
          </AllHostsContext.Provider>
        </TargetHostContext.Provider>
      </PageBody>
    </main>
  );
}
