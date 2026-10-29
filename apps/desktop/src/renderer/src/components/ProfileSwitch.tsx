import { useEffect, useState } from "react";
import type { ProfileItem } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { cachedProfileList, loadProfileList } from "../lib/profileSnapshot";
import { useOrderedProfiles } from "../lib/profileOrder";
import { PROFILE_FAMILY_FEATURE, switchTargets } from "../lib/profileCreate";
import { useModelName } from "../lib/modelDisplay";
import { agentFeaturesOf, isAcpAgent } from "../lib/agentFeatures";
import { isAcpRuntime } from "../lib/acpRuntimes";
import { featuresOf, hostApi, sidebarOf, useApp } from "../store";
import { useConvHost } from "../lib/conversationScope";
import { ProfileAvatar } from "./ProfileAvatar";

/** "Switch profile" list (DESIGN §4.8) at the top of the profile chip's popover. Gated per profile by
 *  cutex; when the current profile can't switch (or has nothing to switch to) the section is not
 *  shown at all. */
export function ProfileSwitch({ profile, sessionId, busy }: { profile: string | null; sessionId: string; busy: boolean }) {
  const { t } = useI18n();
  const modelName = useModelName();
  const hostId = useConvHost();
  const sidebar = useApp((s) => sidebarOf(s, hostId));
  const familyAware = useApp((s) => featuresOf(s, hostId).has(PROFILE_FAMILY_FEATURE));
  // From the cached list (warmed by ProfileQuota), so the section is there in the first paint;
  // refreshed in the background on each open.
  const [listed, setProfiles] = useState<ProfileItem[] | null>(() => cachedProfileList()?.profiles ?? null);
  /** Switch targets in the owner's manual profile order (lib/profileOrder). */
  const profiles = useOrderedProfiles(listed);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    loadProfileList().then((r) => setProfiles(r?.profiles ?? null), () => {});
  }, []);
  if (!profiles) return null;
  const current = profiles.find((p) => p.name === profile);
  const resource = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find(row => row.cutexSessionId === sessionId);
  if (isAcpRuntime(current?.cliKind) || isAcpAgent(agentFeaturesOf(resource)) || !current?.allowSessionSwitch) return null;
  const revision = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === sessionId)?.revision;
  const targets = switchTargets(profile, profiles, familyAware);
  if (targets.length === 0) return null;
  const familyLabel = familyAware ? (current?.providerFamilyLabel ?? current?.providerFamily ?? null) : null;
  const sw = async (target: string) => {
    if (revision === undefined) return;
    setStatus(t("composer.switch.working"));
    try {
      const r = await hostApi(hostId).switchProfile(sessionId, target, busy ? "afterTurn" : "now", revision);
      setStatus(r.status === "scheduled" ? t("composer.switch.scheduled", { to: target }) : t("composer.switch.done", { to: target }));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="border-b border-border pb-2">
      <div className="mb-1 flex items-baseline gap-2 text-xs text-subtle">
        <span>{busy ? t("composer.switch.titleAfterTurn") : t("composer.switch.title")}</span>
        {familyLabel && <span className="ml-auto truncate" title={t("settings.profile.familyHint")}>{t("composer.switch.sameFamily", { label: familyLabel })}</span>}
      </div>
      {targets.map((p) => (
          <button
            key={p.id}
            disabled={!p.allowSessionSwitch}
            title={p.allowSessionSwitch ? undefined : t("composer.switch.targetLocked")}
            onClick={() => void sw(p.name)}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ProfileAvatar profile={p} size={18} />
            <span className="truncate">{p.name}</span>
            <span className="ml-auto truncate text-xs text-subtle">{modelName(p.model, null, p.id)}</span>
          </button>
        ))}
      {status && <p className="mt-1 text-xs text-muted">{status}</p>}
    </div>
  );
}

