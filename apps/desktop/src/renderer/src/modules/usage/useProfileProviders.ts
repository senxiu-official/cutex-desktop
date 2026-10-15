// Every profile on the active host by name (`listProfiles`), for the avatars, colours and logos.
import { useEffect, useState } from "react";
import type { ProfileProviders } from "./provider";
import { useTargetApi } from "../../lib/targetHost";

/** name → profile for every existing profile; undefined while loading, null when the list failed. */
export function useProfileProviders(): ProfileProviders | undefined {
  const api = useTargetApi();
  const [map, setMap] = useState<ProfileProviders | undefined>(undefined);
  useEffect(() => {
    api.listProfiles().then(
      (r) => setMap(new Map((r?.profiles ?? []).map((p) => [p.name, p]))),
      () => setMap(null),
    );
  }, [api]);
  return map;
}
