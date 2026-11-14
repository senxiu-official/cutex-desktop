// Agent pages (docs/desktop-modules.md §10.2): the renderer asks main for a one-use opaque frame
// document of an HTML artifact version. It passes only host + artifact + version; main fetches the
// bytes from that host itself, so no HTML goes renderer → main and no token leaves main.
import type { WorkspaceScope } from "./ipc";
import type { PageCall, PageDataUsage, PageResult } from "./pageBridge";

export const FRAMES_CHANNEL = "cutex-desktop:frames";

export interface ArtifactPageInput {
  hostId: string;
  artifactId: string;
  /** A concrete version (a `@latest` view resolves it first, so a republish gets a new document). */
  version: number;
  /** The owner chose to show a page over ARTIFACT_PAGE_PROMPT_BYTES (it is read in windows, up to ARTIFACT_PAGE_MAX_BYTES). */
  large?: boolean;
}
/** Above this a page is shown only after the owner asks for it (one content window of the host). */
export const ARTIFACT_PAGE_PROMPT_BYTES = 4 * 1024 * 1024;
/** Hard bound of a page main assembles in memory (pages with embedded audio / video can be large). */
export const ARTIFACT_PAGE_MAX_BYTES = 256 * 1024 * 1024;
/**
 * An HTML file shown as a page in the file view (owner 2026-10-24): the same one-use offline opaque document as an
 * artifact page, but with NO page channels (no storage / submit / copy). Main reads the bytes from that host itself:
 * `scope` = a workspace-relative path (fs/file), none = an absolute path on the host (fs-file-read).
 */
export interface FilePageInput {
  hostId: string;
  path: string;
  scope?: WorkspaceScope;
  /** The owner chose to show a file over FILE_PAGE_PROMPT_BYTES (main reads it in windows, up to FILE_PAGE_MAX_BYTES). */
  large?: boolean;
}
/** Above this a file is shown as a page only after the owner asks for it. */
export const FILE_PAGE_PROMPT_BYTES = 5 * 1024 * 1024;
/** cutex reads at most this much of a file in one request (fs/file maxBytes limit): one window. */
export const FILE_PAGE_WINDOW_BYTES = 10 * 1024 * 1024;
/**
 * The largest HTML file shown as a page, the same hard bound as an artifact page: main reads it in windows
 * (cutex fs-file-window: fs/file `offset`). A host without windowed reads shows at most one window
 * (FILE_PAGE_WINDOW_BYTES); larger files stay source only.
 */
export const FILE_PAGE_MAX_BYTES = ARTIFACT_PAGE_MAX_BYTES;
export type FilePageRefusal = "not-found" | "host-offline" | "not-text" | "too-large";
export type FilePageResult =
  | { ok: true; frame: FrameResource; /** references to files next to it / the network that the page cannot load (inline-only) */ externalRefs: number }
  | {
      ok: false;
      reason: FilePageRefusal;
      totalBytes?: number;
      /** Metadata of the same read, for a revision-specific size decision. */
      modifiedAt?: string;
      /** too-large: the largest page this host's file can be shown as (FILE_PAGE_MAX_BYTES, or one window on an older cutex). */
      maxBytes?: number;
    };
export interface FrameResource {
  id: string;
  url: string;
}
/** Why main did not prepare a page; the view shows the source instead. */
export type ArtifactPageRefusal = "not-found" | "host-offline" | "not-text" | "too-large" | "external-changed";
export type ArtifactPageResult =
  | { ok: true; frame: FrameResource }
  | { ok: false; reason: ArtifactPageRefusal; /** too-large: the page's size */ totalBytes?: number };

export interface FramesBridge {
  /**
   * `deskId` (multi-window P4): the frame will be drawn in that desk window. Main checks the desk is one this
   * window opened and still open, and leases the document to that window only (it loads nowhere else; a page's
   * native confirm parents to it; it is released when the desk goes). None = the main window.
   */
  prepareArtifactPage(input: ArtifactPageInput, deskId?: string): Promise<ArtifactPageResult>;
  prepareFilePage(input: FilePageInput, deskId?: string): Promise<FilePageResult>;
  release(id: string): Promise<void>;
  /** A page request (shared/pageBridge.ts) the broker accepted from frame `id`; main decides it. */
  page(id: string, call: PageCall): Promise<PageResult>;
  /** Channel A data of all pages (Settings) and the owner clearing one page's data (⋯ menu, Settings). */
  pageDataUsage(): Promise<PageDataUsage>;
  pageDataClear(hostId: string, artifactId: string): Promise<void>;
}
export type FrameRequest =
  | ({ op: "artifactPage"; deskId?: string } & ArtifactPageInput)
  | ({ op: "filePage"; deskId?: string } & FilePageInput)
  | { op: "release"; id: string }
  | { op: "page"; id: string; call: PageCall }
  | { op: "pageDataUsage" }
  | { op: "pageDataClear"; hostId: string; artifactId: string };
