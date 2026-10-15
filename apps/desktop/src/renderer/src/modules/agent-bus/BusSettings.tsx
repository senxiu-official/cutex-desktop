// Settings → 协作, the agent-bus module's part (settings audit 2026-10-15 #11, #35): policy first, so
// 消息投递 (cutex wake-busy-wait: how long a wake / delegation results for a busy agent wait for its
// turn to end) sits with the other policy sections, and the plumbing — 消息总线 on / port / token
// (restart needed) and, with cutex agent-bus-stuck-messages, 卡住的消息 — is in a collapsed 「高级」
// card at the end of the page. Settings search still finds it: a reveal opens the card.
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import type { GlobalSettings } from "../../../../shared/ipc";
import { STUCK_MESSAGES_FEATURE } from "../../../../shared/agentBusStuck";
import { ErrorNote, IconButton, Loading, Notice, NumberField, ResetButton, Section, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useGlobalSettings } from "../../lib/globalSettings";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useOnSettingsReveal } from "../../lib/settingsSearchView";
import { useTargetFeatures, useTargetIsFocus } from "../../lib/targetHost";
import { DEFAULT_WAKE_BUSY_WAIT_SECS, readWakeBusyWait, WAKE_BUSY_WAIT_FEATURE, WAKE_BUSY_WAIT_RANGE } from "../../lib/wakeBusyWait";
import { setWakeBusyWait } from "../../lib/wakeBusyWaitView";
import { StuckMessagesSection } from "./StuckMessagesSection";

/** The `settings.section` item id of the 高级 card (its anchor, set by `<SettingsSections>`). */
export const ADVANCED_SECTION = "agent-bus.advanced";

/** 消息投递: cutex `wake-busy-wait` (seconds; empty = wait for the turn end). Applies at once. */
export function DeliverySection() {
  const { t } = useI18n();
  const { settings, error, patch } = useGlobalSettings();
  const supported = useTargetFeatures().has(WAKE_BUSY_WAIT_FEATURE);
  if (!supported || (settings && !settings.agentBus)) return null;
  return (
    <Section title={t("agent-bus.delivery")} hint={t("agent-bus.deliveryHint")}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {settings ? <WakeBusyWaitRow settings={settings} patch={patch} /> : !error && <Loading rows={1} />}
    </Section>
  );
}

function WakeBusyWaitRow({ settings, patch }: { settings: GlobalSettings; patch(p: Partial<GlobalSettings>): Promise<void> }) {
  const { t } = useI18n();
  const value = readWakeBusyWait(settings);
  const isFocus = useTargetIsFocus();
  // The label in 待读留言 reads the same value (lib/wakeBusyWaitView, the focus host's); keep it
  // current, but never with another host's value.
  useEffect(() => {
    if (isFocus && value !== undefined) setWakeBusyWait(value);
  }, [isFocus, value]);
  const def = settings.agentBusDefault?.wakeBusyWaitSecs ?? DEFAULT_WAKE_BUSY_WAIT_SECS;
  const range = settings.agentBusRange?.wakeBusyWaitSecs ?? WAKE_BUSY_WAIT_RANGE;
  const save = (secs: number | null) => void patch({ agentBus: { wakeBusyWaitSecs: secs } });
  return (
    <SettingRow label={t("agent-bus.wakeBusyWait")} hint={t("agent-bus.wakeBusyWaitHint")} reset={<ResetButton disabled={value === def} onClick={() => save(def)} />}>
      <NumberField value={value ?? null} range={range} unit={t("agent-bus.seconds")} placeholder={t("agent-bus.wakeBusyWaitOff")} onCommit={save} />
    </SettingRow>
  );
}

/** 高级 (page end): collapsed to one line; open = 消息总线 (on / port / token) + 卡住的消息. */
export function AdvancedSection() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const stuck = useTargetFeatures().has(STUCK_MESSAGES_FEATURE);
  // Settings search lands here: open the card before it is flashed.
  useOnSettingsReveal(ADVANCED_SECTION, () => setOpen(true));
  const toggle = (
    <IconButton label={t(open ? "agent-bus.advancedCollapse" : "agent-bus.advancedExpand")} onClick={() => setOpen(!open)}>
      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </IconButton>
  );
  if (!open)
    return (
      <Section title={t("agent-bus.advanced")} actions={toggle}>
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="flex w-full min-w-0 items-center gap-2 py-2.5 text-left text-sm hover:text-foreground">
          <ChevronRight size={14} className="shrink-0 text-subtle" />
          <span className="min-w-0 flex-1 truncate text-muted">{t("agent-bus.advancedSummary")}</span>
        </button>
      </Section>
    );
  return (
    <div>
      {/* The 高级 title row, same height as a Section's, over the plumbing sections. */}
      <div className="mb-2 flex h-7 items-center gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold">{t("agent-bus.advanced")}</h3>
        <div className="ml-auto flex shrink-0 items-center gap-2">{toggle}</div>
      </div>
      <div id={settingsAnchorId("agent-bus.settings")}>
        <BusSection />
      </div>
      {stuck && (
        <div id={settingsAnchorId("agent-bus.stuck")}>
          <StuckMessagesSection />
        </div>
      )}
    </div>
  );
}

/** 消息总线: on / port / token; changes need a cutex service restart. */
function BusSection() {
  const { t } = useI18n();
  const { settings, error, notice, patch } = useGlobalSettings();
  if (!settings)
    return (
      <Section title={t("agent-bus.page")}>
        {error ? <ErrorNote>{error}</ErrorNote> : <Loading rows={3} />}
      </Section>
    );
  return (
    <Section title={t("agent-bus.page")} hint={t("agent-bus.hint")}>
      {notice && <Notice>{notice}</Notice>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <SettingRow label={t("agent-bus.enabled")} hint={t("agent-bus.restartHint")}>
        <Toggle checked={settings.agentBusEnabled} onChange={(v) => void patch({ agentBusEnabled: v }, t("agent-bus.restartDaemon"))} />
      </SettingRow>
      <SettingRow label={t("agent-bus.port")} hint={t("agent-bus.effective", { port: settings.agentBusEffectivePort ?? "—" })}>
        <NumberField value={settings.agentBusPort ?? null} range={[1, 65535]} placeholder={String(settings.agentBusEffectivePort ?? "")} onCommit={(v) => void patch({ agentBusPort: v }, t("agent-bus.restartDaemon"))} />
      </SettingRow>
      <SettingRow label={t("agent-bus.token")}>
        <span className="text-xs text-subtle">{settings.secretsPresent.agentBusToken ? t("agent-bus.tokenSet") : t("agent-bus.tokenMissing")}</span>
      </SettingRow>
    </Section>
  );
}
