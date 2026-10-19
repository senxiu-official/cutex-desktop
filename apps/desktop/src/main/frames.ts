// Agent pages (docs/desktop-modules.md §10.2): an HTML artifact version as a one-use, offline, opaque
// frame document in the shared frame store (the same store, scheme and navigation lease as plugin
// documents, main/plugins.ts). Main reads the bytes from the host itself; the document has no bridge,
// no network (loopback included) and nothing to call.
import { buildOfflinePageDocument, OFFLINE_PAGE_MAX_BYTES } from "@cutex-desktop/opaque-frame/page";
import type { FrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { ARTIFACT_ID, type ArtifactContent } from "../shared/artifactStore";
import { ARTIFACT_PAGE_MAX_BYTES, type ArtifactPageInput, type ArtifactPageResult } from "../shared/frames";

export interface ArtifactPageDeps {
  documents: Pick<FrameDocumentStore, "add" | "release">;
  /** The connected host's artifact reader; null = not connected. */
  contentReader(hostId: string): { artifactStoreContent(id: string, version: number, opts: { offset?: number; maxBytes: number }): Promise<ArtifactContent | null> } | null;
  /** Chromium egress containment (main/pluginNetwork.ts) before the first document exists. */
  ensureContained(): Promise<void>;
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

export function createArtifactPageService(deps: ArtifactPageDeps) {
  return {
    async prepare(owner: number, raw: unknown): Promise<ArtifactPageResult> {
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
        document = buildOfflinePageDocument(page, input.large ? ARTIFACT_PAGE_MAX_BYTES : OFFLINE_PAGE_MAX_BYTES);
      } catch {
        return { ok: false, reason: "too-large", totalBytes: content.totalBytes };
      }
      // No agent page exists before Chromium networking is contained.
      await deps.ensureContained();
      return { ok: true, frame: deps.documents.add(owner, document) };
    },
    release(owner: number, id: unknown): void {
      if (typeof id !== "string") throw new Error("Invalid frame release");
      deps.documents.release(owner, id);
    },
  };
}
