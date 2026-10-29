// 个人页 (pane kind `home.profile`: single, bound to nothing; opened from the desktop's profile card):
// cover (editable in 编辑主页), avatar, display name, bio, statistics (累计 Token over the past year, the
// longest and the current run of days) and the one-year activity heatmap over every host. No @handle
// (owner 2026-10-19).
import { Pencil } from "lucide-react";
import { useI18n } from "../../i18n";
import { useIdentity } from "../../lib/identityView";
import type { SideBodyProps, SideTabProps } from "../slots";
import { EditPanel } from "./EditPanel";
import { useCover, useHomeSource, useHomeUsage } from "./hooks";
import { Backdrop, Heatmap, MeAvatar, Stat } from "./Parts";
import { compactTokens, dayKey, homeStats } from "./stats";
import { setHomeEditing, useHomeEdit } from "./store";
import "./home.css";

export type ProfileState = Record<string, never>;

export function useProfileTitle(_props: SideTabProps<ProfileState>) {
  const { t } = useI18n();
  return { title: t("home.profile") };
}

export function ProfileBody(_props: SideBodyProps<ProfileState>) {
  const { t, locale } = useI18n();
  const identity = useIdentity();
  const home = useHomeSource();
  const editing = useHomeEdit((s) => s.editing);
  const cover = useCover(home.hostId, home.entry?.source === "host" ? (home.entry.coverEtag ?? null) : null);
  const { days } = useHomeUsage();
  const today = dayKey(new Date());
  const stats = days ? homeStats(days, today) : null;
  const bio = home.entry?.doc.bio?.trim();
  return (
    <div className="home-desk h-full min-h-0 overflow-y-auto bg-background" data-home-profile="">
      <div className="relative h-36 overflow-hidden">
        <Backdrop cover={cover} />
      </div>
      <div className="relative px-6 pb-6">
        <div className="-mt-10 flex items-end gap-4">
          <span className="rounded-full border-4 border-background shadow-e1">
            <MeAvatar identity={identity} size={72} />
          </span>
          <div className="min-w-0 flex-1 pb-1.5">
            <h2 className="truncate text-[22px] font-semibold">{identity.name}</h2>
          </div>
          <button onClick={() => setHomeEditing(!editing)} aria-pressed={editing} className="mb-2 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-raised px-2.5 py-1 text-xs hover:bg-hover aria-pressed:border-accent aria-pressed:text-accent">
            <Pencil size={12} />
            {editing ? t("home.done") : t("home.edit")}
          </button>
        </div>
        {bio && <p className="mt-2.5 text-ui/[inherit] whitespace-pre-line text-muted">{bio}</p>}
        {editing ? (
          <EditPanel className="mt-2 max-w-md" />
        ) : (
          <>
            <div className="mt-4 mb-5 flex rounded-xl border border-border [&>*+*]:border-l [&>*+*]:border-border" title={t("home.stats.scope")} data-home-stats="">
              <Stat value={stats ? compactTokens(stats.total, locale) : "—"} label={t("home.stats.total")} />
              <Stat value={stats ? t("home.stats.days", { n: stats.longestStreak }) : "—"} label={t("home.stats.longest")} />
              <Stat value={stats ? t("home.stats.days", { n: stats.currentStreak }) : "—"} label={t("home.stats.current")} />
            </div>
            <h3 className="mb-2 flex items-center gap-2 text-ui/[inherit] font-semibold">
              {t("home.activity")}
              <span className="ml-auto text-xs font-normal text-subtle">{t("home.stats.scope")}</span>
            </h3>
            {days ? <Heatmap days={days} today={today} locale={locale} /> : <div className="h-24 animate-skeleton rounded-lg bg-surface-2" />}
          </>
        )}
      </div>
    </div>
  );
}
