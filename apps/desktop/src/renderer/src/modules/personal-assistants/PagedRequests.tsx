// Requests of an updated host, newest first, paged on cutex's cursor with a state filter (one assistant's 请求 tab; a
// project's 助理请求 tab through the owner query). Rows and their confirmation card are RequestList's. Reads the first
// page again when `refreshKey` moves (a change event of the requests) and keeps the row that was open.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { Select } from "../../components/settings/Form";
import { PA_REQUEST_STATES, type PaAssistant, type PaRequest, type PaRequestPage } from "../../../../shared/personalAssistants";
import { RequestRow } from "./RequestList";
import { paErrorText, type PaHost } from "./paHooks";

const PAGE = 50;
const ALL = "all";

export function PagedRequests({ hostId, host, load, assistantFor, refreshKey, showAssistant, readOnly, initialOpen = null, initialState, tools }: {
  hostId: string;
  host: PaHost | undefined;
  /** One page (newest first; `state` empty = every state). */
  load(query: { state?: string; cursor: number | null; limit: number }): Promise<PaRequestPage>;
  /** The assistant a row belongs to (its name, and the id its card reads). */
  assistantFor(r: PaRequest): PaAssistant;
  refreshKey: unknown;
  showAssistant: boolean;
  readOnly: boolean;
  initialOpen?: string | null;
  initialState?: string;
  /** More controls beside the state filter (the project tab's scope). */
  tools?: ReactNode;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<string>(initialState ?? ALL);
  const [items, setItems] = useState<PaRequest[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(initialOpen);
  const query = state === ALL ? {} : { state };
  const first = useCallback(async () => {
    try {
      const page = await load({ ...query, cursor: null, limit: PAGE });
      setItems(page.items);
      setNext(page.nextCursor);
      setError(null);
    } catch (e) {
      setError(paErrorText(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, state, t]);
  useEffect(() => {
    void first();
  }, [first, refreshKey]);
  const more = async () => {
    if (next === null) return;
    setBusy(true);
    try {
      const page = await load({ ...query, cursor: next, limit: PAGE });
      setItems((cur) => {
        const seen = new Set((cur ?? []).map((r) => r.id));
        return [...(cur ?? []), ...page.items.filter((r) => !seen.has(r.id))];
      });
      setNext(page.nextCursor);
    } catch (e) {
      setError(paErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const options = [{ value: ALL, label: t("personal-assistants.requests.filter.all") }, ...PA_REQUEST_STATES.map((s) => ({ value: s, label: t(`personal-assistants.state.${s}` as MessageKey) }))];
  return (
    <div data-pa-paged-requests="">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select value={state} options={options} onChange={setState} label={t("personal-assistants.requests.filter")} />
        {tools}
      </div>
      {error && <div className="mb-2 text-caption/[inherit] text-danger" role="alert">{t("personal-assistants.requests.loadFailed", { error })}</div>}
      {items && items.length === 0 ? (
        <div className="py-3 text-ui/[inherit] text-subtle" data-pa-requests-none={state}>{t(state === ALL ? "personal-assistants.requests.none.all" : "personal-assistants.requests.none.filtered")}</div>
      ) : (
        <ul className="flex flex-col">
          {items?.map((request) => (
            <RequestRow
              key={request.id}
              hostId={hostId}
              assistant={assistantFor(request)}
              request={request}
              host={host}
              expanded={open === request.id}
              onToggle={() => setOpen(open === request.id ? null : request.id)}
              showHost={false}
              showAssistant={showAssistant}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
      {next !== null && (
        <button type="button" className="press mt-1 rounded-sm text-caption/[inherit] text-accent" disabled={busy} onClick={() => void more()} data-pa-requests-more="">
          {t("personal-assistants.requests.more")}
        </button>
      )}
    </div>
  );
}
