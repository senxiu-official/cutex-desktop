// Provider-neutral quota gauges shown next to the profile name in the composer row.
// Sources, merged in this order:
//   1. cutex per-profile quota (`GET /v2/profiles/{profile}/quota`): user-configurable HTTP
//      readers (custom URL + JSON pointers, or a named reader — cutex profile-generic-switches;
//      older cutex: a host-based auto preset), any number of gauges per profile — DESIGN gap 13.
//      Newer cutex (capability `profile-quota-native`) also reads ChatGPT rate limits itself and
//      emits `cutex/profile/quota/updated`.
//   2. live cute-codex `account/rateLimits/updated` during turns (same gauge id → newer wins).
//   3. native `account/rateLimits/read` on the agent's runtime whenever cutex has no gauges for
//      the profile (e.g. Claude profiles; see wantsNativeQuotaFallback).
// Context usage is deliberately NOT a quota gauge; it has its own ring.
import type { QuotaConfigView, QuotaGauge, QuotaReaderName } from "../../../shared/ipc";
import { translate, type MessageKey } from "../i18n";

export type { QuotaGauge };

interface RateLimitWindowLike {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface RateLimitsLike {
  primary?: RateLimitWindowLike | null;
  secondary?: RateLimitWindowLike | null;
  credits?: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  [key: string]: unknown;
}

/** Merge a sparse `account/rateLimits/updated` snapshot: null/absent fields keep previous values. */
export function mergeRateLimits(previous: RateLimitsLike | null, update: RateLimitsLike): RateLimitsLike {
  const next: RateLimitsLike = { ...(previous ?? {}) };
  for (const [key, value] of Object.entries(update)) if (value !== null && value !== undefined) next[key] = value;
  return next;
}

/** cutex capability: cutex itself reads ChatGPT quota via native `account/rateLimits/read`
 *  (gauges `codex-primary` / `codex-secondary` / `codex-credits`) and pushes updates. */
export const QUOTA_NATIVE_FEATURE = "profile-quota-native";
/** cutex capability: cutex reads the Claude subscription usage for Claude profiles (gauges `claude-<n>`). */
export const QUOTA_CLAUDE_FEATURE = "profile-quota-claude";
/** Host event cutex emits when a profile's quota snapshot changes (only trusted with the capability). */
export const QUOTA_UPDATED_EVENT = "cutex/profile/quota/updated";

/** Profile names / ids a quota-updated event refers to ([] = unknown → refresh every loaded profile). */
export function quotaEventProfiles(params: unknown): string[] {
  if (!params || typeof params !== "object") return [];
  const p = params as Record<string, unknown>;
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && v && !out.includes(v)) out.push(v);
  };
  add(p.profileName);
  add(p.profileId);
  if (p.profile && typeof p.profile === "object") {
    add((p.profile as Record<string, unknown>).name);
    add((p.profile as Record<string, unknown>).id);
  } else add(p.profile);
  return out;
}

/**
 * Profiles whose observed ChatGPT plan changed (`planChanged`, cutex `profile-plan-label-override`):
 * their `planLabel` may differ now, so profile views re-read them. [] = not a plan change.
 */
export function quotaEventPlanChanged(params: unknown): string[] {
  if (!params || typeof params !== "object" || (params as { planChanged?: unknown }).planChanged !== true) return [];
  return quotaEventProfiles(params);
}

/**
 * cutex capability: no rule keyed on a host / provider / profile name. Quota sources are explicit
 * readers (`quota-config` `presetOptions`; `auto` only as a legacy leftover PUT refuses) and Codex
 * profiles have the `privateChatgptAuthFile` switch.
 */
export const PROFILE_GENERIC_SWITCHES_FEATURE = "profile-generic-switches";

/** The readers this build knows (cutex `src/profiles/quota.rs` Reader::ALL, in that order). */
export const QUOTA_READERS: readonly QuotaReaderName[] = ["usage_endpoint", "deepseek_balance", "moonshot_balance", "moonshot_cn_balance", "zhipu_coding_plan", "openrouter_key"];

export function isKnownQuotaReader(value: string | null | undefined): value is QuotaReaderName {
  return (QUOTA_READERS as readonly string[]).includes(value ?? "");
}

/** The picker label of a quota source: `custom`, a known reader's name, else cutex's raw value. */
export function quotaPresetLabel(t: (key: MessageKey) => string, preset: string): string {
  if (preset === "custom") return t("agent-config.quota.custom");
  return isKnownQuotaReader(preset) ? t(`agent-config.quota.reader.${preset}`) : preset;
}

/** Readers whose endpoint is derived from the profile's Base URL (the others use a fixed endpoint). */
export function readerFollowsBaseUrl(reader: string): boolean {
  return reader === "usage_endpoint" || reader === "zhipu_coding_plan";
}

/** Does this quota-config view (or the host's capability) use explicit readers instead of `auto`? */
export function usesQuotaReaders(view: Pick<QuotaConfigView, "presetOptions"> | null, hasFeature: boolean): boolean {
  return hasFeature || Array.isArray(view?.presetOptions);
}

/** The picker's choices: cutex's `presetOptions` (never `auto`), else `custom` + the known readers. */
export function quotaPresetChoices(view: Pick<QuotaConfigView, "presetOptions">): string[] {
  const listed = Array.isArray(view.presetOptions) ? view.presetOptions.filter((v) => typeof v === "string" && v && v !== "auto") : [];
  const out = listed.length ? listed : ["custom", ...QUOTA_READERS];
  return out.includes("custom") ? out : ["custom", ...out];
}

/** A named reader is chosen (not `custom`, not the legacy `auto`): its endpoint is the reader's, not editable. */
export function isQuotaReaderPreset(preset: string): boolean {
  return preset !== "custom" && preset !== "auto";
}

/** With readers, a draft still on the legacy `auto` cannot be saved (cutex answers 400): the user picks one first. */
export function quotaDraftNeedsReader(draft: Pick<QuotaConfigView, "preset"> | null, readers: boolean): boolean {
  return readers && draft?.preset === "auto";
}

/** A quota-config draft with no reader on (primary off, no enabled extra): cutex reads nothing. */
export function quotaReadersOff(config: Pick<QuotaConfigView, "primary" | "extras">): boolean {
  return !config.primary.enabled && !config.extras.some((x) => x.enabled);
}

/** The draft with its primary reader switched on (the one-click 启用; saved by the save bar). */
export function withPrimaryEnabled<T extends Pick<QuotaConfigView, "primary">>(config: T): T {
  return { ...config, primary: { ...config.primary, enabled: true } };
}

/** cutex's reason for each gauge it could not read ("label: error"); empty when none failed. */
export function gaugeErrors(gauges: readonly QuotaGauge[]): string[] {
  return gauges.filter((g) => g.error).map((g) => `${gaugeLabel(g)}: ${g.error}`);
}

/** cutex gauges first; a live gauge with the same id replaces it when newer, otherwise is appended. */
export function mergeGauges(base: QuotaGauge[], live: QuotaGauge[]): QuotaGauge[] {
  const out = [...base];
  for (const g of live) {
    const i = out.findIndex((x) => x.id === g.id);
    if (i < 0) out.push(g);
    else if ((g.observedAt ?? 0) > (out[i]!.observedAt ?? 0)) out[i] = g;
  }
  return out;
}

/** Newest observedAt (unix seconds) among gauges, or null. */
export function latestObservedAt(gauges: QuotaGauge[]): number | null {
  let best: number | null = null;
  for (const g of gauges) if (g.observedAt && (best === null || g.observedAt > best)) best = g.observedAt;
  return best;
}

/** "HH:MM" (local) for a unix-seconds timestamp; "MM-DD HH:MM" when not today. */
export function observedClock(at: number, now = Date.now()): string {
  const d = new Date(at * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date(now).toDateString() ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

/**
 * Should the composer read rate limits from the agent's own runtime? Whenever cutex answered with no
 * gauges for this profile and the runtime is online. `profile-quota-native` alone is not enough:
 * cutex r202 reads ChatGPT accounts only, so Claude profiles still need this path.
 */
export function wantsNativeQuotaFallback(cutexGauges: QuotaGauge[] | undefined, runtimeOnline: boolean): boolean {
  return cutexGauges !== undefined && cutexGauges.length === 0 && runtimeOnline;
}

export function gaugesFromRateLimits(limits: RateLimitsLike | null, observedAt: number | null = null): QuotaGauge[] {
  if (!limits) return [];
  const gauges: QuotaGauge[] = [];
  for (const [id, w] of [["codex-primary", limits.primary], ["codex-secondary", limits.secondary]] as const) {
    if (!w) continue;
    const window = windowLabel(w.windowDurationMins);
    gauges.push({
      id,
      label: window || "Q",
      kind: "window",
      remainingPercent: 100 - w.usedPercent,
      balance: null,
      resetAt: w.resetsAt,
      windowLabel: window || null,
      observedAt,
      stale: false,
    });
  }
  const credits = limits.credits;
  if (credits?.balance && !credits.unlimited) {
    gauges.push({ id: "codex-credits", label: "Credits", kind: "balance", remainingPercent: null, balance: credits.balance, resetAt: null, windowLabel: null, observedAt, stale: false });
  }
  return gauges;
}

/** Used fraction 0..1 for a window gauge, or null when unknown. */
export function usedRatio(g: QuotaGauge): number | null {
  return g.remainingPercent === null ? null : 1 - Math.min(100, Math.max(0, g.remainingPercent)) / 100;
}

type GaugeNaming = Pick<QuotaGauge, "label" | "windowLabel"> & { id?: string };

/** A gauge's own label in the app language: the native Codex credit balance (`codex-credits`, labelled
 *  "Credits" by cutex and by gaugesFromRateLimits) is localized; reader labels are user-chosen and stay. */
export function gaugeName(g: Pick<QuotaGauge, "label"> & { id?: string }): string {
  return g.id === "codex-credits" ? translate("quota.credits") : g.label;
}

/** Display name of a gauge: "GLM 5h", or just "7d" when label and window are the same. */
export function gaugeLabel(g: GaugeNaming): string {
  const label = gaugeName(g);
  return g.windowLabel && g.windowLabel !== g.label ? `${label} ${g.windowLabel}` : label;
}

/** Inside one profile's own view the provider prefix repeats the profile: "5h" instead of "GLM 5h". */
export function gaugeShortLabel(g: GaugeNaming): string {
  return g.windowLabel || gaugeName(g);
}

/** cutex: a quota reader's label is 1–6 ASCII letters / digits (profiles/quota.rs `validate`). */
export function quotaLabelValid(label: string): boolean {
  return /^[A-Za-z0-9]{1,6}$/.test(label);
}

/** The label saved for an empty 标签 field: the window name when it is a valid label (5h, 7d), else "" (cutex refuses it). */
export function defaultQuotaLabel(window: string | null | undefined): string {
  const w = window?.trim() ?? "";
  return quotaLabelValid(w) ? w : "";
}

/** The 标签 field's problem: none, not a valid label, or empty without a window name to stand in. */
export function quotaLabelProblem(label: string, window: string | null | undefined): "bad" | "missing" | null {
  const l = label.trim();
  if (l) return quotaLabelValid(l) ? null : "bad";
  return defaultQuotaLabel(window) ? null : "missing";
}

/** A quota reader as saved: the label trimmed, an empty one filled with `defaultQuotaLabel`. */
export function withQuotaLabel<R extends { label: string; window_label?: string | null }>(reader: R): R {
  const label = reader.label.trim();
  return { ...reader, label: label || defaultQuotaLabel(reader.window_label) };
}

/** Short label for a rolling window: 300 → "5h", 10080 → "7d". */
export function windowLabel(mins: number | null): string {
  if (!mins) return "";
  if (mins % 1440 === 0) return `${mins / 1440}d`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${mins}m`;
}

/** "3h 4m" until a unix-seconds reset time. */
export function resetsIn(resetsAt: number | null, now = Date.now()): string {
  if (!resetsAt) return "";
  const mins = Math.max(0, Math.round((resetsAt * 1000 - now) / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

/** Colour of a USED fraction: danger above 85 %, warn above 60 %. */
export function usageColor(ratio: number): string {
  return ratio > 0.85 ? "var(--danger)" : ratio > 0.6 ? "var(--warn)" : "var(--accent)";
}

// ---- remaining vs used display (UiPrefs.quotaView) ----
// Quota gauges can be shown as what is LEFT (default) or what is USED; the context-window ring and
// the goal budget ring always stay "used". `fill` below is the fraction a ring / bar draws.

export type QuotaView = "remaining" | "used";
export const DEFAULT_QUOTA_VIEW: QuotaView = "remaining";

/** Anything but "used" is the default (remaining). */
export function migrateQuotaView(value: unknown): QuotaView {
  return value === "used" ? "used" : DEFAULT_QUOTA_VIEW;
}

/** Remaining fraction 0..1 for a window gauge, or null when unknown. */
export function remainingRatio(g: QuotaGauge): number | null {
  return g.remainingPercent === null ? null : Math.min(100, Math.max(0, g.remainingPercent)) / 100;
}

/** Fraction a ring / bar fills for a window gauge in the chosen view (null = unknown). */
export function quotaFill(g: QuotaGauge, view: QuotaView): number | null {
  return view === "remaining" ? remainingRatio(g) : usedRatio(g);
}

/** Whole percent shown as text next to a gauge in the chosen view (null = unknown). */
export function quotaPercent(g: QuotaGauge, view: QuotaView): number | null {
  const fill = quotaFill(g, view);
  return fill === null ? null : Math.round(fill * 100);
}

/** Colour by what is LEFT: accent, warn under 40 %, danger under 15 % (the "used" 60 / 85 % mirrored;
 *  same cut-offs as the usage page). */
export function remainingColor(ratio: number): string {
  return ratio < 0.15 ? "var(--danger)" : ratio < 0.4 ? "var(--warn)" : "var(--accent)";
}

/** Colour for a ring / bar filled to `fill` in the given view. */
export function fillColor(fill: number, view: QuotaView = "used"): string {
  return view === "remaining" ? remainingColor(fill) : usageColor(fill);
}

/** i18n key for "剩 62%" / "已用 38%". */
export function quotaTextKey(view: QuotaView): "composer.quota.left" | "composer.quota.used" {
  return view === "remaining" ? "composer.quota.left" : "composer.quota.used";
}

/** Compact countdown for the composer row: "1d18h", "2h17m", "45m". */
export function resetsInCompact(resetsAt: number | null, now = Date.now()): string {
  if (!resetsAt) return "";
  const mins = Math.max(0, Math.round((resetsAt * 1000 - now) / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return d ? `${d}d${h}h` : h ? `${h}h${m}m` : `${m}m`;
}

/** Credit balances arrive as long decimal strings ("62419.1846900000"): show them readably.
 *  compact: "62.4k" for the composer row; otherwise grouped with at most 2 decimals. */
export function formatBalance(balance: string | null, compact = false): string {
  if (balance === null) return "—";
  const n = Number(balance);
  if (!Number.isFinite(n)) return balance;
  if (compact && Math.abs(n) >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 });
}
