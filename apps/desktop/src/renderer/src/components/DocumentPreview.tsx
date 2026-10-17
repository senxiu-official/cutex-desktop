// A document file's preview (lib/docPreview.ts decides): PDF in the pdf.js viewer, DOCX as sanitised
// HTML — both lazy chunks — or a card saying why not (another office format, too large, not a valid
// file). `load` reads the bytes through the daemon (workspace / host file, artifact version);
// `loadKey` names what it reads (a new key reloads).
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { FileWarning } from "lucide-react";
import { useI18n } from "../i18n";
import { docTypeLabel, formatSize, type DocState } from "../lib/docPreview";

const PdfViewer = lazy(() => import("./PdfViewer"));
const DocxView = lazy(() => import("./DocxView"));

export function DocumentPreview({ name, mime, loadKey, load }: { name: string; mime?: string; loadKey: string; load(): Promise<DocState> }) {
  const { t } = useI18n();
  const [result, setResult] = useState<{ key: string; state?: DocState; error?: string } | null>(null);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let live = true;
    loader.current().then(
      (state) => live && setResult({ key: loadKey, state }),
      (e: unknown) => live && setResult({ key: loadKey, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [loadKey]);
  const loading = <p className="p-3 text-xs text-subtle">{t("docPreview.loading")}</p>;
  if (!result || result.key !== loadKey) return loading;
  if (result.error) return <p className="p-3 text-xs text-danger">{t("docPreview.failed", { error: result.error })}</p>;
  const s = result.state!;
  if (s.state === "ready")
    return <Suspense fallback={loading}>{s.kind === "pdf" ? <PdfViewer bytes={s.bytes} name={name} /> : <DocxView bytes={s.bytes} />}</Suspense>;
  const type = docTypeLabel(name, mime);
  const size = formatSize(s.size);
  const text =
    s.state === "too-large"
      ? t("docPreview.tooLarge", { type, size, max: formatSize(s.max) })
      : s.state === "invalid"
        ? t("docPreview.invalid", { type, size })
        : t(s.reason === "legacy" ? "docPreview.office.legacy" : "docPreview.office.unsupported", { type, size });
  return (
    <div className="m-3 flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-xs" data-doc-state={s.state}>
      <FileWarning size={16} className="mt-px shrink-0 text-subtle" />
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground" title={name}>
          {name}
        </p>
        <p className="mt-0.5 text-subtle">
          {type} · {size}
        </p>
        <p className="mt-1.5 leading-relaxed text-muted">{text}</p>
      </div>
    </div>
  );
}
