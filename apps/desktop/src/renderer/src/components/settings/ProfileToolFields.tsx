// Profile tools share the editor's draft and save bar, including the two search controls' coupling.
import type { ProfileConfig, ProfileDetail, ProfilePatch, WebSearchMode } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { FIELD_W } from "../../lib/fieldWidths";
import { fieldOffered } from "../../lib/profileKind";
import { InfoTip, SettingRow, Select, Toggle } from "./Form";

const WEB_SEARCH: WebSearchMode[] = ["disabled", "cached", "live"];

export function ProfileToolFields({ detail, cfg, set, searchTool, part = "all" }: { detail: ProfileDetail; cfg: Partial<ProfileConfig>; set(p: ProfilePatch): void; searchTool?: boolean; part?: "all" | "native" | "search" }) {
  const { t } = useI18n();
  return <>
      {/* Codex registers update_plan only with tools.update_plan.enabled; it feeds the capsule's 进程. */}
      {part !== "search" && fieldOffered(detail, "updatePlanEnabled") && (
        <SettingRow source="host" agents="next" label={<span title="update_plan">{t("agent-config.profile.updatePlan")}<InfoTip>{t("settings.profileCompat.updatePlan" as MessageKey)}</InfoTip></span>} hint={t("agent-config.profile.updatePlanHint")}>
          <Toggle checked={cfg.updatePlanEnabled === true} onChange={(v) => set({ updatePlanEnabled: v })} />
        </SettingRow>
      )}
      {/* Codex's built-in web_search; some providers refuse it next to function calls (cutex preset gemini = off). */}
      {part !== "search" && fieldOffered(detail, "webSearch") && (
        <SettingRow source="host" agents="next" label={<span title="web_search">{t("agent-config.profile.webSearch")}<InfoTip>{t("settings.profileCompat.builtinSearch" as MessageKey)}</InfoTip></span>} hint={t("agent-config.profile.webSearchHint")}>
          <Select
            width={FIELD_W.model}
            value={cfg.webSearch ?? ""}
            options={[
              { value: "", label: t("agent-config.profile.webSearch.default") },
              // "indexed" only when already set (not offered otherwise).
              ...[...WEB_SEARCH, ...(cfg.webSearch === "indexed" ? (["indexed"] as const) : [])].map((v) => ({ value: v, label: t(`agent-config.profile.webSearch.${v}` as MessageKey) })),
            ]}
            onChange={(v) => set({ webSearch: (v || null) as WebSearchMode | null })}
          />
        </SettingRow>
      )}
      {/* cutex profile-search-tool: the separate search-only `web_search` cutex tool, for providers
          that refuse the built-in search next to function calls. Owner switch, default off. */}
      {/* Turning it on also turns 内置网页搜索 off in the same draft (the tool exists for providers that
          refuse the two together; owner 2026-10-15 switched only one and kept the 400). Generic, no
          provider check; while both stay on, a line under the row offers to turn the built-in off. */}
      {part !== "native" && fieldOffered(detail, "searchTool") && (
        <SettingRow source="host" agents="offNowOnNext" label={<span title="web_search (cutex)">{t("agent-config.profile.searchTool")}<InfoTip>{t("settings.profileCompat.searchTool" as MessageKey)}</InfoTip></span>} hint={t("agent-config.profile.searchToolHint")}>
          <Toggle
            checked={searchTool ?? detail.searchTool ?? false}
            onChange={(v) => set(v && fieldOffered(detail, "webSearch") && cfg.webSearch !== "disabled" ? { searchTool: true, webSearch: "disabled" } : { searchTool: v })}
          />
        </SettingRow>
      )}
      {part !== "native" && fieldOffered(detail, "searchTool") && fieldOffered(detail, "webSearch") && (searchTool ?? detail.searchTool ?? false) && cfg.webSearch !== "disabled" && (
        <p data-search-tool-conflict className="-mt-1 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-warn">
          {t("agent-config.profile.searchToolBuiltinOn")}
          <button type="button" onClick={() => set({ webSearch: "disabled" })} className="rounded-md border border-border px-2 py-0.5 text-foreground hover:bg-hover">
            {t("agent-config.profile.searchToolBuiltinOff")}
          </button>
        </p>
      )}
  </>;
}
