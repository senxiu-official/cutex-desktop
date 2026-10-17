// DOCX → sanitised HTML (test/docPreview.test.ts). mammoth turns the document into plain semantic
// HTML (headings, paragraphs, lists, tables, images as data: URIs); DOMPurify then keeps only that
// vocabulary before it reaches the app DOM: no scripts / styles / event handlers / forms / frames,
// no `id` / `name` (DOM clobbering), no `style` / `class`, images only as raster data: URIs, and
// links become inert text (their target in the tooltip) — nothing in a document can navigate the app
// or load a resource. mammoth never reads files outside the docx (`externalFileAccess: false`), and
// the macros of a .docm are never run (it reads word/document.xml only).
import createDOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "del", "ins", "sub", "sup", "br", "hr",
  "a", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "img", "blockquote", "pre", "code", "span", "div", "dl", "dt", "dd",
];
const ALLOWED_ATTR = ["src", "alt", "title", "colspan", "rowspan"];
/** The only URLs kept: inline raster images (the `src` mammoth writes for embedded pictures). */
const IMAGE_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/]+={0,2}$/i;

type PurifyWindow = Parameters<typeof createDOMPurify>[0];

/** Sanitise mammoth's HTML for the app DOM. `win` = the window to parse in (tests pass a jsdom one). */
export function sanitizeDocxHtml(html: string, win: PurifyWindow = window as unknown as PurifyWindow): string {
  // A fresh instance per call: the hooks below belong to this conversion only.
  const purify = createDOMPurify(win);
  purify.addHook("uponSanitizeElement", (node, data) => {
    // A link keeps its text; a web / mail target shows as the tooltip (never followed from here).
    if (data.tagName === "a" && "getAttribute" in node) {
      const el = node as Element;
      const href = el.getAttribute("href");
      if (href && /^(?:https?|mailto):/i.test(href.trim()) && !el.getAttribute("title")) el.setAttribute("title", href.trim().slice(0, 2000));
    }
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (!("tagName" in node)) return;
    const el = node as Element;
    if (el.tagName === "IMG") {
      const src = el.getAttribute("src") ?? "";
      // DOMPurify lets any data: URI through on <img>; keep raster images only.
      if (!IMAGE_DATA_URI.test(src)) el.remove();
      else el.setAttribute("loading", "lazy");
    }
  });
  return purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    // Every non-"URI-safe" attribute value must match this, so the numbers of colspan / rowspan are declared safe.
    ALLOWED_URI_REGEXP: IMAGE_DATA_URI,
    ADD_URI_SAFE_ATTR: ["colspan", "rowspan"],
    RETURN_TRUSTED_TYPE: false,
  }) as string;
}

/** Convert a .docx (bytes read through the daemon) to sanitised HTML; `messages` = mammoth's warnings count. */
export async function docxToSafeHtml(bytes: Uint8Array, win?: PurifyWindow): Promise<{ html: string; messages: number }> {
  const mammoth = await import("mammoth");
  const convert = (mammoth.default ?? mammoth).convertToHtml;
  // A copy: mammoth's zip reader takes an ArrayBuffer of exactly the file (`buffer` = its Node build, in tests).
  const arrayBuffer = bytes.slice().buffer as ArrayBuffer;
  const result = await convert({ arrayBuffer, buffer: bytes } as Parameters<typeof convert>[0], { externalFileAccess: false });
  return { html: sanitizeDocxHtml(result.value, win), messages: result.messages.length };
}
