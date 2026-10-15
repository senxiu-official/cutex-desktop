// A tagged code block of a live agent reply (docs/desktop-modules.md §22; Markdown.tsx hands it over when
// a CodeBlockScope is set): the `timeline.codeBlockAction` items that match it go after streamdown's
// Download / Copy. No match → streamdown's own block, unchanged.
import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import { CodeBlock, CodeBlockCopyButton, CodeBlockDownloadButton, defaultComponents, useIsCodeFenceIncomplete } from "streamdown";
import { useCodeBlockActionItems, useHostPlatform } from "../lib/codeBlockActions";
import { matchCodeBlockActions, trimCode, type CodeBlockScopeValue } from "../lib/codeBlockScope";
import { CodeBlockActions } from "../modules/CodeBlockActions";

type CodeProps = HTMLAttributes<HTMLElement> & { node?: unknown; "data-block"?: string };
const DefaultCode = defaultComponents.code as ComponentType<CodeProps>;

/** The text of a block `code` element as streamdown reads it (one string child, or a string). */
function codeTextOf(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (children && typeof children === "object" && "props" in children) {
    const inner = (children.props as { children?: unknown }).children;
    if (typeof inner === "string") return inner;
  }
  return "";
}

export function ReplyCodeBlock({ scope, language, ...props }: CodeProps & { scope: CodeBlockScopeValue; language: string }) {
  const items = useCodeBlockActionItems(scope.sessionId, scope.hostId);
  const platform = useHostPlatform(scope.hostId);
  const incomplete = useIsCodeFenceIncomplete();
  const block = { language: language.toLowerCase(), hostId: scope.hostId, platform };
  const entries = items.length ? matchCodeBlockActions(items, block, (id, error) => console.error(`[${id}] codeBlockAction match`, error)) : [];
  if (!entries.length) return <DefaultCode {...props} />;
  // = streamdown's default block (line numbers / startLine from the fence meta) + Download + Copy, then the items.
  const { node, className, children, "data-block": _block, ...rest } = props;
  const raw = (node as { properties?: { metastring?: unknown } } | undefined)?.properties?.metastring;
  const meta = typeof raw === "string" ? raw : "";
  const start = Number.parseInt(/startLine=(\d+)/.exec(meta)?.[1] ?? "", 10);
  const code = codeTextOf(children);
  return (
    <CodeBlock {...rest} className={className} code={code} language={language} isIncomplete={incomplete} lineNumbers={!/\bnoLineNumbers\b/.test(meta)} startLine={start >= 1 ? start : undefined}>
      <CodeBlockDownloadButton code={code} language={language} />
      <CodeBlockCopyButton />
      <CodeBlockActions entries={entries} block={{ ...block, sessionId: scope.sessionId, code: trimCode(code), incomplete }} />
    </CodeBlock>
  );
}

