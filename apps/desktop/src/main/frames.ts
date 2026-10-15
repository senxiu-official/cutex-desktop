// Agent pages (docs/desktop-modules.md §10.2): an HTML artifact version as a one-use, offline, opaque
// frame document in the shared frame store (the same store, scheme and navigation lease as plugin
// documents, main/plugins.ts). Main reads the bytes from the host itself; the document has no bridge,
// no network (loopback included) and nothing to call.
import { buildOfflinePageDocument, OFFLINE_PAGE_MAX_BYTES } from "@cutex-desktop/opaque-frame/page";
import type { FrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { ARTIFACT_ID, type ArtifactContent } from "../shared/artifactStore";
import type { ArtifactPageInput, ArtifactPageResult } from "../shared/frames";

export interface ArtifactPageDeps {
  documents: Pick<FrameDocumentStore, "add" | "release">;
  /** The connected host's artifact reader; null = not connected. */
  contentReader(hostId: string): { artifactStoreContent(id: string, version: number, opts: { maxBytes: number }): Promise<ArtifactContent | null> } | null;
  /** Chromium egress containment (main/pluginNetwork.ts) before the first document exists. */
  ensureContained(): Promise<void>;
}

export function parseArtifactPageInput(raw: unknown): ArtifactPageInput {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).sort().join() !== "artifactId,hostId,version"
    || typeof r.hostId !== "string" || !r.hostId || r.hostId.length > 200
    || typeof r.artifactId !== "string" || !ARTIFACT_ID.test(r.artifactId)
    || typeof r.version !== "number" || !Number.isSafeInteger(r.version) || r.version < 1) throw new Error("Invalid artifact page request");
  return { hostId: r.hostId, artifactId: r.artifactId, version: r.version };
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
      if (content.truncated || content.offset !== 0) return { ok: false, reason: "too-large" };
      let document: ReturnType<typeof buildOfflinePageDocument>;
      try {
        document = buildOfflinePageDocument(content.content);
      } catch {
        return { ok: false, reason: "too-large" };
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
