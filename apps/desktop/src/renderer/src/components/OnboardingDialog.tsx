// The onboarding host (owner 2026-10-19; state in lib/onboarding, strings in modules/onboarding/i18n.ts — draft copy,
// the wording is the owner's). Opens by itself once at start (`automaticView`) or from Settings → 关于 / 新功能. The
// introduction and a version's illustrated tour (0.2.0, lib/tour) are ONE flow (components/OnboardingFlow, owner
// 2026-10-24): a first run gets the setup and then what is in 0.2; an upgrade from 0.1.x only the 0.2 part. Later
// versions without a tour keep the text 新功能 dialog below.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { changelogText, type ChangelogRelease } from "../../../shared/changelog";
import { useI18n } from "../i18n";
import { automaticView, bundledReleases, closeOnboarding, getOnboarding, openOnboarding, testView, useOnboardingView, type OnboardingView } from "../lib/onboarding";
import { useTrackOverlay } from "../lib/openOverlays";
import { TOUR_VERSIONS, hasTour } from "../lib/tour";
import { useUpdateStatus } from "../lib/update";
import { useApp } from "../store";
import { Button } from "./settings/Form";
import { Prose } from "./OnboardingProse";
import { OnboardingFlow } from "./OnboardingFlow";
import { GuideActionButton, OnboardingAsidePill } from "./GuideActionButton";
import { GUIDE_ACTIONS } from "../lib/guideActions";
import { GuidesAsk } from "./GuidesAsk";
import { useGuideState, useGuidesHostPending } from "../lib/guides";
import { useOwnerWindow } from "../lib/ownerContext";

/** One fixed size for every step (owner 2026-10-19: the box must not change size between steps); a long body scrolls inside. */
function Frame({ label, onClose, children, footer }: { label: string; onClose(): void; children: ReactNode; footer: ReactNode }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  useTrackOverlay(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    win.addEventListener("keydown", onKey, true);
    return () => win.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35">
      <div role="dialog" aria-modal aria-label={label} data-onboarding="" className="flex h-[26rem] max-h-[86vh] w-[36rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex justify-end px-3 pt-3">
          <button title={t("onboarding.close")} onClick={onClose} className="rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-2">{children}</div>
        <div className="flex items-center gap-2 border-t border-border px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

function WhatsNew({ version, release }: { version: string; release: ChangelogRelease | null }) {
  const { t, locale } = useI18n();
  const close = () => closeOnboarding(null);
  const summary = release?.blocks.find((b) => b.kind === "text");
  // Group headings are English in CHANGELOG.md: a Chinese UI shows only those with a Chinese text.
  const headings = release?.blocks.filter((b) => b.kind === "heading" && (!locale.startsWith("zh") || !!b.zh)) ?? [];
  return (
    <Frame
      label={t("onboarding.whatsNew.title", { version })}
      onClose={close}
      footer={
        <>
          <GuideActionButton id="whatsNew.more" action={GUIDE_ACTIONS["whatsNew.more"]} before={close} className="text-xs text-subtle hover:text-foreground">
            {t("onboarding.whatsNew.more")}
          </GuideActionButton>
          <div className="ml-auto" />
          <Button primary onClick={close}>{t("onboarding.close")}</Button>
        </>
      }
    >
      <h2 className="mb-2 text-lg font-semibold">
        {t("onboarding.whatsNew.title", { version })}
        {release?.title && <span className="ml-2 text-sm font-normal text-subtle">“{release.title}”</span>}
      </h2>
      {summary ? <Prose text={changelogText(summary, locale)} /> : <p className="text-sm text-muted">{t("onboarding.whatsNew.empty")}</p>}
      {headings.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {headings.map((h, i) => (
            <span key={i} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">{changelogText(h, locale)}</span>
          ))}
        </div>
      )}
    </Frame>
  );
}

/** Mounted once in App: shows what lib/onboarding has open, and opens the automatic view once per start. */
export function OnboardingHost() {
  const view = useOnboardingView();
  const guides = useGuideState();
  const hostPending = useGuidesHostPending();
  const status = useUpdateStatus();
  const installed = status?.current?.version ?? null;
  // The build identity for the testing switch: a source build changes commit without a new version.
  const build = status?.current ? `${status.current.version ?? ""}@${status.current.commit}` : null;
  const daemonKind = useApp((s) => s.daemon.kind);
  const decided = useRef(false);
  const listed = useMemo(() => bundledReleases().map((r) => r.version), []);
  useEffect(() => {
    // Once per start, after the first host state is known. The introduction does not need the version
    // (a first run without cutex gets it too); a version's 新功能 waits for the installed version.
    if (view && !view.auto) { decided.current = true; return; }
    if (decided.current || daemonKind === "connecting") return;
    const test = testView(getOnboarding(), build, listed);
    if (test) {
      decided.current = true;
      const timer = setTimeout(() => openOnboarding(test), 1200);
      return () => clearTimeout(timer);
    }
    if (getOnboarding().testEveryBuild && !build) return; // wait for the build before deciding
    const needsIntro = automaticView(getOnboarding(), null, listed)?.kind === "intro";
    if (!needsIntro && !installed) return;
    const timer = setTimeout(() => {
      if (decided.current) return;
      decided.current = true;
      const auto: OnboardingView | null = automaticView(getOnboarding(), installed, listed);
      if (auto) openOnboarding({ ...auto, auto: true });
    }, 1200);
    return () => clearTimeout(timer);
  }, [daemonKind, installed, build, listed, view]);
  // After a card's action: the way back to the flow.
  if (!view) return <OnboardingAsidePill />;
  // The first guide on this device asks first whether to see guides at all (lib/guides).
  if (view.auto && !guides.asked) return hostPending ? null : <GuidesAsk version={installed} />;
  // The whole flow (a first run, or once for everyone at 0.2.0); its 0.2 part from the newest version with a tour.
  if (view.kind === "intro") return <OnboardingFlow mode="full" version={TOUR_VERSIONS[TOUR_VERSIONS.length - 1]!} closeVersion={installed} startAt={view.at} />;
  // 0.2.0's 新功能 is the flow's 0.2 part (lib/tour; later versions keep the text summary).
  if (hasTour(view.version)) return <OnboardingFlow mode="whatsNew" version={view.version} startAt={view.at} />;
  const release = bundledReleases().find((r) => r.version === view.version) ?? null;
  return <WhatsNew version={view.version} release={release} />;
}
