// 复制到其他主机 (cutex `profile-transfer`): which hosts can take a copy, and the result's warnings as
// text. The copy itself is main's (HostApi copyProfileToHost): the renderer never sees the bundle.
import { connectedHosts } from "../../../shared/hosts";
import { PROFILE_TRANSFER_FEATURE, type ProfileTransferWarning } from "../../../shared/profileTransfer";
import type { MessageKey } from "../i18n";
import { hostData, type HostDataSource } from "./hostScope";

/** Connected hosts other than `sourceHostId` whose cutex imports (the source must export). */
export function transferTargets(source: HostDataSource, sourceHostId: string): string[] {
  const from = hostData(source, sourceHostId);
  if (!from || from.daemon.kind !== "connected" || !from.features.has(PROFILE_TRANSFER_FEATURE)) return [];
  return connectedHosts(source.hosts).filter((id) => {
    if (id === sourceHostId) return false;
    const data = hostData(source, id);
    return !!data && data.daemon.kind === "connected" && data.features.has(PROFILE_TRANSFER_FEATURE);
  });
}

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** One warning as a sentence (zh-CN / en catalogs: agent-config.profile.transfer.w.*). */
export function transferWarningText(w: ProfileTransferWarning, t: T): string {
  switch (w.code) {
    case "needsLogin":
      return t(w.credential === "chatgpt" ? "agent-config.profile.transfer.w.needsLogin.chatgpt" : "agent-config.profile.transfer.w.needsLogin.apiKey");
    case "claudeAccountRebound": {
      const used = w.matched && w.accountLabel ? t("agent-config.profile.transfer.w.claudeMatched", { label: w.accountLabel }) : t("agent-config.profile.transfer.w.claudeDefault");
      // A source on the default account matched the default: only the login state matters then.
      const head = w.matched && !w.accountLabel ? "" : used;
      const login = w.loggedIn === false ? t("agent-config.profile.transfer.w.claudeLogin") : "";
      return [head, login].filter(Boolean).join("; ") || t("agent-config.profile.transfer.claude");
    }
    case "privateAuthReset":
      return t("agent-config.profile.transfer.w.privateAuthReset");
    case "runtimeDockerImage":
      return t("agent-config.profile.transfer.w.runtimeDockerImage", { image: w.image });
    case "proxyCleared":
      return t("agent-config.profile.transfer.w.proxyCleared");
    case "proxyCopied":
      return t("agent-config.profile.transfer.w.proxyCopied");
    case "secretFieldsCleared":
      return t("agent-config.profile.transfer.w.secretFieldsCleared", { fields: w.fields.join(", ") });
    default:
      return t("agent-config.profile.transfer.w.other", { name: w.name });
  }
}
