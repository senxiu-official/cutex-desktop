// 桌面 (home page; docs/research/home-page-20261019.md, panes-20261019.md §5, docs/desktop-modules.md §25):
// the desktop layer behind the panes (`pane.desktop`) with the tray's shortcuts (its Dock: the same pins as
// the tiles, contract 1.20), the 个人页 pane (`pane.kind` home.profile), the
// 「桌面」 entry at the top of the sidebar (a lead `nav.primary` entry = 显示桌面, shown while the setting
// is on) and 钉到托盘 / 取消固定 (the tray's pins; the desktop's icons are their own list, model.ts) on agents, services, artifacts and browser tabs (`ref.action`). The home
// settings live on the host (cutex `user-home`, revision-checked; store.ts), else on this device.
// Modules pin their own pages through lib/trayPins (kind `page`, `<pageId>:<argument>`; only where the source
// host has `user-home-page-pins` or the list lives on this device) and draw / open them via lib/pagePins.
import { Monitor, Pin, UserRound } from "lucide-react";
import { USER_HOME_FEATURE, type HomeDoc, type HomePin } from "../../../../shared/home";
import { hostData } from "../../lib/hostScope";
import { revealDesktop, useDesktopRestorable, useDesktopShown } from "../../lib/paneActions";
import type { MessageKey } from "../../i18n";
import { translate } from "../../i18n";
import { useApp } from "../../store";
import { services } from "../app";
import { defineModule } from "../slots";
import type { Json } from "../types";
import { pinnedNow, pinOnSource, togglePin, togglePinOfRef, unpinOnSource } from "./actions";
import { pickerMenu } from "./Tiles";
import { setTrayPins, type TrayPinRef } from "../../lib/trayPins";
import { DesktopLayer } from "./Desktop";
import { HOME_WIDGETS } from "./widgets";
import { HomeDock } from "./Dock";
import { initDockModes } from "./dockModes";
import { featuresOf, homeSourceNow, useDockCount, useHomeSource } from "./hooks";
import { isPinned, pagePinsKept, PIN_REF_KINDS, pinOfRef, showWhenEmpty, sidebarEntry } from "./model";
import { PROFILE_KIND } from "./open";
import { ProfileBody, useProfileTitle, type ProfileState } from "./Profile";
import { createHomeStore, homeStore, setHomeStore } from "./store";
import { nextAfterClose } from "./trayNext";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const HomeDesktopSettings = lazyPage(() => import("./DesktopSettings").then((m) => m.HomeDesktopSettings));

function useShowWhenEmpty(): boolean {
  return showWhenEmpty(useHomeSource().entry?.doc ?? null);
}

function useSidebarEntryShown(): boolean {
  return sidebarEntry(useHomeSource().entry?.doc ?? null);
}

/** The 「桌面」 entry is lit while the desktop shows (显示桌面, or nothing open and the setting on). */
function useDesktopActive(): boolean {
  const shown = useDesktopShown();
  const empty = useApp((s) => !s.selectedId && s.view.kind !== "page");
  const when = useShowWhenEmpty();
  return shown || (empty && when);
}

/** While 桌面 shows and there is a layout to put back: its click does that (the tooltip says so). */
function useDesktopHint(): MessageKey | null {
  return useDesktopRestorable() ? "home.navRestoreHint" : null;
}

function usePinState(ref: Parameters<typeof pinOfRef>[0]) {
  const pin = pinOfRef(ref);
  const doc = useHomeSource().entry?.doc ?? null;
  if (!pin) return { disabledReason: translate("home.picker.none") };
  return isPinned(doc, pin) ? { active: true, titleKey: "home.unpin" as const } : null;
}

export default defineModule({
  id: "home",
  titleKey: "home.title",
  descriptionKey: "home.description",
  contributes: {
    // Settings → 桌面 (design 006 v1): the home's own content is edited on the desktop (编辑主页); this card says so and opens it.
    "settings.section": [{ id: "home.desktopSettings", page: "desktop", order: 100, titleKey: "home.settings.title", keywords: ["home.settings.hint", "home.edit"], Section: HomeDesktopSettings }],
    // Contract 1.22 (design 032): the desktop's built-in widgets — 名片, 时钟, 需要你, 用量, the pinned tiles.
    "desktop.widget": HOME_WIDGETS,
    "pane.desktop": [{ id: "home.desktop", Desktop: DesktopLayer, useShowWhenEmpty, Dock: HomeDock, useDockCount }],
    "pane.kind": [
      {
        id: PROFILE_KIND,
        titleKey: "home.profile",
        icon: UserRound,
        instances: "single",
        binding: "none",
        parseParams: () => ({}),
        init: (): ProfileState => ({}),
        restore: (): ProfileState => ({}),
        useTitle: useProfileTitle,
        Body: ProfileBody,
        minSize: { w: 360, h: 320 },
      },
    ],
    "nav.primary": [{ id: "home.nav", order: 10, icon: Monitor, titleKey: "home.nav", target: { run: revealDesktop }, useHint: useDesktopHint, lead: true, useShown: useSidebarEntryShown, useActive: useDesktopActive }],
    "ref.action": [{ id: "home.pin", order: 50, kinds: PIN_REF_KINDS, icon: Pin, titleKey: "home.pinShared", useState: usePinState, run: (ref) => togglePinOfRef(ref) }],
  },
  activate: (ctx) => {
    // Hosts with `user-home` keep the document; others (older cutex) → this device (module prefs).
    const LOCAL = "local";
    // The tray's 打开方式 per pin: this device's choice.
    initDockModes(
      () => (ctx.signal.aborted ? null : ctx.prefs.get("dockOpenModes", null)),
      (modes) => !ctx.signal.aborted && ctx.prefs.set("dockOpenModes", JSON.parse(JSON.stringify(modes)) as Json),
    );
    setHomeStore(
      createHomeStore({
        backend: (hostId) => {
          const f = hostData(useApp.getState(), hostId);
          if (!f || f.daemon.kind !== "connected" || !f.featuresKnown || !f.features.has(USER_HOME_FEATURE)) return null;
          const api = services.daemonFor(hostId);
          return { get: () => api.userHome(), put: (revision, home) => api.putUserHome(revision, home) };
        },
        local: {
          read: () => {
            if (ctx.signal.aborted) return null;
            const raw = ctx.prefs.get(LOCAL, null);
            return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as HomeDoc) : null;
          },
          write: (doc) => ctx.prefs.set(LOCAL, JSON.parse(JSON.stringify(doc)) as Json),
        },
      }),
    );
    // The shell's handle on the shared pin list (lib/trayPins: 断开 on a linked service pane pins the service;
    // a module's page, e.g. a project's overview, as kind `page`).
    const pinOf = (r: TrayPinRef): HomePin => ({ hostId: r.hostId, kind: r.kind, key: r.key, ...(r.title ? { title: r.title.slice(0, 200) } : {}) });
    const supports = (kind: TrayPinRef["kind"]) => kind !== "page" || pagePinsKept(featuresOf(useApp.getState(), homeSourceNow()));
    setTrayPins({
      isPinned: (r) => pinnedNow(pinOf(r)),
      pin: (r) => (supports(r.kind) ? pinOnSource(pinOf(r)) : Promise.resolve(false)),
      unpin: (r) => unpinOnSource(pinOf(r)),
      supports,
      subscribe: (listener) => homeStore().store.subscribe(listener),
      // 「＋ 固定」 on the empty tray: the desktop's picker, pinning into the source host's list.
      pickerEntries: () => pickerMenu({ isPinned: pinnedNow, add: (pin) => void togglePin(pin) }, translate),
      // Closing the last workspace on screen: the tray's next entry takes its place (trayNext).
      nextAfterClose,
    });
    ctx.signal.addEventListener("abort", () => setTrayPins(null), { once: true });
  },
});
