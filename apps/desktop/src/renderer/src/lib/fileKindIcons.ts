// Icons of the file kinds (lib/fileKinds): file links in messages (components/Markdown FileChip) and the
// 文件 tree share one set, in the sidebar's line style (lucide, thin stroke).
import { File, FileArchive, FileBraces, FileCode, FileImage, FileText, FileType, Folder, type LucideIcon } from "lucide-react";
import type { FileKind } from "./fileKinds";

export const FILE_KIND_ICON: Record<FileKind, LucideIcon> = {
  markdown: FileText,
  text: FileType,
  code: FileCode,
  image: FileImage,
  pdf: FileText,
  data: FileBraces,
  archive: FileArchive,
  folder: Folder,
  file: File,
};
