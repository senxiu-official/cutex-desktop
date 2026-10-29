// File pages (owner 2026-10-24): an HTML file of a workspace / the host shown as a page in the file view —
// the same one-use offline opaque document, read by main from that host, but with no page channels at all.
// Agent pages (docs/desktop-modules.md §10.2): an HTML artifact version as a one-use, offline, opaque
// frame document in the shared frame store (the same store, scheme and navigation lease as plugin
// documents, main/plugins.ts). Main reads the bytes from the host itself; the document has no network
// (loopback included). It has exactly three channels (docs/design/004-artifact-page-bridge.md), decided
// here for the artifact main itself bound to the frame id — never one the renderer or page names:
//   A storage: that artifact's own data (pageStorage.ts limits), shared across its versions;
//   B submit: only after the owner's native confirm dialog, only to the agent that made that version,
//     one dialog at a time and rate-limited per artifact;
//   C copy: text to the clipboard (the renderer forwards it only during a user gesture), rate-limited.
// Multi-window P4: a page drawn in a desk window is leased to that desk's webContents (main resolved the
// desk at prepare time); it loads only there, its confirm parents to that window, and it is released when
// that window goes (releasePlace) as well as when the renderer that asked goes (releaseOwner).
import { buildOfflinePageDocument, OFFLINE_PAGE_MAX_BYTES } from "@cutex-desktop/opaque-frame/page";
import type { FrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { ARTIFACT_ID, type ArtifactContent, type ArtifactDetail } from "../shared/artifactStore";
import { ARTIFACT_PAGE_MAX_BYTES, FILE_PAGE_MAX_BYTES, FILE_PAGE_PROMPT_BYTES, type ArtifactPageInput, type ArtifactPageResult, type FilePageInput, type FilePageResult } from "../shared/frames";
import type { FsFile, WorkspaceScope } from "../shared/ipc";
import { parsePageCall, type PageCall, type PageResult } from "../shared/pageBridge";
import type { PageStorage } from "./pageStorage";
import { pageSubmitMessage, pageSubmitPromptText, type PageSubmitPromptText } from "../shared/pagePromptText";

/** B: after a submit dialog closes, the same artifact waits this long before it may ask again. */
export const PAGE_SUBMIT_COOLDOWN_MS = 5_000;
/** B: at most this many submit dialogs per artifact in PAGE_SUBMIT_WINDOW_MS. */
export const PAGE_SUBMIT_MAX_PER_WINDOW = 5;
export const PAGE_SUBMIT_WINDOW_MS = 10 * 60_000;
/** B: an unanswered dialog closes as a cancel. */
export const PAGE_SUBMIT_TIMEOUT_MS = 5 * 60_000;
/** C: one copy per frame per this long. */
export const PAGE_COPY_INTERVAL_MS = 500;
/**
 * At most this many agent pages / HTML files held by one renderer across all its windows (multi-window P4).
 * The shared store caps each webContents at 8 and all of them at 32; leased per desk, one renderer could
 * otherwise hold 8 per window (5 windows = 40) and leave no room for the main window's plugin frames.
 * Counted by owner, pages + plugin documents stay at most 16 of the store's 32, as before P4.
 */
export const PAGE_DOCUMENTS_PER_OWNER = 8;

export interface PageChannelDeps {
  storage: Pick<PageStorage, "get" | "set" | "remove" | "keys" | "clear" | "rename">;
  /** The connected host's reader / sender; null = not connected. */
  host(hostId: string): { artifactStoreGet(id: string): Promise<ArtifactDetail | null>; submit(sessionId: string, text: string): Promise<unknown> } | null;
  /** Main's own native dialog on the owner's window: true = 发送, false = cancelled, null = could not be shown. */
  /** `place`: the webContents the frame was prepared for (the owner's own, or a desk it opened; multi-window P4),
   *  bound at prepare time — the dialog parents to that window if it is still the owner's. */
  confirm(owner: number, text: PageSubmitPromptText, signal: AbortSignal, place: number): Promise<boolean | null>;
  writeClipboard(text: string): void;
  locale(): string | undefined;
  now?: () => number;
}

export interface ArtifactPageDeps {
  /** The shared store; its `owner` key here is the place (webContents) a document is leased to. */
  documents: Pick<FrameDocumentStore, "add" | "release">;
  /** Multi-window P4: whether `place` is still an open desk of `owner` (checked again just before a document
   *  is leased to it). Without it only the owner's own webContents can hold a document. */
  placeOpen?(owner: number, place: number): boolean;
  /** The connected host's artifact reader; null = not connected. */
  contentReader(hostId: string): { artifactStoreContent(id: string, version: number, opts: { offset?: number; maxBytes: number }): Promise<ArtifactContent | null> } | null;
  /** Chromium egress containment (main/pluginNetwork.ts) before the first document exists. */
  ensureContained(): Promise<void>;
  /** The three page channels; without it a page gets no `window.cutexPage` and every request is refused. */
  page?: PageChannelDeps;
  /** File pages: the connected host's file readers; null = not connected. Without it no file page is prepared. */
  fileReader?(hostId: string): { fsFile(scope: WorkspaceScope, path: string, maxBytes?: number): Promise<FsFile>; hostFile(path: string, maxBytes?: number): Promise<FsFile> } | null;
}

const SCOPE_ID = /^[A-Za-z0-9._:@-]{1,200}$/;
export function parseFilePageInput(raw: unknown): FilePageInput {
  const r = raw as Record<string, unknown> | null;
  const keys = r && typeof r === "object" && !Array.isArray(r) ? Object.keys(r) : [];
  const allowed = new Set(["hostId", "path", "scope", "large"]);
  const scope = r?.scope as Record<string, unknown> | undefined;
  if (!r || keys.some((k) => !allowed.has(k))
    || typeof r.hostId !== "string" || !r.hostId || r.hostId.length > 200
    || typeof r.path !== "string" || !r.path || r.path.length > 4000 || /[\u0000-\u001f]/.test(r.path)
    || !/\.html?$/i.test(r.path)
    || (scope !== undefined && (!scope || typeof scope !== "object" || Array.isArray(scope) || Object.keys(scope).sort().join() !== "id,kind"
      || (scope.kind !== "project" && scope.kind !== "session") || typeof scope.id !== "string" || !SCOPE_ID.test(scope.id)))
    || (r.large !== undefined && typeof r.large !== "boolean")) throw new Error("Invalid file page request");
  return { hostId: r.hostId, path: r.path, ...(scope ? { scope: { kind: scope.kind as WorkspaceScope["kind"], id: scope.id as string } } : {}), ...(r.large ? { large: true } : {}) };
}

/**
 * How many things the page refers to outside itself (files next to it, the network): src / poster / data /
 * background / <link href> / srcset / url(...) / @import values that are not data:, blob:, #fragments or about: / javascript: / mailto:.
 * A file page is inline-only: none of them loads (the document's CSP blocks every fetch); the view says so.
 */
export function countExternalRefs(html: string): number {
  const values: string[] = [];
  for (const m of html.matchAll(/\b(?:src|poster|data|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) values.push(m[1] ?? m[2] ?? m[3] ?? "");
  // A plain <a href> is a link, not something the page loads; <link href> (style sheets, icons) is.
  for (const m of html.matchAll(/<link\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) values.push(m[1] ?? m[2] ?? m[3] ?? "");
  for (const m of html.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) for (const part of (m[1] ?? m[2] ?? "").split(",")) values.push(part.trim().split(/\s+/)[0] ?? "");
  for (const m of html.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) values.push(m[1] ?? m[2] ?? m[3] ?? "");
  for (const m of html.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) values.push(m[1] ?? m[2] ?? "");
  return values.filter((v) => {
    const s = v.trim();
    return !!s && !/^(?:data:|blob:|#|about:|javascript:|mailto:|tel:)/i.test(s);
  }).length;
}

/**
 * A prepared document: `owner` = the renderer that asked (and may release it / send its page requests),
 * `place` = the webContents it is leased to in the shared store (where it may load: the owner's own, or one
 * of its desks; multi-window P4). The two differ only for a frame drawn in a desk.
 */
interface Lease {
  owner: number;
  place: number;
}

interface Binding extends Lease {
  id: string;
  hostId: string;
  artifactId: string;
  version: number;
  name: string | null;
  /** The agent that made this version (null = cutex names none). Learned once from the host. */
  recipient?: Promise<{ name: string; sessionId: string | null; agent: string | null } | null>;
  abort: AbortController;
  lastCopy: number;
}

export function parseArtifactPageInput(raw: unknown): ArtifactPageInput {
  const r = raw as Record<string, unknown> | null;
  const keys = r && typeof r === "object" && !Array.isArray(r) ? Object.keys(r).sort().join() : "";
  if (!r || (keys !== "artifactId,hostId,version" && keys !== "artifactId,hostId,large,version")
    || typeof r.hostId !== "string" || !r.hostId || r.hostId.length > 200
    || typeof r.artifactId !== "string" || !ARTIFACT_ID.test(r.artifactId)
    || typeof r.version !== "number" || !Number.isSafeInteger(r.version) || r.version < 1
    || (r.large !== undefined && typeof r.large !== "boolean")) throw new Error("Invalid artifact page request");
  return { hostId: r.hostId, artifactId: r.artifactId, version: r.version, ...(r.large ? { large: true } : {}) };
}

/** The artifact page service (main/index.ts holds one). */
export type ArtifactPageService = ReturnType<typeof createArtifactPageService>;

/**
 * The frames IPC `artifactPage` / `filePage` step (main/index.ts; multi-window P4): the optional desk id is
 * resolved to the webContents the document will be leased to — the sender's own without one, else a desk
 * this sender opened that is still open (`placeFor`). Anything else throws before anything is read.
 */
export function preparePlaced<R extends { op: "artifactPage" | "filePage"; deskId?: unknown }>(
  service: Pick<ArtifactPageService, "prepare" | "prepareFile">,
  places: { placeFor(senderId: number, deskId: unknown): number | null },
  senderId: number,
  request: R,
): Promise<ArtifactPageResult | FilePageResult> {
  const { op, deskId, ...input } = request;
  const place = places.placeFor(senderId, deskId);
  if (place === null) throw new Error("invalid frame request");
  return op === "artifactPage" ? service.prepare(senderId, input, place) : service.prepareFile(senderId, input, place);
}

export function createArtifactPageService(deps: ArtifactPageDeps) {
  const bindings = new Map<string, Binding>();
  /** Every document prepared here (artifact and file pages), by document id. */
  const leases = new Map<string, Lease>();
  const prompting = new Set<number>(); // owners with a submit dialog open (one at a time across all their windows)
  const prompts = new Map<string, { closedAt: number; opened: number[] }>(); // per host + artifact
  const now = () => deps.page?.now?.() ?? Date.now();
  const unbind = (id: string) => {
    bindings.get(id)?.abort.abort();
    bindings.delete(id);
  };
  const drop = (id: string, lease: Lease) => {
    unbind(id);
    leases.delete(id);
    deps.documents.release(lease.place, id);
  };
  // A desk can close while its page is read from the host: no document is leased to a window already gone.
  const placeStillOpen = (owner: number, place: number) => {
    if (place !== owner && deps.placeOpen?.(owner, place) !== true) throw new Error("Frame window closed");
  };
  const lease = (owner: number, place: number, document: ReturnType<typeof buildOfflinePageDocument>) => {
    let held = 0;
    for (const l of leases.values()) if (l.owner === owner) held++;
    if (held >= PAGE_DOCUMENTS_PER_OWNER) throw new Error("Too many prepared frame documents");
    const frame = deps.documents.add(place, document);
    leases.set(frame.id, { owner, place });
    return frame;
  };
  const recipient = (b: Binding) =>
    (b.recipient ??= (async () => {
      const detail = await deps.page?.host(b.hostId)?.artifactStoreGet(b.artifactId).catch(() => null);
      if (!detail) return null;
      const version = detail.versions.find((v) => v.version === b.version);
      const producer = version?.producer;
      const sessionId = producer && producer.kind !== "owner" && (producer.kind === "agent" || producer.attribution === "exclusive") ? producer.sessionId : null;
      b.name = detail.artifact.name;
      return { name: detail.artifact.name, sessionId, agent: producer?.displayName ?? null };
    })());
  const refuse = (error: Extract<PageResult, { ok: false }>["error"]): PageResult => ({ ok: false, error });
  async function submit(b: Binding, page: PageChannelDeps, call: Extract<PageCall, { op: "submit" }>): Promise<PageResult> {
    if (prompting.has(b.owner)) return refuse("busy");
    const key = `${b.hostId}\n${b.artifactId}`, t = now();
    const history = prompts.get(key) ?? { closedAt: -Infinity, opened: [] };
    history.opened = history.opened.filter((at) => t - at < PAGE_SUBMIT_WINDOW_MS);
    if (t - history.closedAt < PAGE_SUBMIT_COOLDOWN_MS || history.opened.length >= PAGE_SUBMIT_MAX_PER_WINDOW) return refuse("rate_limited");
    prompting.add(b.owner);
    try {
      const who = await recipient(b);
      if (!who || bindings.get(b.id) !== b) return refuse("unavailable");
      if (!who.sessionId) return refuse("no_recipient");
      history.opened.push(t);
      prompts.set(key, history);
      const locale = page.locale();
      const abort = new AbortController();
      const forward = () => abort.abort();
      b.abort.signal.addEventListener("abort", forward, { once: true });
      const timer = setTimeout(forward, PAGE_SUBMIT_TIMEOUT_MS);
      timer.unref?.();
      let confirmed: boolean | null;
      try {
        confirmed = await page.confirm(b.owner, pageSubmitPromptText(locale, { name: who.name, version: b.version, agent: who.agent ?? who.sessionId, text: call.text }), abort.signal, b.place);
      } finally {
        clearTimeout(timer);
        b.abort.signal.removeEventListener("abort", forward);
        history.closedAt = now();
      }
      if (confirmed === null) return refuse("unavailable");
      // A frame torn down while the dialog was open, or an aborted dialog, never sends.
      if (confirmed !== true || abort.signal.aborted) return { ok: true, sent: false };
      const host = page.host(b.hostId);
      if (!host) return refuse("unavailable");
      await host.submit(who.sessionId, pageSubmitMessage(locale, { artifactId: b.artifactId, name: who.name, version: b.version, format: call.format, text: call.text }));
      return { ok: true, sent: true };
    } finally {
      prompting.delete(b.owner);
    }
  }
  return {
    /** An HTML file as a page (file view): read from the host by main, no page channels, inline-only. */
    async prepareFile(owner: number, raw: unknown, place: number = owner): Promise<FilePageResult> {
      const input = parseFilePageInput(raw);
      const reader = deps.fileReader?.(input.hostId);
      if (!reader) return { ok: false, reason: "host-offline" };
      const maxBytes = input.large ? FILE_PAGE_MAX_BYTES : FILE_PAGE_PROMPT_BYTES;
      let file: FsFile;
      try {
        file = input.scope ? await reader.fsFile(input.scope, input.path, maxBytes) : await reader.hostFile(input.path, maxBytes);
      } catch {
        return { ok: false, reason: "not-found" };
      }
      if (file.encoding !== "utf8") return { ok: false, reason: "not-text" };
      if (file.truncated) return { ok: false, reason: "too-large", totalBytes: file.size };
      let document: ReturnType<typeof buildOfflinePageDocument>;
      try {
        document = buildOfflinePageDocument(file.content, FILE_PAGE_MAX_BYTES, { pageApi: false });
      } catch {
        return { ok: false, reason: "too-large", totalBytes: file.size };
      }
      // No file page exists before Chromium networking is contained.
      await deps.ensureContained();
      placeStillOpen(owner, place);
      return { ok: true, frame: lease(owner, place, document), externalRefs: countExternalRefs(file.content) };
    },
    /** `place`: the webContents the frame will be drawn in (the owner's own, or a desk it opened; main resolved it). */
    async prepare(owner: number, raw: unknown, place: number = owner): Promise<ArtifactPageResult> {
      const input = parseArtifactPageInput(raw);
      const reader = deps.contentReader(input.hostId);
      if (!reader) return { ok: false, reason: "host-offline" };
      const content = await reader.artifactStoreContent(input.artifactId, input.version, { maxBytes: OFFLINE_PAGE_MAX_BYTES });
      if (!content || content.version !== input.version) return { ok: false, reason: "not-found" };
      if (content.externalChanged === true && content.content === "") return { ok: false, reason: "external-changed" };
      if (content.encoding !== "utf8") return { ok: false, reason: "not-text" };
      if (content.offset !== 0) return { ok: false, reason: "not-found" };
      let page = content.content;
      if (content.truncated) {
        // Over one window: only when the owner asked for it, read in windows up to the hard bound.
        const tooLarge = { ok: false as const, reason: "too-large" as const, totalBytes: content.totalBytes };
        if (!input.large || content.totalBytes > ARTIFACT_PAGE_MAX_BYTES) return tooLarge;
        const parts = [content.content];
        let offset = Buffer.byteLength(content.content, "utf8");
        while (offset < content.totalBytes) {
          const next = await reader.artifactStoreContent(input.artifactId, input.version, { offset, maxBytes: OFFLINE_PAGE_MAX_BYTES });
          if (!next || next.version !== input.version || next.sha256 !== content.sha256 || next.totalBytes !== content.totalBytes) return { ok: false, reason: "not-found" };
          if (next.externalChanged === true && next.content === "") return { ok: false, reason: "external-changed" };
          if (next.encoding !== "utf8") return { ok: false, reason: "not-text" };
          const bytes = Buffer.byteLength(next.content, "utf8");
          // cutex cuts windows at character boundaries; an empty window would never end.
          if (next.offset !== offset || bytes === 0) return { ok: false, reason: "not-found" };
          parts.push(next.content);
          offset += bytes;
          if (!next.truncated) break;
        }
        if (offset !== content.totalBytes) return { ok: false, reason: "not-found" };
        page = parts.join("");
      }
      let document: ReturnType<typeof buildOfflinePageDocument>;
      try {
        document = buildOfflinePageDocument(page, input.large ? ARTIFACT_PAGE_MAX_BYTES : OFFLINE_PAGE_MAX_BYTES, { pageApi: !!deps.page });
      } catch {
        return { ok: false, reason: "too-large", totalBytes: content.totalBytes };
      }
      // No agent page exists before Chromium networking is contained.
      await deps.ensureContained();
      placeStillOpen(owner, place);
      const frame = lease(owner, place, document);
      const binding: Binding = { id: frame.id, owner, place, hostId: input.hostId, artifactId: input.artifactId, version: input.version, name: null, abort: new AbortController(), lastCopy: -Infinity };
      bindings.set(frame.id, binding);
      return { ok: true, frame };
    },
    release(owner: number, id: unknown): void {
      if (typeof id !== "string") throw new Error("Invalid frame release");
      const held = leases.get(id);
      if (held?.owner === owner) drop(id, held);
    },
    /** A renderer went away: every page it prepared (in any of its windows) loses its lease and channels (open dialogs close as cancelled). */
    releaseOwner(owner: number): void {
      for (const [id, held] of leases) if (held.owner === owner) drop(id, held);
    },
    /** A window frames were drawn in went away (a desk closed / navigated): only the documents leased to it. */
    releasePlace(place: number): void {
      for (const [id, held] of leases) if (held.place === place) drop(id, held);
    },
    /**
     * One page request the renderer's broker forwarded for frame `id` (a frame this renderer holds).
     * The call is checked again here; the artifact (and the window a confirm parents to) is the one main
     * bound to that frame at prepare time.
     */
    async page(owner: number, id: unknown, raw: unknown): Promise<PageResult> {
      const page = deps.page;
      const b = typeof id === "string" ? bindings.get(id) : undefined;
      if (!page || !b || b.owner !== owner) return refuse("unavailable");
      let call: PageCall;
      try {
        call = parsePageCall(raw);
      } catch {
        return refuse("invalid");
      }
      const key = { hostId: b.hostId, artifactId: b.artifactId };
      switch (call.op) {
        case "storage.get":
          return { ok: true, value: await page.storage.get(key, call.key) };
        case "storage.keys":
          return { ok: true, value: await page.storage.keys(key) };
        case "storage.set": {
          const known = b.name ?? (await recipient(b))?.name ?? null;
          const r = await page.storage.set(key, call.key, call.value, known);
          return r.ok ? { ok: true } : { ok: false, error: r.error, scope: r.scope, limit: r.limit };
        }
        case "storage.remove":
          await page.storage.remove(key, call.key);
          return { ok: true };
        case "storage.clear":
          await page.storage.clear(key);
          return { ok: true };
        case "submit":
          return submit(b, page, call);
        case "copy": {
          const t = now();
          if (t - b.lastCopy < PAGE_COPY_INTERVAL_MS) return refuse("rate_limited");
          b.lastCopy = t;
          page.writeClipboard(call.text);
          return { ok: true };
        }
      }
    },
  };
}
