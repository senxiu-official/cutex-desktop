// The 项目 overview's count phrase for the 服务 tab (`project.tab` useSummary, §21).
import { useMemo } from "react";
import { useI18n } from "../../i18n";
import { useHostData } from "../../lib/useHostScope";
import type { ProjectTabProps } from "../slots";
import { projectServiceList } from "./model";

/** 「2 个服务」; null while the host's list is not loaded or the project has none. */
export function useProjectServicesSummary({ hostId, projectId }: ProjectTabProps): string | null {
  const { t } = useI18n();
  const list = useHostData(hostId)?.services;
  const n = useMemo(() => (list ? projectServiceList(list, projectId).length : 0), [list, projectId]);
  return n > 0 ? t("services.projectCount", { n }) : null;
}
