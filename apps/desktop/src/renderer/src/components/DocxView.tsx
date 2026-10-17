// DOCX preview (lazy chunk with mammoth + DOMPurify): the document converted to semantic HTML and
// sanitised (lib/docxHtml.ts) before it is set into the DOM — layout, headers / footers and comments
// are not shown, which the note above the text says.
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { docxToSafeHtml } from "../lib/docxHtml";
import "./docPreview.css";

export default function DocxView({ bytes }: { bytes: Uint8Array }) {
  const { t } = useI18n();
  const [out, setOut] = useState<{ html: string } | { error: string } | null>(null);
  useEffect(() => {
    setOut(null);
    let live = true;
    docxToSafeHtml(bytes).then(
      (r) => live && setOut({ html: r.html }),
      (e: unknown) => live && setOut({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [bytes]);
  if (!out) return <p className="p-3 text-xs text-subtle">{t("docPreview.loading")}</p>;
  if ("error" in out) return <p className="p-3 text-xs text-danger">{t("docPreview.failed", { error: out.error })}</p>;
  return (
    <div className="h-full min-h-0 overflow-auto">
      <p className="mx-3 mt-2 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-subtle">{t("docPreview.docxNote")}</p>
      {out.html.trim() ? (
        // Sanitised by lib/docxHtml.ts (DOMPurify allowlist: no scripts, handlers, styles, ids, links or remote images).
        <div className="docx-preview px-4 py-3 text-sm" dangerouslySetInnerHTML={{ __html: out.html }} />
      ) : (
        <p className="p-3 text-xs text-subtle">{t("docPreview.empty")}</p>
      )}
    </div>
  );
}
