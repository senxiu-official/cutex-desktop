// Sidebar bottom left: who you are on the focus host — `[avatar] name` (+ 只读 / 等主人分配 when this
// connection cannot do everything a user can; lib/identity roleWords) — and a menu: 设置, 用量 ▸, 语言 ▸, 外观 ▸, 帮助与文档, 检查更新, 打开日志文件夹, 退出 Cutex.
// Name / picture are 「你」 (lib/identityPrefs, Settings → 用户), published to hosts with cutex
// `users-self-profile`; without a local one, what the host has for you (`/v2/capabilities` `user`:
// displayName / avatar, set from another desktop of yours; on an older host a member's cutex name);
// the initials' color is the cutex user color where it can be read (the owner: `/v2/users`), else a
// neutral grey. Narrow sidebar: the avatar only (tooltip).
import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, ChevronsUpDown, FolderOpen, Gauge, Languages, LogOut, Palette, RefreshCw, Settings } from "lucide-react";
import type { ShellState } from "../../../shared/ipc";
import { USERS_FEATURE, USERS_SELF_PROFILE_FEATURE } from "../../../shared/users";
import { api, bridge } from "../bridge";
import { useI18n, type MessageKey } from "../i18n";
import { openMenuAbove, useMenuOwner, type MenuEntry } from "../lib/contextMenu";
import { useHostAccess } from "../lib/hostAccess";
import { identityInitials, identityName, identityRole, roleWords, type IdentityRole, type RoleWordKey } from "../lib/identity";
import { useIdentityPrefs } from "../lib/identityPrefs";
import { LANGUAGES } from "../lib/languages";
import { displayKey } from "../lib/shortcuts";
import { projectColor } from "../lib/sidebar";
import { applyTheme, loadTheme, type ThemePref } from "../lib/theme";
import { useUpdateStatus } from "../lib/update";
import { useUserAvatar } from "../lib/userAvatars";
import { openSettingsFromNav } from "../lib/openSettings";
import { loadProfileList } from "../lib/profileSnapshot";
import { useApp } from "../store";
import { Avatar } from "./Avatar";
import { UsageFlyout } from "./UsageFlyout";

const MENU_OWNER = "identity";
/** Initials background when no cutex user color is known (white text reads on it in both themes). */
const NEUTRAL = "#868e96";

let shellInfo: Pick<ShellState, "osUserName" | "quickstart"> | null = null;
/** OS account name + whether a local QUICKSTART exists (main; read once per run). */
function useShellInfo() {
  const [info, setInfo] = useState(shellInfo);
  useEffect(() => {
    if (shellInfo || !bridge.shell) return;
    bridge.shell.state().then((s) => setInfo((shellInfo = { osUserName: s.osUserName ?? null, quickstart: s.quickstart === true })), () => {});
  }, []);
  return info;
}

const ownerColors = new Map<string, string | null>();
/** The owner user's cutex color on a host (`GET /v2/users`, owner only; cached per host for the run). */
function useOwnerColor(hostId: string, read: boolean): string | null {
  const [color, setColor] = useState(() => ownerColors.get(hostId) ?? null);
  useEffect(() => {
    setColor(ownerColors.get(hostId) ?? null);
    if (!read || ownerColors.has(hostId)) return;
    let live = true;
    api.users().then(
      (list) => {
        const c = list?.users.find((u) => u.isOwner)?.color ?? null;
        ownerColors.set(hostId, c);
        if (live) setColor(c);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [hostId, read]);
  return read ? color : null;
}

interface Identity {
  name: string;
  role: IdentityRole;
  /** The role in words (header line) and the button's suffix (only 只读 / 等主人分配). */
  words: { line: RoleWordKey; suffix: RoleWordKey | null };
  picture: string | null;
  color: string;
}

function useIdentity(): Identity {
  const { t } = useI18n();
  const hostId = useApp((s) => s.hosts?.active ?? "local");
  const connected = useApp((s) => s.daemon.kind === "connected");
  const hasUsers = useApp((s) => s.features.has(USERS_FEATURE));
  const selfProfile = useApp((s) => s.features.has(USERS_SELF_PROFILE_FEATURE));
  const access = useHostAccess(hostId);
  const prefs = useIdentityPrefs();
  const shell = useShellInfo();
  const role = identityRole(access);
  const color = useOwnerColor(hostId, connected && hasUsers && role === "owner");
  const hostPicture = useUserAvatar(hostId, selfProfile && !prefs.picture ? access.userId : null, access.avatarEtag);
  return {
    name: identityName(access, prefs.name, shell?.osUserName, selfProfile) ?? t("identity.you"),
    role,
    words: roleWords(access),
    picture: prefs.picture ?? hostPicture,
    color: color ? projectColor(color) : NEUTRAL,
  };
}

function IdentityAvatar({ identity, size }: { identity: Identity; size: number }) {
  return <Avatar name={identity.name} initial={identityInitials(identity.name)} color={identity.color} picture={identity.picture} size={size} />;
}

export function IdentityButton() {
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
    if (wasOpen.current && !open && (document.activeElement === document.body || document.activeElement === null)) ref.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const role = t(identity.words.line);
  const suffix = identity.words.suffix ? t(identity.words.suffix) : null;
  const title = identity.role === "owner" ? identity.name : `${identity.name} · ${role}`;

  const entries = (): MenuEntry[] => {
    const theme = loadTheme();
    const checked = (on: boolean) => (on ? <Check size={13} /> : null);
    const mac = bridge.platform === "darwin";
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
      { label: t("sidebar.settings"), icon: <Settings size={14} />, hint: displayKey("Ctrl+,", mac), onSelect: openSettingsFromNav },
      // Profiles and their quota are the host owner's.
      connected && identity.role === "owner" && { label: t("identity.usage"), icon: <Gauge size={14} />, flyout: <UsageFlyout />, onSelect() {} },
      {
        label: t("identity.language"),
        icon: <Languages size={14} />,
        hint: LANGUAGES.find((l) => l.value === locale)?.label,
        submenu: LANGUAGES.map((l) => ({ label: l.label, icon: checked(l.value === locale), onSelect: () => setLocale(l.value) })),
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
  };

  return (
    <button
      ref={ref}
      title={title}
      aria-label={`${t("identity.menu")}: ${title}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(e) => {
        // 用量 ▸ paints from the cached profile list: start (or join) its refresh before the hover.
        if (connected && identity.role === "owner") void loadProfileList(useApp.getState().hosts?.active ?? "local").catch(() => {});
        const footer = e.currentTarget.closest("footer");
        openMenuAbove(e.currentTarget, entries(), { owner: MENU_OWNER, minWidth: Math.max(224, footer ? footer.getBoundingClientRect().width - 16 : 0) });
      }}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50 @max-[12rem]:flex-none ${open ? "bg-surface-2" : ""}`}
    >
      <IdentityAvatar identity={identity} size={22} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 @max-[12rem]:hidden">
        <span className="min-w-0 truncate text-[13px] text-foreground">{identity.name}</span>
        {suffix && <span className="shrink-0 text-[11px] text-subtle">{suffix}</span>}
      </span>
      <ChevronsUpDown size={12} className="shrink-0 text-subtle @max-[12rem]:hidden" />
    </button>
  );
}
