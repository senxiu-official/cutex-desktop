// The onboarding host (owner 2026-10-19; onboarding v3 2026-11-26; state in lib/onboarding). At start, once: a first run
// on this device asks 「要看引导和提示吗？」 with the language (components/GuidesAsk); the three steps themselves are not a
// dialog but the 开始使用 card in the main area (modules/start). After an update: that version's notes (the same as
// Settings → 新功能, lib/releaseNotes), the first few with 查看全部.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { changelogText, type ChangelogRelease } from "../../../shared/changelog";
import { useI18n } from "../i18n";
import { automaticView, loadBundledReleases, useBundledReleases, closeOnboarding, getOnboarding, openOnboarding, testView, useOnboardingView, type OnboardingView } from "../lib/onboarding";
import { useTrackOverlay } from "../lib/openOverlays";
import { useUpdateStatus } from "../lib/update";
import { useApp } from "../store";
import { Button } from "./settings/Form";
import { GuideActionButton } from "./GuideActionButton";
import { GUIDE_ACTIONS } from "../lib/guideActions";
import { GuidesAsk } from "./GuidesAsk";
import { useGuideState, useGuidesHostPending } from "../lib/guides";
import { useOwnerWindow } from "../lib/ownerContext";
import { releaseItems } from "../lib/releaseNotes";

/** Items the update dialog lists before 查看全部. */
export const DIALOG_ITEMS = 5;

/** One fixed size (owner 2026-10-19: the box must not change size); a long body scrolls inside. */
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
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/35">
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
  // Without internal build names (lib/releaseNotes; the same notes as 新功能).
  const items = useMemo(() => (release ? releaseItems(release) : []), [release]);
  return (
    <Frame
      label={t("onboarding.whatsNew.title", { version })}
      onClose={close}
      footer={
        <>
          {items.length > DIALOG_ITEMS ? (
            <GuideActionButton id="help.features" action={GUIDE_ACTIONS["help.features"]} before={close} className="text-xs text-accent hover:underline">
              {t("start.whatsNew.all", { n: items.length })}
            </GuideActionButton>
          ) : (
            <GuideActionButton id="whatsNew.more" action={GUIDE_ACTIONS["whatsNew.more"]} before={close} className="text-xs text-subtle hover:text-foreground">
              {t("onboarding.whatsNew.more")}
            </GuideActionButton>
          )}
          <div className="ml-auto" />
          <Button primary onClick={close}>{t("onboarding.close")}</Button>
        </>
      }
    >
      <h2 className="mb-2 text-lg font-semibold">
        {t("onboarding.whatsNew.title", { version })}
        {release?.title && <span className="ml-2 text-sm font-normal text-subtle">“{release.title}”</span>}
      </h2>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted" data-whats-new-items="">
          {items.slice(0, DIALOG_ITEMS).map((b, i) => <li key={i}>{changelogText(b, locale)}</li>)}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t("onboarding.whatsNew.empty")}</p>
      )}
    </Frame>
  );
}

function WhatsNewRelease({ version }: { version: string }) {
  const release = useBundledReleases().find((r) => r.version === version) ?? null;
  return <WhatsNew version={version} release={release} />;
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
  useEffect(() => {
    // Once per start, after the first host state is known. The question does not need the version
    // (a first run without cutex gets it too); a version's 新功能 waits for the installed version.
    if (view && !view.auto) { decided.current = true; return; }
    if (decided.current || daemonKind === "connecting") return;
    const state = getOnboarding();
    if (state.testEveryBuild && !build) return;
    const candidates = installed ? [installed] : [];
    const possible = automaticView(state, installed, candidates);
    if (possible?.kind !== "intro" && !installed && !testView(state, build, [])) return;
    const needsNotes = (s: typeof state) => !!testView(s, build, []) || automaticView(s, installed, candidates)?.kind === "whatsNew";
    const warming = needsNotes(state) ? loadBundledReleases().catch(() => []) : null;
    let live = true;
    const timer = setTimeout(async () => {
      if (decided.current) return;
      const state = getOnboarding();
      const notes = needsNotes(state) ? await (warming ?? loadBundledReleases().catch(() => [])) : [];
      if (!live || decided.current) return;
      decided.current = true;
      const listed = notes.map((r) => r.version);
      const test = testView(state, build, listed);
      if (test) { openOnboarding(test); return; }
      const auto = automaticView(state, installed, listed);
      if (auto) openOnboarding({ ...auto, auto: true });
    }, 1200);
    return () => { live = false; clearTimeout(timer); };
  }, [daemonKind, installed, build, view]);
  // The introduction is the question only: once answered (or a replay), it is done — 开始使用 is the main area's card.
  const introDone = view?.kind === "intro" && (!view.auto || guides.asked);
  useEffect(() => {
    if (!introDone) return;
    closeOnboarding(installed);
    if (view && !view.auto) useApp.getState().openPage("start.page");
  }, [introDone, installed, view]);
  if (!view) return null;
  // The first guide on this device asks first whether to see guides at all (lib/guides).
  if (view.auto && !guides.asked) return hostPending ? null : <GuidesAsk version={installed} />;
  if (view.kind === "intro") return null;
  return <WhatsNewRelease version={view.version} />;
}
