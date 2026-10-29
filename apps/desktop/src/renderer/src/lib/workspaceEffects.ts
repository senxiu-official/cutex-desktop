// What a click on a layout control will do — computed ONCE and used twice (docs/design/008-foretell.md):
// the hover preview (`effect.foretell`, drawn by components/ForetellLayer) and the click (`effect.run()`).
// So the preview can never say 「替换左边」 while the click replaces the right one.
//   agentEffect  — a sidebar row, a tray agent, a ⌘K agent row (替换 / 并排 / 投影; minimised ones come back on
//                  their side, 001 / 002)
//   refEffect    — a service / artifact / page into a Shelf (tray, ⌘K)
//   stripEffect / minimizeEffect / closeEffect / soloEffect / makeRoomEffect / maximizeForetell — the
//                  conversation header's controls and 「太窄？收起 X」 (002)
// Plans are pure (`agentPlan`, tested in test/workspaceEffects.test.ts); the foretells read the DOM only for
// the boxes they outline. Shell code: names no feature.
import { translate } from "../i18n";
import { paneArea, shelfSideArea } from "./foretellAreas";
import { enterShelfOnly, leaveShelfOnly, leaveShelfOnlyOf, shelfOnlyPanes, shelfOnlyPlan, useShelfOnly } from "./shelfOnly";
import { isEditableTarget } from "./escInterrupt";
import { useJump } from "./jump";
import { routedElsewhere, sidebarOf, useApp } from "../store";
import { useDesks } from "./deskStore";
import { agentPlaces } from "./windowRoute";
import { currentWindow, MAIN_WINDOW, type WindowKey } from "./windowScope";
import { conversationPanes, focusedConversation, paneBinding } from "./paneLayout";
import { focusConversationPane, showWorkspace, usePanes } from "./paneStore";
import { closePaneWithHint } from "./convPaneControls";
import { canSolo, canStrip, collapseToStrip, expandStrip, expandStripOf, soloWorkspace, stripPanes, useStrips } from "./convStrips";
import type { Foretell, ForetellMark } from "./foretell";
import { startColumnPick } from "./columnPick";
import { maxConversationColumns } from "./paneLayout";
import { setOf, useWorkspaceSets } from "./workspaceSets";
import { addOpen, openEntry, popBack, pushBack, replayingBack, type OpenAgent } from "./trayOpen";
import { trayNextAfterClose } from "./trayPins";
import { besideShelfTarget, closeWorkspace, openBesideAt, openRefWhy, projectInto, replaceWith, screenOf, type WorkspaceRef, type WorkspaceOpenMode, type WsScreen } from "./workspaces";
import { matchesCommand } from "./keybindings";
import { ownerDocumentOf } from "./ownerWindow";
import { onEveryAppWindow, queryAppWindows } from "./appWindowSet";

export interface Effect {
  /** The hover preview (null: nothing to foretell). */
  foretell: Foretell | null;
  /** The click. */
  run(): void;
}

const NONE: Effect = { foretell: null, run: () => {} };

type Side = "left" | "right";

// ── Selectors of the areas outlined ─────────────────────────────────────────────────────────────

export { paneArea };
/** A workspace's Shelf on screen: another workspace's carries its pane id; the live one is the unmarked box. */
const shelfArea = (paneId: string, focused: boolean): string => (focused ? "[data-side-box], [data-shelf-box]:not([data-ws-shelf])" : `[data-ws-shelf="${cssId(paneId)}"]`);
/** Nothing on screen: the desktop's stage. */
const DESK = "[data-pane-desk-stage]";

const cssId = (id: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"'));

const t = translate;

const nameOf = (hostId: string, sessionId: string | null): string => {
  if (!sessionId) return "";
  const sidebar = sidebarOf(useApp.getState(), hostId);
  return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === sessionId)?.displayName ?? sessionId;
};

const besideKey = (): string => (typeof navigator !== "undefined" && navigator.platform?.startsWith("Mac") ? "⌘" : "Ctrl");

// ── Agents ──────────────────────────────────────────────────────────────────────────────────────

export type AgentPlan =
  | { kind: "focus"; paneId: string; strip: boolean }
  | { kind: "open"; paneId: string | null }
  | { kind: "replace"; paneId: string; from: { hostId: string; sessionId: string } }
  /** A plain click: that agent's own workspace (all its members) takes the screen; the one on screen stays in the tray. */
  | { kind: "switch"; members: { hostId: string; sessionId: string }[]; from: { hostId: string; sessionId: string }[] }
  /** Ctrl/⌘ with every column taken: pick the one the agent replaces (lib/columnPick). */
  | { kind: "pick"; panes: string[] }
  | { kind: "beside"; side: Side; restore: boolean }
  | { kind: "project"; paneId: string }
  | { kind: "refuse" };

/**
 * What opening agent `ref` with `mode` does on `screen` (pure): on screen = focus it there (a strip: expand);
 * nothing on screen = the empty workspace takes it; 投影 = into the focused workspace's Shelf; 并排 = a second
 * workspace on the right (two on screen: the other one shows it); 替换 = the focused workspace shows it — except
 * a minimised one beside a single workspace, which comes back on its side (002).
 */
export function agentPlan(ref: { hostId: string; key: string }, mode: WorkspaceOpenMode, screen: WsScreen, ctx: { strips: readonly string[]; open: Pick<OpenAgent, "side"> | null; /** The agent's remembered workspace (null: none). */ set?: readonly { hostId: string; sessionId: string }[] | null; /** Most columns side by side (default 2). */ max?: number }): AgentPlan {
  const shows = (p: WsScreen["panes"][number]) => p.hostId === ref.hostId && p.sessionId === ref.key;
  const at = screen.panes.find(shows);
  if (at) return { kind: "focus", paneId: at.paneId, strip: ctx.strips.includes(at.paneId) };
  const real = screen.panes.filter((p) => !!p.sessionId);
  if (!real.length) return { kind: "open", paneId: screen.panes[0]?.paneId ?? null };
  const focused = real.find((p) => p.paneId === screen.focused) ?? real[0]!;
  if (mode === "project") return { kind: "project", paneId: focused.paneId };
  if (mode === "beside") {
    if (real.length < (ctx.max ?? 2)) return { kind: "beside", side: ctx.open?.side ?? "right", restore: false };
    // Every column is taken: the owner picks which one it replaces (design 039).
    return { kind: "pick", panes: real.map((p) => p.paneId) };
  }
  if (ctx.open?.side && real.length === 1) return { kind: "beside", side: ctx.open.side, restore: true };
  // A plain click goes to the agent's own workspace; what is on screen stays whole in the tray (design 039). A column is
  // only replaced on purpose (a drop on it, its 「替换这一栏…」).
  const members = ctx.set && ctx.set.length > 1 ? [...ctx.set] : [{ hostId: ref.hostId, sessionId: ref.key }];
  if (members.length > 1 || real.length > 1) return { kind: "switch", members, from: real.map((p) => ({ hostId: p.hostId, sessionId: p.sessionId! })) };
  return { kind: "replace", paneId: focused.paneId, from: { hostId: focused.hostId, sessionId: focused.sessionId! } };
}

/** The foretell of an agent plan (`name`: the agent's; `hint`: say Ctrl/⌘ = 并排 on a replace). */
export function agentForetell(plan: AgentPlan, name: string, opts: { hint?: boolean; focused?: string | null } = {}): Foretell | null {
  switch (plan.kind) {
    case "focus":
      return { tone: "open", text: t(plan.strip ? "foretell.expandStrip" : "foretell.focus", { name }), marks: [{ selector: paneArea(plan.paneId) }] };
    case "open":
      return { tone: "open", text: t("foretell.open", { name }), marks: [{ selector: plan.paneId ? `${DESK}, ${paneArea(plan.paneId)}` : DESK }] };
    case "replace": {
      const text = t("foretell.replace", { name: nameOf(plan.from.hostId, plan.from.sessionId) }) + (opts.hint ? t("foretell.besideHint", { key: besideKey() }) : "");
      return { tone: "replace", text, marks: [{ selector: paneArea(plan.paneId) }] };
    }
    case "switch": {
      const names = plan.members.map((m) => nameOf(m.hostId, m.sessionId)).join(" + ");
      const from = plan.from.map((m) => nameOf(m.hostId, m.sessionId)).join(" + ");
      const text = t(plan.members.length > 1 ? "foretell.switchGroup" : "foretell.switch", { name: names, from }) + (opts.hint ? t("foretell.besideHint", { key: besideKey() }) : "");
      return { tone: "replace", text, marks: [{ selector: "[data-side-work]" }] };
    }
    case "pick":
      return { tone: "replace", text: t("foretell.pick", { name }), marks: plan.panes.map((id) => ({ selector: paneArea(id) })) };
    case "beside": {
      const text = t(plan.restore ? (plan.side === "left" ? "foretell.backLeft" : "foretell.backRight") : plan.side === "left" ? "foretell.besideLeft" : "foretell.besideRight", { name });
      // That half of the work row, measured by the layer in the window that draws it (a desk's own row, not main's).
      return { tone: "beside", text, marks: [{ selector: "[data-side-work]", half: plan.side }] };
    }
    case "project": {
      const focused = plan.paneId === opts.focused;
      const mark: ForetellMark = hasShelf(plan.paneId, focused) ? { selector: shelfArea(plan.paneId, focused) } : { selector: paneArea(plan.paneId) };
      return { tone: "open", text: t("foretell.project", { name: nameOf(...ownerOf(plan.paneId)) }), marks: [mark] };
    }
    case "refuse":
      return null;
  }
}

function ownerOf(paneId: string): [string, string | null] {
  const b = paneBinding(usePanes.getState().layout, paneId);
  return [b?.hostId ?? "", b?.sessionId ?? null];
}

const hasShelf = (paneId: string, focused: boolean): boolean => typeof document !== "undefined" && !!queryAppWindows(shelfArea(paneId, focused));

/** Runs an agent plan. */
export function runAgentPlan(plan: AgentPlan, ref: { hostId: string; key: string }): void {
  const app = useApp.getState();
  switch (plan.kind) {
    case "focus":
      if (plan.strip && shelfOnlyPanes(usePanes.getState().layout, useShelfOnly.getState().records).includes(plan.paneId)) leaveShelfOnly(plan.paneId);
      else if (plan.strip) expandStrip(plan.paneId);
      else focusConversationPane(plan.paneId);
      // As a plain select did: back to the conversation view (a page over it) and marked seen — a no-op
      // re-select otherwise (focusConversationPane does nothing on the pane that already has the focus).
      void app.select(ref.key, ref.hostId);
      return;
    case "open":
      void app.select(ref.key, ref.hostId);
      return;
    case "replace":
      if (plan.paneId === focusedConversation(usePanes.getState().layout)) void app.select(ref.key, ref.hostId);
      else replaceWith(ref.hostId, ref.key, plan.paneId);
      return;
    case "beside":
      openBesideAt(ref.hostId, ref.key, plan.side);
      return;
    case "switch":
      showWorkspace(plan.members, { hostId: ref.hostId, sessionId: ref.key });
      void app.select(ref.key, ref.hostId);
      return;
    case "pick":
      startColumnPick({ hostId: ref.hostId, key: ref.key });
      return;
    case "project":
      projectInto(ref.hostId, ref.key, plan.paneId);
      return;
    case "refuse":
      return;
  }
}

/**
 * The other app window whose column shows the agent (multi-window P3, one copy per agent): opening it there goes to
 * that column instead (null: not in another window's column, or already in this window's).
 */
function columnElsewhere(hostId: string, sessionId: string): WindowKey | null {
  const here = currentWindow();
  const columns = agentPlaces(hostId, sessionId).filter((p) => p.kind === "column");
  if (columns.some((p) => p.window === here)) return null;
  return columns[0]?.window ?? null;
}

/** 「{name} 在 桌子 N 里」: the jump an open of an agent shown in another window makes (no outline: it is not on this screen). */
function elsewhereForetell(window: WindowKey, name: string): Foretell {
  const n = useDesks.getState().desks.findIndex((d) => d.deskId === window) + 2;
  const text = window === MAIN_WINDOW || n < 2 ? t("desk.jumpMain", { name }) : t("desk.jumpDesk", { name, n });
  return { tone: "open", text, marks: [] };
}

/** Opening agent `ref` now (a sidebar row: 替换, Ctrl/⌘ = 并排; a tray item: its 打开方式). */
export function agentEffect(ref: { hostId: string; key: string; title?: string }, mode: WorkspaceOpenMode, opts: { /** The workspace to show (a pinned group): else the agent's remembered one. */ members?: readonly { hostId: string; sessionId: string }[] } = {}): Effect {
  // One copy per agent (multi-window P3): shown in another window's column → that window and column take the focus,
  // whatever the mode (替换 / 并排 / a tray item) — as store.openAgent and openAgentBeside do. 投影 shows a live view in a
  // Shelf, not a column: it stays.
  const elsewhere = mode === "project" ? null : columnElsewhere(ref.hostId, ref.key);
  if (elsewhere) return { foretell: elsewhereForetell(elsewhere, ref.title ?? nameOf(ref.hostId, ref.key)), run: () => void routedElsewhere(ref.hostId, ref.key) };
  const layout = usePanes.getState().layout;
  const screen = screenOf(layout);
  const strips = [...stripPanes(layout, useStrips.getState().strips), ...shelfOnlyPanes(layout, useShelfOnly.getState().records)];
  const set = setOf(useWorkspaceSets.getState().sets, { hostId: ref.hostId, sessionId: ref.key });
  const plan = agentPlan(ref, mode, screen, { strips, open: openEntry({ hostId: ref.hostId, sessionId: ref.key }), set: opts.members ?? set?.members ?? null, max: maxConversationColumns() });
  const name = ref.title ?? nameOf(ref.hostId, ref.key);
  return { foretell: agentForetell(plan, name, { hint: mode === "replace", focused: screen.focused }), run: () => runAgentPlan(plan, ref) };
}

// ── Services, artifacts, pages ──────────────────────────────────────────────────────────────────

/** A service / artifact / page into a Shelf (lib/workspaces openRef: 并排 = the other workspace's Shelf, or a new page). */
export function refEffect(ref: WorkspaceRef, mode: WorkspaceOpenMode, opts: { pageParams?: Record<string, string>; onFail?(reason: string): void } = {}): Effect {
  const layout = usePanes.getState().layout;
  const screen = screenOf(layout);
  const name = ref.title ?? ref.key;
  // `onFail`: nothing opened, with the refs reason (the tray says why).
  const run = () =>
    void openRefWhy(ref, mode, opts.pageParams ? { pageParams: opts.pageParams } : {}).then(
      (failed) => failed && opts.onFail?.(failed),
      (e: unknown) => opts.onFail?.(e instanceof Error ? e.message : String(e)),
    );
  const real = screen.panes.filter((p) => !!p.sessionId);
  if (!real.length) return { foretell: { tone: "open", text: t("foretell.intoShelfNoConv", { name }), marks: [{ selector: DESK }] }, run };
  let paneId = screen.focused && real.some((p) => p.paneId === screen.focused) ? screen.focused : real[0]!.paneId;
  let newPage = false;
  if (mode === "beside") {
    const target = besideShelfTarget(screen, paneId);
    if (target.kind === "other") paneId = target.paneId;
    else newPage = ref.kind !== "page";
  }
  const focused = paneId === screen.focused;
  const owner = nameOf(...ownerOf(paneId));
  const text = t(newPage ? "foretell.intoNewPage" : "foretell.intoShelf", { owner, name });
  const mark: ForetellMark = hasShelf(paneId, focused) ? { selector: shelfArea(paneId, focused) } : { selector: paneArea(paneId) };
  return { foretell: { tone: "open", text, marks: [mark] }, run };
}

// ── The conversation header's controls (002) ────────────────────────────────────────────────────

const agentOfPane = (paneId: string): { hostId: string; sessionId: string } | null => {
  const b = paneBinding(usePanes.getState().layout, paneId);
  return b?.sessionId ? { hostId: b.hostId, sessionId: b.sessionId } : null;
};

/** The marks of a workspace: its column and its Shelves on screen. */
const workspaceMarks = (paneId: string, text?: string): ForetellMark[] => {
  const focused = focusedConversation(usePanes.getState().layout) === paneId;
  return [{ selector: paneArea(paneId), ...(text !== undefined ? { text } : {}) }, ...(hasShelf(paneId, focused) ? [{ selector: shelfArea(paneId, focused), text: "" }] : [])];
};

/** 「‹ / ›」 收成窄条 (two workspaces; null when it cannot). */
export function stripEffect(paneId: string): Effect {
  if (!canStrip(usePanes.getState().layout, paneId)) return NONE;
  return { foretell: { tone: "fold", text: t("foretell.strip"), marks: workspaceMarks(paneId) }, run: () => void collapseToStrip(paneId) };
}

/**
 * 只看 Shelf (002 补充 10-22): the conversation folds to its strip, its Shelf takes the width (「变宽到 N px」). The
 * preview and the action share one measured plan (lib/shelfOnly shelfOnlyPlan).
 */
export function shelfOnlyEffect(paneId: string): Effect {
  const plan = shelfOnlyPlan(paneId);
  if (!plan) return NONE;
  return {
    foretell: {
      tone: "fold",
      text: t("foretell.convStrip"),
      marks: [
        { selector: paneArea(paneId), text: t("foretell.convStrip"), tone: "fold" },
        { selector: shelfSideArea(plan.side), text: t("foretell.shelfWiden", { n: plan.width }), tone: "open" },
      ],
    },
    run: () => void enterShelfOnly(plan),
  };
}

/**
 * 「—」 最小化 (002): the workspace leaves the screen and becomes an open item in the tray, remembered on its side
 * (a click there puts it back on that side); the last one = into the tray and back to the desktop.
 */
export function minimizeWorkspace(paneId: string): void {
  const layout = usePanes.getState().layout;
  const panes = conversationPanes(layout);
  const a = agentOfPane(paneId);
  if (!a || !panes.includes(paneId)) return;
  const side: Side | null = panes.length >= 2 ? (panes.indexOf(paneId) === 0 ? "left" : "right") : null;
  addOpen(a, side);
  pushBack({ kind: "minimize", hostId: a.hostId, sessionId: a.sessionId, side });
  closeWorkspace(paneId);
}

export function minimizeEffect(paneId: string): Effect {
  if (!agentOfPane(paneId)) return NONE;
  const last = conversationPanes(usePanes.getState().layout).length < 2;
  return { foretell: { tone: "fold", text: t(last ? "foretell.minimizeLast" : "foretell.minimize"), marks: workspaceMarks(paneId) }, run: () => minimizeWorkspace(paneId) };
}

/** 「关闭」: the pane closes (the agent keeps running); it leaves the tray unless pinned. */
export function closeEffect(paneId: string): Effect {
  const a = agentOfPane(paneId);
  if (!a) return NONE;
  const last = conversationPanes(usePanes.getState().layout).length < 2;
  const name = nameOf(a.hostId, a.sessionId);
  // The last one: the tray's next entry takes its place (lib/workspaces closeWorkspace), else the desktop.
  const next = last ? trayNextAfterClose([a]) : null;
  const text = next ? t("foretell.closeToNext", { name, next: next.name }) : t(last ? "foretell.closeLast" : "foretell.close", { name });
  return { foretell: { tone: "replace", text, marks: workspaceMarks(paneId) }, run: () => closePaneWithHint(paneId) };
}

/** 独占: the other workspaces fold to strips. */
export function soloEffect(paneId: string): Effect {
  const layout = usePanes.getState().layout;
  if (!canSolo(layout, paneId)) return NONE;
  const others = conversationPanes(layout).filter((id) => id !== paneId && canStrip(layout, id));
  return { foretell: { tone: "fold", text: t("foretell.solo"), marks: others.flatMap((id) => workspaceMarks(id, t("foretell.solo"))) }, run: () => soloWorkspace(paneId) };
}

/** 「太窄？收起 X」 on a preview in workspace `paneId`'s Shelf `shelfId`: the other workspace folds, the preview takes its width. */
export function makeRoomEffect(paneId: string, shelfId: string, previewName: string): Effect {
  const layout = usePanes.getState().layout;
  const other = conversationPanes(layout).find((id) => id !== paneId);
  if (!other || !canStrip(layout, other)) return NONE;
  return {
    foretell: { tone: "fold", text: t("foretell.makeRoom", { name: previewName }), marks: workspaceMarks(other) },
    run: () => {
      focusConversationPane(paneId);
      collapseToStrip(other, { giveTo: { shelfId } });
    },
  };
}

/** The other workspace a 「太窄」 chip in `paneId`'s Shelf would fold (null: none can). */
export function makeRoomTarget(paneId: string): { paneId: string; name: string } | null {
  const layout = usePanes.getState().layout;
  const other = conversationPanes(layout).find((id) => id !== paneId);
  if (!other || !canStrip(layout, other)) return null;
  return { paneId: other, name: nameOf(...ownerOf(other)) };
}

/** ⤢ 放大 / 还原 (its click is the header's own toggle; only the preview here). */
export function maximizeForetell(paneId: string, maxed: boolean): Foretell {
  return { tone: "open", text: t(maxed ? "foretell.restore" : "foretell.maximize"), marks: [{ selector: maxed ? "[data-side-work]" : paneArea(paneId) }] };
}

// ── 返回上一个 (Alt+←) ────────────────────────────────────────────────────────────────────────────

/** Undoes the last replace / minimise / strip still undoable. False: nothing to go back to. */
export function goBackOne(): boolean {
  for (;;) {
    const step = popBack();
    if (!step) return false;
    const layout = usePanes.getState().layout;
    if (step.kind === "workspace") {
      // Still what that step made (else something else happened since: skip it).
      const now = screenOf(layout).panes.filter((p) => p.sessionId);
      const isTo = now.length === step.to.length && step.to.every((a) => now.some((p) => p.hostId === a.hostId && p.sessionId === a.sessionId));
      if (!isTo) continue;
      replayingBack(() => showWorkspace(step.from, step.from[0] ?? null));
      return true;
    }
    if (step.kind === "minimize") {
      if (screenOf(layout).panes.some((p) => p.hostId === step.hostId && p.sessionId === step.sessionId)) continue;
      replayingBack(() => agentEffect({ hostId: step.hostId, key: step.sessionId }, "replace").run());
      return true;
    }
    if (step.kind === "shelfOnly") {
      let done = false;
      replayingBack(() => (done = leaveShelfOnlyOf(step.hostId, step.sessionId)));
      if (done) return true;
      continue;
    }
    if (!stripPanes(layout, useStrips.getState().strips).some((id) => agentOfPane(id)?.sessionId === step.sessionId)) continue;
    replayingBack(() => expandStripOf(step.hostId, step.sessionId));
    return true;
  }
}

/** Live: whether 「返回上一个」 has something (the tray's button). */
export const backAvailable = (back: readonly unknown[]): boolean => back.length > 0;

/**
 * Alt+← (no other modifier, focus not in a text field): 返回上一个. A timeline jump's 「回到」 (components/gutter
 * ReturnChip) has it first while it shows. Returns the stop.
 */
export function startBackKey(): () => void {
  if (typeof window === "undefined") return () => {};
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || !matchesCommand("jumpBack", e)) return;
    if (isEditableTarget(e.target) || isEditableTarget(ownerDocumentOf(e.target).activeElement)) return;
    if (useJump.getState().back) return;
    e.preventDefault();
    if (!goBackOne()) useApp.getState().notify(t("tray.nothingBack"), "info");
  };
  // Every app window (a desk window's keys too, multi-window).
  return onEveryAppWindow((win) => {
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  });
}
