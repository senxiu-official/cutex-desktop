// Services ↔ the agents that made them (canvas principles §7 「服务和智能体」, owner 2026-10-21; prototype
// .claude/preview-workspaces.html scenario #service). A service pane is an in-app browser tab on
// `cutex:service/<slug>…`; the service's owner is `ServiceView.ownerCutexSessionId`.
//   • The service pane offers 「打开 <owner>」 (lib/workspaces: a click = side by side, ▾ = 投影到这个 Shelf /
//     替换, or drag it out) — not when the service has no owner, the owner is gone, or this is the owner's own
//     Shelf. Editing goes through the conversation: its header lists the agent's services; one opened from
//     there goes into THIS conversation's Shelf linked to the agent (the pane shows the agent's avatar).
//   • 断开 on a linked pane: the link goes (no avatar), the pane stays exactly where it is (not a shared page),
//     and the service is pinned to the tray / desktop list (lib/trayPins; undo toast). Opened later from the
//     tray in another conversation, it goes into that conversation's Shelf (lib/workspaces openRef).
//   • 「和它的智能体一起打开」 per service (default off, this device): when the owner's workspace opens (its
//     conversation becomes the focused one), the service opens in its Shelf too, unless it is there already.
// The link is the browser tab's state (`linked`: the agent's session id, a label only). Shell code: the browser
// tab is opened by component id, like lib/services.ts does.
import { create } from "zustand";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { ServiceView, SidebarSnapshot } from "../../../shared/ipc";
import { translate } from "../i18n";
import { services as appServices } from "../modules/app";
import { sidebarOf, useApp } from "../store";
import { convKey, parseConvKey } from "./convShelves";
import { hostData } from "./hostScope";
import { conversationPanes } from "./paneLayout";
import { focusConversationPane, usePanes } from "./paneStore";
import type { SideLayout } from "./sideLayout";
import { liveConversation, peekConvShelf, updateLayout, useConvShelfVersion, useSide } from "./sideLayoutStore";
import { sideReveal, sideShowsHost } from "./sideServices";
import { showShelfToast } from "./shelves";
import { trayPins, type TrayPinRef } from "./trayPins";

/** The in-app browser tab (module `browser`, opened by id — never imported). */
export const SERVICE_TAB = "browser.tab";

const SERVICE_URL = /^cutex:service\/([a-z0-9][a-z0-9-]{0,62})(?:[/?]|$)/;

/** The service a browser tab's address shows (`cutex:service/<slug>…`), else null. */
export function serviceSlugOf(url: unknown): string | null {
  return typeof url === "string" ? (SERVICE_URL.exec(url)?.[1] ?? null) : null;
}

/** A service's in-app address (the root, like 服务 → 打开). */
export const serviceUrl = (slug: string): string => `cutex:service/${slug}/`;

// ── Service panes in a Shelf (pure) ──────────────────────────────────────────────────────────────

export interface ServicePane {
  id: string;
  /** The agent it is linked to (its session id), null = not linked. */
  linked: string | null;
}

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The tabs showing service `slug` of `hostId` in a layout (a Shelf), oldest id first. */
export function servicePanes(layout: SideLayout | null, hostId: string, slug: string): ServicePane[] {
  if (!layout) return [];
  const out: ServicePane[] = [];
  for (const [id, inst] of Object.entries(layout.instances)) {
    if (inst.kind !== SERVICE_TAB || inst.binding.hostId !== hostId) continue;
    const st = record(inst.state);
    if (!st || serviceSlugOf(st.url) !== slug) continue;
    out.push({ id, linked: typeof st.linked === "string" ? st.linked : null });
  }
  return out;
}

/** The layout with instance `id`'s link set (null: removed); anything else: unchanged. */
export function withServiceLink(layout: SideLayout, id: string, linked: string | null): SideLayout {
  const inst = layout.instances[id];
  const st = record(inst?.state);
  if (!inst || !st || (st.linked ?? null) === linked) return layout;
  const { linked: _old, ...rest } = st;
  const state = (linked ? { ...rest, linked } : rest) as typeof inst.state;
  return { ...layout, instances: { ...layout.instances, [id]: { ...inst, state } } };
}

// ── The owner (pure) ─────────────────────────────────────────────────────────────────────────────

export interface ServiceOwner {
  sessionId: string;
  session: SessionResource;
}

/** The agent that made service `slug` (its host's records), while it is still one of the host's agents; else null. */
export function serviceOwner(list: readonly ServiceView[] | null | undefined, sidebar: SidebarSnapshot | null | undefined, slug: string): ServiceOwner | null {
  const id = list?.find((s) => s.slug === slug)?.ownerCutexSessionId;
  if (!id) return null;
  const session = sidebar?.active.find((r) => r.cutexSessionId === id);
  return session ? { sessionId: id, session } : null;
}

/** What a service pane's header shows about its agent. */
export type ServicePaneLook = { kind: "linked"; sessionId: string } | { kind: "owner"; sessionId: string } | { kind: "none" };

/**
 * A linked pane: the agent's avatar + 断开. Else 「打开 <owner>」 — unless the service has no owner, the owner
 * is gone, or the pane is in the owner's own Shelf (`shelfOf`: the session whose Shelf shows it). Pure.
 */
export function servicePaneLook(input: { linked: string | null; owner: string | null; shelfOf: string | null }): ServicePaneLook {
  if (input.linked) return { kind: "linked", sessionId: input.linked };
  if (!input.owner || input.owner === input.shelfOf) return { kind: "none" };
  return { kind: "owner", sessionId: input.owner };
}

/** The services an agent made on its host, by name. */
export function agentServices(list: readonly ServiceView[] | null | undefined, sessionId: string): ServiceView[] {
  return (list ?? []).filter((s) => s.ownerCutexSessionId === sessionId).sort((a, b) => (a.displayName || a.slug).localeCompare(b.displayName || b.slug));
}

// ── 和它的智能体一起打开 (per service, this device) ──────────────────────────────────────────────────

export type WithAgent = Readonly<Record<string, true>>;

const optionKey = (hostId: string, slug: string) => `${hostId}\n${slug}`;

export const useServiceWithAgent = create<{ on: WithAgent }>(() => ({ on: {} }));

let persist: (on: WithAgent) => void = () => {};

/** Stored choices as read back (anything but `true` dropped). */
export function readWithAgent(raw: unknown): WithAgent {
  const r = record(raw);
  if (!r) return {};
  const out: Record<string, true> = {};
  for (const [k, v] of Object.entries(r)) if (v === true && k.includes("\n")) out[k] = true;
  return out;
}

/** Seeded by the module that keeps the choice (services: its prefs on this device). */
export function initServiceWithAgent(read: () => unknown, write: (on: WithAgent) => void): void {
  useServiceWithAgent.setState({ on: readWithAgent(read()) });
  persist = write;
}

export const withAgentOn = (on: WithAgent, hostId: string, slug: string): boolean => !!on[optionKey(hostId, slug)];

export function setWithAgent(hostId: string, slug: string, value: boolean): void {
  const key = optionKey(hostId, slug);
  const { [key]: _old, ...rest } = useServiceWithAgent.getState().on;
  const on: WithAgent = value ? { ...rest, [key]: true } : rest;
  useServiceWithAgent.setState({ on });
  persist(on);
}

// ── Opening ──────────────────────────────────────────────────────────────────────────────────────

/** A conversation's Shelf as it is now: the live one when it has the focus, else its remembered one. */
export function shelfOfConversation(hostId: string, sessionId: string): SideLayout | null {
  const key = convKey(hostId, sessionId);
  return liveConversation() === key ? useSide.getState().layout : peekConvShelf(key);
}

export type ServiceOpenResult = "opened" | "located" | "unavailable";

/**
 * Service `slug` into the Shelf of the workspace `paneId` (default: the focused one; it gets the focus, so
 * its Shelf is the live one). Already there: shown (定位). Else a new tab, linked to `linkTo` when given.
 */
export function openServiceInShelf(hostId: string, slug: string, opts: { paneId?: string; linkTo?: string; focus?: boolean; reveal?: boolean } = {}): ServiceOpenResult {
  if (opts.paneId && conversationPanes(usePanes.getState().layout).includes(opts.paneId)) focusConversationPane(opts.paneId);
  const there = servicePanes(useSide.getState().layout, hostId, slug)[0];
  if (there) return sideReveal({ instanceId: there.id }).status === "unavailable" ? "unavailable" : "located";
  if (!sideShowsHost(hostId)) return "unavailable";
  try {
    const params = { url: serviceUrl(slug), ...(opts.linkTo ? { linked: opts.linkTo } : {}) };
    const r = appServices.side.open(SERVICE_TAB, params, { binding: { kind: "host", hostId }, reveal: opts.reveal ?? true, focus: opts.focus ?? true });
    return r.status === "opened" ? "opened" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** The conversation header's row: into THIS conversation's Shelf, linked to its agent (定位 when there). */
export function openFromHeader(paneId: string, hostId: string, sessionId: string, service: Pick<ServiceView, "slug" | "displayName">): ServiceOpenResult {
  const r = openServiceInShelf(hostId, service.slug, { paneId, linkTo: sessionId });
  if (r === "unavailable") useApp.getState().notify(translate("svcLink.openFailed", { name: service.displayName || service.slug }), "error");
  return r;
}

/** Sets the link of a pane in the live Shelf (null: removed). */
export function setServiceLink(instanceId: string, linked: string | null): void {
  updateLayout((l) => withServiceLink(l, instanceId, linked));
}

/**
 * 断开: the link goes, the pane stays where it is in this conversation's Shelf (never a shared page), and the
 * service is pinned to the tray / desktop (when it was not already). The toast's 撤销 links it again and
 * takes back a pin it added.
 */
export async function unlinkServicePane(instanceId: string, hostId: string, slug: string, name: string): Promise<void> {
  const inst = useSide.getState().layout.instances[instanceId];
  const linked = record(inst?.state)?.linked;
  if (typeof linked !== "string") return;
  setServiceLink(instanceId, null);
  const pins = trayPins();
  const ref: TrayPinRef = { hostId, kind: "service", key: slug, title: name };
  const was = !!pins?.isPinned(ref);
  let added = false;
  if (pins && !was) {
    try {
      added = await pins.pin(ref);
    } catch {
      added = false;
    }
  }
  showShelfToast(translate(was || added ? "svcLink.unlinked" : "svcLink.unlinkedNoPin", { name }), () => {
    if (useSide.getState().layout.instances[instanceId]) setServiceLink(instanceId, linked);
    if (added) void pins?.unpin(ref).catch(() => false);
  });
}

// ── Opening with the agent ───────────────────────────────────────────────────────────────────────

/**
 * The services of the agent whose workspace is open now that go with it (「和它的智能体一起打开」 on) and are not
 * in its Shelf: their slugs. Pure.
 */
export function servicesToOpen(list: readonly ServiceView[] | null | undefined, on: WithAgent, layout: SideLayout | null, hostId: string, sessionId: string): string[] {
  return agentServices(list, sessionId)
    .filter((s) => withAgentOn(on, hostId, s.slug) && servicePanes(layout, hostId, s.slug).length === 0)
    .map((s) => s.slug);
}

/** Opens what goes with the focused conversation's agent (in its Shelf, linked to it; the focus stays put). */
export function openWithAgent(): void {
  const key = liveConversation();
  const k = key ? parseConvKey(key) : null;
  if (!k) return;
  const s = useApp.getState();
  const list = hostData(s, k.hostId)?.services;
  if (!sidebarOf(s, k.hostId)?.active.some((r) => r.cutexSessionId === k.sessionId)) return;
  for (const slug of servicesToOpen(list, useServiceWithAgent.getState().on, useSide.getState().layout, k.hostId, k.sessionId)) {
    openServiceInShelf(k.hostId, slug, { linkTo: k.sessionId, focus: false, reveal: true });
  }
}

/** Follows the focused conversation (its Shelf becoming the live one): its agent's services that go with it open. */
export function startServiceWithAgent(signal?: AbortSignal): () => void {
  let last = liveConversation();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const off = useConvShelfVersion.subscribe(() => {
    const now = liveConversation();
    if (now === last) return;
    last = now;
    if (!now) return;
    // After the switch has settled (its Shelf restored), and only if it is still the one in focus.
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (liveConversation() === now) openWithAgent();
    }, 0);
  });
  const stop = () => {
    off();
    if (timer) clearTimeout(timer);
  };
  signal?.addEventListener("abort", stop, { once: true });
  return stop;
}
