// Quick-switch items from the data the app already holds (built once per data change, never per
// keystroke): the merged sidebar rows of the view scope, each host's service list, the artifact lists
// fetched when the palette opens (artifacts.ts), the `nav.primary` pages and the Shelf pages. Pure.
import { BarChart3, ClipboardList, Database, FileBox, FileText, Server, Plus, Send, Table2 } from "lucide-react";
import type { ArtifactKind, ArtifactSummary } from "../../../../shared/artifactStore";
import type { ServiceView } from "../../../../shared/ipc";
import type { MessageKey } from "../../i18n";
import type { AgentSignal } from "../../lib/agentAttention";
import type { AgentRow, SidebarGroup } from "../../lib/sidebar";
import type { Icon, NavItem } from "../slots";
import type { QsBadge, QsItem } from "./model";
import type { ShelfPageInfo } from "./shelfPages";
import { bindingLabel } from "../../lib/keybindings";
import { realAgentName } from "../../lib/agentAlias";
import { withKey } from "../../lib/useKeybindings";

export type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
/** A host's state in the view scope (lib/scopedSidebarView HostSidebarState). */
export type HostState = "live" | "loading" | "offline";

const SIGNAL_ORDER: Record<AgentSignal, number> = { needsYou: 0, running: 1, error: 2, done: 2, idle: 3, unknown: 4, offline: 5 };

function agentBadge(signal: AgentSignal | undefined, t: T): QsBadge | undefined {
  switch (signal) {
    case "needsYou":
      return { text: t("quick-switch.status.needsYou"), tone: "attention" };
    case "running":
      return { text: t("quick-switch.status.running"), tone: "accent" };
    case "done":
      return { text: t("quick-switch.status.done"), tone: "accent" };
    case "error":
      return { text: t("quick-switch.status.error"), tone: "danger" };
    case "offline":
      return { text: t("quick-switch.status.offline"), tone: "muted" };
    default:
      return undefined;
  }
}

export interface AgentSource {
  groups: readonly SidebarGroup[];
  chats: readonly AgentRow[];
  /** Row key (lib/sidebar rowKey) → signal (lib/scopedSidebarView useScopedAttention). */
  signals: ReadonlyMap<string, AgentSignal>;
  stateOf(hostId: string | undefined): HostState;
  /** The focus host (rows without a hostId belong to it). */
  focus: string;
}

/** Every agent of the scope: attention first (需要你, running, new result), then the latest activity. */
export function agentItems(src: AgentSource, t: T): QsItem[] {
  const rows: { row: AgentRow; group: string | null }[] = [];
  for (const g of src.groups) for (const row of [...g.online, ...g.offline]) rows.push({ row, group: g.kind === "project" ? g.name : null });
  for (const row of src.chats) rows.push({ row, group: t("quick-switch.chats") });
  const items = rows.map(({ row, group }) => {
    const hostId = row.hostId ?? src.focus;
    const key = row.key ?? row.id;
    const signal = src.signals.get(key);
    const offlineHost = src.stateOf(hostId) === "offline";
    // Under an owner-set 显示名称 the agent's own name finds it too (as in the sidebar filter, lib/agentAlias).
    const own = row.session.cutexSessionId ? realAgentName(row.session) : row.name;
    const item: QsItem = {
      id: `agent:${hostId}:${row.id}`,
      kind: "agent",
      title: row.name,
      subtitle: group ?? t("quick-switch.noProject"),
      terms: [row.id, ...(own && own !== row.name ? [own] : []), ...(row.profile ? [row.profile] : []), ...(row.subtitle ? [row.subtitle] : [])],
      hostId,
      rank: 0,
      ...(offlineHost ? { disabled: true } : {}),
      badge: offlineHost ? { text: t("quick-switch.status.hostOffline"), tone: "muted" } : agentBadge(signal, t),
      lead: { kind: "avatar", name: row.name, color: row.color, seed: row.session.cutexSessionId ?? row.id, ...(row.initial ? { initial: row.initial } : {}), avatar: row.session.avatar },
      target: { kind: "agent", hostId, sessionId: row.id },
    };
    return { item, order: SIGNAL_ORDER[signal ?? (row.status === "offline" ? "offline" : "idle")] + (offlineHost ? 10 : 0), at: row.lastActivity };
  });
  items.sort((a, b) => a.order - b.order || b.at - a.at);
  return items.map((x, i) => ({ ...x.item, rank: i }));
}

export interface ServiceSource {
  hostId: string;
  services: readonly ServiceView[];
  state: HostState;
}

export function serviceItems(hosts: readonly ServiceSource[], t: T): QsItem[] {
  const out: QsItem[] = [];
  for (const h of hosts) {
    for (const s of h.services) {
      const name = s.displayName?.trim() || s.slug;
      const stopped = s.health === "stopped" || s.health === "unreachable" || s.health === "crashLooped";
      out.push({
        id: `service:${h.hostId}:${s.slug}`,
        kind: "service",
        title: name,
        subtitle: t(s.runtime === "worker" ? "quick-switch.sub.worker" : "quick-switch.sub.service", { slug: s.slug }),
        terms: [s.slug],
        hostId: h.hostId,
        rank: 0,
        ...(h.state === "offline" ? { disabled: true, badge: { text: t("quick-switch.status.hostOffline"), tone: "muted" as const } } : stopped ? { badge: { text: t("quick-switch.status.stopped"), tone: "muted" as const } } : {}),
        lead: { kind: "icon", icon: Server, tone: "service" },
        // A background service (cutex `worker`) has no page for a browser tab: the 服务 page, searched to it
        // (lib/serviceWorker showWorker; "services.page" is that page's nav item).
        target: s.runtime === "worker" ? { kind: "page", page: "services.page", params: { q: s.slug } } : { kind: "service", hostId: h.hostId, slug: s.slug },
      });
    }
  }
  // Running first, then by name.
  out.sort((a, b) => Number(!!a.badge) - Number(!!b.badge) || a.title.localeCompare(b.title));
  return out.map((item, i) => ({ ...item, rank: i }));
}

export const ARTIFACT_ICON: Record<ArtifactKind, Icon> = { report: FileText, figure: BarChart3, table: Table2, data: Database, plan: ClipboardList, handoff: Send, other: FileBox };

export interface ArtifactSource {
  hostId: string;
  project: string;
  items: readonly ArtifactSummary[];
}

/** Newest first (`updatedAt`), one row per artifact (latest version). */
export function artifactItems(lists: readonly ArtifactSource[], t: T): QsItem[] {
  const out: { item: QsItem; at: string }[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const a of list.items) {
      const id = `artifact:${list.hostId}:${a.artifactId}`;
      if (seen.has(id) || a.archivedAt) continue;
      seen.add(id);
      out.push({
        at: a.updatedAt,
        item: {
          id,
          kind: "artifact",
          title: a.name,
          subtitle: t("quick-switch.sub.artifact", { project: list.project, n: a.latestVersion }),
          terms: [a.artifactId, t(`artifacts.kind.${a.kind}` as MessageKey)],
          hostId: list.hostId,
          rank: 0,
          lead: { kind: "icon", icon: ARTIFACT_ICON[a.kind] ?? FileBox, tone: "artifact" },
          target: { kind: "artifact", hostId: list.hostId, ref: `${a.artifactId}@latest`, name: a.name },
        },
      });
    }
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out.map((x, i) => ({ ...x.item, rank: i }));
}

export interface PageSource {
  item: NavItem;
  /** Shown but not openable (unavailable on this host). */
  disabled: boolean;
}

/** The sidebar's pages (`nav.primary`, top list then footer), in their order. */
export function pageItems(entries: readonly PageSource[], t: T): QsItem[] {
  return entries.map(({ item, disabled }, i) => {
    const title = item.title?.trim() || t(item.titleKey);
    return {
      id: `page:${item.id}`,
      kind: "page" as const,
      title,
      subtitle: t(item.area === "footer" ? "quick-switch.sub.footer" : "quick-switch.sub.page"),
      terms: ["page" in item.target ? item.target.page : item.id],
      rank: i,
      ...(disabled ? { disabled: true } : {}),
      lead: { kind: "icon" as const, icon: item.icon, tone: "page" },
      target: "page" in item.target ? { kind: "page" as const, page: item.target.page, ...(item.target.params ? { params: item.target.params } : {}) } : { kind: "run" as const, run: item.target.run },
    };
  });
}

/** 新建空页 at the end of the Shelf pages (lib/sideActions newPage: also the first page, when there is none). */
export function newShelfPageItem(t: T, run: () => void, rank: number): QsItem {
  return {
    id: "shelf:new",
    kind: "shelfPage",
    title: t("side.newPage"),
    subtitle: withKey(t("quick-switch.sub.newShelfPage"), bindingLabel("sideNewPage")),
    terms: ["new page", "empty page"],
    rank,
    lead: { kind: "icon", icon: Plus, tone: "shelf" },
    target: { kind: "run", run },
  };
}

/** The Shelves' pages (lib/shelves order: left Shelf first, rail order); the one in view is marked. */
export function shelfPageItems(pages: readonly ShelfPageInfo[], t: T): QsItem[] {
  return pages.map((p, i) => ({
    id: `shelf:${p.shelfId}:${p.pageId}`,
    kind: "shelfPage" as const,
    title: p.name,
    subtitle: t(p.side === "left" ? "quick-switch.sub.shelfLeft" : "quick-switch.sub.shelfRight", { n: p.index }),
    terms: [p.pageId],
    rank: i,
    ...(p.current ? { badge: { text: t("quick-switch.status.showing"), tone: "muted" as const } } : {}),
    lead: { kind: "icon" as const, icon: p.icon, tone: "shelf" },
    target: { kind: "shelfPage" as const, shelfId: p.shelfId, pageId: p.pageId },
  }));
}
