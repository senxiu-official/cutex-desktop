// An assistant's 笔记 tab (cutex r296 owner views): the coordination notes the assistant keeps, read only — key,
// content, the assistant's own source note and revision — searchable (cutex matches key or content, at most 256 bytes)
// and paged on cutex's cursor. Read again when a change event names the notes.
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { Section, TextInput } from "../../components/settings/Form";
import { cutBytes, PA_NOTE_QUERY_MAX, type PaNote } from "../../../../shared/personalAssistants";
import { hostApi } from "../../lib/hostLists";
import { paErrorText, usePaTick } from "./paHooks";

const PAGE = 50;
/** Longer notes start folded. */
const FOLD_CHARS = 400;

export function NotesList({ hostId, assistantId }: { hostId: string; assistantId: string }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PaNote[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tick = usePaTick(hostId, assistantId, "notes");
  // The search settles before it is read.
  useEffect(() => {
    const timer = setTimeout(() => setQ(cutBytes(query.trim(), PA_NOTE_QUERY_MAX)), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const first = useCallback(async () => {
    try {
      const page = await hostApi(hostId).paNotes(assistantId, { q: q || undefined, limit: PAGE });
      setItems(page.items);
      setNext(page.nextCursor);
      setError(null);
    } catch (e) {
      setError(paErrorText(e, t));
    }
  }, [hostId, assistantId, q, t]);
  useEffect(() => {
    void first();
  }, [first, tick]);
  const more = async () => {
    if (!next) return;
    setBusy(true);
    try {
      const page = await hostApi(hostId).paNotes(assistantId, { q: q || undefined, cursor: next, limit: PAGE });
      setItems((cur) => [...(cur ?? []), ...page.items.filter((n) => !cur?.some((c) => c.key === n.key))]);
      setNext(page.nextCursor);
    } catch (e) {
      setError(paErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-pa-notes="">
      <Section title={t("personal-assistants.notes.title")} hint={t("personal-assistants.notes.hint")}>
        <div className="mb-2">
          <TextInput value={query} onChange={(v) => setQuery(v)} search label={t("personal-assistants.notes.search")} placeholder={t("personal-assistants.notes.search")} />
        </div>
        {error && <div className="mb-2 text-caption/[inherit] text-danger" role="alert">{t("personal-assistants.notes.loadFailed", { error })}</div>}
        {items && items.length === 0 && <div className="py-2 text-ui/[inherit] text-subtle" data-pa-notes-none="">{t(q ? "personal-assistants.notes.noMatch" : "personal-assistants.notes.none")}</div>}
        <ul className="flex flex-col gap-2">
          {items?.map((n) => <NoteRow key={n.key} note={n} />)}
        </ul>
        {next && (
          <button type="button" className="press mt-2 rounded-sm text-caption/[inherit] text-accent" disabled={busy} onClick={() => void more()} data-pa-notes-more="">
            {t("personal-assistants.notes.more")}
          </button>
        )}
      </Section>
    </div>
  );
}

function NoteRow({ note }: { note: PaNote }) {
  const { t } = useI18n();
  const long = note.content.length > FOLD_CHARS;
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-border/70 px-2.5 py-1.5" data-pa-note={note.key}>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-caption/[inherit] text-muted">{note.key}</span>
        <span className="shrink-0 text-caption/[inherit] text-subtle">{t("personal-assistants.notes.revision", { n: note.revision })}</span>
      </div>
      <div className="mt-0.5 text-ui/[inherit] break-words whitespace-pre-wrap">{long && !open ? `${note.content.slice(0, FOLD_CHARS)}…` : note.content}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-2 text-caption/[inherit] text-subtle">
        {note.sourceRef && <span className="min-w-0 break-words">{t("personal-assistants.notes.source", { source: note.sourceRef })}</span>}
        {long && (
          <button type="button" className="press rounded-sm text-accent" onClick={() => setOpen(!open)}>
            {t(open ? "personal-assistants.notes.collapse" : "personal-assistants.notes.expand")}
          </button>
        )}
      </div>
    </li>
  );
}
