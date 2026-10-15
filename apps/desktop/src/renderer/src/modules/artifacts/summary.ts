// The 项目 overview's count phrase for the 成果库 tab (`project.tab` useSummary, §21): one list page
// of the project's scope (not archived), reloaded on the host's artifact events.
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { services } from "../app";
import type { ProjectTabProps } from "../slots";
import { DEFAULT_LIBRARY, libraryQuery } from "./model";
import { useEpoch } from "./store";

const PAGE = 100;

/** 「3 个成果」 (「100+ 个成果」 past one page); null while loading, on an error or with none. */
export function useProjectArtifactsSummary({ hostId, projectId }: ProjectTabProps): string | null {
  const { t } = useI18n();
  const epoch = useEpoch(hostId);
  const [count, setCount] = useState<{ key: string; n: string } | null>(null);
  const key = `${hostId}|${projectId}`;
  useEffect(() => {
    let live = true;
    services
      .daemonFor(hostId)
      .artifactStoreList(libraryQuery({ project: projectId }, DEFAULT_LIBRARY, PAGE))
      .then(
        (list) => live && setCount({ key, n: !list || !list.items.length ? "" : list.nextCursor ? `${list.items.length}+` : String(list.items.length) }),
        () => live && setCount({ key, n: "" }),
      );
    return () => {
      live = false;
    };
  }, [hostId, projectId, key, epoch]);
  return count && count.key === key && count.n ? t("artifacts.projectCount", { n: count.n }) : null;
}
