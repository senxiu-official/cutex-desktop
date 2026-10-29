import type { CutexClient } from "@cutex-desktop/cutex-client";
import type { ArtifactContent, ArtifactDetail } from "../shared/artifactStore";
import type { CopySource, TransferChunk, TransferMeta } from "../shared/remoteCopies";

const MAX = 4 * 1024 * 1024;
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid transfer byte count");
  return value;
}
export function transferMetadata(value: TransferMeta): TransferMeta {
  if (!value || typeof value.path !== "string" || typeof value.name !== "string" || typeof value.modifiedAt !== "string" || !/^[a-f0-9]{64}$/.test(value.revision)) throw new Error("invalid file metadata");
  integer(value.size);
  if (integer(value.maxChunkBytes) < 1 || value.maxChunkBytes > MAX) throw new Error("invalid chunk bound");
  return value;
}

/** Main-only transport: the existing client owns credentials and the SSH forward. */
export function remoteCopyTransport(client: CutexClient, source: CopySource, check: () => void) {
  const prefix = source.scope ? `/v2/${source.scope.kind === "project" ? "projects" : "sessions"}/${encodeURIComponent(source.scope.id)}` : "/v2";
  const artifact = source.artifact;
  if (artifact && (!/^af-[0-9a-f]{32}$/.test(artifact.id) || !Number.isSafeInteger(artifact.version) || artifact.version < 1)) throw new Error("invalid pinned artifact");
  const artifactPath = artifact ? `/v2/artifact-store/${artifact.id}` : "";
  const checked = async <T>(read: () => Promise<T>): Promise<T> => { check(); const value = await read(); check(); return value; };
  return {
    async metadata(signal: AbortSignal): Promise<TransferMeta> {
      signal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      if (!artifact) return transferMetadata(await checked(() => client.request<TransferMeta>("GET", `${prefix}/fs/transfer`, { query: { path: source.path }, signal, retryable: false })));
      const detail = await checked(() => client.request<ArtifactDetail>("GET", artifactPath, { signal, retryable: false }));
      const version = detail.versions.find(v => v.version === artifact.version && v.artifactId === artifact.id);
      // A pinned external version without a digest cannot prove that its moving source is that version.
      if (!version || !version.sha256 || !/^[a-f0-9]{64}$/.test(version.sha256)) throw new Error("pinned artifact bytes cannot be verified");
      return transferMetadata({ path: `${artifact.id}@${artifact.version}`, name: detail.artifact.name.split(/[\\/]/).pop() || "artifact", size: version.bytes, modifiedAt: version.createdAt, revision: version.sha256, sha256: version.sha256, maxChunkBytes: MAX });
    },
    async chunk(meta: TransferMeta, offset: number, maxBytes: number, signal: AbortSignal): Promise<TransferChunk> {
      signal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      integer(offset); integer(maxBytes);
      if (maxBytes < 1 || maxBytes > MAX) throw new Error("invalid chunk size");
      if (artifact) {
        const page = await checked(() => client.request<ArtifactContent>("GET", `${artifactPath}/versions/${artifact.version}/content`, { query: { offset, maxBytes }, signal, retryable: false }));
        if (page.version !== artifact.version || page.sha256 !== meta.revision || page.externalChanged === true || page.offset !== offset || page.totalBytes !== meta.size || !["base64", "utf8"].includes(page.encoding) || typeof page.content !== "string") throw new Error("artifact version changed or unavailable");
        const bytes = Buffer.from(page.content, page.encoding === "base64" ? "base64" : "utf8");
        if (bytes.length > maxBytes || page.truncated !== (offset + bytes.length < meta.size)) throw new Error("invalid artifact chunk");
        return { bytes, offset, next: offset + bytes.length, total: page.totalBytes, eof: !page.truncated, revision: meta.revision };
      }
      check();
      const response = await client.fetchRaw(client.url(`${prefix}/fs/transfer/chunk`, { path: source.path, revision: meta.revision, offset, maxBytes }), { method: "GET", headers: client.headers({ Accept: "application/octet-stream" }), signal, redirect: "error" }, { retryable: false });
      try {
        check();
        if (response.status !== 200 || !response.headers.get("content-type")?.startsWith("application/octet-stream")) throw new Error(`file transfer refused (${response.status})`);
        const header = (name: string) => {
          const raw = response.headers.get(name);
          if (!raw || !/^\d+$/.test(raw)) throw new Error(`invalid ${name}`);
          return integer(Number(raw));
        };
        const count = header("content-length");
        const start = header("x-cutex-file-offset"), next = header("x-cutex-file-next-offset"), total = header("x-cutex-file-total-bytes");
        const eof = response.headers.get("x-cutex-file-eof");
        if (count > maxBytes || count !== header("x-cutex-file-bytes") || start !== offset || next !== offset + count || total !== meta.size || next > total || eof !== String(next === total) || response.headers.get("etag") !== `"${meta.revision}"`) throw new Error("file transfer headers do not match metadata");
        const bytes = new Uint8Array(count);
        const reader = response.body?.getReader();
        if (!reader) throw new Error("missing file body");
        let received = 0;
        try {
          while (true) {
            const part = await reader.read(); check();
            if (part.done) break;
            if (received + part.value.length > count) throw new Error("file body exceeds advertised count");
            bytes.set(part.value, received); received += part.value.length;
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        if (received !== count) throw new Error("truncated file body");
        return { bytes, offset, total, next, eof: eof === "true", revision: meta.revision };
      } finally { await response.body?.cancel().catch(() => {}); }
    },
  };
}
