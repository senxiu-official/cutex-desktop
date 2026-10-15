// Tail of a supervised service's log, polled while shown.
import { useEffect, useState } from "react";
import { apiFor } from "../bridge";
import { useApp } from "../store";

/** `hostId`: the service's host (multi-host lists); default the focus host. */
export function ServiceLogs({ slug, hostId, className = "" }: { slug: string; hostId?: string; className?: string }) {
  const [text, setText] = useState("…");
  const host = useApp((s) => hostId ?? s.hosts?.active ?? "local");
  useEffect(() => {
    let live = true;
    const load = () => apiFor(host).serviceLogs(slug).then((r) => live && setText(r.text || "—"), (e: unknown) => live && setText(String(e)));
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [slug, host]);
  return <pre className={`max-h-56 overflow-auto rounded-lg bg-background px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted ${className}`}>{text}</pre>;
}
