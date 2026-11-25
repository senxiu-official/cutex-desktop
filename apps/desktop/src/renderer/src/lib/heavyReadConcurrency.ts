// 主机详情 → 高级 → 重型读取并发数 (cutex r295 `/v2/settings` heavyReadConcurrency*; desktop spec
// heavy-read-concurrency-desktop-spec.md, 2026-11-25): how many heavy reads (session history, …) the host's
// Management service handles at once. The host computes the automatic number and the choices; the desktop never
// recalculates them nor infers support from a release: the row shows only when these fields are in the settings.
import { useEffect, useRef, useState } from "react";
import type { GlobalSettings } from "../../../shared/ipc";
import { apiFor } from "../bridge";
import { useApp } from "../store";

export interface HeavyReadView {
  /** The saved manual choice, or null = automatic (the host's own number). */
  override: number | null;
  /** The host-computed automatic number. */
  auto: number;
  /** The number the running Management service uses. */
  active: number;
  /** Allowed manual choices (cutex: [2, 4, 6, 8]). */
  options: number[];
  /** The saved choice resolves to another number than the running one: applies after a Management service restart. */
  pending: boolean;
}

/** Choices above this are offered under 高级: the r295 measurement found 4 slots best (+28% throughput over 2), 6 / 8 less steady. */
export const HEAVY_READ_STEADY_MAX = 4;

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** The heavy-read view of a host's settings, or null when the host does not report it (older cutex). */
export function readHeavyRead(settings: GlobalSettings | null | undefined): HeavyReadView | null {
  if (!settings || !("heavyReadConcurrency" in settings)) return null;
  const { heavyReadConcurrency: saved, heavyReadConcurrencyDefault: auto, heavyReadConcurrencyActive: active, heavyReadConcurrencyOptions: options } = settings;
  if (!count(auto) || !count(active) || !Array.isArray(options)) return null;
  const override = count(saved) ? saved : null;
  const choices = [...new Set([...options.filter(count), ...(override !== null ? [override] : [])])].sort((a, b) => a - b);
  return { override, auto, active, options: choices, pending: (override ?? auto) !== active };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The host's heavy-read setting: read on open, on a host switch and after a reconnect (the running number may have
 * changed); `save(n | null)` PATCHes it (null = 恢复默认, automatic). A failed save keeps the last confirmed choice.
 * Another host's values are never shown: a view belongs to the host it was read from.
 */
export function useHeavyRead(hostId: string) {
  const epoch = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.conn?.epoch);
  const [read, setRead] = useState<{ hostId: string; view: HeavyReadView | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    const mine = ++request.current;
    setError(null);
    setBusy(false);
    apiFor(hostId).getSettings().then(
      (settings) => { if (request.current === mine) setRead({ hostId, view: readHeavyRead(settings) }); },
      (e: unknown) => { if (request.current === mine) setError(errorText(e)); },
    );
    return () => { request.current += 1; };
  }, [hostId, epoch]);
  const save = async (value: number | null) => {
    const mine = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const next = await apiFor(hostId).patchSettings({ heavyReadConcurrency: value });
      if (request.current === mine) setRead({ hostId, view: readHeavyRead(next) });
    } catch (e) {
      if (request.current === mine) setError(errorText(e));
    } finally {
      if (request.current === mine) setBusy(false);
    }
  };
  return { view: read?.hostId === hostId ? read.view : null, loaded: read?.hostId === hostId, error, busy, save };
}
