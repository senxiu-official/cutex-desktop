// 「拟人」 in the avatar pickers (lib/portraitPacks): one theme at a time (the stored picture's, else the first one
// enabled in Settings → 外观 → 拟人头像, else the first installed), its pictures by model family with the agent's own family first,
// as round cells like the avatars. Arrow keys move, Enter / Space pick (native buttons).
import { useMemo, useState } from "react";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import { useI18n } from "../i18n";
import { useUiPrefs } from "../lib/prefs";
import { FAMILY_LABEL, packName, portraitAvatarOf, portraitRefOf, usePortraitImage, usePortraitPacks, type PortraitFamily, type PortraitPicture } from "../lib/portraitPacks";
import { PORTRAIT_FAMILIES } from "../../../shared/portraitPacks";
import { useOwnerDocument } from "../lib/ownerContext";
import { portraitThemesOf } from "../lib/portraitThemes";

function Cell({ picture, size, selected, onPick }: { picture: PortraitPicture; size: number; selected: boolean; onPick(p: PortraitPicture): void }) {
  const url = usePortraitImage(picture, size);
  return (
    <button type="button" data-portrait-pick={picture.key} title={picture.stem} aria-label={picture.stem} aria-pressed={selected} onClick={() => onPick(picture)}
      className="rounded-md bg-surface-2 outline-none hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-accent aria-pressed:ring-2 aria-pressed:ring-accent"
      style={{ width: size, height: size }}>
      {url && <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />}
    </button>
  );
}

export function PortraitPackGrid({ value, onPick, family, columns = 8, size = 36, className = "" }: { value: SessionAvatar | null; onPick(avatar: SessionAvatar): void; family?: PortraitFamily | null; columns?: number; size?: number; className?: string }) {
  const doc = useOwnerDocument();
  const { t, locale } = useI18n();
  const { portraitPacks } = useUiPrefs();
  const { packs } = usePortraitPacks();
  const selected = portraitRefOf(value);
  const themes = useMemo(() => {
    const names = new Map(portraitThemesOf(packs, locale).map(th => [th.key, th.name]));
    return packs.flatMap(p => p.themes.map(th => ({ key: `${p.id}/${th.id}`, label: `${packs.length > 1 ? `${packName(p, locale)} · ` : ""}${names.get(`${p.id}/${th.id}`) ?? th.name}`, theme: th })));
  }, [packs, locale]);
  const fallbackKey = (selected && `${selected.pack}/${selected.theme}`) || portraitPacks.find((k) => themes.some((x) => x.key === k)) || null;
  const [shownKey, setShownKey] = useState<string | null>(null);
  const current = themes.find((x) => x.key === (shownKey ?? fallbackKey)) ?? themes[0];
  if (!current) return <p className="text-caption/[inherit] text-subtle">{t("info.avatar.packsEmpty")}</p>;
  const order = family && family !== "other" ? [family, ...PORTRAIT_FAMILIES.filter((f) => f !== family)] : PORTRAIT_FAMILIES;
  const groups = [...order, "other" as const].map((f) => ({ family: f, pictures: current.theme.pictures.filter((p) => p.family === f) })).filter((g) => g.pictures.length);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? columns : e.key === "ArrowUp" ? -columns : 0;
    if (!step) return;
    const cells = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-portrait-pick]")];
    const next = cells[Math.max(0, Math.min(cells.length - 1, cells.indexOf(doc.activeElement as HTMLButtonElement) + step))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };
  return (
    <div className={`space-y-1.5 ${className}`} data-portrait-packs>
      <p className="text-xs text-subtle">{t("avatarStyle.portrait.aiGenerated")}</p>
      <select aria-label={t("info.avatar.packTheme")} value={current.key} onChange={(e) => setShownKey(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-1.5 py-1 text-xs outline-none focus:border-accent">
        {themes.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
      </select>
      <div role="group" aria-label={current.label} onKeyDown={onKeyDown} className="space-y-1">
        {groups.map((g) => (
          <div key={g.family} className="flex items-center gap-1.5" data-portrait-family={g.family}>
            <span className="w-14 shrink-0 truncate text-caption/[inherit] text-subtle">{FAMILY_LABEL[g.family]}</span>
            <div className="flex flex-wrap gap-1.5">
              {g.pictures.map((p) => <Cell key={p.key} picture={p} size={size} selected={selected?.pack === p.pack && selected.theme === p.theme && selected.stem === p.stem} onPick={(x) => onPick(portraitAvatarOf(x))} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
