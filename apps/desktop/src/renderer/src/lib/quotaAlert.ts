// 「快用完」 alert (design 052 §5 item 4): while an agent is working on a Profile whose short window
// (5h) is forecast to run out within 30 minutes, one desktop notification per window — 「Ceobe 5h 约 01:50
// 用完，主要是 review-insert-opus」. Behind UiPrefs.quotaRunOutAlert, on by default (052 §8 Q2: owner
// 2026-11-17). Uses the quota curve only (lib/quotaForecast); the 「主要是」 part needs `quota-attribution`.
// A click opens the working agent with its quota popover (「谁在用」).
import type { QuotaGauge } from "../../../shared/ipc";
import { QUOTA_ATTRIBUTION_FEATURE, type QuotaSnapshot } from "../../../shared/quotaAttribution";
import { translate } from "../i18n";
import { agentHost, featuresOf, hostApi, sidebarOf, useApp } from "../store";
import { emitNotify } from "./notifyEvents";
import { getUiPrefs, subscribeUiPrefs } from "./prefs";
import { gaugeLabel } from "./quota";
import { summarizeAttribution } from "./quotaAttribution";
import { forecastClock, forecastGauge, loadQuotaHistory, type QuotaForecast } from "./quotaForecast";

/** Alert when the forecast run-out is this close. */
export const ALERT_WITHIN_SECS = 30 * 60;
/** Re-check this often while the switch is on (quota reads land every few minutes). */
const CHECK_MS = 60_000;
const SENT_KEY = "cutex.quotaRunOutAlerts";
const SENT_MAX = 64;

export interface RunOutCandidate {
  profile: string;
  gauge: QuotaGauge;
  forecast: QuotaForecast;
  /** The busy agents on the profile (cutexSessionId + name), the first one opened by a click. */
  agents: { id: string; name: string }[];
}

/** The once-per-window key: host, profile, gauge and its reset (a new window may alert again). */
export function alertKey(hostId: string, profile: string, g: Pick<QuotaGauge, "id" | "resetAt">): string {
  return `quota-out:${hostId}:${profile}:${g.id}:${g.resetAt ?? "-"}`;
}

/**
 * The windows to alert about now: short windows of busy profiles whose forecast runs out within
 * ALERT_WITHIN_SECS (before the reset), not yet alerted (`sent`).
 */
export function runOutCandidates(input: {
  hostId: string;
  quotas: Readonly<Record<string, readonly QuotaGauge[] | undefined>>;
  busy: ReadonlyMap<string, { id: string; name: string }[]>;
  history: (profile: string) => readonly QuotaSnapshot[] | null;
  sent: ReadonlySet<string>;
  now: number;
}): RunOutCandidate[] {
  const out: RunOutCandidate[] = [];
  for (const [profile, agents] of input.busy) {
    const history = input.history(profile);
    if (!history) continue;
    for (const gauge of input.quotas[profile] ?? []) {
      if (input.sent.has(alertKey(input.hostId, profile, gauge))) continue;
      const forecast = forecastGauge(gauge, history, input.now);
      if (forecast?.kind !== "runsOut" || forecast.span !== "short") continue;
      if (forecast.at - input.now > ALERT_WITHIN_SECS) continue;
      out.push({ profile, gauge, forecast, agents });
    }
  }
  return out;
}

/** The notification text: 「Ceobe 5h 约 01:50 用完（04:00 重置）」 + 「主要是 X」 when known. */
export function alertBody(c: RunOutCandidate, topAgent: string | null, now = Date.now()): string {
  if (c.forecast.kind !== "runsOut") return "";
  const base = translate(c.forecast.resetAt ? "quota.alert.body" : "quota.alert.bodyNoReset", { profile: c.profile, window: gaugeLabel(c.gauge), at: forecastClock(c.forecast.at, now), reset: c.forecast.resetAt ? forecastClock(c.forecast.resetAt, now) : "" });
  return topAgent ? `${base}${translate("quota.alert.mostly", { agent: topAgent })}` : base;
}

function readSent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remember(key: string): void {
  const next = [...readSent().filter((k) => k !== key), key].slice(-SENT_MAX);
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(next));
  } catch {
    // storage full / unavailable: the in-memory set still holds it for this run
  }
}

/** Busy agents of the store's host by profile name. */
function busyProfiles(hostId: string): Map<string, { id: string; name: string }[]> {
  const out = new Map<string, { id: string; name: string }[]>();
  for (const s of sidebarOf(useApp.getState(), hostId)?.active ?? []) {
    const busy = s.activityStatus === "busy" || !!s.busySince;
    if (!busy || !s.profile) continue;
    out.set(s.profile, [...(out.get(s.profile) ?? []), { id: s.cutexSessionId, name: s.displayName }]);
  }
  return out;
}

/**
 * Start watching (App mount); returns the stop. Does nothing while the switch is off. Turning the switch off (or
 * stopping) cancels a check that is still reading: nothing is sent and the window is not marked as alerted.
 */
export function startQuotaRunOutAlerts(): () => void {
  const sent = new Set(readSent());
  let running = false;
  // Bumped when the switch goes off or on stop; a check that started under an older generation gives up.
  let generation = 0;
  const check = async () => {
    if (running || !getUiPrefs().quotaRunOutAlert) return;
    running = true;
    const mine = generation;
    const live = () => mine === generation && getUiPrefs().quotaRunOutAlert;
    try {
      const state = useApp.getState();
      const hostId = agentHost(state);
      const busy = busyProfiles(hostId);
      if (!busy.size) return;
      const histories = new Map<string, QuotaSnapshot[] | null>();
      for (const profile of busy.keys()) {
        if (!state.quotas[profile]?.some((g) => g.kind === "window")) continue;
        histories.set(profile, await loadQuotaHistory(hostId, profile, (q) => hostApi(hostId).quotaHistory(q)));
        if (!live()) return;
      }
      const now = Date.now() / 1000;
      const found = runOutCandidates({ hostId, quotas: useApp.getState().quotas, busy, history: (p) => histories.get(p) ?? null, sent, now });
      for (const c of found) {
        const key = alertKey(hostId, c.profile, c.gauge);
        if (sent.has(key)) continue;
        let top: string | null = null;
        if (featuresOf(useApp.getState(), hostId).has(QUOTA_ATTRIBUTION_FEATURE) && c.gauge.windowLabel) {
          const a = await hostApi(hostId).quotaAttribution({ profile: c.profile, window: c.gauge.windowLabel }).catch(() => null);
          top = (a && summarizeAttribution(a)?.top[0]?.row.agentName) || null;
        }
        // The owner may have switched it off while this was reading.
        if (!live()) return;
        sent.add(key);
        remember(key);
        const agent = c.agents[0]!;
        emitNotify({
          key,
          events: ["quota.runningOut"],
          // Device-local switch, not a cutex notification level: the owner turned it on here.
          decided: { level: "inform", actions: ["desktop"] },
          fallback: ["desktop"],
          agentId: agent.id,
          agentName: agent.name,
          title: translate("quota.alert.title"),
          body: alertBody(c, top),
          looking: false,
          onClick: () => {
            void useApp
              .getState()
              .openAgent(agent.id, hostId)
              .then(() => useApp.getState().signal("quota", undefined, { hostId, sessionId: agent.id }));
          },
        });
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void check(), CHECK_MS);
  const offStore = useApp.subscribe((s, prev) => {
    if (s.quotas !== prev.quotas) void check();
  });
  const offPrefs = subscribeUiPrefs(() => {
    if (!getUiPrefs().quotaRunOutAlert) generation++;
    else void check();
  });
  void check();
  return () => {
    generation++;
    clearInterval(timer);
    offStore();
    offPrefs();
  };
}
