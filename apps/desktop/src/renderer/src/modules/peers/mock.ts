// Browser-preview data for 跨主机 (cutex peers-v2; dev/mockTypes.ts): peers in every state, invite /
// join, policy PATCH (merge per field, exports / assumedCaps replaced whole, revision + 1), delete with
// its in-flight check, remote agents, audit, the global `peers` settings, and `cutex/peers/changed`
// on the host feed (outbox counts move every 20 s). The SSH host "alpha" stands in for a
// connection cutex does not see as loopback: every peer write there answers 403 loopback_only.
// `?peerdemo`: 10 s after an invite is created, the other host joins (pending → online).
// Ids / labels match the cross-host delegations of modules/delegations/mock.ts.
// cross-host-tell-wake: workstation-lab lets its tells wake agents here (30 / hour); the others keep the
// default (off). owner-local-only: under `?ownerdevice` (this desktop is a paired owner device on HOST-A)
// pairing / enabling peers answers 403 owner_local_only {action: peerPair | peerEnable | peersEnable}.
import type { AskDetail, CutexRefusal, GlobalSettings } from "../../../../shared/ipc";
import { PEER_POLICY_DEFAULT, PEERS_SETTINGS_DEFAULT, type PeerAgents, type PeerAuditEntry, type PeerPatch, type PeerResult, type PeersSettings, type PeerView } from "../../../../shared/peers";
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
const clone = <T>(x: T): T => structuredClone(x);
const FEATURES = ["asks.v1", "asks.snapshot.v1", "asks.close.v1", "agents.list.v1"];

function peer(id: string, label: string, hostId: string, platform: string, over: Partial<PeerView> = {}): PeerView {
  return {
    id,
    peerId: id,
    instanceId: id,
    label,
    hostId,
    platform,
    userId: "owner",
    urls: [`http://100.79.47.${10 + label.length}:24270`],
    enabled: true,
    protocol: 1,
    state: "online",
    createdAt: iso(5 * 86400),
    lastSeenAt: iso(20),
    lastError: null,
    nextProbeAt: null,
    features: { declared: FEATURES, negotiated: FEATURES },
    outboxPending: 0,
    outboxOldestAt: null,
    outboxOldestAgeSecs: null,
    deadLetterCount: 0,
    inflight: { outbound: 0, inbound: 0 },
    policy: clone(PEER_POLICY_DEFAULT),
    policyRevision: 1,
    ...over,
  };
}

const WORKSTATION_LAB = "ci-7a3f01c2b4d5e6f708192a3b4c5d6e7f";
const ALPHA = "ci-ae3e47b1c2d3e4f5a6b7c8d9e0f1a2b3";
const GPU_BOX = "ci-6b0c1d2e3f405162738495a6b7c8d9e0";

const peers: PeerView[] = [
  peer(WORKSTATION_LAB, "workstation-lab", "WORKSTATION", "linux", {
    urls: ["http://100.64.0.97:24270", "http://workstation.tail1234.ts.net:24270"],
    inflight: { outbound: 2, inbound: 2 },
    policyRevision: 4,
    policy: { inbound: { exports: [{ project: "desktop" }, { agent: "helper" }], accept: true, review: "always", assumedCaps: { sandbox: "read-only", networkAccess: false, unrestrictedServices: false }, maxOpenAsks: 20, asksPerHour: 60, tellWake: true, tellWakesPerHour: 30 }, outbound: { visibility: "all" } },
  }),
  peer(GPU_BOX, "gpu-box", "GPU-BOX", "linux", {
    state: "unreachable",
    lastSeenAt: iso(14 * 3600),
    nextProbeAt: iso(-40),
    lastError: { code: "peer_unreachable", message: "connect to http://100.64.0.98:24270 timed out after 5 s", details: {} },
    outboxPending: 3,
    outboxOldestAt: iso(13.5 * 3600),
    inflight: { outbound: 1, inbound: 0 },
    policy: { ...clone(PEER_POLICY_DEFAULT), outbound: { visibility: "all" } },
    policyRevision: 2,
  }),
  peer("ci-0d1a7c0ffee0d1a7c0ffee0d1a7c0ffe", "old-laptop", "OLD-LAPTOP", "windows", {
    state: "versionMismatch",
    lastSeenAt: iso(3 * 3600),
    lastError: { code: "peer_unsupported", message: "peer lacks required features", details: { missingFeatures: ["asks.close.v1", "agents.list.v1"] } },
    features: { declared: ["asks.v1", "asks.snapshot.v1"], negotiated: ["asks.v1", "asks.snapshot.v1"] },
  }),
  peer("ci-1d3c4a5b6c7d8e9f00112233445566ff", "nas", "NAS", "linux", {
    state: "identityChanged",
    lastSeenAt: iso(2 * 86400),
    lastError: { code: "identity_changed", message: "hello answered instance ci-99… instead of ci-1d3c…", details: {} },
  }),
  peer(ALPHA, "alpha-home", "ALPHA", "macos", {
    state: "removedByPeer",
    enabled: false,
    lastSeenAt: iso(9000),
    lastError: { code: "remote_credential_refused", message: "the peer removed this pairing", details: {} },
    deadLetterCount: 1,
  }),
  peer("ci-5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e", "spare", "SPARE", "windows", { enabled: false, state: "disabled", lastSeenAt: iso(6 * 86400) }),
];

const settings: PeersSettings = { ...PEERS_SETTINGS_DEFAULT, enabled: true };

const agents: Record<string, PeerAgents> = {
  [WORKSTATION_LAB]: {
    fetchedAt: iso(25),
    agents: [
      { cutexSessionId: "cutex.4be81f2a9c", name: "proj-worker", short: "4be81f", status: "busy", runtime: "codex" },
      { cutexSessionId: "cutex.9b2e4f1d77", name: "proj-research", short: "9b2e4f", status: "idle", runtime: "codex" },
      { cutexSessionId: "cutex.c0de11aa22", name: "proj-director", short: "c0de11", status: "idle", runtime: "claude" },
      { cutexSessionId: "cutex.ee77ff0011", name: "proj-glm-research", short: "ee77ff", status: "offline", runtime: "codex" },
      // A host that exports a few hundred agents (owner report 2026-10-19) — the list must stay usable.
      ...Array.from({ length: 300 }, (_, i) => {
        const hex = (0x100000 + i * 7919).toString(16).slice(-6);
        return { cutexSessionId: `cutex.${hex}0000`, name: `worker-${String(i + 1).padStart(3, "0")}`, short: hex, status: i % 11 === 0 ? "busy" : i % 3 === 0 ? "offline" : "idle", runtime: i % 4 === 0 ? "claude" : "codex" };
      }),
    ],
  },
  [GPU_BOX]: { fetchedAt: iso(14 * 3600), agents: [{ cutexSessionId: "cutex.77aa01bc3d", name: "trainer", short: "77aa01", status: "idle", runtime: "codex" }] },
};

const inflight: Record<string, AskDetail[]> = {
  [WORKSTATION_LAB]: [
    { askId: "ask-px-run", title: "在 Workstation 上跑 DEMO 回归", requester: { kind: "agent", cutexSessionId: "lead", name: "Lead" }, targetCutexSessionId: "cutex.4be81f2a9c", targetName: "proj-worker", execution: "running", createdAt: iso(600), updatedAt: iso(30), revision: 5, remote: { peerId: WORKSTATION_LAB, label: "workstation-lab", targetName: "proj-worker", syncState: "synced" } },
    { askId: "ask-px-unknown", title: "核对 Workstation 的 asks 存储", requester: { kind: "agent", cutexSessionId: "lead", name: "Lead" }, targetCutexSessionId: "cutex.4be81f2a9c", targetName: "proj-worker", execution: "queued", createdAt: iso(2600), updatedAt: iso(300), revision: 3, remote: { peerId: WORKSTATION_LAB, label: "workstation-lab", targetName: "proj-worker", syncState: "remoteStateUnknown" } },
    { askId: "ask-pin-review", title: "复现 host-a 上的 ws 断线", requester: { kind: "peer", peerId: WORKSTATION_LAB, cutexSessionId: "cutex.9b2e4f1d77", name: "proj-research", label: "workstation-lab" }, targetCutexSessionId: "helper", targetName: "Helper", execution: "pendingReview", createdAt: iso(90), updatedAt: iso(90), revision: 1 },
    { askId: "ask-pin-queued", title: "给 r225 的回滚脚本做一次 dry-run", requester: { kind: "peer", peerId: WORKSTATION_LAB, cutexSessionId: "cutex.9b2e4f1d77", name: "proj-director", label: "workstation-lab" }, targetCutexSessionId: "helper", targetName: "Helper", execution: "queued", createdAt: iso(400), updatedAt: iso(400), revision: 2 },
  ],
  [GPU_BOX]: [
    { askId: "ask-px-held", title: "在 gpu-box 上重跑 proj-r12 的评估", requester: { kind: "agent", cutexSessionId: "lead", name: "Lead" }, targetCutexSessionId: "cutex.77aa01bc3d", targetName: "trainer", execution: "queued", createdAt: iso(1900), updatedAt: iso(1800), revision: 2, remote: { peerId: GPU_BOX, label: "gpu-box", targetName: "trainer", syncState: "peer_unreachable" } },
  ],
};

function audit(p: PeerView): PeerAuditEntry[] {
  if (p.state === "pending") return [];
  const rows: PeerAuditEntry[] = [];
  const base = p.state === "online" ? 30 : 14 * 3600;
  const routes = [
    ["out", "GET /peer/v1/hello", 200, null, 412],
    ["out", "GET /peer/v1/agents", 200, null, 1934],
    ["in", "PUT /peer/v1/asks/{askId}", 200, null, 2210],
    ["out", "POST /peer/v1/events", 200, null, 860],
    ["in", "GET /peer/v1/asks/{askId}", 200, null, 1302],
    ["out", "PUT /peer/v1/asks/{askId}", p.state === "online" ? 200 : 0, p.state === "online" ? null : "peer_unreachable", 0],
    ["in", "PUT /peer/v1/asks/{askId}", 403, "recipient_outside_boundary", 188],
  ] as const;
  for (let i = 0; i < 18; i++) {
    const [direction, route, status, code, bytes] = routes[i % routes.length]!;
    rows.push({ ts: iso(base + i * 410), direction, peerId: p.id, label: p.label, route, askId: route.includes("asks") ? `ask-${(0x5a3c + i).toString(16)}0f3c9e2a1b4d5c6e7f8091a2` : null, status, code, bytes, actingUser: "owner" });
  }
  return rows;
}

function refusal(code: string, message: string, access?: CutexRefusal["access"]): { ok: false; error: CutexRefusal } {
  return { ok: false, error: { code, message, ...(access ? { access } : {}) } };
}

/** `?ownerdevice` (no value / `local`): HOST-A is reached with a paired owner device token (dev/mockBridge.ts). */
const pairedHere = () => {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  return q.has("ownerdevice") && (q.get("ownerdevice") || "local") === "local" && !q.has("noownerlocal");
};
const ownerLocalOnly = (action: "peerPair" | "peerEnable" | "peersEnable") => refusal("owner_local_only", "only on the host itself or over SSH", { action, issuedVia: "pairing" });

const LABEL = /^[a-z0-9-]{1,32}$/;

function applyPatch(p: PeerView, body: PeerPatch): PeerView {
  if (body.label !== undefined) p.label = body.label;
  if (body.urls) p.urls = [...body.urls];
  if (body.enabled !== undefined) {
    p.enabled = body.enabled;
    p.state = body.enabled ? "online" : "disabled";
    if (body.enabled) p.lastSeenAt = new Date().toISOString();
  }
  if (body.policy) {
    p.policy = {
      inbound: { ...p.policy.inbound, ...(body.policy.inbound ?? {}) },
      outbound: { ...p.policy.outbound, ...(body.policy.outbound ?? {}) },
    };
    p.policyRevision = (p.policyRevision ?? 0) + 1;
  }
  return p;
}

let emitChanged: (peerId: string, reason: string) => void = () => {};

function hostSettingsView(core: MockCore): GlobalSettings {
  return core.settingsView() as GlobalSettings;
}

function localApi(core: MockCore) {
  const find = (id: string) => peers.find((p) => p.id === id);
  return {
    async peers() {
      if (core.legacy) return null;
      return { peers: clone(peers.map((p) => ({ ...p, outboxOldestAgeSecs: p.outboxOldestAt ? Math.floor((Date.now() - Date.parse(p.outboxOldestAt)) / 1000) : null }))) };
    },
    async createPeerInvite(request: { label?: string }): Promise<PeerResult<import("../../../../shared/peers").PeerInvite>> {
      if (pairedHere()) return ownerLocalOnly("peerPair");
      const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
      // Same shape as cutex (management/v2/pairing.rs): 8 chars of this alphabet, shown as XXXX-XXXX.
      const raw = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
      const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
      if (new URLSearchParams(location.search).has("peerdemo")) {
        const id = `ci-${Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
        setTimeout(() => {
          peers.push(peer(id, request.label || "new-host", "NEW-HOST", "linux", { state: "pending", lastSeenAt: null }));
          emitChanged(id, "paired");
          setTimeout(() => {
            const p = find(id);
            if (!p) return;
            Object.assign(p, { state: "online", lastSeenAt: new Date().toISOString() });
            emitChanged(id, "online");
          }, 4000);
        }, 10_000);
      }
      return { ok: true, value: { code, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), instanceId: "ci-e7a0021b3c4d5e6f708192a3b4c5d6e7", hostId: "HOST-A", urls: ["http://127.0.0.1:24270", "http://100.101.102.103:24270", "http://host-a.tail1234.ts.net:24270"] } };
    },
    async addPeer(request: { url: string; code: string; label?: string }): Promise<PeerResult<PeerView>> {
      await new Promise((r) => setTimeout(r, 400));
      if (pairedHere()) return ownerLocalOnly("peerPair");
      // cutex compares the code without separators, case-insensitively.
      if (!/^[A-Z0-9]{8}$/i.test(request.code.replace(/[^A-Za-z0-9]/g, ""))) return refusal("invalid_pairing_code", "invalid pairing code");
      if (!/^http:\/\/(127\.0\.0\.1|100\.\d+\.\d+\.\d+|[a-z0-9.-]+\.ts\.net)(:\d+)?\/?$/i.test(request.url)) return refusal("peer_url_insecure", "peer url insecure");
      // Like a mistyped port: nothing listens there.
      if (!/:24270\/?$/.test(request.url)) return refusal("peer_unreachable", "peer unreachable");
      const label = request.label || "joined";
      if (peers.some((p) => p.label === label)) return refusal("peer_already_active", "a peer with this label already exists");
      const id = `ci-${Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
      const p = peer(id, label, label.toUpperCase(), "linux", { urls: [request.url.replace(/\/$/, "")] });
      peers.push(p);
      emitChanged(id, "paired");
      return { ok: true, value: clone(p) };
    },
    async patchPeer(peerId: string, body: PeerPatch): Promise<PeerResult<PeerView>> {
      const p = find(peerId);
      if (!p) return refusal("peer_not_found", "no such peer");
      if (body.enabled === true && pairedHere()) return ownerLocalOnly("peerEnable");
      if (body.label !== undefined && !LABEL.test(body.label)) return refusal("invalid_request", "label must match ^[a-z0-9-]{1,32}$");
      if (body.label !== undefined && peers.some((x) => x !== p && x.label === body.label)) return refusal("invalid_request", "label already used");
      applyPatch(p, body);
      emitChanged(peerId, "updated");
      return { ok: true, value: clone(p) };
    },
    async deletePeer(peerId: string): Promise<PeerResult<{ removed: boolean }>> {
      const i = peers.findIndex((p) => p.id === peerId);
      if (i < 0) return refusal("peer_not_found", "no such peer");
      peers.splice(i, 1);
      delete inflight[peerId];
      emitChanged(peerId, "removed");
      return { ok: true, value: { removed: true } };
    },
    async peerInflight(peerId: string) {
      return clone(inflight[peerId] ?? []);
    },
    async peerAgents(peerId: string) {
      await new Promise((r) => setTimeout(r, 250));
      const p = find(peerId);
      const a = agents[peerId] ?? { fetchedAt: p?.state === "online" ? new Date().toISOString() : null, agents: [] };
      if (p?.state === "online") a.fetchedAt = new Date().toISOString();
      return clone(a);
    },
    async peerAudit(peerId: string) {
      const p = find(peerId);
      return p ? audit(p) : [];
    },
    async patchPeersSettings(patch: Partial<PeersSettings>): Promise<PeerResult<GlobalSettings>> {
      if (patch.enabled === true && pairedHere()) return ownerLocalOnly("peersEnable");
      Object.assign(settings, patch);
      return { ok: true, value: hostSettingsView(core) };
    },
  };
}

/**
 * The other SSH hosts. workstation (switch to it in the host menu) answers its own list (paired with host-a) and refuses
 * every write with `loopback_only`, as a cutex does when the desktop reaches it over a non-loopback link: the page
 * learns that from the first refusal and turns read-only. alpha (never reachable in the mock) has host-a unpaired.
 */
function remoteApi(hostId: string, emitHost: (method: string, params: Record<string, unknown>) => void) {
  const refused = async () => refusal("loopback_only", "peer administration requires a loopback Management connection");
  const own: PeerView[] = hostId.includes("ae3e")
    ? [peer("ci-e7a0021b3c4d5e6f708192a3b4c5d6e7", "host-a", "HOST-A", "windows", { state: "removedByPeer", enabled: false, lastError: { code: "unpaired", message: "removed on this host", details: {} } })]
    : [peer("ci-e7a0021b3c4d5e6f708192a3b4c5d6e7", "host-a", "HOST-A", "windows", { inflight: { outbound: 2, inbound: 2 }, policy: { inbound: { exports: [{ all: true }], accept: true, review: "ifTargetWider", assumedCaps: { sandbox: "workspace-write", networkAccess: false, unrestrictedServices: false }, maxOpenAsks: 20, asksPerHour: 60 }, outbound: { visibility: "all" } } })];
  const refuseWrites = !hostId.includes("ae3e");
  void emitHost;
  return {
    async peers() {
      return { peers: clone(own) };
    },
    async peerInflight() {
      return [];
    },
    async peerAgents() {
      return { fetchedAt: new Date().toISOString(), agents: [{ cutexSessionId: "lead", name: "Lead", short: "lead00", status: "idle", runtime: "codex" }] } as PeerAgents;
    },
    async peerAudit(peerId: string) {
      const p = own.find((x) => x.id === peerId);
      return p ? audit(p) : [];
    },
    ...(refuseWrites
      ? { createPeerInvite: refused, addPeer: refused, patchPeer: refused, deletePeer: refused, patchPeersSettings: refused }
      : {
          async patchPeer(peerId: string, body: PeerPatch): Promise<PeerResult<PeerView>> {
            const p = own.find((x) => x.id === peerId);
            if (!p) return refusal("peer_not_found", "no such peer");
            return { ok: true, value: clone(applyPatch(p, body)) };
          },
        }),
  };
}

export const mock: ModuleMock = {
  api: (core) => localApi(core),
  remote: (hostId, emitHost) => remoteApi(hostId, emitHost),
  settings: () => ({ peers: { ...settings } }),
  features: { new: ["peers", "peers-v2", "cross-host-asks", "cross-host-tell-wake"] },
  start(core) {
    if (core.legacy) return;
    emitChanged = (peerId, reason) => core.emitHost("cutex/peers/changed", { peerId, reason });
    // The unreachable peer's outbox grows now and then (an event carries no view: the page refetches).
    setInterval(() => {
      const gpu = peers.find((p) => p.id === GPU_BOX);
      if (!gpu || gpu.state !== "unreachable") return;
      gpu.outboxPending = (gpu.outboxPending ?? 0) + 1;
      gpu.nextProbeAt = new Date(Date.now() + 40_000).toISOString();
      emitChanged(GPU_BOX, "outbox");
    }, 20_000);
  },
};
