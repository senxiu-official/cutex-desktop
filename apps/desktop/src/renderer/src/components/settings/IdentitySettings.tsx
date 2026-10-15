// Settings → 用户 (shell page): 你在这台主机上 (components/settings/MeOnHost) for every connection, then on a
// host this device owns the users module's sections (`settings.section` page "users": users and grants,
// devices, linked hosts); on any other connection 你的设备 and a note that the rest is the owner's. 「你」 — your name and picture, set on
// this desktop (lib/identityPrefs) and published to every connected host with cutex
// `users-self-profile` (lib/identitySync), plus your person identity (P2: fingerprint, export / import,
// lib/personIdentity) — is its own local page, Settings → 你 (components/settings/MeSettings.tsx).
import { useEffect, useRef, useState } from "react";
import { USERS_SELF_PROFILE_FEATURE } from "../../../../shared/users";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import { avatarSourceProblem } from "../../lib/agentPicture";
import { useHostAccess, useNonOwnerHosts } from "../../lib/hostAccess";
import { syncSummary } from "../../lib/identityPublish";
import { useIdentitySyncStatus } from "../../lib/identitySync";
import { identityInitials, identityName } from "../../lib/identity";
import { IDENTITY_NAME_MAX, setIdentityPrefs, useIdentityPrefs } from "../../lib/identityPrefs";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";
import { useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useUserAvatar } from "../../lib/userAvatars";
import { useHostScope } from "../../lib/useHostScope";
import { SettingsSections } from "../../modules/Outlet";
import { Avatar } from "../Avatar";
import { Button, ErrorNote, Notice, Section, SettingRow, TextInput } from "./Form";
import { MeHereSection, OwnDevicesSection } from "./MeOnHost";
import { PersonIdentityRows } from "./PersonIdentityRows";
import { ProfilePictureCrop } from "./ProfilePictureCrop";

/**
 * Settings → 用户: 你在这台主机上 for every connection; then on a host this device owns the users module's
 * sections (users and grants, devices, linked hosts), on any other connection 你的设备 (cutex
 * `user-own-devices`) and a note that users, grants and other devices are the owner's.
 */
export function UsersHubPage() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const access = useHostAccess(hostId);
  const scope = useHostScope();
  const host = scope.host(hostId)?.label ?? hostId;
  // openSettings("users", { anchor: "users-peers" }) from 互联 / 可见用户.
  useScrollToSettingsAnchor();
  return (
    <>
      <MeHereSection hostId={hostId} />
      {access.isOwner ? (
        <SettingsSections page="users" />
      ) : (
        <>
          {!access.pending && <OwnDevicesSection hostId={hostId} />}
          <Notice tone="info">{access.pending ? t("users.access.pendingSettings", { host }) : t("users.manageNotice")}</Notice>
        </>
      )}
    </>
  );
}

export function IdentitySection() {
  const { t } = useI18n();
  const prefs = useIdentityPrefs();
  const [osName, setOsName] = useState<string | null>(null);
  const [draft, setDraft] = useState(prefs.name);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    bridge.shell?.state().then((s) => setOsName(s.osUserName ?? null), () => {});
  }, []);
  useEffect(() => setDraft(prefs.name), [prefs.name]);
  // The preview is you as the page's host shows you: without a local name / picture, what that host
  // has (set from another desktop of yours), like the sidebar's identity button.
  const hostId = useTargetHostId();
  const access = useHostAccess(hostId);
  const selfProfile = useTargetFeatures().has(USERS_SELF_PROFILE_FEATURE);
  const hostPicture = useUserAvatar(hostId, selfProfile && !prefs.picture ? access.userId : null, access.avatarEtag);
  const shown = identityName(access, draft, osName, selfProfile) || t("identity.you");
  const commit = () => draft.trim() !== prefs.name && setIdentityPrefs({ name: draft.trim() });
  // One summary line of what others see (lib/identityPublish syncSummary), not a 「未设置」 per host.
  const statuses = useIdentitySyncStatus();
  const allAccess = useNonOwnerHosts();
  const scope = useHostScope();
  const summary = syncSummary({ statuses, prefs, access: allAccess, hostName: (id) => scope.host(id)?.label ?? id });
  return (
    <Section id={settingsAnchorId("identity")} title={t("identity.section")} hint={t("identity.sectionHint")}>
      <div className="flex items-center gap-3 py-3">
        <Avatar name={shown} initial={identityInitials(shown)} color="#868e96" picture={prefs.picture ?? hostPicture} size={44} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" data-testid="identity-shown-name">{shown}</div>
          {summary && (
            <div className={`truncate text-xs ${summary.key === "me.access.sync.syncedFailed" || summary.key === "me.access.sync.failed" ? "text-danger" : "text-subtle"}`} title={summary.error} data-testid="identity-sync-summary">
              {t(summary.key, summary.vars)}
            </div>
          )}
        </div>
      </div>
      <SettingRow label={t("identity.name")} hint={t("identity.nameHint")}>
        <TextInput
          value={draft}
          placeholder={t("identity.namePlaceholder")}
          maxLength={IDENTITY_NAME_MAX}
          label={t("identity.name")}
          onChange={setDraft}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      </SettingRow>
      <SettingRow label={t("identity.picture")} hint={t("identity.picture.hint")}>
        <span className="flex items-center gap-2">
          <Button onClick={() => (setFileError(null), fileInput.current?.click())}>{t(prefs.picture ? "identity.picture.replace" : "identity.picture.upload")}</Button>
          {prefs.picture && <Button onClick={() => setIdentityPrefs({ picture: null })}>{t("identity.picture.remove")}</Button>}
        </span>
      </SettingRow>
      {fileError && <ErrorNote>{fileError}</ErrorNote>}
      <PersonIdentityRows />
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        className="hidden"
        aria-label={t("identity.picture.upload")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const problem = avatarSourceProblem(file);
          setFileError(problem ? t(problem === "type" ? "info.avatar.badType" : "info.avatar.tooLarge", { name: file.name }) : null);
          if (!problem) setCropFile(file);
        }}
      />
      {cropFile && (
        <ProfilePictureCrop
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={(picture) => {
            setIdentityPrefs({ picture });
            setCropFile(null);
          }}
        />
      )}
    </Section>
  );
}
