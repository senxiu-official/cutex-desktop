// The title bar's single notification control (components/TitleBar.tsx NotifyControl): one bell that
// merges two separate settings —
// - the agent's attention level (cutex `GET|POST /v2/notifications/session`, per native thread:
//   off / normal / important; what cutex's outbound reminders use for this agent), and
// - the host's project mute (`/v2/notification-levels` `projectOverrides`, per project or the
//   independent group; muted = no desktop / phone / sound pop-ups, 需要你 still shows).
// The icon shows the combined state; the click menu lists both with plain labels.
import type { ReactNode } from "react";
import type { NotificationLevel } from "../../../shared/ipc";
import type { MenuEntry } from "./contextMenu";
import type { MessageKey } from "../i18n";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export interface NotifyState {
  /** The agent's level; null = unknown (not loaded / no thread / request failed). */
  agent: NotificationLevel | null;
  /** The group's host mute; null = not available (no capability, or not the focus host). */
  projectMuted: boolean | null;
  /** The group's name (project display name); null = the independent agents. */
  groupName: string | null;
}

export type NotifyLook = "off" | "on" | "important";

/** Nothing to show or set: no agent level and no project mute. */
export function notifyHidden(s: NotifyState): boolean {
  return s.agent === null && s.projectMuted === null;
}

/** Icon state: muted (either setting silences) → off; the agent's important level → important; else on. */
export function notifyLook(s: NotifyState): NotifyLook {
  if (s.projectMuted || s.agent === "off") return "off";
  return s.agent === "important" ? "important" : "on";
}

const LEVELS: readonly NotificationLevel[] = ["off", "normal", "important"];

/** Tooltip: the state of each setting in plain words + "click to change". */
export function notifyTooltip(s: NotifyState, t: T): string {
  const lines = [t("notify.control")];
  if (s.agent) lines.push(t("notify.tipAgent", { level: t(`notify.lvl.${s.agent}` as MessageKey) }));
  if (s.projectMuted !== null) {
    const state = t(s.projectMuted ? "notify.tipMuted" : "notify.tipNotMuted");
    lines.push(s.groupName === null ? t("notify.tipIndependent", { state }) : t("notify.tipProject", { name: s.groupName, state }));
  }
  lines.push(t("notify.tipClick"));
  return lines.join("\n");
}

/** The click menu: the agent's three levels (current one checked), then the group mute toggle. */
export function notifyMenu(s: NotifyState, t: T, actions: { setAgent(level: NotificationLevel): void; toggleProject(): void; check: ReactNode; muteIcon: ReactNode; unmuteIcon: ReactNode }): MenuEntry[] {
  const out: MenuEntry[] = [];
  if (s.agent) {
    out.push({ label: t("notify.agentSection"), hint: t("notify.agentHint"), note: true, disabled: true, onSelect: () => {} });
    for (const level of LEVELS)
      out.push({
        label: t(`notify.lvl.${level}` as MessageKey),
        hint: t(`notify.lvlHint.${level}` as MessageKey),
        icon: level === s.agent ? actions.check : undefined,
        onSelect: () => actions.setAgent(level),
      });
  }
  if (s.projectMuted !== null) {
    if (out.length) out.push("separator");
    const name = s.groupName;
    const label = s.projectMuted
      ? name === null ? t("notify.unmuteIndependent") : t("notify.unmuteProject", { name })
      : name === null ? t("notify.muteIndependent") : t("notify.muteProject", { name });
    out.push({ label, icon: s.projectMuted ? actions.unmuteIcon : actions.muteIcon, onSelect: actions.toggleProject });
    out.push({ label: t("notify.muteHint"), note: true, disabled: true, onSelect: () => {} });
  }
  return out;
}
