// Settings → 模块 (docs/desktop-modules.md §5): one row per built-in module — name, description,
// state and its switch; core modules are locked (核心). The state is written out only when the switch
// does not already say it (不可用：缺 X / 出错 + 重试 / 启动中 …); 已启用 / 已关闭 are the dot's tooltip.
import { useI18n } from "../../i18n";
import { Button, ListRow, Section, SettingsGroup, Toggle } from "../../components/settings/Form";
import { appModules } from "../app";
import { useModuleStatuses } from "../react";
import type { ModuleState } from "../types";
import { packRow, usePackRuntime } from "../packs";
import { useModuleDevView } from "../devModules";
import { DevModulesGroup } from "./DevModules";
import { ModuleDataGroup } from "./ModuleData";
import { LocalPacksGroup, PackActions, PackBelow, PackIndexHeader, PackOnlyRows, PackSourceTag } from "./ModulePacks";
import { Tag } from "../../components/Tag";
import { settingsAnchorId } from "../../lib/settingsNav";
import { keyVar, MODULE_COMMANDS } from "../../lib/keybindings";

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
  const packs = usePackRuntime();
  // Signed packs (§23.9): only with a module-pack bridge (Electron, or the preview's mock).
  // A module you added is the one you came here for: above the long list of the app's own.
  const devView = useModuleDevView();
  const added = new Set<string>([...(packs.view?.installed ?? []).filter((p) => p.local).map((p) => p.id), ...(devView?.modules ?? []).flatMap((m) => (m.id ? [m.id] : []))]);
  const packRowOf = (id: string) => (packs.view ? packRow(id, packs, packs.bundled ? id in packs.bundled : true, packs.bundled?.[id] ?? null) : null);
  return (
    <Section>
      <PackIndexHeader />
      <LocalPacksGroup />
      <DevModulesGroup />
      <ModuleDataGroup />
      {[...host.modules].sort((a, b) => Number(added.has(b.id)) - Number(added.has(a.id))).map((def) => {
        const status = statuses.get(def.id);
        const state = status?.state ?? { kind: "disabled" as const };
        const title = def.displayName ?? t(def.titleKey);
        const pack = def.required ? null : packRowOf(def.id);
        return (
          <div key={def.id} id={settingsAnchorId(`module-${def.id}`)}>
          {/* Only the browser module serves agents: off = its relay refuses agent browser calls at once (main/browser/install.ts moduleEnabled). */}
          <SettingsGroup agents={def.id === "browser" ? "now" : "none"} source="local" readOnly={!!def.required && state.kind !== "failed" && !status?.lastError}>
          <ListRow
            leading={<span className={`h-2 w-2 shrink-0 rounded-full ${DOT[state.kind]}`} title={stateText(state)} aria-hidden />}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{title}</span>
                {pack && <PackSourceTag row={pack} />}
                {state.kind !== "active" && state.kind !== "disabled" && (
                  <span className={`shrink-0 text-xs ${state.kind === "failed" ? "text-danger" : "text-subtle"}`} title={stateText(state)}>
                    {stateText(state)}
                  </span>
                )}
              </span>
            }
            detail={def.descriptionKey ? t(def.descriptionKey, MODULE_COMMANDS[def.id] ? keyVar(MODULE_COMMANDS[def.id]!) : undefined) : undefined}
            below={
              <>
                {status?.lastError && (
                  <p className="pb-0.5 pl-[18px] text-xs text-warn" title={status.lastError.message}>
                    {t("modules.lastError", { message: status.lastError.message })}
                  </p>
                )}
                {pack && <PackBelow row={pack} />}
              </>
            }
            actions={
              <>
                {(state.kind === "failed" || status?.lastError) && <Button onClick={() => void host.retry(def.id)}>{t("modules.retry")}</Button>}
                {pack && <PackActions row={pack} name={title} />}
                {def.required ? (
                  <Tag>{t("modules.core")}</Tag>
                ) : (
                  <Toggle label={title} checked={host.isEnabled(def.id)} onChange={(on) => void host.setEnabled(def.id, on)} />
                )}
              </>
            }
          />
          </SettingsGroup>
          </div>
        );
      })}
      <PackOnlyRows known={new Set(host.modules.map((m) => m.id))} />
    </Section>
  );
}
