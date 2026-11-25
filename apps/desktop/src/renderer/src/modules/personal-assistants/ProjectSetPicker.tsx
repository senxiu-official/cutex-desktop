// 项目范围 picker: every paired host's projects, grouped by host, the assistant's home first (owner 2026-11-25: an
// assistant is cross-host; project references are {instance, project}). A host whose projects the home cannot take yet
// (r295: only the home's own) is listed greyed with a short note; an offline host says so. Values are PaProjectRef.
import { useI18n } from "../../i18n";
import { Checkbox } from "../../components/settings/Form";
import { refKey, type PaProjectRef } from "../../lib/personalAssistants";
import { sessionName, type PaHost } from "./paHooks";

export function ProjectSetPicker({ hosts, homeHostId, remoteOk, value, onChange, disabled }: { hosts: readonly PaHost[]; homeHostId: string; /** The home takes projects of other hosts (r296 projectRefs). */ remoteOk: boolean; value: readonly PaProjectRef[]; onChange(next: PaProjectRef[]): void; disabled?: boolean }) {
  const { t } = useI18n();
  const chosen = new Set(value.map(refKey));
  const ordered = [...hosts.filter((h) => h.hostId === homeHostId), ...hosts.filter((h) => h.hostId !== homeHostId)];
  const toggle = (ref: PaProjectRef, on: boolean) => onChange(on ? [...value.filter((r) => refKey(r) !== refKey(ref)), ref] : value.filter((r) => refKey(r) !== refKey(ref)));
  return (
    <div className="flex w-full min-w-0 max-w-xl flex-col gap-2" data-pa-project-picker="">
      {ordered.map((h) => {
        const home = h.hostId === homeHostId;
        const usable = (home || remoteOk) && h.online && !!h.instanceId;
        const note = !home && !remoteOk ? t("personal-assistants.form.remoteHost", { host: h.label }) : !h.online ? t("personal-assistants.form.remoteOffline", { host: h.label }) : h.label;
        return (
          <div key={h.hostId} className={usable ? "" : "opacity-55"} data-pa-picker-host={h.hostId} data-pa-picker-usable={usable ? "" : undefined}>
            <div className="mb-1 flex items-center gap-1.5 text-caption/[inherit] font-semibold text-subtle">
              {h.look && <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: h.look.color }} aria-hidden />}
              <span className="truncate">{note}</span>
            </div>
            {h.projects.length === 0 ? (
              <div className="pl-3.5 text-caption/[inherit] text-subtle">{t("personal-assistants.form.projectsEmpty")}</div>
            ) : (
              <ul className="flex flex-col gap-0.5 pl-1">
                {h.projects.map((p) => {
                  const ref = { instanceId: h.instanceId ?? `host:${h.hostId}`, projectId: p.project_id };
                  const on = chosen.has(refKey(ref));
                  const director = sessionName(h, p.director_cutex_session_id ?? null) ?? p.director_name ?? null;
                  return (
                    <li key={p.project_id} className="flex min-w-0 items-center gap-2" data-pa-picker-project={p.project_id}>
                      <Checkbox checked={on} disabled={disabled || (!usable && !on)} onChange={(v) => toggle(ref, v)} label={p.presentation.display_name} />
                      <span className="min-w-0 truncate text-ui/[inherit]">{p.presentation.display_name}</span>
                      <span className="shrink-0 truncate text-caption/[inherit] text-subtle">{director ?? t("personal-assistants.form.noDirector")}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
