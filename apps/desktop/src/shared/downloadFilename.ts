// Pure filename policy shared by main-process saves, Chromium downloads and owned copies.
// Display names may end in version numbers (r5.3); only payload metadata supplies their suffix.
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/zip": "zip", "application/x-zip-compressed": "zip",
  "application/pdf": "pdf", "application/json": "json", "application/ld+json": "jsonld",
  "application/gzip": "gz", "application/x-gzip": "gz", "application/x-tar": "tar",
  "application/x-7z-compressed": "7z", "application/x-rar-compressed": "rar",
  "application/wasm": "wasm", "application/xml": "xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/svg+xml": "svg", "image/avif": "avif", "image/bmp": "bmp", "image/tiff": "tiff",
  "text/plain": "txt", "text/markdown": "md", "text/html": "html", "text/css": "css",
  "text/csv": "csv", "text/tab-separated-values": "tsv", "text/xml": "xml",
  "text/javascript": "js", "application/javascript": "js", "text/x-python": "py",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg",
  "video/mp4": "mp4", "video/webm": "webm",
};

function extensionOf(path: string): string | undefined {
  const name = path.split(/[\\/]/).pop() ?? "";
  const compound = /\.(tar\.(?:gz|bz2|xz|zst))$/i.exec(name);
  if (compound) return compound[1];
  const dot = name.lastIndexOf(".");
  const suffix = name.slice(dot + 1);
  return dot > 0 && /^[a-z0-9][a-z0-9_+-]{0,31}$/i.test(suffix) ? suffix : undefined;
}

export function downloadFilename(name: string, options: {
  sourcePath?: string; mime?: string; extension?: string; maxLength?: number;
} = {}): string {
  const mime = options.mime?.split(";", 1)[0]?.trim().toLowerCase();
  // A ZIP payload remains a ZIP even if a bundle's display/source label contains a version dot.
  const zip = mime === "application/zip" || mime === "application/x-zip-compressed";
  const sourceExtension = options.sourcePath ? extensionOf(options.sourcePath) : undefined;
  const mimeExtension = mime ? MIME_EXTENSIONS[mime] : undefined;
  const extension = options.extension?.replace(/^\.+/, "")
    || (zip ? "zip" : undefined)
    || (sourceExtension && (!/^\d+$/.test(sourceExtension) || !mimeExtension) ? sourceExtension : undefined)
    || mimeExtension
    || extensionOf(name);
  const suffix = extension && /^[a-z0-9][a-z0-9_.+-]{0,40}$/i.test(extension) ? `.${extension}` : "";
  let safe = name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").replace(/[. ]+$/g, "");
  if (!safe || /^\.+$/.test(safe)) safe = "download";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])[ .]*(?:\.|$)/i.test(safe)) safe = `_${safe}`;
  const hasSuffix = suffix && safe.toLowerCase().endsWith(suffix.toLowerCase());
  const stem = hasSuffix ? safe.slice(0, -suffix.length) : safe;
  const max = Math.max(suffix.length + 1, Math.floor(options.maxLength ?? 160));
  // Reserve the entire real suffix before truncating; never turn a long .zip into extensionless bytes.
  const trimmed = stem.slice(0, max - suffix.length).replace(/[. ]+$/g, "") || "download";
  return trimmed + (hasSuffix ? safe.slice(-suffix.length) : suffix);
}

/** Electron FileFilter extensions have no leading dot/wildcard. Compound archives filter by gz/xz. */
export function downloadFilters(name: string, label = "File"): { name: string; extensions: string[] }[] | undefined {
  const extension = extensionOf(name)?.split(".").pop();
  return extension ? [{ name: label, extensions: [extension.toLowerCase()] }] : undefined;
}
