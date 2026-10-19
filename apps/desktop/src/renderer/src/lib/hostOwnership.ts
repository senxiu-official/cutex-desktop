// Host ownership (docs/research/host-ownership-20261019.md §1.3 / §2; UI contract:
// docs/research/host-ownership-ui-contract-20261019.md): who each host's owner person is (cutex
// `/v2/host.owner`, capability `host-owner-person`), whether that is this desktop (its person key
// fingerprint), how this desktop is connected there and with which role — and the 设备 page's split
// into 我的设备 / 我能访问的设备. Hosts without the capability (older cutex) fall back to today's
// rule: this machine plus the SSH hosts the user marked as theirs (`ownedByMe`, desktop-local).
// Pure parts (`hostGroupOf`, `groupHosts`, `connectionOf`) are unit-tested in test/hostOwnership.test.ts.
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { HOST_OWNER_FEATURE, LOCAL_HOST_ID, ownerIsMe, type HostOwner, type HostView, type SshConnectAs } from "../../../shared/hosts";
import type { UsersResult } from "../../../shared/users";
import { apiFor, bridge } from "../bridge";
import { useApp } from "../store";
import { lastAccessOf, useHostAccess } from "./hostAccess";
import { myAccessRow, type MyAccessRow, type MyRole } from "./myAccess";
import { personPublicKeyNow, usePersonIdentity } from "./personIdentity";
import { useHostData, useHostLook } from "./useHostScope";

export type { HostOwner };

/** How this desktop reaches a host: this machine's root credential, an SSH tunnel, a DEV ONLY direct host, a paired device token. */
export type HostConnectionKind = "local" | "ssh" | "dev" | "paired";

/** Which half of 设备 a host goes in. */
export type OwnershipGroup = "mine" | "access";

/** What the grouping needs to know about one host. */
export interface OwnershipFacts {
  id: string;
  kind: HostView["kind"];
  /** `/v2/host.owner` (last known for a disconnected host); null = none reported. */
  owner: HostOwner | null;
  /** The host has `host-owner-person`; null = never read (not connected since the app has known it). */
  capability: boolean | null;
  /** The user marked this host as theirs (fallback for hosts without the capability). */
  ownedByMe: boolean;
}

export function connectionOf(kind: HostView["kind"] | string | undefined, hostId?: string): HostConnectionKind {
  if (kind === "local" || (!kind && hostId === LOCAL_HOST_ID)) return "local";
  if (kind === "ssh") return "ssh";
  if (kind === "dev-direct") return "dev";
  return "paired";
}

/**
 * 我的设备 or 我能访问的设备 (§1.3): with the capability and a confirmed owner person, mine only when
 * that person is this desktop (owner rights over SSH do not make a host "mine"). Otherwise (older
 * cutex, owner unconfirmed, own key unknown) the fallback: this machine, and hosts marked `ownedByMe`.
 */
export function hostGroupOf(facts: OwnershipFacts, myFingerprint: string | null | undefined): OwnershipGroup {
  if (facts.capability === true) {
    const mine = ownerIsMe(facts.owner, myFingerprint);
    if (mine !== null) return mine ? "mine" : "access";
  }
  return connectionOf(facts.kind, facts.id) === "local" || facts.ownedByMe ? "mine" : "access";
}

/** The 设备 page split, in the given order. */
export function groupHosts(hosts: readonly OwnershipFacts[], myFingerprint: string | null | undefined): { mine: string[]; access: string[] } {
  const out = { mine: [] as string[], access: [] as string[] };
  for (const h of hosts) out[hostGroupOf(h, myFingerprint)].push(h.id);
  return out;
}

// ---------- owner store (per host; remembered for disconnected hosts) ----------

interface OwnerEntry {
  owner: HostOwner | null;
  capability: boolean;
  /** Connection epoch the entry was read on (null: remembered from an earlier run). */
  epoch: string | null;
}

const OWNER_KEY = "cutex-desktop.hostOwner";
const OWNED_KEY = "cutex-desktop.hostOwnedByMe";

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not persisted
  }
}

function loadOwners(): Record<string, OwnerEntry> {
  const raw = readJson<Record<string, { owner?: HostOwner | null; capability?: boolean }>>(OWNER_KEY, {});
  const out: Record<string, OwnerEntry> = {};
  for (const [id, e] of Object.entries(raw)) if (e && typeof e === "object") out[id] = { owner: e.owner ?? null, capability: e.capability === true, epoch: null };
  return out;
}

const useOwners = create<Record<string, OwnerEntry>>(() => loadOwners());
const useOwned = create<Record<string, true>>(() => readJson<Record<string, true>>(OWNED_KEY, {}));
const inFlight = new Map<string, string>();

function noteOwner(hostId: string, entry: OwnerEntry): void {
  useOwners.setState({ [hostId]: entry });
  const remembered = Object.fromEntries(Object.entries(useOwners.getState()).map(([id, e]) => [id, { owner: e.owner, capability: e.capability }]));
  writeJson(OWNER_KEY, remembered);
}

/** Read `/v2/host.owner` of a connected host once per connection epoch (`force`: again). */
export function loadHostOwner(hostId: string, epoch: string, force = false): void {
  const have = useOwners.getState()[hostId];
  if ((!force && have?.epoch === epoch) || inFlight.get(hostId) === epoch) return;
  const host = apiFor(hostId);
  if (typeof host.hostOwner !== "function") return;
  inFlight.set(hostId, epoch);
  host.hostOwner().then(
    (owner) => {
      if (inFlight.get(hostId) === epoch) inFlight.delete(hostId);
      noteOwner(hostId, { owner, capability: owner !== null, epoch });
    },
    () => {
      // Not readable now (disconnected mid-call, an odd host): keep what was known, do not retry this epoch.
      if (inFlight.get(hostId) === epoch) inFlight.delete(hostId);
      const before = useOwners.getState()[hostId];
      useOwners.setState({ [hostId]: { owner: before?.owner ?? null, capability: before?.capability ?? false, epoch } });
    },
  );
}

/** Non-React: the hosts the user marked as theirs. */
export function ownedByMeNow(hostId: string): boolean {
  return !!useOwned.getState()[hostId];
}

/** 「这是我的设备」 toggle (desktop-local; only used for hosts without `host-owner-person`). */
export function setOwnedByMe(hostId: string, on: boolean): void {
  const next = { ...useOwned.getState() };
  if (on) next[hostId] = true;
  else delete next[hostId];
  useOwned.setState(next, true);
  writeJson(OWNED_KEY, next);
}

/** 「是我」 on this machine: make this desktop's person key the host's owner person. */
export async function confirmOwnerIsMe(hostId: string = LOCAL_HOST_ID): Promise<UsersResult<HostOwner | null>> {
  const publicKey = personPublicKeyNow();
  if (!publicKey) return { ok: false, error: { code: "no_person_key", message: "this desktop has no person key yet" } };
  const r = await apiFor(hostId).setOwnerPerson(publicKey);
  if (r.ok) noteOwner(hostId, { owner: r.value, capability: true, epoch: useOwners.getState()[hostId]?.epoch ?? null });
  return r;
}

// ---------- hooks ----------

export interface HostOwnership {
  /** The host's owner person (last known when disconnected); null: none reported / older cutex / never read. */
  owner: HostOwner | null;
  /** The owner person is this desktop; null when unknown, unconfirmed or an older cutex. */
  mine: boolean | null;
  connection: HostConnectionKind;
  /** SSH hosts: the configured target (`ema@hachimi`). */
  sshTarget?: string;
  /** SSH hosts: the kind of token held (owner / member; `setSshConnectAs` switches). */
  connectAs?: SshConnectAs;
  /** What this desktop is there (lib/myAccess; the last known role of a disconnected host). */
  role: MyRole;
  /** `host-owner-person`: true / false once read; null = never read. */
  capability: boolean | null;
  /** Owner rights without being the owner person (§1.3: 有主人权限, e.g. over SSH into someone else's account). */
  ownerRightsOnly: boolean;
  /** This machine, connected, capability, owner unconfirmed: offer 「是我」. */
  canConfirmHere: boolean;
  /** This machine, connected, capability: the owner person may be set here (also when confirmed). */
  canSetHere: boolean;
  /** The user's own mark (fallback grouping for hosts without the capability). */
  ownedByMe: boolean;
  group: OwnershipGroup;
  /** 「是我」 (canConfirmHere / canSetHere only; refusals such as owner_person_local_only as values). */
  confirmMine(): Promise<UsersResult<HostOwner | null>>;
  setOwnedByMe(on: boolean): void;
  /** Read `/v2/host.owner` again. */
  reload(): void;
}

/** Ownership of one host. */
export function useHostOwnership(hostId: string): HostOwnership {
  const look = useHostLook(hostId);
  const data = useHostData(hostId);
  const access = useHostAccess(hostId);
  const identity = usePersonIdentity();
  const entry = useOwners((s) => s[hostId]);
  const ownedByMe = useOwned((s) => !!s[hostId]);
  const epoch = look?.view.conn?.epoch ?? null;
  const connected = data?.daemon.kind === "connected";
  useEffect(() => {
    if (connected && epoch) loadHostOwner(hostId, epoch);
  }, [hostId, epoch, connected]);
  useEffect(() => {
    if (!connected || !epoch || typeof bridge.on !== "function") return;
    return bridge.on("accessChanged", ({ hostId: from }) => from === hostId && loadHostOwner(hostId, epoch, true));
  }, [hostId, epoch, connected]);

  const kind = look?.kind ?? (hostId === LOCAL_HOST_ID ? "local" : undefined);
  const connection = connectionOf(kind, hostId);
  const features = data?.features;
  const capability = connected && data?.featuresKnown ? features!.has(HOST_OWNER_FEATURE) || !!entry?.owner : (entry ? entry.capability : null);
  const owner = entry?.owner ?? null;
  const live = myAccessRow({ connected, access, features: features ?? new Set(), featuresKnown: data?.featuresKnown ?? false, projects: null });
  const role = live.role === "unknown" ? (lastAccessOf<MyAccessRow>(hostId)?.role ?? "unknown") : live.role;
  const mine = capability ? ownerIsMe(owner, identity.fingerprint) : null;
  const canSetHere = connection === "local" && connected && capability === true && !!identity.publicKey;
  const group = hostGroupOf({ id: hostId, kind: kind ?? "ssh", owner, capability, ownedByMe }, identity.fingerprint);
  return {
    owner,
    mine,
    connection,
    ...(connection === "ssh" && look?.view.target ? { sshTarget: look.view.target } : {}),
    ...(connection === "ssh" ? { connectAs: look?.view.connectAs ?? "owner" } : {}),
    role,
    capability,
    ownerRightsOnly: (role === "owner" || role === "older") && mine === false,
    canConfirmHere: canSetHere && owner !== null && !owner.confirmed,
    canSetHere,
    ownedByMe,
    group,
    confirmMine: () => confirmOwnerIsMe(hostId),
    setOwnedByMe: (on) => setOwnedByMe(hostId, on),
    reload: () => epoch && loadHostOwner(hostId, epoch, true),
  };
}

/**
 * The 设备 page split of every known host (HostsState order). Reads `/v2/host.owner` of the
 * connected ones; disconnected hosts use what was last known.
 */
export function useHostOwnershipGroups(): { mine: string[]; access: string[] } {
  const hosts = useApp((s) => s.hosts);
  const owners = useOwners();
  const owned = useOwned();
  const { fingerprint } = usePersonIdentity();
  const live = (hosts?.hosts ?? []).filter((h) => h.conn?.epoch && h.conn.daemon.kind === "connected").map((h) => `${h.id}\n${h.conn!.epoch}`);
  const liveKey = live.join("\t");
  useEffect(() => {
    for (const pair of live) {
      const [id, epoch] = pair.split("\n") as [string, string];
      loadHostOwner(id, epoch);
    }
  }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps -- `liveKey` stands for `live`
  return useMemo(
    () => groupHosts((hosts?.hosts ?? []).map((h) => ({ id: h.id, kind: h.kind, owner: owners[h.id]?.owner ?? null, capability: owners[h.id] ? owners[h.id]!.capability : null, ownedByMe: !!owned[h.id] })), fingerprint),
    [hosts, owners, owned, fingerprint],
  );
}
