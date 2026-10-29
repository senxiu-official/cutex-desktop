// Who you are on the focus host, for the sidebar's identity button (components/IdentityMenu) and the
// desktop's profile card: name, role, picture and initials color. Kept out of components/*.tsx (Fast
// Refresh). Name / picture are 「你」 (lib/identityPrefs), else what your hosts have for you (the most
// recently changed across connected hosts, lib/identityHosts), else the OS account name / initials.
import { useEffect, useState } from "react";
import type { ShellState } from "../../../shared/ipc";
import { USERS_FEATURE, USERS_SELF_PROFILE_FEATURE } from "../../../shared/users";
import { api, bridge } from "../bridge";
import { useI18n } from "../i18n";
import { useHostAccess } from "./hostAccess";
import { identityName, identityRole, roleWords, type IdentityRole, type RoleWordKey } from "./identity";
import { useAdoptedIdentity } from "./identityHosts";
import { useIdentityPrefs } from "./identityPrefs";
import { projectColor } from "./sidebar";
import { useUserAvatar } from "./userAvatars";
import { useApp } from "../store";

/** Initials background when no cutex user color is known (white text reads on it in both themes). */
const NEUTRAL = "#868e96";

let shellInfo: Pick<ShellState, "osUserName" | "quickstart"> | null = null;
/** OS account name + whether a local QUICKSTART exists (main; read once per run). */
export function useShellInfo() {
  const [info, setInfo] = useState(shellInfo);
  useEffect(() => {
    if (shellInfo || !bridge.shell) return;
    bridge.shell.state().then((s) => setInfo((shellInfo = { osUserName: s.osUserName ?? null, quickstart: s.quickstart === true })), () => {});
  }, []);
  return info;
}

const ownerColors = new Map<string, string | null>();
/** The owner user's cutex color on a host (`GET /v2/users`, owner only; cached per host for the run). */
function useOwnerColor(hostId: string, read: boolean): string | null {
  const [color, setColor] = useState(() => ownerColors.get(hostId) ?? null);
  useEffect(() => {
    setColor(ownerColors.get(hostId) ?? null);
    if (!read || ownerColors.has(hostId)) return;
    let live = true;
    api.users().then(
      (list) => {
        const c = list?.users.find((u) => u.isOwner)?.color ?? null;
        ownerColors.set(hostId, c);
        if (live) setColor(c);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [hostId, read]);
  return read ? color : null;
}

export interface Identity {
  name: string;
  role: IdentityRole;
  /** The role in words (header line) and the button's suffix (only 只读 / 等主人分配). */
  words: { line: RoleWordKey; suffix: RoleWordKey | null };
  picture: string | null;
  color: string;
}

export function useIdentity(): Identity {
  const { t } = useI18n();
  const hostId = useApp((s) => s.hosts?.active ?? "local");
  const connected = useApp((s) => s.daemon.kind === "connected");
  const hasUsers = useApp((s) => s.features.has(USERS_FEATURE));
  const selfProfile = useApp((s) => s.features.has(USERS_SELF_PROFILE_FEATURE));
  const access = useHostAccess(hostId);
  const prefs = useIdentityPrefs();
  const shell = useShellInfo();
  const role = identityRole(access);
  const color = useOwnerColor(hostId, connected && hasUsers && role === "owner");
  const adopted = useAdoptedIdentity(hostId);
  const hostPicture = useUserAvatar(adopted.picture?.hostId, prefs.picture ? null : adopted.picture?.userId, adopted.picture?.etag);
  return {
    name: identityName(access, prefs.name, shell?.osUserName, selfProfile, adopted.name) ?? t("identity.you"),
    role,
    words: roleWords(access),
    picture: prefs.picture ?? hostPicture,
    color: color ? projectColor(color) : NEUTRAL,
  };
}

