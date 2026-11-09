// Settings → a host → 配对设备 → 邀请他人: who, which projects, may they talk; the sentence of what that
// gives; then the code. A new person's colour and alias are set later in their row (UserEditor).
import { useMemo, useState } from "react";
import { shownUserName, type UserGrant, type UserRecord } from "../../../../shared/users";
import { useI18n } from "../../i18n";
import { useTargetApi, useTargetSidebar } from "../../lib/targetHost";
import { EMPTY_GRANT, grantChoices, grantSummary, refusalText, sortedUsers, toggleId, USER_NAME_MAX } from "../../lib/userGrants";
import { Checklist } from "./Checklist";
import { Button, ErrorNote, Select, SettingRow, SettingsGroup, TextInput, Toggle } from "./Form";

const NEW_PERSON = "__new__";

export function InvitePanel({ users, busy, onCode }: { users: readonly UserRecord[]; busy: boolean; onCode(userId: string, name: string): Promise<void> }) {
  const { t } = useI18n();
  const tt = (key: string, vars?: Record<string, string | number>) => t(key as never, vars);
  const api = useTargetApi();
  const sidebar = useTargetSidebar();
  const projects = useMemo(() => grantChoices(sidebar).projects, [sidebar]);
  const [who, setWho] = useState(NEW_PERSON);
  const [name, setName] = useState("");
  const [grant, setGrant] = useState<UserGrant>(EMPTY_GRANT);
  const [error, setError] = useState<string | null>(null);
  // A new person created before the code failed: the retry uses them instead of a second person.
  const [created, setCreated] = useState<UserRecord | null>(null);
  const others = sortedUsers(users).filter((u) => !u.isOwner);
  const person = created ?? others.find((u) => u.id === who) ?? null;
  const all = grant.projects === "all";
  const go = async () => {
    setError(null);
    let target = person;
    if (!target) {
      try {
        const made = await api.createUser({ name: name.trim(), grant });
        if (!made.ok) return setError(refusalText(made.error, tt));
        target = made.value.user;
        setCreated(target);
      } catch (e) {
        return setError(t("users.error.other", { message: e instanceof Error ? e.message : String(e) }));
      }
    }
    await onCode(target.id, shownUserName(target));
  };
  const sentence = grantSummary(person ? person.grant : grant, tt, projects);
  return (
    <div className="-mx-4 space-y-1 border-b border-border px-4 py-2.5" data-testid="pair-invite">
      {!created && others.length > 0 && (
        <SettingRow agents="access" source="host" label={t("users.invite.who")}>
          <Select<string> width="w-48" label={t("users.invite.who")} value={who} options={[{ value: NEW_PERSON, label: t("users.invite.newPerson") }, ...others.map((u) => ({ value: u.id, label: shownUserName(u) }))]} onChange={setWho} />
        </SettingRow>
      )}
      {!person && (
        <>
          <SettingRow agents="access" source="host" label={t("users.invite.name")}>
            <TextInput width="w-48" label={t("users.invite.name")} value={name} maxLength={USER_NAME_MAX} placeholder={t("users.addNamePlaceholder")} onChange={setName} />
          </SettingRow>
          <SettingRow agents="access" source="host" label={t("users.grant.allProjects")} hint={t("users.grant.allProjectsHint")}>
            <Toggle checked={all} label={t("users.grant.allProjects")} onChange={(on) => setGrant((g) => ({ ...g, projects: on ? "all" : [] }))} />
          </SettingRow>
          {!all && (
            <SettingsGroup agents="access" source="host"><div className="py-2">
              <div className="mb-1 text-xs text-muted">{t("users.grant.projects")}</div>
              {projects.length ? <Checklist label={t("users.grant.projects")} choices={projects} chosen={grant.projects as string[]} onToggle={(id, on) => setGrant((g) => ({ ...g, projects: toggleId(g.projects === "all" ? [] : g.projects, id, on) }))} /> : <p className="text-xs text-subtle">{t("users.grant.noProjects")}</p>}
            </div></SettingsGroup>
          )}
          <SettingRow agents="access" source="host" label={t("users.invite.talk")} hint={t("users.invite.talkHint")}>
            <Toggle checked={grant.send} label={t("users.invite.talk")} onChange={(send) => setGrant((g) => ({ ...g, send }))} />
          </SettingRow>
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <span className="min-w-0 flex-1 text-sm" data-testid="pair-invite-result">{sentence}</span>
        <SettingsGroup agents="access" source="host"><Button primary disabled={busy || (!person && !name.trim())} onClick={() => void go()}>
          {busy ? t("remote.pair.generating") : t("remote.pair.generate")}
        </Button></SettingsGroup>
      </div>
    </div>
  );
}
