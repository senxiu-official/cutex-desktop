// 头像风格 picker (owner 2026-10-24: one concept for 拟人 / emoji / 字母, app default → Profile → agent; lib/avatarStyle).
// Controlled: `value` is the level's own style, null = inherit (only with `allowInherit`, e.g. a Profile following the
// app); `inherited` is what that means now, shown as a line. 拟人 = theme cards of the installed packs (lib/portraitThemes,
// one representative face each, themeCover), at least one ticked; emoji = 按模型 (null) or ticked emoji themes (lib/avatarThemes), at
// least one; 字母 = nothing to choose. Switching kinds remembers the other kinds' last choice while the picker is open.
import { useRef } from "react";
import { Check } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { getSavedPortraitThemes, type AvatarStyle } from "../../lib/avatarStyle";
import { AVATAR_THEME_IDS, themePreview, type AvatarThemeId } from "../../lib/avatarThemes";
import { FAMILY_LABEL, type PortraitPicture } from "../../lib/portraitPacks";
import { useSampleUrl, usePortraitThemes, type PortraitThemeInfo } from "../../lib/portraitThemes";
import { EmojiGlyph } from "../Avatar";
import { Notice, Segmented } from "./Form";

type Kind = AvatarStyle["kind"] | "inherit";

const familyCounts = (themes: readonly PortraitThemeInfo[]): string => {
  const sum: Record<string, number> = {};
  for (const th of themes) for (const [f, n] of Object.entries(th.families)) sum[f] = (sum[f] ?? 0) + (n ?? 0);
  return (Object.keys(FAMILY_LABEL) as (keyof typeof FAMILY_LABEL)[]).filter((f) => sum[f]).map((f) => `${FAMILY_LABEL[f]} ${sum[f]}`).join(" · ");
};

const FACE = 56;

/** The theme's one face, whole (object-contain: horns, ears and hair stay in the frame). */
function Face({ picture }: { picture: PortraitPicture }) {
  const url = useSampleUrl(picture, FACE);
  return (
    <span data-portrait-face={picture.key} className="block shrink-0 overflow-hidden rounded-md bg-surface-2" style={{ width: FACE, height: FACE }}>
      {url && <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />}
    </span>
  );
}

function ThemeCard({ theme, on, locked, disabled, onToggle }: { theme: PortraitThemeInfo; on: boolean; locked: boolean; disabled?: boolean; onToggle(on: boolean): void }) {
  const { t } = useI18n();
  // `relative`: the checkbox is `sr-only` (position: absolute); without a positioned label, focusing it on a click scrolled
  // the Settings card (see the note this replaced in PortraitSettings).
  return (
    <label data-portrait-theme={theme.key} data-on={on ? "" : undefined} title={locked ? t("avatarStyle.portrait.keepOne") : undefined}
      className={`relative flex min-w-0 items-center gap-2.5 rounded-lg border p-2 ${disabled || locked ? "cursor-default" : "cursor-pointer hover:bg-hover"} ${on ? "border-accent bg-selected" : "border-border"}`}>
      <Face picture={theme.cover} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <input type="checkbox" checked={on} disabled={disabled || locked} onChange={(e) => onToggle(e.target.checked)} className="peer sr-only" />
        <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${on ? "bg-accent text-[var(--on-accent)]" : "border border-border bg-background"}`}>{on && <Check size={11} strokeWidth={3} />}</span>
        <span className="min-w-0 truncate text-ui/[inherit] font-medium">{theme.name}</span>
        <span className="ml-auto shrink-0 text-caption/[inherit] text-subtle">{theme.count}</span>
      </span>
    </label>
  );
}

function PortraitChooser({ value, disabled, onChange }: { value: readonly string[]; disabled?: boolean; onChange(keys: string[]): void }) {
  const { t } = useI18n();
  const { themes } = usePortraitThemes();
  // Ticked keys that are not installed here stay in the value (another device may have the pack) but are not counted.
  const on = new Set(value);
  const shown = themes.filter((th) => on.has(th.key)).length;
  const packs = [...new Set(themes.map((th) => th.pack))].map((id) => themes.filter((th) => th.pack === id));
  const order = (keys: Iterable<string>) => {
    const set = new Set(keys);
    return [...themes.map((th) => th.key).filter((k) => set.has(k)), ...value.filter((k) => set.has(k) && !themes.some((th) => th.key === k))];
  };
  if (!themes.length) return <Notice tone="info">{t("avatarStyle.portrait.none")}</Notice>;
  return (
    <div className="space-y-3" data-style-portrait="">
      <p className="text-xs text-subtle">{t("avatarStyle.portrait.aiGenerated")}</p>
      <p className="text-xs text-subtle" data-portrait-enabled={shown}>{t("avatarStyle.portrait.count", { n: shown, total: themes.length })}</p>
      {packs.map((list) => {
        const keys = list.map((th) => th.key);
        const all = keys.every((k) => on.has(k));
        const first = keys[0]!;
        const onlyFirst = value.length === 1 && value[0] === first;
        return (
          <div key={list[0]!.pack} className="space-y-1.5" data-portrait-pack={list[0]!.pack}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-ui/[inherit] font-medium">{list[0]!.packName}</span>
              <span className="text-caption/[inherit] text-subtle">{t(list[0]!.bundled ? "avatarStyle.portrait.bundled" : "avatarStyle.portrait.mine")}</span>
              <span className="text-caption/[inherit] text-subtle" data-portrait-counts>{familyCounts(list)}</span>
              <span className="ml-auto flex gap-1">
                <button type="button" data-pack-all="" disabled={disabled || all} onClick={() => onChange(order([...value, ...keys]))} className="rounded-md px-1.5 py-0.5 text-caption/[inherit] text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-40">{t("avatarStyle.portrait.selectAll")}</button>
                <button type="button" data-pack-first="" disabled={disabled || onlyFirst} onClick={() => onChange([first])} className="rounded-md px-1.5 py-0.5 text-caption/[inherit] text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-40">{t("avatarStyle.portrait.selectNone")}</button>
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-1.5">
              {list.map((th) => {
                const ticked = on.has(th.key);
                return <ThemeCard key={th.key} theme={th} on={ticked} locked={ticked && value.length === 1} disabled={disabled} onToggle={(next) => onChange(order(next ? [...value, th.key] : value.filter((k) => k !== th.key)))} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmojiChooser({ value, disabled, onChange }: { value: readonly AvatarThemeId[] | null; disabled?: boolean; onChange(themes: AvatarThemeId[] | null): void }) {
  const { t } = useI18n();
  const auto = !value?.length;
  return (
    <div className="space-y-2" data-style-emoji="">
      <Segmented
        value={auto ? "auto" : "pick"}
        disabled={disabled}
        label={t("avatarStyle.emoji.themes")}
        options={[{ value: "auto", label: t("avatarStyle.emoji.auto"), title: t("avatarStyle.emoji.autoHint") }, { value: "pick", label: t("avatarStyle.emoji.pick") }]}
        onChange={(v) => onChange(v === "auto" ? null : [AVATAR_THEME_IDS[0]!])}
      />
      {auto ? (
        <p className="text-xs text-subtle">{t("avatarStyle.emoji.autoHint")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("avatarStyle.emoji.themes")}>
          {AVATAR_THEME_IDS.map((id) => {
            const on = value!.includes(id);
            const last = on && value!.length === 1;
            return (
              <button
                key={id}
                type="button"
                data-emoji-theme={id}
                aria-pressed={on}
                disabled={disabled || last}
                title={last ? t("avatarStyle.emoji.keepOne") : undefined}
                onClick={() => onChange(AVATAR_THEME_IDS.filter((x) => (x === id ? !on : value!.includes(x))))}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default ${on ? "border-accent/60 bg-accent/12 text-foreground" : "border-border text-muted hover:bg-surface-2 hover:text-foreground"}`}
              >
                <span className={`flex gap-0.5 ${on ? "" : "opacity-50 grayscale"}`} aria-hidden>
                  {themePreview(id, 3).map((e) => <EmojiGlyph key={e.code} glyph={e.glyph} size={13} />)}
                </span>
                {t(`avatarTheme.${id}` as MessageKey)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One line for a style (「拟人 · 洛丽塔、办公室」, 「Emoji · 按模型」, 「字母」): Profile rows, the inherited line. */
export function AvatarStyleLabel({ style }: { style: AvatarStyle }) {
  const { t } = useI18n();
  const { themes } = usePortraitThemes();
  return <>{styleText(style, themes, t)}</>;
}

function styleText(style: AvatarStyle, themes: readonly PortraitThemeInfo[], t: ReturnType<typeof useI18n>["t"]): string {
  if (style.kind === "letter") return t("avatarStyle.summary.letter");
  if (style.kind === "emoji") return style.emojiThemes?.length ? t("avatarStyle.summary.emoji", { themes: style.emojiThemes.map((id) => t(`avatarTheme.${id}` as MessageKey)).join("、") }) : t("avatarStyle.summary.emojiAuto");
  const names = style.portraitThemes.map((k) => themes.find((th) => th.key === k)?.name ?? k);
  return t("avatarStyle.summary.portrait", { themes: names.length > 3 ? `${names.slice(0, 3).join("、")} +${names.length - 3}` : names.join("、") });
}

export function AvatarStylePicker({ value, onChange, allowInherit = false, disabled = false, inherited = null }: {
  value: AvatarStyle | null;
  onChange(value: AvatarStyle | null): void;
  /** Offer 跟随应用 (value null). */
  allowInherit?: boolean;
  disabled?: boolean;
  /** The style a null value means now (shown under 跟随应用). */
  inherited?: AvatarStyle | null;
}) {
  const { t } = useI18n();
  const { themes } = usePortraitThemes();
  // The last choice of each kind while the picker is open, so 拟人 → 字母 → 拟人 keeps the ticked themes.
  const memory = useRef<{ portrait?: string[]; emoji?: AvatarThemeId[] | null }>({});
  if (value?.kind === "portrait") memory.current.portrait = value.portraitThemes;
  if (value?.kind === "emoji") memory.current.emoji = value.emojiThemes;
  const kind: Kind = value ? value.kind : allowInherit ? "inherit" : "emoji";
  const pick = (next: Kind) => {
    if (next === kind) return;
    if (next === "inherit") return onChange(null);
    if (next === "letter") return onChange({ kind: "letter" });
    if (next === "emoji") return onChange({ kind: "emoji", emojiThemes: memory.current.emoji ?? null });
    // 拟人 without a choice in this picker: what the level above uses, else the app's last portrait themes, else every installed theme.
    const saved = getSavedPortraitThemes();
    const seed = memory.current.portrait?.length ? memory.current.portrait : inherited?.kind === "portrait" ? inherited.portraitThemes : saved.length ? saved : themes.map((th) => th.key);
    if (seed.length) onChange({ kind: "portrait", portraitThemes: [...seed] });
  };
  const kinds: { value: Kind; label: string }[] = [
    ...(allowInherit ? [{ value: "inherit" as const, label: t("avatarStyle.kind.inherit") }] : []),
    { value: "portrait", label: t("avatarStyle.kind.portrait") },
    { value: "emoji", label: t("avatarStyle.kind.emoji") },
    { value: "letter", label: t("avatarStyle.kind.letter") },
  ];
  return (
    <div className="space-y-3" data-avatar-style-picker="" data-avatar-style={kind}>
      <Segmented value={kind} options={kinds} onChange={pick} disabled={disabled} label={t("avatarStyle.kind")} />
      {kind === "portrait" && <p className="text-xs leading-relaxed text-subtle">{t("avatarStyle.aiDisclosure")}</p>}
      {kind === "inherit" && inherited && <p className="text-xs text-subtle" data-style-inherited="">{t("avatarStyle.inherited", { style: styleText(inherited, themes, t) })}</p>}
      {value?.kind === "portrait" && <PortraitChooser value={value.portraitThemes} disabled={disabled} onChange={(keys) => onChange({ kind: "portrait", portraitThemes: keys })} />}
      {value?.kind === "emoji" && <EmojiChooser value={value.emojiThemes} disabled={disabled} onChange={(emojiThemes) => onChange({ kind: "emoji", emojiThemes })} />}
      {value?.kind === "letter" && <p className="text-xs text-subtle" data-style-letter="">{t("avatarStyle.letter.hint")}</p>}
    </div>
  );
}
