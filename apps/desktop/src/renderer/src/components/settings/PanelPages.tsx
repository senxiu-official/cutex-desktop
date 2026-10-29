// The 面板 group's pages and cards the shell adds (design 006 v1, owner 2026-10-22: 「合面板」): 托盘 and 桌面 (their
// rows were in 外观 → 窗口与卡片), and on 会话 the 宽度 card and the one line on 只看 {{shelf}}. The other panel pages
// (侧栏, 会话, 状态显示, {{shelf}}) are the pages that were there, regrouped and renamed (lib/settingsNav PANEL_PAGES).
import { useI18n } from "../../i18n";
import { SettingsSections } from "../../modules/Outlet";
import { settingsAnchorId } from "../../lib/settingsNav";
import { DeskBrightnessSection, TraySection } from "../WorkSurfaceSettings";
import { Section } from "./Form";

export function TrayPage() {
  return (
    <>
      <TraySection />
      <SettingsSections page="tray" />
    </>
  );
}

export function DesktopPage() {
  return (
    <>
      <DeskBrightnessSection />
      {/* The desktop module's part (编辑主页: cover, bio, blocks, entries — kept on its home host). */}
      <SettingsSections page="desktop" />
    </>
  );
}

/** 会话 → 只看 {{shelf}} (Q4: the owner asked what it is): one line, no switch. */
export function ShelfOnlySection() {
  const { t } = useI18n();
  return (
    <Section id={settingsAnchorId("shelf-only")} title={t("settings.panel.shelfOnly")}>
      <p data-shelf-only-note="" className="px-1 py-1 text-xs leading-relaxed text-muted">
        {t("settings.panel.shelfOnlyHint")}
      </p>
    </Section>
  );
}
