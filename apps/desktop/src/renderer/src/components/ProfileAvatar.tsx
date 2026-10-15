// A profile's round avatar: its picture (lib/profileAvatar), else the name's initial on the profile
// colour. `badge` adds the provider logo as a small corner mark, so the provider reads as a detail
// of the profile and never as its face.
import type { ProfileItem } from "../../../shared/ipc";
import { useProfileAvatar } from "../lib/profileAvatar";
import { inkOn, profileColor } from "../lib/profileLook";
import { profileProvider } from "../lib/provider";
import { ProviderIcon } from "./ProviderIcon";

export type AvatarProfile = Pick<ProfileItem, "id" | "name" | "authKind" | "cliKind" | "baseUrl" | "appearance">;

export function ProfileAvatar({ profile, size = 28, badge = false, picture, color }: {
  profile: AvatarProfile;
  size?: number;
  badge?: boolean;
  /** Unsaved edits (the 外观 section previews them): a picture (null = removed) and a colour. */
  picture?: string | null;
  color?: string;
}) {
  const stored = useProfileAvatar(profile.id);
  const shown = picture !== undefined ? picture : stored;
  const bg = color ?? profileColor(profile);
  const provider = badge ? profileProvider(profile) : null;
  const mark = Math.max(12, Math.round(size * 0.42));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      {shown ? (
        <img src={shown} alt="" draggable={false} className="h-full w-full rounded-full object-cover" />
      ) : (
        <span
          className="flex h-full w-full select-none items-center justify-center rounded-full font-semibold"
          style={{ background: bg, color: inkOn(bg), fontSize: size * 0.46 }}
        >
          {/* trim-cap: the letter's caps band is what gets centred, not the font's line box. */}
          <span className="trim-cap">{[...profile.name.trim()][0]?.toUpperCase() ?? "?"}</span>
        </span>
      )}
      {provider && (
        <span
          className="absolute flex items-center justify-center rounded-full bg-surface"
          style={{ width: mark, height: mark, right: -mark * 0.18, bottom: -mark * 0.18, boxShadow: "0 0 0 1.5px var(--surface)" }}
        >
          <ProviderIcon provider={provider} name={profile.name} size={Math.round(mark * 0.78)} />
        </span>
      )}
    </span>
  );
}
