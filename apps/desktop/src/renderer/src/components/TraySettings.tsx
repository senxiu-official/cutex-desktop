// Settings → 外观 → 窗口与卡片: the tray's rows (owner 2026-10-21; lib/trayPrefs, components/ChipTray): 托盘常驻
// (default on), 托盘位置 (bottom / top / left / right; also by dragging its grip or 停靠在… in its menu) and
// 允许 3 列 (design 039: three conversation columns side by side; default two) and 托盘两排 (owner 2026-10-24, default
// off: the card at the bottom lays out in two rows when one does not hold its items; display only).
// Per machine. WorkSurfaceSection places them. With no pin list (the desktop layer's module off) the 托盘常驻
// row says the tray then only holds collapsed tool panes.
import { useI18n, type MessageKey } from "../i18n";
import { useDesktopLayer } from "../lib/paneDesk";
import { TRAY_EDGES, type TrayEdge } from "../lib/trayModel";
import { DEFAULT_TRAY_PREFS, setTrayPrefs, useTrayPrefs } from "../lib/trayPrefs";
import { ResetButton, Segmented, SettingRow, Toggle } from "./settings/Form";
import { keyVar } from "../lib/keybindings";

export function TraySettingRows() {
  const { t } = useI18n();
  const p = useTrayPrefs();
  // The tray's shortcuts come from the desktop layer's pin list (`pane.desktop` Dock); with no such item
  // (its module off) there is nothing to pin: the tray only holds collapsed tool panes — the row says so.
  const keeper = !!useDesktopLayer()?.item.Dock;
  const hint = keeper ? (
    t("pane.tray.persistentHint", keyVar("tray"))
  ) : (
    <>
      {t("pane.tray.persistentHint", keyVar("tray"))}
      <span data-tray-no-pins="" className="mt-1 block">
        {t("pane.tray.noPinList")}
      </span>
    </>
  );
  return (
    <>
      <SettingRow agents="none" source="local" label={t("pane.tray.persistent")} hint={hint} reset={<ResetButton disabled={p.persistent === DEFAULT_TRAY_PREFS.persistent} onClick={() => setTrayPrefs({ persistent: DEFAULT_TRAY_PREFS.persistent })} />}>
        <Toggle label={t("pane.tray.persistent")} checked={p.persistent} onChange={(v) => setTrayPrefs({ persistent: v })} />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("pane.tray.edge")} hint={t("pane.tray.edgeHint")} reset={<ResetButton disabled={p.edge === DEFAULT_TRAY_PREFS.edge} onClick={() => setTrayPrefs({ edge: DEFAULT_TRAY_PREFS.edge })} />}>
        <Segmented<TrayEdge> label={t("pane.tray.edge")} value={p.edge} options={TRAY_EDGES.map((e) => ({ value: e, label: t(`pane.tray.edge.${e}` as MessageKey) }))} onChange={(v) => setTrayPrefs({ edge: v })} />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("workspace.threeColumns")} hint={t("workspace.threeColumnsHint")} reset={<ResetButton disabled={p.allowThreeColumns === DEFAULT_TRAY_PREFS.allowThreeColumns} onClick={() => setTrayPrefs({ allowThreeColumns: DEFAULT_TRAY_PREFS.allowThreeColumns })} />}>
        <Toggle label={t("workspace.threeColumns")} checked={p.allowThreeColumns} onChange={(v) => setTrayPrefs({ allowThreeColumns: v })} />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("tray.twoRows")} hint={t("tray.twoRowsHint")} reset={<ResetButton disabled={p.twoRows === DEFAULT_TRAY_PREFS.twoRows} onClick={() => setTrayPrefs({ twoRows: DEFAULT_TRAY_PREFS.twoRows })} />}>
        <Toggle label={t("tray.twoRows")} checked={p.twoRows} onChange={(v) => setTrayPrefs({ twoRows: v })} />
      </SettingRow>
    </>
  );
}
