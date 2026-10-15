// The bundled avatar emoji (lib/agentEmoji) as a grouped grid: one tab stop (roving tabindex),
// arrow keys move by cell / visual row, Home / End jump to the ends, Enter / Space pick. Cells use
// the same pictures as the avatars, so what is picked here is what the sidebar shows.
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { AVATAR_EMOJI_GROUPS, AVATAR_EMOJI_SET, bundledEmoji, type AvatarEmoji } from "../lib/agentEmoji";
import { EmojiGlyph } from "./Avatar";

export function EmojiGrid({ value, onPick, columns = 10, className = "" }: { value: string | null; onPick(glyph: string): void; columns?: number; className?: string }) {
  const { t } = useI18n();
  const selected = bundledEmoji(value)?.code ?? null;
  // Visual rows per group: [group, rows of emoji].
  const layout = useMemo(() => {
    const groups: { group: string; rows: AvatarEmoji[][] }[] = [];
    for (const group of AVATAR_EMOJI_GROUPS) {
      const items = AVATAR_EMOJI_SET.filter((e) => e.group === group);
      const rows: AvatarEmoji[][] = [];
      for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
      groups.push({ group, rows });
    }
    return groups;
  }, [columns]);
  const rows = useMemo(() => layout.flatMap((g) => g.rows), [layout]);
  const flat = useMemo(() => rows.flat(), [rows]);
  const [focus, setFocus] = useState<string>(selected ?? flat[0]!.code);
  const cells = useRef(new Map<string, HTMLButtonElement>());
  // Show the current pick when the grid opens inside a scroll box.
  useEffect(() => {
    if (selected) cells.current.get(selected)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const move = (code: string) => {
    setFocus(code);
    cells.current.get(code)?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = rows.findIndex((row) => row.some((x) => x.code === focus));
    if (r < 0) return;
    const c = rows[r]!.findIndex((x) => x.code === focus);
    const i = flat.findIndex((x) => x.code === focus);
    let next: AvatarEmoji | undefined;
    if (e.key === "ArrowRight") next = flat[i + 1];
    else if (e.key === "ArrowLeft") next = flat[i - 1];
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const row = rows[r + (e.key === "ArrowDown" ? 1 : -1)];
      next = row?.[Math.min(c, row.length - 1)];
    } else if (e.key === "Home") next = flat[0];
    else if (e.key === "End") next = flat[flat.length - 1];
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (next) move(next.code);
  };
  return (
    <div role="grid" aria-label={t("info.avatar.emoji")} onKeyDown={onKeyDown} className={`space-y-1.5 ${className}`}>
      {layout.map(({ group, rows: groupRows }) => (
        <div key={group} role="rowgroup" aria-label={t(`info.emojiGroup.${group}` as MessageKey)}>
          <div aria-hidden className="px-0.5 pb-0.5 text-[10px] font-medium tracking-wide text-subtle">{t(`info.emojiGroup.${group}` as MessageKey)}</div>
          {groupRows.map((row, ri) => (
            <div key={ri} role="row" className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {row.map((e) => (
                <button
                  key={e.code}
                  ref={(el) => void (el ? cells.current.set(e.code, el) : cells.current.delete(e.code))}
                  type="button"
                  role="gridcell"
                  tabIndex={focus === e.code ? 0 : -1}
                  aria-selected={selected === e.code}
                  aria-label={e.name}
                  title={e.name}
                  onFocus={() => setFocus(e.code)}
                  onClick={() => onPick(e.glyph)}
                  className="flex aspect-square items-center justify-center rounded-md outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent aria-selected:bg-accent/15 aria-selected:ring-1 aria-selected:ring-accent/60"
                >
                  <EmojiGlyph glyph={e.glyph} size={20} />
                </button>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
