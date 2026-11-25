// Assistant requests as a list (an r295 assistant's 请求 tab, the page's 全部请求, an r295 project's 助理请求 tab):
// 待确认 · 进行中 · 已结束; a row shows the state, what it asks for, the project with its host, the Director and when it
// last changed; opening a row shows its confirmation card in place. Rows carry their host (owner 2026-11-25: requests
// show which host they belong to). r296 hosts page their requests newest first instead (PagedRequests), with the
// same rows.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Repeat } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { Segmented } from "../../components/settings/Form";
import type { PaAssistant, PaRequest } from "../../../../shared/personalAssistants";
import { requestGroup, type RequestGroup } from "../../lib/personalAssistants";
import { formatAbsolute } from "../../lib/time";
import { RequestCard, RequestStateTag } from "./RequestCard";
import { projectName, rowKey, sessionName, type PaHost } from "./paHooks";

export interface RequestRowData {
  hostId: string;
  assistant: PaAssistant;
  request: PaRequest;
}

const GROUPS: readonly RequestGroup[] = ["decide", "open", "done"];

const atText = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatAbsolute(Math.floor(ms / 1000)) : iso;
};

/** One request row; opened, its confirmation card under it. */
export function RequestRow({ hostId, assistant, request, host, expanded, onToggle, showHost, showAssistant, readOnly }: { hostId: string; assistant: PaAssistant; request: PaRequest; host: PaHost | undefined; expanded: boolean; onToggle(): void; showHost: boolean; showAssistant: boolean; readOnly: boolean }) {
  const { t } = useI18n();
  const director = sessionName(host, request.director.sessionId) ?? t("personal-assistants.card.vacant");
  const marks = [
    request.occurrence ? t("personal-assistants.requests.occurrence", { at: atText(request.occurrence.scheduledAt) }) : null,
    request.dueAt && !request.occurrence ? t("personal-assistants.requests.due", { at: atText(request.dueAt) }) : null,
  ];
  const meta = [projectName(host, request.projectId), showHost && host ? host.label : null, director, showAssistant ? t("personal-assistants.projectTab.via", { name: assistant.config.name }) : null, ...marks].filter(Boolean).join(" · ");
  return (
    <li className="border-b border-border/60 last:border-b-0" data-pa-request-row={request.id}>
      <button type="button" className="press flex w-full min-w-0 items-start gap-2 rounded-md px-1 py-1.5 text-left hover:bg-surface-2/60" aria-expanded={expanded} onClick={onToggle}>
        <span className="mt-0.5 shrink-0 text-subtle">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className="mt-px shrink-0"><RequestStateTag state={request.state} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui/[inherit]">
            {request.occurrence && <Repeat size={12} className="mr-1 inline text-subtle" aria-hidden data-pa-occurrence="" />}
            {request.outcome}
          </span>
          <span className="block truncate text-caption/[inherit] text-subtle">{meta}</span>
        </span>
      </button>
      {expanded && <RequestCard hostId={hostId} assistant={assistant} request={request} host={host} readOnly={readOnly} />}
    </li>
  );
}

export function RequestList({ rows, hosts, showAssistant, showHost, readOnlyHosts, initialOpen = null }: { rows: readonly RequestRowData[]; hosts: readonly PaHost[]; showAssistant: boolean; showHost: boolean; readOnlyHosts: ReadonlySet<string>; /** A request to show opened (from 今日). */ initialOpen?: string | null }) {
  const { t } = useI18n();
  const counts = useMemo(() => {
    const c: Record<RequestGroup, number> = { decide: 0, open: 0, done: 0 };
    for (const r of rows) c[requestGroup(r.request.state)] += 1;
    return c;
  }, [rows]);
  const preset = initialOpen ? rows.find((r) => r.request.id === initialOpen) : undefined;
  const [group, setGroup] = useState<RequestGroup>(() => (preset ? requestGroup(preset.request.state) : counts.decide ? "decide" : counts.open ? "open" : "decide"));
  const [open, setOpen] = useState<string | null>(preset ? rowKey(preset.hostId, preset.request.id) : null);
  const shown = rows
    .filter((r) => requestGroup(r.request.state) === group)
    .sort((a, b) => (group === "done" ? b.request.updatedAt.localeCompare(a.request.updatedAt) : a.request.updatedAt.localeCompare(b.request.updatedAt)));
  return (
    <div data-pa-requests="">
      <div className="mb-2">
        <Segmented
          value={group}
          label={t("personal-assistants.tab.requests")}
          onChange={setGroup}
          options={GROUPS.map((g) => ({ value: g, label: `${t(`personal-assistants.requests.${g}` as MessageKey)} ${counts[g]}` }))}
        />
      </div>
      {shown.length === 0 ? (
        <div className="py-3 text-ui/[inherit] text-subtle" data-pa-requests-none={group}>{t(`personal-assistants.requests.none.${group}` as MessageKey)}</div>
      ) : (
        <ul className="flex flex-col">
          {shown.map(({ hostId, assistant, request }) => {
            const key = rowKey(hostId, request.id);
            return (
              <RequestRow
                key={key}
                hostId={hostId}
                assistant={assistant}
                request={request}
                host={hosts.find((h) => h.hostId === hostId)}
                expanded={open === key}
                onToggle={() => setOpen(open === key ? null : key)}
                showHost={showHost}
                showAssistant={showAssistant}
                readOnly={readOnlyHosts.has(hostId)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
