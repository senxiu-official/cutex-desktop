// A web lookup's row (lib/webToolRows): 「搜索网页 · <query>」 / 「打开网页 · <url>」 on the core row; expanded, the
// page as a link (opened as a message's link is: main decides where), the query / prompt, and what came back.
import { Globe, Search } from "lucide-react";
import type { RawItem } from "../../lib/timeline";
import { webToolRow, type WebToolModel } from "../../lib/webToolRows";
import { toolOutput } from "../../lib/workGroups";
import { PlainToolRow } from "../../components/PlainToolRow";
import { ItemMedia } from "../../components/ItemMedia";
import { useConvHost } from "../../lib/conversationScope";
import { useI18n } from "../../i18n";
import { api } from "../../bridge";
import { contextMenu } from "../../lib/contextMenu";
import { copyText } from "../../lib/menus";
import { TimelineRowFallback } from "../TimelineRowFallback";

const icons = { webSearch: Search, webPage: Globe } as const;

function Details({ item, model }: { item: RawItem; model: WebToolModel }) {
  const { t } = useI18n();
  const output = toolOutput(item);
  return (
    <div className="max-h-72 overflow-auto rounded-md bg-surface p-2 text-caption/[inherit] text-muted" data-web-tool={model.kind}>
      {model.url && (
        <a
          href={model.url}
          target="_blank"
          rel="noreferrer"
          title={model.url}
          data-web-tool-link=""
          className="mb-1.5 block truncate font-mono text-accent hover:underline"
          onContextMenu={contextMenu(() => [
            { label: t("menu.openLink"), onSelect: () => void api.openExternal(model.url!) },
            { label: t("menu.copyLink"), onSelect: () => copyText(model.url!) },
          ])}
        >
          {model.url}
        </a>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono">
        {model.fields
          .filter((f) => !(f.name === "url" && model.url))
          .map((f, i) => (
            <div key={`${f.name}:${i}`} className="contents">
              <dt className="text-subtle">{f.name}</dt>
              <dd className="whitespace-pre-wrap break-all">{f.value}</dd>
            </div>
          ))}
      </dl>
      {output && <pre className="mt-2 font-mono whitespace-pre-wrap break-words">{output}</pre>}
    </div>
  );
}

export function WebToolRow({ item }: { item: RawItem; sessionId: string }) {
  const hostId = useConvHost();
  const model = webToolRow(item);
  if (!model) return <TimelineRowFallback />;
  return (
    <>
      <PlainToolRow item={item} presentation={{ kind: model.kind, key: `conversation.tools.${model.kind}`, detail: model.summary, icon: icons[model.kind], details: <Details item={item} model={model} /> }} />
      <ItemMedia item={item} hostId={hostId} />
    </>
  );
}
