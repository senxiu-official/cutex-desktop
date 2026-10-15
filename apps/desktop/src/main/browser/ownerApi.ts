import type { CutexClient } from "@cutex-desktop/cutex-client";
import type { BrowserAgentView, BrowserIdempotencyClearResult, BrowserImage, BrowserToolItem, BrowserTurnShot } from "../../shared/browser";
import { browserScreenshotDimensions } from "./capture";
import type { BrowserImageDecoder } from "./modelOutput";
import { BrowserRelayError, RELAY_CODES, type RelayErrorCode } from "./relayTypes";

const ID = /^[A-Za-z0-9._:-]{1,200}$/;
const BROWSER_TOOLS = new Set(["browser_list", "browser_read", "browser_find", "browser_act", "browser_navigate",
  "browser_screenshot", "browser_release", "browser_open", "browser_claim"]);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const invalid = () => new BrowserRelayError("invalid_result");
/** Match the actual Codex/MCP and Claude dynamic history identities, not a tool-name prefix. */
function browserItem(item: Record<string, unknown>): boolean {
  return typeof item.tool === "string" && BROWSER_TOOLS.has(item.tool)
    && ((item.type === "mcpToolCall" && item.server === "cutex")
      || (item.type === "dynamicToolCall" && (item.namespace === "claude" || item.namespace === "cutex")));
}
export interface BrowserOwnerApiOptions { client: Pick<CutexClient, "fetchRaw" | "headers" | "url">; check(): void; decodeImage: BrowserImageDecoder }
/** Fixed owner surface; never accepts a renderer route, method, headers or filesystem path. */
export function createBrowserOwnerApi(options: BrowserOwnerApiOptions) {
  async function request(route: string, max = 64 * 1024, patch?: Record<string, unknown>, method: "PATCH" | "POST" = "PATCH"): Promise<unknown> {
    options.check(); const abort = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task = (async () => {
      const response = await options.client.fetchRaw(options.client.url(route), {
        method: patch === undefined ? "GET" : method,
        headers: options.client.headers({ Accept: "application/json", ...(patch === undefined ? {} : { "Content-Type": "application/json" }) }),
        ...(patch === undefined ? {} : { body: JSON.stringify(patch) }), redirect: "error", signal: abort.signal });
      try { options.check(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      if (abort.signal.aborted || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")) { void response.body?.cancel().catch(() => {}); throw invalid(); }
      const limit = response.ok ? max : Math.min(max, 64 * 1024);
      const length = response.headers.get("Content-Length");
      if (length && (!/^\d+$/.test(length) || Number(length) > limit)) { void response.body?.cancel().catch(() => {}); throw invalid(); }
      if (!response.body) throw invalid(); reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      for (;;) { const chunk = await reader.read(); options.check(); if (abort.signal.aborted) throw invalid(); if (chunk.done) break; size += chunk.value.byteLength; if (size > limit) throw invalid(); chunks.push(chunk.value); }
      const result = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result)); } catch { throw invalid(); }
      if (!response.ok) {
        const code = object(parsed) && object(parsed.error) ? parsed.error.code : undefined;
        // A daemon's bounded typed refusal is useful to the owner; its raw message is not.
        if (typeof code === "string" && (RELAY_CODES as readonly string[]).includes(code)) throw new BrowserRelayError(code as RelayErrorCode);
        throw invalid();
      }
      return parsed;
    })(); void task.catch(() => {});
    try { return await Promise.race([task, new Promise<never>((_yes, no) => { timer = setTimeout(() => { abort.abort(); void reader?.cancel().catch(() => {}); no(new BrowserRelayError(patch === undefined ? "browser_unavailable" : "outcome_unknown")); }, 10_000); timer.unref?.(); })]); }
    catch (error) { if (error instanceof BrowserRelayError) throw error; throw new BrowserRelayError(patch === undefined ? "browser_unavailable" : "outcome_unknown"); }
    finally { if (timer) clearTimeout(timer); abort.abort(); void reader?.cancel().catch(() => {}); }
  }
  function validateImage(value: unknown): BrowserImage {
    if (!object(value) || (value.mimeType !== "image/png" && value.mimeType !== "image/jpeg") || typeof value.data !== "string" || value.data.length > 6 * 1024 * 1024) throw invalid();
    try {
      const parsed = browserScreenshotDimensions(value.mimeType, value.data);
      if (Math.max(parsed.width, parsed.height) > 1600) throw invalid();
      // Header/framing checks are only preflight; successful full native decoding is mandatory.
      const image = options.decodeImage(Buffer.from(value.data, "base64")), size = image.getSize();
      if (image.isEmpty() || parsed.width !== size.width || parsed.height !== size.height) throw invalid();
    } catch { throw invalid(); }
    return { mimeType: value.mimeType, data: value.data };
  }
  function validateItem(item: Record<string, unknown>): void {
    if (!browserItem(item) || item.truncated === true) throw invalid();
    const content = item.type === "mcpToolCall" ? (object(item.result) ? item.result.content : undefined) : item.contentItems;
    if (content !== undefined && content !== null) {
      if (!Array.isArray(content) || content.length > 8) throw invalid();
      for (const block of content) {
        if (!object(block) || !["image", "inputImage", "text", "inputText"].includes(block.type as string)
          || ((block.type === "text" || block.type === "inputText") && typeof block.text !== "string")) throw invalid();
      }
    }
    let nodes = 0, images = 0;
    function check(value: unknown, depth: number): void {
      if (++nodes > 20_000 || depth > 24) throw invalid();
      if (Array.isArray(value)) { for (const child of value) check(child, depth + 1); }
      else if (object(value)) {
        if (value.type === "imageNotLoaded") throw invalid();
        if (value.type === "image" || value.type === "inputImage") {
          if (++images > 1) throw invalid();
          if (value.type === "image") validateImage(value);
          else {
            // Claude dynamic items use a data URL; never fetch an external image or local path.
            if (typeof value.imageUrl !== "string" || value.imageUrl.length > 6 * 1024 * 1024 + 32) throw invalid();
            const match = /^data:(image\/(?:png|jpeg));base64,/.exec(value.imageUrl);
            if (!match) throw invalid();
            validateImage({ mimeType: match[1], data: value.imageUrl.slice(match[0].length) });
          }
        }
        for (const child of Object.values(value)) check(child, depth + 1);
      }
    }
    check(item, 0);
  }
  const query = (fields: Record<string, string>) => { for (const value of Object.values(fields)) if (!ID.test(value)) throw new BrowserRelayError("invalid_request"); return new URLSearchParams(fields).toString(); };
  return {
    async settings(agentOpenApproval?: "off" | "ask"): Promise<{ agentOpenApproval: "off" | "ask" }> {
      if (agentOpenApproval !== undefined && agentOpenApproval !== "off" && agentOpenApproval !== "ask") throw new BrowserRelayError("invalid_request");
      const value = await request("/v2/settings", 64 * 1024, agentOpenApproval === undefined ? undefined : { browser: { agentOpenApproval } });
      if (!object(value) || !object(value.browser) || (value.browser.agentOpenApproval !== "off" && value.browser.agentOpenApproval !== "ask")) throw invalid();
      return { agentOpenApproval: value.browser.agentOpenApproval };
    },
    async clearIdempotency(cutexSessionId?: string): Promise<BrowserIdempotencyClearResult> {
      if (cutexSessionId !== undefined && !ID.test(cutexSessionId)) throw new BrowserRelayError("invalid_request");
      const value = await request("/v2/browser/idempotency/clear", 64 * 1024,
        cutexSessionId === undefined ? {} : { cutexSessionId }, "POST");
      if (!object(value) || !Number.isSafeInteger(value.deleted) || (value.deleted as number) < 0
        || !Number.isSafeInteger(value.outcomeUnknown) || (value.outcomeUnknown as number) < 0
        || !Number.isSafeInteger(value.abandonedForwarded) || (value.abandonedForwarded as number) < 0
        || value.deleted !== (value.outcomeUnknown as number) + (value.abandonedForwarded as number)
        || (value.scope !== "session" && value.scope !== "all") || typeof value.warning !== "string") throw invalid();
      return value as unknown as BrowserIdempotencyClearResult;
    },
    async profileTools(profile: string, enabled?: boolean): Promise<{ enabled: boolean }> {
      if (typeof profile !== "string" || !profile.trim() || profile.length > 200 || profile === "." || profile === ".."
        || /[/\\\u0000-\u001f\u007f-\u009f]/.test(profile) || (enabled !== undefined && typeof enabled !== "boolean")) throw new BrowserRelayError("invalid_request");
      let segment: string; try { segment = encodeURIComponent(profile); } catch { throw new BrowserRelayError("invalid_request"); }
      const value = await request(`/v2/profiles/${segment}`, 64 * 1024, enabled === undefined ? undefined : { browserTools: enabled });
      // GET and PATCH both return {contractVersion:2, profile:{browserTools,...}}.
      if (!object(value) || !object(value.profile) || typeof value.profile.browserTools !== "boolean") throw invalid();
      return { enabled: value.profile.browserTools };
    },
    async agents(): Promise<BrowserAgentView[]> {
      const value = await request("/v2/browser/agents");
      if (!object(value) || !Array.isArray(value.items) || value.items.length > 1024) throw invalid();
      return value.items.map(item => {
        if (!object(item) || typeof item.sessionId !== "string" || !ID.test(item.sessionId) || typeof item.name !== "string" || item.name.length > 800 || /[\x00-\x1f\x7f]/.test(item.name)) throw invalid();
        return { sessionId: item.sessionId, name: item.name };
      });
    },
    async turnShots(sessionId: string, turnId: string): Promise<BrowserTurnShot[]> {
      const value = await request(`/v2/browser/turn-shots?${query({ sessionId, turnId })}`, 256 * 1024);
      if (!object(value) || !Array.isArray(value.items) || value.items.length > 256) throw invalid();
      const seen = new Set<string>();
      return value.items.map(item => {
        if (!object(item) || typeof item.id !== "string" || !ID.test(item.id) || seen.has(item.id) || item.turnId !== turnId || typeof item.createdAt !== "string" || item.createdAt.length > 64 || !Number.isFinite(Date.parse(item.createdAt))
          || !Number.isSafeInteger(item.width) || (item.width as number) < 1 || (item.width as number) > 1600 || !Number.isSafeInteger(item.height) || (item.height as number) < 1 || (item.height as number) > 1600 || !["image/png", "image/jpeg"].includes(item.mimeType as string)) throw invalid();
        seen.add(item.id); return { id: item.id, turnId, createdAt: item.createdAt, width: item.width as number, height: item.height as number, mimeType: item.mimeType as BrowserTurnShot["mimeType"] };
      });
    },
    async turnShot(id: string): Promise<BrowserImage> { query({ id }); return validateImage(await request(`/v2/browser/turn-shots/${encodeURIComponent(id)}`, 8 * 1024 * 1024)); },
    async toolItem(sessionId: string, turnId: string, itemId: string): Promise<BrowserToolItem> {
      const value = await request(`/v2/browser/tool-item?${query({ sessionId, turnId, itemId })}`, 8 * 1024 * 1024);
      if (!object(value) || Object.keys(value).length !== 1 || !object(value.item) || value.item.id !== itemId
        || (value.item.turnId !== undefined && value.item.turnId !== turnId)) throw invalid();
      // Independently enforce the daemon's narrow identity and full-image boundary in main.
      validateItem(value.item); options.check(); return { item: value.item };
    },
  };
}
