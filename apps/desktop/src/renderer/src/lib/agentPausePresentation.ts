import type { AgentPause } from "../../../shared/agentPause";
import type { useI18n } from "../i18n";
type I18n = ReturnType<typeof useI18n>;
const relativeFormats = new Map<I18n["locale"], Intl.RelativeTimeFormat>();
function heldSinceTime(since: string, now: number, locale: I18n["locale"]): string {
  let format = relativeFormats.get(locale);
  if (!format) { format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }); relativeFormats.set(locale, format); }
  const seconds = Math.max(0, (now - Date.parse(since)) / 1000);
  const [unit, span] = seconds >= 86400 ? ["day", 86400] as const : seconds >= 3600 ? ["hour", 3600] as const : seconds >= 60 ? ["minute", 60] as const : ["second", 1] as const;
  return format.format(-Math.floor(seconds / span), unit);
}

/** Only daemon-reported held calls produce a tool-boundary reason. */
export function agentPauseHint(pause: AgentPause | null, t: I18n["t"], locale: I18n["locale"], now: number, director?: string | null): string {
  if (!pause) return "";
  const first = pause.held?.[0];
  const hint = pause.phase === "pausing" ? t(pause.at === "toolBoundary" ? "agentPause.tagHint.toolBoundary" : "agentPause.tagHint.pausing")
    : first ? t("agentPause.beforeTool", { tool: first.tool })
      + (first.agentId ? t("agentPause.heldSubagent") : "")
      + (pause.held!.length > 1 ? t("agentPause.heldCount", { n: pause.held!.length }) : "")
      + "\n" + t("agentPause.heldSince", { time: heldSinceTime(first.since, now, locale) })
    : t("agentPause.tagHint.paused");
  return pause.by === "director" ? `${hint}\n${t("agentPause.byDirector", { name: director ?? pause.byCutexSessionId ?? "" })}` : hint;
}
