/** Opaque-frame request broker, independent of the desktop module ABI. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Scope { readonly hostId: string; readonly sessionId?: string }
export interface Operation {
  readonly permission: string;
  validate(params: Json): boolean;
  run(params: Json, context: { scope: Scope; instanceId: string; signal: AbortSignal }): Promise<Json> | Json;
}
export interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  start(): void;
  close(): void;
}
export interface BrokerOptions {
  instanceId: string;
  channel: string;
  scope: Scope;
  requestedPermissions: readonly string[];
  grantedPermissions: readonly string[];
  operations: Readonly<Record<string, Operation>>;
  timeoutMs?: number;
  maxPending?: number;
}
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
/** Bound depth, node count and encoded size; reject structured-clone exotic objects. */
export function isJson(value: unknown): value is Json {
  let nodes = 0;
  let characters = 65536;
  function visit(v: unknown, depth: number): boolean {
    if (++nodes > 4096 || depth > 16 || --characters < 0) return false;
    if (v === null || typeof v === "boolean") return true;
    if (typeof v === "string") return (characters -= v.length) >= 0;
    if (typeof v === "number") return Number.isFinite(v);
    if (Array.isArray(v)) {
      // Structured clone preserves sparse arrays and extra enumerable properties.
      // Reject both before stringify can allocate a huge sparse representation.
      if (v.length > 4096 || Object.keys(v).length !== v.length) return false;
      for (let index = 0; index < v.length; index++) {
        if (!Object.hasOwn(v, index) || !visit(v[index], depth + 1)) return false;
      }
      return true;
    }
    return record(v) && Object.keys(v).every(key => (characters -= key.length) >= 0 && !["__proto__", "constructor", "prototype"].includes(key) && visit(v[key], depth + 1));
  }
  return visit(value, 0) && JSON.stringify(value).length <= 65536;
}
function request(value: unknown): value is { version: 1; kind: "request"; instanceId: string; channel: string; id: number; method: string; params: Json } {
  return record(value) && Object.keys(value).sort().join() === "channel,id,instanceId,kind,method,params,version"
    && value.version === 1 && value.kind === "request" && typeof value.instanceId === "string"
    && typeof value.channel === "string" && Number.isSafeInteger(value.id) && (value.id as number) > 0
    && typeof value.method === "string" && value.method.length <= 128 && isJson(value.params);
}

/** One port, one immutable instance/scope. Only host-installed operations are callable. */
export function createBroker(port: Port, options: BrokerOptions) {
  const scope = Object.freeze({ ...options.scope });
  const operations = new Map(Object.entries(options.operations));
  const requested = new Set(options.requestedPermissions);
  const grants = new Set(options.grantedPermissions.filter(permission => requested.has(permission)));
  const pending = new Map<number, { controller: AbortController; permission: string; timer: ReturnType<typeof setTimeout> }>();
  let disposed = false;
  let lastId = 0;
  const post = (id: number, payload: object) => port.postMessage({ version: 1, kind: "response", instanceId: options.instanceId, channel: options.channel, id, ...payload });
  function finish(id: number, payload: object) {
    const work = pending.get(id);
    if (!work) return;
    clearTimeout(work.timer);
    pending.delete(id);
    post(id, payload);
  }
  function abort(id: number, code: string) {
    const work = pending.get(id);
    if (!work) return;
    // Remove before abort: callbacks cannot publish a late result.
    finish(id, { error: { code } });
    work.controller.abort();
  }
  const listener = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (disposed || !request(message) || message.channel !== options.channel || message.instanceId !== options.instanceId) return;
    if (message.id <= lastId) return; // Replay cannot replace an existing request.
    lastId = message.id;
    const operation = operations.get(message.method);
    if (!operation || !grants.has(operation.permission)) return post(message.id, { error: { code: "permission_denied" } });
    let valid = false;
    try { valid = operation.validate(message.params); } catch { /* Fail closed. */ }
    if (!valid) return post(message.id, { error: { code: "invalid_params" } });
    if (pending.size >= (options.maxPending ?? 32)) return post(message.id, { error: { code: "busy" } });
    const controller = new AbortController();
    const timer = setTimeout(() => abort(message.id, "timeout"), options.timeoutMs ?? 30000);
    pending.set(message.id, { controller, permission: operation.permission, timer });
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return null;
      return operation.run(message.params, { scope, instanceId: options.instanceId, signal: controller.signal });
    }).then(result => finish(message.id, isJson(result) ? { result } : { error: { code: "invalid_result" } }),
      () => finish(message.id, { error: { code: "operation_failed" } }));
  };
  port.addEventListener("message", listener);
  port.start();
  return {
    revoke(permission: string) {
      grants.delete(permission);
      for (const [id, work] of pending) if (work.permission === permission) abort(id, "permission_revoked");
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of pending.keys()) abort(id, "disposed");
      port.postMessage({ version: 1, kind: "closed", instanceId: options.instanceId, channel: options.channel });
      port.removeEventListener("message", listener);
      port.close();
    },
    get pendingCount() { return pending.size; },
  };
}
