// The tray's shortcuts (`pane.desktop` Dock, contract 1.20; canvas principles §7, owner 2026-10-21): the same
// pin list as the desktop tiles (the home document's `pins`; a tile's size only matters on the desktop), each
// drawn as a small icon with a dot badge from cutex state — an agent: 需要你 (amber, the only one with a
// number), running (green), unread (a finished turn not seen: blue), error (red); a service: its health.
// Per item an 打开方式 (替换 / 并排 / 投影, default 替换) kept on this device; opening, dragging out and「on
// screen」 go through the workspace model (lib/workspaces). Pure parts unit-tested in test/tray.test.ts.
import { create } from "zustand";
import type { HomeDoc, HomePin } from "../../../../shared/home";
import type { AgentSignal } from "../../lib/agentAttention";
import type { WorkspaceRef } from "../../lib/workspaces";
import { pinId, pinsOf } from "./model";

/** The tray's items: the home pins in their order (sizes ignored — the tray has one icon size). */
export function dockPins(doc: HomeDoc | null): HomePin[] {
  return pinsOf(doc);
}

// ── Badges ──────────────────────────────────────────────────────────────────────────────────────

export type DockDot = "needs" | "running" | "unread" | "error" | "ok" | "warn";

export interface DockBadge {
  dot: DockDot | null;
  /** Only 需要你 shows a number. */
  count: number | null;
  /** Offline / stopped / gone: the icon is dimmed. */
  dim: boolean;
}

const NONE: DockBadge = { dot: null, count: null, dim: false };

/** An agent pin: its sidebar signal and needs-you count (lib/agentAttention, the sidebar's sources). */
export function agentBadge(signal: AgentSignal | undefined, needs: number): DockBadge {
  switch (signal) {
    case "needsYou":
      return { dot: "needs", count: Math.max(1, needs), dim: false };
    case "running":
      return { dot: "running", count: null, dim: false };
    case "error":
      return { dot: "error", count: null, dim: false };
    case "done":
      return { dot: "unread", count: null, dim: false };
    case "offline":
    case "unknown":
      return { ...NONE, dim: true };
    default:
      return NONE;
  }
}

/** What the desktop tiles show for a service (Tiles.tsx ServiceTile): the record's health, or why there is none. */
export type ServiceState = "reachable" | "starting" | "unreachable" | "stopped" | "offline" | "missing" | "unknown" | (string & {});

/** A service pin: running = a quiet green dot; starting amber; unreachable red; stopped / host offline / gone dimmed. */
export function serviceBadge(state: ServiceState): DockBadge {
  switch (state) {
    case "reachable":
      return { dot: "ok", count: null, dim: false };
    case "starting":
      return { dot: "warn", count: null, dim: false };
    case "unreachable":
      return { dot: "error", count: null, dim: false };
    case "stopped":
    case "offline":
    case "missing":
      return { ...NONE, dim: true };
    default:
      return NONE;
  }
}

/** A page pin (lib/pagePins): 需要你 with its count, else nothing; gone / offline dimmed. */
export function pageBadge(needs: number, dim: boolean): DockBadge {
  return needs > 0 ? { dot: "needs", count: needs, dim } : { ...NONE, dim };
}

/** The badge's accessible text key part (home.dock.state.<dot>). */
export const badgeLabelKey = (b: DockBadge): string | null => (b.dot ? `home.dock.state.${b.dot}` : null);

// ── 打开方式 ─────────────────────────────────────────────────────────────────────────────────────

export const OPEN_MODES = ["replace", "beside", "project"] as const;
export type OpenMode = (typeof OPEN_MODES)[number];
export type OpenModes = Readonly<Record<string, OpenMode>>;

/** A pin's click: its chosen 打开方式, else 替换. */
export const openModeOf = (modes: OpenModes, pin: HomePin): OpenMode => modes[pinId(pin)] ?? "replace";

/** Sets a pin's 打开方式 (替换 = the default: not stored). */
export function withOpenMode(modes: OpenModes, pin: HomePin, mode: OpenMode): OpenModes {
  const id = pinId(pin);
  const { [id]: _old, ...rest } = modes;
  return mode === "replace" ? rest : { ...rest, [id]: mode };
}

/** Only modes of pins that still exist (an unpinned item forgets its choice). */
export function prunedModes(modes: OpenModes, pins: readonly HomePin[]): OpenModes {
  const ids = new Set(pins.map(pinId));
  const out: Record<string, OpenMode> = {};
  for (const [id, mode] of Object.entries(modes)) if (ids.has(id)) out[id] = mode;
  return Object.keys(out).length === Object.keys(modes).length ? modes : out;
}

/** Stored modes as read back (unknown values dropped). */
export function readModes(raw: unknown): OpenModes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, OpenMode> = {};
  for (const [id, mode] of Object.entries(raw as Record<string, unknown>)) if ((OPEN_MODES as readonly unknown[]).includes(mode) && mode !== "replace") out[id] = mode as OpenMode;
  return out;
}

/** This device's 打开方式 per pin (module prefs, seeded by activate). */
export const useDockModes = create<{ modes: OpenModes }>(() => ({ modes: {} }));

let persist: (modes: OpenModes) => void = () => {};

export function initDockModes(read: () => unknown, write: (modes: OpenModes) => void): void {
  useDockModes.setState({ modes: readModes(read()) });
  persist = write;
}

export function setOpenMode(pin: HomePin, mode: OpenMode): void {
  const modes = withOpenMode(useDockModes.getState().modes, pin, mode);
  useDockModes.setState({ modes });
  persist(modes);
}

// ── Workspaces ──────────────────────────────────────────────────────────────────────────────────

/** A pin as a workspace ref (lib/workspaces openRef / startWorkspaceDrag / isOnScreen); a link or a page: none. */
export function dockRef(pin: HomePin): WorkspaceRef | null {
  // A link opens as a browser tab; a page through its owner (lib/pagePins) — neither is a workspace ref.
  if (pin.kind === "url" || pin.kind === "page") return null;
  return { kind: pin.kind, hostId: pin.hostId, key: pin.key, ...(pin.title ? { title: pin.title } : {}) };
}
