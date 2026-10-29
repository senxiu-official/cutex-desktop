// Every profile on the selected host, for usage identities, avatars and colours.
import { useEffect, useState } from "react";
import { captureHostAction } from "../../lib/hostSwitch";
import type { ProfileProviders } from "./provider";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { accountProfilesForHost, noteAccountProfiles, subscribeAccountProfiles } from "../../lib/profileAccountLinks";

/** name → profile; undefined while loading, null when the list failed. */
export function useProfileProviders(): ProfileProviders | undefined {
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const [state, setState] = useState<{ hostId: string; map: ProfileProviders | undefined }>();
  useEffect(() => {
    let live = true;
    const current = captureHostAction(hostId);
    const initial = accountProfilesForHost(hostId);
    const update = () => {
      const profiles = accountProfilesForHost(hostId);
      if (live) setState({ hostId, map: profiles ? new Map(profiles.map((p) => [p.name, p])) : undefined });
    };
    const unsubscribe = subscribeAccountProfiles(update);
    update();
    void api.listProfiles().then((r) => {
      if (!live || !current()) return;
      // A newer link-state refresh takes precedence over an in-flight old list.
      if (accountProfilesForHost(hostId) !== initial && accountProfilesForHost(hostId) !== undefined) return;
      noteAccountProfiles(hostId, r?.profiles ?? []);
    }, () => { if (live && current() && accountProfilesForHost(hostId) === undefined) setState({ hostId, map: null }); });
    return () => { live = false; unsubscribe(); };
  }, [api, hostId]);
  return state?.hostId === hostId ? state.map : undefined;
}
