// The module's running part. Token usage reports → energy (./energy) → taps (./tapper); the number under the pet is
// today's tokens (./today); the waiting mark (./waiting); activity → the exact counters in Settings (./counters).
// Timers exist only while energy is above zero or a save is due, plus one at local midnight; with nothing happening,
// nothing here runs. A hidden pet still counts. A format 2 character (§29.9) works off a pool of the tokens agents
// used instead of tapping (./books, §29.10): it works while the pool has tokens and it is shown.
import { useSyncExternalStore } from "react";
import { DESK_PET_COIN, DESK_PET_ICON_FAMILIES, type DeskPetBookArt, type DeskPetBridge, type DeskPetLabels, type DeskPetView } from "../../../../shared/deskPet";
import type { DeskPetBooks } from "../../../../shared/deskPetScene";
import { connectedHosts } from "../../../../shared/hosts";
import { bridge } from "../../bridge";
import { translate } from "../../i18n";
import { agentFamilyNow } from "../../lib/agentLook";
import { useApp } from "../../store";
import type { ActivityEvent, UsageEvent } from "../../lib/activityFeed";
import type { OwnerWaitingItem } from "../../lib/ownerWaiting";
import type { ModuleContext } from "../slots";
import { addActivity, parseCounters, ZERO, type Counters } from "./counters";
import { artKeyOf, creditPool, emptyPool, nextBookEnd, parsePool, parsePoolConfig, refitPool, workPool, type BookEvent, type PoolConfig, type PoolState } from "./books";
import { addReport, EMPTY, energyAt, paceOf, type EnergyState } from "./energy";
import { petFamilyOf } from "./follow";
import { AT_REST, tap, type TapperState } from "./tapper";
import { addLive, calibrated, dueHosts, freshToday, ledgerTokens, localDay, reconnected, todayTotal, type Today } from "./today";
import { iconAllowed, markOf } from "./waiting";

const SAVE_AFTER_MS = 1000;
const PREF_COUNTS = "counts";
const PREF_POOL = "pool";
const PREF_POOL_CONFIG = "poolConfig";

// ---- what the React parts read ----

let view: DeskPetView | null = null;
let counters: Counters = ZERO;
let tokensToday = 0;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of [...listeners]) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

const viewWatchers = new Set<(v: DeskPetView | null) => void>();
const watchView = (l: (v: DeskPetView | null) => void) => {
  viewWatchers.add(l);
  return () => void viewWatchers.delete(l);
};

export function setView(next: DeskPetView | null): void {
  view = next;
  notify();
  for (const l of [...viewWatchers]) l(next);
}
export const currentView = () => view;
export const useDeskPetView = () => useSyncExternalStore(subscribe, () => view);
export const useCounters = () => useSyncExternalStore(subscribe, () => counters);
export const useTokensToday = () => useSyncExternalStore(subscribe, () => tokensToday);

/** The pool of a format 2 pet with a pile (null otherwise), and its settings, for Settings. */
let poolShown: { state: PoolState; art: DeskPetBookArt; config: PoolConfig } | null = null;
export const usePool = () => useSyncExternalStore(subscribe, () => poolShown);
let setPoolConfigNow: (patch: Partial<PoolConfig>) => void = () => {};
/** Settings: tokens per book and the speed the pool is worked off. */
export const setPoolConfig = (patch: Partial<PoolConfig>) => setPoolConfigNow(patch);

/** What the pet did, for whatever wants to react later (a notification pose, sounds): reserved, nothing listens yet. */
export type DeskPetEvent = BookEvent | { type: "attention-changed"; on: boolean };
const eventListeners = new Set<(event: DeskPetEvent) => void>();
export function onDeskPetEvent(listener: (event: DeskPetEvent) => void): () => void {
  eventListeners.add(listener);
  return () => void eventListeners.delete(listener);
}
const emit = (event: DeskPetEvent) => {
  for (const l of [...eventListeners]) l(event);
};
const shownBooks = (s: PoolState): DeskPetBooks => ({ active: s.active && { id: s.active.book.id, cover: s.active.book.cover }, pile: s.pile.map((b) => ({ id: b.id, cover: b.cover })) });
export const petBridge = (): DeskPetBridge | undefined => bridge.deskPet;

export function menuLabels(): DeskPetLabels {
  return {
    clickThrough: translate("desk-pet.menu.clickThrough"),
    translucent: translate("desk-pet.menu.translucent"),
    mirror: translate("desk-pet.menu.mirror"),
    onlyInFront: translate("desk-pet.menu.onlyInFront"),
    showCount: translate("desk-pet.menu.showCount"),
    size: translate("desk-pet.menu.size"),
    character: translate("desk-pet.menu.character"),
    hide: translate("desk-pet.menu.hide"),
    settings: translate("desk-pet.menu.settings"),
  };
}

function summaryOf(c: Counters, tokens: number): string {
  return translate("desk-pet.summary", { tokens: tokens.toLocaleString(), messages: c.ownerMessage.toLocaleString(), commands: c.command.toLocaleString(), tools: c.tool.toLocaleString() });
}

/** The icon for an agent's tokens: its model family's (the window draws the plain coin when the set has none for it). */
function iconFor(agentId: string): string {
  const family = petFamilyOf(agentId, agentFamilyNow);
  return family && DESK_PET_ICON_FAMILIES.includes(family) ? family : DESK_PET_COIN;
}

let openSettingsPage: (sub?: string) => void = () => {};
/** The module's settings page, from the shell's service. */
export const openPetSettings = () => openSettingsPage();
export const openAllPets = () => openSettingsPage("all");

let resetCounters: () => void = () => {};
/** Settings: back to zero (asked in place first). */
export const resetAllCounters = () => resetCounters();

export function activateDeskPet(ctx: ModuleContext): void {
  const pet = bridge.deskPet;
  // An app without the window service never loads this pack (moduleApi); the browser preview may have none either.
  if (!pet) return;

  counters = parseCounters(ctx.prefs.get(PREF_COUNTS, null));
  notify();

  let energy: EnergyState = EMPTY;
  let tapper: TapperState = AT_REST;
  let tapTimer: ReturnType<typeof setTimeout> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let today: Today = freshToday(localDay(new Date()));
  let lastIcon: number | null = null;
  let seen: ReadonlySet<string> = new Set();
  let marked = false;
  let waiting: readonly OwnerWaitingItem[] = [];
  // A format 2 pet: "at work" instead of taps, while its pool has tokens.
  let scene = false;
  let working = false;
  let pool: PoolState | null = null;
  let bookArt: DeskPetBookArt | null = null;
  let poolConfig: PoolConfig = parsePoolConfig(ctx.prefs.get(PREF_POOL_CONFIG, null));
  let poolDirty = false;
  let poolTimer: ReturnType<typeof setTimeout> | null = null;
  let shownBefore = true;
  /** Agents seen reporting usage: their calls add no energy (it comes from their tokens). */
  const reporting = new Set<string>();
  const settings = () => view?.settings;
  const connected = () => connectedHosts(useApp.getState().hosts);
  const epochsOf = () => JSON.stringify((useApp.getState().hosts?.hosts ?? []).map((h) => [h.id, h.conn?.epoch ?? null]));

  // The number rides on the next pose while the pet moves (one message instead of two); at rest it goes alone.
  let totalDirty = false;
  const flushTotal = () => {
    if (!totalDirty) return;
    totalDirty = false;
    void pet.tick({ total: tokensToday }).catch(() => {});
  };
  const showTotal = () => {
    creditNow();
    const next = todayTotal(today, connected());
    if (next === tokensToday) return;
    tokensToday = next;
    notify();
    totalDirty = true;
    if (!tapTimer) queueMicrotask(flushTotal);
  };

  const save = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (!dirty && !poolDirty) return;
    dirty = false;
    try {
      ctx.prefs.set(PREF_COUNTS, { ...counters });
    } catch {
      // Storage refused: the next save tries again with the same exact numbers.
      dirty = true;
    }
    if (poolDirty && pool) {
      try {
        // Plain data (the shape parsePool reads back), worked off up to now.
        workNow();
        ctx.prefs.set(PREF_POOL, pool as never);
        poolDirty = false;
      } catch {
        dirty = true;
      }
    }
    void pet.tick({ summary: summaryOf(counters, tokensToday) }).catch(() => {});
  };

  // ---- energy → taps: a timer only while energy is above zero ----
  const play = () => {
    tapTimer = null;
    if (scene) {
      // The pool decides (workNow); energy only moves format 1 taps.
      energy = EMPTY;
      return;
    }
    const pace = settings()?.hidden ? 0 : paceOf(energyAt(energy, Date.now()));
    if (pace === 0) energy = EMPTY;
    const next = tap(tapper, pace);
    tapper = next.state;
    const total = totalDirty ? { total: tokensToday } : {};
    totalDirty = false;
    void pet.tick({ pose: next.pose, ...total }).catch(() => {});
    if (next.delay !== null) tapTimer = setTimeout(play, next.delay);
  };
  // ---- the pool: credited from today's count, worked off while shown; one timer, to the end of the book in hand ----
  const shownWork = () => !!pool && !settings()?.hidden && (!!pool.active || pool.pile.length > 0 || pool.below > 0);
  const publish = (moved: boolean) => {
    poolShown = pool && bookArt ? { state: pool, art: bookArt, config: poolConfig } : null;
    notify();
    const work = scene && shownWork();
    const tick: { work?: boolean; books?: DeskPetBooks } = {};
    if (work !== working) tick.work = working = work;
    if (moved && pool) tick.books = shownBooks(pool);
    if (tick.work !== undefined || tick.books) void pet.tick(tick).catch(() => {});
  };
  const armPool = () => {
    if (poolTimer) clearTimeout(poolTimer);
    poolTimer = null;
    const at = pool && shownWork() ? nextBookEnd(pool, poolConfig) : null;
    if (at === null) return;
    poolTimer = setTimeout(() => {
      poolTimer = null;
      workNow();
    }, Math.max(50, at - Date.now() + 20));
  };
  /** Brings the pool up to now: worked off while shown (else the clock only moves), the window told what moved. */
  const workNow = () => {
    if (!pool || !bookArt) return;
    const before = pool;
    // The time since the last step counts as work only if the pet was shown all along it.
    const done = workPool(pool, Date.now(), shownBefore && shownWork(), bookArt, poolConfig);
    shownBefore = !settings()?.hidden;
    pool = done.state;
    const moved = before.active?.book.id !== pool.active?.book.id || before.pile.length !== pool.pile.length || before.pile.at(-1)?.id !== pool.pile.at(-1)?.id;
    if (moved) {
      poolDirty = true;
      saveTimer ??= setTimeout(save, SAVE_AFTER_MS);
    }
    publish(moved);
    for (const e of done.events) emit(e);
    armPool();
  };
  /** Today's count grew: what is new past each host's cursor goes into the pool, once. */
  const creditNow = () => {
    if (!pool || !bookArt) return;
    workNow();
    const totals: Record<string, number> = {};
    for (const hostId of connected()) totals[hostId] = todayTotal(today, [hostId]);
    const before = pool;
    const credited = creditPool(pool, today.day, totals, bookArt, poolConfig);
    if (credited.state === before) return;
    pool = credited.state;
    poolDirty = true;
    saveTimer ??= setTimeout(save, SAVE_AFTER_MS);
    publish(credited.added > 0);
    workNow();
  };
  setPoolConfigNow = (patch) => {
    workNow();
    poolConfig = { ...poolConfig, ...patch };
    try {
      ctx.prefs.set(PREF_POOL_CONFIG, { ...poolConfig });
    } catch {
      // Not saved: it still applies until the app closes.
    }
    publish(false);
    armPool();
  };
  /** The current character decides: taps or a scene, a pile or none. */
  const fitCharacter = (next: DeskPetView | null) => {
    const character = next?.characters.find((c) => c.id === next.current);
    const isScene = !!next?.scenes && character?.format === 2;
    const art = isScene ? (character?.books ?? null) : null;
    if (isScene !== scene) {
      scene = isScene;
      working = false;
      tapper = AT_REST;
      if (tapTimer) clearTimeout(tapTimer);
      tapTimer = null;
      void pet.tick(scene ? { work: false } : { pose: "both" }).catch(() => {});
    }
    if ((art && artKeyOf(art)) !== (bookArt && artKeyOf(bookArt))) {
      workNow();
      bookArt = art;
      if (art) {
        const saved = pool ?? parsePool(ctx.prefs.get(PREF_POOL, null), Date.now()) ?? emptyPool(art, today.day, Date.now());
        pool = refitPool(saved, art, poolConfig);
      }
      poolDirty = !!pool;
      publish(true);
      creditNow();
      armPool();
    } else workNow();
  };
  const energise = (tokens: number) => {
    if (settings()?.hidden || scene) return;
    energy = addReport(energy, tokens, Date.now());
    if (!tapTimer) play();
  };
  const inScope = (hostId: string, agentId: string) => {
    if (!settings()?.currentOnly) return true;
    const s = useApp.getState();
    return hostId === (s.hosts?.active ?? hostId) && agentId === s.selectedId;
  };

  // ---- today's tokens: each connected host's ledger, plus live reports since it answered ----
  let midnight: ReturnType<typeof setTimeout> | null = null;
  const asking = new Set<string>();
  const armMidnight = () => {
    if (midnight) clearTimeout(midnight);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    midnight = setTimeout(() => {
      midnight = null;
      calibrate();
    }, next.getTime() - now.getTime());
  };
  const calibrate = () => {
    if (ctx.signal.aborted) return;
    const day = localDay(new Date());
    if (day !== today.day) {
      today = freshToday(day);
      armMidnight();

    }
    for (const hostId of dueHosts(today, connected(), Date.now())) {
      if (asking.has(hostId)) continue;
      asking.add(hostId);
      const asked = today.day;
      // One small read per host and hour: the daemon sums one local day of its ledger, by source.
      void ctx.services
        .daemonFor(hostId)
        .usage({ from: asked, to: asked, groupBy: ["source"] })
        // Unreachable or refused: keep what was counted live and ask again within the hour.
        .then((report) => (today = calibrated(today, hostId, asked, ledgerTokens(report), Date.now())), () => (today = calibrated(today, hostId, asked, todayTotal(today, [hostId]), Date.now())))
        .finally(() => {
          asking.delete(hostId);
          showTotal();
        });
    }
    showTotal();
  };

  const onUsage = (event: UsageEvent) => {
    reporting.add(`${event.hostId}\n${event.agentId}`);
    today = addLive(today, event.hostId, event.tokens);
    if (localDay(new Date()) !== today.day || dueHosts(today, connected(), Date.now()).length) calibrate();
    showTotal();
    if (!inScope(event.hostId, event.agentId)) return;
    energise(event.tokens);
    if (event.tokens > 0 && settings()?.tokenIcons && !settings()?.hidden) {
      const now = Date.now();
      if (iconAllowed(lastIcon, now)) {
        lastIcon = now;
        void pet.tick({ icon: iconFor(event.agentId) }).catch(() => {});
      }
    }
  };

  const onActivity = (event: ActivityEvent) => {
    counters = addActivity(counters, event.kind);
    notify();
    dirty = true;
    saveTimer ??= setTimeout(save, SAVE_AFTER_MS);
    // A send from here moves the pet at once; an agent's calls only when its runtime reports no usage.
    if (event.kind === "ownerMessage") energise(0);
    else if (event.agentId && !reporting.has(`${event.hostId}\n${event.agentId}`) && inScope(event.hostId, event.agentId)) energise(0);
  };

  // ---- the waiting mark ----
  const showMark = () => {
    const m = markOf(waiting, seen);
    seen = m.seen;
    const on = m.shown && !!settings()?.waitingMark;
    if (on === marked) return;
    marked = on;
    emit({ type: "attention-changed", on });
    void pet.tick({ mark: on }).catch(() => {});
  };
  const onWaiting = (items: readonly OwnerWaitingItem[]) => {
    waiting = items;
    showMark();
  };

  resetCounters = () => {
    counters = ZERO;
    notify();
    dirty = true;
    save();
  };

  // A new connection (or a host gone): its ledger is due; the number covers the connected hosts only.
  let epochs = epochsOf();
  const offHosts = useApp.subscribe((s, prev) => {
    if (s.hosts === prev.hosts) return;
    const now = epochsOf();
    if (now === epochs) return;
    const before = new Map<string, string | null>(JSON.parse(epochs) as [string, string | null][]);
    epochs = now;
    for (const h of s.hosts?.hosts ?? []) if ((h.conn?.epoch ?? null) !== (before.get(h.id) ?? null)) today = reconnected(today, h.id);
    calibrate();
  });

  openSettingsPage = (sub) => ctx.services.ui.openSettings("desk-pet", sub ? { sub } : undefined);
  // Follow the open conversation's model family: a store subscription only while the option is on.
  let offFollow: (() => void) | null = null;
  const sendFamily = () => void pet.follow(petFamilyOf(useApp.getState().selectedId, agentFamilyNow)).catch(() => {});
  const watchFollow = (next: DeskPetView | null) => {
    fitCharacter(next);
    showMark();
    if (!next?.settings.followModel) {
      offFollow?.();
      offFollow = null;
    } else if (!offFollow) {
      sendFamily();
      // The list too: at launch the selection comes before the agents it names.
      offFollow = useApp.subscribe((s, prev) => {
        if (s.selectedId !== prev.selectedId || s.sidebar !== prev.sidebar || s.byHost !== prev.byHost) sendFamily();
      });
    }
  };
  const offWatch = watchView(watchFollow);
  const offState = pet.onState(setView);
  const offSettings = pet.onOpenSettings(openPetSettings);
  ctx.services.activity.subscribe(onActivity);
  ctx.services.activity.subscribeUsage(onUsage);
  armMidnight();
  calibrate();
  void pet.start(menuLabels()).then((started) => {
    if (ctx.signal.aborted) return;
    setView(started);
    ctx.services.activity.subscribeOwnerWaiting(onWaiting);
    void pet.tick({ total: tokensToday, summary: summaryOf(counters, tokensToday), mark: marked, ...(scene ? { work: working } : {}), ...(pool ? { books: shownBooks(pool) } : {}) }).catch(() => {});
  }, () => {});

  // Quitting within a second of an event still keeps it.
  window.addEventListener("pagehide", save);
  ctx.signal.addEventListener("abort", () => {
    window.removeEventListener("pagehide", save);
    if (tapTimer) clearTimeout(tapTimer);
    tapTimer = null;
    if (midnight) clearTimeout(midnight);
    midnight = null;
    if (poolTimer) clearTimeout(poolTimer);
    poolTimer = null;
    setPoolConfigNow = () => {};
    offHosts();
    save();
    offState();
    offSettings();
    offWatch();
    offFollow?.();
    resetCounters = () => {};
    poolShown = null;
    setView(null);
    void pet.stop().catch(() => {});
  }, { once: true });
}
