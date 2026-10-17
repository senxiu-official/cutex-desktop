// pdf.js for the document preview (components/PdfViewer.tsx loads this module lazily, so the main
// bundle does not carry pdf.js). Isolation, in the renderer:
// - The PDF is opened from bytes the daemon returned (`data`), never from a URL: pdf.js makes no
//   request for the document, and the renderer CSP (connect-src 'self') would refuse one anyway.
// - Parsing runs in pdf.js's worker, bundled with the app (`?url` asset, no CDN). pdf.js 6 has no
//   eval / `new Function` path at all (the old `isEvalSupported` option is gone with it), XFA stays
//   off, and PDF JavaScript never runs: only the canvas and the text layer are rendered — no
//   annotation layer (no links, forms or actions) and no pdf.sandbox (the scripting engine) loaded.
// - CMaps (CJK text), the standard fonts and the image-decoder wasm are bundled assets too, read by
//   the main-thread factory below (`useWorkerFetch: false`), so nothing is fetched from elsewhere.
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

const glob = (files: Record<string, unknown>) => new Map(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url as string]));
const ASSETS: Record<string, Map<string, string>> = {
  cMapUrl: glob(import.meta.glob("../../../../node_modules/pdfjs-dist/cmaps/*.bcmap", { query: "?url", import: "default", eager: true })),
  standardFontDataUrl: glob(import.meta.glob("../../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}", { query: "?url", import: "default", eager: true })),
  // The image decoders only — never quickjs-eval.wasm (pdf.js's PDF-JavaScript engine).
  wasmUrl: glob(import.meta.glob("../../../../node_modules/pdfjs-dist/wasm/{jbig2,openjpeg}.wasm", { query: "?url", import: "default", eager: true })),
};

/** Bytes of a bundled asset URL: inlined data: URL, the dev server (http), or the packaged app's file:// (XHR). */
async function readAsset(url: string): Promise<Uint8Array> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    const bin = atob(url.slice(comma + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const abs = new URL(url, document.baseURI);
  if (abs.protocol === "http:" || abs.protocol === "https:") {
    const res = await fetch(abs);
    if (!res.ok) throw new Error(res.statusText);
    return new Uint8Array(await res.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", abs.href, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => (xhr.status === 200 || xhr.status === 0) && xhr.response ? resolve(new Uint8Array(xhr.response as ArrayBuffer)) : reject(new Error(`asset ${xhr.status}`));
    xhr.onerror = () => reject(new Error("asset unreadable"));
    xhr.send();
  });
}

/** pdf.js `BinaryDataFactory`: only the bundled files above, by name. */
class BundledBinaryData {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = ASSETS[kind]?.get(filename);
    if (!url) throw new Error(`no bundled pdf.js ${kind} file ${filename}`);
    return readAsset(url);
  }
}

export function openPdf(bytes: Uint8Array): PDFDocumentLoadingTask {
  return getDocument({
    // pdf.js transfers the buffer to its worker: hand it a copy, the caller keeps its bytes.
    data: bytes.slice(),
    BinaryDataFactory: BundledBinaryData,
    useWorkerFetch: false,
    cMapPacked: true,
    enableXfa: false,
    stopAtErrors: false,
    // Bound decoded image memory (pixels) of a hostile file.
    maxImageSize: 64 * 1024 * 1024,
  });
}

export { TextLayer } from "pdfjs-dist";
export type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
