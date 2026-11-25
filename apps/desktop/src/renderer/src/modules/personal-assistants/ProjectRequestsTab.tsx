// A project's 助理请求 tab (plan 「桌面接入规格」 5: the project shows the requests for its Director): every request a
// personal assistant made for this project, with the same confirmation card. The project's own host is read. r296
// (owner views): cutex's owner query by {instance, project}, newest first with a state filter, optionally only the
// current Director's term (its session and authority epoch); r295: the requests the page read, filtered here.
import { useCallback, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { Segmented } from "../../components/settings/Form";
import type { PaAssistant, PaRequest } from "../../../../shared/personalAssistants";
import { hostApi } from "../../lib/hostLists";
import { usePa } from "../../lib/personalAssistantStore";
import type { ProjectTabProps } from "../slots";
import { PagedRequests } from "./PagedRequests";
import { RequestList } from "./RequestList";
import { paRows, projectSeat, usePaHosts, usePaRefresh } from "./paHooks";

type Scope = "all" | "director";

export function ProjectRequestsTab({ hostId, projectId }: ProjectTabProps) {
  const { t, locale } = useI18n();
  const hosts = usePaHosts();
  const host = hosts.find((h) => h.hostId === hostId);
  usePaRefresh(host?.supported && host.online ? [host] : []);
  const byHost = usePa((s) => s.byHost);
  const data = byHost[hostId];
  const ownerViews = !!host?.features.ownerViews && !!host.instanceId;
  const rows = useMemo(
    () => (ownerViews ? [] : paRows(hosts.filter((h) => h.hostId === hostId), byHost, locale).flatMap((r) => r.requests.filter((q) => q.projectId === projectId).map((request) => ({ hostId: r.hostId, assistant: r.assistant, request })))),
    [ownerViews, hosts, byHost, locale, hostId, projectId],
  );
  const seat = projectSeat(host, projectId);
  const [scope, setScope] = useState<Scope>("all");
  const instanceId = host?.instanceId ?? "";
  const directorId = scope === "director" ? (seat?.sessionId ?? null) : null;
  const load = useCallback(
    (q: { state?: string; cursor: number | null; limit: number }) =>
      hostApi(hostId).paOwnerRequests({ project: { instanceId, projectId }, ...(directorId && seat ? { directorSessionId: directorId, directorEpoch: seat.epoch } : {}), ...q }),
    [hostId, instanceId, projectId, directorId, seat?.epoch], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const assistants = data?.assistants;
  const assistantFor = useCallback(
    (r: PaRequest): PaAssistant =>
      assistants?.find((a) => a.id === r.assistantId) ?? {
        // Not read here yet (made since the last read): its card still reads the request by id.
        id: r.assistantId, revision: r.assistantRevision, enabled: true, sessionId: null, coordinationProjectId: "",
        grants: { tier: "coordinator", operations: [], fullOwner: false },
        config: { name: t("personal-assistants.projectTab.unknownAssistant", { id: r.assistantId.slice(0, 10) }), profile: "", homeInstanceId: instanceId, projectIds: [] },
      },
    [assistants, instanceId, t],
  );
  const tick = usePa((s) => Object.values(s.byHost[hostId]?.ticks ?? {}).reduce((n, x) => n + (x.requests ?? 0), 0));
  if (ownerViews) {
    return (
      <div data-pa-project-tab="" data-pa-project-scope={scope}>
        <PagedRequests
          key={`${scope}\n${directorId ?? ""}`}
          hostId={hostId}
          host={host}
          load={load}
          assistantFor={assistantFor}
          refreshKey={tick}
          showAssistant
          readOnly={!host?.online}
          tools={
            seat?.sessionId ? (
              <Segmented
                value={scope}
                label={t("personal-assistants.projectTab.scopeLabel")}
                onChange={setScope}
                options={[
                  { value: "all", label: t("personal-assistants.projectTab.scope.all") },
                  { value: "director", label: t("personal-assistants.projectTab.scope.director") },
                ]}
              />
            ) : null
          }
        />
      </div>
    );
  }
  return (
    <div data-pa-project-tab="">
      {rows.length === 0 && data?.loadedAt != null ? (
        <div className="py-3 text-ui/[inherit] text-subtle">{t("personal-assistants.projectTab.none")}</div>
      ) : (
        <RequestList rows={rows} hosts={hosts} showAssistant showHost={false} readOnlyHosts={new Set(host?.online ? [] : [hostId])} />
      )}
    </div>
  );
}
