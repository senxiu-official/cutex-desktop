// The text body of an artifact preview: a Markdown document rendered with the chat renderer (same
// sanitising: raw HTML is not rendered, no scripts; relative paths have no base here, so relative
// links / images stay inert) unless `code` (「源代码」), any other text as a fenced code block.
import { Markdown } from "../../components/Markdown";
import { fence, type PreviewKind } from "./model";

export function TextPreview({ kind, text, lang, code = false }: { kind: PreviewKind; text: string; /** Fence language for non-Markdown text. */ lang: string; code?: boolean }) {
  if (kind === "markdown" && !code) return <Markdown document relativeFiles={false} text={text} />;
  return <Markdown text={fence(text, kind === "markdown" ? "markdown" : lang)} />;
}
