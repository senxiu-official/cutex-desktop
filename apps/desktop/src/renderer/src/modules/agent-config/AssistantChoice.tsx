// 新建智能体's 个人助理 choice (owner 2026-11-26): where agents are created, a host with personal assistants
// (cutex personal-assistants-local-v1) also offers one. It opens the 个人助理 page's own create form for that host —
// the form is not duplicated here. The words follow the 术语 setting ({{assistant}}).
import { ConciergeBell } from "lucide-react";
import { useI18n } from "../../i18n";
import { services } from "../app";

export function AssistantChoice({ hostId, disabled = false }: { hostId: string; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/70 bg-surface/70 px-2.5 py-1.5 text-xs" data-new-agent-assistant="">
      <ConciergeBell size={14} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-muted">{t("agent-config.newAgent.assistantChoice")}</span>
      <button type="button" disabled={disabled} className="press shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
        onClick={() => services.ui.openPage("personal-assistants.page", { view: "new", host: hostId })} data-new-agent-assistant-open="">
        {t("agent-config.newAgent.assistantCreate")}
      </button>
    </div>
  );
}
