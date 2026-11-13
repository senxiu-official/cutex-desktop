import { BackgroundOperations } from "../../components/BackgroundOperations";
import { AgentBadgeEditor } from "../../components/AgentBadgeEditor";
import { featuresOf as hostFeatures } from "../../store";
import { isOwnerFeatures } from "../../../../shared/users";
// The tray's items (`pane.desktop` Dock, contract 1.20; docs/design/001-tray-taskbar.md 托盘 = 任务栏, owner 2026-10-21;
// docs/design/039-workspace-groups.md, owner 2026-10-23):
//   left   — 钉住: the agents (or groups of them) the owner pinned: fixed order; ONE upright red pushpin stands just left
//            of the divider after them (owner 2026-10-24 「图钉 + 拖动」; no pin per item any more)
//   then a thin divider, 最近: every workspace that was on screen, newest first, at most MAX_RECENT (lib/workspaceSets);
//   a workspace of several agents side by side is ONE entry, a capsule holding their avatars
//   right  — apps (rounded squares): pinned services / artifacts / pages / links (the home pins, same list as the desktop tiles)
// Every agent entry has a hover × at its top-right: it leaves the tray (a pinned one is unpinned; one on screen closes its
// columns — the whole screen: the next entry takes it, trayNext). Marks (trayOrder.ts): on screen = a bar under the icon; folded to a strip = a hollow bar; open = a small dot;
// only pinned = none; plus 需要你 (a number), running (a spinning ring), unread / error dots. At the far end 「返回上一个」
// (when there is a step) and 「需要你 N」.
// Each item's hover preview (lib/foretell, 008) and its click come from the SAME effect object (lib/workspaceEffects
// agentEffect / refEffect): a plain click on an agent = its own workspace (the one on screen stays whole in the tray),
// Ctrl/⌘ = beside. Right-click: 钉到托盘 / 取消固定 (with 撤销), 拆出, 关闭, 打开方式 (a pinned single agent). Dragging an
// entry across the divider pins / unpins it, with 撤销 (trayReorder). The shell draws the
// frame (components/ChipTray); menus open at the pointer (lib/trayMenu).
import { useShelfOnlyPanes } from "../../lib/shelfOnly";
import { trayLeaveForetell } from "../../lib/menuForetells";
import { useEffect, useMemo, type ReactNode } from "react";
import { ArrowLeft, Check, FileBox, Server, LayoutDashboard, Link2, X } from "lucide-react";
import { TrayNeedsYou } from "../../components/NeedsYou";
import { parsePagePinKey, type HomeDoc, type HomePin } from "../../../../shared/home";
import { usePagePinKind, type PagePinKind } from "../../lib/pagePins";
import { translate, useI18n, type MessageKey } from "../../i18n";
import type { MenuEntry } from "../../lib/contextMenu";
import { openTrayMenu } from "../../lib/trayMenu";
import { hostData } from "../../lib/hostScope";
import { usePanes } from "../../lib/paneStore";
import { useInWindow } from "../../lib/windowScope";
import { useSide } from "../../lib/sideLayoutStore";
import { closeWorkspace, isOnScreen, screenOf, startWorkspaceDrag, type WorkspaceOpenMode } from "../../lib/workspaces";
import { pinnedDragLocal, stepTarget, trayDragLocal, TrayDropMarks, useTrayDragFrom, type TrayFrom } from "./trayReorder";
import { useScopedAttention, useScopedSidebar } from "../../lib/scopedSidebarView";
import { showShelfToast } from "../../lib/shelves";
import type { AgentRow } from "../../lib/sidebar";
import { useStripPanes } from "../../lib/convStrips";
import { useForetell, withHandlers, type Foretell } from "../../lib/foretell";
import { closeOpen, useTrayOpen } from "../../lib/trayOpen";
import { paneArea } from "../../lib/foretellAreas";
import { trayPinSupported } from "../../lib/trayPins";
import { agentEffect, goBackOne, refEffect, type Effect } from "../../lib/workspaceEffects";
import { agentKey, rememberSet, removeAgentFromSets, setPinnedAgents, splitAgentOut, useWorkspaceSets, type AgentId } from "../../lib/workspaceSets";
import { Avatar } from "../../components/Avatar";
import { avatarBadge } from "../../lib/avatarStatus";
import type { NeedsYou } from "../../lib/agentAttention";
import { useApp } from "../../store";
import type { PaneDockProps } from "../slots";
import { agentBadge, badgeLabelKey, pageBadge, dockRef, dockPins, OPEN_MODES, openModeOf, serviceBadge, setOpenMode, useDockModes, type DockBadge, type OpenMode } from "./dockModes";
import { useHomeSource, useServiceView } from "./hooks";
import { isOnDesk, pinId, pinsOf, withPin, withPinAt, withPinBefore, withPinMoved, withoutDeskIcon, withoutPin } from "./model";
import { withIconOnDesk } from "./deskDrop";
import { openFailedText, openPinAs, serviceOutOfView, showOpenFailed } from "./open";
import { agentEntryId, type TrayMark } from "./trayOrder";
import { allEntries, groupPin, trayEntries, withGroupPin, type TrayEntry } from "./trayEntries";
import { nextAfterClose } from "./trayNext";
import { AGENT_NOTE_MAX, APP_NOTE_MAX, noteLine, noteText, openNoteEdit, pinNote, withPinNote } from "./trayNotes";
import { TrayNoteEditor } from "./TrayNoteEditor";
import { setAgentNote } from "../../lib/menus";
import { operatorMenuItem } from "../../lib/operatorMenu";

const ICON = 32;


/** Web / service / artifact / page icons sit on one neutral square (design 040 §2): the colour is the avatars'. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <span className="tray-glyph tray-glyph-tool">
      {children}
    </span>
  );
}

function Badge({ badge }: { badge: DockBadge }) {
  // Running: the spinning ring round the icon (TrayButton), not a dot. Agents draw both on their avatars (Avatar `status`).
  if (!badge.dot || badge.dot === "running") return null;
  return (
    <span className="tray-badge" data-dot={badge.dot}>
      {badge.count !== null ? (badge.count > 9 ? "9+" : badge.count) : null}
    </span>
  );
}

/** Re-read on every pane / Shelf change (what is on screen). */
function useScreenTick(): void {
  usePanes((s) => s.layout);
  useSide((s) => s.layout);
}

import { AgentBadge } from "../../components/AgentBadge";
import { isWorkerOn } from "../../lib/serviceWorker";
import { avatarCarriesMark } from "../../lib/projectMark";

interface ButtonProps {
  ownerBadge?: ReactNode;
  name: string;
  /** Round (an agent) or a rounded square (an app). */
  round: boolean;
  /** Several agents side by side: the item is a capsule holding their avatars (each a `data-member`). */
  capsule?: boolean;
  icon: ReactNode;
  badge: DockBadge;
  mark: TrayMark;
  /** The click's effect (null: no preview, `click` instead). `member`: the avatar of a capsule that was under the pointer. */
  effect: ((beside: boolean, member: string | null) => Effect) | null;
  click(beside: boolean, member: string | null): void;
  /** Dragged out (the workspace drag rules). */
  drag?: (e: React.PointerEvent, member: string | null) => void;
  /** Its right-click menu (`item`: the tray item, where 「备注…」 opens). */
  menu(item: HTMLElement): MenuEntry[];
  /** Its note (owner 2026-10-24): the first line is written on the item, the whole note in the tooltip and 「… N」's list. */
  note?: string | null;
  /** The hover × (null: none). */
  close: Effect | null;
  pinKind: string;
  onUsed(): void;
  /** A pinned agent entry: its pin id (the reorder drag finds it by `data-tray-entry`). */
  entryId?: string;
  /** Alt+← / → (↑ / ↓ in a vertical tray): one step left (-1) / right (1); false = it cannot go there. */
  onMove?(dir: -1 | 1): boolean;
}

/** The capsule avatar under the pointer (its `data-member` = agentEntryId), or null. */
const memberOf = (target: EventTarget | null): string | null => (target as HTMLElement | null)?.closest?.("[data-member]")?.getAttribute("data-member") ?? null;

/** The pushpin (answers.json `pin-style`: red, owner 2026-10-23), standing upright, the needle straight down (owner 2026-10-24). */
function Pushpin() {
  return (
    <svg className="tray-pushpin" viewBox="0 0 12 18" width="11" height="17" aria-hidden>
      <path d="M5.3 9.5 L6 17.4 L6.7 9.5 Z" className="tray-pushpin-needle" />
      <circle cx="6" cy="5.4" r="5.1" className="tray-pushpin-halo" />
      <circle cx="6" cy="5.4" r="4.4" className="tray-pushpin-head" />
      <ellipse cx="4.6" cy="3.9" rx="1.6" ry="1" transform="rotate(-30 4.6 3.9)" className="tray-pushpin-shine" />
    </svg>
  );
}

/**
 * The one pushpin of the tray, stuck into the divider after the pinned entries near its top, head on its left (vertical:
 * near its start, head above) — out of the icon row (owner 2026-10-24): everything before it is pinned. Not a button (a slip would unpin them all): its tooltip says how to pin / unpin by dragging, and a drag
 * dropped on it pins at the pinned group's end (trayReorder `data-tray-pin-edge`).
 */
function DividerPin() {
  const { t } = useI18n();
  return (
    <span className="tray-divpin" tabIndex={0} data-tray-pin-edge="" data-tip={t("tray.pin.tip")} aria-label={t("tray.pin.tip")} role="img">
      <Pushpin />
    </span>
  );
}

/** One tray item: icon, badge, mark, preview + click from one effect, the hover ×, the pin mark, its menu. */
function TrayButton({ name, ownerBadge, round, capsule, icon, badge, mark, effect, click, drag, menu, note = null, close, pinKind, onUsed, entryId, onMove }: ButtonProps) {
  const { t } = useI18n();
  const stateKey = badgeLabelKey(badge);
  const state = stateKey ? t(stateKey as MessageKey, { n: badge.count ?? 0 }) : "";
  const status = t(`tray.state.${mark}` as MessageKey);
  const label = [name, status, state].filter(Boolean).join(" · ");
  const line = noteLine(note);
  const full = noteText(note);
  const title = full ? `${label}
${full}` : label;
  const fh = useForetell((m) => effect?.(m.beside, null).foretell ?? null, { disabled: !effect });
  const closeFh = useForetell(() => close?.foretell ?? null, { disabled: !close });
  // The tooltip says the result now (computed as the pointer comes in, from the same effect as the click).
  const tip = (f: Foretell | null): string => {
    const lines = [title];
    if (f) {
      if (round && f.tone === "replace") lines.push(t("tray.switchTo", { name }));
      lines.push(f.text);
    }
    return lines.join("\n");
  };
  const open = (beside: boolean, member: string | null) => {
    click(beside, member);
    onUsed();
  };
  const handlers = withHandlers(
    {
      onPointerEnter: (e: React.PointerEvent<HTMLButtonElement>) => {
        e.currentTarget.title = tip(effect?.(false, null).foretell ?? null);
      },
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => drag?.(e, memberOf(e.target)),
    },
    fh,
  );
  const showMenu = (el: HTMLElement, at?: { x: number; y: number }) => openTrayMenu(el, menu(el), at);
  return (
    <span className="tray-slot" data-tray-slot={pinKind} data-tray-entry={entryId}>
      <button
        type="button"
        data-tray-item=""
        data-pin-kind={pinKind}
        data-mark={mark}
        data-round={round ? "" : undefined}
        data-capsule={capsule ? "" : undefined}
        data-on-screen={mark === "on" || mark === "strip" ? "" : undefined}
        data-has-note={line ? "" : undefined}
        data-tip={title}
        aria-label={label}
        {...handlers}
        onClick={(e) => open(e.ctrlKey || e.metaKey, memberOf(e.target))}
        // Middle-click = Ctrl/⌘-click (the alternate open: beside), like a sidebar row (window audit 2026-10-23 #4).
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          open(true, memberOf(e.target));
        }}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          showMenu(e.currentTarget, { x: e.clientX, y: e.clientY });
        }}
        onKeyDown={(e) => {
          // Alt+← / → (↑ / ↓): a pinned entry one step along its group (the tray's own arrows only move the focus).
          const dir = e.altKey && onMove ? ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as const)[e.key as "ArrowLeft"] : undefined;
          if (dir) {
            e.preventDefault();
            e.stopPropagation();
            onMove!(dir);
            return;
          }
          if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            showMenu(e.currentTarget);
          }
        }}
        className={`tray-item ${badge.dim ? "tray-item-dim" : ""}`}
      >
        {icon}
        {ownerBadge && <span className="pointer-events-none absolute -bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">{ownerBadge}</span>}
        {line && (
          <>
            <span className="tray-note" data-tray-label="">
              {line}
            </span>
            <span className="tray-note-full">{full}</span>
          </>
        )}
        {/* An agent's ring and badge are on its avatar (Avatar `status`, the same as the sidebar); `badge` still names its state and dims it. */}
        {!round && <Badge badge={badge} />}
        {mark !== "pinned" && <span className="tray-under" data-mark={mark} aria-hidden />}
      </button>
      {close && (
        <button type="button" tabIndex={-1} className="tray-x" aria-label={t("tray.closeTitle", { name })} {...closeFh} onClick={() => close.run()}>
          <X size={9} strokeWidth={2.6} aria-hidden />
        </button>
      )}
    </span>
  );
}

// ── Pins: 取消固定 / 钉到托盘 ───────────────────────────────────────────────────────────────────────

function usePinActions() {
  const { t } = useI18n();
  const home = useHomeSource();
  const unpin = (pin: HomePin, name: string) => {
    const index = (home.entry?.doc.pins ?? []).findIndex((p) => pinId(p) === pinId(pin));
    void home.update((d) => withoutPin(d, pinId(pin))).then((ok) => {
      if (ok) showShelfToast(t("home.dock.unpinned", { name }), () => void home.update((d) => withPinAt(d, pin, Math.max(0, index))));
    });
  };
  const pin = (p: HomePin) => void home.update((d) => withPin(d, p));
  /** A pinned entry moved before `beforeId` (null: its group's end); one 撤销 puts it back where it was. */
  const move = (p: HomePin, name: string, beforeId: string | null) => {
    const doc = home.entry?.doc;
    if (!doc || withPinBefore(doc, pinId(p), beforeId) === doc) return;
    const from = pinsOf(doc).findIndex((x) => pinId(x) === pinId(p));
    void home.update((d) => withPinBefore(d, pinId(p), beforeId)).then((ok) => {
      if (ok) showShelfToast(t("tray.moved", { name }), () => void home.update((d) => withPinMoved(d, pinId(p), from)));
    });
  };
  /**
   * Pins an entry: one agent as a plain pin, several as a group (the same pins store; its members leave their own pins),
   * before pinned entry `beforeId` (null: after the pinned ones). 撤销 takes the pin away and puts back what it replaced.
   */
  const pinEntry = (members: readonly AgentId[], name: string, beforeId: string | null = null) => {
    const doc = home.entry?.doc;
    if (!doc || !members.length) return;
    const id = pinId(groupPin(members, name));
    const edit = (d: HomeDoc) => withPinBefore(withGroupPin(d, members, name), id, beforeId);
    const pinned = edit(doc);
    if (pinned === doc) return;
    // The pins it replaced (a member's own pin), with where they were.
    const kept = new Set(pinsOf(pinned).map(pinId));
    const replaced = pinsOf(doc).flatMap((p, index) => (kept.has(pinId(p)) ? [] : [{ p, index }]));
    void home.update(edit).then((ok) => {
      if (ok) showShelfToast(t("tray.pinned", { name }), () => void home.update((d) => replaced.reduce((next, r) => withPinAt(next, r.p, r.index), withoutPin(d, id))));
    });
  };
  /** The pin mark: unpin and keep the entry as a 最近 one. */
  const unpinKeep = (p: HomePin, members: readonly AgentId[], name: string) => {
    rememberSet(members);
    unpin(p, name);
  };
  /** 放到桌面 (the keyboard way of dragging the avatar onto the desktop): an icon in the desk's first free place; 撤销 takes it away. */
  const toDesk = (p: HomePin, name: string) => {
    void home.update((d) => withIconOnDesk(d, p)).then((ok) => {
      if (ok) showShelfToast(t("home.desk.placed", { name }), () => void home.update((d) => withoutDeskIcon(d, pinId(p))));
    });
  };
  return { unpin, unpinKeep, pin, pinEntry, move, toDesk };
}

/** 「备注…」: the note editor beside the tray item (modules/home/TrayNoteEditor). */
function noteEntry(t: (k: MessageKey) => string, item: HTMLElement, name: string, initial: string | null, max: number, save: (note: string | null) => Promise<boolean>): MenuEntry {
  return {
    label: t("tray.note.menu"),
    onSelect: () => {
      const r = item.getBoundingClientRect();
      openNoteEdit({ name, initial: initial ?? "", max, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, save });
    },
  };
}

/** A note that could not be saved: said in the app's toast (store `notify` shows only in a conversation); an app's
 *  editor stays open, an agent's note is back to the old one. */
function noteFailed(error: unknown): false {
  showShelfToast(translate("tray.note.failed", { reason: error instanceof Error ? error.message : String(error) }));
  return false;
}

const mark = (on: boolean) => (on ? <Check size={14} /> : <span className="inline-block w-[14px]" />);

function openWithEntries(t: (k: MessageKey) => string, pin: HomePin, mode: OpenMode): MenuEntry[] {
  // A page opens through its owner (one way): no 打开方式.
  if (pin.kind === "page") return [];
  const modes: MenuEntry[] = OPEN_MODES.map((m: OpenMode) => ({ label: t(`home.dock.mode.${m}` as MessageKey), icon: mark(m === mode), onSelect: () => setOpenMode(pin, m) }));
  return [{ label: t("home.dock.openWith"), submenu: modes, onSelect: () => {} }];
}

// ── Agents ──────────────────────────────────────────────────────────────────────────────────────

interface MemberView {
  agent: AgentId;
  id: string;
  row: AgentRow | undefined;
  signal: Parameters<typeof agentBadge>[0];
  needs: number;
  /** What the needs are (「?」 for a question on the avatar's badge). */
  ask: NeedsYou | undefined;
  name: string;
}

interface EntryView {
  entry: TrayEntry;
  members: MemberView[];
  name: string;
}

/** One badge for a capsule: 需要你 (summed) > 出错 > 未读 > 运行中; dimmed only when every member is. */
export function mergeBadges(badges: readonly DockBadge[]): DockBadge {
  if (badges.length === 1) return badges[0]!;
  const need = badges.filter((b) => b.dot === "needs");
  if (need.length) return { dot: "needs", count: need.reduce((n, b) => n + (b.count ?? 1), 0), dim: false };
  const pick = (["error", "unread", "running"] as const).find((d) => badges.some((b) => b.dot === d));
  if (pick) return { dot: pick, count: null, dim: false };
  return { dot: null, count: null, dim: badges.length > 0 && badges.every((b) => b.dim) };
}

/** What an entry's click does: a capsule or a plain avatar → the agent's workspace (a pinned group: exactly its members); Ctrl/⌘ = beside. */
function entryEffect(v: EntryView, mode: OpenMode, beside: boolean, memberKey: string | null): Effect {
  const m = v.members.find((x) => x.id === memberKey) ?? v.members[0]!;
  const ref = { hostId: m.agent.hostId, key: m.agent.sessionId, title: m.name };
  if (beside) return agentEffect(ref, "beside");
  return agentEffect(ref, mode as WorkspaceOpenMode, v.entry.pin && v.members.length > 1 ? { members: v.members.map((x) => x.agent) } : {});
}

/** The conversation columns of an entry's members on screen. */
function panesOf(v: EntryView): string[] {
  const layout = usePanes.getState().layout;
  return screenOf(layout).panes.filter((p) => v.members.some((m) => m.agent.hostId === p.hostId && m.agent.sessionId === p.sessionId)).map((p) => p.paneId);
}

/**
 * × on an entry: it leaves the tray — its columns on screen close (the agents keep running), a pinned one is unpinned,
 * a 最近 one is forgotten. The workspace on screen closing whole: the tray's next entry takes its place (trayNext,
 * owner 2026-10-23), else the desktop.
 */
function entryClose(v: EntryView, unpin: (() => void) | null): Effect {
  const panes = panesOf(v);
  const agents = v.members.map((m) => m.agent);
  const whole = panes.length > 0 && panes.length === screenOf(usePanes.getState().layout).panes.length;
  const next = whole ? nextAfterClose(agents) : null;
  const text = next ? translate("foretell.entryCloseToNext", { name: v.name, next: next.name }) : translate("foretell.entryClose", { name: v.name });
  const foretell: Foretell = panes.length ? { tone: "replace", text, marks: panes.map((id) => ({ selector: paneArea(id) })) } : trayLeaveForetell(v.name);
  return {
    foretell,
    run: () => {
      for (const id of panes) closeWorkspace(id, agents);
      for (const m of v.members) {
        removeAgentFromSets(m.agent);
        closeOpen(m.agent);
      }
      unpin?.();
    },
  };
}

function EntryItem({ view, onUsed, pinnedOrder = [] }: { view: EntryView; onUsed(): void; pinnedOrder?: readonly string[] }) {
  const { t } = useI18n();
  const { entry } = view;
  const { pin } = entry;
  const single = pin && !pin.members && view.members.length === 1 ? pin : null;
  const mode = useDockModes((s) => (single ? openModeOf(s.modes, single) : "replace"));
  const actions = usePinActions();
  const capsule = view.members.length > 1;
  const names = view.members.map((m) => m.name);
  const close = entryClose(view, pin ? () => actions.unpin(pin, view.name) : null);
  // Its desktop icon (owner 2026-10-24: only by dragging it there or 放到桌面 — the tray's pin is not one): the pin
  // itself, else the pin it would get (several: a group).
  const deskName = capsule ? names.join(" + ") : (names[0] ?? view.name);
  const deskPin = (): HomePin => pin ?? groupPin(view.members.map((m) => m.agent), deskName);
  const homeDoc = useHomeSource().entry?.doc ?? null;
  // A note is one agent's (a capsule of several has none): its cutex session note.
  const solo = capsule ? null : view.members[0]!;
  const session = solo?.row?.session ?? null;
  const note = session ? noteText(session.note) : null;
  const menu = (item: HTMLElement): MenuEntry[] => {
    const out: MenuEntry[] = view.members.flatMap((m) => {
      const features = hostFeatures(useApp.getState(), m.agent.hostId);
      if (!m.row || !features.has("session-badge") || !isOwnerFeatures(features)) return [];
      return [{ label: capsule ? t("info.badgeFor", { name: m.name }) : t("info.badgeMenu"), flyout: <AgentBadgeEditor session={m.row.session} hostId={m.agent.hostId} />, onSelect: () => {} }];
    });
    // 设为副主管 / 取消副主管 for one agent (lib/operatorMenu; a capsule of several has none).
    const operator = solo ? operatorMenuItem(solo.agent.hostId, solo.agent.sessionId, t) : null;
    if (operator) out.push(operator);
    if (out.length) out.push("separator");
    const noteItem: MenuEntry[] =
      session && solo
        ? [
            // Drawn at once (lib/menus setAgentNote): the editor closes now; a failure puts the old note back and says why.
            noteEntry(t, item, view.name, note, AGENT_NOTE_MAX, (text) => {
              setAgentNote(session, solo.agent.hostId, text).catch((e: unknown) => noteFailed(e));
              return Promise.resolve(true);
            }),
          ]
        : [];
    if (pin) {
      if (single) out.push(...openWithEntries(t, single, mode), "separator");
      const left = stepTarget(pinnedOrder, entry.id, -1);
      const right = stepTarget(pinnedOrder, entry.id, 1);
      out.push(
        { label: t("tray.moveLeft"), hint: "Alt+←", disabled: left === undefined, onSelect: () => void (left !== undefined && actions.move(pin, view.name, left)) },
        { label: t("tray.moveRight"), hint: "Alt+→", disabled: right === undefined, onSelect: () => void (right !== undefined && actions.move(pin, view.name, right)) },
        "separator",
      );
      out.push(...noteItem, { label: t(capsule ? "tray.unpinGroup" : "home.unpin"), onSelect: () => actions.unpinKeep(pin, view.members.map((m) => m.agent), view.name) });
    } else {
      out.push(...noteItem);
    }
    if (!pin && trayPinSupported("agent")) {
      out.push({ label: t(capsule ? "tray.pinGroup" : "tray.pinToTray"), onSelect: () => actions.pinEntry(view.members.map((m) => m.agent), capsule ? names.join(" + ") : (names[0] ?? "")) });
    }
    if (homeDoc) {
      const on = isOnDesk(homeDoc, deskPin());
      out.push({ label: t(on ? "home.desk.onDesk" : "home.desk.drop"), disabled: on, onSelect: () => actions.toDesk(deskPin(), deskName) });
    }
    if (capsule && entry.setId) {
      out.push(...(out.length ? (["separator"] as MenuEntry[]) : []));
      for (const m of view.members) out.push({ label: t("tray.splitOut", { name: m.name }), onSelect: () => splitAgentOut(m.agent) });
    }
    out.push(...(out.length ? (["separator"] as MenuEntry[]) : []), { label: t("tray.close"), foretell: () => close.foretell, onSelect: () => close.run() });
    return out;
  };
  const badge = mergeBadges(view.members.map((m) => agentBadge(m.signal, m.needs)));
  // Each avatar carries its own ring and badge (a capsule: which member runs / wants you); the dimming stays on the entry.
  const avatar = (m: MemberView) => <Avatar name={m.name} initial={m.row?.initial} color={m.row?.color} avatar={m.row?.session.avatar} seed={m.agent.sessionId} size={ICON} status={{ running: m.signal === "running", badge: avatarBadge(m.signal, m.ask ?? m.needs) }} />;
  const icon = capsule ? (
    <span className="tray-capsule">
      {view.members.map((m) => (
        <span key={m.id} className="tray-m" data-member={m.id}>
          {avatar(m)}
        </span>
      ))}
    </span>
  ) : (
    avatar(view.members[0]!)
  );
  return (
    <TrayButton
      name={view.name}
      // The owner's badge is the avatar's mark (components/Avatar); here only its text for screen readers.
      ownerBadge={<>{view.members.map((m) => <AgentBadge key={m.id} badge={m.row?.session.badge} hostId={m.agent.hostId} onAvatar={avatarCarriesMark(ICON)} />)}</>}
      round
      capsule={capsule}
      icon={icon}
      badge={badge}
      mark={entry.mark}
      effect={(beside, member) => entryEffect(view, mode, beside, member)}
      click={(beside, member) => entryEffect(view, mode, beside, member).run()}
      drag={(e, member) => {
        const m = view.members.find((x) => x.id === member) ?? view.members[0]!;
        const agents = view.members.map((x) => x.agent);
        // The tray is its own drop target (owner 2026-10-24): a pinned entry moves along the pinned group or, dropped on
        // 最近, is unpinned; a 最近 entry dropped among the pinned ones (or on the divider's pushpin) is pinned there.
        const from: TrayFrom = pin ? "pinned" : "recent";
        // Dropped on the desktop while it shows, it becomes an icon there (deskDrop).
        const desk = { pin: deskPin(), name: deskName };
        const local = pin
          ? pinnedDragLocal(
              entry.id,
              (beforeId) => actions.move(pin, view.name, beforeId),
              () => actions.unpinKeep(pin, agents, view.name),
              desk,
            )
          : trayPinSupported("agent")
            ? trayDragLocal({ id: entry.id, from, pin: (beforeId) => actions.pinEntry(agents, capsule ? names.join(" + ") : (names[0] ?? ""), beforeId), desk })
            : trayDragLocal({ id: entry.id, from, desk });
        startWorkspaceDrag({ kind: "agent", hostId: m.agent.hostId, key: m.agent.sessionId, title: m.name }, e, { local, onStart: () => useTrayDragFrom.setState({ from }) });
      }}
      entryId={pin ? entry.id : undefined}
      onMove={
        pin
          ? (dir) => {
              const target = stepTarget(pinnedOrder, entry.id, dir);
              if (target === undefined) return false;
              actions.move(pin, view.name, target);
              return true;
            }
          : undefined
      }
      menu={menu}
      note={note}
      close={close}
      pinKind="agent"
      onUsed={onUsed}
    />
  );
}

// ── Apps ────────────────────────────────────────────────────────────────────────────────────────

interface AppProps {
  pin: HomePin;
  name: string;
  icon: ReactNode;
  badge: DockBadge;
  onUsed(): void;
}

function AppItem({ pin, name, icon, badge, onUsed }: AppProps) {
  useScreenTick();
  const { t } = useI18n();
  const mode = useDockModes((s) => openModeOf(s.modes, pin));
  const actions = usePinActions();
  const ref = dockRef(pin);
  const onScreen = !!ref && isOnScreen(ref);
  const explain = openFailedText;
  const notice = (reason: string) => showOpenFailed(explain(reason));
  const home = useHomeSource();
  const note = pinNote(pin);
  const saveNote = (text: string | null) =>
    home.update((d) => withPinNote(d, pinId(pin), text)).then(
      (ok) => ok || noteFailed(t("tray.note.notSaved")),
      (e: unknown) => noteFailed(e),
    );
  // 投影 is an agent's: an app goes into the current Shelf (并排: the other workspace's, or a new page). A service
  // the Shelf cannot show now (another host's agent is open) has no Shelf preview: it opens in the system browser.
  const outOfView = useApp(() => serviceOutOfView(pin));
  // A background service has no page to project: a click shows it on the 服务 page (lib/serviceWorker).
  const worker = useApp(() => pin.kind === "service" && isWorkerOn(pin.hostId, pin.key));
  const effect = ref && !outOfView && !worker ? (beside: boolean) => refEffect({ ...ref, title: name }, beside || mode === "beside" ? "beside" : "replace", { onFail: notice }) : null;
  return (
    <TrayButton
      name={name}
      round={false}
      icon={icon}
      badge={badge}
      mark={onScreen ? "on" : "pinned"}
      effect={effect}
      click={(beside) => (effect ? effect(beside).run() : void openPinAs(pin, mode, explain))}
      drag={ref ? (e) => startWorkspaceDrag({ ...ref, title: name }, e) : undefined}
      menu={(item) => [
        ...openWithEntries(t, pin, mode),
        ...(pin.kind === "page" ? [] : (["separator"] as MenuEntry[])),
        noteEntry(t, item, name, note, APP_NOTE_MAX, saveNote),
        { label: t("home.unpin"), onSelect: () => actions.unpin(pin, name) },
      ]}
      note={note}
      close={null}
      pinKind={pin.kind}
      onUsed={onUsed}
    />
  );
}

function ServiceItem({ pin, onUsed }: { pin: HomePin; onUsed(): void }) {
  const view = useServiceView(pin.hostId, pin.key);
  const connected = useApp((s) => hostData(s, pin.hostId)?.daemon.kind === "connected");
  const listed = useApp((s) => hostData(s, pin.hostId)?.services != null);
  const state = !connected ? "offline" : view ? view.health : listed ? "missing" : "unknown";
  return (
    <AppItem
      pin={pin}
      name={view?.displayName || pin.title || pin.key}
      icon={
        <Glyph>
          <Server size={17} strokeWidth={1.8} />
        </Glyph>
      }
      badge={serviceBadge(state)}
      onUsed={onUsed}
    />
  );
}

function PlainItem({ pin, onUsed }: { pin: HomePin; onUsed(): void }) {
  const artifact = pin.kind === "artifact";
  let name = pin.title ?? pin.key;
  if (!pin.title && !artifact) {
    try {
      name = new URL(pin.key).hostname;
    } catch {
      /* the key as it is */
    }
  }
  return (
    <AppItem
      pin={pin}
      name={name}
      icon={<Glyph>{artifact ? <FileBox size={17} strokeWidth={1.8} /> : <Link2 size={17} strokeWidth={1.8} />}</Glyph>}
      badge={{ dot: null, count: null, dim: false }}
      onUsed={onUsed}
    />
  );
}

/** A pinned page (lib/pagePins): its owner's icon, name and 需要你 count; without its owner a plain icon. */
function PageItem({ pin, onUsed }: { pin: HomePin; onUsed(): void }) {
  const page = parsePagePinKey(pin.key);
  const kind = usePagePinKind(page?.pageId ?? null);
  if (page && kind) return <OwnedPageItem key={kind.id} kind={kind} arg={page.arg} pin={pin} onUsed={onUsed} />;
  return (
    <AppItem
      pin={pin}
      name={pin.title ?? pin.key}
      icon={
        <Glyph>
          <LayoutDashboard size={17} strokeWidth={1.8} />
        </Glyph>
      }
      badge={{ dot: null, count: null, dim: true }}
      onUsed={onUsed}
    />
  );
}

function OwnedPageItem({ kind, arg, pin, onUsed }: { kind: PagePinKind; arg: string; pin: HomePin; onUsed(): void }) {
  const view = kind.usePin(pin.hostId, arg, pin.title ?? null);
  return <AppItem pin={pin} name={view.name} icon={view.icon(ICON)} badge={pageBadge(view.needs, view.dim)} onUsed={onUsed} />;
}

function AppOf({ pin, onUsed }: { pin: HomePin; onUsed(): void }) {
  if (pin.kind === "service") return <ServiceItem pin={pin} onUsed={onUsed} />;
  if (pin.kind === "page") return <PageItem pin={pin} onUsed={onUsed} />;
  return <PlainItem pin={pin} onUsed={onUsed} />;
}

// ── The end of the tray: 返回上一个, 需要你 N ─────────────────────────────────────────────────────────

function BackButton() {
  const { t } = useI18n();
  const back = useTrayOpen((s) => s.back.length > 0);
  if (!back) return null;
  return (
    <button type="button" data-tray-item="" data-tray-back="" className="tray-item tray-back" data-tip={t("tray.backTitle")} aria-label={t("tray.backTitle")} onClick={() => void goBackOne()}>
      <ArrowLeft size={16} aria-hidden />
    </button>
  );
}

// ── The dock ────────────────────────────────────────────────────────────────────────────────────

export function HomeDock({ onUsed }: PaneDockProps) {
  const home = useHomeSource();
  const pins = dockPins(home.entry?.doc ?? null);
  const layout = usePanes((s) => s.layout);
  useSide((s) => s.layout);
  // Folded to a strip — also 只看 Shelf (lib/shelfOnly): a hollow bar.
  const strips = [...useStripPanes(), ...useShelfOnlyPanes()];
  const sets = useWorkspaceSets((s) => s.sets);
  // Effects write this window's tray (multi-window: every window has its own sets).
  const inMine = useInWindow();
  // The sidebar's sources (every host of the view scope): signal + needs-you per agent row.
  const scoped = useScopedSidebar();
  const attention = useScopedAttention(scoped.model, scoped.scope);
  const focus = scoped.scope.focus;
  const rowOf = useMemo(() => {
    const m = new Map<string, AgentRow>();
    for (const r of attention.rows) m.set(agentEntryId({ hostId: r.hostId ?? focus, sessionId: r.session.cutexSessionId }), r);
    return m;
  }, [attention.rows, focus]);

  const screen = screenOf(layout);
  const shown = screen.panes.flatMap((p) => (p.sessionId ? [{ hostId: p.hostId, sessionId: p.sessionId, paneId: p.paneId }] : []));
  const agentPins = pins.filter((p) => p.kind === "agent");
  const entries = trayEntries({
    pins: agentPins,
    sets,
    onScreen: shown,
    strips: shown.filter((p) => strips.includes(p.paneId)),
    // A pinned agent projected into a Shelf is on screen too.
    projected: agentPins.filter((p) => isOnScreen({ kind: "agent", hostId: p.hostId, key: p.key })).map((p) => ({ hostId: p.hostId, sessionId: p.key })),
    known: (a) => rowOf.has(agentEntryId(a)),
  });
  // Pinned agents do not count towards the 最近 cap (lib/workspaceSets).
  const pinnedKeys = agentPins.map((p) => agentKey({ hostId: p.hostId, sessionId: p.key })).join("|");
  useEffect(() => inMine(() => setPinnedAgents(new Set(entries.pinned.flatMap((e) => e.members.map(agentKey))))), [pinnedKeys, inMine]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewOf = (entry: TrayEntry): EntryView => {
    const members = entry.members.map((agent): MemberView => {
      const id = agentEntryId(agent);
      const row = rowOf.get(id);
      const rk = row ? (row.key ?? row.id) : null;
      const pinTitle = entry.pin?.title;
      return { agent, id, row, signal: rk ? attention.signals.get(rk) : undefined, needs: rk ? (attention.needs.get(rk)?.count ?? 0) : 0, ask: rk ? attention.needs.get(rk) : undefined, name: row?.session.displayName ?? row?.name ?? (entry.members.length === 1 ? pinTitle : null) ?? agent.sessionId };
    });
    return { entry, members, name: members.map((m) => m.name).join(" + ") };
  };
  const pinnedViews = entries.pinned.map(viewOf);
  const pinnedOrder = pinnedViews.map((v) => v.entry.id);
  const recentViews = entries.recent.map(viewOf);
  void allEntries;

  const apps = pins.filter((p) => p.kind !== "agent").map((pin) => <AppOf key={pinId(pin)} pin={pin} onUsed={onUsed} />);
  // While an entry is dragged, the other side of the divider gets an empty drop slot when it has no entries.
  const dragFrom = useTrayDragFrom((s) => s.from);
  const groups = [
    { key: "pinned", nodes: pinnedViews.map((v) => <EntryItem key={v.entry.id} view={v} onUsed={onUsed} pinnedOrder={pinnedOrder} />), slot: dragFrom === "recent" },
    { key: "recent", nodes: recentViews.map((v) => <EntryItem key={v.entry.id} view={v} onUsed={onUsed} />), slot: dragFrom === "pinned" },
    { key: "apps", nodes: apps, slot: false },
  ].filter((g) => g.nodes.length > 0 || g.slot);
  return (
    <>
      {groups.map((g, i) => (
        <span key={g.key} className="contents">
          {/* The one pushpin: stuck into the divider that ends the pinned group. */}
          {i > 0 && (
            <span className="tray-sep" data-tray-sep-pinned={groups[i - 1]!.key === "pinned" ? "" : undefined} aria-hidden>
              {groups[i - 1]!.key === "pinned" && <DividerPin />}
            </span>
          )}
          <span role="group" data-tray-group={g.key} data-tray-drop-slot={g.nodes.length ? undefined : ""} data-tray-yield={g.key === "recent" ? "" : undefined} className="tray-group">
            {g.nodes}
          </span>
        </span>
      ))}
      <span className="tray-end" aria-hidden />
      <TrayDropMarks />
      <TrayNoteEditor />
      <BackButton />
      <BackgroundOperations />
      <TrayNeedsYou onUsed={onUsed} />
    </>
  );
}
