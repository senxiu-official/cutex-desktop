// Windows sandbox readiness notes (cutex windows-sandbox-readiness; shared/windowsSandbox.ts): the
// composer permission menu's footer for one agent, and Settings → 新建默认 → Windows 沙箱 for the
// host's shared Codex home. Without a sandbox, 自动 / 只读 ask before every plain command on Windows.
import type { WindowsSandboxReadiness } from "../../../shared/ipc";
import { windowsSandboxCanSetUp } from "../../../shared/windowsSandbox";
import { useI18n, type MessageKey } from "../i18n";
import type { SetupPhase } from "../lib/windowsSandboxView";
import { useHostWindowsSandbox } from "../lib/windowsSandboxView";
import { settingsAnchorId } from "../lib/settingsNav";
import { useTargetApi } from "../lib/targetHost";
import { Button, Notice, Section, SettingRow } from "./settings/Form";

function PhaseText({ phase, startedKey, doneKey }: { phase: SetupPhase; startedKey: MessageKey; doneKey: MessageKey }) {
  const { t } = useI18n();
  switch (phase.kind) {
    case "started":
      return <span className="text-subtle">{t(startedKey)}</span>;
    case "done":
      return <span className="text-ok-text">{t(doneKey)}</span>;
    case "pending":
      return <span className="text-subtle">{t("winSandbox.hostSetupPending")}</span>;
    case "failed":
      return <span className="text-warn">{t("winSandbox.setupFailed", { message: phase.message || "?" })}</span>;
    default:
      return null;
  }
}

/** Composer permission menu footer: shown only when the caller decided it warns (windowsSandboxWarns). */
export function WindowsSandboxMenuNote({ readiness, phase, onSetup }: { readiness: WindowsSandboxReadiness; phase: SetupPhase; onSetup(): void }) {
  const { t } = useI18n();
  const canSetUp = windowsSandboxCanSetUp(readiness);
  const settled = phase.kind === "started" || phase.kind === "done";
  return (
    // w-0 min-w-full: wraps inside the menu's width instead of widening it.
    <div data-testid="win-sandbox-note" className="mt-1 w-0 min-w-full border-t border-border/60 px-2.5 pt-2 pb-1.5 text-xs">
      <div className="font-medium text-warn">{t("winSandbox.notReady")}</div>
      <p className="mt-1 text-subtle">{t(readiness === "updateRequired" ? "winSandbox.why.updateRequired" : "winSandbox.why.notConfigured")}</p>
      {readiness === "updateRequired" && <p className="mt-1 text-subtle">{t("winSandbox.steps.elevated")}</p>}
      <p className="mt-1 text-subtle">{t("winSandbox.steps.full")}</p>
      {canSetUp && !settled && (
        <button
          disabled={phase.kind === "running"}
          onClick={(e) => {
            e.stopPropagation();
            onSetup();
          }}
          className="mt-2 rounded-md border border-border px-2 py-1 hover:bg-surface-2 disabled:opacity-40"
        >
          {phase.kind === "running" ? t("winSandbox.settingUp") : t("winSandbox.setup")}
        </button>
      )}
      <div className="mt-1.5 empty:hidden">
        <PhaseText phase={phase} startedKey="winSandbox.setupStarted" doneKey="winSandbox.setupDone" />
      </div>
    </div>
  );
}

/** Settings → 新建默认 → Windows 沙箱 (the shared Codex home new agents start from). Render on Windows hosts only. */
export function WindowsSandboxSection({ supported }: { supported: boolean }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const { readiness, phase, load, setup } = useHostWindowsSandbox(api, supported);
  const statusKey: MessageKey = readiness === undefined ? "settings.loading" : readiness === null ? "winSandbox.status.unknown" : (`winSandbox.status.${readiness}` as MessageKey);
  return (
    <Section id={settingsAnchorId("winSandbox")} title={t("winSandbox.section")} hint={t("winSandbox.sectionHint")}>
      {!supported ? (
        <Notice>{t("winSandbox.unsupported")}</Notice>
      ) : (
        <>
          <SettingRow
            label={t("winSandbox.status")}
            hint={
              readiness === "updateRequired" ? t("winSandbox.steps.elevated") : phase.kind !== "idle" && phase.kind !== "running" ? <PhaseText phase={phase} startedKey="winSandbox.hostSetupPending" doneKey="winSandbox.hostSetupDone" /> : undefined
            }
          >
            <span className="flex items-center gap-2">
              <span data-testid="win-sandbox-status" className={`text-xs ${readiness === "ready" ? "text-ok-text" : readiness ? "text-warn" : "text-subtle"}`}>
                {t(statusKey)}
              </span>
              {windowsSandboxCanSetUp(readiness ?? null) && (
                <Button primary disabled={phase.kind === "running"} onClick={() => void setup()}>
                  {phase.kind === "running" ? t("winSandbox.settingUp") : t("winSandbox.setup")}
                </Button>
              )}
              <Button disabled={readiness === undefined || phase.kind === "running"} onClick={load}>
                {t("winSandbox.recheck")}
              </Button>
            </span>
          </SettingRow>
        </>
      )}
    </Section>
  );
}
