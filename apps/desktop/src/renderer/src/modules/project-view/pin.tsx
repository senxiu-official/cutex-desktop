import { clipToWidth, displayWidth } from "../../lib/badgeWidth";
// 钉到托盘 for a project's Project 视图: a home pin of kind `page` with the key
// `project-view:<projectId>` (hostId = the project's host; cutex `user-home-page-pins`). The pin list's
// keeper draws and opens it through lib/pagePins (registered on activate): the project's icon and name, the
// number of its agents that need you, dimmed when the project is gone or its host offline; a click opens
// this pane for the project. The action shows only where the list can keep such a pin (lib/trayPins
// `supports("page")`: an older host refuses page pins). Entries: the pane header (Actions), the 项目 page
// tab and the sidebar project menu (lib/projectMenuExtras).
import { Pin, PinOff } from "lucide-react";
import { useMemo } from "react";
import { translate, useI18n } from "../../i18n";
import { hostData } from "../../lib/hostScope";
import { pagePinKey, registerPagePin, type PagePinCandidate, type PagePinView } from "../../lib/pagePins";
import { registerProjectMenuExtra } from "../../lib/projectMenuExtras";
import { projectIcon, projectLucideIcon, type ProjectIconChoice } from "../../lib/projectIcons";
import { useUiPrefs } from "../../lib/prefs";
import { useScopedAttention, useScopedSidebar } from "../../lib/scopedSidebarView";
import { projectColor, rowKey, type ProjectGroup } from "../../lib/sidebar";
import { trayPins, trayPinSupported, useTrayPin, type TrayPinRef } from "../../lib/trayPins";
import { sidebarOf, useApp } from "../../store";
import { services } from "../app";
import type { SideBodyProps } from "../slots";
import { KIND, type ViewState } from "./model";
import { focusedProject } from "./open";

/** The page id in the pin key (`project-view:<projectId>`). */
export const PAGE_ID = "project-view";

export function projectPinRef(hostId: string, projectId: string, title?: string | null): TrayPinRef {
  return { hostId, kind: "page", key: pagePinKey(PAGE_ID, projectId), ...(title ? { title: title.slice(0, 200) } : {}) };
}

/** Pins or unpins; a notice says what happened. */
export async function toggleProjectPin(ref: TrayPinRef, name: string): Promise<void> {
  const pins = trayPins();
  if (!pins) return;
  const was = pins.isPinned(ref);
  const ok = await (was ? pins.unpin(ref) : pins.pin(ref));
  if (ok) services.ui.notice(translate(was ? "project-view.unpinned" : "project-view.pinned", { name }));
  else services.ui.notice(translate("project-view.pinFailed"), "error");
}

/** The project's tile icon: its emoji / lucide icon / letters in white on the project colour. */
function ProjectPinIcon({ size, icon, badge, color }: { size: number; icon: ProjectIconChoice | null; badge: string; color: string }) {
  const hex = projectColor(color);
  const bg = hex.toLowerCase() === "#ffffff" ? "#64748b" : hex;
  const Lucide = icon?.kind === "icon" ? projectLucideIcon(icon.value) : null;
  const text = clipToWidth(icon?.kind === "text" ? icon.value : badge, 4);
  return (
    <span
      data-project-pin-icon=""
      className="flex shrink-0 items-center justify-center overflow-hidden text-white shadow-[0_3px_10px_rgba(0,0,0,0.15)]"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.27), background: `linear-gradient(140deg, ${bg}, color-mix(in srgb, ${bg} 70%, #000))` }}
      aria-hidden
    >
      {icon?.kind === "emoji" ? (
        <span className="leading-none" style={{ fontSize: Math.round(size * 0.5) }}>
          {icon.value}
        </span>
      ) : Lucide ? (
        <Lucide size={Math.round(size * 0.5)} strokeWidth={1.8} />
      ) : (
        <span className="font-bold leading-none" style={{ fontSize: Math.round(size * (displayWidth(text) > 2 ? 0.28 : 0.38)) }}>
          {text}
        </span>
      )}
    </span>
  );
}

/** lib/pagePins usePin: the project's live look on the tray and the desktop. */
function useProjectPin(hostId: string, projectId: string, title: string | null): PagePinView {
  const { t } = useI18n();
  const scoped = useScopedSidebar();
  const attention = useScopedAttention(scoped.model, scoped.scope);
  const prefs = useUiPrefs();
  const focus = scoped.scope.focus;
  const online = useApp((s) => hostData(s, hostId)?.daemon.kind === "connected");
  const group = useMemo(
    () => (scoped.model.groups.find((g) => g.kind === "project" && g.id === projectId && (g.hostId ?? focus) === hostId) as ProjectGroup | undefined) ?? null,
    [scoped.model.groups, projectId, hostId, focus],
  );
  const needs = group ? [...group.online, ...group.offline].filter((r) => attention.signals.get(rowKey(r)) === "needsYou").length : 0;
  const name = group?.name ?? title ?? projectId;
  const icon = projectIcon(prefs.projectIcons, hostId, projectId);
  const badge = group?.badge || name.slice(0, 1);
  const color = group?.color ?? "#64748b";
  return {
    name,
    subtitle: t("project-view.title"),
    icon: (size) => <ProjectPinIcon size={size} icon={icon} badge={badge} color={color} />,
    needs,
    dim: !group || !online,
  };
}

function openProject(hostId: string, projectId: string): boolean {
  const r = services.panes.open(KIND, { hostId, projectId }, { focus: true });
  return r.status !== "unavailable";
}

/** The pin button (pane header, 项目 page tab): shown only where the pin can be kept. */
export function PinButton({ hostId, projectId, name, className = "" }: { hostId: string; projectId: string; name: string; className?: string }) {
  const { t } = useI18n();
  const ref = projectPinRef(hostId, projectId, name);
  const { available, pinned } = useTrayPin(ref);
  if (!available && !pinned) return null;
  const label = t(pinned ? "project-view.unpin" : "project-view.pin");
  return (
    <button
      type="button"
      data-project-view-pin={pinned ? "pinned" : ""}
      title={label}
      aria-label={label}
      aria-pressed={pinned}
      onClick={(e) => {
        e.stopPropagation();
        void toggleProjectPin(ref, name);
      }}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-hover hover:text-foreground ${pinned ? "text-accent" : "text-subtle"} ${className}`}
    >
      {pinned ? <PinOff size={13} /> : <Pin size={13} />}
    </button>
  );
}

/** The project a pane state shows (its choice, else the focused conversation's project). */
function shownProject(state: ViewState): { hostId: string; projectId: string } | null {
  return state.projectId && state.hostId ? { hostId: state.hostId, projectId: state.projectId } : focusedProject();
}

/** The pane header's actions (`pane.kind` Actions): the pin button for the project shown. */
export function ProjectViewActions(props: SideBodyProps<ViewState>) {
  const state = props.instance.state;
  const key = useApp(() => {
    const p = shownProject(state);
    return p ? `${p.hostId}\n${p.projectId}` : "";
  });
  const name = useProjectName(key);
  if (!key) return null;
  const [hostId, projectId] = key.split("\n") as [string, string];
  return <PinButton hostId={hostId} projectId={projectId} name={name ?? projectId} />;
}

function useProjectName(key: string): string | null {
  return useApp((s) => {
    if (!key) return null;
    const [hostId, projectId] = key.split("\n") as [string, string];
    const p = sidebarOf(s, hostId)?.projects?.projects.find((x) => x.project_id === projectId);
    return p?.presentation.display_name || null;
  });
}

/** The 「＋ 固定」 picker (desktop, tray): the projects of the connected hosts. */
function pinCandidates(): PagePinCandidate[] {
  const s = useApp.getState();
  const hostIds = (s.hosts?.hosts ?? [{ id: "local" }]).map((h) => h.id).filter((id) => hostData(s, id)?.daemon.kind === "connected");
  return hostIds.flatMap((hostId) =>
    (sidebarOf(s, hostId)?.projects?.projects ?? []).map((p) => ({ hostId, arg: p.project_id, title: (p.presentation.display_name || p.project_id).slice(0, 200) })),
  );
}

/** activate: the page-pin look / opener and the project menu row; returns the cleanup. */
export function startPins(): () => void {
  const offPage = registerPagePin({ id: PAGE_ID, usePin: useProjectPin, open: openProject, titleKey: "project-view.title", candidates: pinCandidates });
  const offMenu = registerProjectMenuExtra(PAGE_ID, ({ hostId, projectId, name }) => {
    const pins = trayPins();
    if (!pins) return null;
    const ref = projectPinRef(hostId, projectId, name);
    const pinned = pins.isPinned(ref);
    if (!pinned && !trayPinSupported("page")) return null;
    return {
      label: translate(pinned ? "project-view.unpin" : "project-view.pin"),
      icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
      onSelect: () => void toggleProjectPin(ref, name),
    };
  });
  return () => {
    offPage();
    offMenu();
  };
}
