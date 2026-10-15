import { useI18n } from "../../i18n";
/** The conversation's host has no notes routes (older cutex): a calm notice, no calls. */
export function NotesUnsupported({ waiting }: { waiting: boolean }) {
  const { t } = useI18n();
  return <p data-notes-unsupported className="p-3 text-xs text-subtle">{t(waiting ? "notes.loading" : "notes.unsupportedHost")}</p>;
}
