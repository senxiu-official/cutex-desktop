// Self-update status for the sidebar button (portable installs; see src/main/updater.ts).
import { useEffect, useState } from "react";
import type { UpdateStatus } from "../../../shared/ipc";
import { bridge } from "../bridge";

export { updateButtonVisible } from "../../../shared/update";

export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    const update = bridge.update;
    if (!update) return;
    let live = true;
    update.state().then((s) => live && setStatus(s), () => {});
    const off = bridge.on("updateStatus", (s) => setStatus(s));
    return () => {
      live = false;
      off();
    };
  }, []);
  return status;
}

/** The project's public repositories (Settings → 更新与诊断 → 项目); opened in the system browser. */
export const PROJECT_REPO_URL = "https://github.com/senxiu-official/cutex-desktop";
export const RELATED_REPO_URLS = [
  { name: "cutex-desktop", url: PROJECT_REPO_URL },
  { name: "cutex", url: "https://github.com/senxiu-official/cutex" },
  { name: "cute-codex", url: "https://github.com/senxiu-official/cute-codex" },
] as const;

/** One-line summary of the update on offer (tooltip / settings hint). */
export function updateSummary(t: (key: "update.available" | "update.offMain" | "updater.switchChannel" | ChannelLabelKey, vars?: Record<string, string | number>) => string, latest: NonNullable<UpdateStatus["latest"]>, channel = "main"): string {
  if (latest.switchChannel) return t("updater.switchChannel", { channel: channelLabel(t, channel), subject: latest.subject });
  return latest.offMain ? t("update.offMain", { subject: latest.subject, branch: channel }) : t("update.available", { count: latest.count, subject: latest.subject });
}

type ChannelLabelKey = "updater.channel.main" | "updater.channel.release";

/** 开发版 / 正式版 for the two known channels; any other branch by its name. */
export function channelLabel(t: (key: ChannelLabelKey) => string, channel: string): string {
  return channel === "main" ? t("updater.channel.main") : channel === "release" ? t("updater.channel.release") : channel;
}

/** Settings hint for an install that cannot update itself (UpdateStatus.code). */
export function unsupportedHintKey(code: UpdateStatus["code"]): "updater.unsupported.devRun" | "updater.unsupported.noSource" | "updater.unsupported.releasePackage" | "updater.unsupported.noGit" | "updater.unsupported.remoteUnreachable" | "updater.unsupported.channelMissing" | "updater.unsupported.other" {
  switch (code) {
    case "channelMissing":
      return "updater.unsupported.channelMissing";
    case "devRun":
      return "updater.unsupported.devRun";
    case "noSource":
      return "updater.unsupported.noSource";
    case "releasePackage":
      return "updater.unsupported.releasePackage";
    case "noGit":
      return "updater.unsupported.noGit";
    case "remoteUnreachable":
      return "updater.unsupported.remoteUnreachable";
    default:
      return "updater.unsupported.other";
  }
}
