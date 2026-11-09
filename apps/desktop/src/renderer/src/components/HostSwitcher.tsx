import { isImeComposing } from "../lib/ime";
// Title bar host switcher (multi-host RFC §7, P1): the button shows the view scope (one host, a group,
// or 所有主机); the menu picks the scope, connects a host without changing it, and › opens a host's page.
// Ctrl+Shift+H opens it (★ Q19); ↑ / ↓ / Enter / Esc inside. Model: lib/hostScope, actions:
// lib/useHostScope.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Layers, MonitorSmartphone, Server, Settings as SettingsIcon } from "lucide-react";
import type { ViewScope } from "../../../shared/hosts";
import { useI18n, type MessageKey } from "../i18n";
import { ALL_HOSTS, singleHostScope, scopeTitle, versionOutliers, hostVersionTitle, type HostLook } from "../lib/hostScope";
import { displaySshTarget, sameScope, switcherGroups } from "../../../shared/hosts";
import { useTrackOverlay } from "../lib/openOverlays";
import { hasNoHost, routesExhausted } from "../lib/hosts";
import { routeLabel } from "../lib/hostRoute";
import { matchesCommand } from "../lib/keybindings";
import { useBindingLabel, withKey } from "../lib/useKeybindings";
import { setSettingsHost } from "../lib/settingsHost";
import { setHostConnected, setViewScope, useHostScope } from "../lib/useHostScope";
import { useApp } from "../store";
import { HostDot, HostPlatformIcon } from "./HostMark";
import { ScriptText } from "./ScriptText";
import { Tag } from "./Tag";
import { FloatMore, useRowsBelow } from "./FloatMore";
import { useOwnerWindow } from "../lib/ownerContext";

const NO_DRAG = "[app-region:no-drag]";

/** The switcher's key (lib/keybindings `hostSwitcher`, default Ctrl+Shift+H / ⌘⇧H): open / close it. */
const isSwitcherKey = (e: KeyboardEvent) => matchesCommand("hostSwitcher", e);

interface Row {
  key: string;
  scope?: ViewScope;
  run?(): void;
  node: ReactNode;
}

export function HostSwitcher() {
  const win = useOwnerWindow();
  const switcherKey = useBindingLabel("hostSwitcher");
  const { t } = useI18n();
  const scope = useHostScope();
  const hostsState = useApp((s) => s.hosts);
  const openSettings = useApp((s) => s.openSettings);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const below = useRowsBelow(list, ":scope > [role=menuitem]");
  useTrackOverlay(open);

  const versionText = { dev: t("cutexBuild.dev"), legacy: t("cutexBuild.legacy") };
  const statusText = (h: HostLook) => (h.indicator.status === "online" ? null : t(`host.status.${h.indicator.status}` as MessageKey));
  const hostTip = (h: HostLook) =>
    [`${h.label} · ${t(`host.status.${h.indicator.status}` as MessageKey)}`, h.connected && h.indicator.status === "online" ? `cutex ${hostVersionTitle(h.build, versionText)}` : null, h.view.kind === "ssh" ? `ssh ${(h.view.conn?.tunnel?.status === "up" ? routeLabel(t, h.view) : null) ?? displaySshTarget(h.view.conn?.tunnel?.target ?? h.view.target ?? "")}` : null, routesExhausted(h.view.conn?.tunnel) ? t("host.routesFailedHint") : h.indicator.problem ? t(`host.problem.${h.indicator.problem}` as MessageKey) : null, h.indicator.detail]
      .filter(Boolean)
      .join("\n");
  const outliers = useMemo(() => versionOutliers(scope.hosts), [scope.hosts]);
  // Groups with at least one known member (empty ones are not offered, RFC §7.5).
  const groups = switcherGroups(hostsState);

  const choose = (next: ViewScope) => {
    setOpen(false);
    void setViewScope(next);
  };

  // Rows in menu order (keyboard cursor indexes these).
  const dots = (hosts: readonly HostLook[]) => (
    <span className="flex shrink-0 items-center gap-0.5">
      {hosts.map((h) => (
        <HostDot key={h.id} color={h.color} status={h.indicator.status} size={7} title={h.label} />
      ))}
    </span>
  );
  const tick = (on: boolean) => <span className="w-3.5 shrink-0 text-accent">{on && <Check size={13} />}</span>;
  const rows: Row[] = [
    {
      key: "all",
      scope: ALL_HOSTS,
      node: (
        <>
          <MonitorSmartphone size={14} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{t("hostSwitcher.all")}</span>
          {dots(scope.hosts.filter((h) => h.connected))}
          {tick(scope.scope.kind === "all")}
          <span className="w-6 shrink-0" />
        </>
      ),
    },
    ...groups.map(
      (g): Row => ({
        key: `group:${g.id}`,
        scope: { kind: "group", id: g.id },
        node: (
          <>
            <Layers size={14} className="shrink-0 text-muted" style={g.color ? { color: g.color } : undefined} />
            <span className="min-w-0 flex-1 truncate">
              <ScriptText text={g.name} />
            </span>
            {dots(g.hosts.map((id) => scope.host(id)).filter((h): h is HostLook => !!h))}
            {tick(sameScope(scope.scope, { kind: "group", id: g.id }))}
            <span className="w-6 shrink-0" />
          </>
        ),
      }),
    ),
    ...scope.hosts.map(
      (h): Row => ({
        key: `host:${h.id}`,
        scope: singleHostScope(h.id),
        node: (
          <>
            <HostPlatformIcon platform={h.platform} className="text-muted" />
            <HostDot color={h.color} status={h.indicator.status} />
            <span className="min-w-0 flex-1 truncate" data-tip={hostTip(h)}>
              <ScriptText text={h.label} />
              {h.local && <span className="text-subtle"> · {t("titlebar.local")}</span>}
            </span>
            {statusText(h) && <span className={`shrink-0 text-xs ${h.indicator.status === "error" ? "text-danger" : h.indicator.status === "disconnected" || h.indicator.status === "offline" ? "text-subtle" : "text-warn"}`}>{statusText(h)}</span>}
            {h.version && outliers.has(h.id) && (
              <Tag tone="attention" data-tip={t("hostSwitcher.versionDiffers")} className="font-mono">
                {h.version}
              </Tag>
            )}
            {tick(sameScope(scope.scope, singleHostScope(h.id)))}
            {!h.connected && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void setHostConnected(h.id, true);
                }}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs text-accent hover:bg-surface"
              >
                {t("host.connect")}
              </button>
            )}
            <button
              data-tip={t("hostSwitcher.manageHost")}
              aria-label={t("hostSwitcher.manageHost")}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                setSettingsHost(h.id);
                openSettings("access");
              }}
              className="shrink-0 rounded p-1 text-subtle hover:bg-surface hover:text-foreground"
            >
              <ChevronRight size={13} />
            </button>
          </>
        ),
      }),
    ),
    {
      key: "add",
      run: () => openSettings("hosts", { anchor: "addHost" }),
      node: (
        <>
          <Server size={14} className="shrink-0 text-muted" />
          <span className="flex-1">{t("titlebar.addSsh")}</span>
        </>
      ),
    },
    {
      key: "settings",
      run: () => openSettings("hosts"),
      node: (
        <>
          <SettingsIcon size={14} className="shrink-0 text-muted" />
          <span className="flex-1">{t("titlebar.connectionSettings")}</span>
        </>
      ),
    },
  ];
  const activate = (row: Row | undefined) => {
    if (!row) return;
    if (row.scope) return choose(row.scope);
    setOpen(false);
    row.run?.();
  };
  const rowsRef = useRef(rows);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  rowsRef.current = rows;

  // The switcher key anywhere toggles the menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (!isSwitcherKey(e)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, []);

  // While open: the cursor starts on the current scope; outside clicks / Esc close; ↑ ↓ Enter.
  useEffect(() => {
    if (!open) return;
    const current = rowsRef.current.findIndex((r) => r.scope && sameScope(r.scope, scope.scope));
    setCursor(Math.max(0, current));
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (isSwitcherKey(e)) return;
      const count = rowsRef.current.length;
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowDown") setCursor((c) => (c + 1) % count);
      else if (e.key === "ArrowUp") setCursor((c) => (c - 1 + count) % count);
      else if (e.key === "Enter") activate(rowsRef.current[cursorRef.current]);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    win.document.addEventListener("mousedown", onDown);
    win.document.addEventListener("keydown", onKey, true);
    return () => {
      win.document.removeEventListener("mousedown", onDown);
      win.document.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---------- the button ----------
  const title = scopeTitle(scope.scope, hostsState, { all: t("hostSwitcher.all") });
  const single = scope.scope.kind === "host" ? scope.host(scope.scope.id) : null;
  const scopeGroupId = scope.scope.kind === "group" ? scope.scope.id : null;
  const groupColor = scopeGroupId ? hostsState?.groups.find((g) => g.id === scopeGroupId)?.color : undefined;
  const buttonTip = [withKey(t("hostSwitcher.title"), switcherKey), ...scope.hostsInScope.map(hostTip)].join("\n\n");
  // No host at all (macOS without a local cutex): say so and go to Settings → 主机 (nothing to switch).
  const noHost = hasNoHost(hostsState);
  let label: ReactNode;
  if (noHost) {
    label = (
      <>
        <Server size={13} className="shrink-0" />
        <span className="truncate">{t("firstRun.noHost.title")}</span>
      </>
    );
  } else if (single) {
    const status = statusText(single);
    label = (
      <>
        <HostPlatformIcon platform={single.platform} size={13} />
        <HostDot color={single.color} status={single.indicator.status} />
        <span className="truncate">
          <ScriptText text={title} />
        </span>
        {status && <span className={`shrink-0 ${single.indicator.status === "error" || single.indicator.status === "offline" ? "text-danger" : single.indicator.status === "disconnected" ? "text-subtle" : "text-warn"}`}>{status}</span>}
      </>
    );
  } else {
    const members = scope.scope.kind === "all" ? scope.hosts.filter((h) => h.connected) : scope.hostsInScope;
    const named = scope.scope.kind === "group" && members.length <= 3;
    label = (
      <>
        {scope.scope.kind === "all" ? <MonitorSmartphone size={13} className="shrink-0" /> : <Layers size={13} className="shrink-0" style={groupColor ? { color: groupColor } : undefined} />}
        <span className="truncate">
          <ScriptText text={title} />
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {members.map((h) => (
            <span key={h.id} className="flex items-center gap-0.5">
              <HostDot color={h.color} status={h.indicator.status} size={7} title={h.label} />
              {named && <span className="hidden max-w-16 truncate text-caption/[inherit] text-subtle lg:inline">{h.label}</span>}
            </span>
          ))}
        </span>
      </>
    );
  }

  const sectionTitle = (text: string) => <div className="px-2.5 pt-1.5 pb-0.5 text-caption/[inherit] text-subtle">{text}</div>;
  const rowClass = (i: number) => `flex w-full cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${i === cursor ? "bg-surface-2" : "hover:bg-surface-2"}`;
  const renderRow = (row: Row, i: number) => (
    <div key={row.key} role="menuitem" tabIndex={-1} onMouseEnter={() => setCursor(i)} onClick={() => activate(row)} className={rowClass(i)}>
      {row.node}
    </div>
  );
  const groupStart = 1;
  const hostStart = groupStart + groups.length;
  const footStart = hostStart + scope.hosts.length;

  return (
    <div ref={ref} className={`${NO_DRAG} relative min-w-0`}>
      <button
        data-tip={buttonTip}
        data-host-switcher=""
        data-hosts-remote={scope.hosts.some((h) => !h.local) ? "" : undefined}
        data-hosts-version-differs={outliers.size ? "" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (noHost ? openSettings("hosts", { anchor: "addHost" }) : setOpen((v) => !v))}
        className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-foreground ${open ? "bg-surface-2 text-foreground" : ""}`}
      >
        {label}
        <ChevronDown size={12} className="shrink-0" />
      </button>
      {open && (
        <div ref={list} role="menu" className="float float-scroll absolute top-full left-0 z-[160] mt-1 max-h-[70vh] w-80 overflow-y-auto p-1">
          {renderRow(rows[0]!, 0)}
          {groups.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              {sectionTitle(t("hostSwitcher.groups"))}
              {rows.slice(groupStart, hostStart).map((r, i) => renderRow(r, groupStart + i))}
            </>
          )}
          <div className="my-1 border-t border-border" />
          {sectionTitle(t("hostSwitcher.hosts"))}
          {rows.slice(hostStart, footStart).map((r, i) => renderRow(r, hostStart + i))}
          <div className="my-1 border-t border-border" />
          {rows.slice(footStart).map((r, i) => renderRow(r, footStart + i))}
          <FloatMore n={below} list={list} />
        </div>
      )}
    </div>
  );
}
