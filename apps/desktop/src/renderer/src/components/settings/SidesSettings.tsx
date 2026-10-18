// Settings → 右侧栏与留白 (was 会话两侧; its own page since 2026-10-15; docs/desktop-modules.md §18.12): 右栏 (width,
// modes, keep-loaded limits, reset), 打开位置 (files, the reference card, and each component's default
// page group — editable, per device: UiPrefs.sideHomes — with the moved-to page and 恢复默认), and
// 留白 (§19: which gutter lists stay docked when the gutter is wide enough).
import { useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import type { ItemId } from "../../modules/types";
import { useSlot } from "../../modules/react";
import { SettingsSections } from "../../modules/Outlet";
import { setUiPref, useUiPrefs } from "../../lib/prefs";
import { pageLabel } from "../../lib/sideActions";
import { useSideRegistry } from "../../lib/sideComponents";
import { DEFAULT_ORDER, findPage } from "../../lib/sideLayout";
import { useSide } from "../../lib/sideLayoutStore";
import { resetSideLayout, restoreKindDefaultNow } from "../../lib/sideMenus";
import { clampDockPref, DOCK_WIDTH_DEFAULT, DOCK_WIDTH_RANGE } from "../../lib/gutterDock";
import { clampSetting, KEEP_HIDDEN_DEFAULT, KEEP_HIDDEN_RANGE, KEEP_MOUNTED_DEFAULT, KEEP_MOUNTED_RANGE } from "../../lib/sideKeep";
import { settingsAnchorId } from "../../lib/settingsNav";
import { AppearanceNumberRow } from "./AppearanceRows";
import { FIELD_W } from "../../lib/fieldWidths";
import { Button, NumberField, ResetButton, Section, Segmented, Select, SettingRow, Toggle } from "./Form";

function DefaultsTable() {
  const { t } = useI18n();
  // A component's default page group by name (`shell.sides.defaults.home.<group>`); a group without
  // a name in the catalog (a new module's) shows its id.
  const homeLabel = (home: string) => {
    const key = `shell.sides.defaults.home.${home}` as MessageKey;
    const label = t(key);
    return label === key ? home : label;
  };
  const registry = useSideRegistry();
  const layout = useSide((s) => s.layout);
  const { sideHomes } = useUiPrefs();
  const rows = [...registry.values()].sort((a, b) => (a.item.placement.order ?? DEFAULT_ORDER) - (b.item.placement.order ?? DEFAULT_ORDER));
  if (!rows.length) return <p className="py-2 text-xs text-subtle">{t("shell.sides.defaults.none")}</p>;
  // The page groups the available components declare (workspace, reference, artifacts, …).
  const homes = [...new Set(["workspace", ...rows.map(({ item }) => item.placement.home)])];
  // Only the components you changed (another default group, or moved) until 全部显示 (owner 2026-10-18:
  // twenty rows of selects made the page mostly this table).
  const [all, setAll] = useState(false);
  const changed = rows.filter(({ item }) => sideHomes[item.id] !== undefined || layout.overrides[item.id]);
  const shown = all ? rows : changed;
  // A new default group re-places the open ones too (their moved-to page, if any, is forgotten).
  const setHome = (kind: ItemId, home: string, declared: string) => {
    const next = { ...sideHomes };
    if (home === declared) delete next[kind];
    else next[kind] = home;
    setUiPref("sideHomes", next);
    restoreKindDefaultNow(kind);
  };
  return (
    <div className="divide-y divide-border">
      {!all && changed.length === 0 && <p className="py-2 text-xs text-subtle">{t("shell.sides.defaults.allDefault")}</p>}
      {shown.map(({ item }) => {
        const Icon = item.icon;
        const override = layout.overrides[item.id];
        const page = override ? findPage(layout, override.page) : null;
        const declared = item.placement.home;
        const home = sideHomes[item.id] ?? declared;
        return (
          <div key={item.id} className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-[13px]">
            <Icon size={14} className="shrink-0 text-subtle" />
            <span className="min-w-0 flex-1 truncate">{t(item.titleKey)}</span>
            {override && (
              <span className="shrink-0 truncate text-xs text-accent">
                {t("shell.sides.defaults.moved", { page: page ? pageLabel(page) : t("shell.sides.defaults.gonePage") })}
                <button onClick={() => restoreKindDefaultNow(item.id)} className="ml-1 rounded px-1.5 py-0.5 text-xs text-accent hover:bg-hover">
                  {t("side.restoreDefault")}
                </button>
              </span>
            )}
            <Select
              width="w-36"
              label={t(item.titleKey)}
              value={home}
              options={homes.map((h) => ({ value: h, label: h === declared ? t("shell.sides.defaults.declared", { group: homeLabel(h) }) : homeLabel(h) }))}
              onChange={(v) => setHome(item.id, v, declared)}
            />
          </div>
        );
      })}
      <div className="py-1.5">
        <button type="button" onClick={() => setAll(!all)} className="rounded text-xs text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
          {all ? t("shell.sides.defaults.onlyChanged") : t("shell.sides.defaults.showAll", { n: rows.length })}
        </button>
      </div>
    </div>
  );
}

/** 留白里常驻: one toggle per gutter item that may dock (dockMinWidth). */
function DockRows() {
  const { t } = useI18n();
  const { gutterDocked } = useUiPrefs();
  const items = useSlot("conversation.gutter").filter((e) => e.mode === "show" && e.item.Body && e.item.dockMinWidth);
  if (!items.length) return <p className="py-1 text-xs text-subtle">{t("shell.sides.gutterDocked.none")}</p>;
  return (
    <>
      {items.map(({ item }) => (
        <SettingRow key={item.id} label={t(item.titleKey)} hint={t("shell.sides.gutterDocked.min", { n: item.dockMinWidth! })}>
          <Toggle
            checked={gutterDocked.includes(item.id)}
            onChange={(v) => setUiPref("gutterDocked", v ? [...gutterDocked.filter((x) => x !== item.id), item.id] : gutterDocked.filter((x) => x !== item.id))}
          />
        </SettingRow>
      ))}
    </>
  );
}

export function SidesPage() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  const keepHidden = clampSetting(ui.sideKeepHidden, KEEP_HIDDEN_RANGE, KEEP_HIDDEN_DEFAULT);
  const keepMounted = clampSetting(ui.sideKeepMounted, KEEP_MOUNTED_RANGE, KEEP_MOUNTED_DEFAULT);
  const choice = <K extends "sideMode" | "sidePageBar" | "sidePillAnchor" | "sideLaneWhenHidden" | "sideCurrentPageClick" | "sideNarrow" | "peekTarget">(key: K, values: readonly string[], prefix: string) => (
    <Segmented
      value={ui[key] as string}
      options={values.map((v) => ({ value: v, label: t(`${prefix}.${v}` as MessageKey) }))}
      onChange={(v) => setUiPref(key, v as never)}
    />
  );
  return (
    <>
      <Section id={settingsAnchorId("sides")} title={t("shell.sides.rightPane")} hint={t("shell.sides.hint")}>
        <AppearanceNumberRow field="sidePaneWidth" label="pane.width" hint="shell.sides.widthHint" unit="px" step={10} />
        <SettingRow label={t("shell.sides.mode")} hint={t("shell.sides.modeHint")}>
          {choice("sideMode", ["push", "yield", "float"], "shell.sides.mode")}
        </SettingRow>
        <SettingRow label={t("side.pageBar")} hint={t("side.pageBarHint")}>
          {choice("sidePageBar", ["lane", "tabs"], "side.pageBar")}
        </SettingRow>
        <SettingRow label={t("shell.sides.pillAnchor")} hint={t("shell.sides.pillAnchorHint")}>
          {choice("sidePillAnchor", ["top", "center", "bottom"], "shell.sides.pillAnchor")}
        </SettingRow>
        <SettingRow label={t("shell.sides.laneWhenHidden")} hint={t("shell.sides.laneWhenHiddenHint")}>
          {choice("sideLaneWhenHidden", ["keep", "hide"], "shell.sides.laneWhenHidden")}
        </SettingRow>
        <SettingRow label={t("shell.sides.currentPageClick")} hint={t("shell.sides.currentPageClickHint")}>
          {choice("sideCurrentPageClick", ["stay", "collapse"], "shell.sides.currentPageClick")}
        </SettingRow>
        <SettingRow label={t("shell.sides.narrow")} hint={t("shell.sides.narrowHint")}>
          {choice("sideNarrow", ["overlay", "auto-collapse"], "shell.sides.narrow")}
        </SettingRow>
        <SettingRow label={t("shell.sides.restore")} hint={t("shell.sides.restoreHint")}>
          <Toggle checked={ui.sideRestore} onChange={(v) => setUiPref("sideRestore", v)} />
        </SettingRow>
        <SettingRow label={t("shell.sides.keepHidden")} hint={t("shell.sides.keepHiddenHint")} reset={<ResetButton disabled={keepHidden === KEEP_HIDDEN_DEFAULT} onClick={() => setUiPref("sideKeepHidden", KEEP_HIDDEN_DEFAULT)} />}>
          <NumberField slider value={keepHidden} range={KEEP_HIDDEN_RANGE} unit={t("shell.sides.tabs")} onCommit={(v) => v !== null && setUiPref("sideKeepHidden", v)} />
        </SettingRow>
        <SettingRow label={t("shell.sides.keepMounted")} hint={t("shell.sides.keepMountedHint")} reset={<ResetButton disabled={keepMounted === KEEP_MOUNTED_DEFAULT} onClick={() => setUiPref("sideKeepMounted", KEEP_MOUNTED_DEFAULT)} />}>
          <NumberField slider value={keepMounted} range={KEEP_MOUNTED_RANGE} unit={t("shell.sides.tabs")} onCommit={(v) => v !== null && setUiPref("sideKeepMounted", v)} />
        </SettingRow>
        <SettingRow label={t("shell.sides.reset")} hint={t("shell.sides.resetHint")}>
          <Button onClick={resetSideLayout}>{t("shell.sides.resetButton")}</Button>
        </SettingRow>
      </Section>

      <Section id={settingsAnchorId("open")} title={t("shell.sides.openSection")}>
        <SettingRow label={t("shell.sides.preview")} hint={t("shell.sides.previewHint")}>
          {/* Long option labels: a select (a segmented control here squeezed the label column). */}
          <Select
            width={FIELD_W.model}
            value={ui.sidePreview}
            options={(["replace", "links-new-tab", "new-tab"] as const).map((v) => ({ value: v, label: t(`shell.sides.preview.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("sidePreview", v)}
          />
        </SettingRow>
        <SettingRow label={t("shell.sides.peekTarget")} hint={t("shell.sides.peekTargetHint")}>
          {choice("peekTarget", ["auto", "right", "left"], "shell.sides.peekTarget")}
        </SettingRow>
        <div className="pt-3">
          <div className="text-[13px] font-medium">{t("shell.sides.defaults")}</div>
          <div className="mb-1 text-xs text-subtle">{t("shell.sides.defaultsHint")}</div>
          <DefaultsTable />
        </div>
      </Section>
      {/* 智能体发布成果时 (module artifacts; from 对话, owner 2026-10-18): it opens on the right side. */}
      <SettingsSections page="sides" only={["artifacts.settings"]} />

      <Section id={settingsAnchorId("gutter")} title={t("shell.sides.gutter")} hint={t("shell.sides.gutterHint")}>
        <div>
          <div className="text-[13px] font-medium">{t("shell.sides.gutterDocked")}</div>
          <div className="mb-1 text-xs text-subtle">{t("shell.sides.gutterDockedHint")}</div>
          <DockRows />
        </div>
        <SettingRow label={t("shell.sides.gutterDockWidth")} hint={t("shell.sides.gutterDockWidthHint")} reset={<ResetButton disabled={clampDockPref(ui.gutterDockWidth) === DOCK_WIDTH_DEFAULT} onClick={() => setUiPref("gutterDockWidth", DOCK_WIDTH_DEFAULT)} />}>
          <NumberField slider value={clampDockPref(ui.gutterDockWidth)} range={DOCK_WIDTH_RANGE} step={4} unit="px" onCommit={(v) => v !== null && setUiPref("gutterDockWidth", clampDockPref(v))} />
        </SettingRow>
      </Section>
      {/* 书签条 (module bookmarks; from 对话): the little bookmarks sit in the gutter. */}
      <SettingsSections page="sides" only={["bookmarks.settings"]} />
    </>
  );
}
