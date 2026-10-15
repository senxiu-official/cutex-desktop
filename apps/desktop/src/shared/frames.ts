// Agent pages (docs/desktop-modules.md §10.2): the renderer asks main for a one-use opaque frame
// document of an HTML artifact version. It passes only host + artifact + version; main fetches the
// bytes from that host itself, so no HTML goes renderer → main and no token leaves main.
export const FRAMES_CHANNEL = "cutex-desktop:frames";

export interface ArtifactPageInput {
  hostId: string;
  artifactId: string;
  /** A concrete version (a `@latest` view resolves it first, so a republish gets a new document). */
  version: number;
}
export interface FrameResource {
  id: string;
  url: string;
}
/** Why main did not prepare a page; the view shows the source instead. */
export type ArtifactPageRefusal = "not-found" | "host-offline" | "not-text" | "too-large" | "external-changed";
export type ArtifactPageResult = { ok: true; frame: FrameResource } | { ok: false; reason: ArtifactPageRefusal };

export interface FramesBridge {
  prepareArtifactPage(input: ArtifactPageInput): Promise<ArtifactPageResult>;
  release(id: string): Promise<void>;
}
export type FrameRequest = ({ op: "artifactPage" } & ArtifactPageInput) | { op: "release"; id: string };
