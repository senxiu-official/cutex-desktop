import { useEffect, useState } from "react";
import type { ProfileItem } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { noticeShown, SYNCED_NOTICE_MS, useProfileLinkAppearance, type AppearanceNotice } from "../lib/profileLinkAppearance";
import { useProfileAccountLinks } from "../lib/profileAccountLinks";

/** The notice to show now: a 已同步 one disappears SYNCED_NOTICE_MS after the sync (owner 2026-10-25), the rest stay. */
export function useShownNotice<N extends AppearanceNotice>(notice: N | undefined | null): N | null {
  const [, tick] = useState(0);
  const shown = noticeShown(notice);
  useEffect(() => {
    if (!shown || notice?.kind !== "synced") return;
    const timer = setTimeout(() => tick((n) => n + 1), SYNCED_NOTICE_MS + 50);
    return () => clearTimeout(timer);
  }, [shown, notice?.id, notice?.kind]);
  return shown ? notice! : null;
}

/** Compact conflict/pending row on the overview card; opening the editor is optional. A 已同步 note only briefly. */
export function ProfileLinkedAppearance({ hostId, profile }: { hostId: string; profile: ProfileItem }) {
  const { self, peers } = useProfileAccountLinks(hostId, profile);
  if (!self?.profile.link || !peers.length) return null;
  return <LinkedAppearanceBody hostId={hostId} profile={self.profile} />;
}
function LinkedAppearanceBody({ hostId, profile }: { hostId: string; profile: ProfileItem }) {
  const { t } = useI18n();
  const state = useProfileLinkAppearance(hostId, profile);
  const notice = useShownNotice(state.notice);
  if (!state.linked || (!state.conflict && !notice)) return null;
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    {state.conflict ? <>
      <span>{t("settings.profile.link.appearance.conflict")}</span>
      {state.choices.map((source) => <button key={`${source.hostId}/${source.profile.id}`} disabled={state.busy} className="rounded px-1.5 py-1 text-accent hover:bg-surface-2 disabled:opacity-40" onClick={() => void state.choose(source)}>{t("settings.profile.link.appearance.useSource", { host: source.hostName })}</button>)}
      <button disabled={state.busy} className="rounded px-1.5 py-1 hover:bg-surface-2" onClick={state.keepSeparate}>{t("settings.profile.link.appearance.keepSeparate")}</button>
    </> : notice ? <span role="status">{t(`settings.profile.link.appearance.${notice.kind}`, { hosts: notice.hosts.join(", ") })}</span> : null}
    {notice?.undo && <button disabled={state.busy} className="rounded px-1.5 py-1 text-accent hover:bg-surface-2 disabled:opacity-40" onClick={() => void state.undo()}>{t("settings.profile.link.appearance.undo")}</button>}
  </div>;
}
