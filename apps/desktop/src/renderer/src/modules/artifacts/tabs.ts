// Tab titles of the 成果 cards (useTab hooks; cheap: only cached data, never a fetch).
import { parseArtifactRef } from "../../../../shared/artifactStore";
import { useI18n } from "../../i18n";
import type { SideTabInfo, SideTabProps } from "../slots";
import type { LibraryState, ViewState } from "./model";
import { useCachedDetail } from "./store";

export function useLibraryTab(_props: SideTabProps<LibraryState>): SideTabInfo {
  const { t } = useI18n();
  return { title: t("artifacts.library") };
}

/** 「regression.md v2」 (pinned) / 「regression.md · 最新」 (follows latest); a pinned tab behind the latest shows a dot. */
export function useViewTab({ instance, hostId }: SideTabProps<ViewState>): SideTabInfo {
  const { t } = useI18n();
  const parts = parseArtifactRef(instance.state.ref);
  const detail = useCachedDetail(hostId, parts?.artifactId ?? null);
  const name = detail?.artifact.name ?? instance.state.name ?? instance.state.ref;
  const short = name.split("/").pop() || name;
  if (!parts) return { title: short };
  const latest = parts.version === "latest";
  const tooltip = `${name} · ${latest ? t("artifacts.followsLatest") : t("artifacts.pinnedHint")}`;
  const newer = !latest && !!detail && detail.artifact.latestVersion > (parts.version as number);
  return { title: latest ? `${short} · ${t("artifacts.latestTab")}` : `${short} v${parts.version}`, tooltip, ...(newer ? { unread: true } : {}) };
}
