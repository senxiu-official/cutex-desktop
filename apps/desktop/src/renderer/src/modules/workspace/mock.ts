// Browser-preview workspace tree (文件 card; dev/mockTypes.ts): `fs/dir` listings of a small
// cutex-desktop checkout and the `fs/watch` handles. `?treerefresh` scripts changes every few seconds
// (lib/workspaceRefresh.ts): a shell-style change the watch reports (a notes file in docs/research
// appears, later goes), and an Eva turn whose `fileChange` item adds a file under apps/desktop/src/main
// with no watch event at all (a host whose watcher misses it): open those folders and watch them update.
// Document samples (components/DocumentPreview.tsx): a `samples/` folder with a tiny generated PDF
// (3 pages), a DOCX (heading, link, table, CJK paragraph, embedded PNG) and a 240-page PDF — written
// for this preview, no third-party content — plus office formats that show the "can't preview here"
// card, a PDF over the size cap and a text file named .pdf. The same names work as host paths
// (…/samples/x, through the core's `files.read` hook).
import type { FsDir, FsFile } from "../../../../shared/ipc";
import type { ModuleMock } from "../../dev/mockTypes";

const ROOT = "D:\\Apps\\cutex-desktop";
const at = (rel: string) => `${ROOT}\\${rel.replace(/\//g, "\\")}`;

type Kind = "file" | "dir";
const tree: Record<string, [string, Kind][]> = {
  "": [["apps", "dir"], ["docs", "dir"], ["AGENTS.md", "file"], ["PLAN.md", "file"], ["package.json", "file"]],
  docs: [["research", "dir"], ["DESIGN.md", "file"]],
  "docs/research": [["zcode-ui.md", "file"]],
  apps: [["desktop", "dir"]],
  "apps/desktop": [["src", "dir"], ["package.json", "file"]],
  "apps/desktop/src": [["main", "dir"], ["renderer", "dir"]],
  "apps/desktop/src/main": [["daemon.ts", "file"], ["index.ts", "file"]],
  "apps/desktop/src/renderer": [["index.html", "file"]],
};
const sizes = new Map<string, number>();

const SAMPLE_PDF =
  "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwg" +
  "L1R5cGUgL1BhZ2VzIC9LaWRzIFs0IDAgUiA2IDAgUiA4IDAgUl0gL0NvdW50IDMgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUg" +
  "L0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago0IDAgb2JqCjw8IC9UeXBlIC9QYWdl" +
  "IC9QYXJlbnQgMiAwIFIgL01lZGlhQm94IFswIDAgNjEyIDc5Ml0gL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgMyAwIFIgPj4g" +
  "Pj4gL0NvbnRlbnRzIDUgMCBSID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMjQ2ID4+CnN0cmVhbQpCVAovRjEgMjQgVGYK" +
  "NzIgNzIwIFRkCihDdXRleCBzYW1wbGUgUERGKSBUagovRjEgMTIgVGYKMCAtMjggVGQKKFBhZ2UgMSBvZiAzKSBUagowIC0yOCBU" +
  "ZAooVGhpcyB0aW55IGRvY3VtZW50IGlzIGdlbmVyYXRlZCBmb3IgdGhlIHJlbmRlcmVyIHByZXZpZXcuKSBUagowIC0yOCBUZAoo" +
  "U2VsZWN0IHRoaXMgdGV4dCB0byBjaGVjayB0aGUgdGV4dCBsYXllci4pIFRqCkVUCjAuMyAwLjQ1IDAuOSByZwo3MiA1NjAgMjAw" +
  "IDYwIHJlIGYKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjw8IC9UeXBlIC9QYWdlIC9QYXJlbnQgMiAwIFIgL01lZGlhQm94IFsw" +
  "IDAgNjEyIDc5Ml0gL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgMyAwIFIgPj4gPj4gL0NvbnRlbnRzIDcgMCBSID4+CmVuZG9i" +
  "ago3IDAgb2JqCjw8IC9MZW5ndGggMTk1ID4+CnN0cmVhbQpCVAovRjEgMjQgVGYKNzIgNzIwIFRkCihTZWNvbmQgcGFnZSkgVGoK" +
  "L0YxIDEyIFRmCjAgLTI4IFRkCihab29tIGluIGFuZCBvdXQgd2l0aCB0aGUgdG9vbGJhci4pIFRqCjAgLTI4IFRkCihQYWdlcyBy" +
  "ZW5kZXIgbGF6aWx5IGFzIHRoZXkgc2Nyb2xsIGludG8gdmlldy4pIFRqCkVUCjAuNSAwLjQ1IDAuOSByZwo3MiA1NjAgMjAwIDYw" +
  "IHJlIGYKZW5kc3RyZWFtCmVuZG9iago4IDAgb2JqCjw8IC9UeXBlIC9QYWdlIC9QYXJlbnQgMiAwIFIgL01lZGlhQm94IFswIDAg" +
  "NjEyIDc5Ml0gL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgMyAwIFIgPj4gPj4gL0NvbnRlbnRzIDkgMCBSID4+CmVuZG9iago5" +
  "IDAgb2JqCjw8IC9MZW5ndGggMTA5ID4+CnN0cmVhbQpCVAovRjEgMjQgVGYKNzIgNzIwIFRkCihUaGlyZCBwYWdlKSBUagovRjEg" +
  "MTIgVGYKMCAtMjggVGQKKFRoZSBlbmQuKSBUagpFVAowLjcgMC40NSAwLjkgcmcKNzIgNTYwIDIwMCA2MCByZSBmCmVuZHN0cmVh" +
  "bQplbmRvYmoKeHJlZgowIDEwCjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAw" +
  "IG4gCjAwMDAwMDAxMzMgMDAwMDAgbiAKMDAwMDAwMDIwMyAwMDAwMCBuIAowMDAwMDAwMzI5IDAwMDAwIG4gCjAwMDAwMDA2MjYg" +
  "MDAwMDAgbiAKMDAwMDAwMDc1MiAwMDAwMCBuIAowMDAwMDAwOTk4IDAwMDAwIG4gCjAwMDAwMDExMjQgMDAwMDAgbiAKdHJhaWxl" +
  "cgo8PCAvU2l6ZSAxMCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMTI4NAolJUVPRgo=";

const SAMPLE_DOCX =
  "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" +
  "UEsFBgAAAAAGAAYAgwEAAFwQAAAAAA==";

/** A long PDF built here (one line per page): the lazy page rendering of a big document. */
function longPdf(pages: number): string {
  const objs: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids: number[] = [];
  for (let i = 1; i <= pages; i++) {
    const stream = `BT /F1 28 Tf 72 700 Td (Page ${i} of ${pages}) Tj ET 0.${(i % 9) + 1} 0.5 0.8 rg 72 400 ${100 + (i % 5) * 80} 200 re f`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length + 2} 0 R >>`);
    kids.push(objs.length);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return btoa(out);
}

const MIB = 1024 * 1024;
const OLE = "0M8R4KGxGuEAAAAAAAAAAAAAAAAAAAAAPgADAP7/CQAGAAAAAAAAAAAAAAAB"; // an OLE2 header (legacy Office), padding
const ZIP = "UEsDBBQAAAAIAAAAIQA="; // a zip local header (OOXML), padding

/** name → [base64 content, reported size] (a size above the content = a big file, read truncated). */
const FILES: Record<string, [string, number]> = {
  "sample.pdf": [SAMPLE_PDF, 0],
  "sample.docx": [SAMPLE_DOCX, 0],
  "long-report.pdf": [longPdf(240), 0],
  "legacy-report.doc": [OLE, 48 * 1024],
  "budget.xlsx": [ZIP, 23 * 1024],
  "slides.pptx": [ZIP, 2.4 * MIB],
  "scan-archive.pdf": ["JVBERi0xLjcK", 48 * MIB],
  "renamed-text.pdf": ["", 0],
};
const MIME: Record<string, string> = { pdf: "application/pdf" };

function body(path: string, name: string, maxBytes = 2 * MIB): FsFile | null {
  const entry = FILES[name];
  if (!entry) return null;
  const modifiedAt = new Date().toISOString();
  const ext = name.split(".").pop()!;
  if (name === "renamed-text.pdf") {
    const content = "just some text saved with a .pdf name\n";
    return { path, size: content.length, modifiedAt, encoding: "utf8", content, truncated: false, mime: "text/plain" };
  }
  const bytes = Uint8Array.from(atob(entry[0]), (c) => c.charCodeAt(0));
  const size = Math.max(entry[1], bytes.length);
  const cut = bytes.subarray(0, Math.min(maxBytes, bytes.length));
  let bin = "";
  for (const b of cut) bin += String.fromCharCode(b);
  return { path, size, modifiedAt, encoding: "base64", content: btoa(bin), truncated: cut.length < size, mime: MIME[ext] ?? "application/octet-stream" };
}

tree[""]!.splice(2, 0, ["samples", "dir"]);
tree.samples = Object.keys(FILES).map((name) => [name, "file"]);
for (const [name, [b64, size]] of Object.entries(FILES)) sizes.set(`samples/${name}`, Math.max(size, Math.floor((b64.length * 3) / 4)));

/** `?nonowner&broadroot`: cutex does not open a too-broad root to other users (403 on every read). */
function broadRootRefusal(): void {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  if (q.has("nonowner") && q.has("broadroot")) throw new Error("workspace_root_too_broad: this workspace root is not available to other users");
}

const sorted = (entries: [string, Kind][]) => [...entries].sort(([a, ak], [b, bk]) => (ak === bk ? a.localeCompare(b) : ak === "dir" ? -1 : 1));

function addFile(dir: string, name: string): string {
  const list = tree[dir] ?? (tree[dir] = []);
  if (!list.some(([n]) => n === name)) tree[dir] = sorted([...list, [name, "file"]]);
  return dir ? `${dir}/${name}` : name;
}

function removeFile(dir: string, name: string): string {
  tree[dir] = (tree[dir] ?? []).filter(([n]) => n !== name);
  return dir ? `${dir}/${name}` : name;
}

const watches = new Set<string>();
let watchSeq = 0;

export const mock: ModuleMock = {
  files: {
    read(path, maxBytes) {
      const match = /(?:^|[\\/])samples[\\/]([^\\/]+)$/.exec(path);
      return match ? body(path, match[1]!, maxBytes) : null;
    },
  },
  api: () => ({
    async fsDir(_scope, path): Promise<FsDir> {
      broadRootRefusal();
      return {
        root: ROOT,
        path,
        entries: (tree[path] ?? []).map(([name, kind]) => {
          const full = path ? `${path}/${name}` : name;
          return { name, path: full, kind, targetKind: null, size: kind === "file" ? (sizes.get(full) ?? 1200) : null, modifiedAt: "2026-10-16T08:00:00Z", ignored: false };
        }),
      };
    },
    async watchWorkspace() {
      const id = `mock-watch-${++watchSeq}`;
      watches.add(id);
      return id;
    },
    async unwatchWorkspace(id) {
      watches.delete(id);
    },
  }),
  start(core) {
    if (typeof location === "undefined" || !new URLSearchParams(location.search).has("treerefresh")) return;
    const notes: string[] = [];
    let step = 0;
    let n = 0;
    const watched = (paths: string[]) => {
      for (const watchId of watches) core.emit("workspaceChanged", { watchId, paths, gitChanged: false, overflow: false });
    };
    setInterval(() => {
      const phase = step++ % 3;
      if (phase === 0) {
        // A shell command wrote a file: only the watch reports it.
        const name = `notes-${++n}.md`;
        notes.push(name);
        watched([addFile("docs/research", name)]);
      } else if (phase === 1) {
        // Eva's patch adds a file: her turn's fileChange item is the only signal.
        const name = `feature-${n}.ts`;
        const rel = addFile("apps/desktop/src/main", name);
        sizes.set(rel, 300 + n);
        const turnId = `tree-t${n}`;
        const now = Date.now() / 1000;
        core.nativeEvent("eva", "turn/started", { threadId: "thread-eva", turn: { id: turnId, status: "inProgress", startedAt: now } });
        core.nativeEvent("eva", "item/completed", {
          threadId: "thread-eva",
          turnId,
          item: { type: "fileChange", id: `${turnId}-f`, status: "completed", changes: [{ path: at(rel), kind: { type: "add" }, diff: `export const feature${n} = ${n};\n` }] },
        });
        core.nativeEvent("eva", "turn/completed", { threadId: "thread-eva", turn: { id: turnId, status: "completed", completedAt: now + 1 } });
      } else if (notes.length > 1) {
        // Cleanup of the oldest notes file (watch only).
        watched([removeFile("docs/research", notes.shift()!)]);
      }
    }, 4000);
  },
};
