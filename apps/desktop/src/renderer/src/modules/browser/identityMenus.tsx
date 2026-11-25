// 浏览器身份 menus (design browser-profiles v3 §2): the switcher's list, the ＋▾ choices and the tab menu's
// 「用其他身份打开…». Plain builders (no components here, so the component files keep Fast Refresh).
import { History, Music, Plus, Settings2, Users } from "lucide-react";
import { bgplayApplies, isBgplay, setBgplay } from "./bgplay";
import type { MenuEntry } from "../../lib/contextMenu";
import { translate } from "../../i18n";
import { useApp } from "../../store";
import type { Json } from "../types";
import type { SideInstanceInfo } from "../slots";
import type { BrowserIdentityView } from "../../../../shared/browserIdentity";
import { browserCache } from "./browserCache";
import type { BrowserState } from "./browserState";
import { identityRequest, useBrowserIdentities, useIdentityPage } from "./identities";
import { openSide } from "../../lib/sideOpen";
import { IdentityBadge } from "./IdentityBadge";

const ICON = 14;
const list = (): BrowserIdentityView[] => useBrowserIdentities.getState().state?.identities ?? [];
const tabsHint = (view: BrowserIdentityView) => translate("browser.identity.tabs", { n: view.openTabs });

export const openIdentitySettings = () => useApp.getState().openSettings("browser", { anchor: "browser-identities" });

/** Settings → 浏览器 → one identity's page. */
export function openIdentityPage(id: string): void {
  useIdentityPage.setState({ id });
  useApp.getState().openSettings("browser", { sub: "identity" });
}

/** Settings → 浏览器 → 已保存的密码 of an identity. */
export function openIdentityPasswords(id: string): void {
  useIdentityPage.setState({ id });
  useApp.getState().openSettings("browser", { sub: "passwords" });
}

/** 浏览历史 of an identity: a tab on 「我的浏览器」 (a host-bound open goes to the fixed page). */
export function openIdentityHistory(id: string, hostId?: string): void {
  openSide("browser.history", { identityId: id }, { focus: true, reveal: true, ...(hostId ? { binding: { kind: "host" as const, hostId } } : {}) });
}

/** The switcher's menu: every identity (✓ the current one, its open tabs), then 新建… and 管理. */
export function switcherMenu(onNew: () => void): MenuEntry[] {
  const current = useBrowserIdentities.getState().state?.current;
  return [
    ...list().map((view) => ({
      label: view.name,
      icon: <IdentityBadge view={view} size={16} />,
      hint: view.id === current ? `✓ ${tabsHint(view)}` : tabsHint(view),
      onSelect: () => void identityRequest((ids) => ids.setCurrent(view.id)).catch(() => {}),
    })),
    "separator",
    { label: translate("browser.history.title"), icon: <History size={ICON} />, onSelect: () => openIdentityHistory(current ?? "default") },
    { label: translate("browser.identity.new"), icon: <Plus size={ICON} />, onSelect: onNew },
    { label: translate("browser.identity.manage"), icon: <Settings2 size={ICON} />, onSelect: () => openIdentitySettings() },
  ];
}

/** ＋▾: a new blank tab in any identity, without changing the switcher's current one. */
export function newTabMenu(newTab: (params: Json) => void): MenuEntry[] {
  const current = useBrowserIdentities.getState().state?.current;
  return list().map((view) => ({
    label: view.name,
    icon: <IdentityBadge view={view} size={16} />,
    hint: view.id === current ? translate("browser.identity.current") : "",
    onSelect: () => newTab({ url: "about:blank", browserIdentityId: view.id }),
  }));
}

function bgplayItem(hostId: string, tabKey: string): MenuEntry {
  const on = isBgplay(hostId, tabKey);
  return { label: translate("browser.bgplay.label"), icon: <Music size={ICON} />, hint: on ? "✓" : "", info: translate("browser.bgplay.tip"), onSelect: () => setBgplay(hostId, tabKey, !on) };
}

/** The tab menu's 「用其他身份打开…」: the same address in another identity (an owner tab; several identities). */
export function browserTabMenu(instance: SideInstanceInfo<BrowserState>, ctx: { hostId: string | null; newTab(params: Json): void }): MenuEntry[] {
  const state = instance.state;
  const view = ctx.hostId ? browserCache.get(ctx.hostId, state.tabKey) : undefined;
  if (state.agentOpened || view?.pool === "agent") return [];
  // 后台播放 (D2): this tab keeps playing when it is not on screen.
  const bg: MenuEntry[] = ctx.hostId && bgplayApplies(view, state.url) ? [bgplayItem(ctx.hostId, state.tabKey)] : [];
  const all = list();
  if (all.length < 2) return bg;
  const own = view?.browserIdentityId ?? "default";
  const url = view?.url ?? state.url;
  return [...bg, {
    label: translate("browser.identity.openInOther"),
    icon: <Users size={ICON} />,
    onSelect: () => {},
    submenu: all.filter((i) => i.id !== own).map((i) => ({
      label: i.name, icon: <IdentityBadge view={i} size={16} />, onSelect: () => ctx.newTab({ url, browserIdentityId: i.id }),
    })),
  }];
}
