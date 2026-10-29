// The window bar (DESIGN §4.13; owner 2026-10-21 header split, variant A — prototype
// .claude/preview-design-v1.html §1): only what belongs to the whole window. Left: the agent-list toggle
// (the logo; Ctrl/⌘+B) + host scope (components/HostSwitcher.tsx), then the app's entries (sidebar v5, design 040
// §4.1: a divider + flat icons — 新建智能体, 快速启动, 委托, 审批, 显示桌面 (owner 2026-10-23, components/ShowDesktopButton), ⋯;
// components/SidebarNav TitleBarEntries). Middle: the open page's breadcrumb (PageTitle) and the search field
// (`window.search`, contract 1.19 §26: ⌘K quick switcher). Right: the launcher bar — pinned launchers, ＋ (new / layout / {{shelf}} menu), the side
// toggle (components/side/TitleBarLaunchers) — + window controls. Everything about a conversation (agent,
// role, project, state, host · cwd · branch) is in that conversation column's own header
// (components/ConversationHeader.tsx), so two columns side by side each show their own.
// Windows keeps native caption buttons (titleBarOverlay, recolored to the theme); macOS keeps the
// traffic lights; Linux gets drawn buttons.
import { useEffect, useMemo } from "react";
import { LayoutDashboard, PanelLeft, PanelLeftClose, RotateCcw, Search, X } from "lucide-react";
import { openMenuFrom } from "../lib/contextMenu";
import { resetWindowLayout } from "../lib/layoutReset";
import { bridge } from "../bridge";
import { captionColors } from "../../../shared/windowChrome";
import { useI18n } from "../i18n";
import { toggleSidebarRail } from "../lib/prefs";
import { useOpenPage, useSlot } from "../modules/react";
import type { AppSlotEntry } from "../modules/slots";
import { useApp } from "../store";
import { PageTitle } from "./PageTitle";
import { CaptionSpace, LinuxControls } from "./WindowControls";
import { TitleBarLaunchers } from "./side/TitleBarLaunchers";
import cutexLogo from "../assets/cutex-logo-64.png";
import { HostSwitcher } from "./HostSwitcher";
import { TitleBarEntries } from "./SidebarNav";
import { RestoreChip } from "./RestoreBanner";
import { toggleSettingsFromNav } from "../lib/openSettings";
import { matchesCommand } from "../lib/keybindings";
import { useBindingLabel, withKey } from "../lib/useKeybindings";
import { appSchemeNow } from "../lib/theme";
import { useOwnerWindow } from "../lib/ownerContext";
import { useSidebarCollapsed, useSidebarPeek } from "../lib/windowSidebar";
import { createPeekRest } from "../lib/sidebarPeek";
import { useWindowKey } from "../lib/windowScope";
import { IdentityChip } from "./IdentityMenu";

const win = bridge.window;
const NO_DRAG = "[app-region:no-drag]";
const ICON_BTN = `${NO_DRAG} rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground`;

/**
 * Keep the native window in the app's colours (theme and palette can change at runtime): the Windows
 * caption buttons' symbols (their fill is transparent: the window bar shows through, shared/windowChrome), and on every platform the window background main paints before the page (no flash of
 * the default colour at the next start with 宣纸 / 暮色 …).
 */
function useChromeColors() {
  const ownerWin = useOwnerWindow();
  useEffect(() => {
    if (!win) return;
    const sync = () => {
      const css = getComputedStyle(document.documentElement);
      const color = css.getPropertyValue("--win").trim();
      // Windows: the caption buttons' fill stays transparent, only the symbols follow the theme (docs/design/029).
      if (color && win.nativeControls === "right") void win.setChrome(captionColors({ fg: css.getPropertyValue("--fg"), win: color }));
      if (color) void win.setBackground?.(color);
      // cutex's own pages in the in-app browser follow the app's light / dark (main/appScheme).
      void win.setScheme?.(appSchemeNow());
    };
    sync();
    const media = ownerWin.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-light-palette", "data-dark-palette"] });
    return () => {
      media.removeEventListener("change", sync);
      observer.disconnect();
    };
  }, []);
}

/** The search field in the middle of the window bar: the first shown `window.search` item (§26). */
function WindowSearch() {
  const entry = useSlot("window.search").find((e) => e.mode === "show");
  return entry ? <SearchField key={entry.item.id} entry={entry} /> : null;
}

function SearchField({ entry }: { entry: AppSlotEntry<"window.search"> }) {
  const { t } = useI18n();
  const item = entry.item;
  const text = t(item.placeholderKey);
  const keys = item.keys?.() ?? "";
  return (
    <button
      onClick={() => item.open()}
      title={keys ? `${text} (${keys})` : text}
      aria-label={text}
      data-window-bar="search"
      className={`${NO_DRAG} titlebar-capsule flex h-7 w-[340px] max-w-full min-w-[120px] shrink items-center gap-2 rounded-ctl bg-surface-2 pr-2 pl-2.5 text-ui/[inherit] text-subtle hover:bg-[color-mix(in_srgb,var(--fg)_9%,var(--surface-2))]`}
    >
      <Search size={14} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{text}</span>
      {keys && <kbd className="shrink-0 rounded border border-border px-1 font-mono text-caption/[inherit] leading-[15px] text-subtle">{keys}</kbd>}
    </button>
  );
}

/** 窗口布局 (checklist #4): the window's layout menu — 恢复默认布局 (undoable once, lib/layoutReset). */
function LayoutMenuButton() {
  const { t } = useI18n();
  return (
    <button
      data-window-layout=""
      title={t("layout.menu")}
      aria-label={t("layout.menu")}
      aria-haspopup="menu"
      onClick={(e) => openMenuFrom(e.currentTarget, [{ label: t("layout.reset"), icon: <RotateCcw size={14} />, title: t("layout.resetHint"), onSelect: resetWindowLayout }], { owner: "window-layout" })}
      className={ICON_BTN}
    >
      <LayoutDashboard size={16} />
    </button>
  );
}

export function TitleBar() {
  const ownerWin = useOwnerWindow();
  const { t } = useI18n();
  // Collapsed = fully hidden with the left-edge pop-out (Ctrl/⌘+B; this window's own choice,
  // lib/windowSidebar useSidebarCollapsed). Hovering the logo pops it out without pinning it.
  const sidebarOpen = !useSidebarCollapsed();
  const peek = useSidebarPeek.of(useWindowKey());
  const logoRest = useMemo(() => createPeekRest(() => peek.setState({ popped: true })), [peek]);
  // A full-window page (设置) brings its own nav (Aside): no sidebar toggle / host row; a close button.
  const fullWindow = !!useOpenPage()?.entry?.item.Aside;
  const closePage = useApp((s) => s.closePage);
  useChromeColors();
  const sidebarKey = useBindingLabel("sidebar");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesCommand("sidebar", e)) {
        e.preventDefault();
        toggleSidebarRail();
      } else if (matchesCommand("settings", e)) {
        // Settings (also the identity menu's first item and the sidebar footer ⚙): toggles the Settings Shelf.
        e.preventDefault();
        toggleSettingsFromNav();
      }
    };
    ownerWin.addEventListener("keydown", onKey);
    return () => ownerWin.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header
      data-window-titlebar=""
      className="flex h-10 shrink-0 items-stretch bg-transparent select-none [app-region:drag]"
      onDoubleClick={(e) => win?.nativeControls === null && e.target === e.currentTarget && void win.control("toggleMaximize")}
    >
      {!fullWindow && (
        <div data-window-bar="scope" className={`flex min-w-0 shrink-0 items-center gap-1 px-2 ${sidebarOpen ? "max-w-[calc(100%-360px)] min-w-[max(180px,var(--sidebar-w,16rem))]" : ""} ${win?.nativeControls === "left" ? "pl-[76px]" : ""}`}>
          <div className="titlebar-capsule flex h-8 min-w-0 items-center gap-1 px-1">
            {/* The logo is the sidebar toggle; hover / keyboard focus shows the panel icon instead. */}
            <button
              onClick={toggleSidebarRail}
              onMouseEnter={() => sidebarOpen || logoRest.enter()}
              onMouseLeave={() => logoRest.leave()}
              onFocus={() => sidebarOpen || logoRest.enter()}
              onBlur={() => logoRest.leave()}
              title={withKey(t(sidebarOpen ? "titlebar.hideSidebar" : "titlebar.showSidebar"), sidebarKey)}
              aria-label={t(sidebarOpen ? "titlebar.hideSidebar" : "titlebar.showSidebar")}
              aria-expanded={sidebarOpen}
              className={`${ICON_BTN} group/logo relative shrink-0`}
            >
              <img src={cutexLogo} alt="" draggable={false} className="h-4 w-4 group-hover/logo:invisible group-focus-visible/logo:invisible" />
              <span className="invisible absolute inset-0 flex items-center justify-center group-hover/logo:visible group-focus-visible/logo:visible">
                {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
              </span>
            </button>
            <HostSwitcher />
            <TitleBarEntries btn={ICON_BTN} />
            {/* The sidebar's restore notice, as a chip while the sidebar is collapsed (UI review #11). */}
            {!sidebarOpen && <RestoreChip />}
          </div>
        </div>
      )}
      {/* A full-window page's breadcrumb (other pages carry theirs in their own header: a Shelf pane's, or
          components/PageHeader over the conversation column — §26), then the search field centred in what is left. */}
      <div data-titlebar-title className="flex min-w-0 flex-1 items-center gap-2 px-3">
        {fullWindow && (
          <div data-window-bar="page" className="titlebar-capsule flex h-8 min-w-0 shrink items-center px-2">
            <PageTitle />
          </div>
        )}
        <span className="min-w-0 flex-1" />
        <WindowSearch />
        <span className="min-w-0 flex-1" />
      </div>
      <div data-window-bar="actions" className="flex shrink-0 items-center gap-0.5 pr-2">
        <div className="titlebar-capsule flex h-8 items-center gap-0.5 px-1">
          {!fullWindow && <LayoutMenuButton />}
          {!fullWindow && <TitleBarLaunchers />}
          {fullWindow && (
            <button onClick={closePage} title={t("settings.close")} className={ICON_BTN}>
              <X size={16} />
            </button>
          )}
        </div>
        {/* The sidebar hidden: its footer's identity / settings / update live in this far-right chip (④),
            outside the capsule — an avatar, not one of the button groups. */}
        {!fullWindow && !sidebarOpen && <IdentityChip />}
        <LinuxControls />
      </div>
      {/* Space under the native Windows caption buttons (3 × 46px). */}
      <CaptionSpace />
    </header>
  );
}
