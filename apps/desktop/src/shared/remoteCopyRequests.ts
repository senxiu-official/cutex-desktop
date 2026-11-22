import type { HostBinding } from "./hosts";
import type { CopySource, TransferMeta } from "./remoteCopies";
import { canOpenFileName } from "./localFiles";

/**
 * Downloads must not launch scripts or programs through a system file association (the shared type lists,
 * shared/localFiles.ts; a downloaded copy is never run from the app — reveal is the way through).
 */
export function canOpenCopy(name: string): boolean {
  return canOpenFileName(name);
}

export type CopyRequest =
  | { kind: "list" }
  | { kind: "inspect"; source: CopySource; binding: HostBinding }
  | { kind: "start"; source: CopySource; binding: HostBinding; expected: Pick<TransferMeta, "revision" | "size">; replaceId?: string }
  | { kind: "cancel" | "remove" | "open" | "reveal"; id: string }
  | { kind: "keep"; id: string; value: boolean }
  | { kind: "settings"; retentionDays: number | null }
  /** The download folder ({ path, isDefault }); open it; pick another in main's dialog / go back to the default (both return the folder). */
  | { kind: "folder" | "openFolder" | "chooseFolder" | "defaultFolder" };
export interface DownloadFolder { path: string; isDefault: boolean }
export interface PreparedCopy { source: CopySource; meta: TransferMeta }
