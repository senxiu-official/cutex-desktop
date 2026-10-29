import { describe, expect, it, vi } from "vitest";
import type { CutexClient } from "@cutex-desktop/cutex-client";
import { remoteCopyTransport, transferMetadata } from "../src/main/remoteCopyTransport";
import type { CopySource, TransferMeta } from "../src/shared/remoteCopies";

const source: CopySource = { hostId: "ssh-a", hostLabel: "A", hostIdentity: "host-a", path: "/work/中文.bin" };
const meta: TransferMeta = { path: source.path, name: "中文.bin", size: 5, modifiedAt: "2026-10-28T00:00:00Z", revision: "a".repeat(64), maxChunkBytes: 4194304 };
const signal = new AbortController().signal;
function response(bytes = new Uint8Array([0, 255, 13, 10, 33]), headers: Record<string, string> = {}, status = 200) {
  return new Response(bytes, { status, headers: { "content-type": "application/octet-stream", "content-length": "5", "etag": `"${meta.revision}"`, "x-cutex-file-offset": "0", "x-cutex-file-bytes": "5", "x-cutex-file-total-bytes": "5", "x-cutex-file-next-offset": "5", "x-cutex-file-eof": "true", ...headers } });
}
function fake(reply: Response) {
  return { headers: vi.fn(() => ({ Authorization: "Bearer synthetic-only" })), url: vi.fn((path, query) => `http://private.invalid${path}?${new URLSearchParams(query)}`), fetchRaw: vi.fn(async () => reply), request: vi.fn(async () => meta) } as unknown as CutexClient;
}
describe("remote byte transport", () => {
  it("preserves binary bytes, bound scopes and cancellation signal without credentials reaching the renderer", async () => {
    const client = fake(response()), check = vi.fn();
    const transport = remoteCopyTransport(client, { ...source, path: "中文.bin", scope: { kind: "project", id: "proj a" } }, check);
    expect(await transport.metadata(signal)).toEqual(meta);
    const chunk = await transport.chunk(meta, 0, 4194304, signal);
    expect([...chunk.bytes]).toEqual([0, 255, 13, 10, 33]);
    expect(chunk).toMatchObject({ offset: 0, total: 5, next: 5, eof: true, revision: meta.revision });
    expect(client.url).toHaveBeenCalledWith("/v2/projects/proj%20a/fs/transfer/chunk", expect.objectContaining({ path: "中文.bin", revision: meta.revision }));
    expect(client.fetchRaw).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal), redirect: "error" }), { retryable: false });
    expect(check).toHaveBeenCalled();
  });
  it.each([
    [{ "x-cutex-file-offset": "1" }, "headers"],
    [{ "x-cutex-file-next-offset": "4" }, "headers"],
    [{ "x-cutex-file-total-bytes": "6" }, "headers"],
    [{ "x-cutex-file-eof": "false" }, "headers"],
    [{ etag: '"wrong"' }, "headers"],
    [{ "x-cutex-file-bytes": "4" }, "headers"],
    [{ "content-length": "9007199254740992" }, "byte count"],
  ])("rejects mismatched or unsafe headers %s", async (headers, message) => {
    const transport = remoteCopyTransport(fake(response(undefined, headers)), source, () => {});
    await expect(transport.chunk(meta, 0, 4194304, signal)).rejects.toThrow(message);
  });
  it("rejects short/oversized bodies, refusal and changed connections", async () => {
    for (const bytes of [new Uint8Array(4), new Uint8Array(6)]) {
      await expect(remoteCopyTransport(fake(response(bytes)), source, () => {}).chunk(meta, 0, 4194304, signal)).rejects.toThrow();
    }
    await expect(remoteCopyTransport(fake(response(undefined, {}, 403)), source, () => {}).chunk(meta, 0, 4194304, signal)).rejects.toThrow("403");
    await expect(remoteCopyTransport(fake(response()), source, () => { throw Error("host changed"); }).chunk(meta, 0, 4194304, signal)).rejects.toThrow("host changed");
    expect(() => transferMetadata({ ...meta, size: -1 })).toThrow();
  });
  it("reads exactly a pinned artifact version and refuses moving or unprovable versions", async () => {
    const client = fake(response());
    const id = `af-${"1".repeat(32)}`;
    const artifactSource = { ...source, artifact: { id, version: 3 } };
    const detail = { artifact: { name: "data.bin" }, versions: [{ artifactId: id, version: 3, sha256: meta.revision, bytes: 5, createdAt: meta.modifiedAt }] };
    const page = { version: 3, encoding: "base64", content: "AP8NCiE=", offset: 0, totalBytes: 5, truncated: false, sha256: meta.revision, externalChanged: false };
    vi.mocked(client.request).mockResolvedValueOnce(detail).mockResolvedValueOnce(page);
    const transport = remoteCopyTransport(client, artifactSource, () => {});
    const prepared = await transport.metadata(signal);
    expect(prepared.sha256).toBe(meta.revision);
    expect([...(await transport.chunk(prepared, 0, 1024, signal)).bytes]).toEqual([0, 255, 13, 10, 33]);
    expect(client.request).toHaveBeenCalledWith("GET", `/v2/artifact-store/${id}/versions/3/content`, expect.any(Object));
    vi.mocked(client.request).mockResolvedValueOnce({ ...page, externalChanged: true });
    await expect(transport.chunk(prepared, 0, 1024, signal)).rejects.toThrow("changed");
    vi.mocked(client.request).mockResolvedValueOnce({ ...detail, versions: [{ ...detail.versions[0], sha256: null }] });
    await expect(transport.metadata(signal)).rejects.toThrow("verified");
  });
});
