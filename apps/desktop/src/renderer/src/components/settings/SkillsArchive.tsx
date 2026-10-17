// Settings → 技能: archive a user skill (cutex skills-archive moves its folder to
// `<cutex home>/archive/skills/`, never a delete) and the collapsed 「已归档」 list with 恢复.
import { useState } from "react";
import { Archive, ChevronDown, ChevronRight } from "lucide-react";
import type { SkillArchiveRecord } from "../../../../shared/skillsArchive";
import { useI18n } from "../../i18n";
import { ARMED_BUTTON, useArmed } from "../../lib/armedConfirm";
import { formatAbsolute, formatWhen } from "../../lib/time";
import { Button, Card, IconButton, ListRow } from "./Form";

/** Row action: first click arms (「再点一次归档」), the second archives. Restorable, so one confirm. */
export function ArchiveSkillButton({ name, disabled, onArchive }: { name: string; disabled?: boolean; onArchive(): void }) {
  const { t } = useI18n();
  const [armed, setArmed] = useArmed();
  return armed ? (
    <button
      disabled={disabled}
      onClick={() => (setArmed(false), onArchive())}
      className={`${ARMED_BUTTON} flex h-6 shrink-0 items-center whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none`}
    >
      {t("codex-config.skills.archiveArmed")}
    </button>
  ) : (
    <IconButton label={t("codex-config.skills.archiveTitle", { name })} disabled={disabled} onClick={() => setArmed(true)}>
      <Archive size={14} />
    </IconButton>
  );
}

/** Collapsed 「已归档（N）」 at the bottom of the page; hidden while empty. */
export function ArchivedSkills({ archives, busy, onRestore }: { archives: SkillArchiveRecord[]; busy: string | null; onRestore(record: SkillArchiveRecord): void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  if (archives.length === 0) return null;
  const now = Date.now();
  return (
    <section className="mb-6">
      <div className="mb-2 flex h-7 items-center">
        <button
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 rounded text-sm font-semibold hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t("codex-config.skills.archived", { n: archives.length })}
        </button>
      </div>
      {open && (
        <>
          <p className="mb-2 text-xs text-subtle">{t("codex-config.skills.archivedHint")}</p>
          <Card>
            {archives.map((a) => {
              const at = Date.parse(a.archivedAt) / 1000;
              return (
                <ListRow
                  key={a.id}
                  title={a.name}
                  detail={
                    <span title={`${a.originalPath}\n${a.archivePath ?? ""}`}>
                      <span title={Number.isFinite(at) ? formatAbsolute(at) : a.archivedAt}>{t("codex-config.skills.archivedAt", { time: Number.isFinite(at) ? formatWhen(at, now, locale) : a.archivedAt })}</span>
                      {" · "}
                      <span className="font-mono">{a.originalPath}</span>
                    </span>
                  }
                  actions={
                    <Button disabled={busy !== null} onClick={() => onRestore(a)}>
                      {busy === a.id ? t("codex-config.skills.restoring") : t("codex-config.skills.restore")}
                    </Button>
                  }
                />
              );
            })}
          </Card>
        </>
      )}
    </section>
  );
}
