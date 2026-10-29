// Sidebar bottom left: who you are on the focus host — `[avatar] name` (+ 只读 / 等主人分配 when this
// connection cannot do everything a user can; lib/identity roleWords) — and a menu: 设置, 用量 ▸, 语言 ▸, 外观 ▸, 帮助与文档, 检查更新, 打开日志文件夹, 退出 Cutex.
// Name / picture are 「你」 (lib/identityPrefs, Settings → 用户), published to hosts with cutex
// `users-self-profile`; without a local one, what the host has for you (`/v2/capabilities` `user`:
// displayName / avatar, set from another desktop of yours; on an older host a member's cutex name);
// the initials' color is the cutex user color where it can be read (the owner: `/v2/users`), else a
// neutral grey. Narrow sidebar: the avatar only (tooltip).
import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, ChevronsUpDown, FolderOpen, Gauge, Languages, LogOut, Palette, RefreshCw, Settings } from "lucide-react";
import { api, bridge } from "../bridge";
import { useI18n, type MessageKey } from "../i18n";
import { openMenuAbove, openMenuFrom, useMenuOwner, type MenuEntry } from "../lib/contextMenu";
import { identityInitials } from "../lib/identity";
import { useIdentity, useShellInfo, type Identity } from "../lib/identityView";
import { LANGUAGES, isTraditionalLocale, traditionalRegionOf, traditionalLocale } from "../lib/languages";
import { applyTheme, loadTheme, type ThemePref } from "../lib/theme";
import { updateButtonVisible, useUpdateStatus } from "../lib/update";
import { openSettingsFromNav } from "../lib/openSettings";
import { prepareUsage } from "../lib/usagePreparation";
import { useApp } from "../store";
import { Avatar } from "./Avatar";
import { UsageFlyout } from "./UsageFlyout";
import { bindingLabel } from "../lib/keybindings";
import { useOwnerDocument } from "../lib/ownerContext";

const MENU_OWNER = "identity";
function IdentityAvatar({ identity, size }: { identity: Identity; size: number }) {
  return <Avatar name={identity.name} initial={identityInitials(identity.name)} color={identity.color} picture={identity.picture} size={size} />;
}

/** The identity menu's entries, shared by the sidebar footer button and the title-bar chip (the theme is read when it opens). */
function identityEntries({ t, locale, setLocale, identity, connected, shell, update }: {
  t: ReturnType<typeof useI18n>["t"]; locale: ReturnType<typeof useI18n>["locale"]; setLocale: ReturnType<typeof useI18n>["setLocale"];
  identity: Identity; connected: boolean; shell: ReturnType<typeof useShellInfo>; update: ReturnType<typeof useUpdateStatus>;
}): MenuEntry[] {
  const theme = loadTheme();
  const role = t(identity.words.line);
  const title = identity.role === "owner" ? identity.name : `${identity.name} · ${role}`;
  const checked = (on: boolean) => (on ? <Check size={13} /> : null);
  const build = update?.current?.commit ? [update.current.commit.slice(0, 7), update.channel].filter(Boolean).join(" · ") : update?.channel;
  const checking = update?.state === "checking";
  const updateUsable = !!update && (update.state !== "unsupported" || update.retryable === true);
  return [
    {
      // The header itself opens 设置 → 用户 (你的名字和头像), instead of a separate menu item.
      label: title,
      title: t("identity.edit"),
      labelNode: (
        <div className="flex min-w-0 items-center gap-2.5">
          <IdentityAvatar identity={identity} size={32} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{identity.name}</div>
            <div className="truncate text-xs text-subtle" title={identity.role === "pending" ? t("identity.pendingHint") : undefined}>
              {role}
            </div>
          </div>
        </div>
      ),
      onSelect: () => useApp.getState().openSettings("me"),
    },
    "separator",
    { label: t("sidebar.settings"), icon: <Settings size={14} />, hint: bindingLabel("settings"), onSelect: openSettingsFromNav },
    // Profiles and their quota are the host owner's.
    connected && identity.role === "owner" && { label: t("identity.usage"), icon: <Gauge size={14} />, flyout: <UsageFlyout />, onSelect() {} },
    {
      label: t("identity.language"),
      icon: <Languages size={14} />,
      hint: LANGUAGES.find((l) => l.value === (isTraditionalLocale(locale) ? "zh-Hant-CN" : locale))?.label,
      submenu: LANGUAGES.map((l) => l.value === "zh-Hant-CN" ? {
        label: l.label,
        icon: checked(isTraditionalLocale(locale)),
        submenu: (["CN", "HK", "MO", "TW"] as const).map((region) => ({ label: t(`shell.language.traditional.${region}` as MessageKey), icon: checked(traditionalRegionOf(locale) === region), onSelect: () => setLocale(traditionalLocale(region)) })),
        onSelect() {},
      } : { label: l.label, icon: checked(l.value === locale), onSelect: () => setLocale(l.value) }),
      onSelect() {},
    },
    {
      label: t("shell.appearance"),
      icon: <Palette size={14} />,
      submenu: (["light", "dark", "system"] as ThemePref[]).map((v) => ({ label: t(`shell.theme.${v}` as MessageKey), icon: checked(v === theme), onSelect: () => applyTheme(v) })),
      onSelect() {},
    },
    "separator",
    shell?.quickstart && { label: t("identity.help"), icon: <BookOpen size={14} />, onSelect: () => void bridge.shell?.openQuickstart?.() },
    bridge.update && {
      label: checking ? t("identity.checking") : t("identity.checkUpdate"),
      icon: <RefreshCw size={14} />,
      hint: build ?? undefined,
      disabled: !updateUsable || checking,
      title: update?.state === "unsupported" ? (update.reason ?? undefined) : undefined,
      onSelect: () => void bridge.update?.check(),
    },
    bridge.shell && { label: t("identity.openLogs"), icon: <FolderOpen size={14} />, onSelect: () => void bridge.shell?.openLogs() },
    "separator",
    bridge.shell?.quit && { label: t("identity.quit"), icon: <LogOut size={14} />, onSelect: () => void bridge.shell?.quit?.() },
  ];
}

export function IdentityButton() {
  const doc = useOwnerDocument();
  const { t, locale, setLocale } = useI18n();
  const identity = useIdentity();
  const connected = useApp((s) => s.daemon.kind === "connected");
  const shell = useShellInfo();
  const update = useUpdateStatus();
  const ref = useRef<HTMLButtonElement>(null);
  const open = useMenuOwner() === MENU_OWNER;
  // Back on the button when the menu closes with nothing else focused (Esc, a keyboard pick).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open && (doc.activeElement === doc.body || doc.activeElement === null)) ref.current?.focus();
    wasOpen.current = open;
  }, [open, doc]);

  const role = t(identity.words.line);
  const suffix = identity.words.suffix ? t(identity.words.suffix) : null;
  const title = identity.role === "owner" ? identity.name : `${identity.name} · ${role}`;

  const entries = () => identityEntries({ t, locale, setLocale, identity, connected, shell, update });

  return (
    <button
      ref={ref}
      title={title}
      aria-label={`${t("identity.menu")}: ${title}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(e) => {
        // 用量 ▸ paints from the cached profile list: start (or join) its refresh before the hover.
        if (connected && identity.role === "owner") {
          const host = useApp.getState().hosts?.active ?? "local";
          void prepareUsage(host).catch(() => {});
        }
        const footer = e.currentTarget.closest("footer");
        openMenuAbove(e.currentTarget, entries(), { owner: MENU_OWNER, minWidth: Math.max(224, footer ? footer.getBoundingClientRect().width - 16 : 0) });
      }}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50 group-data-[tight]/footer:flex-none ${open ? "bg-surface-2" : ""}`}
    >
      <IdentityAvatar identity={identity} size={20} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 group-data-[tight]/footer:hidden">
        <span className="min-w-0 truncate text-ui/[inherit] text-foreground">{identity.name}</span>
        {suffix && <span className="shrink-0 text-caption/[inherit] text-subtle">{suffix}</span>}
      </span>
      <ChevronsUpDown size={12} className="shrink-0 text-subtle group-data-[tight]/footer:hidden" />
    </button>
  );
}

/**
 * The title bar's far-right identity chip while the sidebar is hidden (owner 2026-10-28, folded sidebar ④):
 * the account avatar, the update hint as its dot (red for a failed update), and the same menu as the sidebar
 * footer's identity button (设置, 用量, 语言, 外观, 检查更新…).
 */
export function IdentityChip() {
  const { t, locale, setLocale } = useI18n();
  const identity = useIdentity();
  const connected = useApp((s) => s.daemon.kind === "connected");
  const shell = useShellInfo();
  const update = useUpdateStatus();
  const open = useMenuOwner() === MENU_OWNER;
  const title = identity.role === "owner" ? identity.name : `${identity.name} · ${t(identity.words.line)}`;
  const hint = update && updateButtonVisible(update);
  return (
    <button
      data-titlebar-identity=""
      title={title}
      aria-label={`${t("identity.menu")}: ${title}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(e) => {
        if (connected && identity.role === "owner") {
          const host = useApp.getState().hosts?.active ?? "local";
          void prepareUsage(host).catch(() => {});
        }
        openMenuFrom(e.currentTarget, identityEntries({ t, locale, setLocale, identity, connected, shell, update }), { owner: MENU_OWNER });
      }}
      className={`relative ml-0.5 flex shrink-0 items-center rounded-full p-0.5 hover:bg-surface-2 ${open ? "bg-surface-2" : ""}`}
    >
      <IdentityAvatar identity={identity} size={20} />
      {hint && <span aria-hidden className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-[var(--win)] ${update!.state === "error" ? "bg-danger" : "bg-accent"}`} />}
    </button>
  );
}
