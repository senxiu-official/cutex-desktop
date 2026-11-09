// React half of lib/agentPickerOptions: one host's agents as grouped SearchableSelect options, the words
// of the picker, and the recent-pick memory of one picker (`context`).
import { useMemo } from "react";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { agentPickerOptions, pickerProjectRank, recentAgentPicks, rememberAgentPick, sidebarPickerRows, type AgentPickerLabels } from "./agentPickerOptions";
import { useUiPrefs } from "./prefs";

export function useAgentPickerLabels(): AgentPickerLabels & { search: string; empty: string; hiddenNote(count: number): string } {
  const { t } = useI18n();
  return { top: t("agentPicker.top"), independent: t("agentPicker.independent"), archived: t("agentPicker.archived"), chats: t("agentPicker.chats"), hiddenNote: (n: number) => t("agentPicker.hiddenChats", { n }), search: t("agentPicker.search"), empty: t("agentPicker.empty") };
}

export function useAgentPicker(
  hostId: string,
  sidebar: SidebarSnapshot | null | undefined,
  options: { context: string; include?: "active" | "all"; only?: readonly string[]; current?: string | null },
) {
  const labels = useAgentPickerLabels();
  const { projectOrder } = useUiPrefs();
  const onlyKey = options.only?.join("\n");
  const options_ = useMemo(() => {
    const rows = sidebarPickerRows(sidebar, { include: options.include, only: options.only });
    const recent = recentAgentPicks(options.context, hostId);
    return agentPickerOptions(rows, labels, { top: [options.current, ...recent], rank: pickerProjectRank(sidebar, projectOrder ?? [], hostId) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebar, hostId, options.include, onlyKey, options.current, options.context, projectOrder, labels.top]);
  return { options: options_, labels, remember: (value: string) => rememberAgentPick(options.context, hostId, value) };
}
