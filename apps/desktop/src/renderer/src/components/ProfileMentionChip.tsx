import { Cpu, SlidersHorizontal } from "lucide-react";
import { useI18n } from "../i18n";
import type { ProfileMentionToken } from "../lib/profileMentions";
import { shortProfileRef, useMentionProfile } from "../lib/profileMentionLabel";
import { ProfileAvatar } from "./ProfileAvatar";

/**
 * A labelled configuration reference, visually separate from the avatar/@agent links. A profile shows its name and
 * avatar from `hostId` (the conversation's host); unresolved, a short form of the reference and 「未知 Profile」 once the
 * host's list has been read. The text written and sent stays the reference itself (lib/profileMentionLabel).
 */
export function ProfileMentionChip({ token, hostId }: { token: ProfileMentionToken; hostId?: string | null }) {
  const { t } = useI18n();
  const { profile, settled } = useMentionProfile(hostId, token.profile);
  const unknown = !!token.profile && !profile;
  const name = token.profile ? (profile ? profile.name || shortProfileRef(profile.id) : shortProfileRef(token.profile)) : null;
  const label = [name, token.model, token.effort].filter(Boolean).join(" · ");
  const hover = [name ? (unknown ? `${t("mention.unknownProfile")} · ${name}` : t("mention.profileChip", { name })) : null, token.model, token.effort].filter(Boolean).join(" · ");
  return <span data-profile-mention-chip="" data-profile-mention-state={!token.profile ? "model" : profile ? "resolved" : settled ? "unknown" : "loading"}
    role="img" aria-label={hover} title={hover} className="inline-flex max-w-full items-baseline gap-1 rounded border border-accent/25 bg-accent/10 px-1 text-foreground">
    {profile
      ? <span className="inline-flex size-[1em] flex-none items-center justify-center self-center"><ProfileAvatar profile={profile} size={14} host={hostId ?? undefined} /></span>
      : token.profile ? <SlidersHorizontal size={12} className="shrink-0 self-center" aria-hidden /> : <Cpu size={12} className="shrink-0 self-center" aria-hidden />}
    <span className="min-w-0 truncate">{label}</span>
    {unknown && settled && <span data-profile-mention-unknown="" className="shrink-0 text-subtle">{t("mention.unknownProfile")}</span>}
  </span>;
}
