// 桌面 hooks: which host holds the home settings, the home document of that host, the cover image, the
// usage statistics over every host, service tiles and the 「需要你」 list. Data through the module's
// services (ctx.services.daemonFor) — images arrive as data: URLs read by main.
import { useEffect, useMemo } from "react";
import { useLaunchArtView } from "../../lib/launchArt";
import { create } from "zustand";
import { SERVICE_TILES_FEATURE, USER_HOME_FEATURE, type HomeImage, type ServiceTileAnswer } from "../../../../shared/home";
import type { ServiceView, UsageReport } from "../../../../shared/ipc";
import { hostData, type HostData } from "../../lib/hostScope";
import { hostAccessNow, useNonOwnerHosts } from "../../lib/hostAccess";
import { useOwnerDocument } from "../../lib/ownerContext";
import { useApp } from "../../store";
import { services } from "../app";
import { ART_PREFERENCE, backdropId, cachedBackdrop, cachedCoverFor, rememberBackdrop, resolveBackdrop, shownBackdrop, type CoverRead, type DeskBackdrop } from "./backdrop";
import { dockPins } from "./dockModes";
import { bootHost, homeHostOf, type HostChoice } from "./model";
import { dailyTotals, dayKey, daysBefore } from "./stats";
import { homeStore, useHome } from "./store";
import { tileRefreshMs } from "./tile";

type State = ReturnType<typeof useApp.getState>;

/** Every configured host as a home-host choice (connected, owned, this machine). */
export function useHostChoices(): HostChoice[] {
  const hosts = useApp((s) => s.hosts?.hosts);
  const connected = useApp((s) => (s.hosts?.hosts ?? []).map((h) => (hostData(s, h.id)?.daemon.kind === "connected" ? "1" : "0")).join(""));
  const access = useNonOwnerHosts();
  return useMemo(
    () => (hosts ?? [{ id: "local", kind: "local" as const }]).map((h, i) => ({ id: h.id, local: h.kind === "local", connected: connected[i] === "1" || (!hosts && true), owner: access[h.id]?.isOwner !== false })),
    [hosts, connected, access],
  );
}

/** A host's feature set when known (null: not connected / not read yet). */
export function featuresOf(s: State, hostId: string | null): ReadonlySet<string> | null {
  if (!hostId) return null;
  const d: HostData | null = hostData(s, hostId);
  return d && d.daemon.kind === "connected" && d.featuresKnown ? d.features : null;
}

/** Whether `hostId` keeps the home page (`user-home`): true / false, null while unknown. */
export function useHostKeepsHome(hostId: string | null): boolean | null {
  return useApp((s) => {
    const f = featuresOf(s, hostId);
    return f ? f.has(USER_HOME_FEATURE) : null;
  });
}

/**
 * The home page source: the boot host (this machine's, else the first owner host) unless its settings
 * name another connected owner host. `entry` / `update` are that host's document.
 */
export function useHomeSource() {
  const choices = useHostChoices();
  const boot = bootHost(choices);
  const bootHome = useHome(boot, useHostKeepsHome(boot));
  const hostId = homeHostOf(boot, bootHome.entry?.doc.homeHost, choices);
  const home = useHome(hostId, useHostKeepsHome(hostId));
  return { boot, hostId, choices, entry: home.entry, update: home.update, bootEntry: bootHome.entry, bootUpdate: bootHome.update };
}

/** How many shortcuts the tray has (`pane.desktop` useDockCount): the home pins. */
export function useDockCount(): number {
  return dockPins(useHomeSource().entry?.doc ?? null).length;
}

/** Outside React (a ref action's run): the home page source host now. */
export function homeSourceNow(): string | null {
  const s = useApp.getState();
  const hosts = s.hosts?.hosts ?? [{ id: "local", kind: "local" as const }];
  const choices: HostChoice[] = hosts.map((h) => ({ id: h.id, local: h.kind === "local", connected: !s.hosts || hostData(s, h.id)?.daemon.kind === "connected", owner: hostAccessNow(h.id).isOwner }));
  const boot = bootHost(choices);
  return homeHostOf(boot, boot ? homeStore().entry(boot)?.doc.homeHost : null, choices);
}

// ── The cover ──────────────────────────────────────────────────────────────────────────────────

// Per `host|etag`: null = loading, false = the host has none, string = the image (a data: URL).
const covers = create<Record<string, string | null | false>>(() => ({}));

/** The cover read of `hostId` with `etag` (undefined: not asked, null: loading, false: none, string: the image). */
export function useCoverRead(hostId: string | null, etag: string | null): CoverRead {
  const key = hostId && etag ? `${hostId}|${etag}` : null;
  const read = covers((s) => (key ? s[key] : undefined));
  useEffect(() => {
    if (!key || !hostId || !etag || key in covers.getState()) return;
    // The remembered background is this very cover (lib: modules/home/backdrop): no second read.
    const remembered = cachedCoverFor(hostId, etag);
    if (remembered) return void covers.setState({ [key]: remembered });
    covers.setState({ [key]: null });
    services
      .daemonFor(hostId)
      .homeCover()
      .then(
        (img: HomeImage | null) => covers.setState({ [key]: img?.dataUrl ?? false }),
        () => covers.setState((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== key))),
      );
  }, [key, hostId, etag]);
  return read;
}

/** The cover of `hostId` with `etag` as a data: URL (null: none / loading). */
export function useCover(hostId: string | null, etag: string | null): string | null {
  const read = useCoverRead(hostId, etag);
  return typeof read === "string" ? read : null;
}

/**
 * The desktop background to draw now (modules/home/backdrop): the one the home settings say once known
 * (remembered on this device for the next start), until then the remembered one, else the sky scene.
 */
export function useDeskBackdrop(): DeskBackdrop {
  const home = useHomeSource();
  const etag = home.entry?.source === "host" ? (home.entry.coverEtag ?? null) : null;
  const cover = useCoverRead(home.hostId, etag);
  const { art, ready } = useLaunchArtView();
  const artProvider = ART_PREFERENCE.find((p) => art[p]) ?? null;
  const known = resolveBackdrop({ hostId: home.hostId, bootEntry: home.bootEntry, entry: home.entry, cover, artReady: ready, artProvider });
  const knownId = known ? backdropId(known) : null;
  useEffect(() => {
    if (known) void rememberBackdrop(known);
    // `known` is rebuilt each render; its identity is `knownId`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownId]);
  return shownBackdrop(known, cachedBackdrop());
}

/** Seeds the cover cache right after an upload (no second read). */
export function noteCover(hostId: string, etag: string | null, dataUrl: string): void {
  if (etag) covers.setState({ [`${hostId}|${etag}`]: dataUrl });
}

// ── Usage over every host ─────────────────────────────────────────────────────────────────────────

const USAGE_TTL = 5 * 60_000;
const usage = create<{ key: string; at: number; days: Map<string, number> | null; loading: boolean }>(() => ({ key: "", at: 0, days: null, loading: false }));

/** Connected hosts (ids, switcher order); their ledgers are read for the statistics. */
function useConnectedHosts(): string[] {
  const list = useApp((s) => (s.hosts?.hosts ?? [{ id: "local" }]).filter((h) => hostData(s, h.id)?.daemon.kind === "connected").map((h) => h.id).join("\n"));
  return useMemo(() => (list ? list.split("\n") : []), [list]);
}

/**
 * Tokens per day over the last 366 days (the cutex range limit), summed over every connected host's
 * ledger (`/v2/usage` by day). A host without a ledger or with an error is skipped (approximate is fine).
 */
export function useHomeUsage(): { days: Map<string, number> | null; loading: boolean } {
  const hosts = useConnectedHosts();
  const today = dayKey(new Date());
  const key = `${hosts.join(",")}|${today}`;
  const state = usage();
  useEffect(() => {
    const now = Date.now();
    const s = usage.getState();
    if (!hosts.length || s.loading || (s.key === key && now - s.at < USAGE_TTL)) return;
    usage.setState({ loading: true });
    const query = { from: daysBefore(today, 365), to: today, groupBy: ["day" as const] };
    void Promise.all(hosts.map((id) => services.daemonFor(id).usage(query).catch((): UsageReport | null => null))).then((reports) => usage.setState({ key, at: Date.now(), days: dailyTotals(reports), loading: false }));
  }, [key, hosts, today]);
  return { days: state.days, loading: state.loading };
}

// ── Service tiles ──────────────────────────────────────────────────────────────────────────────

interface TileEntry {
  answer: ServiceTileAnswer | null;
  image: string | null;
  at: number;
  loading: boolean;
}
const tiles = create<Record<string, TileEntry>>(() => ({}));

/** A service's tile (cutex `service-tiles`; null: no capability / not served / not read yet) and its image. */
export function useServiceTile(hostId: string, slug: string, enabled: boolean): { answer: ServiceTileAnswer | null; image: string | null } {
  const has = useApp((s) => featuresOf(s, hostId)?.has(SERVICE_TILES_FEATURE) ?? false);
  const key = `${hostId}|${slug}`;
  const entry = tiles((s) => s[key]);
  const on = enabled && has;
  const doc = useOwnerDocument();
  useEffect(() => {
    if (!on) return;
    const load = () => {
      // Not while the window it is drawn in is hidden (minimised, in the tray; a desk window has its own document): a
      // refresh there wakes the service for nothing. Back in view it reads once, unless the entry is still fresh.
      if (doc.hidden) return;
      const e = tiles.getState()[key];
      if (e?.loading || (e && Date.now() - e.at < tileRefreshMs(e.answer?.tile))) return;
      tiles.setState({ [key]: { answer: e?.answer ?? null, image: e?.image ?? null, at: e?.at ?? 0, loading: true } });
      const api = services.daemonFor(hostId);
      void api
        .serviceTile(slug)
        .catch(() => null)
        .then(async (answer) => {
          const image = answer?.tile?.image ? await api.serviceTileImage(slug).catch(() => null) : null;
          tiles.setState({ [key]: { answer, image: image?.dataUrl ?? null, at: Date.now(), loading: false } });
        });
    };
    load();
    const timer = setInterval(load, 60_000);
    doc.addEventListener("visibilitychange", load);
    return () => {
      clearInterval(timer);
      doc.removeEventListener("visibilitychange", load);
    };
  }, [on, key, hostId, slug, doc]);
  return on && entry ? { answer: entry.answer, image: entry.image } : { answer: null, image: null };
}

/** The service record behind a pin (null: the host is not connected or does not list it). */
export function useServiceView(hostId: string, slug: string): ServiceView | null {
  return useApp((s) => hostData(s, hostId)?.services?.find((x) => x.slug === slug) ?? null);
}
