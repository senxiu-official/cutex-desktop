// The left sidebar's settings as four cards, shared by 设置 → 左侧栏 (AppSettings SidebarPage) and its
// 在主界面调整 panel (components/CustomizeHost, compact). One set of rows, so the two never disagree.
// No preview of the sidebar in Settings (owner 2026-10-18): a UI region is previewed only in the main
// window (docs/research/rfc-in-place-settings-20261018.md).
import { useI18n, type MessageKey } from "../../../i18n";
import { migrateOfflineLimit, OFFLINE_LIMITS } from "../../../lib/offlineAgents";
import { PROJECT_SEPARATIONS } from "../../../lib/projectSeparation";
import { STATUS_CHIPS } from "../../../lib/statusChips";
import { setUiPref, uiPrefDefault, useUiPrefs, type ProjectIconStyle, type UiPrefs } from "../../../lib/prefs";
import { RUNNING_AGENTS } from "../../../lib/runningAgentsPref";
import { AGENT_AVATAR_DEFAULTS } from "../../../lib/avatarDefault";
import { FLYOUT_DELAYS, migrateFlyoutDelay } from "../../../lib/projectFlyout";
import { settingsAnchorId } from "../../../lib/settingsNav";
import { AppearanceNumberRow } from "../AppearanceRows";
import { Button, ResetButton, Section, Segmented, Select, SettingRow, Toggle } from "../Form";

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
  const { t } = useI18n();
  const tip = useTip();
  const ui = useUiPrefs();
  return (
    <Section
      id={settingsAnchorId("projects")}
      title={t("appearance.sidebar.projects")}
      actions={
        <Button title={t("appearance.projectOrderHint")} disabled={ui.projectOrder.length === 0} onClick={() => setUiPref("projectOrder", [])}>
          {t("appearance.projectOrderReset")}
        </Button>
      }
    >
      <SettingRow label={t("appearance.projectGrouping")} hint={t("appearance.projectGroupingHint")} reset={prefReset(ui, "projectGrouping")}>
        <Segmented
          value={ui.projectGrouping}
          options={(["all", "starred"] as const).map((v) => ({ value: v, label: t(`appearance.projectGrouping.${v}` as MessageKey), title: tip(`appearance.projectGrouping.${v}.tip`) }))}
          onChange={(v) => setUiPref("projectGrouping", v)}
        />
      </SettingRow>
      {/* The hint stays put whichever grouping is picked (owner 2026-10-18: a hint that comes and goes jitters the page). */}
      <SettingRow label={t("appearance.noOnlineProjects")} hint={t("appearance.noOnlineProjectsOff")} reset={prefReset(ui, "noOnlineProjects")}>
        <Segmented
          value={ui.noOnlineProjects}
          disabled={ui.projectGrouping !== "all"}
          options={(["collapse", "expand"] as const).map((v) => ({ value: v, label: t(`appearance.noOnlineProjects.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("noOnlineProjects", v)}
        />
      </SettingRow>
      <SettingRow label={t("appearance.sectionCollapsed")} hint={t("appearance.sectionCollapsedHint")} reset={prefReset(ui, "sectionCollapsedShows")}>
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
    <Section id={settingsAnchorId("agentRows")} title={t("appearance.sidebar.agentRows")}>
      <SettingRow label={t("appearance.runningAgents")} hint={t("appearance.runningAgentsHint")} reset={prefReset(ui, "runningAgents")}>
        <Segmented
          value={ui.runningAgents}
          options={RUNNING_AGENTS.map((v) => ({ value: v, label: t(`appearance.runningAgents.${v}` as MessageKey), title: tip(`appearance.runningAgents.${v}.tip`) }))}
          onChange={(v) => setUiPref("runningAgents", v)}
        />
      </SettingRow>
      <SettingRow label={t("appearance.statusChips")} hint={t("appearance.statusChipsHint")} reset={prefReset(ui, "statusChips")}>
        <Segmented
          value={ui.statusChips}
          options={STATUS_CHIPS.map((v) => ({ value: v, label: t(`appearance.statusChips.${v}` as MessageKey), title: tip(`appearance.statusChips.${v}.tip`) }))}
          onChange={(v) => setUiPref("statusChips", v)}
        />
      </SettingRow>
      <SettingRow label={t("appearance.rowPreview")} reset={prefReset(ui, "rowPreview")}>
        <Segmented
          value={ui.rowPreview}
          options={(["off", "director", "all"] as const).map((v) => ({ value: v, label: t(`appearance.rowPreview.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("rowPreview", v)}
        />
      </SettingRow>
      <SettingRow label={t("appearance.foldIdleAgents")} hint={t("appearance.foldIdleAgentsHint")} reset={prefReset(ui, "foldIdleAgents")}>
        <Toggle checked={ui.foldIdleAgents} onChange={(v) => setUiPref("foldIdleAgents", v)} />
      </SettingRow>
      <SettingRow label={t("appearance.agentAvatar")} hint={t("appearance.agentAvatarHint")} reset={prefReset(ui, "agentAvatarDefault")}>
        <Segmented
          value={ui.agentAvatarDefault}
          options={AGENT_AVATAR_DEFAULTS.map((v) => ({ value: v, label: t(`appearance.agentAvatar.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("agentAvatarDefault", v)}
        />
      </SettingRow>
      <SettingRow label={t("appearance.offlineAgents")} hint={t("appearance.offlineAgentsHint")} reset={prefReset(ui, "offlineAgents")}>
        <Segmented
          value={String(ui.offlineAgents)}
          options={OFFLINE_LIMITS.map((v) => ({ value: String(v), label: t(`appearance.offlineAgents.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("offlineAgents", migrateOfflineLimit(v === "all" ? v : Number(v)))}
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
      <SettingRow label={t("appearance.projectIconStyle")} hint={t("appearance.projectIconStyleHint")} reset={prefReset(ui, "projectIconStyle")}>
        <Segmented
          label={t("appearance.projectIconStyle")}
          value={ui.projectIconStyle}
          options={(["tint", "line"] as ProjectIconStyle[]).map((v) => ({ value: v, label: t(`appearance.projectIconStyle.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("projectIconStyle", v)}
        />
      </SettingRow>
      {/* 项目颜色 (owner 2026-10-18): one choice, right under the icon style (both are about the project colour). */}
      <SettingRow label={t("appearance.projectSeparation")} hint={t("appearance.projectSeparationHint")} reset={prefReset(ui, "projectSeparation")}>
        <Select
          value={ui.projectSeparation}
          options={PROJECT_SEPARATIONS.map((v) => ({ value: v, label: t(`appearance.projectSeparation.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("projectSeparation", v)}
        />
      </SettingRow>
      <AppearanceNumberRow field="sidebarWidth" label="appearance.sidebarWidth" hint="appearance.sidebarWidthHint" unit="px" step={4} />
    </Section>
  );
}

export function SidebarHoverCard() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  return (
    <Section id={settingsAnchorId("hoverPreview")} title={t("appearance.sidebar.hoverPreview")}>
      <SettingRow label={t("appearance.projectHoverPreview")} hint={t("appearance.projectHoverPreviewHint")} reset={prefReset(ui, "projectHoverPreview")}>
        <Toggle checked={ui.projectHoverPreview} onChange={(v) => setUiPref("projectHoverPreview", v)} />
      </SettingRow>
      {/* Always there, disabled while preview is off: a row that appears would move the page. */}
      <SettingRow label={t("appearance.projectHoverDelay")} reset={prefReset(ui, "projectHoverDelay")}>
        <Segmented
          value={String(ui.projectHoverDelay)}
          disabled={!ui.projectHoverPreview}
          options={FLYOUT_DELAYS.map((v) => ({ value: String(v), label: t(`appearance.projectHoverDelay.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("projectHoverDelay", migrateFlyoutDelay(Number(v)))}
        />
      </SettingRow>
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
      <SidebarHoverCard />
    </>
  );
}
