// One assistant (plan 「桌面接入规格」 1, 3–5): its name, host and state with what the state means, 打开对话 (the
// assistant is an ordinary cutex session, opened by session id, never by name), 停用 / 恢复, and the tabs 今日 · 请求
// · 定期任务 (r296 recurring) · 笔记 (r296 owner views) · 设置 · 权限 · 历史. A disabled assistant or one whose session
// is gone keeps its settings and history. An offline host: everything stays readable, writes are disabled (drafts kept
// by the forms). Shown from an r296 list row, its detail (overlaps, exact capabilities) is read once on open.
import { useCallback, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { ArmedButton } from "../../components/ArmedButton";
import { btnFace, btnShape } from "../../components/Button";
import { PageBody } from "../../components/Page";
import { Button } from "../../components/settings/Form";
import { Tag } from "../../components/Tag";
import { openHostAgent } from "../../lib/hostLists";
import { KNOWN_AVAILABILITY, requestGroup } from "../../lib/personalAssistants";
import { hostApi } from "../../lib/hostLists";
import { ensureDetail, updateAssistant } from "../../lib/personalAssistantStore";
import { AgendaCard } from "./AgendaCard";
import { AssistantSettings } from "./AssistantForm";
import { AuditList } from "./AuditList";
import { GrantsCard } from "./GrantsCard";
import { NotesList } from "./NotesList";
import { PagedRequests } from "./PagedRequests";
import { RequestList } from "./RequestList";
import { TemplatesCard } from "./TemplatesCard";
import { paErrorText, usePaTick, type PaHost, type PaRow } from "./paHooks";
import { DETAIL_TABS, type DetailTab, type TemplateFocus } from "./detailTabs";

export function AssistantDetail({ row, hosts, refreshKey, tab, onTab, focus = null }: { row: PaRow; hosts: readonly PaHost[]; refreshKey: unknown; tab: DetailTab; onTab(tab: DetailTab): void; /** A 定期任务 to show first (an owner notice). */ focus?: TemplateFocus | null }) {
  const { t } = useI18n();
  const { hostId, assistant: a, view, requests } = row;
  const host = hosts.find((h) => h.hostId === hostId);
  const readOnly = !host?.online;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRequest, setOpenRequest] = useState<string | null>(null);
  const features = host?.features;
  const tabs = DETAIL_TABS.filter((id) => (id === "templates" ? !!features?.recurring : id === "notes" ? !!features?.ownerViews : true));
  const shownTab: DetailTab = tabs.includes(tab) ? tab : "today";
  const fromList = !!view?.fromList;
  useEffect(() => {
    if (fromList && host?.online) void ensureDetail(hostId, a.id).catch(() => {});
  }, [fromList, host?.online, hostId, a.id]);
  const agendaTick = usePaTick(hostId, a.id, "requests", "calendar", "assistant");
  const requestsTick = usePaTick(hostId, a.id, "requests");
  const historyTick = usePaTick(hostId, a.id, "audit");
  const loadRequests = useCallback((q: { state?: string; cursor: number | null; limit: number }) => hostApi(hostId).paRequests(a.id, q), [hostId, a.id]);
  const openFrom = (id: string) => {
    setOpenRequest(id);
    onTab("requests");
  };
  const availability = view?.availability ?? "provisioning";
  const known = (KNOWN_AVAILABILITY as readonly string[]).includes(availability);
  const decide = requests.filter((r) => requestGroup(r.state) === "decide").length;
  const open = requests.filter((r) => requestGroup(r.state) === "open").length;
  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await updateAssistant(hostId, a, { kind: "enabled", enabled });
    } catch (e) {
      setError(paErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const tone = availability === "ready" ? "ok" : availability === "disabled" ? "neutral" : "attention";
  return (
    <PageBody scrollKey={`${hostId}\n${a.id}`}>
      <header className="mb-3" data-pa-detail={a.id}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-title/[inherit] font-semibold">{a.config.name}</h2>
          <Tag tone={tone} data-pa-availability={availability}>{known ? t(`personal-assistants.availability.${availability}` as MessageKey) : availability}</Tag>
          {decide > 0 && <Tag tone="attention">{t("personal-assistants.deskDecide", { n: decide })}</Tag>}
          {open > 0 && <Tag tone="accent">{t("personal-assistants.deskOpen", { n: open })}</Tag>}
          <span className="flex-1" />
          {a.enabled ? (
            <ArmedButton shape={btnShape()} idle={btnFace({ variant: "secondary" })} hint={t("personal-assistants.disableHint")} disabled={readOnly || busy} onConfirm={() => void setEnabled(false)} testId="pa-disable">
              {t("personal-assistants.disable")}
            </ArmedButton>
          ) : (
            <Button disabled={readOnly || busy} onClick={() => void setEnabled(true)}>{t("personal-assistants.enable")}</Button>
          )}
          <Button primary disabled={!a.sessionId} onClick={() => a.sessionId && void openHostAgent(hostId, a.sessionId)}>
            <MessageSquare size={13} className="mr-1 inline" />
            {t("personal-assistants.open")}
          </Button>
        </div>
        <div className="mt-1 text-caption/[inherit] text-subtle">
          {[host?.label ?? hostId, a.config.projectIds.length ? t("personal-assistants.projectsCount", { n: a.config.projectIds.length }) : t("personal-assistants.projectsNone")].join(" · ")}
        </div>
        <div className="mt-0.5 text-caption/[inherit] text-muted" data-pa-availability-hint="">
          {known ? t(`personal-assistants.availabilityHint.${availability}` as MessageKey) : t("personal-assistants.availabilityHint.unknown", { state: availability })}
        </div>
        {readOnly && <div className="mt-1 text-caption/[inherit] text-warn" data-pa-readonly="">{t("personal-assistants.offline", { host: host?.label ?? hostId })}</div>}
        {error && <div className="mt-1 text-caption/[inherit] text-danger" role="alert">{error}</div>}
      </header>
      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]" role="tablist" data-pa-tabs="">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={shownTab === id}
            className={`press -mb-px shrink-0 border-b-2 px-2.5 py-1.5 text-ui/[inherit] whitespace-nowrap ${shownTab === id ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            onClick={() => onTab(id)}
            data-pa-tab={id}
          >
            {t(`personal-assistants.tab.${id}` as MessageKey)}
            {id === "requests" && decide > 0 && <span className="ml-1 text-attention">{decide}</span>}
          </button>
        ))}
      </div>
      {!view ? (
        <div className="text-ui/[inherit] text-subtle" role="status">{t("personal-assistants.rail.loading")}</div>
      ) : shownTab === "today" ? (
        <AgendaCard hostId={hostId} view={view} host={host} refreshKey={`${String(refreshKey)}\n${agendaTick}`} readOnly={readOnly} onOpenRequest={openFrom} />
      ) : shownTab === "requests" ? (
        features?.ownerViews ? (
          <PagedRequests key={openRequest ?? ""} hostId={hostId} host={host} load={loadRequests} assistantFor={() => a} refreshKey={requestsTick} showAssistant={false} readOnly={readOnly} initialOpen={openRequest} />
        ) : (
          <RequestList key={openRequest ?? ""} rows={requests.map((request) => ({ hostId, assistant: a, request }))} hosts={hosts} showAssistant={false} showHost={false} readOnlyHosts={new Set(readOnly ? [hostId] : [])} initialOpen={openRequest} />
        )
      ) : shownTab === "templates" ? (
        <TemplatesCard hostId={hostId} assistant={a} host={host} readOnly={readOnly} onOpenRequest={openFrom} focus={focus} />
      ) : shownTab === "notes" ? (
        <NotesList hostId={hostId} assistantId={a.id} />
      ) : shownTab === "settings" ? (
        <AssistantSettings hostId={hostId} view={view} hosts={hosts} readOnly={readOnly} />
      ) : shownTab === "grants" ? (
        <GrantsCard hostId={hostId} hostLabel={host?.label ?? hostId} view={view} readOnly={readOnly} />
      ) : (
        <AuditList hostId={hostId} assistantId={a.id} host={host} refreshKey={`${String(refreshKey)}\n${historyTick}`} />
      )}
    </PageBody>
  );
}
