// 历史 (contract 审计): newest first by `seq`, paged with 加载更早的记录. A row: when, who (你 / cutex / the agent's
// name for a session), what (known verbs in words, others as cutex wrote them) and the details as cutex stored them
// (folded). The authenticated owner actions and the assistant's / Director's own actions are both listed.
import { useCallback, useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { Section } from "../../components/settings/Form";
import type { PaAuditRow } from "../../../../shared/personalAssistants";
import { hostApi } from "../../lib/hostLists";
import { formatAbsolute } from "../../lib/time";
import { paErrorText, sessionName, type PaHost } from "./paHooks";

const VERBS = new Set(["create", "bind", "configure", "confirm", "cancel", "prepare", "revise", "directorResponse", "memoryWrite"]);

export function AuditList({ hostId, assistantId, host, refreshKey }: { hostId: string; assistantId: string; host: PaHost | undefined; refreshKey: unknown }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<PaAuditRow[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useCallback(async () => {
    try {
      const page = await hostApi(hostId).paAudit(assistantId, { limit: 50 });
      setRows(page.items);
      setNext(page.nextCursor);
      setError(null);
    } catch (e) {
      setError(paErrorText(e, t));
    }
  }, [hostId, assistantId, t]);
  useEffect(() => {
    void first();
  }, [first, refreshKey]);
  const more = async () => {
    if (next === null) return;
    setBusy(true);
    try {
      const page = await hostApi(hostId).paAudit(assistantId, { cursor: next, limit: 50 });
      setRows((cur) => {
        const seen = new Set((cur ?? []).map((r) => r.seq));
        return [...(cur ?? []), ...page.items.filter((r) => !seen.has(r.seq))];
      });
      setNext(page.nextCursor === next ? null : page.nextCursor);
    } catch (e) {
      setError(paErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const actor = (a: string) => (a === "owner" ? t("personal-assistants.history.actor.owner") : a === "system" ? t("personal-assistants.history.actor.system") : (sessionName(host, a) ?? a));
  const at = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? formatAbsolute(Math.floor(ms / 1000)) : iso;
  };
  return (
    <div data-pa-history="">
      <Section title={t("personal-assistants.tab.history")}>
        {error && <div className="mb-2 text-caption/[inherit] text-danger" role="alert">{t("personal-assistants.history.loadFailed", { error })}</div>}
        {rows && rows.length === 0 && <div className="text-ui/[inherit] text-subtle">{t("personal-assistants.history.none")}</div>}
        <ul className="flex flex-col">
          {rows?.map((r) => (
            <li key={r.seq} className="border-b border-border/60 py-1 last:border-b-0" data-pa-audit={r.verb}>
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="w-32 shrink-0 text-caption/[inherit] text-subtle">{at(r.at)}</span>
                <span className="shrink-0 text-ui/[inherit] font-medium">{actor(r.actor)}</span>
                <span className="min-w-0 flex-1 truncate text-ui/[inherit]">{VERBS.has(r.verb) ? t(`personal-assistants.history.verb.${r.verb}` as MessageKey) : r.verb}</span>
              </div>
              {r.detail != null && (
                <details className="ml-34 text-caption/[inherit] text-subtle">
                  <summary className="cursor-default select-none">{t("personal-assistants.history.detail")}</summary>
                  <pre className="mt-0.5 max-h-40 overflow-auto font-mono break-all whitespace-pre-wrap">{JSON.stringify(r.detail, null, 1)}</pre>
                  <div className="font-mono">{r.actionId}</div>
                </details>
              )}
            </li>
          ))}
        </ul>
        {next !== null && (
          <button type="button" className="press mt-1 rounded-sm text-caption/[inherit] text-accent" disabled={busy} onClick={() => void more()} data-pa-history-more="">
            {t("personal-assistants.history.more")}
          </button>
        )}
      </Section>
    </div>
  );
}
