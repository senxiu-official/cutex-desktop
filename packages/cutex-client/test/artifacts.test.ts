import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { CutexClient } from "../src/client";
import { ArtifactIntegrityError, ArtifactTooLargeError, artifactRefOf, listArtifacts, readArtifact, readWorkspaceFile, splitArtifactRef, workspaceFileBytes } from "../src/artifacts";

function stub(handler: (url: URL) => unknown) {
  const calls: URL[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    const body = handler(url);
    return new Response(JSON.stringify(body), { status: body && typeof body === "object" && "error" in body ? 404 : 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new CutexClient({ baseUrl: "http://host.test", token: "t" }, { fetch: fetchImpl, clientId: "test" });
  return { client, calls };
}

const bytes = Uint8Array.from({ length: 10_000 }, (_, i) => (i * 7) % 256);
const sha = createHash("sha256").update(bytes).digest("hex");

function pages(url: URL, data: Uint8Array, hash: string | null) {
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const max = Number(url.searchParams.get("maxBytes"));
  const slice = data.slice(offset, offset + max);
  return { version: 3, encoding: "base64", content: Buffer.from(slice).toString("base64"), offset, totalBytes: data.length, truncated: offset + slice.length < data.length, mediaType: "image/png", sha256: hash, externalChanged: null };
}

describe("artifact refs", () => {
  it("parses cutex:artifact links", () => {
    expect(artifactRefOf("cutex:artifact/af-abc@3")).toBe("af-abc@3");
    expect(artifactRefOf("cutex:artifact/af-abc@latest")).toBe("af-abc@latest");
    expect(artifactRefOf("cutex:artifact/af-abc")).toBe("af-abc");
    expect(artifactRefOf("cutex:service/x")).toBeNull();
    expect(artifactRefOf("cutex:artifact/../etc")).toBeNull();
    expect(splitArtifactRef("af-abc@3")).toEqual({ artifactId: "af-abc", version: 3 });
    expect(splitArtifactRef("af-abc")).toEqual({ artifactId: "af-abc", version: "latest" });
  });
});

describe("readArtifact", () => {
  it("stitches pages, pins the first page's version and checks sha256", async () => {
    const { client, calls } = stub((url) => pages(url, bytes, sha));
    const progress: number[] = [];
    const out = await readArtifact(client, "af-x", "latest", { pageBytes: 4096, onProgress: (d) => progress.push(d) });
    expect(Array.from(out.bytes)).toEqual(Array.from(bytes));
    expect(out).toMatchObject({ version: 3, mediaType: "image/png", sha256: sha });
    expect(calls.map((c) => c.pathname)).toEqual(["/v2/artifact-store/af-x/versions/latest/content", "/v2/artifact-store/af-x/versions/3/content", "/v2/artifact-store/af-x/versions/3/content"]);
    expect(calls.map((c) => c.searchParams.get("offset"))).toEqual(["0", "4096", "8192"]);
    expect(progress).toEqual([4096, 8192, 10_000]);
  });

  it("refuses a mismatching hash and a file over the limit", async () => {
    await expect(readArtifact(stub((url) => pages(url, bytes, "0".repeat(64))).client, "af-x", 3)).rejects.toBeInstanceOf(ArtifactIntegrityError);
    const { client, calls } = stub((url) => pages(url, bytes, sha));
    await expect(readArtifact(client, "af-x", 3, { maxBytes: 1000, pageBytes: 512 })).rejects.toBeInstanceOf(ArtifactTooLargeError);
    expect(calls).toHaveLength(1);
  });

  it("reads utf8 pages and files without a hash", async () => {
    const text = "# 报告\n内容";
    const { client } = stub(() => ({ version: 1, encoding: "utf8", content: text, offset: 0, totalBytes: new TextEncoder().encode(text).length, truncated: false, mediaType: "text/markdown", sha256: null, externalChanged: false }));
    const out = await readArtifact(client, "af-y", 1);
    expect(new TextDecoder().decode(out.bytes)).toBe(text);
  });
});

describe("lists and files", () => {
  it("lists a scope and reads workspace files", async () => {
    const { client, calls } = stub((url) => (url.pathname === "/v2/artifact-store" ? { items: [], nextCursor: null } : { path: "a.txt", size: 2, modifiedAt: "", encoding: "base64", content: Buffer.from("hi").toString("base64"), truncated: false, mime: "text/plain" }));
    await listArtifacts(client, { session: "cutex.s1" }, { limit: 30, kind: "report" });
    expect(calls[0]!.search).toBe("?session=cutex.s1&limit=30&kind=report");
    const file = await readWorkspaceFile(client, { kind: "project", id: "p 1" }, "docs/a.txt", { maxBytes: 100 });
    expect(calls[1]!.pathname).toBe("/v2/projects/p%201/fs/file");
    expect(calls[1]!.searchParams.get("path")).toBe("docs/a.txt");
    expect(new TextDecoder().decode(workspaceFileBytes(file))).toBe("hi");
    await readWorkspaceFile(client, null, "D:/x.txt");
    expect(calls[2]!.pathname).toBe("/v2/fs/file");
  });
});

describe("downloadArtifactRaw", () => {
  it("streams the raw route and checks the stated sha256", async () => {
    const { downloadArtifactRaw } = await import("../src/artifacts");
    const make = (hash: string) => {
      const calls: string[] = [];
      const fetchImpl = (async (input: string | URL | Request) => {
        calls.push(String(input));
        return new Response(bytes, { status: 200, headers: { "content-type": "application/vnd.android.package-archive", "content-length": String(bytes.length), "x-cutex-sha256": hash, etag: `"${hash}"`, "content-disposition": "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.apk", "x-cutex-artifact-version": "4" } });
      }) as typeof fetch;
      return { client: new CutexClient({ baseUrl: "http://host.test", token: "t" }, { fetch: fetchImpl, clientId: "t" }), calls };
    };
    const { client, calls } = make(sha);
    const progress: number[] = [];
    const out = await downloadArtifactRaw(client, "af-1", "latest", { onProgress: (d) => progress.push(d) });
    expect(calls[0]).toBe("http://host.test/v2/artifact-store/af-1/versions/latest/raw");
    expect(out).toMatchObject({ mediaType: "application/vnd.android.package-archive", version: 4, name: "测试.apk", sha256: sha });
    expect(out.bytes.length).toBe(bytes.length);
    expect(progress.at(-1)).toBe(bytes.length);
    await expect(downloadArtifactRaw(make("1".repeat(64)).client, "af-1", 4)).rejects.toBeInstanceOf(ArtifactIntegrityError);
    await expect(downloadArtifactRaw(make(sha).client, "af-1", 4, { maxBytes: 100 })).rejects.toBeInstanceOf(ArtifactTooLargeError);
  });

  it("identity-only files are unverified; a weak ETag is not a sha256", async () => {
    const { downloadArtifactRaw, rawIntegrity, artifactRawPath } = await import("../src/artifacts");
    expect(rawIntegrity(new Headers({ "x-cutex-integrity": "identity-only", etag: 'W/"i-9"' }))).toEqual({ sha256: null, identityOnly: true });
    expect(rawIntegrity(new Headers({ etag: 'W/"' + sha + '"' }))).toEqual({ sha256: null, identityOnly: false });
    expect(rawIntegrity(new Headers({ etag: '"' + sha.toUpperCase() + '"' }))).toEqual({ sha256: sha, identityOnly: false });
    expect(rawIntegrity(new Headers({ etag: '"sha256-' + sha + '"' }))).toEqual({ sha256: sha, identityOnly: false });
    expect(rawIntegrity(new Headers({ etag: 'W/"sha256-' + sha + '"' }))).toEqual({ sha256: null, identityOnly: false });
    expect(artifactRawPath("af 1", 3)).toBe("/v2/artifact-store/af%201/versions/3/raw");
    const fetchImpl = (async () => new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length), etag: 'W/"i-9"', "x-cutex-integrity": "identity-only" } })) as typeof fetch;
    const client = new CutexClient({ baseUrl: "http://host.test", token: "t" }, { fetch: fetchImpl, clientId: "t" });
    const out = await downloadArtifactRaw(client, "af-1", 1);
    expect(out).toMatchObject({ verified: false, sha256: null });
    expect(out.bytes.length).toBe(bytes.length);
  });
});

describe("review R2 / R4", () => {
  const page = (offset: number, data: Uint8Array, total: number, extra: Record<string, unknown> = {}) => ({ version: 3, encoding: "base64", content: Buffer.from(data).toString("base64"), offset, totalBytes: total, truncated: false, mediaType: "text/plain", sha256: null, externalChanged: null, ...extra });

  it("an external file that vanishes after page one is an error, not a short success", async () => {
    const { ArtifactChangedError } = await import("../src/artifacts");
    const { client } = stub((url) => (Number(url.searchParams.get("offset")) === 0 ? page(0, Uint8Array.of(1, 2, 3, 4), 8) : page(4, new Uint8Array(0), 8, { externalChanged: true })));
    await expect(readArtifact(client, "af-x", "latest", { pageBytes: 4 })).rejects.toBeInstanceOf(ArtifactChangedError);
  });

  it("an external file that grows between pages is an error, and never more than maxBytes", async () => {
    const { ArtifactChangedError } = await import("../src/artifacts");
    const { client } = stub((url) => (Number(url.searchParams.get("offset")) === 0 ? page(0, Uint8Array.of(1, 2, 3, 4), 6) : page(4, Uint8Array.of(5, 6, 7, 8), 8)));
    await expect(readArtifact(client, "af-x", "latest", { pageBytes: 4, maxBytes: 6 })).rejects.toBeInstanceOf(ArtifactChangedError);
    const wrongOffset = stub((url) => (Number(url.searchParams.get("offset")) === 0 ? page(0, Uint8Array.of(1, 2), 4) : page(0, Uint8Array.of(1, 2), 4)));
    await expect(readArtifact(wrongOffset.client, "af-x", "latest", { pageBytes: 2 })).rejects.toBeInstanceOf(ArtifactChangedError);
    const otherVersion = stub((url) => (Number(url.searchParams.get("offset")) === 0 ? page(0, Uint8Array.of(1, 2), 4) : page(2, Uint8Array.of(3, 4), 4, { version: 4 })));
    await expect(readArtifact(otherVersion.client, "af-x", "latest", { pageBytes: 2 })).rejects.toBeInstanceOf(ArtifactChangedError);
  });

  it("workspace reads never ask the host for more than its 10 MiB limit", async () => {
    const { WORKSPACE_FILE_MAX } = await import("../src/artifacts");
    const { client, calls } = stub(() => ({ path: "a.ts", size: 1, modifiedAt: "", encoding: "utf8", content: "x", truncated: false, mime: "text/plain" }));
    await readWorkspaceFile(client, { kind: "session", id: "s" }, "a.ts", { maxBytes: 16 * 1024 * 1024 });
    expect(Number(calls[0]!.searchParams.get("maxBytes"))).toBe(WORKSPACE_FILE_MAX);
    expect(WORKSPACE_FILE_MAX).toBe(10 * 1024 * 1024);
  });
});
