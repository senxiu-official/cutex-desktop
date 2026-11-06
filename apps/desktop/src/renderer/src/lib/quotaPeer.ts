// Profile card quota with a same-account reading from another host (display only, owner 2026-11-06).
// When this host's reading is not usable, the card may show the newest usable reading of the same
// account (lib/profileAccountLinks accountLinkIdentity) on another connected host, labelled with that
// host and its age, next to this host's own failure reason. Nothing here writes a store: the store's
// `quotas` (auto-pick, quota wall, composer and every other decision) keep this host's data only.
import { useEffect, useRef, useState } from "react";
import type { ProfileItem, QuotaGauge } from "../../../shared/ipc";
import type { ProfileQuotaDetail } from "../../../shared/claudeAccounts";
import { apiFor } from "../bridge";
import { useProfileAccountLinks } from "./profileAccountLinks";
import { gaugeErrors, latestObservedAt, nextQuotaReset, quotaGaugeNow, quotaUsable } from "./quota";
import { loadHostQuota, useHostQuotas, useHostsQuotas } from "./targetHost";

/** Why this host's own reading is not shown. */
export type LocalQuotaReason =
  | { kind: "expiredLogin" }
  | { kind: "error"; text: string }
  | { kind: "stale"; observedAt: number | null }
  | { kind: "pastReset" }
  | { kind: "none" };

export interface PeerQuotaReading { hostId: string; hostName: string; gauges: readonly QuotaGauge[] | undefined }

export interface CardQuotaView {
  /** Gauges to draw (past-reset ones already unknown); undefined while this host has not answered. */
  gauges: QuotaGauge[] | undefined;
  /** Set when `gauges` are another host's. */
  peer: { hostId: string; hostName: string; observedAt: number | null } | null;
  /** This host's reason, shown beside a peer reading so the peer's numbers never hide it. */
  localReason: LocalQuotaReason | null;
}

/** The failure cutex reports beside the gauges (`nativeQuota`: an expired login, the last read error). */
export function quotaDetailReason(detail: ProfileQuotaDetail | null): LocalQuotaReason | null {
  const meta = detail?.nativeQuota;
  if (!meta) return null;
  if (meta.credentialsExpired === true) return { kind: "expiredLogin" };
  return typeof meta.lastError === "string" && meta.lastError ? { kind: "error", text: meta.lastError } : null;
}

export function localQuotaReason(local: readonly QuotaGauge[] | undefined, now: number, detail: LocalQuotaReason | null): LocalQuotaReason {
  if (detail) return detail;
  const errors = gaugeErrors([...(local ?? [])]);
  if (errors.length) return { kind: "error", text: errors.join("; ") };
  if (!local?.length) return { kind: "none" };
  if (local.every((g) => g.stale)) return { kind: "stale", observedAt: latestObservedAt([...local]) };
  return local.some((g) => quotaGaugeNow(g, now) !== g) ? { kind: "pastReset" } : { kind: "stale", observedAt: latestObservedAt([...local]) };
}

/** This host's reading whenever usable; else the newest usable peer reading; else this host's as it is. */
export function cardQuota(local: readonly QuotaGauge[] | undefined, peers: readonly PeerQuotaReading[], now: number, detail: LocalQuotaReason | null = null): CardQuotaView {
  const shown = (gauges: readonly QuotaGauge[]) => gauges.map((g) => quotaGaugeNow(g, now));
  if (local === undefined || quotaUsable(local, now)) return { gauges: local && shown(local), peer: null, localReason: null };
  let best: (PeerQuotaReading & { gauges: readonly QuotaGauge[] }) | null = null;
  for (const p of peers) {
    if (!p.gauges || !quotaUsable(p.gauges, now)) continue;
    if (!best || (latestObservedAt([...p.gauges]) ?? 0) > (latestObservedAt([...best.gauges]) ?? 0)) best = { ...p, gauges: p.gauges };
  }
  if (!best) return { gauges: shown(local), peer: null, localReason: null };
  return {
    gauges: shown(best.gauges),
    peer: { hostId: best.hostId, hostName: best.hostName, observedAt: latestObservedAt([...best.gauges]) },
    localReason: localQuotaReason(local, now, detail),
  };
}

/** Age of a reading for the peer label: "<1m", "5m", "2h", "3d". */
export function quotaAge(observedAt: number | null, now: number): string {
  if (!observedAt) return "";
  const mins = Math.max(0, Math.floor((now - observedAt * 1000) / 60_000));
  return mins < 1 ? "<1m" : mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`;
}

const HOUR_MS = 3_600_000;

/** The card's quota for a profile of `hostId`, re-evaluated when a shown gauge's reset passes. */
export function useCardQuota(hostId: string, item: ProfileItem): CardQuotaView {
  const local = useHostQuotas(hostId)[item.name];
  const { peers: links } = useProfileAccountLinks(hostId, item);
  const peers = links.filter((p) => p.connected);
  const readings = useHostsQuotas([...new Set(peers.map((p) => p.hostId))]);
  const [, tick] = useState(0);
  const [detail, setDetail] = useState<{ key: string; reason: LocalQuotaReason | null } | null>(null);
  const loaded = useRef(new Set<string>());
  const now = Date.now();
  const usable = local === undefined || quotaUsable(local, now);
  const peerReadings: PeerQuotaReading[] = peers.map((p) => ({ hostId: p.hostId, hostName: p.hostName, gauges: readings[p.hostId]?.[p.profile.name] }));
  const detailKey = `${hostId}\n${item.name}\n${latestObservedAt([...(local ?? [])]) ?? ""}`;
  const peerKey = usable ? "[]" : JSON.stringify(peers.map((p) => [p.hostId, p.profile.name]));

  // Peer readings are loaded only while this host's own is unusable (once per peer while mounted).
  useEffect(() => {
    for (const [peerHost, profile] of JSON.parse(peerKey) as [string, string][]) {
      const key = `${peerHost}\n${profile}`;
      if (loaded.current.has(key)) continue;
      loaded.current.add(key);
      void loadHostQuota(peerHost, profile).catch(() => {});
    }
  }, [peerKey]);

  // This host's failure reason as cutex reports it (an expired login is not a gauge error).
  useEffect(() => {
    if (usable || !peers.length || detail?.key === detailKey) return;
    let alive = true;
    void apiFor(hostId).profileQuotaDetail(item.name).then(
      (d) => { if (alive) setDetail({ key: detailKey, reason: quotaDetailReason(d) }); },
      () => { if (alive) setDetail({ key: detailKey, reason: null }); },
    );
    return () => { alive = false; };
  }, [usable, peers.length, detailKey, detail?.key, hostId, item.name]);

  const view = cardQuota(local, peerReadings, now, detail?.key === detailKey ? detail.reason : null);
  const all = [...(local ?? []), ...peerReadings.flatMap((p) => p.gauges ?? [])];
  const resetKey = all.map((g) => g.resetAt ?? "").join(",");
  const aging = !!view.peer;
  // Wake at the next reset (that gauge turns unknown) and, while a peer's age is shown, every minute.
  useEffect(() => {
    const at = Date.now();
    const next = nextQuotaReset(all, at);
    if (next === null && !aging) return;
    const wait = Math.min(next === null ? Infinity : next - at + 250, aging ? 60_000 : Infinity, HOUR_MS);
    const timer = setTimeout(() => tick((n) => n + 1), wait);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `resetKey` stands for the gauges' reset times
  }, [resetKey, aging, now]);
  return view;
}
