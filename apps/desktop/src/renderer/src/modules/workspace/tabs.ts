// Tab titles / badges of the workspace cards (useTab hooks; kept out of the .tsx files).
import { useMemo } from "react";
import { useI18n } from "../../i18n";
import { diffTotals, useSelectedWorkspace } from "../../lib/workspaceView";
import type { SideTabInfo, SideTabProps } from "../slots";
import { baseOf, type PreviewState } from "./previewState";

export function useFilesTab(_props: SideTabProps<{ q: string }>): SideTabInfo {
  const { t } = useI18n();
  return { title: t("workspace.files") };
}

export function useChangesTab(_props: SideTabProps<null>): SideTabInfo {
  const { t } = useI18n();
  const { git } = useSelectedWorkspace();
  const files = useMemo(() => diffTotals(git).files, [git]);
  return { title: files ? t("workspace.changesCount", { n: files }) : t("workspace.changes"), tooltip: git?.branch ? `⎇ ${git.branch}` : undefined };
}

export function usePreviewTab({ instance }: SideTabProps<PreviewState>): SideTabInfo {
  const { path, line } = instance.state;
  return { title: baseOf(path), tooltip: line ? `${path}:${line}` : path };
}
