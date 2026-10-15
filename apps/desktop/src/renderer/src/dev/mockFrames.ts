// Browser preview of agent pages (shared/frames.ts): the preview server (vite.preview.config.ts,
// plugin `mock-frames`) plays main's part — it builds the same offline document
// (@cutex-desktop/opaque-frame/page) and serves it once with the same CSP + sandbox header.
import type { ArtifactContent } from "../../../shared/artifactStore";
import type { FramesBridge } from "../../../shared/frames";

type ReadContent = (hostId: string, artifactId: string, version: number) => Promise<ArtifactContent | null>;

export function mockFrames(read: ReadContent): FramesBridge {
  return {
    async prepareArtifactPage({ hostId, artifactId, version }) {
      const c = await read(hostId, artifactId, version);
      if (!c) return { ok: false, reason: "not-found" };
      if (c.encoding !== "utf8") return { ok: false, reason: "not-text" };
      if (c.truncated) return { ok: false, reason: "too-large" };
      const r = await fetch("/__mock-frame", { method: "POST", body: c.content, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      if (!r.ok) throw new Error(`mock frame: ${r.status}`);
      return { ok: true, frame: (await r.json()) as { id: string; url: string } };
    },
    async release(id) {
      await fetch(`/__mock-frame/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
    },
  };
}
