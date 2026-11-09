// One agent picker for every "choose an agent" place (owner 2026-11-09: picking from the flat list of all
// agents is hard to use with hundreds of them). Pure half: the rows a SearchableSelect / SearchablePickerBody
// shows — the current agent and recent picks first, then one group per project in the sidebar's order,
// 独立 next, 快速对话 (quick chats: shown only while searching, owner 2026-11-09) and 已归档 last; search matches the shown name, the agent's own name, its project, its note and
// its id. The recent-pick memory is a per-viewer localStorage convenience (like the browser picker's).
import type { SidebarSnapshot } from "../../../shared/ipc";
import type { SearchablePickerOption } from "../components/SearchablePicker";
import { compareNames } from "./rosterOrder";
import { isQuickChat } from "./sidebar";
import { securityProjectIds } from "./securityPicker";

type Snapshot = Pick<SidebarSnapshot, "active" | "retired" | "projects" | "hostRows"> | null | undefined;

export interface AgentPickerRow {
  /** The option's value (a session id, or a host-qualified key when the list spans hosts). */
  value: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  archived: boolean;
  /** A quick chat (lib/sidebar isQuickChat) outside any project: listed only while searching. */
  quickChat?: boolean;
  /** Set when the list spans hosts: shown after the group's name. */
  hostLabel?: string;
  searchText: string;
}

export interface AgentPickerLabels {
  /** Group of the current agent and recent picks. */
  top: string;
  independent: string;
  archived: string;
  /** Group of quick chats (shown while searching). */
  chats: string;
}

/**
 * The agents of one host's sidebar as picker rows. `include: "all"` adds the archived ones; `only` keeps just
 * these ids (filters over a list's own agents); `keyOf` turns an id into the option value.
 */
export function sidebarPickerRows(
  sidebar: Snapshot,
  options: { include?: "active" | "all"; only?: ReadonlySet<string> | readonly string[]; hostLabel?: string; keyOf?: (id: string) => string } = {},
): AgentPickerRow[] {
  const only = options.only ? new Set(options.only) : null;
  const projects = new Map((sidebar?.projects?.projects ?? []).map((p) => [p.project_id, p.presentation.display_name || p.project_id]));
  const seen = new Set<string>();
  const rows: AgentPickerRow[] = [];
  const add = (s: SidebarSnapshot["active"][number], archived: boolean) => {
    const id = s.cutexSessionId;
    if (seen.has(id) || (only && !only.has(id))) return;
    seen.add(id);
    const host = sidebar?.hostRows?.[id];
    const projectId = host?.projectId ?? null;
    const projectName = projectId ? host?.projectName || projects.get(projectId) || projectId : null;
    const name = s.displayName || s.formalAgentName || id;
    rows.push({
      value: options.keyOf ? options.keyOf(id) : id,
      name,
      projectId,
      projectName,
      archived,
      ...(!projectId && isQuickChat(s, host) ? { quickChat: true } : {}),
      hostLabel: options.hostLabel,
      searchText: [name, s.formalAgentName, projectName, options.hostLabel, s.note, id].filter(Boolean).join("\n"),
    });
  };
  for (const s of sidebar?.active ?? []) if (s.lifecycle !== "retired") add(s, false);
  if (options.include === "all") {
    for (const s of sidebar?.retired ?? []) add(s, true);
    for (const s of sidebar?.active ?? []) if (s.lifecycle === "retired") add(s, true);
  }
  return rows;
}

/** Picker rows for a list that comes from elsewhere (e.g. main's browser agents), placed in projects by the sidebar. */
export function listPickerRows(items: readonly { id: string; name: string }[], sidebar: Snapshot): AgentPickerRow[] {
  const known = new Map(sidebarPickerRows(sidebar, { include: "all" }).map((r) => [r.value, r]));
  return items.map(({ id, name }) => {
    const r = known.get(id);
    return r ?? { value: id, name: name || id, projectId: null, projectName: null, archived: false, searchText: `${name}\n${id}` };
  });
}

/** Project order for the groups: the sidebar's dragged order of that host, then the snapshot's. */
export function pickerProjectRank(sidebar: Snapshot, projectOrder: readonly string[], hostId: string): Map<string, number> {
  return new Map(securityProjectIds(sidebar, projectOrder, hostId).map((id, i) => [id, i]));
}

/**
 * The grouped options: `top` (values, in order: the current agent, then recent picks) first, then projects
 * (by `rank`, unknown ones by name), 独立, 快速对话 (`hiddenUntilSearch`: a current / recent quick chat still shows
 * on top), 已归档. Rows inside a group by name. A top row carries its project as `detail`, so it still says where it lives.
 */
export function agentPickerOptions(
  rows: readonly AgentPickerRow[],
  labels: AgentPickerLabels,
  options: { top?: readonly (string | null | undefined)[]; rank?: ReadonlyMap<string, number> } = {},
): SearchablePickerOption[] {
  const byValue = new Map(rows.map((r) => [r.value, r]));
  const topValues = [...new Set((options.top ?? []).filter((v): v is string => !!v && byValue.has(v)))];
  const top = new Set(topValues);
  const rank = options.rank ?? new Map<string, number>();
  const groupOf = (r: AgentPickerRow) => {
    const base = r.archived ? labels.archived : r.quickChat ? labels.chats : (r.projectName ?? labels.independent);
    return r.hostLabel ? `${base} · ${r.hostLabel}` : base;
  };
  // 0 = project, 1 = independent, 2 = quick chat, 3 = archived; then host, project rank, project name, agent name.
  const tier = (r: AgentPickerRow) => (r.archived ? 3 : r.projectId ? 0 : r.quickChat ? 2 : 1);
  const rest = rows
    .filter((r) => !top.has(r.value))
    .sort(
      (a, b) =>
        tier(a) - tier(b) ||
        (a.hostLabel ?? "").localeCompare(b.hostLabel ?? "") ||
        (tier(a) === 0 ? (rank.get(a.projectId!) ?? Infinity) - (rank.get(b.projectId!) ?? Infinity) || compareNames(a.projectName!, b.projectName!) || a.projectId!.localeCompare(b.projectId!) : 0) ||
        compareNames(a.name, b.name) ||
        a.value.localeCompare(b.value),
    );
  const option = (r: AgentPickerRow, group: string, detail?: string | null): SearchablePickerOption => ({ value: r.value, label: r.name, group, searchText: r.searchText, ...(detail ? { detail } : {}) });
  return [
    ...topValues.map((v) => {
      const r = byValue.get(v)!;
      return option(r, labels.top, r.archived ? labels.archived : (r.projectName ?? (r.quickChat ? labels.chats : labels.independent)) + (r.hostLabel ? ` · ${r.hostLabel}` : ""));
    }),
    ...rest.map((r) => (r.quickChat && !r.archived ? { ...option(r, groupOf(r)), hiddenUntilSearch: true } : option(r, groupOf(r)))),
  ];
}

const RECENT_KEY = "cutex.agentPicker.recent";
const RECENT_MAX = 5;

/** The last picks of one picker (`context`, e.g. "harness") on one host, newest first. */
export function recentAgentPicks(context: string, hostId: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}") as unknown;
    const list = all && typeof all === "object" ? (all as Record<string, unknown>)[`${context}\n${hostId}`] : null;
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberAgentPick(context: string, hostId: string, value: string): void {
  if (!value) return;
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}") as unknown;
    const all = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    all[`${context}\n${hostId}`] = [value, ...recentAgentPicks(context, hostId).filter((v) => v !== value)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(all));
  } catch {
    /* per-viewer convenience only */
  }
}
