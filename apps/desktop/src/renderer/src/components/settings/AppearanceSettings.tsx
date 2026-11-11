// Appearance: colors, fonts, layout and default avatar display live on this desktop.
// Portrait themes are local; the explicitly scoped bulk action writes avatars to their hosts.
import { setUiPref, useUiPrefs } from "../../lib/prefs";
import { useRef, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { setAppearance, useAppearance, useFontStatus, type Density } from "../../lib/appearance";
import { settingsAnchorId } from "../../lib/settingsNav";
import { applyContrast, applyDarkPalette, applyLightPalette, applyTheme, DARK_PALETTES, LIGHT_PALETTES, PALETTE_SWATCH, loadContrast, loadDarkPalette, loadLightPalette, loadTheme, type ContrastPref, type DarkPalette, type LightPalette, type ThemePref } from "../../lib/theme";
import { ScriptText } from "../ScriptText";
import { AppearanceNumberRow, FontRow } from "./AppearanceRows";
import { ResetButton, Section, Segmented, Select, SettingRow, SwatchPicker, Toggle } from "./Form";
import { PreviewBand } from "./PreviewBand";
import { LaunchArtSection } from "./LaunchArtSettings";
import { FontPackSection } from "./FontPackSettings";
import { BUNDLED_LATIN_FONTS, PACK_FONTS } from "../../../../shared/fontCatalog";
import { PortraitPackSection } from "./PortraitSettings";
import { WorkSurfaceSection } from "../WorkSurfaceSettings";
import { AvatarSettings } from "./AvatarSettings";
import { DIRECTOR_HEADWEARS, DEFAULT_DIRECTOR_HEADWEAR, headwearSources, type DirectorHeadwear } from "../../lib/directorHeadwear";
import { radioKeyTarget, useRowA11y } from "../../lib/formA11y";
import { NAME_GROUPINGS, NAME_READINGS, nameComparer } from "@cutex-desktop/cutex-client/nameOrder";
import { nameOrderOf } from "../../lib/rosterOrder";

// The fonts that come with the desktop (shared/fontCatalog.ts) first: they are always there.
const LATIN = [...BUNDLED_LATIN_FONTS, "Inter", "IBM Plex Sans", "Segoe UI", "Source Sans 3", "Noto Sans", "Source Serif 4", "Lora", "Georgia"];
const CJK = [...PACK_FONTS.map((e) => e.family), "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "LXGW WenKai", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "KingHwa_OldSong"];
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
  const ui = useUiPrefs();
  const fonts = useFontStatus();
  const [theme, setTheme] = useState<ThemePref>(loadTheme);
  const [contrast, setContrast] = useState<ContrastPref>(loadContrast);
  const [lightPalette, setLightPalette] = useState<LightPalette>(loadLightPalette);
  const [darkPalette, setDarkPalette] = useState<DarkPalette>(loadDarkPalette);
  return (
    <>
      <Section id={settingsAnchorId("colors")} title={t("appearance.colors")}  >
        <SettingRow agents="none" source="local" label={t("shell.theme")}>
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
        <SettingRow agents="none" source="local" label={t("appearance.lightPalette")}>
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
        <SettingRow agents="none" source="local" label={t("appearance.darkPalette")}>
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
        <SettingRow agents="none" source="local" label={t("shell.contrast")} info={t("shell.contrastHint")}>
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

      <Section id={settingsAnchorId("fonts")} title={t("appearance.fonts")} hint={t("appearance.fontsHint")}  >
        {fonts.phase === "loading" && <p role="status" className="text-xs text-subtle">{t("appearance.fontsLoading")}</p>}
        {fonts.phase === "unsupported" && <p role="status" className="text-xs text-warn">{t("appearance.fontsUnsupported")}</p>}
        {fonts.phase === "ready" && fonts.failedFamilies.length > 0 && <p role="status" className="text-xs text-warn">{t("appearance.fontsFallback", { fonts: fonts.failedFamilies.join(", ") })}</p>}
        {/* 界面 / 对话 / 代码, each CJK first, each followed by its own live preview (owner 2026-10-18, F6). */}
        <FontRow label={t("appearance.cjkFont")} hint={t("appearance.cjkFontHint")} value={a.cjkFont} fonts={CJK} cjkFonts={CJK} onChange={(v) => setAppearance({ cjkFont: v })} />
        <FontRow label={t("appearance.uiFont")} hint={t("appearance.uiFontHint")} value={a.uiFont} fonts={[...LATIN, ...CJK]} cjkFonts={CJK} onChange={(v) => setAppearance({ uiFont: v })} />
        <PreviewBand inline label={t("appearance.fontPreview.ui")}>
          <p className="text-ui/[inherit] leading-relaxed whitespace-pre-line" style={{ fontFamily: "var(--font-sans)" }}><ScriptText text={`${t("appearance.fontPreview.uiLine")}\n${SAMPLE_UI}`} /></p>
        </PreviewBand>
        <FontRow label={t("appearance.chatCjkFont")} value={a.chatCjkFont} fonts={CJK} cjkFonts={CJK} defaultLabel={t("appearance.followUi")} onChange={(v) => setAppearance({ chatCjkFont: v })} />
        <FontRow label={t("appearance.chatFont")} value={a.chatFont} fonts={[...LATIN, ...CJK]} cjkFonts={CJK} defaultLabel={t("appearance.followUi")} onChange={(v) => setAppearance({ chatFont: v })} />
        <AppearanceNumberRow field="chatFontSize" label="appearance.chatFontSize" unit="px" />
        <PreviewBand inline label={t("appearance.fontPreview.chat")}>
          <p className="font-chat-context whitespace-pre-line leading-relaxed" style={{ fontSize: "var(--chat-font-size)" }}><ScriptText text={`${t("appearance.fontPreview.chatLine")}\n${SAMPLE_CHAT}`} /></p>
        </PreviewBand>
        <FontRow label={t("appearance.monoCjkFont")} hint={t("appearance.monoCjkFontHint")} value={a.monoCjkFont} fonts={CJK} cjkFonts={CJK} defaultLabel={t("appearance.followUi")} onChange={(v) => setAppearance({ monoCjkFont: v })} />
        <FontRow label={t("appearance.monoFont")} value={a.monoFont} fonts={MONO} mono onChange={(v) => setAppearance({ monoFont: v })} />
        <AppearanceNumberRow field="monoFontSize" label="appearance.monoFontSize" unit="px" />
        <PreviewBand label={t("appearance.fontPreview.code")}>
          <p className="break-all whitespace-pre-line font-mono" style={{ fontSize: "var(--mono-font-size, 13px)" }}>{`// ${t("appearance.fontPreview.codeLine")}\n${SAMPLE_CODE}`}</p>
        </PreviewBand>
      </Section>

      <FontPackSection />

      <Section id={settingsAnchorId("layout")} title={t("appearance.layout")}  >
        <AppearanceNumberRow field="zoom" label="appearance.zoom" hint="appearance.zoomHint" unit="%" step={5} commitOnRelease />
        {/* 对话区宽度 moved to 会话 → 宽度 (design 006 v1). */}
        <SettingRow agents="none" source="local" label={t("appearance.density")} info={t("appearance.densityHint")}>
          <Segmented<Density>
            value={a.density}
            options={(["compact", "standard", "comfortable"] as const).map((v) => ({ value: v, label: t(`appearance.density.${v}` as MessageKey) }))}
            onChange={(v) => setAppearance({ density: v })}
          />
        </SettingRow>
        <NameOrderRows />
      </Section>

      <AvatarSettings />
      <PortraitPackSection />

      {/* 主管头饰 (lib/directorHeadwear, owner 2026-10-24): what a project Director wears on its avatar. */}
      <Section id={settingsAnchorId("headwear")} title={t("appearance.headwear")}  >
        {/* A picture picker wider than a segmented control sits under its label, the full width of the card. */}
        <SettingRow agents="none" source="local" label={t("appearance.headwear.style")} hint={t("appearance.headwearHint")} reset={<ResetButton disabled={ui.directorHeadwear === DEFAULT_DIRECTOR_HEADWEAR} onClick={() => setUiPref("directorHeadwear", DEFAULT_DIRECTOR_HEADWEAR)} />}
          sample={<HeadwearPicker label={t("appearance.headwear.style")} value={ui.directorHeadwear} onChange={(v) => setUiPref("directorHeadwear", v)} />} />
        <SettingRow agents="none" source="local" label={t("appearance.headwear.operators")} hint={t("appearance.headwear.operatorsHint")} reset={<ResetButton disabled={ui.operatorHeadwear} onClick={() => setUiPref("operatorHeadwear", true)} />}>
          <Toggle checked={ui.operatorHeadwear} onChange={(v) => setUiPref("operatorHeadwear", v)} disabled={ui.directorHeadwear === "none"} />
        </SettingRow>
        <SettingRow agents="none" source="local" label={t("appearance.headwear.seasonal")} hint={t("appearance.headwear.seasonalHint")} reset={<ResetButton disabled={ui.seasonalHeadwear} onClick={() => setUiPref("seasonalHeadwear", true)} />}>
          <Toggle checked={ui.seasonalHeadwear} onChange={(v) => setUiPref("seasonalHeadwear", v)} disabled={ui.directorHeadwear === "none"} />
        </SettingRow>
      </Section>

      <WorkSurfaceSection />

      <LaunchArtSection />
    </>
  );
}

/**
 * 主管头饰's styles as a grid of small pictures (eleven choices are too many for a segmented row): a radio group,
 * arrow keys move between choices like Segmented's.
 */
function HeadwearPicker({ value, onChange, label }: { value: DirectorHeadwear; onChange(v: DirectorHeadwear): void; label: string }) {
  const { t } = useI18n();
  const aria = useRowA11y(label);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, DIRECTOR_HEADWEARS.indexOf(value));
  return (
    <div role="radiogroup" {...aria} data-headwear-picker="" className="mt-2 flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
      {DIRECTOR_HEADWEARS.map((v, i) => {
        const on = v === value;
        const label = t(`appearance.headwear.${v}` as MessageKey);
        return (
          <button
            key={v}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            title={label}
            tabIndex={i === selected ? 0 : -1}
            data-headwear-choice={v}
            onClick={() => onChange(v)}
            onKeyDown={(e) => {
              const next = radioKeyTarget(e.key, i, DIRECTOR_HEADWEARS.length);
              if (next === null) return;
              e.preventDefault();
              refs.current[next]?.focus();
              onChange(DIRECTOR_HEADWEARS[next]!);
            }}
            className={`flex w-[84px] flex-col items-center gap-1 rounded-md px-1 pt-1.5 pb-1 text-xs focus-visible:outline-2 focus-visible:outline-accent ${on ? "bg-raised text-foreground shadow-sm ring-1 ring-border" : "text-muted hover:bg-hover hover:text-foreground"}`}
          >
            <span className="flex h-6 items-center justify-center">
              {v === "none" ? <span aria-hidden className="text-base text-subtle">∅</span> : <img src={headwearSources(v).src} alt="" aria-hidden draggable={false} data-headwear-option={v} className="max-h-6 w-auto max-w-[44px] object-contain" />}
            </span>
            <span className="w-full truncate text-center">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A fixed mixed list shown in the current name order under the two rows (design 060 §5.1). */
const NAME_SAMPLE = ["Zoe", "张三", "agent10", "Alice", "李四", "agent2", "김민수", "田中", "山田", "Bob", "1号"];

/**
 * 名字排序 / 汉字读法 (design 060 §5.1, lib/rosterOrder): how names are listed everywhere. Each follows the
 * UI language until picked; 恢复默认 goes back to following it.
 */
function NameOrderRows() {
  const { t, locale } = useI18n();
  const ui = useUiPrefs();
  const order = nameOrderOf(locale, ui);
  const sample = [...NAME_SAMPLE].sort(nameComparer(order, locale)).join(" · ");
  return (
    <>
      <SettingRow agents="none" source="local" label={t("appearance.nameGrouping")} hint={t("appearance.nameGroupingHint")} reset={<ResetButton disabled={ui.nameGrouping === null} onClick={() => setUiPref("nameGrouping", null)} />}>
        <Segmented
          value={order.grouping}
          options={NAME_GROUPINGS.map((v) => ({ value: v, label: t(`appearance.nameGrouping.${v}` as MessageKey), title: t(`appearance.nameGrouping.${v}.tip` as MessageKey) }))}
          onChange={(v) => setUiPref("nameGrouping", v)}
        />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("appearance.nameReading")} hint={t("appearance.nameReadingHint")} sample={<span data-name-order-sample="">{t("appearance.nameOrderSample", { names: sample })}</span>} reset={<ResetButton disabled={ui.nameReading === null} onClick={() => setUiPref("nameReading", null)} />}>
        <Segmented
          value={order.reading}
          options={NAME_READINGS.map((v) => ({ value: v, label: t(`appearance.nameReading.${v}` as MessageKey) }))}
          onChange={(v) => setUiPref("nameReading", v)}
        />
      </SettingRow>
    </>
  );
}
