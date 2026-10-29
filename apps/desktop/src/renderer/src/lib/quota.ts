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
/** cutex capability: a quota reader may carry a free-text `display_label` (Chinese ok; gauges report `displayLabel`). */
export const QUOTA_DISPLAY_LABEL_FEATURE = "quota-display-label";
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
export const QUOTA_READERS: readonly QuotaReaderName[] = ["usage_endpoint", "deepseek_balance", "moonshot_balance", "moonshot_cn_balance", "zhipu_coding_plan", "openrouter_key", "kimi_code_plan"];

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
  return reader === "usage_endpoint" || reader === "zhipu_coding_plan" || reader === "kimi_code_plan";
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
    if (i >= 0) {
      if ((g.observedAt ?? 0) > (out[i]!.observedAt ?? 0)) out[i] = g;
      continue;
    }
    // A runtime's Codex-shaped 5h / 7d summary (gaugesFromRateLimits) is the same window as a cutex gauge
    // with that caption (a Claude account's "Claude · 7d"): refresh that one instead of adding a second.
    const same = g.id.startsWith("codex-") && g.kind === "window" && g.windowLabel ? out.findIndex((x) => x.kind === "window" && x.windowLabel === g.windowLabel) : -1;
    if (same < 0) out.push(g);
    else if ((g.observedAt ?? 0) > (out[same]!.observedAt ?? 0)) out[same] = { ...out[same]!, remainingPercent: g.remainingPercent, resetAt: g.resetAt ?? out[same]!.resetAt, observedAt: g.observedAt, stale: false };
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

type GaugeNaming = Pick<QuotaGauge, "label" | "windowLabel"> & { id?: string; displayLabel?: string | null };

/** A gauge's own label in the app language: the native Codex credit balance (`codex-credits`, labelled
 *  "Credits" by cutex and by gaugesFromRateLimits) is localized; reader labels are user-chosen and stay. */
export function gaugeName(g: Pick<QuotaGauge, "label" | "displayLabel"> & { id?: string }): string {
  return g.id === "codex-credits" ? translate("quota.credits") : g.displayLabel || g.label;
}

/** Window captions with a fixed meaning shown in the app language: `month` (the calendar-month quota a cutex
 *  reader names, e.g. the Kimi Code monthly total) → 本月 / This month. Rolling windows ("5h", "7d", "week") and
 *  user-chosen captions stay as they are. */
const WINDOW_NAMES: Record<string, MessageKey> = { month: "quota.window.month" };

/** A window caption in the app language (see WINDOW_NAMES); null / empty stays empty. */
export function windowName(window: string | null | undefined): string {
  if (!window) return "";
  const key = WINDOW_NAMES[window.trim().toLowerCase()];
  return key ? translate(key) : window;
}

/** Display name of a gauge: "GLM 5h", or just "7d" when label and window are the same. */
export function gaugeLabel(g: GaugeNaming): string {
  const label = gaugeName(g);
  return g.windowLabel && g.windowLabel !== g.label ? `${label} ${windowName(g.windowLabel)}` : label;
}

/** Inside one profile's own view the provider prefix repeats the profile: "5h" instead of "GLM 5h". */
export function gaugeShortLabel(g: GaugeNaming): string {
  return windowName(g.windowLabel) || gaugeName(g);
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

/** Terminal columns of a label: CJK / fullwidth characters count 2, the rest 1 (cutex `quota-display-label`). */
export function labelColumns(text: string): number {
  let cols = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const wide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x20000 && c <= 0x3fffd);
    cols += wide ? 2 : 1;
  }
  return cols;
}

/** cutex `quota-display-label`: 1–6 columns of printable text, CJK counting 2. */
export function displayLabelValid(label: string): boolean {
  const cols = labelColumns(label);
  return cols >= 1 && cols <= 6 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(label);
}

/** What the 标签 field shows: the display label when set, else the ASCII label. */
export function quotaLabelText(reader: { label: string; display_label?: string | null }): string {
  return reader.display_label || reader.label;
}

/** The reader after typing `text` into 标签. With the capability anything `displayLabelValid` is kept as the display
 *  label (an ASCII-valid label stays a plain label); without it the text is the ASCII label as before. */
export function withLabelText<R extends { label: string; display_label?: string | null }>(reader: R, text: string, displayLabels: boolean): R {
  if (!displayLabels || quotaLabelValid(text.trim()) || !text.trim()) return { ...reader, label: text, display_label: null };
  return { ...reader, display_label: text };
}

/** The 标签 field's problem; with `displayLabels` Chinese is fine inside the 6-column limit. */
export function quotaLabelFieldProblem(reader: { label: string; display_label?: string | null; window_label?: string | null }, displayLabels: boolean): "bad" | "missing" | null {
  const text = quotaLabelText(reader).trim();
  if (displayLabels && text) return quotaLabelValid(text) || displayLabelValid(text) ? null : "bad";
  return quotaLabelProblem(text, reader.window_label);
}

/** A quota reader as saved: the label trimmed, an empty one filled with `defaultQuotaLabel`. With `displayLabels`
 *  the display label is sent too ("" clears it) and the ASCII label falls back to the window name, else "Q". */
export function withQuotaLabel<R extends { label: string; window_label?: string | null; display_label?: string | null }>(reader: R, displayLabels = false): R {
  const label = reader.label.trim();
  if (!displayLabels) {
    const { display_label: _drop, ...rest } = reader;
    return { ...rest, label: label || defaultQuotaLabel(reader.window_label) } as R;
  }
  const display = reader.display_label?.trim() ?? "";
  const ascii = quotaLabelValid(label) ? label : defaultQuotaLabel(reader.window_label) || (display ? "Q" : "");
  return { ...reader, label: ascii, display_label: display };
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

// ---- the composer row's rings (per-gauge choices + same-window merging, owner 2026-10-28) ----

/** The owner's per-gauge choice, remembered by gauge name across all Profiles (UiPrefs.quotaGauges). */
export interface GaugeChoice {
  /** The ring shows in the composer row (absent = shown). */
  ring?: boolean;
  /** The reset countdown shows next to it (absent = UiPrefs.quotaResetDefault). */
  reset?: boolean;
}

/** Window gauges whose resets are this close merge into one ring (the owner picked < 10 min). */
export const MERGE_RESET_TOLERANCE_MS = 10 * 60_000;
/** A hidden gauge this close to empty shows temporarily (red via remainingColor), then hides again. */
export const GAUGE_EMERGENCY_REMAINING = 0.15;

/** The key a gauge's choice is remembered under: its display name ("Claude 7d"), same across Profiles. */
export function gaugeChoiceName(g: Pick<QuotaGauge, "id" | "label" | "windowLabel" | "displayLabel">): string {
  return gaugeLabel(g);
}

/** Stored per-gauge choices (UiPrefs.quotaGauges): keep only sane name → partial choice entries. */
export function migrateGaugeChoices(value: unknown): Record<string, GaugeChoice> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, GaugeChoice> = {};
  for (const [name, choice] of Object.entries(value as Record<string, unknown>)) {
    if (!name || name.length > 64 || !choice || typeof choice !== "object") continue;
    const c = choice as { ring?: unknown; reset?: unknown };
    const ring = typeof c.ring === "boolean" ? c.ring : undefined;
    const reset = typeof c.reset === "boolean" ? c.reset : undefined;
    if (ring !== undefined || reset !== undefined) out[name] = { ...(ring !== undefined && { ring }), ...(reset !== undefined && { reset }) };
  }
  return out;
}

/** One ring of the composer row: a single window gauge, several merged by a shared reset, or a balance. */
export interface ComposerGauge {
  /** The window gauges this ring stands for (2+ when same-reset gauges merged); a balance stands alone. */
  members: QuotaGauge[];
  /** The member the ring draws: the one closest to running out. */
  draw: QuotaGauge;
  /** The countdown's source: the earliest reset among the members. */
  resetAt: number | null;
  /** The countdown text shows next to this ring (any member's choice says yes). */
  showReset: boolean;
  /** A hidden gauge nearly running out forced this ring visible (it hides again once it recovers). */
  emergency: boolean;
  /** A balance gauge: rendered as its text, never merged, not switchable. */
  balance: boolean;
}

/** True when a window gauge is so low it must not stay hidden (red, temporary; recovers at ≥ 15 %). */
function emergencyShown(g: QuotaGauge): boolean {
  const left = remainingRatio(g);
  return left !== null && left < GAUGE_EMERGENCY_REMAINING;
}

/**
 * The composer row's rings from a profile's gauges: per-gauge show choices (by name, the reset
 * default seeding from the old global switch), hidden-but-nearly-empty gauges revealed temporarily,
 * and — unless `merge` is off — window gauges whose resets sit within MERGE_RESET_TOLERANCE_MS of
 * each other as ONE ring drawing the member closest to running out. Balances pass through as text.
 */
export function composerGauges(gauges: readonly QuotaGauge[], choices: Readonly<Record<string, GaugeChoice>>, resetDefault: boolean, merge: boolean, now = Date.now()): ComposerGauge[] {
  const shown: QuotaGauge[] = [];
  const emergency = new Set<string>();
  for (const g of gauges) {
    if (g.kind === "balance") continue;
    const hidden = choices[gaugeChoiceName(g)]?.ring === false;
    if (!hidden) shown.push(g);
    // A hidden window gauge that is nearly empty comes back in red until it recovers (owner 2026-10-28).
    else if (emergencyShown(g)) {
      shown.push(g);
      emergency.add(g.id);
    }
  }
  // Cluster by reset time (transitive: A~B, B~C merges all three); no reset time, nothing to share.
  const groups: QuotaGauge[][] = [];
  for (const g of shown.sort((a, b) => (a.resetAt ?? Infinity) - (b.resetAt ?? Infinity))) {
    const last = groups.at(-1);
    const prev = last?.at(-1);
    const near = g.resetAt !== null && prev?.resetAt != null && (g.resetAt - prev.resetAt) * 1000 <= MERGE_RESET_TOLERANCE_MS;
    if (merge && near) last!.push(g);
    else groups.push([g]);
  }
  // Emit in the gauges' own order, each ring where its first member appears.
  const ringOf = new Map(gauges.map((g, i) => [g.id, i] as const));
  const rings = groups.map((members): ComposerGauge => {
    const draw = members.reduce((worst, m) => {
      const a = remainingRatio(worst);
      const b = remainingRatio(m);
      if (a === null) return m;
      if (b === null) return worst;
      // Closest to running out: the least left; unknown percent loses to a known one.
      return b < a ? m : worst;
    });
    const resetAt = members.reduce<number | null>((earliest, m) => (m.resetAt !== null && (earliest === null || m.resetAt < earliest) ? m.resetAt : earliest), null);
    return {
      members,
      draw,
      resetAt,
      showReset: resetAt !== null && members.some((m) => choices[gaugeChoiceName(m)]?.reset ?? resetDefault),
      emergency: members.some((m) => emergency.has(m.id)),
      balance: false,
    };
  }).sort((a, b) => Math.min(...a.members.map((m) => ringOf.get(m.id) ?? 0)) - Math.min(...b.members.map((m) => ringOf.get(m.id) ?? 0)));
  // Balances keep their place among the rings as plain text.
  const out: ComposerGauge[] = [];
  for (const g of gauges) {
    if (g.kind === "balance") out.push({ members: [g], draw: g, resetAt: null, showReset: false, emergency: false, balance: true });
    else {
      const ring = rings.find((r) => r.members.some((m) => m.id === g.id));
      if (ring && !out.includes(ring)) out.push(ring);
    }
  }
  return out;
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
