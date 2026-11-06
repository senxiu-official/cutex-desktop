// Identity menu → 用量 ▸: every profile's quota on the focus host at a glance (one row per profile
// with gauges; the ones without in one quiet line). A row opens Settings at that profile's 额度.
// Mounted only while the flyout is open; it opens at its final size: the rows last shown on this host
// (lib/usageFlyout) — or, the first time, rows predicted from the cached profile list with placeholder
// gauges — while each opening re-reads the list and the quotas in the background. Values update in
// place; the row set changes only once every read finished and it really differs.
import { useEffect, useMemo, useState } from "react";
import type { ProfileItem, QuotaGauge } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { closeMenu } from "../lib/contextMenu";
import { useUiPrefs } from "../lib/prefs";
import { cachedProfileList } from "../lib/profileSnapshot";
import { prepareUsage } from "../lib/usagePreparation";
import { useOrderedProfiles } from "../lib/profileOrder";
import { formatBalance, gaugeShortLabel, quotaFill, quotaPercent, resetsIn, resetsInCompact, type QuotaView } from "../lib/quota";
import { useHostQuotas } from "../lib/targetHost";
import { cachedUsage, predictUsage, PREDICTED_GAUGES, rememberUsage, usageGaugeHeight, usageHeight, usageLayout, type UsageLayout } from "../lib/usageFlyout";
import { useApp } from "../store";
import { GaugeBar } from "./GaugeBar";
import { ProfileAvatar } from "./ProfileAvatar";

/** Rows drawn while nothing is known about the host's profiles (not even the list). */
const UNKNOWN_LAYOUT: UsageLayout = { rows: ["", " "], off: [], counts: { "": PREDICTED_GAUGES, " ": PREDICTED_GAUGES } };

export function UsageFlyout() {
  const { t } = useI18n();
  const hostId = useApp((s) => s.hosts?.active ?? "local");
  const [listed, setProfiles] = useState<ProfileItem[] | null>(() => cachedProfileList(hostId)?.profiles ?? null);
  /** Rows in the owner's manual profile order (lib/profileOrder). */
  const profiles = useOrderedProfiles(listed, hostId);
  // What this host showed last time (read once: this opening's refresh replaces it).
  const [cached] = useState(() => cachedUsage(hostId));
  const [settled, setSettled] = useState(false);
  const quotas = useHostQuotas(hostId);
  const view = useUiPrefs().quotaView;
  useEffect(() => {
    let live = true;
    prepareUsage(hostId)
      .then((list) => {
        if (!live) return;
        setProfiles(list?.profiles ?? []);
      })
      .catch(() => live && setProfiles((p) => p ?? []))
      .finally(() => live && setSettled(true));
    return () => {
      live = false;
    };
  }, [hostId]);
  // Live gauges win; the cached ones fill in until a profile's read arrives (also after the store
  // dropped its quotas on an agent host change).
  const gauges = useMemo<Record<string, QuotaGauge[]>>(() => ({ ...cached?.gauges, ...quotas }), [cached, quotas]);
  const names = useMemo(() => profiles?.map((p) => p.name) ?? [], [profiles]);
  const known = useMemo(() => (profiles ? usageLayout(names, gauges, settled) : null), [profiles, names, gauges, settled]);
  const layout = known ?? cached ?? (profiles ? predictUsage(profiles) : UNKNOWN_LAYOUT);
  // Snapshot once, before paint. Live data may contain a third window where the old predictor
  // reserved two, or profiles may have changed: keep them accessible inside a fixed viewport.
  // The refreshed shape is cached below for the next opening, not applied to this one's bounds.
  const [opening] = useState(() => ({ height: usageHeight(layout), counts: { ...layout.counts } }));
  useEffect(() => {
    if (known) rememberUsage(hostId, { ...known, gauges: Object.fromEntries(known.rows.map((n) => [n, gauges[n]!])) });
  }, [hostId, known, gauges]);
  const open = (profile: string) => {
    closeMenu();
    useApp.getState().openSettings("profiles", { profile, anchor: "quota" });
  };
  const pending = !known;
  return (
    <div className="w-[26rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-1.5rem)] overflow-y-auto" style={{ height: opening.height }} data-usage-flyout="" aria-busy={pending || undefined}>
      {layout.rows.map((name) => {
        const profile = profiles?.find((p) => p.name === name);
        const shown = gauges[name];
        const count = opening.counts[name] || PREDICTED_GAUGES;
        return (
          <button
            key={name}
            role="menuitem"
            disabled={!profile}
            onClick={() => open(name)}
            className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-surface-2 focus:bg-surface-2"
          >
            {profile ? <ProfileAvatar profile={profile} size={18} /> : <span className="h-[18px] w-[18px] shrink-0 rounded-full bg-surface-2" aria-hidden />}
            <span className="w-24 shrink-0 truncate text-sm leading-[18px]">{name.trim() ? name : ""}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto" style={{ height: usageGaugeHeight(count) }} data-usage-gauges="">
              {shown?.map((g) => <GaugeRow key={g.id} gauge={g} view={view} />)}
              {/* Until the row set is final, a row keeps the height it opened with. */}
              {Array.from({ length: Math.max(0, count - (shown?.length ?? 0)) }, (_, i) => (shown?.length ? <span key={i} className="h-[18px] shrink-0" aria-hidden /> : <PlaceholderGauge key={i} />))}
            </span>
          </button>
        );
      })}
      {layout.rows.length === 0 ? (
        <div className="px-2.5 py-1.5 text-xs text-subtle">{t(pending ? "identity.usage.loading" : "identity.usage.none")}</div>
      ) : layout.off.length > 0 ? (
        <div className="h-[26px] truncate px-2.5 pt-1 pb-1.5 text-xs text-subtle" title={layout.off.join(", ")}>
          {t("identity.usage.off", { names: layout.off.join(", ") })}
        </div>
      ) : null}
    </div>
  );
}

/** A gauge line not read yet: same height as `GaugeRow`, an empty bar. */
function PlaceholderGauge() {
  return (
    <span className="flex h-[18px] shrink-0 items-center gap-2 text-xs" aria-hidden>
      <span className="w-14 shrink-0" />
      <span className="h-1 min-w-0 flex-1 animate-skeleton rounded-full bg-surface-2" />
      <span className="w-9 shrink-0 text-right text-subtle">—</span>
      <span className="w-11 shrink-0" />
    </span>
  );
}

/** `5h ▬▬▬▭ 62% 2d19h`; a balance as its amount; the reset countdown inline (exact time on hover). */
export function GaugeRow({ gauge: g, view }: { gauge: QuotaGauge; view: QuotaView }) {
  const { t } = useI18n();
  const fill = quotaFill(g, view);
  const title = g.error ?? (g.resetAt ? `${gaugeShortLabel(g)} · ${t("identity.usage.resets", { time: resetsIn(g.resetAt) })}` : undefined);
  return (
    <span className={`flex h-[18px] shrink-0 items-center gap-2 text-xs tabular-nums ${g.stale ? "opacity-60" : ""}`} title={title}>
      <span className="w-14 shrink-0 truncate text-subtle" title={gaugeShortLabel(g)}>{gaugeShortLabel(g)}</span>
      {g.error ? (
        <span className="min-w-0 flex-1 truncate text-danger">{g.error}</span>
      ) : g.kind === "balance" ? (
        <span className="min-w-0 flex-1 truncate text-muted">{formatBalance(g.balance, true)}</span>
      ) : (
        <>
          <GaugeBar ratio={fill ?? 0} view={view} gauge={g} className="h-1 min-w-0 flex-1" />
          <span className="w-9 shrink-0 text-right text-muted">{fill === null ? "—" : `${quotaPercent(g, view)}%`}</span>
        </>
      )}
      {/* Windows without a reset time (balances, points) leave the slot empty so the columns line up. */}
      <span className="w-11 shrink-0 text-right text-subtle" data-usage-reset="">{!g.error && g.resetAt ? resetsInCompact(g.resetAt) : ""}</span>
    </span>
  );
}
