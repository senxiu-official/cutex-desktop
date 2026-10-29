// Settings → 帮助 (owner 2026-10-24): everything that teaches, in one place, read from the guide registry (lib/guides).
// Self-contained (no props, no daemon calls) so it can move to another group or a page of its own. Replays the
// onboarding / the 0.2 part, lists every live tip and panel with its first line and 「再看一次」, 「重置所有提示」,
// 「跳过所有引导」, the four panel guides (lib/panelGuides: 打开, 「已看过」 once finished — never cleared by 重置 / 全部跳过),
// and links out (docs, the agents' guide, release notes, feedback).
import { api } from "../../bridge";
import { useState } from "react";
import { InlineGuide } from "../../components/InlineGuide";
import { Button, LinkRow, Section, SettingRow, SettingsGroup } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { liveGuides, replayGuide, resetGuides, skipAllGuides, useGuideState, type Guide } from "../../lib/guides";
import { useUpdateStatus } from "../../lib/update";
import { GUIDE_ACTIONS, runGuideAction } from "../../lib/guideActions";
import { useApp } from "../../store";
import { panelGuideDone } from "../../lib/panelGuides";

const REPO = "https://github.com/senxiu-official/cutex-desktop";
export const HELP_LINKS: readonly { id: string; label: MessageKey; url: string }[] = [
  { id: "docs", label: "onboarding.guide.help.link.docs", url: `${REPO}/blob/release/docs/QUICKSTART.md` },
  { id: "agents", label: "onboarding.guide.help.link.agents", url: `${REPO}/blob/release/docs/install/AGENT-INSTALL.md` },
  { id: "releases", label: "onboarding.guide.help.link.releases", url: `${REPO}/blob/release/CHANGELOG.md` },
  { id: "feedback", label: "onboarding.guide.help.link.feedback", url: `${REPO}/issues` },
];

/** A guide's line in 帮助: the first line of what it says. */
function firstLine(text: string): string {
  return text.split("\n")[0]!.trim();
}

export function HelpPage() {
  const { t } = useI18n();
  const status = useUpdateStatus();
  const version = status?.current?.version ?? null;
  const state = useGuideState();
  const guides = liveGuides(version);
  const onboarding = guides.filter((g) => g.kind === "onboarding");
  const tips = guides.filter((g) => g.kind !== "onboarding" && g.kind !== "panel");
  const panels = guides.filter((g) => g.kind === "panel");
  const [inlineReplay, setInlineReplay] = useState<string | null>(null);
  const [tipReplay, setTipReplay] = useState<string | null>(null);
  const row = (g: Guide) => (
    <div key={g.id} data-help-guide={g.id} data-seen={state.seen.includes(g.id)}>
      <SettingRow agents="none" source="local" navigation label={t(g.title)} hint={firstLine(t(g.text))}>
        <Button onClick={() => {
          if (g.kind === "inline") setInlineReplay(g.id);
          else {
            if (g.kind === "tip") setTipReplay(g.id);
            replayGuide(g.id);
          }
        }}>{t(g.kind === "onboarding" ? "onboarding.guide.help.replay" : "onboarding.guide.help.again")}</Button>
      </SettingRow>
      {g.kind === "inline" && inlineReplay === g.id && <InlineGuide id={g.id} replay onClose={() => setInlineReplay(null)} />}
      {g.kind === "tip" && tipReplay === g.id && <p role="status" data-help-tip-replay={g.id} className="mb-2 text-meta text-muted">{t((state.seen.includes(g.id) ? "onboarding.guide.help.tipShown" : "onboarding.guide.help.tipPending") as MessageKey)}</p>}
    </div>
  );
  return (
    <div className="space-y-4" data-help-page="">
      <p data-help-guide-scope className="whitespace-pre-line text-meta text-muted">{t("onboarding.guide.help.scope" as MessageKey)}</p>
      <Section title={t("onboarding.guide.help.onboarding")}>{onboarding.map(row)}</Section>
      <Section
        title={t("onboarding.guide.help.tips")}
        hint={t("onboarding.guide.help.tipsHint")}
        actions={
          <SettingsGroup agents="none" source={["local", "host"]}><div className="flex gap-2">
            <span data-help-reset="">
              <Button onClick={resetGuides}>{t("onboarding.guide.help.reset")}</Button>
            </span>
            <span data-help-skip="">
              <Button onClick={() => skipAllGuides(version)}>{t("onboarding.guide.skipAll")}</Button>
            </span>
          </div></SettingsGroup>
        }
      >
        {tips.map(row)}
      </Section>
      {panels.length > 0 && (
        <Section title={t("onboarding.panel.help.title")} hint={t("onboarding.panel.help.hint")}>
          {panels.map((g) => {
            const done = !!g.panel && panelGuideDone(g.panel, state.seen);
            return (
              <div key={g.id} data-help-guide={g.id} data-seen={done}>
                <SettingRow agents="none" source="local" navigation label={done ? `${t(g.title)} · ${t("onboarding.panel.help.seen")}` : t(g.title)} hint={firstLine(t(g.text))}>
                  <Button onClick={() => replayGuide(g.id)}>{t("onboarding.panel.help.open")}</Button>
                </SettingRow>
              </div>
            );
          })}
        </Section>
      )}
      <Section title={t("onboarding.guide.help.links")}>
        <LinkRow agents="none" source="local" label={t("onboarding.features.title")} link={t("onboarding.features.open")} onClick={() => void runGuideAction(GUIDE_ACTIONS["help.features"])} />
        {HELP_LINKS.map((l) => (
          <LinkRow agents="none" source="local" key={l.id} label={t(l.label)} link={l.url.replace(/^https:\/\//, "")} onClick={() => void api.openExternal(l.url)} />
        ))}
      </Section>
    </div>
  );
}
