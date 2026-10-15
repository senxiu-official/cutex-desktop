// Data of Settings → 跨主机 for the settings target host (lib/targetHost): the peer list (refetched on
// `cutex/peers/changed`, which carries no view), the global `peers` settings, and the write path.
// Writes are loopback-only in cutex: when one is refused with `loopback_only` the page turns
// read-only for that connection (keyed by host + routing epoch, so a reconnect tries again).
import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import type { CutexRefusal } from "../../../../shared/ipc";
import { PEERS_CHANGED_EVENT, type PeerResult, type PeersSettings, type PeerView } from "../../../../shared/peers";
import { bridge } from "../../bridge";
import { useI18n, type MessageKey } from "../../i18n";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { useHostData } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { hostLink, peerFailureText } from "./model";

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Connections (`hostId|epoch`) that refused a peer write with loopback_only. */
const useRefusedLinks = create<Record<string, true>>(() => ({}));

/** The target host's connection key and whether peer writes are possible on it. */
export function usePeerWrites(): { key: string; readOnly: boolean; known: "loopback" | "unknown"; markRefused(): void; retry(): void } {
  const hostId = useTargetHostId();
  const host = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId) ?? null);
  const key = `${hostId}|${host?.conn?.epoch ?? ""}`;
  const refused = useRefusedLinks((s) => !!s[key]);
  return {
    key,
    readOnly: refused,
    known: hostLink(host),
    markRefused: () => useRefusedLinks.setState({ [key]: true }),
    retry: () => useRefusedLinks.setState((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== key)) as Record<string, true>),
  };
}

/** A failed peer write in our words (model.ts peerFailureText): a refusal, a thrown error, a raw message. */
export function useRefusalText(): (e: CutexRefusal | Error | string) => string {
  const { t } = useI18n();
  return (e) => peerFailureText(e, (key, vars) => t(key as MessageKey, vars));
}

/**
 * Run a peer write: refusals come back as text (and `loopback_only` turns the page read-only);
 * a thrown error is put in words too when it carries a cutex code. Returns the value, or null after reporting.
 */
export function usePeerWrite() {
  const writes = usePeerWrites();
  const refusal = useRefusalText();
  return useCallback(
    async <T,>(run: () => Promise<PeerResult<T>>, report: (text: string) => void): Promise<T | null> => {
      try {
        const r = await run();
        if (r.ok) return r.value;
        if (r.error.code === "loopback_only") writes.markRefused();
        report(refusal(r.error));
        return null;
      } catch (e) {
        report(refusal(e instanceof Error ? e : message(e)));
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [writes.key],
  );
}

/** Calls `run` (throttled) whenever the target host reports a peer change. */
function usePeersChanged(run: (peerId: string | null) => void) {
  const hostId = useTargetHostId();
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: string | null | undefined;
    const off = bridge.on("hostEvent", ({ hostId: from, envelope }) => {
      if (from !== hostId || envelope.cutex?.method !== PEERS_CHANGED_EVENT) return;
      const params = envelope.cutex.params as { peerId?: unknown } | undefined;
      const id = typeof params?.peerId === "string" ? params.peerId : null;
      // Several peers within the window: refetch for all (null).
      pending = pending === undefined || pending === id ? id : null;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const p = pending ?? null;
        pending = undefined;
        latest.current(p);
      }, 400);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [hostId]);
}

export interface PeersData {
  list: PeerView[] | null;
  unsupported: boolean;
  error: string | null;
}

export function usePeers() {
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const connected = useHostData(hostId)?.daemon.kind === "connected";
  const [data, setData] = useState<PeersData>({ list: null, unsupported: false, error: null });
  // A reply from before a host switch is dropped.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const reply = await api.peers();
      if (mine !== seq.current) return;
      setData(reply ? { list: reply.peers, unsupported: false, error: null } : { list: null, unsupported: true, error: null });
    } catch (e) {
      if (mine === seq.current) setData((d) => ({ ...d, error: message(e) }));
    }
  }, [api]);
  useEffect(() => {
    setData({ list: null, unsupported: false, error: null });
    if (connected) void load();
  }, [hostId, connected, load]);
  usePeersChanged(() => void load());
  const put = useCallback((peer: PeerView) => {
    setData((d) => {
      if (!d.list) return d;
      const i = d.list.findIndex((p) => p.id === peer.id);
      return { ...d, list: i < 0 ? [...d.list, peer] : d.list.map((p) => (p.id === peer.id ? peer : p)) };
    });
  }, []);
  const drop = useCallback((id: string) => setData((d) => (d.list ? { ...d, list: d.list.filter((p) => p.id !== id) } : d)), []);
  return { ...data, load, put, drop };
}

/** `/v2/settings` → `peers` of the target host (null = not read yet / absent). */
export function usePeersSettings() {
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const connected = useHostData(hostId)?.daemon.kind === "connected";
  const [value, setValue] = useState<PeersSettings | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setValue(undefined);
    setError(null);
    if (!connected) return;
    api
      .getSettings()
      .then((s) => mine === seq.current && setValue(s.peers ?? null))
      .catch((e: unknown) => mine === seq.current && setError(message(e)));
  }, [api, hostId, connected]);
  return { value, setValue, error, setError };
}

/**
 * Read something of one peer (agents, audit, inflight) on open; with `follow` also on that peer's
 * change events (not for the remote directory: each read may go over the network).
 */
export function usePeerResource<T>(peerId: string, read: (peerId: string) => Promise<T>, follow = true) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const words = useRefusalText();
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const latest = useRef(read);
  latest.current = read;
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const v = await latest.current(peerId);
      if (mine === seq.current) {
        setValue(v);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(wordsRef.current(e instanceof Error ? e : message(e)));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [peerId]);
  useEffect(() => {
    setValue(null);
    void load();
  }, [load]);
  usePeersChanged((id) => {
    if (follow && (id === null || id === peerId)) void load();
  });
  return { value, error, loading, load };
}
