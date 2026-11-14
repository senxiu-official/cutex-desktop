// Main-owned one-use frame documents (docs/desktop-modules.md §10.1 / §10.2): a document is prepared
// for one renderer (owner = webContents id), served once on the privileged frame scheme with its own
// CSP + `sandbox allow-scripts`, and its URL stays the owner's navigation lease until released.
// Plugin documents and agent pages share this one store, so there is one frame host to audit.
import { isBytes } from "./page";

export interface FrameDocument {
  /** The document; or its UTF-8 byte chunks (a large page), streamed out once and let go chunk by chunk. */
  html: string | readonly Uint8Array[];
  csp: string;
}
export interface PreparedFrameDocument {
  id: string;
  url: string;
}
export interface FrameDocumentStoreOptions {
  scheme: string;
  now?: () => number;
  /** An unconsumed document expires after this long (default 30 s). */
  ttlMs?: number;
  maxDocuments?: number; // default 32
  maxPerOwner?: number; // default 8
  /** Error text when a limit is hit (the plugin service keeps its own wording). */
  limitMessage?: string;
}
export type FrameDocumentStore = ReturnType<typeof createFrameDocumentStore>;

const PATH = /^\/([a-f0-9-]{36})\/index\.html$/;

export function createFrameDocumentStore(options: FrameDocumentStoreOptions) {
  const { scheme } = options;
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? 30_000;
  const maxDocuments = options.maxDocuments ?? 32;
  const maxPerOwner = options.maxPerOwner ?? 8;
  const documents = new Map<string, { owner: number; expires: number; html: string | Uint8Array[] | undefined; csp: string; consumed: boolean }>();
  const prune = () => {
    for (const [id, entry] of documents) if (!entry.consumed && entry.expires <= now()) documents.delete(id);
  };
  const match = (value: URL) =>
    value.protocol === `${scheme}:` && value.hostname === "frame" && !value.port && !value.username && !value.password && !value.search && !value.hash ? PATH.exec(value.pathname) : null;
  return {
    add(owner: number, document: FrameDocument): PreparedFrameDocument {
      if (!Number.isSafeInteger(owner) || owner < 0) throw new Error("Invalid frame owner");
      const chunks = Array.isArray(document?.html) ? (document.html as readonly unknown[]) : null;
      if ((typeof document?.html !== "string" && !(chunks && chunks.every(isBytes))) || typeof document.csp !== "string" || !document.csp.includes("default-src 'none'")) throw new Error("Invalid frame document");
      prune();
      if (documents.size >= maxDocuments || [...documents.values()].filter((value) => value.owner === owner).length >= maxPerOwner)
        throw new Error(options.limitMessage ?? "Too many prepared frame documents");
      const id = crypto.randomUUID();
      documents.set(id, { owner, expires: now() + ttl, consumed: false, html: chunks ? [...(chunks as Uint8Array[])] : (document.html as string), csp: document.csp });
      return { id, url: `${scheme}://frame/${id}/index.html` };
    },
    release(owner: number, id: string): void {
      if (documents.get(id)?.owner === owner) documents.delete(id);
    },
    releaseOwner(owner: number): void {
      for (const [id, document] of documents) if (document.owner === owner) documents.delete(id);
    },
    ownsUrl(value: string, owner: number): boolean {
      prune();
      try {
        const found = match(new URL(value));
        return !!found && documents.get(found[1]!)?.owner === owner;
      } catch {
        return false;
      }
    },
    respond(request: Request): Response {
      prune();
      const rejected = () => new Response("Frame document unavailable", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return rejected();
      }
      const found = match(url);
      if (request.method !== "GET" || !found) return rejected();
      const document = documents.get(found[1]!);
      if (!document || document.consumed) return rejected();
      document.consumed = true; // Keep only the owner's navigation lease; never serve the bytes twice.
      const html = document.html;
      document.html = undefined;
      // Chunks go out one by one and are dropped as they go: the bytes are never copied into one body.
      const body = typeof html === "string" || html === undefined ? html : new ReadableStream<Uint8Array>({
        pull(controller) {
          const next = html.shift();
          if (next) controller.enqueue(next);
          else controller.close();
        },
        cancel() {
          html.length = 0;
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": `${document.csp}; sandbox allow-scripts`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        },
      });
    },
  };
}
