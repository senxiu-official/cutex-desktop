// The desktop's icon tiles' bodies (sizes s / m / w / l; preview-shell.html `.grid`; the `home.tile` widget draws them on
// the desk): services (icon, name, health dot, host chip; the service's template tile when its host has `service-tiles`
// and it serves one), artifacts, agents and links. A click opens the pane (open.ts). 「＋ 固定」 / 添加图标 open a picker
// over services / agents / artifacts.
import type { ReactNode } from "react";
import { FileBox, Server, LayoutDashboard, Link2 } from "lucide-react";
import { parsePagePinKey, type HomePin, type HomeTileSize } from "../../../../shared/home";
import { pagePinKey, pagePinKindsNow, usePagePinKind, type PagePinKind, type PagePinView } from "../../lib/pagePins";
import type { ArtifactSummary } from "../../../../shared/artifactStore";
import { artifactRef } from "../../../../shared/artifactStore";
import { useI18n, type MessageKey } from "../../i18n";
import { closeMenu, type MenuEntry } from "../../lib/contextMenu";
import { agentPickerOptions, pickerProjectRank, sidebarPickerRows } from "../../lib/agentPickerOptions";
import { getUiPrefs } from "../../lib/prefs";
import { SearchablePickerBody } from "../../components/SearchablePicker";
import { LOCAL_HOST_ID } from "../../../../shared/hosts";
import { hostData } from "../../lib/hostScope";
import { useHostScope } from "../../lib/useHostScope";
import { Avatar } from "../../components/Avatar";
import { HostDot } from "../../components/HostMark";
import { sidebarOf, useApp } from "../../store";
import { services } from "../app";
import { featuresOf, homeSourceNow, useServiceTile, useServiceView } from "./hooks";
import { pagePinsKept } from "./model";
import { openFailedText, openTileAction } from "./open";
import { gradientOf, tileParts } from "./tile";
import { CountBadge, Tag } from "../../components/Tag";
import { WorkerBadge } from "../../components/WorkerBadge";


function Icon({ bg, size, children }: { bg: string; size: number; children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-xl text-white shadow-[0_3px_10px_rgba(0,0,0,0.15)]" style={{ width: size, height: size, background: bg }}>
      {children}
    </span>
  );
}

function HostChip({ hostId }: { hostId: string }) {
  const scope = useHostScope();
  const look = scope.host(hostId);
  if (!look || !scope.showHostMarks) return null;
  return (
    <span className="inline-flex max-w-24 shrink-0 items-center gap-1 rounded-full bg-[rgba(127,127,140,0.16)] px-1.5 py-px text-caption/[inherit] font-normal home-sub" data-home-host="">
      <HostDot color={look.color} status={look.indicator.status} size={6} />
      <span className="truncate">{look.label}</span>
    </span>
  );
}

const HEALTH_KEY: Record<string, MessageKey> = { reachable: "home.tile.running", starting: "home.tile.starting", unreachable: "home.tile.unreachable", stopped: "home.tile.stopped", stoppedIdle: "services.health.stoppedIdle", crashLooped: "services.health.crashLooped" };
const HEALTH_DOT: Record<string, string> = { reachable: "bg-ok", starting: "bg-warn", unreachable: "bg-danger", crashLooped: "bg-danger", stopped: "bg-subtle opacity-60", stoppedIdle: "bg-subtle opacity-60" };

/** A service pin: its icon tile, or its template tile (m / w / l) when the host serves one. */
function ServiceTile({ pin, size, explain }: { pin: HomePin; size: HomeTileSize; explain: (r: string) => string }) {
  const { t } = useI18n();
  const view = useServiceView(pin.hostId, pin.key);
  const connected = useApp((s) => hostData(s, pin.hostId)?.daemon.kind === "connected");
  const listed = useApp((s) => hostData(s, pin.hostId)?.services !== null && hostData(s, pin.hostId)?.services !== undefined);
  const { answer, image } = useServiceTile(pin.hostId, pin.key, connected && !!view && size !== "s");
  const parts = answer?.tile ? tileParts(answer.tile, size, pin.key) : null;
  const name = view?.displayName || pin.title || pin.key;
  const health = !connected ? "offline" : view ? view.health : listed ? "missing" : "unknown";
  const off = health !== "reachable" && health !== "starting" && health !== "unknown";
  const worker = view?.runtime === "worker";
  const status = health === "offline" ? t("home.tile.offline") : health === "missing" ? t("home.tile.missing") : worker && health === "unreachable" ? t("services.worker.health.restarting") : HEALTH_KEY[health] ? t(HEALTH_KEY[health]!) : "";
  const dot = <span className={`inline-block size-[7px] shrink-0 rounded-full ${HEALTH_DOT[health] ?? "bg-subtle"}`} data-home-health={health} />;
  const icon = (px: number) => (
    <Icon bg={gradientOf(pin.key)} size={px}>
      <Server size={Math.round(px / 2)} strokeWidth={1.7} />
    </Icon>
  );
  if (size === "s")
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-1.5 ${off ? "opacity-70 [&_span:first-child]:grayscale" : ""}`}>
        {icon(44)}
        <span className="flex max-w-full items-center gap-1 text-xs font-semibold">
          {dot}
          <span className="truncate">{name}</span>
        </span>
      </div>
    );
  if (!parts || size === "m") {
    const line = parts?.subtitle ?? parts?.lines[0] ?? null;
    return (
      <div className={`flex h-full items-center gap-3 ${off ? "opacity-70" : ""}`}>
        {icon(44)}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <span className="truncate">{parts?.title ?? name}</span>
            {parts?.badge && <Tag tone="accent">{parts.badge}</Tag>}
            {worker && <WorkerBadge />}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-caption/[inherit] home-sub">
            {dot}
            <span className="truncate">{line ?? status}</span>
          </div>
          {size !== "m" && (
            <div className="mt-1.5">
              <HostChip hostId={pin.hostId} />
            </div>
          )}
        </div>
      </div>
    );
  }
  // A template tile, wide / large: image (book cover, chart…) left, text right, progress, actions.
  return (
    <div className={`flex h-full min-w-0 gap-4 ${off ? "opacity-75" : ""}`} data-home-template="">
      {parts.image && image && <img src={image} alt="" className="h-full max-h-[200px] w-[118px] shrink-0 rounded-lg object-cover shadow-[0_8px_20px_rgba(0,0,0,0.28)]" draggable={false} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Icon bg={gradientOf(pin.key)} size={20}>
            <Server size={12} />
          </Icon>
          <span className="truncate">{name}</span>
          {dot}
          <span className="flex-1" />
          {parts.badge && <Tag tone="accent">{parts.badge}</Tag>}
          <HostChip hostId={pin.hostId} />
        </div>
        <div className="mt-auto min-w-0">
          {parts.title && <div className="truncate text-[17px] font-semibold">{parts.title}</div>}
          {parts.subtitle && <div className="truncate text-xs home-sub">{parts.subtitle}</div>}
          {parts.lines.map((l, i) => (
            <div key={i} className="truncate text-meta/[inherit] home-sub">
              {l}
            </div>
          ))}
          {parts.progress && (
            <div className="mt-2" data-home-progress={parts.progress.value}>
              <div className="h-1 overflow-hidden rounded-full bg-[rgba(127,127,140,0.25)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(parts.progress.value * 100)}>
                <i className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(parts.progress.value * 100)}%` }} />
              </div>
              {parts.progress.label && <div className="mt-1 text-caption/[inherit] home-sub">{parts.progress.label}</div>}
            </div>
          )}
          {parts.actions.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {parts.actions.map((a) => (
                <button
                  key={a.link}
                  data-home-action={a.link}
                  onClick={(e) => {
                    e.stopPropagation();
                    void openTileAction(pin, a.link, explain);
                  }}
                  className="rounded-full bg-[var(--home-glass-fg)] px-3 py-1 text-meta/[inherit] font-medium text-[var(--bg)] hover:opacity-85"
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentTile({ pin, size, bare = false }: { pin: HomePin; size: HomeTileSize; bare?: boolean }) {
  const session = useApp((s) => {
    const sb = sidebarOf(s, pin.hostId);
    return [...(sb?.active ?? []), ...(sb?.retired ?? [])].find((r) => r.cutexSessionId === pin.key);
  });
  const name = session?.displayName ?? pin.title ?? pin.key;
  const avatar = <Avatar name={name} avatar={session?.avatar} seed={pin.key} size={40} />;
  // On the desktop (owner 2026-10-24: no frame — the portraits have no background): the cut-out portrait fills the
  // tile above the name; a face without a picture stays round.
  if (bare)
    return (
      <div className="flex h-full flex-col items-center" data-home-agent-cutout="">
        <div className="home-cutout flex min-h-0 w-full flex-1 items-end justify-center">
          <Avatar name={name} avatar={session?.avatar} seed={pin.key} size={size === "s" ? 96 : 160} cutout />
        </div>
        <span className={`mt-0.5 flex max-w-full items-center gap-1.5 font-semibold ${size === "s" ? "text-xs" : "text-ui/[inherit]"}`}>
          <span className="truncate">{name}</span>
          {size !== "s" && <HostChip hostId={pin.hostId} />}
        </span>
      </div>
    );
  if (size === "s")
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5">
        {avatar}
        <span className="max-w-full truncate text-xs font-semibold">{name}</span>
      </div>
    );
  return (
    <div className="flex h-full items-center gap-3">
      {avatar}
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold">{name}</div>
        <div className="mt-1">
          <HostChip hostId={pin.hostId} />
        </div>
      </div>
    </div>
  );
}

function PlainTile({ pin, size, kind }: { pin: HomePin; size: HomeTileSize; kind: "artifact" | "url" }) {
  const { t } = useI18n();
  const name = pin.title ?? (kind === "url" ? (() => { try { return new URL(pin.key).hostname; } catch { return pin.key; } })() : pin.key);
  const icon = (
    <Icon bg={kind === "artifact" ? "linear-gradient(140deg,#10b981,#0f766e)" : "linear-gradient(140deg,#64748b,#334155)"} size={44}>
      {kind === "artifact" ? <FileBox size={22} strokeWidth={1.7} /> : <Link2 size={22} strokeWidth={1.7} />}
    </Icon>
  );
  if (size === "s")
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5">
        {icon}
        <span className="max-w-full truncate text-xs font-semibold">{name}</span>
      </div>
    );
  return (
    <div className="flex h-full items-center gap-3">
      {icon}
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold">{name}</div>
        <div className="truncate text-caption/[inherit] home-sub">{t(kind === "artifact" ? "home.tile.artifact" : "home.tile.url")}</div>
      </div>
    </div>
  );
}

/** A pinned page (lib/pagePins): its owner's icon, name, kind and 需要你 count; without its owner the stored title. */
function PageTile({ pin, size }: { pin: HomePin; size: HomeTileSize }) {
  const page = parsePagePinKey(pin.key);
  const kind = usePagePinKind(page?.pageId ?? null);
  if (page && kind) return <OwnedPageTile key={kind.id} kind={kind} arg={page.arg} pin={pin} size={size} />;
  const view: PagePinView = {
    name: pin.title ?? pin.key,
    icon: (px) => (
      <Icon bg="linear-gradient(140deg,#64748b,#334155)" size={px}>
        <LayoutDashboard size={Math.round(px / 2)} strokeWidth={1.7} />
      </Icon>
    ),
    needs: 0,
    dim: true,
  };
  return <PageTileBody view={view} pin={pin} size={size} />;
}

function OwnedPageTile({ kind, arg, pin, size }: { kind: PagePinKind; arg: string; pin: HomePin; size: HomeTileSize }) {
  return <PageTileBody view={kind.usePin(pin.hostId, arg, pin.title ?? null)} pin={pin} size={size} />;
}

function PageTileBody({ view, pin, size }: { view: PagePinView; pin: HomePin; size: HomeTileSize }) {
  const { t } = useI18n();
  const needs =
    view.needs > 0 ? (
      <CountBadge count={view.needs} className="absolute -top-1 -right-1" data-home-needs={view.needs} title={t("home.dock.state.needs", { n: view.needs })} />
    ) : null;
  const icon = (
    <span className={`relative shrink-0 ${view.dim ? "opacity-50" : ""}`}>
      {view.icon(44)}
      {needs}
    </span>
  );
  if (size === "s")
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5">
        {icon}
        <span className="max-w-full truncate text-xs font-semibold">{view.name}</span>
      </div>
    );
  return (
    <div className="flex h-full items-center gap-3">
      {icon}
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold">{view.name}</div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          {view.subtitle && <span className="truncate text-caption/[inherit] home-sub">{view.subtitle}</span>}
          {view.needs > 0 && <span className="shrink-0 text-caption/[inherit] font-medium text-warn-text">{t("home.dock.state.needs", { n: view.needs })}</span>}
          <HostChip hostId={pin.hostId} />
        </div>
      </div>
    </div>
  );
}

/** A pin's tile body at a size letter (the `home.tile` desktop widget, design 032: the box is free, the body picks its layout). */
export function PinTileBody({ pin, size, bare = false }: { pin: HomePin; size: HomeTileSize; bare?: boolean }) {
  const { t } = useI18n();
  const explain = openFailedText;
  if (pin.kind === "service") return <ServiceTile pin={pin} size={size} explain={explain} />;
  if (pin.kind === "agent") return <AgentTile pin={pin} size={size} bare={bare} />;
  if (pin.kind === "page") return <PageTile pin={pin} size={size} />;
  return <PlainTile pin={pin} size={size} kind={pin.kind} />;
}

/** Where the picker puts what is picked: the desktop's icons, or the tray's pins (the source host's list now). */
export interface PinTarget {
  isPinned(pin: HomePin): boolean;
  add(pin: HomePin): void;
}

/**
 * 「＋ 固定」 (the desktop's tile, the empty tray): a menu of what can be pinned — services of the connected
 * hosts, recent agents, artifacts, and the pages modules offer (lib/pagePins candidates, e.g. Project 视图)
 * where the list's host keeps page pins (`user-home-page-pins`).
 */
export async function pickerMenu(target: PinTarget, t: ReturnType<typeof useI18n>["t"]): Promise<MenuEntry[]> {
  const s = useApp.getState();
  const hostIds = (s.hosts?.hosts ?? [{ id: "local" }]).map((h) => h.id).filter((id) => hostData(s, id)?.daemon.kind === "connected");
  const multi = hostIds.length > 1;
  const label = (hostId: string) => s.hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId;
  const entry = (pin: HomePin, text: string, icon: ReactNode): MenuEntry => {
    const on = target.isPinned(pin);
    return { label: text, icon, hint: multi ? label(pin.hostId) : undefined, disabled: on, title: on ? t("home.unpin") : undefined, onSelect: () => target.add(pin) };
  };
  const svc: MenuEntry[] = hostIds.flatMap((hostId) => (hostData(s, hostId)?.services ?? []).map((v) => entry({ hostId, kind: "service", key: v.slug, title: (v.displayName || v.slug).slice(0, 200) }, v.displayName || v.slug, <Server size={14} />)));
  // Agents: every agent of the connected hosts in the shared picker (search, projects as groups), not the first 40.
  const pinKey = (hostId: string, id: string) => `${hostId}\n${id}`;
  const selectedHost = s.selectedHost ?? s.hosts?.active ?? LOCAL_HOST_ID;
  const projectOrder = getUiPrefs().projectOrder ?? [];
  const agentLabels = { top: t("agentPicker.top"), independent: t("agentPicker.independent"), archived: t("agentPicker.archived"), chats: t("agentPicker.chats") };
  const agentOptions = hostIds.flatMap((hostId) => {
    const sidebar = sidebarOf(s, hostId);
    const rows = sidebarPickerRows(sidebar, { hostLabel: multi ? label(hostId) : undefined, keyOf: (id) => pinKey(hostId, id) });
    return agentPickerOptions(rows, agentLabels, { top: hostId === selectedHost ? [s.selectedId && pinKey(hostId, s.selectedId)] : [], rank: pickerProjectRank(sidebar, projectOrder, hostId) });
  });
  // The selected agent's host first, so its 当前 row leads the list.
  agentOptions.sort((a, b) => Number(b.group === agentLabels.top) - Number(a.group === agentLabels.top));
  for (const o of agentOptions) {
    const [hostId, id] = o.value.split("\n") as [string, string];
    if (target.isPinned({ hostId, kind: "agent", key: id, title: o.label })) o.disabled = true;
  }
  const pickAgent = (value: string) => {
    const [hostId, id] = value.split("\n") as [string, string];
    const name = agentOptions.find((o) => o.value === value)?.label ?? id;
    closeMenu();
    target.add({ hostId, kind: "agent", key: id, title: name.slice(0, 200) });
  };
  // Artifacts: the newest of each host's projects (artifacts need a scope).
  const artifacts: { hostId: string; a: ArtifactSummary }[] = [];
  await Promise.all(
    hostIds
      .filter((hostId) => hostData(s, hostId)?.features.has("artifacts"))
      .flatMap((hostId) =>
        (sidebarOf(s, hostId)?.projects?.projects ?? []).slice(0, 6).map((p) =>
          services
            .daemonFor(hostId)
            .artifactStoreList({ project: p.project_id, limit: 8 })
            .then((list) => list?.items.forEach((a) => artifacts.push({ hostId, a })))
            .catch(() => {}),
        ),
      ),
  );
  const arts: MenuEntry[] = artifacts
    .sort((x, y) => y.a.updatedAt.localeCompare(x.a.updatedAt))
    .slice(0, 20)
    .map(({ hostId, a }) => entry({ hostId, kind: "artifact", key: artifactRef(a.artifactId, "latest"), title: a.name.slice(0, 200) }, a.name, <FileBox size={14} />));
  const none: MenuEntry[] = [{ label: t("home.picker.none"), disabled: true, onSelect: () => {} }];
  // Pages (a project's Project 视图 …): only where the list's host keeps page pins.
  const pages: MenuEntry[] = pagePinsKept(featuresOf(s, homeSourceNow()))
    ? pagePinKindsNow()
        .filter((kind) => kind.candidates && kind.titleKey)
        .map((kind) => {
          const items = kind
            .candidates!()
            .slice(0, 40)
            .map((c) => entry({ hostId: c.hostId, kind: "page", key: pagePinKey(kind.id, c.arg), title: c.title.slice(0, 200) }, c.title, <LayoutDashboard size={14} />));
          return { label: t(kind.titleKey as MessageKey), icon: <LayoutDashboard size={14} />, submenu: items.length ? items : none, onSelect: () => {} };
        })
    : [];
  return [
    { label: t("home.picker.services"), icon: <Server size={14} />, submenu: svc.length ? svc : none, onSelect: () => {} },
    agentOptions.length
      ? { label: t("home.picker.agents"), icon: <Avatar name="A" agent={{}} size={16} />, flyout: <SearchablePickerBody options={agentOptions} placeholder={t("agentPicker.search")} emptyLabel={t("agentPicker.empty")} hiddenNote={(n) => t("agentPicker.hiddenChats", { n })} label={t("home.picker.agents")} onPick={pickAgent} />, onSelect: () => {} }
      : { label: t("home.picker.agents"), icon: <Avatar name="A" agent={{}} size={16} />, submenu: none, onSelect: () => {} },
    { label: t("home.picker.artifacts"), icon: <FileBox size={14} />, submenu: arts.length ? arts : none, onSelect: () => {} },
    ...pages,
  ];
}
