// Settings → 模块 (docs/desktop-modules.md §5): one row per built-in module — name, description,
// state and its switch; core modules are locked (核心). The state is written out only when the switch
// does not already say it (不可用：缺 X / 出错 + 重试 / 启动中 …); 已启用 / 已关闭 are the dot's tooltip.
import { useI18n } from "../../i18n";
import { Button, ListRow, Section, Toggle } from "../../components/settings/Form";
import { appModules } from "../app";
import { useModuleStatuses } from "../react";
import { listedInSettings, revealUnlistedModules } from "../settingsVisibility";
import { isExternalModuleId } from "../external";
import { ExternalBadge } from "../ExternalBadge";
import type { ModuleState } from "../types";

const DOT: Record<ModuleState["kind"], string> = {
  active: "bg-ok",
  activating: "bg-warn",
  stopping: "bg-warn",
  unavailable: "bg-subtle/60",
  disabled: "border border-subtle/60",
  failed: "bg-danger",
};

export function ModulesPage() {
  const { t } = useI18n();
  const statuses = useModuleStatuses();
  const host = appModules();
  const stateText = (state: ModuleState): string => {
    switch (state.kind) {
      case "active":
      case "activating":
      case "stopping":
      case "disabled":
        return t(`modules.state.${state.kind}`);
      case "failed":
        return t("modules.state.failed", { error: state.error });
      case "unavailable": {
        const m = state.missing;
        const reasons: string[] = [];
        if (m.waiting) reasons.push(t("modules.missing.waiting"));
        else if (m.capabilities.length) reasons.push(t("modules.missing.capabilities", { list: m.capabilities.join(", ") }));
        if (m.modules.length) reasons.push(t("modules.missing.modules", { list: m.modules.map((id) => moduleTitle(id)).join(", ") }));
        if (m.hostKind) reasons.push(t("modules.missing.hostKind"));
        return t("modules.state.unavailable", { reason: reasons.join("；") });
      }
    }
  };
  const moduleTitle = (id: string) => {
    const def = host.modules.find((m) => m.id === id);
    return def ? (def.displayName ?? t(def.titleKey)) : id;
  };
  const reveal = revealUnlistedModules();
  return (
    <Section>
      {host.modules.filter((def) => listedInSettings(def.id, host.isEnabled(def.id), reveal)).map((def) => {
        const status = statuses.get(def.id);
        const state = status?.state ?? { kind: "disabled" as const };
        const title = def.displayName ?? t(def.titleKey);
        return (
          <ListRow
            key={def.id}
            leading={<span className={`h-2 w-2 shrink-0 rounded-full ${DOT[state.kind]}`} title={stateText(state)} aria-hidden />}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{title}</span>
                {isExternalModuleId(def.id) && <ExternalBadge />}
                {state.kind !== "active" && state.kind !== "disabled" && (
                  <span className={`shrink-0 text-xs ${state.kind === "failed" ? "text-danger" : "text-subtle"}`} title={stateText(state)}>
                    {stateText(state)}
                  </span>
                )}
              </span>
            }
            detail={def.descriptionKey ? t(def.descriptionKey) : undefined}
            below={
              status?.lastError ? (
                <p className="pb-0.5 pl-[18px] text-xs text-warn" title={status.lastError.message}>
                  {t("modules.lastError", { message: status.lastError.message })}
                </p>
              ) : undefined
            }
            actions={
              <>
                {(state.kind === "failed" || status?.lastError) && <Button onClick={() => void host.retry(def.id)}>{t("modules.retry")}</Button>}
                {def.required ? (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-subtle">{t("modules.core")}</span>
                ) : (
                  <Toggle label={title} checked={host.isEnabled(def.id)} onChange={(on) => void host.setEnabled(def.id, on)} />
                )}
              </>
            }
          />
        );
      })}
    </Section>
  );
}
