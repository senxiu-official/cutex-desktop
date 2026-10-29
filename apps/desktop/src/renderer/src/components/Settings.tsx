import { isImeComposing } from "../lib/ime";
// Settings page (DESIGN §4.5; layout per docs/research/settings-audit-20261008.md): grouped left
// nav (this machine → connection → the connected host); every page starts with a source tag saying
// where its settings live (本机 / 主机 · name / codex 配置 · name). Pages are `settings.page` items
// contributed by modules (docs/desktop-modules.md §9 step 1); this file owns only the group order
// and the outlets. Settings itself is the shell's `main.page` item `shell.settings` (params.tab), with
// SettingsNav as its Aside. Multi-host (P1 step 2c, RFC §9.3): host pages get a host picker in their
// header (lib/settingsHost) and read / write that host (lib/targetHost provider).
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { preloadOnIntent } from "../lib/lazyPage";
import { ArrowLeft, Check, Search, SlidersHorizontal, X } from "lucide-react";
import { bridge } from "../bridge";
import { useI18n, type MessageKey } from "../i18n";
import { resetDragonSize } from "../lib/aboutDragon";
import { settingsNavGroups, settingsTab } from "../lib/settingsNav";
import { firstResult, flattenResults, highlightParts, resultCount, searchSettings, type Ranges, type SettingsSearchHit } from "../lib/settingsSearch";
import { requestSettingsReveal, useSettingsReveal, useSettingsSearchIndex } from "../lib/settingsSearchView";
import { profileSearchAnchor } from "../lib/settingsProfileSearch";
import { en as searchEn, zhCN as searchZh } from "../lib/settingsSearchIaMessages";
import { hostPickerMode } from "../lib/hostPick";
import { AllHostsContext, SETTINGS_HOST_PAGES, SETTINGS_MEMBER_PAGES, setSettingsHost, useSettingsHost, useSettingsTarget } from "../lib/settingsHost";
import { useSettingsAllHosts } from "../lib/settingsAllHosts";
import { TargetHostContext } from "../lib/targetHost";
import { useHostAccess } from "../lib/hostAccess";
import { useHostScope } from "../lib/useHostScope";
import { isSettingsHostPage, settingsPageHasHostPicker } from "../lib/settingsGate";
import { HostPicker } from "./HostPicker";
import { SettingsHostFrame } from "./SettingsHostFrame";
import { ItemBoundary } from "../modules/Outlet";
import { useSlot } from "../modules/react";
import type { AppSlotEntry, PageParams } from "../modules/slots";
import { useApp, type SettingsTab } from "../store";
import { noteCustomizeOpener, type CustomizeRegion } from "../lib/customize";
import { holdPageBody, PageBody, SUBNAV_ITEM, SUBNAV_OFF, SUBNAV_ON } from "./Page";
import { BackLink, EmptyState, Button, Section, SettingsPage, TextLink } from "./settings/Form";
import { Tag } from "./Tag";
import { keyVar, matchesCommand } from "../lib/keybindings";
import { isHTMLElement } from "../lib/ownerWindow";
import { useOwnerWindow } from "../lib/ownerContext";

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
      onClick={() => {
        // Hold the current page until the next one is ready (no building up card by card).
        if (!current) holdPageBody();
        openSettings(item.page);
      }}
      className={`${SUBNAV_ITEM} ${current ? SUBNAV_ON : SUBNAV_OFF} ${disabled && !current ? "opacity-60" : ""} focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none`}
    >
      <Icon size={15} strokeWidth={1.75} className="shrink-0" />
      <span className="truncate">{t(item.titleKey)}</span>
      {badge?.dot && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-label={t("settings.about.attention")} />}
      {badge?.text && <Tag className="ml-auto">{badge.text}</Tag>}
    </button>
  );
}

/**
 * Settings nav, the full window height (App puts it left of the title bar): it replaces the app
 * sidebar and its title-bar row (host switcher, sidebar toggle), so 返回 is its first row, level
 * with the breadcrumb. The top row is a window drag region; on macOS it clears the traffic lights.
 */
export function SettingsNav({ params }: { params: PageParams }) {
  const win = useOwnerWindow();
  const tab = settingsTab(params);
  // The other Settings pages load in idle time once Settings is open (lib/lazyPage): switching to one is instant.
  useEffect(() => void preloadOnIntent(), []);
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
      if (isImeComposing(e)) return;
      if (!matchesCommand("settingsSearch", e)) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
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
          title={t("shell.settingsSearch.title", keyVar("settingsSearch", " · "))}
          placeholder={t("shell.settingsSearch.placeholder")}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (query) setQuery("");
              else e.currentTarget.blur();
            }
          }}
          className="w-full rounded-md border border-border bg-background py-1 pr-6 pl-7 text-ui/[inherit] outline-none select-text placeholder:text-subtle focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 [&::-webkit-search-cancel-button]:hidden"
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
          {settingsNavGroups(pages).map(({ group, entries }) => {
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

export function isTextTarget(target: EventTarget | null): boolean {
  if (!isHTMLElement(target)) return false;
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
export function SettingsSearchResults({ query, input, current, onNavigate }: { query: string; input: RefObject<HTMLInputElement | null>; current: string; /** Shelf replaces results with the destination page after a valid selection. */ onNavigate?(): void }) {
  const { t } = useI18n();
  const openSettings = useApp((s) => s.openSettings);
  const docs = useSettingsSearchIndex();
  // Host page results say whose settings they open (RFC §9.3) when another host could be picked.
  const scope = useHostScope();
  const settingsHost = scope.host(useSettingsHost());
  const hostSuffix = (page: string) => (settingsHost && hostPickerMode(scope, settingsHost.id) === "picker" && SETTINGS_HOST_PAGES.has(page as never) ? settingsHost.label : null);
  const groups = useMemo(() => searchSettings(docs, query), [docs, query]);
  const stopIdleHelp = searchSettings([{
    page: "general", pageOrder: 0, pageTitle: { current: "", other: "" }, anchor: null, sectionTitle: null, disabled: null,
    keywords: [{ current: searchZh["settings.searchIa.stopIdleKeywords"], other: searchEn["settings.searchIa.stopIdleKeywords"] }],
  }], query).length > 0;
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
    const profileAnchor = row.page === "profiles" ? profileSearchAnchor(row.anchor) : null;
    openSettings(row.page, profileAnchor ? { anchor: profileAnchor } : undefined);
    if (row.anchor && !profileAnchor) requestSettingsReveal(row.anchor);
    onNavigate?.();
  };
  // Keys arrive at the search box (the focus stays there).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
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
        {groups.length ? t("shell.settingsSearch.count", { n: resultCount(rows) }) : stopIdleHelp ? null : t("shell.settingsSearch.empty")}
      </div>
      {stopIdleHelp && <div role="note" className="mb-3 rounded-md border border-edge px-2 py-2 text-xs text-muted">
        <p className="font-medium text-foreground">{t("settings.searchIa.stopIdle" as MessageKey)}</p>
        <p className="mt-1">{t("settings.searchIa.stopIdleHelp" as MessageKey)}</p>
      </div>}
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
              {regionOf(g.page) && !g.disabled && <CustomizeButton region={regionOf(g.page)!} page={g.page as SettingsTab} small />}
            </ResultRow>
            {g.sections.map((h) => {
              const i = index++;
              const title = h.doc.sectionTitle?.current ?? "";
              const inTitle = h.text === title && !h.viaOther;
              return (
                <ResultRow key={h.doc.anchor} index={i} active={active === i} disabled={h.doc.disabled} indent onOpen={open} onHover={setActive}>
                  <span className="truncate">
                    <span className="text-subtle">› </span>
                    {g.page === "profiles" && profileSearchAnchor(h.doc.anchor)
                      ? t("settings.searchIa.profilePath" as MessageKey, { section: title })
                      : <Highlight text={title} ranges={inTitle ? h.ranges : []} />}
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
    <span className="truncate text-caption/[inherit] text-subtle">
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
      className={`flex w-full cursor-pointer flex-col rounded-md px-2 py-1 text-left text-ui/[inherit] ${indent ? "pl-4" : ""} ${active && !disabled ? "bg-surface-2 text-foreground" : current ? "text-foreground" : "text-muted"} ${disabled ? "cursor-default opacity-50" : "hover:text-foreground"}`}
    >
      {children}
      {disabled && <span className="truncate text-caption/[inherit] text-subtle">{disabled}</span>}
    </div>
  );
}

/** The 在主界面调整 region of a settings page (`customize.region` settingsPage), if it has one. */
function useCustomizeRegionOf(page: string): CustomizeRegion | undefined {
  return useSlot("customize.region").find((e) => e.mode === "show" && e.item.settingsPage === page)?.item.region;
}

/**
 * 「在主界面调整」 (owner 2026-10-21): the region of the real UI goes into edit state beside the Settings
 * Shelf, which stays open on the region's page (`page`); while it is being edited the header button
 * finishes (完成调整). On a page header, and `small` in a settings search result of that page.
 */
function CustomizeButton({ region, page, small }: { region: CustomizeRegion; page: SettingsTab; small?: boolean }) {
  const { t } = useI18n();
  const editing = useApp((s) => s.customize?.region === region);
  const open = (e: { currentTarget: Element }) => {
    // Finishing returns the focus here (the button stays, the Settings Shelf stays open).
    noteCustomizeOpener(e.currentTarget);
    useApp.getState().openCustomize(region, page);
  };
  if (small) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          open(e);
        }}
        className="mt-0.5 inline-flex w-fit items-center gap-1 rounded text-caption/[inherit] text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
      >
        <SlidersHorizontal size={11} aria-hidden />
        {t("customize.openInMain")}
      </button>
    );
  }
  return (
    <Button title={t(editing ? "customize.doneTip" : "customize.editInMainHint")} onClick={open}>
      <span className="inline-flex items-center gap-1.5">
        {editing ? <Check size={13} aria-hidden /> : <SlidersHorizontal size={13} aria-hidden />}
        {t(editing ? "customize.finish" : "customize.openInMain")}
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
  const backLink = entry?.item.backLink;
  const back = backLink && pages.some((e) => e.item.page === backLink.page && e.mode === "show") ? backLink : null;
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
  const hostPage = isSettingsHostPage(item);
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
              page={tab}
              hint={item.hintKey ? t(item.hintKey) : undefined}
              back={back ? <BackLink onClick={() => openSettings(back.page)}>{t(back.labelKey)}</BackLink> : undefined}
              link={
                linked || customize ? (
                  <span className="flex items-center gap-3">
                    {linked && <TextLink onClick={() => openSettings(linked.page)}>{t(linked.labelKey)}</TextLink>}
                    {customize && <CustomizeButton region={customize} page={tab} />}
                  </span>
                ) : undefined
              }
              host={
                settingsPageHasHostPicker(item) && mode !== "none" ? (
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
