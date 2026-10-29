// 「Director 头像」 grid (lib/directorAvatars): bundled portraits, then the owner's personal folder, as round
// cells like the avatars themselves. Arrow keys move, Enter / Space pick (native buttons). Below: open the
// personal folder (created on demand) and re-scan it, or a hint when the collection is empty.
import { FolderOpen, RefreshCw } from "lucide-react";
import { useI18n } from "../i18n";
import { canOpenDirectorAvatarFolder, directorAvatarIdOf, directorAvatarOf, loadDirectorAvatars, openDirectorAvatarFolder, useDirectorAvatars } from "../lib/directorAvatars";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import { useOwnerDocument } from "../lib/ownerContext";

export function DirectorAvatarGrid({ value, onPick, columns = 6, size = 36, className = "" }: { value: SessionAvatar | null; onPick(avatar: SessionAvatar): void; columns?: number; size?: number; className?: string }) {
  const doc = useOwnerDocument();
  const { t } = useI18n();
  const { list, dir, skipped } = useDirectorAvatars();
  const selected = directorAvatarIdOf(value);
  const canOpen = canOpenDirectorAvatarFolder();
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? columns : e.key === "ArrowUp" ? -columns : 0;
    if (!step) return;
    const cells = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-portrait]")];
    const i = cells.indexOf(doc.activeElement as HTMLButtonElement);
    const next = cells[Math.max(0, Math.min(cells.length - 1, i + step))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };
  return (
    <div className={`space-y-1.5 ${className}`} data-director-avatars>
      {list.length > 0 ? (
        <div role="group" aria-label={t("info.avatar.portrait")} onKeyDown={onKeyDown} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, ${size}px)` }}>
          {list.map((p) => (
            <button key={p.id} type="button" data-portrait={p.id} title={p.stem} aria-label={p.stem} aria-pressed={selected === p.id}
              onClick={() => onPick(directorAvatarOf(p))}
              className="overflow-hidden rounded-full outline-none hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-accent aria-pressed:ring-2 aria-pressed:ring-accent"
              style={{ width: size, height: size }}>
              <img src={p.url} alt="" draggable={false} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-caption/[inherit] text-subtle">{t("info.avatar.portraitEmpty")}</p>
      )}
      {canOpen && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => void openDirectorAvatarFolder()} title={dir ?? undefined}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption/[inherit] text-muted hover:bg-surface-2 hover:text-foreground">
            <FolderOpen size={12} />{t("info.avatar.portraitOpenFolder")}
          </button>
          <button type="button" onClick={() => void loadDirectorAvatars(true)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption/[inherit] text-muted hover:bg-surface-2 hover:text-foreground">
            <RefreshCw size={12} />{t("info.avatar.portraitRescan")}
          </button>
          {skipped > 0 && <span className="text-caption/[inherit] text-subtle">{t("info.avatar.portraitSkipped", { n: skipped })}</span>}
        </div>
      )}
      {canOpen && <p className="text-caption/[inherit] text-subtle">{t("info.avatar.portraitHint")}</p>}
    </div>
  );
}
