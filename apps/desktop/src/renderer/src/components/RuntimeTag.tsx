// The agent's actual runtime in the conversation header (docs/design/042): cutex's answer — the session's fixed
// `launchBinding` (profile-runtime-variants), else what the runtime reports. cute-codex is the plain case and has no tag.
import type { SessionResource } from "@cutex-desktop/protocol";
import { useI18n } from "../i18n";
import { runtimeOf } from "../lib/agentList";
import { RUNTIME_LABEL } from "../lib/profileVariants";
import { Tag } from "./Tag";

export function RuntimeTag({ session }: { session: SessionResource }) {
  const { t } = useI18n();
  const runtime = runtimeOf(session);
  const binding = session.launchBinding ?? null;
  if (runtime === "codex" || (runtime === "claude" && !binding)) return null;
  const title = binding
    ? t("variants.agent.runtimeTip", { runtime: RUNTIME_LABEL[runtime], profile: binding.profileId, variant: binding.variantId })
    : t("variants.agent.runtimeTipPlain", { runtime: RUNTIME_LABEL[runtime] });
  return <Tag data-conv-item="runtime" title={title}>{RUNTIME_LABEL[runtime]}</Tag>;
}
