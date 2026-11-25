// Registry 2.11 (§三之六, NEXT_UP_DELEGATION_ENDING): a delegation status notice in 接下来 says who or what caused the
// notice it carries — 「· 由你」 / 「· 由 cutex 调度」 / 「· 未记录由谁」 — with the whole sequence on hover. Each row is matched
// to its own immutable snapshot by the stable ref cutex puts first in the record's preview (`terminal@9: title`,
// `handlerTurnFailed@2: title`); no match (an older host, a ref outside the kept history), no words — never the
// delegation's later ending. Display only: the row's registered state and buttons are unchanged.
import { useRef } from "react";
import type { AskSummary } from "../../../shared/ipc";
import { noticeRefOfPreview } from "../lib/delegationTerminal";
import { EndingBy, useDelegationEnding, useEndingRequest } from "./DelegationEnding";

export function NextUpEndingBy({ host, ask, preview }: { host: string; ask: AskSummary; preview: string | null | undefined }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEndingRequest(host, ask, ref);
  const { notices } = useDelegationEnding(host, ask);
  const own = noticeRefOfPreview(preview);
  const notice = own ? notices.find((n) => n.ref === own) ?? null : null;
  return <span ref={ref} className="inline-flex min-w-0 max-w-[30%] shrink">{notice && <EndingBy notice={notice} notices={notices} targetName={ask.targetName ?? ask.target} className="text-ui" />}</span>;
}
