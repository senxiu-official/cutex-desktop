// A user's dot (Settings → 用户, 项目页 → 可见用户): the picture that user set on their own desktop
// (users-self-profile), else initials on the user's colour. The target host's users.
import { shownUserName, type UserRecord } from "../../../../shared/users";
import { Avatar } from "../../components/Avatar";
import { identityInitials } from "../../lib/identity";
import { projectColor } from "../../lib/sidebar";
import { useTargetHostId } from "../../lib/targetHost";
import { useUserAvatar } from "../../lib/userAvatars";

export function UserDot({ user }: { user: Pick<UserRecord, "id" | "color" | "name" | "displayName" | "avatarEtag"> }) {
  const hostId = useTargetHostId();
  const picture = useUserAvatar(hostId, user.id, user.avatarEtag);
  const name = shownUserName(user);
  return <Avatar name={name} initial={identityInitials(name)} color={user.color ? projectColor(user.color) : "#868e96"} picture={picture} size={24} />;
}
