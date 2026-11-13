// Settings → 外观 → 窗口与卡片 and the 面板 pages' parts of it (design 006 v1, owner 2026-10-22: 「合面板」 — 卡片材质,
// 工作区宽度, 贴边显示 and 动作预告 stay on 外观; Shelf → Rail 与页面, 会话 → 宽度, 桌面 → 背景, 托盘 → 托盘 take the rest).
// Was (owner 2026-10-21; lib/workSurface): 页面打开位置 (Shelf / 占用会话), 卡片材质 (不透明 / 亚克力 + opacity), 工作区宽度
// (智能 / 按内容 / 铺满窗口 — widths only, lib/workspaceRow), 贴边显示 (its own switch, owner 2026-10-21), 工作区的 Shelf Rail (外侧 / 永远偏右), Shelf Rail 在 Shelf 的 (外侧 / 内侧), Shelf Rail 常驻 (default on), 单个对话的默认宽度 (阅读宽度 / 全宽 / 自定义百分比), 桌面亮度 (three states, lib/deskBrightness), the tray (托盘常驻, 托盘位置: components/TraySettings). Per machine (lib/appearance). Lives outside
// components/settings so the settings shell can move without it; AppearanceSettings places it.
import { useI18n } from "../i18n";
import { DEFAULT_APPEARANCE, RANGES, setAppearance, useAppearance } from "../lib/appearance";
import type { DropPreviewStyle, PageOpenPlace } from "../lib/appearanceModel";
import { settingsAnchorId } from "../lib/settingsNav";
import type { CardMaterial, SingleWidthMode } from "../lib/workSurface";
import type { WorkspaceRailPlacement, WorkspaceWidthMode } from "../lib/workspaceRow";
import { setEveryShelfRail } from "../lib/sideLayoutStore";
import { NumberField, ResetButton, Section, Segmented, SettingRow, Toggle } from "./settings/Form";
import { TraySettingRows } from "./TraySettings";
import { setForetellOn, useForetellOn } from "../lib/foretellPref";
import { PAGE_SHELF_WIDTH } from "../lib/pageShelfWidth";
import { DEFAULT_PORTRAIT, setOrientationSetting, setPortraitPrefs, useOrientationSetting, usePortrait, type OrientationSetting } from "../lib/portrait";
import { useWindowKey } from "../lib/windowScope";
import { keyVar } from "../lib/keybindings";

/** 桌面亮度: 没有窗格时 / 有对话或页面打开时 / 窗格占满屏幕时. */
const DESK_KEYS = ["deskEmpty", "deskOpen", "deskFull"] as const;

/** Shelf Rail 在 Shelf 的 外侧 / 内侧: stored here (new Shelves), applied to every Shelf there is. */
function setShelfRail(placement: "outer" | "inner"): void {
  setAppearance({ shelfRailPlacement: placement });
  setEveryShelfRail(placement);
}

/**
 * 竖屏布局 (owner 2026-10-30, lib/portrait): auto / always landscape / always portrait for every window of this device,
 * and — this window's own, like the divider's ⇅ and the Shelf's ⋯ — whether the conversation sits above its Shelf.
 */
function OrientationRows() {
  const { t } = useI18n();
  const key = useWindowKey();
  const setting = useOrientationSetting((s) => s.setting);
  const portrait = usePortrait((s) => s.orientation === "portrait");
  const swapped = usePortrait((s) => s.prefs.swapped);
  const split = usePortrait((s) => s.prefs.split);
  const band = usePortrait((s) => s.prefs.band);
  return (
    <>
      <SettingRow agents="none" source="local" label={t("orientation.setting")} hint={`${t("orientation.settingHint")} · ${t("orientation.sidebarNote", keyVar("sidebar"))} · ${t(portrait ? "orientation.nowPortrait" : "orientation.nowLandscape")}`} reset={<ResetButton disabled={setting === "auto"} onClick={() => setOrientationSetting("auto")} />}>
        <span data-orientation-setting="" className="contents">
          <Segmented<OrientationSetting>
            label={t("orientation.setting")}
            value={setting}
            options={[
              { value: "auto", label: t("orientation.auto") },
              { value: "landscape", label: t("orientation.landscape") },
              { value: "portrait", label: t("orientation.portrait") },
            ]}
            onChange={setOrientationSetting}
          />
        </span>
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("orientation.position")} hint={t("orientation.positionHint")} reset={<ResetButton disabled={swapped === DEFAULT_PORTRAIT.swapped} onClick={() => setPortraitPrefs(key, { swapped: DEFAULT_PORTRAIT.swapped })} />}>
        <span data-orientation-position="" className="contents">
          <Segmented<"top" | "bottom">
            label={t("orientation.position")}
            value={swapped ? "bottom" : "top"}
            options={[
              { value: "top", label: t("orientation.top") },
              { value: "bottom", label: t("orientation.bottom") },
            ]}
            onChange={(v) => setPortraitPrefs(key, { swapped: v === "bottom" })}
          />
        </span>
      </SettingRow>
      {/* P4: the dividers' heights / widths (this window, portrait only) — set by dragging them; reset here. */}
      <SettingRow agents="none" source="local" label={t("orientation.split")} hint={t("orientation.splitHint")} reset={<ResetButton disabled={split === DEFAULT_PORTRAIT.split && band === undefined} onClick={() => setPortraitPrefs(key, { split: DEFAULT_PORTRAIT.split, band: undefined })} />}>
        <span data-orientation-split="" className="text-ui text-muted tabular-nums">
          {t("orientation.splitValue", { pct: Math.round(split * 100) })}
        </span>
      </SettingRow>
    </>
  );
}

export function WorkSurfaceSection() {
  const { t } = useI18n();
  const a = useAppearance();
  const foretell = useForetellOn();
  return (
    <Section  id={settingsAnchorId("work-surface")} title={t("workSurface.title")} hint={t("workSurface.hint")} >
      <SettingRow agents="none" source="local"
        label={t("workSurface.material")}
        hint={t("workSurface.materialHint")}
        reset={<ResetButton disabled={a.cardMaterial === DEFAULT_APPEARANCE.cardMaterial && a.cardOpacity === DEFAULT_APPEARANCE.cardOpacity} onClick={() => setAppearance({ cardMaterial: DEFAULT_APPEARANCE.cardMaterial, cardOpacity: DEFAULT_APPEARANCE.cardOpacity })} />}
      >
        {a.cardMaterial === "acrylic" && <NumberField slider label={t("workSurface.opacity")} value={a.cardOpacity} range={RANGES.cardOpacity} unit="%" onCommit={(v) => v !== null && setAppearance({ cardOpacity: v })} />}
        <Segmented<CardMaterial>
          label={t("workSurface.material")}
          value={a.cardMaterial}
          options={[
            { value: "opaque", label: t("workSurface.material.opaque") },
            { value: "acrylic", label: t("workSurface.material.acrylic") },
          ]}
          onChange={(v) => setAppearance({ cardMaterial: v })}
        />
      </SettingRow>
      {/* 工作区宽度 (owner 2026-10-21, lib/workspaceRow): 智能 (default) / 按内容 / 铺满窗口 — widths only; 贴边显示 below. */}
      <SettingRow agents="none" source="local" label={t("fillMode.title")} hint={t("fillMode.hint")}>
        <Toggle label={t("fillMode.title")} checked={a.fillMode} onChange={v => setAppearance({ fillMode: v })} />
      </SettingRow>
      <OrientationRows />

      <SettingRow agents="none" source="local" label={t("workSurface.width")} hint={t("workSurface.widthRules")} reset={<ResetButton disabled={a.workspaceWidth === DEFAULT_APPEARANCE.workspaceWidth} onClick={() => setAppearance({ workspaceWidth: DEFAULT_APPEARANCE.workspaceWidth })} />}>
        <Segmented<WorkspaceWidthMode>
          label={t("workSurface.width")}
          value={a.workspaceWidth}
          options={[
            { value: "smart", label: t("workSurface.width.smart") },
            { value: "content", label: t("workSurface.width.content") },
            { value: "fill", label: t("workSurface.width.fill") },
          ]}
          onChange={(v) => setAppearance({ workspaceWidth: v })}
        />
      </SettingRow>
      {/* 贴边显示 (owner 2026-10-21, default off): no gaps / margins / outer radii while the panes fill the work area. */}
      <SettingRow agents="none" source="local" label={t("workSurface.edge")} hint={t("workSurface.edgeHint")} reset={<ResetButton disabled={a.edgeToEdge === DEFAULT_APPEARANCE.edgeToEdge} onClick={() => setAppearance({ edgeToEdge: DEFAULT_APPEARANCE.edgeToEdge })} />}>
        <span data-edge-switch="" className="contents">
          <Toggle label={t("workSurface.edge")} checked={a.edgeToEdge} onChange={(v) => setAppearance({ edgeToEdge: v })} />
        </span>
      </SettingRow>
      {/* 动作预告 (design 006 v1 Q3, owner 2026-10-22: a switch, default on; lib/foretellPref gates lib/foretell). */}
      <SettingRow agents="none" source="local" label={t("foretell.setting")} hint={t("foretell.settingHint")}>
        <span data-foretell-switch="" className="contents">
          <Toggle label={t("foretell.setting")} checked={foretell} onChange={setForetellOn} />
        </span>
      </SettingRow>
      {/* 拖放落点预览 (owner 2026-10-23): how a drag's drop zone is drawn (components/side/SideDndLayer). */}
      <SettingRow agents="none" source="local" label={t("workSurface.dropPreview")} hint={t("workSurface.dropPreviewHint")} reset={<ResetButton disabled={a.dropPreview === DEFAULT_APPEARANCE.dropPreview} onClick={() => setAppearance({ dropPreview: DEFAULT_APPEARANCE.dropPreview })} />}>
        <span data-drop-preview-setting="" className="contents">
          <Segmented<DropPreviewStyle>
            label={t("workSurface.dropPreview")}
            value={a.dropPreview}
            options={[
              { value: "outline", label: t("workSurface.dropPreview.outline") },
              { value: "fill", label: t("workSurface.dropPreview.fill") },
            ]}
            onChange={(v) => setAppearance({ dropPreview: v })}
          />
        </span>
      </SettingRow>
    </Section>
  );
}

/** Settings → {{shelf}} → Rail 与页面 (design 006 v1): 页面打开位置, the Rails' places, Rail 常驻, the page width (fixed, said only). */
export function ShelfPlacementSection() {
  const { t } = useI18n();
  const a = useAppearance();
  return (
    <Section  id={settingsAnchorId("shelf-place")} title={t("settings.panel.shelfPlace")}>
      {/* 页面打开位置 (owner 2026-10-21, lib/paneServices): 项目 / 委托 / 服务… as their own Shelf pane (default) or over the column. */}
      <SettingRow agents="none" source="local" label={t("workSurface.pageOpen")} hint={t("workSurface.pageOpenHint")} reset={<ResetButton disabled={a.pageOpen === DEFAULT_APPEARANCE.pageOpen} onClick={() => setAppearance({ pageOpen: DEFAULT_APPEARANCE.pageOpen })} />}>
        <span data-page-open-setting="" className="contents">
          <Segmented<PageOpenPlace>
            label={t("workSurface.pageOpen")}
            value={a.pageOpen}
            options={[
              { value: "shelf", label: t("workSurface.pageOpen.shelf") },
              { value: "column", label: t("workSurface.pageOpen.column") },
            ]}
            onChange={(v) => setAppearance({ pageOpen: v })}
          />
        </span>
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("workSurface.wsRails")} hint={t("workSurface.wsRailsHint")} reset={<ResetButton disabled={a.wsRailPlacement === DEFAULT_APPEARANCE.wsRailPlacement} onClick={() => setAppearance({ wsRailPlacement: DEFAULT_APPEARANCE.wsRailPlacement })} />}>
        <Segmented<WorkspaceRailPlacement>
          label={t("workSurface.wsRails")}
          value={a.wsRailPlacement}
          options={[
            { value: "outer", label: t("workSurface.wsRails.outer") },
            { value: "right", label: t("workSurface.wsRails.right") },
          ]}
          onChange={(v) => setAppearance({ wsRailPlacement: v })}
        />
      </SettingRow>
      {/* Also in each Shelf's ⋯; here it sets every Shelf (and new ones). */}
      <SettingRow agents="none" source="local" label={t("workSurface.shelfRail")} hint={t("workSurface.shelfRailHint")} reset={<ResetButton disabled={a.shelfRailPlacement === DEFAULT_APPEARANCE.shelfRailPlacement} onClick={() => setShelfRail(DEFAULT_APPEARANCE.shelfRailPlacement)} />}>
        <Segmented<"outer" | "inner">
          label={t("workSurface.shelfRail")}
          value={a.shelfRailPlacement}
          options={[
            { value: "outer", label: t("workSurface.shelfRail.outer") },
            { value: "inner", label: t("workSurface.shelfRail.inner") },
          ]}
          onChange={setShelfRail}
        />
      </SettingRow>
      {/* {{shelf}} Rail 常驻 (owner 2026-10-21, default on): rails stay when a Shelf is closed or empty (components/side/SideArea). */}
      <SettingRow agents="none" source="local" label={t("workSurface.shelfRailAlways")} hint={t("workSurface.shelfRailAlwaysHint")} reset={<ResetButton disabled={a.shelfRailAlways === DEFAULT_APPEARANCE.shelfRailAlways} onClick={() => setAppearance({ shelfRailAlways: DEFAULT_APPEARANCE.shelfRailAlways })} />}>
        <span data-shelf-rail-always="" className="contents">
          <Toggle label={t("workSurface.shelfRailAlways")} checked={a.shelfRailAlways} onChange={(v) => setAppearance({ shelfRailAlways: v })} />
        </span>
      </SettingRow>
      {/* Design 011 (Q6: not adjustable): said here so the owner knows why a page widens its Shelf. */}
      <p className="py-2 text-xs text-subtle">
        {t("settings.ia.pageWidthNote", { width: PAGE_SHELF_WIDTH })} <span data-page-width-note="" className="font-mono tabular-nums">{PAGE_SHELF_WIDTH} px</span>
      </p>
    </Section>
  );
}

/** Settings → 会话 → 宽度 (design 006 v1): 单个对话的默认宽度 and 对话区宽度 (was 外观 → 布局). */
export function ConversationWidthSection() {
  const { t } = useI18n();
  const a = useAppearance();
  const fullWidth = a.readingWidth === 0;
  return (
    <Section  id={settingsAnchorId("conv-width")} title={t("settings.panel.convWidth")}>
      <SettingRow agents="none" source="local"
        label={t("workSurface.single")}
        hint={t("workSurface.singleHint")}
        reset={<ResetButton disabled={a.singleWidth === DEFAULT_APPEARANCE.singleWidth && a.singleColumnW === 0} onClick={() => setAppearance({ singleWidth: DEFAULT_APPEARANCE.singleWidth, singleWidthPct: DEFAULT_APPEARANCE.singleWidthPct, singleColumnW: 0 })} />}
      >
        {a.singleWidth === "custom" && <NumberField slider label={t("workSurface.single.custom")} value={a.singleWidthPct} range={RANGES.singleWidthPct} unit="%" step={5} onCommit={(v) => v !== null && setAppearance({ singleWidthPct: v, singleColumnW: 0 })} />}
        <Segmented<SingleWidthMode>
          label={t("workSurface.single")}
          value={a.singleWidth}
          options={(["reading", "full", "custom"] as const).map((v) => ({ value: v, label: t(`workSurface.single.${v}`) }))}
          // A new default forgets the width dragged at the column's edges.
          onChange={(v) => setAppearance({ singleWidth: v, singleColumnW: 0 })}
        />
      </SettingRow>
      {a.singleColumnW > 0 && <p className="px-1 text-xs text-subtle" data-single-dragged="">{t("workSurface.dragged", { px: a.singleColumnW })}</p>}
      {/* One setting (readingWidth 0 = full width), one row: 固定宽度 shows its px field (owner 2026-10-18). */}
      <SettingRow agents="none" source="local"
        label={t("appearance.readingWidth")}
        info={t("appearance.readingWidthHint")}
        reset={<ResetButton disabled={a.readingWidth === DEFAULT_APPEARANCE.readingWidth} onClick={() => setAppearance({ readingWidth: DEFAULT_APPEARANCE.readingWidth })} />}
      >
        {!fullWidth && <NumberField slider value={a.readingWidth} range={RANGES.readingWidth} unit="px" step={20} onCommit={(v) => v !== null && setAppearance({ readingWidth: v })} />}
        <Segmented<"fixed" | "full">
          value={fullWidth ? "full" : "fixed"}
          options={[
            { value: "fixed", label: t("appearance.width.fixed") },
            { value: "full", label: t("appearance.width.full") },
          ]}
          onChange={(v) => setAppearance({ readingWidth: v === "full" ? 0 : DEFAULT_APPEARANCE.readingWidth })}
        />
      </SettingRow>
    </Section>
  );
}

/** Settings → 桌面 → 背景 (design 006 v1): 桌面亮度 (was 外观 → 窗口与卡片). */
export function DeskBrightnessSection() {
  const { t } = useI18n();
  const a = useAppearance();
  return (
    // 桌面亮度 (owner 2026-10-21): the desktop background (and its content when on screen) per state; one row per state.
    <Section  id={settingsAnchorId("desk")} title={t("workSurface.desk")} hint={t("workSurface.deskHint")}>
      {DESK_KEYS.map((k) => (
        <SettingRow key={k} agents="none" source="local" label={t(`workSurface.desk.${k}`)} reset={<ResetButton disabled={a[k] === DEFAULT_APPEARANCE[k]} onClick={() => setAppearance({ [k]: DEFAULT_APPEARANCE[k] })} />}>
          <span data-desk-brightness={k} className="contents">
            <NumberField slider label={t(`workSurface.desk.${k}`)} value={a[k]} range={RANGES[k]} unit="%" step={5} onCommit={(v) => v !== null && setAppearance({ [k]: v })} />
          </span>
        </SettingRow>
      ))}
    </Section>
  );
}

/** Settings → 托盘 (design 006 v1): its rows (was 外观 → 窗口与卡片). */
export function TraySection() {
  const { t } = useI18n();
  return (
    <Section  id={settingsAnchorId("tray")} title={t("settings.panel.tray")}>
      <TraySettingRows />
    </Section>
  );
}
