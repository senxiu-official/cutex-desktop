// 「N 个智能体在用」 on a Profile card / editor: a plain menu of the agents using the Profile, or — above
// PROFILE_AGENTS_MENU_MAX of them — the shared searchable agent picker (lib/agentPickerOptions; owner 2026-11-09).
import type { MouseEvent, ReactNode } from "react";
import type { SessionResource } from "@cutex-desktop/protocol";
import { openMenuFrom } from "../../lib/contextMenu";
import { agentPickerOptions, pickerProjectRank, sidebarPickerRows } from "../../lib/agentPickerOptions";
import { useAgentPickerLabels } from "../../lib/useAgentPicker";
import { useUiPrefs } from "../../lib/prefs";
import { useTargetHostId, useTargetSidebar } from "../../lib/targetHost";
import { Popover } from "../Menu";
import { SearchablePickerBody } from "../SearchablePicker";

/** Up to this many agents the plain menu is enough. */
export const PROFILE_AGENTS_MENU_MAX = 8;

export function ProfileAgentsButton({ agents, onPick, title, className, disabled, children }: {
  agents: readonly Pick<SessionResource, "cutexSessionId" | "displayName">[];
  onPick(sessionId: string): void;
  title: string;
  className: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const sidebar = useTargetSidebar();
  const hostId = useTargetHostId();
  const labels = useAgentPickerLabels();
  const { projectOrder } = useUiPrefs();
  // The card itself opens the editor on click: the button's clicks stay here.
  const stop = (e: MouseEvent) => e.stopPropagation();
  if (agents.length <= PROFILE_AGENTS_MENU_MAX)
    return (
      <button
        disabled={disabled}
        title={title}
        className={className}
        onClick={(e) => {
          stop(e);
          openMenuFrom(e.currentTarget, agents.map((a) => ({ label: a.displayName, onSelect: () => onPick(a.cutexSessionId) })));
        }}
      >
        {children}
      </button>
    );
  const ids = agents.map((a) => a.cutexSessionId);
  // Rows the sidebar does not know (not loaded yet) still get a plain row under their own name.
  const known = sidebarPickerRows(sidebar, { include: "all", only: ids });
  const missing = agents.filter((a) => !known.some((r) => r.value === a.cutexSessionId)).map((a) => ({ value: a.cutexSessionId, name: a.displayName, projectId: null, projectName: null, archived: false, searchText: `${a.displayName}\n${a.cutexSessionId}` }));
  const options = agentPickerOptions([...known, ...missing], labels, { rank: pickerProjectRank(sidebar, projectOrder ?? [], hostId) });
  return (
    <span onClick={stop} className="contents">
      <Popover disabled={disabled} triggerTitle={title} triggerLabel={title} triggerClassName={className} width="w-72" trigger={children}>
        {(close) => (
          <SearchablePickerBody
            options={options}
            label={title}
            placeholder={labels.search}
            emptyLabel={labels.empty}
            hiddenNote={labels.hiddenNote}
            onPick={(id) => {
              close();
              onPick(id);
            }}
          />
        )}
      </Popover>
    </span>
  );
}
