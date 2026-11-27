// Settings → 帮助 → 开始使用 (onboarding v3, owner 2026-11-26): reopen the three steps and 接下来可以试试, and the sample
// project — a scratch folder on the current host where an agent on the owner's Profile sets up a tiny practice project
// with a README of tasks (owner: a temporary folder, the Profile just set up, as small as possible, and say it costs a
// little quota). Skippable; opening it again opens the same agent while it still exists.
import { useState } from "react";
import { api } from "../../bridge";
import { Button, Section, SettingRow } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { runNewAgentSteps, NO_PROGRESS } from "../../lib/newAgentSteps";
import { loadProfileList } from "../../lib/profileSnapshot";
import { useApp } from "../../store";
import { chosenProfile, profileStage } from "./model";
import { START_PAGE } from "./pages";
import { getStartState, rememberSample, reopenTryNext } from "./state";

const SCRATCH_FEATURE = "human-agent-scratch-cwd";

export function StartHelpSection() {
  const { t } = useI18n();
  const scratch = useApp((s) => s.features.has(SCRATCH_FEATURE));
  const connected = useApp((s) => s.daemon.kind === "connected");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const openStart = () => {
    reopenTryNext();
    useApp.getState().openPage(START_PAGE);
  };
  const openSample = async () => {
    const app = useApp.getState();
    const hostId = app.hosts?.active ?? "local";
    const existing = getStartState().sample[hostId];
    if (existing && app.sidebar?.active.some((r) => r.cutexSessionId === existing)) return void app.openAgent(existing, hostId);
    setBusy(true);
    setNote(null);
    try {
      const profile = chosenProfile(profileStage(await loadProfileList(hostId)), null);
      if (!profile) return setNote(t("start.sample.needsProfile"));
      let progress = NO_PROGRESS;
      const id = await runNewAgentSteps(
        {
          create: async (start) => (await api.createAgent({ name: t("start.sample.name"), profile: profile.name, start })).cutexSessionId,
          refresh: async () => {
            await useApp.getState().refreshHostSidebar(hostId);
          },
          assignDirector: async () => {},
          start: async (agent) => {
            await useApp.getState().sessionAction(agent, "cutex/runtime/online", { openVisibleTerminal: false }, hostId);
          },
          submit: async (agent, text, extra) => {
            await api.submit(agent, text, "auto", false, { clientUserMessageId: crypto.randomUUID(), extra });
          },
        },
        { start: true, director: false, message: t("start.sample.task"), extra: [] },
        progress,
        (p) => (progress = p),
      );
      rememberSample(hostId, id);
      await useApp.getState().openAgent(id, hostId);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t("start.help.start")}>
      <div data-help-start="">
        <SettingRow agents="none" source="local" navigation label={t("start.help.start.row")} hint={t("start.help.start.hint")}>
          <Button onClick={openStart}>{t("start.help.start.open")}</Button>
        </SettingRow>
      </div>
      <div data-help-sample="">
        <SettingRow agents="none" source="host" navigation label={t("start.sample.title")} hint={`${t("start.sample.hint")}\n${t(scratch || !connected ? "start.sample.cost" : "start.sample.unsupported")}`}>
          <Button primary disabled={busy || !connected || !scratch} onClick={() => void openSample()}>{t(busy ? "start.sample.creating" : "start.sample.open")}</Button>
        </SettingRow>
        {note && <p role="status" className="mb-2 text-meta text-warn">{note}</p>}
      </div>
      <SettingRow agents="none" source="local" navigation label={t("start.customize.title")} hint={t("start.help.customize.hint")}>
        <Button onClick={() => useApp.getState().openPage(START_PAGE, { customize: "1" })}>{t("start.help.start.open")}</Button>
      </SettingRow>
    </Section>
  );
}
