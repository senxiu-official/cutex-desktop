// An inline guide (lib/guides, kind "inline"): a small panel in place, inside the form it explains (the new-Profile
// form: one per Profile type). Shown until it is closed or `done` (e.g. a Profile of that type exists), and again after
// 帮助 → 再看一次 / 重置所有提示. The first guide on a device asks 「要看引导和提示吗？」 first (components/GuidesAsk).
import { useEffect } from "react";
import { Lightbulb, X } from "lucide-react";
import { useI18n } from "../i18n";
import { guideById, liveGuides, markGuideSeen, skipAllGuides, useGuideState, useGuidesHostPending } from "../lib/guides";
import { useUpdateStatus } from "../lib/update";
import { GuidesAskButtons } from "./GuidesAsk";

export function InlineGuide({ id, done, replay = false, onClose }: { id: string; done?: boolean; replay?: boolean; onClose?(): void }) {
  const { t } = useI18n();
  const state = useGuideState();
  const hostPending = useGuidesHostPending();
  const version = useUpdateStatus()?.current?.version ?? null;
  const guide = guideById(id);
  const live = !!guide && liveGuides(version).includes(guide);
  useEffect(() => {
    if (done && !replay) markGuideSeen(id);
  }, [done, id, replay]);
  if (!guide || !live || (!replay && (done || state.seen.includes(id) || (!state.asked && hostPending)))) return null;
  const link = "rounded-ctl text-meta text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <div role="note" data-inline-guide={id} className="mb-3 rounded-inner border border-accent/30 bg-accent/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Lightbulb size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium text-foreground">{t(replay || state.asked ? guide.title : "onboarding.guide.ask.title")}</p>
          {replay || state.asked ? (
            <>
              <p className="mt-1 whitespace-pre-line text-meta text-muted">{t(guide.text)}</p>
              {!replay && <button type="button" data-guides-skip="" className={`${link} mt-1.5 text-muted`} onClick={() => skipAllGuides(version)}>
                {t("onboarding.guide.skipAll")}
              </button>}
            </>
          ) : (
            <div data-guides-ask="inline">
              <p className="mt-1 whitespace-pre-line text-meta text-muted">{t("onboarding.guide.ask.body")}</p>
              <div className="mt-2">
                <GuidesAskButtons version={version} />
              </div>
            </div>
          )}
        </div>
        <button type="button" className="shrink-0 rounded-ctl p-1 text-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent" aria-label={t("onboarding.tips.dismiss")} onClick={() => replay ? onClose?.() : markGuideSeen(id)}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
