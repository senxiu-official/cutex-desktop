// Services ↔ their agents in the UI (lib/serviceLink; canvas principles §7, owner 2026-10-21; prototype
// .claude/preview-workspaces.html #service):
//   ServicePaneLink   — in a browser card's Maid 行: 「打开 <owner>」 (click = side by side, ▾ = 投影到这个 Shelf /
//                       替换, draggable like the tray) or, on a pane linked to its agent, 「关联 <agent> ▾」 (断开 in its menu).
//   AgentServices     — the conversation header's 「N 个服务」: the agent's services (health dot), each 在 Shelf
//                       中打开 (this conversation's Shelf, linked) or 已在 Shelf · 定位, and 和它的智能体一起打开.
//                       Never past the window (lib/servicesPopover): the list scrolls under a fixed header; many
//                       services in a wide window are two columns of compact rows, paged (‹ 1/2 ›, PageUp / PageDown).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Server, Link2, LocateFixed, PanelRightOpen, Unlink } from "lucide-react";
import type { ServiceView } from "../../../shared/ipc";
import { useI18n, type MessageKey } from "../i18n";
import { openMenuFrom, type MenuEntry } from "../lib/contextMenu";
import { openFromHeader, serviceOwner, servicePaneLook, serviceSlugOf, setWithAgent, unlinkServicePane, useServiceWithAgent, withAgentOn } from "../lib/serviceLink";
import { useAgentServiceList, useHostServices, useInShelf, useLiveSession } from "../lib/serviceLinkView";
import { openRef, startWorkspaceDrag, type WorkspaceRef } from "../lib/workspaces";
import { paneOfConversation } from "../lib/shelfSource";
import { useShelfPeer } from "../lib/shelfSourceContext";
import { sidebarOf, useApp } from "../store";
import { Avatar } from "./Avatar";
import { keyVar } from "../lib/keybindings";
import { isWorker, serviceHealthKey } from "../lib/serviceWorker";
import { pageOf, POP_W, ROW_H_COMPACT, serviceStatusLine, serviceWhere, servicesPopoverLayout, type ServicesPopoverLayout } from "../lib/servicesPopover";
import { useOwnerWindow } from "../lib/ownerContext";

const TACT = "flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-meta/[inherit] text-muted hover:bg-hover hover:text-foreground";

const healthDot = (h: ServiceView["health"]) => (h === "reachable" ? "bg-ok" : h === "starting" ? "bg-warn" : h === "unreachable" ? "bg-danger" : "bg-subtle/50");

/** In a browser card's Maid 行 (a service tab): the link to its agent, or 「打开 <owner>」. */
export function ServicePaneLink({ hostId, instanceId, url, linked }: { hostId: string | null; instanceId: string; url: string; linked: string | null }) {
  const { t } = useI18n();
  const slug = serviceSlugOf(url);
  const list = useHostServices(hostId);
  const sidebar = useApp((s) => (hostId ? sidebarOf(s, hostId) : null));
  // The conversation whose Shelf this pane is in (design 017): the other workspace's when drawn there, else the focused one.
  const peer = useShelfPeer();
  const focused = useLiveSession(hostId);
  const live = peer ? (peer.hostId === hostId ? peer.sessionId : null) : focused;
  const paneId = peer ? (paneOfConversation(peer.key) ?? undefined) : undefined;
  const on = useServiceWithAgent((s) => s.on);
  if (!slug || !hostId) return null;
  const service = list?.find((s) => s.slug === slug);
  const name = service?.displayName || slug;
  const owner = serviceOwner(list, sidebar, slug);
  const look = servicePaneLook({ linked, owner: owner?.sessionId ?? null, shelfOf: live });
  if (look.kind === "none") return null;
  if (look.kind === "linked") {
    const agent = sidebar?.active.find((r) => r.cutexSessionId === look.sessionId) ?? sidebar?.retired.find((r) => r.cutexSessionId === look.sessionId);
    const who = agent?.displayName ?? look.sessionId;
    // 「关联 <agent> ▾」 (browser card Maid 行, owner plan A 2026-11-05): 断开 lives in its menu, apart from the control grant.
    return (
      <span className="flex min-w-0 shrink items-center" data-service-link="linked" data-service-linked={look.sessionId}>
        <button
          data-service-link-badge=""
          className="flex h-6 min-w-0 shrink items-center gap-1 rounded-md px-1.5 text-meta/[inherit] text-muted hover:bg-hover hover:text-foreground"
          data-tip={t("svcLink.linkedTip", { name: who })}
          aria-label={t("svcLink.linkedMenu", { name: who })}
          aria-haspopup="menu"
          onClick={(e) =>
            openMenuFrom(e.currentTarget, [
              { label: t("svcLink.unlink"), icon: <Unlink size={14} />, info: t("svcLink.unlinkTip", { name: who }), onSelect: () => void unlinkServicePane(instanceId, hostId, slug, name) },
            ])
          }
        >
          {agent ? <Avatar name={agent.displayName} avatar={agent.avatar} seed={agent.cutexSessionId} size={16} /> : <Link2 size={13} className="shrink-0 text-subtle" />}
          <span className="min-w-0 truncate">{t("svcLink.linked", { name: who })}</span>
          <ChevronDown size={12} className="shrink-0" />
        </button>
      </span>
    );
  }
  const agent = owner!.session;
  const ref: WorkspaceRef = { kind: "agent", hostId, key: agent.cutexSessionId, title: agent.displayName };
  const liveName = live ? (sidebar?.active.find((r) => r.cutexSessionId === live)?.displayName ?? live) : t("ws.nobody");
  const withAgent = withAgentOn(on, hostId, slug);
  // 投影到这个 Shelf / 替换: the workspace this pane's Shelf belongs to (the focused one when not drawn as the other's).
  const inThisWorkspace = (mode: "project" | "replace") => void (paneId ? openRef(ref, mode, { paneId }) : openRef(ref, mode));
  const menu = (el: HTMLElement) =>
    openMenuFrom(el, [
      { label: t("svcLink.mode.beside"), hint: t("svcLink.mode.besideHint"), onSelect: () => void openRef(ref, "beside") },
      { label: t("svcLink.mode.project"), onSelect: () => inThisWorkspace("project") },
      { label: t("svcLink.mode.replace", { name: liveName }), onSelect: () => inThisWorkspace("replace") },
      "separator",
      { label: t("svcLink.withAgent"), title: t("svcLink.withAgentHint"), icon: withAgent ? <Check size={14} /> : <span className="inline-block size-3.5" />, onSelect: () => setWithAgent(hostId, slug, !withAgent) },
      { label: t("svcLink.menuNote"), note: true, disabled: true, onSelect: () => {} },
    ] satisfies MenuEntry[]);
  return (
    <span className="flex shrink-0 items-center rounded-md" data-service-link="owner" data-service-owner={agent.cutexSessionId}>
      <button
        data-service-open-owner=""
        className={`${TACT} cursor-grab rounded-r-none pr-1 active:cursor-grabbing`}
        title={t("svcLink.openOwnerTip", { name: agent.displayName })}
        onPointerDown={(e) => startWorkspaceDrag(ref, e)}
        onClick={() => void openRef(ref, "beside")}
      >
        <Avatar name={agent.displayName} avatar={agent.avatar} seed={agent.cutexSessionId} size={16} />
        <span className="max-w-28 truncate">{t("svcLink.openOwner", { name: agent.displayName })}</span>
      </button>
      <button data-service-owner-menu="" className={`${TACT} rounded-l-none px-0.5`} data-tip={t("svcLink.ownerMenu", { name: agent.displayName })} aria-label={t("svcLink.ownerMenu", { name: agent.displayName })} aria-haspopup="menu" onClick={(e) => menu(e.currentTarget)}>
        <ChevronDown size={12} />
      </button>
    </span>
  );
}

/** The conversation header's 「N 个服务」 and its popover. */
type AgentServicesProps = { paneId: string; hostId: string; sessionId: string; agentName: string; compact?: boolean };
export function AgentServices(props: AgentServicesProps) {
  const services = useAgentServiceList(props.paneId, props.hostId, props.sessionId);
  return <AgentServicesView {...props} services={services} />;
}

/** A header that already observes the list supplies it here, without a second subscription. */
export function AgentServicesView({ paneId, hostId, sessionId, agentName, compact = false, services }: AgentServicesProps & { services: ReturnType<typeof useAgentServiceList> }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const { mine, up } = services;
  const inShelf = useInShelf(hostId, sessionId);
  const on = useServiceWithAgent((s) => s.on);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<ServicesPopoverLayout | null>(null);
  const [page, setPage] = useState(0);
  const count = mine.length;
  useLayoutEffect(() => {
    if (!open) return setPlace(null);
    const measure = () => {
      if (!anchor.current) return;
      setPlace(servicesPopoverLayout(count, anchor.current.getBoundingClientRect(), { width: win.innerWidth, height: win.innerHeight }));
    };
    measure();
    win.addEventListener("resize", measure);
    return () => win.removeEventListener("resize", measure);
  }, [open, count, win]);
  useEffect(() => {
    if (open) setPage(0);
  }, [open]);
  const pageSize = place?.pageSize ?? Infinity;
  const shown = pageOf(mine, pageSize, page);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const el = e.target as Node | null;
      if (el && (pop.current?.contains(el) || anchor.current?.contains(el))) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "PageUp" || e.key === "PageDown") {
        if (shown.pages < 2) return;
        e.preventDefault();
        e.stopPropagation();
        setPage(Math.min(Math.max(0, shown.page + (e.key === "PageDown" ? 1 : -1)), shown.pages - 1));
        return;
      }
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    win.addEventListener("pointerdown", down, true);
    win.addEventListener("keydown", key, true);
    return () => {
      win.removeEventListener("pointerdown", down, true);
      win.removeEventListener("keydown", key, true);
    };
  }, [open, shown.page, shown.pages, win]);
  if (!mine.length) return null;
  const two = place?.columns === 2;
  const style: CSSProperties = place
    ? { top: place.top, bottom: place.bottom, left: place.left, width: place.width, maxHeight: place.maxHeight }
    : { visibility: "hidden", width: POP_W };
  const where = (s: ServiceView) => serviceStatusLine(t(serviceHealthKey(s)), serviceWhere(s, t("svcLink.static"), t("services.worker.badge")));
  const label = t("svcLink.count", { n: mine.length });
  return (
    <>
      <button
        ref={anchor}
        data-side-nodrag
        data-conv-item="network"
        onClick={() => setOpen(!open)}
        data-tip={`${label} · ${t("svcLink.countTip")}`}
        aria-label={label}
        data-services-compact={compact || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        // Tag-shaped (design 040 §2, the header's 「● 1 个服务」): the services (server) icon and a health dot.
        className={`flex h-[18px] shrink-0 items-center gap-1 rounded-chip px-1.5 text-caption leading-none font-medium whitespace-nowrap hover:bg-hover hover:text-foreground ${open ? "bg-hover text-foreground" : "bg-surface-2 text-muted"}`}
      >
        <Server size={12} aria-hidden />
        <span aria-hidden data-svc-health={up ? "up" : "down"} className={`size-1.5 shrink-0 rounded-full ${up ? "bg-ok" : "bg-subtle"}`} />
        {compact ? mine.length : label}
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            role="dialog"
            aria-label={t("svcLink.title", { name: agentName })}
            data-agent-services={sessionId}
            data-services-columns={place?.columns}
            data-services-page={shown.pages > 1 ? `${shown.page + 1}/${shown.pages}` : undefined}
            data-side-nodrag
            style={style}
            className="float fixed z-[160] flex flex-col p-2 text-xs"
          >
            <div className="flex shrink-0 items-center gap-1.5 px-1.5 pt-0.5 text-ui/[inherit] font-semibold text-foreground">
              <Server size={13} />
              <span className="min-w-0 truncate">{t("svcLink.title", { name: agentName })}</span>
            </div>
            <p className="shrink-0 px-1.5 pt-0.5 pb-1.5 text-caption/[inherit] leading-snug text-subtle">{t("svcLink.sub")}</p>
            <div data-agent-services-list="" style={shown.pages > 1 ? { minHeight: (pageSize / 2) * ROW_H_COMPACT } : undefined} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${two ? "grid grid-cols-2 content-start gap-x-1" : ""}`}>
            {shown.rows.map((s) => {
              const worker = isWorker(s);
              const there = !worker && inShelf(s.slug);
              const withAgent = withAgentOn(on, hostId, s.slug);
              const name = s.displayName || s.slug;
              const openIt = () => {
                setOpen(false);
                openFromHeader(paneId, hostId, sessionId, s);
              };
              if (two)
                return (
                  <div key={s.slug} data-agent-service={s.slug} data-in-shelf={there || undefined} className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2/60">
                    <span className={`size-2 shrink-0 rounded-full ${healthDot(s.health)}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ui/[inherit] font-medium text-foreground" title={name}>{name}</div>
                      <div className="truncate text-caption/[inherit] text-subtle" data-agent-service-status="">{where(s)}</div>
                    </div>
                    {worker ? <button type="button" data-agent-service-manage={s.slug} onClick={openIt} title={t("services.worker.manageHint")} className="flex h-6 shrink-0 items-center rounded-md border border-border px-2 text-meta/[inherit] text-muted hover:bg-hover hover:text-foreground">{t("services.worker.manage")}</button> : <>
                    <button
                      type="button"
                      data-agent-service-with={s.slug}
                      aria-pressed={withAgent}
                      aria-label={t("svcLink.withAgent")}
                      title={`${t("svcLink.withAgent")} · ${t("svcLink.withAgentHint")}`}
                      onClick={() => setWithAgent(hostId, s.slug, !withAgent)}
                      className={`flex size-6 shrink-0 items-center justify-center rounded-md ${withAgent ? "bg-accent/15 text-accent" : "text-subtle hover:bg-hover hover:text-foreground"}`}
                    >
                      <Link2 size={13} />
                    </button>
                    <button
                      type="button"
                      data-agent-service-open={there ? "locate" : "open"}
                      aria-label={t(there ? "svcLink.locate" : "svcLink.open")}
                      title={t(there ? "svcLink.locate" : "svcLink.open")}
                      onClick={openIt}
                      className={`flex size-6 shrink-0 items-center justify-center rounded-md ${there ? "border border-border text-muted hover:bg-hover hover:text-foreground" : "bg-accent text-white hover:opacity-90"}`}
                    >
                      {there ? <LocateFixed size={13} /> : <PanelRightOpen size={13} />}
                    </button>
                    </>}
                  </div>
                );
              return (
                <div key={s.slug} data-agent-service={s.slug} data-in-shelf={there || undefined} className="rounded-lg px-1.5 py-1.5 hover:bg-surface-2/60">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 shrink-0 rounded-full ${healthDot(s.health)}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ui/[inherit] font-medium text-foreground">{name}</div>
                      <div className="truncate text-caption/[inherit] text-subtle" data-agent-service-status="">
                        {where(s)}
                      </div>
                    </div>
                    {worker ? <button type="button" data-agent-service-manage={s.slug} onClick={openIt} title={t("services.worker.manageHint")} className="flex h-6 shrink-0 items-center rounded-md border border-border px-2 text-meta/[inherit] text-muted hover:bg-hover hover:text-foreground">{t("services.worker.manage")}</button> : <button
                      data-agent-service-open={there ? "locate" : "open"}
                      onClick={openIt}
                      className={`flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-meta/[inherit] ${there ? "border border-border text-muted hover:bg-hover hover:text-foreground" : "bg-accent text-white hover:opacity-90"}`}
                    >
                      {there && <Check size={12} />}
                      {t(there ? "svcLink.locate" : "svcLink.open")}
                    </button>}
                  </div>
                  {!worker && <label className="mt-1 ml-4 flex cursor-pointer items-center gap-1.5 text-caption/[inherit] text-subtle" title={t("svcLink.withAgentHint")}>
                    <input type="checkbox" data-agent-service-with={s.slug} checked={withAgent} onChange={(e) => setWithAgent(hostId, s.slug, e.target.checked)} className="size-3 accent-[var(--accent)]" />
                    {t("svcLink.withAgent")}
                  </label>}
                </div>
              );
            })}
            </div>
            {shown.pages > 1 && (
              <div className="flex shrink-0 items-center justify-end gap-1 px-1.5 pt-1" data-agent-services-pager="" role="group" aria-label={t("svcLink.pages", { page: shown.page + 1, pages: shown.pages })}>
                <button type="button" data-services-prev="" disabled={shown.page === 0} onClick={() => setPage(shown.page - 1)} title={t("svcLink.prevPage")} aria-label={t("svcLink.prevPage")} className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent">
                  <ChevronLeft size={14} />
                </button>
                <span className="min-w-8 text-center text-caption/[inherit] text-muted tabular-nums" aria-hidden>
                  {shown.page + 1}/{shown.pages}
                </span>
                <button type="button" data-services-next="" disabled={shown.page === shown.pages - 1} onClick={() => setPage(shown.page + 1)} title={t("svcLink.nextPage")} aria-label={t("svcLink.nextPage")} className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent">
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
            <p className="mt-1 shrink-0 border-t border-border px-1.5 pt-1.5 text-caption/[inherit] text-subtle">{t("svcLink.foot", keyVar("quickSwitch"))}</p>
          </div>,
          win.document.body,
        )}
    </>
  );
}
