// Settings → 外观 (owner 2026-10-18: 颜色 / 字体 / 布局 / 启动页立绘; 图标与头像 moved to 左侧栏): theme and contrast, window zoom, fonts and text sizes, conversation width and
// list density, the default agent avatar. Everything is per machine (different screens need different values) and applies
// live; see lib/appearance.ts. Sidebar / capsule / conversation display live on their own pages.
import { useState, type ReactNode } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { DEFAULT_APPEARANCE, RANGES, setAppearance, useAppearance, useFontStatus, type Appearance, type Density } from "../../lib/appearance";
import { setUiPref, useUiPrefs } from "../../lib/prefs";
import { settingsAnchorId } from "../../lib/settingsNav";
import { applyContrast, applyDarkPalette, applyLightPalette, applyTheme, DARK_PALETTES, LIGHT_PALETTES, PALETTE_SWATCH, loadContrast, loadDarkPalette, loadLightPalette, loadTheme, type ContrastPref, type DarkPalette, type LightPalette, type ThemePref } from "../../lib/theme";
import { ScriptText } from "../ScriptText";
import { AppearanceNumberRow, FontRow } from "./AppearanceRows";
import { NumberField, ResetButton, Section, Segmented, Select, SettingRow, SwatchPicker, Toggle } from "./Form";
import { PreviewBand } from "./PreviewBand";
import { FIELD_W } from "../../lib/fieldWidths";
import { LaunchArtSection } from "./LaunchArtSettings";

const LATIN = ["Inter", "IBM Plex Sans", "Segoe UI", "Source Sans 3", "Noto Sans", "Source Serif 4", "Lora", "Georgia"];
const CJK = ["Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "LXGW WenKai", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "KingHwa_OldSong"];
const MONO = ["JetBrains Mono", "Cascadia Code", "Cascadia Mono", "IBM Plex Mono", "Fira Code", "Consolas", "Maple Mono", "Sarasa Mono SC"];
// The shared font preview (not translated: it shows glyphs, not words). Mixed Latin / CJK with
// curly quotes in both contexts, since U+2018/2019/201C/201D pick their font by context
// (lib/fontRuns.ts); the code line shows the glyphs people check a coding font for (0O 1lI).
// The owner's sample (2026-10-15): twelve greetings for the interface line (Korean added 2026-10-18,
// with a break after 欢迎：); the dialogue — curly quotes in Latin and CJK context, nested ‘…’, and a
// last quotation left open — for the conversation. Each preview also starts with a line in the UI
// language saying where these fonts are used (appearance.fontPreview.*Line), shown in the same font.
const SAMPLE_UI = "Le Café de Cutex 的留言板上，写着各种欢迎：\n欢迎 · 歡迎 · Hello · G’day · Привет · Bonjour · Hola · Olá · Ciao · Hallo · こんにちは · 안녕하세요。";
const SAMPLE_CHAT = [
  "“To be, or not to be: that is the question.” Someone had scribbled it in a corner.",
  "“仰观宇宙之大，俯察品类之盛。” 有人用另一种笔迹在下面答道。",
  "“Is ‘仰观宇宙之大’ your answer to Shakespeare?” the first writer asked.",
  "“只是觉得，回答 ‘To be, or not to be’ 之前，不妨先看看这个世界。",
].join("\n");
const SAMPLE_CODE = "const xs = arr.map((v) => v * 2); // 0O 1lI {} [] != ===";


export function AppearancePage() {
  const { t } = useI18n();
  const a = useAppearance();
  const fonts = useFontStatus();
  const ui = useUiPrefs();
  const [theme, setTheme] = useState<ThemePref>(loadTheme);
  const [contrast, setContrast] = useState<ContrastPref>(loadContrast);
  const [lightPalette, setLightPalette] = useState<LightPalette>(loadLightPalette);
  const [darkPalette, setDarkPalette] = useState<DarkPalette>(loadDarkPalette);
  const fullWidth = a.readingWidth === 0;
  return (
    <>
      <Section id={settingsAnchorId("colors")} title={t("appearance.colors")}>
        <SettingRow label={t("shell.theme")}>
          <Segmented
            value={theme}
            options={(["system", "light", "dark"] as ThemePref[]).map((v) => ({ value: v, label: t(`shell.theme.${v}` as MessageKey) }))}
            onChange={(v) => {
              setTheme(v);
              applyTheme(v);
            }}
          />
        </SettingRow>
        {/* Both palettes always (owner 2026-10-18): the theme switches quickly from the identity menu. */}
        <SettingRow label={t("appearance.lightPalette")}>
          <SwatchPicker
            label={t("appearance.lightPalette")}
            value={lightPalette}
            options={LIGHT_PALETTES.map((v) => ({ value: v, label: t(`appearance.palette.${v}` as MessageKey), colors: PALETTE_SWATCH[v] }))}
            onChange={(v) => {
              setLightPalette(v);
              applyLightPalette(v);
            }}
          />
        </SettingRow>
        <SettingRow label={t("appearance.darkPalette")}>
          <SwatchPicker
            label={t("appearance.darkPalette")}
            value={darkPalette}
            options={DARK_PALETTES.map((v) => ({ value: v, label: t(`appearance.palette.${v}` as MessageKey), colors: PALETTE_SWATCH[v] }))}
            onChange={(v) => {
              setDarkPalette(v);
              applyDarkPalette(v);
            }}
          />
        </SettingRow>
        <SettingRow label={t("shell.contrast")} hint={t("shell.contrastHint")}>
          <Segmented
            value={contrast}
            options={(["standard", "high", "max"] as ContrastPref[]).map((v) => ({ value: v, label: t(`shell.contrast.${v}` as MessageKey) }))}
            onChange={(v) => {
              setContrast(v);
              applyContrast(v);
            }}
          />
        </SettingRow>
      </Section>

      <Section id={settingsAnchorId("fonts")} title={t("appearance.fonts")} hint={t("appearance.fontsHint")}>
        {fonts.phase === "loading" && <p role="status" className="text-xs text-subtle">{t("appearance.fontsLoading")}</p>}
        {fonts.phase === "unsupported" && <p role="status" className="text-xs text-warn">{t("appearance.fontsUnsupported")}</p>}
        {fonts.phase === "ready" && fonts.failedFamilies.length > 0 && <p role="status" className="text-xs text-warn">{t("appearance.fontsFallback", { fonts: fonts.failedFamilies.join(", ") })}</p>}
        {/* 界面 / 对话 / 代码, each CJK first, each followed by its own live preview (owner 2026-10-18, F6). */}
        <FontRow label={t("appearance.cjkFont")} hint={t("appearance.cjkFontHint")} value={a.cjkFont} fonts={CJK} onChange={(v) => setAppearance({ cjkFont: v })} />
        <FontRow label={t("appearance.uiFont")} hint={t("appearance.uiFontHint")} value={a.uiFont} fonts={[...LATIN, ...CJK]} onChange={(v) => setAppearance({ uiFont: v })} />
        <PreviewBand inline label={t("appearance.fontPreview.ui")}>
          <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ fontFamily: "var(--font-sans)" }}><ScriptText text={`${t("appearance.fontPreview.uiLine")}\n${SAMPLE_UI}`} /></p>
        </PreviewBand>
        <FontRow label={t("appearance.chatCjkFont")} value={a.chatCjkFont} fonts={CJK} defaultLabel={t("appearance.followUi")} onChange={(v) => setAppearance({ chatCjkFont: v })} />
        <FontRow label={t("appearance.chatFont")} value={a.chatFont} fonts={[...LATIN, ...CJK]} defaultLabel={t("appearance.followUi")} onChange={(v) => setAppearance({ chatFont: v })} />
        <AppearanceNumberRow field="chatFontSize" label="appearance.chatFontSize" unit="px" />
        <PreviewBand inline label={t("appearance.fontPreview.chat")}>
          <p className="font-chat-context whitespace-pre-line leading-relaxed" style={{ fontSize: "var(--chat-font-size)" }}><ScriptText text={`${t("appearance.fontPreview.chatLine")}\n${SAMPLE_CHAT}`} /></p>
        </PreviewBand>
        <CodeCjkFontRow />
        <FontRow label={t("appearance.monoFont")} value={a.monoFont} fonts={MONO} onChange={(v) => setAppearance({ monoFont: v })} />
        <AppearanceNumberRow field="monoFontSize" label="appearance.monoFontSize" unit="px" />
        <PreviewBand label={t("appearance.fontPreview.code")}>
          <p className="break-all whitespace-pre-line font-mono" style={{ fontSize: "var(--mono-font-size, 13px)" }}>{`// ${t("appearance.fontPreview.codeLine")}\n${SAMPLE_CODE}`}</p>
        </PreviewBand>
      </Section>

      <Section id={settingsAnchorId("layout")} title={t("appearance.layout")}>
        <AppearanceNumberRow field="zoom" label="appearance.zoom" hint="appearance.zoomHint" unit="%" step={5} commitOnRelease />
        {/* One setting (readingWidth 0 = full width), one row: 固定宽度 shows its px field (owner 2026-10-18). */}
        <SettingRow
          label={t("appearance.readingWidth")}
          hint={t("appearance.readingWidthHint")}
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
        <SettingRow label={t("appearance.density")} hint={t("appearance.densityHint")}>
          <Segmented<Density>
            value={a.density}
            options={(["compact", "standard", "comfortable"] as const).map((v) => ({ value: v, label: t(`appearance.density.${v}` as MessageKey) }))}
            onChange={(v) => setAppearance({ density: v })}
          />
        </SettingRow>
      </Section>

      <LaunchArtSection />
    </>
  );
}

/**
 * 代码 · 中文字体: code has its own CJK slot (owner 2026-10-18); until it is wired, the only choice is
 * 「跟随界面」 (code text already uses the interface CJK font).
 */
function CodeCjkFontRow() {
  const { t } = useI18n();
  return (
    <SettingRow label={t("appearance.monoCjkFont")} hint={t("appearance.monoCjkFontHint")}>
      <Select width={FIELD_W.generic} label={t("appearance.monoCjkFont")} value="" options={[{ value: "", label: t("appearance.followUi") }]} onChange={() => {}} />
    </SettingRow>
  );
}
