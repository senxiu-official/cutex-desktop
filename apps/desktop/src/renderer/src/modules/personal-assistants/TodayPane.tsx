// 「今日」 as a pane: the right view beside an assistant's conversation (a context-following project view shows the same
// for an assistant: ProjectView finds this kind through the slot). The band of narrow windows is ./TodayBand; helpers
// in ./todayModel.
import { useEffect } from "react";
import { ConciergeBell } from "lucide-react";
import { useI18n } from "../../i18n";
import type { SideBodyProps } from "../slots";
import { services } from "../app";
import { TodayView } from "./TodayView";
import { setTodayPaneShown, useTodayTarget, type TodayState } from "./todayModel";

export function TodayPaneBody({ instance, hostId, sessionId, visible }: Pick<SideBodyProps<TodayState>, "instance" | "hostId" | "sessionId" | "visible">) {
  const { t } = useI18n();
  const target = useTodayTarget(hostId, sessionId);
  // On screen with an assistant: the narrow window's band steps back (./TodayBand).
  const shown = visible !== false && !!target;
  useEffect(() => {
    setTodayPaneShown(instance.id, shown);
    return () => setTodayPaneShown(instance.id, false);
  }, [instance.id, shown]);
  if (!target) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center" data-pa-today-empty="">
        <ConciergeBell size={22} className="text-subtle" aria-hidden />
        <div className="text-ui/[inherit] text-muted">{t("personal-assistants.todayView.empty")}</div>
        <button type="button" className="press rounded-md bg-accent px-3 py-1 text-ui/[inherit] text-on-accent" onClick={() => services.ui.openPage("personal-assistants.page", {})}>
          {t("personal-assistants.todayView.create")}
        </button>
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      {!target.own && <div className="px-3 pt-2 text-caption/[inherit] text-subtle" data-pa-today-showing-default="">{t("personal-assistants.todayView.showingDefault")}</div>}
      <TodayView hostId={target.hostId} assistant={target.assistant} />
    </div>
  );
}
