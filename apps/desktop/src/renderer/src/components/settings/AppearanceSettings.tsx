// Settings → 外观: theme and contrast, window zoom, fonts and text sizes, conversation width and
// list density, the default agent avatar. Everything is per machine (different screens need different values) and applies
// live; see lib/appearance.ts. Sidebar / capsule / conversation display live on their own pages.
import { useState, type ReactNode } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { DEFAULT_APPEARANCE, RANGES, setAppearance, useAppearance, useFontStatus, type Appearance, type Density } from "../../lib/appearance";
import { setUiPref, useUiPrefs, type ProjectIconStyle } from "../../lib/prefs";
import { settingsAnchorId } from "../../lib/settingsNav";
import { applyContrast, applyTheme, loadContrast, loadTheme, type ContrastPref, type ThemePref } from "../../lib/theme";
import { Avatar } from "../Avatar";
import { ScriptText } from "../ScriptText";
import { AppearanceNumberRow, FontRow } from "./AppearanceRows";
import { NumberField, ResetButton, Section, Segmented, SettingRow, Toggle } from "./Form";
import { LaunchArtSection } from "./LaunchArtSettings";

const LATIN = ["Inter", "IBM Plex Sans", "Segoe UI", "Source Sans 3", "Noto Sans", "Source Serif 4", "Lora", "Georgia"];
const CJK = ["Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "LXGW WenKai", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "KingHwa_OldSong"];
const MONO = ["JetBrains Mono", "Cascadia Code", "Cascadia Mono", "IBM Plex Mono", "Fira Code", "Consolas", "Maple Mono", "Sarasa Mono SC"];
// The shared font preview (not translated: it shows glyphs, not words). Mixed Latin / CJK with
// curly quotes in both contexts, since U+2018/2019/201C/201D pick their font by context
// (lib/fontRuns.ts); the code line shows the glyphs people check a coding font for (0O 1lI).
// The owner's sample (2026-10-15): eleven greetings for the interface line; the dialogue — curly quotes
// in Latin and CJK context, nested ‘…’, and a last quotation left open — for the conversation.
const SAMPLE_UI = "Le Café de Cutex 的留言板上，写着各种欢迎：欢迎 · 歡迎 · Hello · G’day · Привет · Bonjour · Hola · Olá · Ciao · Hallo · こんにちは。";
const SAMPLE_CHAT = [
  "“To be, or not to be: that is the question.” Someone had scribbled it in a corner.",
  "“仰观宇宙之大，俯察品类之盛。” 有人用另一种笔迹在下面答道。",
  "“Is ‘仰观宇宙之大’ your answer to Shakespeare?” the first writer asked.",
  "“只是觉得，回答 ‘To be, or not to be’ 之前，不妨先看看这个世界。",
].join("\n");
const SAMPLE_CODE = "const xs = arr.map((v) => v * 2); // 0O 1lI {} [] != ===";

/** Preview names for 默认头像 (seeds too: real agents are seeded by their session id). */
const AVATAR_SAMPLES = ["demo-ui-r3", "demo-director-r2", "demo-quant-config-r1", "demo-review-glm-r2"];

export function AppearancePage() {
  const { t } = useI18n();
  const a = useAppearance();
  const fonts = useFontStatus();
  const ui = useUiPrefs();
  const [theme, setTheme] = useState<ThemePref>(loadTheme);
  const [contrast, setContrast] = useState<ContrastPref>(loadContrast);
  const fullWidth = a.readingWidth === 0;
  return (
    <>
      <Section id={settingsAnchorId("overall")} title={t("appearance.overall")}>
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
        <AppearanceNumberRow field="zoom" label="appearance.zoom" hint="appearance.zoomHint" unit="%" step={5} />
        {/* Project icons everywhere (components/ProjectBadge): 淡底色 tile or 线条 glyph only, same box. */}
        <SettingRow label={t("appearance.projectIconStyle")} hint={t("appearance.projectIconStyleHint")}>
          <Segmented
            label={t("appearance.projectIconStyle")}
            value={ui.projectIconStyle}
            options={(["tint", "line"] as ProjectIconStyle[]).map((v) => ({ value: v, label: t(`appearance.projectIconStyle.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("projectIconStyle", v)}
          />
        </SettingRow>
        <SettingRow label={t("appearance.agentAvatar")} hint={t("appearance.agentAvatarHint")}>
          <div className="flex items-center gap-3">
            <span className="flex gap-1" aria-hidden>
              {AVATAR_SAMPLES.map((name) => <Avatar key={name} name={name} seed={name} size={20} />)}
            </span>
            <Segmented
              value={ui.agentAvatarDefault}
              options={(["emoji", "letter"] as const).map((v) => ({ value: v, label: t(`appearance.agentAvatar.${v}` as MessageKey) }))}
              onChange={(v) => setUiPref("agentAvatarDefault", v)}
            />
          </div>
        </SettingRow>
      </Section>

      <Section id={settingsAnchorId("fonts")} title={t("appearance.fonts")} hint={t("appearance.fontsHint")}>
        {fonts.phase === "loading" && <p role="status" className="text-xs text-subtle">{t("appearance.fontsLoading")}</p>}
        {fonts.phase === "unsupported" && <p role="status" className="text-xs text-warn">{t("appearance.fontsUnsupported")}</p>}
        {fonts.phase === "ready" && fonts.failedFamilies.length > 0 && <p role="status" className="text-xs text-warn">{t("appearance.fontsFallback", { fonts: fonts.failedFamilies.join(", ") })}</p>}
        <FontPreview />
        <FontRow label={t("appearance.uiFont")} hint={t("appearance.uiFontHint")} value={a.uiFont} fonts={[...LATIN, ...CJK]} onChange={(v) => setAppearance({ uiFont: v })} />
        <FontRow label={t("appearance.cjkFont")} hint={t("appearance.cjkFontHint")} value={a.cjkFont} fonts={CJK} onChange={(v) => setAppearance({ cjkFont: v })} />
        <FontRow label={t("appearance.chatFont")} hint={t("appearance.chatFontHint")} value={a.chatFont} fonts={[...LATIN, ...CJK]} defaultLabel={t("appearance.followUi")} onChange={(v) => setAppearance({ chatFont: v })} />
        <FontRow label={t("appearance.chatCjkFont")} hint={t("appearance.chatCjkFontHint")} value={a.chatCjkFont} fonts={CJK} defaultLabel={t("appearance.followCjk")} onChange={(v) => setAppearance({ chatCjkFont: v })} />
        <AppearanceNumberRow field="chatFontSize" label="appearance.chatFontSize" unit="px" />
        <FontRow label={t("appearance.monoFont")} hint={t("appearance.monoFontHint")} value={a.monoFont} fonts={MONO} onChange={(v) => setAppearance({ monoFont: v })} />
        <AppearanceNumberRow field="monoFontSize" label="appearance.monoFontSize" unit="px" />
      </Section>

      <Section id={settingsAnchorId("layout")} title={t("appearance.layout")}>
        <SettingRow label={t("appearance.fullWidth")} hint={t("appearance.fullWidthHint")}>
          <Toggle checked={fullWidth} onChange={(v) => setAppearance({ readingWidth: v ? 0 : DEFAULT_APPEARANCE.readingWidth })} />
        </SettingRow>
        <SettingRow
          label={t("appearance.readingWidth")}
          hint={t("appearance.readingWidthHint")}
          reset={<ResetButton disabled={a.readingWidth === DEFAULT_APPEARANCE.readingWidth} onClick={() => setAppearance({ readingWidth: DEFAULT_APPEARANCE.readingWidth })} />}
        >
          <NumberField slider disabled={fullWidth} value={fullWidth ? RANGES.readingWidth[1] : a.readingWidth} range={RANGES.readingWidth} unit="px" step={20} onCommit={(v) => v !== null && setAppearance({ readingWidth: v })} />
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

/** One live preview for all five font slots: UI text, conversation text and code, each at its own size. */
function FontPreview() {
  const { t } = useI18n();
  const line = (label: MessageKey, body: ReactNode) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-subtle">{t(label)}</span>
      {body}
    </div>
  );
  return (
    <div aria-label={t("appearance.fontPreview")} className="my-2 flex flex-col gap-2 rounded-md border border-border bg-surface/50 px-3 py-2.5">
      {line("appearance.fontPreview.ui", <p className="text-[13px] leading-relaxed" style={{ fontFamily: "var(--font-sans)" }}><ScriptText text={SAMPLE_UI} /></p>)}
      {line("appearance.fontPreview.chat", <p className="font-chat-context whitespace-pre-line leading-relaxed" style={{ fontSize: "var(--chat-font-size)" }}><ScriptText text={SAMPLE_CHAT} /></p>)}
      {line("appearance.fontPreview.code", <p className="break-all font-mono" style={{ fontSize: "var(--mono-font-size, 13px)" }}>{SAMPLE_CODE}</p>)}
    </div>
  );
}
