// Admission is capability-based: Electron's will-attach-webview event has no senderFrame.
// Main issues a one-use ticket ONLY through app-main-frame IPC. The initial src transports
// that ticket, is never loaded, and is replaced by exact about:blank before guest creation.
export type BrowserPool = "owner" | "agent";
const HOST_ID = /^(?:local|(?:ssh|dev)-[a-zA-Z0-9][a-zA-Z0-9_-]{0,127})$/;
const ATTACH_ID = /^[a-f0-9]{64}$/;
const ATTACH_PREFIX = "about:blank#cutex-browser-attach=";

export function browserPartition(hostId: string, pool: BrowserPool = "owner"): string {
  if (!HOST_ID.test(hostId) || (pool !== "owner" && pool !== "agent")) throw new Error("Invalid browser host or pool");
  return `persist:browser-${pool === "agent" ? "agent-" : ""}${hostId}`;
}

export function matchBrowserPartition(partition: unknown, registeredHostIds: Iterable<string>): { hostId: string; pool: BrowserPool } | undefined {
  if (typeof partition !== "string") return;
  for (const hostId of registeredHostIds) {
    if (!HOST_ID.test(hostId)) continue;
    for (const pool of ["owner", "agent"] as const)
      if (partition === browserPartition(hostId, pool)) return { hostId, pool };
  }
}

export function browserAttachSource(attachId: string): string {
  if (!ATTACH_ID.test(attachId)) throw new Error("Invalid browser attach ticket");
  return ATTACH_PREFIX + attachId;
}

export function browserAttachId(src: unknown): string | undefined {
  if (typeof src !== "string" || !src.startsWith(ATTACH_PREFIX)) return;
  const id = src.slice(ATTACH_PREFIX.length);
  return ATTACH_ID.test(id) ? id : undefined;
}

export interface BrowserAttachReservation {
  attachId: string;
  hostId: string;
  partition: string;
}

export interface BrowserAttachInput {
  moduleEnabled: boolean;
  /** Main-owned proof that the early guest deny handler gate is installed; never renderer input. */
  popupGuardInstalled: boolean;
  registeredHostIds: Iterable<string>;
  appWebContentsId: number;
  senderWebContentsId: number;
  /** Already atomically consumed by main. Never look this up by untrusted host/instance fields. */
  reservation?: BrowserAttachReservation;
  params: Record<string, unknown>;
  webPreferences: Record<string, unknown>;
}

export type BrowserAttachResult = { allowed: true; hostId: string; partition: string }
  | { allowed: false; reason: "module_disabled" | "untrusted_sender" | "unregistered_partition" | "invalid_ticket" | "partition_mismatch" | "popup_guard_unavailable" };

/** Mutates Electron's two mutable objects; never trusts a renderer-supplied preference. */
export function evaluateBrowserAttach(input: BrowserAttachInput): BrowserAttachResult {
  const { webPreferences: prefs, params, reservation } = input;
  // Replace the preference bag instead of attempting to enumerate unsafe present/future keys.
  const partition = params.partition;
  const suppliedPartition = prefs.partition;
  for (const key of Object.keys(prefs)) delete prefs[key];
  Object.assign(prefs, { partition, contextIsolation: true, sandbox: true, webSecurity: true,
    nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
    webviewTag: false, plugins: false, allowRunningInsecureContent: false, disablePopups: true,
    safeDialogs: true, navigateOnDragDrop: false, spellcheck: false });
  // Electron consumes these after the hook; don't allow a token-bearing UA/referrer/preload.
  delete params.preload;
  delete params.webpreferences;
  delete params.httpreferrer;
  delete params.useragent;
  params.allowpopups = false;
  params.nodeintegration = false;
  params.nodeintegrationinsubframes = false;
  params.disablewebsecurity = false;
  if (!input.moduleEnabled) return { allowed: false, reason: "module_disabled" };
  if (!Number.isSafeInteger(input.appWebContentsId) || input.appWebContentsId <= 0 || input.senderWebContentsId !== input.appWebContentsId)
    return { allowed: false, reason: "untrusted_sender" };
  const match = matchBrowserPartition(partition, input.registeredHostIds);
  if (!match) return { allowed: false, reason: "unregistered_partition" };
  if (!reservation || browserAttachId(params.src) !== reservation.attachId || !ATTACH_ID.test(reservation.attachId))
    return { allowed: false, reason: "invalid_ticket" };
  if (reservation.hostId !== match.hostId || reservation.partition !== partition || suppliedPartition !== partition)
    return { allowed: false, reason: "partition_mismatch" };
  if (input.popupGuardInstalled !== true) return { allowed: false, reason: "popup_guard_unavailable" };
  // Native windows remain denied by main's already-installed guard. This only permits popup
  // attempts to reach that guard for one-use owner activation -> same-host tab forwarding.
  prefs.disablePopups = false;
  params.allowpopups = true;
  params.src = "about:blank";
  return { allowed: true, hostId: match.hostId, partition: reservation.partition };
}
