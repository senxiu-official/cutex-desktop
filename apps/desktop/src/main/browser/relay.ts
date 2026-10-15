import { SseParser, type CutexClient } from "@cutex-desktop/cutex-client";
import type { BrowserOperationResult } from "@cutex-desktop/browser-protocol";
import { BrowserRelayLedger, terminalRelayState, type RelayLedgerEntry } from "./ledger";
import { boundedRelayJson, BrowserRelayError, parseRelayGrant, parseRelayLease, parseRelayMessage, parseRelayRegistration, relayError, relayId, RELAY_GENERATION_HEADER, RELAY_KEY_HEADER, RELAY_MAX_BYTES, RELAY_MAX_LEASES, validateRelayResult, type RelayBinding, type RelayCommand, type RelayErrorCode, type RelayGrant, type RelayLease, type RelayMessage, type RelayRegistration, type RelayResult, type RelayState } from "./relayTypes";

export interface RelayExecutionContext {
  readonly signal: AbortSignal;
  /** Recomputed from the fixed monotonic deadline; never copy it into persistent state. */
  readonly deadline: number;
  remainingMs(): number;
}
export interface BrowserRelayOptions {
  hostId: string; deviceId: string;
  client: Pick<CutexClient, "fetchRaw" | "headers" | "url">;
  execute(command: RelayCommand, context: RelayExecutionContext): Promise<BrowserOperationResult>;
  localLeases(): readonly RelayLease[];
  /** Must synchronously close local admission before any async provider cleanup. */
  revokeLocal(leaseId: string, reason: RelayErrorCode): void;
  onState?(value: { state: "connecting" | "online" | "offline"; code?: RelayErrorCode }): void;
  onAudit?(value: { event: "state" | "lateResult" | "rejected"; requestId?: string; state?: RelayState; code?: RelayErrorCode }): void;
  monotonicNow?: () => number; wallNow?: () => number;
  reconnectDelayMs?: number; requestTimeoutMs?: number;
}
type Connection = { binding: RelayRegistration; ledger: BrowserRelayLedger; leases: Map<string, RelayLease>; abort: AbortController; reader?: ReadableStreamDefaultReader<Uint8Array>; online: boolean; lastEvent: number; ready: () => void; rejectReady: (error: unknown) => void; heartbeat?: ReturnType<typeof setTimeout> };
type Job = { connection: Connection; command: RelayCommand; entry: RelayLedgerEntry; abort: AbortController; timer?: ReturnType<typeof setTimeout> };
const sameTarget = (a: RelayLease["target"], b: RelayCommand["target"]) => a.hostId === b.hostId && a.deviceId === b.deviceId && a.guestId === b.guestId;

/** One main-only client per trusted HostConnection. No renderer transport or credentials getter. */
export class BrowserRelay {
  #options: BrowserRelayOptions;
  #connection?: Connection;
  #opening?: Promise<void>;
  #openingAbort?: AbortController;
  #wanted = false;
  #epoch = 0;
  #retry?: ReturnType<typeof setTimeout>;
  #jobs = new Map<string, Job>();
  #inflight = 0;
  #disposed = false;
  #lastGeneration?: string;
  #ownerActivity = false;
  #mono: () => number;
  #wall: () => number;
  constructor(options: BrowserRelayOptions) {
    relayId(options.hostId); relayId(options.deviceId);
    this.#options = options; this.#mono = options.monotonicNow ?? (() => performance.now()); this.#wall = options.wallNow ?? Date.now;
    for (const value of [options.reconnectDelayMs ?? 1000, options.requestTimeoutMs ?? 5000]) if (!Number.isFinite(value) || value < 1 || value > 30_000) throw new BrowserRelayError("invalid_request");
  }
  binding(): RelayBinding | undefined { const b = this.#connection?.binding; return b ? { deviceId: b.deviceId, hostId: b.hostId, providerId: b.providerId, executor: b.executor, connectionGeneration: b.connectionGeneration } : undefined; }
  get online(): boolean { return this.#connection?.online === true; }
  /** Main-native owner activity only. No page/model timestamp or renderer heartbeat. */
  noteOwnerActivity(): void { if (!this.#disposed) this.#ownerActivity = true; }
  /** Resolves only after the first inventory has reconciled. Repeated start never creates a second stream. */
  start(): Promise<void> {
    if (this.#disposed) return Promise.reject(new BrowserRelayError("browser_unavailable"));
    this.#wanted = true; if (this.online) return Promise.resolve(); if (this.#opening) return this.#opening;
    if (this.#retry) clearTimeout(this.#retry); this.#retry = undefined;
    const epoch = ++this.#epoch; const abort = new AbortController(); this.#openingAbort = abort; this.state("connecting");
    const opening = this.open(epoch, abort).catch(error => { const code = relayError(error); if (epoch === this.#epoch) this.failed(code); throw new BrowserRelayError(code); });
    this.#opening = opening; void opening.finally(() => { if (this.#opening === opening) this.#opening = undefined; }).catch(() => {}); return opening;
  }
  reconnect(): Promise<void> { this.stop(); return this.start(); }
  /** Synchronous admission close, local revoke and abort. Never restores old grants on reconnect. */
  stop(): void { this.#wanted = false; if (this.#retry) clearTimeout(this.#retry); this.#retry = undefined; this.close("stale_connection"); }
  dispose(): void { this.#disposed = true; this.stop(); }
  disconnect(): void { this.stop(); }
  async grantLease(input: RelayGrant): Promise<RelayLease> {
    const c = this.connected(), body = parseRelayGrant(input, c.binding.deviceId);
    if (c.leases.size >= RELAY_MAX_LEASES) throw new BrowserRelayError("lease_limit");
    const result = parseRelayLease(await this.http("POST", "/v2/browser/leases/grant", body, c));
    if (!this.current(c) || result.target.hostId !== c.binding.hostId || result.target.deviceId !== body.deviceId || result.target.guestId !== body.guestId || result.cutexSessionId !== body.cutexSessionId || result.state !== "pending" || result.origin !== (body.source.kind === "agent-open" ? "agent" : "owner")) throw new BrowserRelayError("stale_connection");
    if (c.leases.has(result.leaseId) || c.leases.size >= RELAY_MAX_LEASES) throw new BrowserRelayError("lease_conflict");
    c.leases.set(result.leaseId, structuredClone(result)); return result;
  }
  /** Caller has already prepared provider/hold and exposes that admission in localLeases(). */
  async activateLease(leaseId: string): Promise<RelayLease> {
    relayId(leaseId); const c = this.connected(), prepared = c.leases.get(leaseId); if (!prepared) throw new BrowserRelayError("lease_revoked");
    if (prepared.state !== "pending") throw new BrowserRelayError("lease_conflict");
    const active = { ...prepared, state: "active" as const }; c.leases.set(leaseId, active);
    try {
      const value = parseRelayLease(await this.http("POST", `/v2/browser/leases/${encodeURIComponent(leaseId)}/activate`, { deviceId: c.binding.deviceId }, c));
      if (!this.current(c)) throw new BrowserRelayError("stale_connection");
      if (c.leases.get(leaseId) !== active) throw new BrowserRelayError("lease_revoked");
      if (value.leaseId !== leaseId || value.state !== "active" || !sameTarget(value.target, prepared.target) || value.cutexSessionId !== prepared.cutexSessionId || value.origin !== prepared.origin) throw new BrowserRelayError("invalid_result");
      c.leases.set(leaseId, structuredClone(value)); return value;
    } catch (error) { if (this.current(c)) this.revokeLocal(leaseId, "lease_revoked"); throw new BrowserRelayError(relayError(error)); }
  }
  async revokeLease(leaseId: string): Promise<void> { relayId(leaseId); this.revokeLocal(leaseId, "lease_revoked"); const c = this.connected(); this.ack(await this.http("POST", `/v2/browser/leases/${encodeURIComponent(leaseId)}/revoke`, { deviceId: c.binding.deviceId }, c), "revoked"); }
  private ack(value: unknown, field: string): void { if (!value || typeof value !== "object" || Object.keys(value).join() !== field || (value as Record<string, unknown>)[field] !== true) throw new BrowserRelayError("invalid_result"); }
  private state(state: "connecting" | "online" | "offline", code?: RelayErrorCode): void { try { this.#options.onState?.({ state, ...(code ? { code } : {}) }); } catch { /* Observers do not control authority. */ } }
  private audit(value: Parameters<NonNullable<BrowserRelayOptions["onAudit"]>>[0]): void { try { this.#options.onAudit?.(value); } catch { /* Never log the exception. */ } }
  private current(c: Connection): boolean { return this.#connection === c && !c.abort.signal.aborted; }
  private connected(): Connection { const c = this.#connection; if (!c?.online || c.abort.signal.aborted) throw new BrowserRelayError("browser_unavailable"); return c; }
  private leases(): readonly RelayLease[] { return this.#options.localLeases(); }
  private revokeLocal(leaseId: string, code: RelayErrorCode): void { this.#connection?.leases.delete(leaseId); for (const job of this.#jobs.values()) if (job.command.leaseId === leaseId) this.interrupt(job, "lease_revoked"); try { this.#options.revokeLocal(leaseId, code); } catch { /* Internal admission is already removed even when cleanup throws. */ } }
  private close(code: RelayErrorCode): void {
    ++this.#epoch; this.#openingAbort?.abort(); this.#openingAbort = undefined; this.#opening = undefined;
    const c = this.#connection; this.#connection = undefined;
    if (c) { c.online = false; c.ledger.disconnect(); c.leases.clear(); c.abort.abort(); c.rejectReady(new BrowserRelayError(code)); if (c.heartbeat) clearTimeout(c.heartbeat); void c.reader?.cancel().catch(() => {}); }
    for (const job of this.#jobs.values()) { job.connection.ledger.interrupt(job.entry, "stale_connection"); job.abort.abort(); if (job.timer) clearTimeout(job.timer); this.audit({ event: "state", requestId: job.entry.requestId, state: job.entry.state, ...(job.entry.error ? { code: job.entry.error } : {}) }); }
    this.#jobs.clear(); let leases: readonly RelayLease[] = []; try { leases = this.leases(); } catch { /* No authority is restored if inventory fails. */ }
    for (const lease of leases) this.revokeLocal(lease.leaseId, code); this.state("offline", code);
  }
  private failed(code: RelayErrorCode): void {
    const wanted = this.#wanted; this.close(code); this.#wanted = wanted && !["permission_denied", "browser_disabled", "invalid_request", "unsupported_provider"].includes(code);
    if (this.#wanted) { this.#retry = setTimeout(() => { this.#retry = undefined; void this.start().catch(() => {}); }, this.#options.reconnectDelayMs ?? 1000); this.#retry.unref?.(); }
  }
  private async open(epoch: number, abort: AbortController): Promise<void> {
    const registration = parseRelayRegistration(await this.http("POST", "/v2/browser/devices/register", { deviceId: this.#options.deviceId, hostId: this.#options.hostId, providerId: "browser", executor: "inApp" }, undefined, abort.signal), this.#options);
    if (abort.signal.aborted || epoch !== this.#epoch) throw new BrowserRelayError("stale_connection");
    if (registration.connectionGeneration === this.#lastGeneration) throw new BrowserRelayError("invalid_result"); this.#lastGeneration = registration.connectionGeneration;
    let ready!: () => void, rejectReady!: (error: unknown) => void;
    const first = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; }); void first.catch(() => {});
    const c: Connection = { binding: registration, ledger: new BrowserRelayLedger(registration.connectionGeneration, this.#mono), leases: new Map(), abort, online: false, lastEvent: this.#mono(), ready, rejectReady };
    this.#connection = c;
    const timeout = setTimeout(() => { if (this.current(c) && !c.online) this.failed("browser_unavailable"); }, this.#options.requestTimeoutMs ?? 5000); timeout.unref?.();
    void this.stream(c).catch(error => { if (this.current(c)) this.failed(relayError(error)); });
    try { await first; } finally { clearTimeout(timeout); }
  }
  private headers(c?: Connection, extra: Record<string, string> = {}): Record<string, string> { return this.#options.client.headers({ ...extra, ...(c ? { [RELAY_KEY_HEADER]: c.binding.connectionKey, [RELAY_GENERATION_HEADER]: c.binding.connectionGeneration } : {}) }); }
  private async responseBytes(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
    const length = response.headers.get("Content-Length"); if (length && (!/^\d+$/.test(length) || Number(length) > limit)) { void response.body?.cancel().catch(() => {}); throw new BrowserRelayError("message_too_large"); }
    if (!response.body) throw new BrowserRelayError("invalid_result"); const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", cancel, { once: true });
    try { for (;;) { if (signal.aborted) throw new BrowserRelayError("stale_connection"); const { value, done } = await reader.read(); if (signal.aborted) throw new BrowserRelayError("stale_connection"); if (done) break; size += value.byteLength; if (size > limit) throw new BrowserRelayError("message_too_large"); chunks.push(value); } }
    finally { signal.removeEventListener("abort", cancel); cancel(); reader.releaseLock(); }
    const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; } return all;
  }
  private async http(method: "POST", route: string, body: unknown, c?: Connection, signal?: AbortSignal): Promise<unknown> {
    const abort = new AbortController(), parent = signal ?? c?.abort.signal, cancelled = () => abort.abort(); parent?.addEventListener("abort", cancelled, { once: true }); if (parent?.aborted) abort.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task = (async () => {
      if (abort.signal.aborted) throw new BrowserRelayError("stale_connection");
      const response = await this.#options.client.fetchRaw(this.#options.client.url(route), { method, headers: this.headers(c, { "Content-Type": "application/json" }), body: boundedRelayJson(body), signal: abort.signal, redirect: "error" });
      if (abort.signal.aborted || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")) { void response.body?.cancel().catch(() => {}); throw new BrowserRelayError(abort.signal.aborted ? "stale_connection" : "invalid_result"); }
      let value: unknown; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await this.responseBytes(response, 64 * 1024, abort.signal))); } catch (error) { throw error instanceof BrowserRelayError ? error : new BrowserRelayError("invalid_result"); }
      if (!response.ok) { const error = value && typeof value === "object" && "error" in value ? value.error : undefined; throw new BrowserRelayError(relayError(error)); } return value;
    })(); void task.catch(() => {});
    try { return await Promise.race([task, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { abort.abort(); reject(new BrowserRelayError("browser_unavailable")); }, this.#options.requestTimeoutMs ?? 5000); timer.unref?.(); }), new Promise<never>((_resolve, reject) => { abort.signal.addEventListener("abort", () => reject(new BrowserRelayError("stale_connection")), { once: true }); if (abort.signal.aborted) reject(new BrowserRelayError("stale_connection")); })]); }
    catch (error) { throw new BrowserRelayError(relayError(error)); }
    finally { if (timer) clearTimeout(timer); parent?.removeEventListener("abort", cancelled); }
  }
  private async stream(c: Connection): Promise<void> {
    const response = await this.#options.client.fetchRaw(this.#options.client.url(`/v2/browser/devices/${encodeURIComponent(c.binding.deviceId)}/commands/stream`), { headers: this.headers(c, { Accept: "text/event-stream" }), signal: c.abort.signal, redirect: "error" });
    if (!this.current(c)) { void response.body?.cancel().catch(() => {}); return; }
    if (!response.ok || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "") || !response.body) { void response.body?.cancel().catch(() => {}); throw new BrowserRelayError(response.status === 403 ? "permission_denied" : "browser_unavailable"); }
    const parser = new SseParser(() => { c.lastEvent = this.#mono(); }), decoder = new TextDecoder("utf-8", { fatal: true }); let buffer = "", eventBytes = 0;
    const reader = response.body.getReader(); c.reader = reader;
    try {
      while (this.current(c)) {
        const { done, value } = await reader.read(); if (done) throw new BrowserRelayError("browser_unavailable");
        if (value.byteLength > RELAY_MAX_BYTES + 65536) throw new BrowserRelayError("message_too_large"); buffer += decoder.decode(value, { stream: true });
        if (Buffer.byteLength(buffer) > RELAY_MAX_BYTES + 65536) throw new BrowserRelayError("message_too_large");
        for (;;) {
          const match = /\r\n|\r(?!$)|\n/.exec(buffer); if (!match) break;
          const line = buffer.slice(0, match.index), ended = line + match[0]; buffer = buffer.slice(match.index + match[0].length); eventBytes += Buffer.byteLength(ended);
          if (eventBytes > RELAY_MAX_BYTES + 65536 || (line.startsWith(":") && Buffer.byteLength(line) > 4096)) throw new BrowserRelayError("message_too_large");
          for (const message of parser.push(ended)) {
            if (message.event !== "browser_relay" || message.id !== undefined) throw new BrowserRelayError("invalid_request");
            if (Buffer.byteLength(message.data) > RELAY_MAX_BYTES) throw new BrowserRelayError("message_too_large");
            let data: unknown; try { data = JSON.parse(message.data); } catch { throw new BrowserRelayError("invalid_request"); }
            const parsed = parseRelayMessage(data, c.binding); c.lastEvent = this.#mono(); await this.message(c, parsed); if (!this.current(c)) return;
          }
          if (line === "" || (line.startsWith(":") && eventBytes === Buffer.byteLength(ended))) eventBytes = 0;
        }
      }
    } finally { void reader.cancel().catch(() => {}); }
  }
  private async message(c: Connection, message: RelayMessage): Promise<void> {
    if (!c.online) {
      if (message.kind !== "inventory") throw new BrowserRelayError("invalid_request");
      const local = this.leases();
      for (const lease of local) if (!message.leases.some(remote => remote.leaseId === lease.leaseId && remote.cutexSessionId === lease.cutexSessionId && sameTarget(remote.target, lease.target) && remote.state === lease.state && remote.origin === lease.origin)) this.revokeLocal(lease.leaseId, "lease_revoked");
      for (const lease of message.leases) {
        if (!this.leases().some(localLease => localLease.leaseId === lease.leaseId && localLease.cutexSessionId === lease.cutexSessionId && sameTarget(localLease.target, lease.target) && localLease.state === lease.state && localLease.origin === lease.origin)) this.ack(await this.http("POST", `/v2/browser/leases/${encodeURIComponent(lease.leaseId)}/revoke`, { deviceId: c.binding.deviceId }, c), "revoked");
        else c.leases.set(lease.leaseId, structuredClone(lease));
      }
      if (!this.current(c)) return; c.online = true; c.ready(); this.state("online"); this.heartbeat(c); return;
    }
    if (message.kind === "inventory") throw new BrowserRelayError("invalid_request");
    if (message.kind === "lease-revoked") { this.revokeLocal(message.leaseId, "lease_revoked"); return; }
    if (message.kind === "cancel") { const job = this.#jobs.get(message.requestId); if (job?.entry.dispatchSeq === message.dispatchSeq) this.interrupt(job, "cancelled"); return; }
    this.command(c, message);
  }
  private heartbeat(c: Connection): void {
    c.heartbeat = setTimeout(() => { void (async () => { if (!this.current(c)) return; if (this.#mono() - c.lastEvent >= c.binding.offlineMs) throw new BrowserRelayError("browser_unavailable");
      const active = this.#ownerActivity; this.#ownerActivity = false;
      this.ack(await this.http("POST", `/v2/browser/devices/${encodeURIComponent(c.binding.deviceId)}/heartbeat`, active ? { ownerActivity: true } : {}, c), "online");
      if (this.current(c)) this.heartbeat(c); })().catch(error => { if (this.current(c)) this.failed(relayError(error)); }); }, c.binding.heartbeatMs); c.heartbeat.unref?.();
  }
  private command(c: Connection, command: RelayCommand): void {
    let entry: RelayLedgerEntry | undefined;
    try {
      const accepted = c.ledger.accept(command); entry = accepted.entry;
      if (accepted.duplicate || terminalRelayState(entry.state)) { const existing = this.#jobs.get(command.requestId); if (existing && terminalRelayState(entry.state)) { existing.abort.abort(); if (existing.timer) clearTimeout(existing.timer); this.#jobs.delete(command.requestId); } this.report(c, this.send(c, command, entry, undefined, accepted.duplicate)); return; }
      if (this.#inflight >= 16) { c.ledger.complete(entry, "busy"); this.report(c, this.send(c, command, entry)); return; }
      const known = command.leaseId ? c.leases.get(command.leaseId) : undefined;
      if (command.operation.kind !== "tabs.open" && (!known || known.state !== "active" || known.cutexSessionId !== command.cutexSessionId || !sameTarget(known.target, command.target) || !this.leases().some(lease => lease.leaseId === command.leaseId && lease.state === "active" && lease.cutexSessionId === command.cutexSessionId && sameTarget(lease.target, command.target)))) { c.ledger.complete(entry, "lease_revoked"); this.report(c, this.send(c, command, entry)); return; }
    } catch (error) { const code = relayError(error); this.audit({ event: "rejected", requestId: command.requestId, code }); if (code === "request_conflict") { this.failed(code); return; } if (entry) { c.ledger.complete(entry, code); this.report(c, this.send(c, command, entry)); } else this.report(c, this.rejected(c, command, code)); return; }
    const acceptedEntry = entry;
    const job: Job = { connection: c, command, entry: acceptedEntry, abort: new AbortController() }; this.#jobs.set(command.requestId, job);
    if (!c.ledger.dispatch(acceptedEntry)) { this.#jobs.delete(command.requestId); this.report(c, this.send(c, command, acceptedEntry)); return; }
    job.timer = setTimeout(() => this.interrupt(job, "deadline_exceeded"), c.ledger.remaining(acceptedEntry)); job.timer.unref?.();
    const self = this; const context: RelayExecutionContext = { signal: job.abort.signal, get deadline() { return self.#wall() + c.ledger.remaining(acceptedEntry); }, remainingMs: () => c.ledger.remaining(acceptedEntry) };
    c.ledger.running(acceptedEntry); this.audit({ event: "state", requestId: command.requestId, state: acceptedEntry.state });
    this.#inflight++;
    void (async () => {
      let result: BrowserOperationResult | undefined, executionStarted = false;
      try {
        if (!this.current(c) || job.abort.signal.aborted) throw new BrowserRelayError("stale_connection");
        const input = structuredClone(command);
        executionStarted = true;
        result = validateRelayResult(await this.#options.execute(input, context), command);
        boundedRelayJson({ dispatchSeq: command.dispatchSeq, target: command.target, operationKind: command.operation.kind, status: "succeeded", result });
        if (!c.ledger.complete(acceptedEntry)) { await this.late(job); return; }
      }
      catch (error) { let code = relayError(error); if (executionStarted && acceptedEntry.write && ["cancelled", "deadline_exceeded", "stale_connection", "browser_unavailable", "invalid_result", "message_too_large"].includes(code)) code = "outcome_unknown"; if (!c.ledger.complete(acceptedEntry, code)) { await this.late(job); return; } }
      finally { this.#inflight--; if (job.timer) clearTimeout(job.timer); if (this.#jobs.get(command.requestId) === job) this.#jobs.delete(command.requestId); }
      await this.send(c, command, acceptedEntry, result);
    })().catch(error => { if (this.current(c)) this.failed(relayError(error)); });
  }
  private report(c: Connection, promise: Promise<void>): void { void promise.catch(error => { if (this.current(c)) this.failed(relayError(error)); }); }
  private async late(job: Job): Promise<void> { if (!job.abort.signal.aborted) { job.abort.abort(); await this.send(job.connection, job.command, job.entry); } this.audit({ event: "lateResult", requestId: job.command.requestId }); }
  private interrupt(job: Job, code: "cancelled" | "deadline_exceeded" | "lease_revoked"): void { if (terminalRelayState(job.entry.state)) return; job.connection.ledger.interrupt(job.entry, code); job.abort.abort(); if (job.timer) clearTimeout(job.timer); if (this.#jobs.get(job.entry.requestId) === job) this.#jobs.delete(job.entry.requestId); void this.send(job.connection, job.command, job.entry).catch(error => { if (this.current(job.connection)) this.failed(relayError(error)); }); }
  private async rejected(c: Connection, command: RelayCommand, code: RelayErrorCode): Promise<void> { await this.postResult(c, command, { dispatchSeq: command.dispatchSeq, target: command.target, operationKind: command.operation.kind, status: "failed", error: { code } }); }
  private async send(c: Connection, command: RelayCommand, entry: RelayLedgerEntry, result?: BrowserOperationResult, duplicate = false): Promise<void> {
    const body: RelayResult = { dispatchSeq: command.dispatchSeq, target: command.target, operationKind: command.operation.kind, status: entry.state, ...(duplicate && terminalRelayState(entry.state) ? { metadataOnly: true as const } : {}), ...(entry.error ? { error: { code: entry.error } } : {}), ...(entry.state === "succeeded" && result ? { result } : {}) };
    this.audit({ event: "state", requestId: command.requestId, state: entry.state, ...(entry.error ? { code: entry.error } : {}) }); await this.postResult(c, command, body);
  }
  private async postResult(c: Connection, command: RelayCommand, body: RelayResult): Promise<void> { if (!this.current(c)) return; boundedRelayJson(body); const reply = await this.http("POST", `/v2/browser/devices/${encodeURIComponent(c.binding.deviceId)}/commands/${encodeURIComponent(command.requestId)}/result`, body, c);
    if (!reply || typeof reply !== "object" || Object.keys(reply).sort().join() !== "accepted,late" || !("accepted" in reply) || reply.accepted !== true || !("late" in reply) || typeof reply.late !== "boolean") throw new BrowserRelayError("invalid_result"); if (reply.late) this.audit({ event: "lateResult", requestId: command.requestId }); }
}
