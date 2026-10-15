// New agent → 「添加 Profile…」 / 「管理 Profile」 (review UI-04): the form leaves for Settings → Profiles
// on its target host and keeps its draft here (memory only, one at a time); Settings → Profiles offers
// 「返回新建」 while one is kept, and the new-agent page picks it up again when it opens next.
import { create } from "zustand";
import type { PageParams } from "../modules/slots";

/** A kept new-agent draft: the page it came from and the form's own fields (opaque here). */
export interface NewAgentReturn {
  hostId: string;
  params: PageParams;
  form: unknown;
  /** A profile created in Settings meanwhile (its id): the form picks it when it comes back. */
  createdProfile?: string;
}

const useStore = create<{ kept: NewAgentReturn | null }>(() => ({ kept: null }));

/** Keep the form's draft while the owner adds / manages profiles. */
export function keepNewAgentDraft(draft: NewAgentReturn): void {
  useStore.setState({ kept: draft });
}

/** The kept draft, if any (not consumed: the page drops it once it has restored it). */
export function keptNewAgentDraft(): NewAgentReturn | null {
  return useStore.getState().kept;
}

/** Settings → Profiles created `profileId` on `hostId` while a draft for that host waits. */
export function noteNewAgentProfile(hostId: string, profileId: string): void {
  const kept = useStore.getState().kept;
  if (kept && kept.hostId === hostId) useStore.setState({ kept: { ...kept, createdProfile: profileId } });
}

export function dropNewAgentDraft(): void {
  if (useStore.getState().kept) useStore.setState({ kept: null });
}

/** Hook: the kept draft (Settings → Profiles shows 「返回新建」 while there is one). */
export function useKeptNewAgentDraft(): NewAgentReturn | null {
  return useStore((s) => s.kept);
}

/** A kept draft fits a new-agent page opened with `params` unless that page presets another project / host. */
export function draftFits(kept: NewAgentReturn, params: PageParams): boolean {
  if (params.project && params.project !== kept.params.project) return false;
  if (params.host && params.host !== kept.hostId) return false;
  return true;
}
