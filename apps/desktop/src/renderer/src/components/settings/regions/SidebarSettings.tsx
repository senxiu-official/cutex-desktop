// The left sidebar's settings as four cards, shared by 设置 → 左侧栏 (AppSettings SidebarPage) and its
// 在主界面调整 panel (components/CustomizeHost, compact). One set of rows, so the two never disagree.
// No preview of the sidebar in Settings (owner 2026-10-18): a UI region is previewed only in the main
// window (docs/research/rfc-in-place-settings-20261018.md).
import { useLayoutView } from "../../../lib/userLayoutView";
import { useApp } from "../../../store";
import { useI18n, type MessageKey } from "../../../i18n";
import { migrateOlderProjectsAfter, OLDER_PROJECTS_AFTER } from "../../../lib/rosterTiers";
import { PROJECT_SEPARATIONS } from "../../../lib/projectSeparation";
import { STATUS_CHIPS } from "../../../lib/statusChips";
import { SIDEBAR_LAYOUTS, setUiPref, uiPrefDefault, useUiPrefs, type ProjectIconStyle, type SystemRowStyle, type UiPrefs } from "../../../lib/prefs";
import { RUNNING_AGENTS } from "../../../lib/runningAgentsPref";
import { settingsAnchorId } from "../../../lib/settingsNav";
import { AppearanceNumberRow } from "../AppearanceRows";
import { Button, ResetButton, Section, Segmented, Select, SettingRow, Toggle, TextLink, SettingsGroup } from "../Form";

/**
 * 恢复默认 of a pref row: enabled (= the row is 「改过」) while the value differs from the default. A
 * ResetButton element itself: SettingRow reads its `disabled`.
 */
function prefReset<K extends keyof UiPrefs>(ui: UiPrefs, field: K) {
  const def = uiPrefDefault(field);
  return <ResetButton disabled={ui[field] === def} onClick={() => setUiPref(field, def)} />;
}

function useTip() {
  const { t } = useI18n();
  return (key: string) => t(key as MessageKey);
}

export function SidebarProjectsCard() {
  const personal = useLayoutView(s => !!s.memoryHost && s.status !== "unsupported");
  const { t } = useI18n();
  const tip = useTip();
  const ui = useUiPrefs();
  return (
    <Section
      id={settingsAnchorId("projects")}
      title={t("appearance.sidebar.projects")}
      actions={
        <SettingsGroup agents="none" source={personal ? "person" : "local"}><Button title={t("appearance.projectOrderHint")} disabled={ui.projectOrder.length === 0} onClick={() => setUiPref("projectOrder", [])}>
          {t("appearance.projectOrderReset")}
        </Button></SettingsGroup>
      }
    >
      <SettingRow agents="none" source="local" label={t("appearance.projectGrouping")} info={t("appearance.projectGroupingHint")} reset={prefReset(ui, "projectGrouping")}>
        <Segmented
          value={ui.projectGrouping}
          options={(["all", "starred"] as const).map((v) => ({ value: v, label: t(`appearance.projectGrouping.${v}` as MessageKey), title: tip(`appearance.projectGrouping.${v}.tip`) }))}
          onChange={(v) => setUiPref("projectGrouping", v)}
        />
      </SettingRow>
      {/* The hint stays put whichever grouping is picked (owner 2026-10-18: a hint that comes and goes jitters the page). */}
      <SettingRow agents="none" source="local" label={t("appearance.noOnlineProjects")} hint={t("appearance.noOnlineProjectsOff")} reset={prefReset(ui, "noOnlineProjects")}>
        <Segmented
          value={ui.noOnlineProjects}
          disabled={ui.projectGrouping !== "all"}
          options={(["collapse", "expand"] as const).map((v) => ({ value: v, label: t(`appearance.noOnlineProjects.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("noOnlineProjects", v)}
        />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("appearance.olderProjects")} hint={t("appearance.olderProjectsHint")} reset={prefReset(ui, "olderProjectsAfter")}>
        <Segmented
          value={String(ui.olderProjectsAfter)}
          disabled={ui.projectGrouping !== "all"}
          options={OLDER_PROJECTS_AFTER.map((v) => ({ value: String(v), label: t(`appearance.olderProjects.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("olderProjectsAfter", migrateOlderProjectsAfter(v === "off" ? v : Number(v)))}
        />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("appearance.sectionCollapsed")} hint={t("appearance.sectionCollapsedHint")} reset={prefReset(ui, "sectionCollapsedShows")}>
        <Segmented
          value={ui.sectionCollapsedShows}
          options={(["summary", "attention"] as const).map((v) => ({ value: v, label: t(`appearance.sectionCollapsed.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("sectionCollapsedShows", v)}
        />
      </SettingRow>
    </Section>
  );
}

export function SidebarAgentRowsCard() {
  const { t } = useI18n();
  const tip = useTip();
  const ui = useUiPrefs();
  return (
    // A link to another page sits in the card's header, never loose under its last row.
    <Section id={settingsAnchorId("agentRows")} title={t("appearance.sidebar.agentRows")} actions={<TextLink onClick={() => useApp.getState().openSettings("appearance", { anchor: "avatars" })}>{t("settings.ia.avatarLink")}</TextLink>}>
      {/* 侧栏布局 (design 040 §4, step 14): 花名册 (default) or 现在 / 全部 (components/SidebarNowAll). */}
      <SettingRow agents="none" source="local" label={t("appearance.sidebarLayout")} hint={t("appearance.sidebarLayoutHint")} reset={prefReset(ui, "sidebarLayout")}>
        <Segmented value={ui.sidebarLayout} options={SIDEBAR_LAYOUTS.map((v) => ({ value: v, label: t(`appearance.sidebarLayout.${v}` as MessageKey) }))} onChange={(v) => setUiPref("sidebarLayout", v)} />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("appearance.runningAgents")} hint={t("appearance.runningAgentsHint")} reset={prefReset(ui, "runningAgents")}>
        <Segmented
          value={ui.runningAgents}
          options={RUNNING_AGENTS.map((v) => ({ value: v, label: t(`appearance.runningAgents.${v}` as MessageKey), title: tip(`appearance.runningAgents.${v}.tip`) }))}
          onChange={(v) => setUiPref("runningAgents", v)}
        />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("appearance.statusChips")} hint={t("appearance.statusChipsHint")} reset={prefReset(ui, "statusChips")}>
        <Segmented
          value={ui.statusChips}
          options={STATUS_CHIPS.map((v) => ({ value: v, label: t(`appearance.statusChips.${v}` as MessageKey), title: tip(`appearance.statusChips.${v}.tip`) }))}
          onChange={(v) => setUiPref("statusChips", v)}
        />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("appearance.rowPreview")} reset={prefReset(ui, "rowPreview")}>
        <Segmented
          value={ui.rowPreview}
          options={(["off", "director", "all"] as const).map((v) => ({ value: v, label: t(`appearance.rowPreview.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("rowPreview", v)}
        />
      </SettingRow>
    </Section>
  );
}

export function SidebarStyleCard() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  return (
    <Section id={settingsAnchorId("sidebarStyle")} title={t("appearance.sidebar.style")}>
      {/* Project icons everywhere (components/ProjectBadge): 淡底色 tile or 线条 glyph only, same box. */}
      <SettingRow agents="none" source="local" label={t("appearance.projectIconStyle")} hint={t("appearance.projectIconStyleHint")} reset={prefReset(ui, "projectIconStyle")}>
        <Segmented
          label={t("appearance.projectIconStyle")}
          value={ui.projectIconStyle}
          options={(["tint", "line"] as ProjectIconStyle[]).map((v) => ({ value: v, label: t(`appearance.projectIconStyle.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("projectIconStyle", v)}
        />
      </SettingRow>
      {/* 项目颜色 (owner 2026-10-18): one choice, right under the icon style (both are about the project colour). */}
      <SettingRow agents="none" source="local" label={t("appearance.projectSeparation")} info={t("appearance.projectSeparationHint")} reset={prefReset(ui, "projectSeparation")}>
        <Select
          value={ui.projectSeparation}
          options={PROJECT_SEPARATIONS.map((v) => ({ value: v, label: t(`appearance.projectSeparation.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("projectSeparation", v)}
        />
      </SettingRow>
      {/* 系统行样式 (owner 2026-11-06): 独立智能体 / 快速会话 / top-level 更早的项目 vs the owner's folders. */}
      <SettingRow agents="none" source="local" label={t("appearance.systemRows")} hint={t("appearance.systemRowsHint")} reset={prefReset(ui, "systemRows")}>
        <Segmented
          label={t("appearance.systemRows")}
          value={ui.systemRows}
          options={(["line", "band"] as SystemRowStyle[]).map((v) => ({ value: v, label: t(`appearance.systemRows.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("systemRows", v)}
        />
      </SettingRow>
      <AppearanceNumberRow field="sidebarWidth" label="appearance.sidebarWidth" hint="appearance.sidebarWidthHint" unit="px" step={4} />
    </Section>
  );
}

/** The four cards in page order (设置 → 左侧栏 and the 调整左侧栏 panel). */
export function SidebarSettingsCards() {
  return (
    <>
      <SidebarProjectsCard />
      <SidebarAgentRowsCard />
      <SidebarStyleCard />
    </>
  );
}
