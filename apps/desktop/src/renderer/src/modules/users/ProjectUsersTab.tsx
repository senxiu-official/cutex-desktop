// 项目页 → 可见用户 (`project.tab`): which users of the project's host see this project. Every non-owner
// user with a switch: on = the project id is in that user's `grant.projects`. A switch writes that user's
// whole grant (`PATCH /v2/users/{id}`, as Settings → 用户's grant editor does) with only this project id
// added or removed (model grantWithProject). A user granted 全部项目 shows on and locked; that, the
// standalone agents and send are changed in Settings → 用户 (linked). Owner connections only: the
// module needs `users`, which a non-owner connection's feature set never has; checked here again.
import { useState } from "react";
import { isOwnerFeatures, shownUserName, type UserGrant, type UserRecord } from "../../../../shared/users";
import { ErrorNote, ListRow, Loading, RefreshButton, Section, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { setSettingsHost } from "../../lib/settingsHost";
import { TargetHostContext, useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useApp } from "../../store";
import type { ProjectTabProps } from "../slots";
import { message, useUsers } from "./hooks";
import { USERS_ANCHOR } from "./shared";
import { grantWithProject, projectAccess, refusalText, shownGrant, sortedUsers } from "./model";
import { UserDot } from "./UserDot";

export function ProjectUsersTab({ hostId, projectId }: ProjectTabProps) {
  return (
    <TargetHostContext.Provider value={hostId}>
      <ProjectUsers projectId={projectId} />
    </TargetHostContext.Provider>
  );
}

/** Settings → 用户 → 用户 list on the project's host (the settings host picker; reset when Settings closes). */
function useOpenUsersSettings() {
  const hostId = useTargetHostId();
  return () => {
    if (hostId !== (useApp.getState().hosts?.active ?? "local")) setSettingsHost(hostId);
    useApp.getState().openSettings("access", { anchor: USERS_ANCHOR });
  };
}

function SettingsLink({ children }: { children: React.ReactNode }) {
  const open = useOpenUsersSettings();
  return (
    <button onClick={open} className="text-accent hover:underline" data-testid="project-users-settings">
      {children}
    </button>
  );
}

function ProjectUsers({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const owner = isOwnerFeatures(useTargetFeatures());
  const { list, unsupported, error, load } = useUsers();
  /** Users whose write is in flight (their switch is disabled until the listing is read again). */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  /** Inline errors by user id. */
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  /** Each user's grant as the last write returned it, until the listing has that revision. */
  const [fresh, setFresh] = useState<ReadonlyMap<string, { grant: UserGrant | null; revision: number }>>(new Map());
  if (!owner || unsupported) return null;
  const title = t("users.project.title");
  if (error && !list) return <Section title={title}><ErrorNote>{error}</ErrorNote></Section>;
  if (!list) return <Section title={title}><Loading rows={2} /></Section>;
  const users = sortedUsers(list.users).filter((u) => !u.isOwner);

  const setError = (userId: string, text: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (text) next[userId] = text;
      else delete next[userId];
      return next;
    });
  const toggle = async (user: UserRecord, on: boolean) => {
    // One user's grant is one record: a switch is locked while its write runs; other users' writes are independent.
    if (pending.has(user.id)) return;
    setPending((p) => new Set(p).add(user.id));
    setError(user.id, null);
    try {
      const grant = grantWithProject(shownGrant(user, list.revision, fresh), projectId, on);
      const r = await api.patchUser(user.id, { grant });
      if (r.ok) setFresh((f) => new Map(f).set(user.id, { grant: r.value.user.grant, revision: r.value.revision }));
      else setError(user.id, refusalText(r.error, (key, vars) => t(key as never, vars), shownUserName(user)));
    } catch (e) {
      setError(user.id, t("users.error.other", { message: message(e) }));
    }
    // Read the listing again (another write may have moved it too), then unlock.
    await load();
    setPending((p) => {
      const next = new Set(p);
      next.delete(user.id);
      return next;
    });
  };

  return (
    <Section title={title} hint={t("users.project.hint")} actions={<RefreshButton label={t("users.refresh")} onClick={() => void load()} />}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {users.length === 0 && (
        <p className="py-2 text-xs text-subtle" data-testid="project-users-empty">
          {t("users.project.none")} <SettingsLink>{t("users.project.openSettings")}</SettingsLink>
        </p>
      )}
      {users.map((user) => {
        const access = projectAccess(shownGrant(user, list.revision, fresh), projectId);
        const busy = pending.has(user.id);
        const name = shownUserName(user);
        return (
          <ListRow
            key={user.id}
            leading={<UserDot user={user} />}
            title={name}
            detail={
              access === "all" ? (
                <span>
                  {t("users.summary.all")} · <SettingsLink>{t("users.project.changeInSettings")}</SettingsLink>
                </span>
              ) : (
                t(user.grant?.send ? "users.summary.send" : "users.summary.readOnly")
              )
            }
            below={errors[user.id] ? <div className="mt-1"><ErrorNote>{errors[user.id]}</ErrorNote></div> : undefined}
            actions={
              <span title={access === "all" ? t("users.project.allHint") : undefined} data-testid={`project-user-${user.id}`}>
                <Toggle checked={access !== "none"} disabled={busy || access === "all"} label={t("users.project.toggle", { name })} onChange={(on) => void toggle(user, on)} />
              </span>
            }
          />
        );
      })}
    </Section>
  );
}
