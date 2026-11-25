// 个人助理 page — the front desk (plan 「桌面接入规格」 1). Left: 全部请求 (with what waits for the owner), 创建个人
// 助理, then every assistant of every connected host that has the capability (owner 2026-11-25: cross-host by
// nature), its state and what waits for the owner. One assistant opens directly; with several the one with something
// to confirm is shown first. No assistant at all: only 「创建个人助理」. Right: the chosen assistant, the create form,
// or every request. Read on open, on focus and reconnection; r296 hosts by their change events, r295 hosts every 30 s
// while open (lib/personalAssistantStore).
import { useEffect, useMemo, useState } from "react";
import { Inbox, Plus } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { PageBody, SubNav, SUBNAV_ITEM, SUBNAV_OFF, SUBNAV_ON } from "../../components/Page";
import { Button } from "../../components/settings/Form";
import { KNOWN_AVAILABILITY, requestGroup } from "../../lib/personalAssistants";
import { refreshHost, usePa } from "../../lib/personalAssistantStore";
import { formatAbsolute } from "../../lib/time";
import type { PageParams } from "../slots";
import { AssistantDetail } from "./AssistantDetail";
import { DETAIL_TABS, templateFocus, type DetailTab } from "./detailTabs";
import { CreateAssistant } from "./AssistantForm";
import { RequestList } from "./RequestList";
import { paRows, rowKey, usePaHosts, usePaRefresh, type PaHost, type PaRow } from "./paHooks";

type Selection = { kind: "assistant"; key: string } | { kind: "new" } | { kind: "requests" } | null;

export function AssistantsPage({ params }: { params: PageParams }) {
  const { t, locale } = useI18n();
  const hosts = usePaHosts();
  const supported = hosts.filter((h) => h.supported && h.online);
  usePaRefresh(supported);
  const byHost = usePa((s) => s.byHost);
  const rows = useMemo(() => paRows(hosts, byHost, locale), [hosts, byHost, locale]);
  const loaded = supported.every((h) => byHost[h.hostId]?.loadedAt != null || byHost[h.hostId]?.error);
  const fromParams = (): Selection => (params.view === "new" ? { kind: "new" } : params.view === "requests" ? { kind: "requests" } : params.host && params.id ? { kind: "assistant", key: rowKey(String(params.host), String(params.id)) } : null);
  const [selected, setSelected] = useState<Selection>(fromParams);
  const [tab, setTab] = useState<DetailTab>(() => ((DETAIL_TABS as readonly string[]).includes(String(params.tab)) ? (params.tab as DetailTab) : "today"));
  useEffect(() => {
    const next = fromParams();
    if (next) setSelected(next);
  }, [params.view, params.host, params.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opened on a tab (a notice: 定期任务 on one task needing re-confirmation); a later open with other params follows.
  useEffect(() => {
    if ((DETAIL_TABS as readonly string[]).includes(String(params.tab))) setTab(params.tab as DetailTab);
  }, [params.tab, params.template, params.reviewRevision]);
  const review = useMemo(() => templateFocus(params), [params.template, params.review, params.reviewRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing chosen (or the chosen one is gone): one assistant opens directly; else the one waiting for the owner.
  const current = selected?.kind === "assistant" ? rows.find((r) => rowKey(r.hostId, r.assistant.id) === selected.key) : undefined;
  const fallback = rows.find((r) => r.requests.some((q) => requestGroup(q.state) === "decide")) ?? rows[0];
  const shown: Selection = selected?.kind === "assistant" && !current && loaded ? (fallback ? { kind: "assistant", key: rowKey(fallback.hostId, fallback.assistant.id) } : null) : (selected ?? (fallback ? { kind: "assistant", key: rowKey(fallback.hostId, fallback.assistant.id) } : null));
  const row = shown?.kind === "assistant" ? rows.find((r) => rowKey(r.hostId, r.assistant.id) === shown.key) : undefined;
  const empty = loaded && rows.length === 0;
  if (empty && shown?.kind !== "new") {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center p-6" data-pa-empty="">
        <div className="max-w-sm text-center">
          <div className="text-title/[inherit] font-semibold">{t("personal-assistants.empty.title")}</div>
          <p className="mt-1 text-ui/[inherit] text-muted">{t("personal-assistants.empty.hint")}</p>
          <div className="mt-3 flex justify-center">
            <Button primary onClick={() => setSelected({ kind: "new" })}>
              {t("personal-assistants.create")}
            </Button>
          </div>
          <HostNotes hosts={hosts} />
        </div>
      </main>
    );
  }
  const decideAll = rows.reduce((n, r) => n + r.requests.filter((q) => requestGroup(q.state) === "decide").length, 0);
  const readAt = Math.min(...supported.map((h) => byHost[h.hostId]?.loadedAt ?? Infinity));
  return (
    <main className="flex min-w-0 flex-1" data-pa-page="">
      <SubNav>
        <button type="button" onClick={() => setSelected({ kind: "requests" })} className={`press ${SUBNAV_ITEM} ${shown?.kind === "requests" ? SUBNAV_ON : SUBNAV_OFF}`} data-pa-rail="requests">
          <Inbox size={15} className="shrink-0 text-subtle" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{t("personal-assistants.rail.requests")}</span>
            <span className="block truncate text-caption/[inherit] text-subtle">{decideAll ? t("personal-assistants.rail.requestsDecide", { n: decideAll }) : t("personal-assistants.rail.requestsNone")}</span>
          </span>
        </button>
        <button type="button" onClick={() => setSelected({ kind: "new" })} className={`press mb-1 ${SUBNAV_ITEM} ${shown?.kind === "new" ? SUBNAV_ON : SUBNAV_OFF}`} data-pa-rail="new">
          <Plus size={15} className="shrink-0 text-subtle" />
          {t("personal-assistants.create")}
        </button>
        <AssistantRail rows={rows} hosts={hosts} selected={shown?.kind === "assistant" ? shown.key : null} onPick={(key) => setSelected({ kind: "assistant", key })} />
        {!loaded && supported.length > 0 && <div className="px-2 py-1 text-caption/[inherit] text-subtle" role="status">{t("personal-assistants.rail.loading")}</div>}
        <HostNotes hosts={hosts} />
        {Number.isFinite(readAt) && (
          <button type="button" className="press mt-2 w-full rounded-sm px-2 text-left text-caption/[inherit] text-subtle hover:text-foreground" title={t("personal-assistants.refresh")} onClick={() => supported.forEach((h) => void refreshHost(h.hostId))} data-pa-refresh="">
            {t("personal-assistants.refreshed", { at: formatAbsolute(Math.floor(readAt / 1000)) })}
          </button>
        )}
      </SubNav>
      {shown?.kind === "new" ? (
        <CreateAssistant
          key={`new:${params.view === "new" ? (params.host ?? "") : ""}`}
          hosts={hosts}
          initialHost={params.view === "new" && params.host ? String(params.host) : undefined}
          onCreated={(hostId, id) => {
            setSelected({ kind: "assistant", key: rowKey(hostId, id) });
            setTab("today");
          }}
        />
      ) : shown?.kind === "requests" ? (
        <PageBody scrollKey="pa-requests">
          <h2 className="mb-3 text-title/[inherit] font-semibold">{t("personal-assistants.rail.requests")}</h2>
          <RequestList
            rows={rows.flatMap((r) => r.requests.map((request) => ({ hostId: r.hostId, assistant: r.assistant, request })))}
            hosts={hosts}
            showAssistant
            showHost={new Set(rows.map((r) => r.hostId)).size > 1}
            readOnlyHosts={new Set(hosts.filter((h) => !h.online).map((h) => h.hostId))}
          />
        </PageBody>
      ) : row ? (
        <AssistantDetail key={rowKey(row.hostId, row.assistant.id)} row={row} hosts={hosts} refreshKey={byHost[row.hostId]?.loadedAt} tab={tab} onTab={setTab} focus={review && params.host === row.hostId && params.id === row.assistant.id ? review : null} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-subtle" role="status">{t("personal-assistants.rail.loading")}</div>
      )}
    </main>
  );
}

function AssistantRail({ rows, hosts, selected, onPick }: { rows: readonly PaRow[]; hosts: readonly PaHost[]; selected: string | null; onPick(key: string): void }) {
  const { t } = useI18n();
  const multi = new Set(rows.map((r) => r.hostId)).size > 1;
  let lastHost: string | null = null;
  return (
    <>
      {rows.map((r) => {
        const key = rowKey(r.hostId, r.assistant.id);
        const host = hosts.find((h) => h.hostId === r.hostId);
        const decide = r.requests.filter((q) => requestGroup(q.state) === "decide").length;
        const availability = r.view?.availability ?? "provisioning";
        const state = (KNOWN_AVAILABILITY as readonly string[]).includes(availability) ? t(`personal-assistants.availability.${availability}` as MessageKey) : availability;
        const header = multi && r.hostId !== lastHost ? host?.label ?? r.hostId : null;
        lastHost = r.hostId;
        return (
          <div key={key}>
            {header && <div className="px-2 pt-2 pb-1 text-caption/[inherit] font-semibold text-subtle">{header}</div>}
            <button type="button" onClick={() => onPick(key)} className={`press ${SUBNAV_ITEM} ${selected === key ? SUBNAV_ON : SUBNAV_OFF}`} data-pa-rail={key} data-pa-rail-assistant={r.assistant.id}>
              <span className={`size-2 shrink-0 rounded-full ${availability === "ready" ? "bg-ok" : availability === "disabled" ? "bg-subtle/50" : "bg-warn"}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.assistant.config.name}</span>
                <span className="block truncate text-caption/[inherit] text-subtle">{state}</span>
              </span>
              {decide > 0 && <span className="shrink-0 rounded-full bg-attention/15 px-1.5 text-caption/[inherit] font-medium text-attention" data-pa-rail-decide={decide}>{decide}</span>}
            </button>
          </div>
        );
      })}
    </>
  );
}

/** Hosts that could not be read, and connected hosts whose cutex has no assistants yet. */
function HostNotes({ hosts }: { hosts: readonly PaHost[] }) {
  const { t } = useI18n();
  const byHost = usePa((s) => s.byHost);
  const failed = hosts.filter((h) => h.supported && h.online && byHost[h.hostId]?.error);
  const off = hosts.filter((h) => h.online && !h.supported);
  if (!failed.length && !off.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-0.5 px-2 text-caption/[inherit] text-subtle" data-pa-host-notes="">
      {failed.map((h) => (
        <span key={h.hostId} className="text-warn" title={byHost[h.hostId]?.error ?? undefined}>{t("personal-assistants.rail.hostFailed", { host: h.label })}</span>
      ))}
      {off.map((h) => (
        <span key={h.hostId}>{t("personal-assistants.rail.offHost", { host: h.label })}</span>
      ))}
    </div>
  );
}
