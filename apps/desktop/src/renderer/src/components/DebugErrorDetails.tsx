import { useState } from "react";
import { debugError, debugErrorText } from "../../../shared/debug";
import { useDebug, captureDebugError } from "../lib/debugState";
import { useOwnerWindow } from "../lib/ownerContext";
import { useI18n } from "../i18n";

/** Keep normal banners unchanged while off; runtime errors need details even without a failed IPC. */
export function DebugErrorDetails({ error, source }: { error: unknown; source: string }) {
  const enabled = useDebug(s => s.state.enabled), win = useOwnerWindow(), { t } = useI18n();
  const [copied, setCopied] = useState(false);
  if (!enabled) return null;
  const text = debugErrorText(debugError(error, source));
  return <div className="w-full space-y-1 text-xs" data-debug-error-details>
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{text}</pre>
    <button className="text-accent underline" onClick={() => { captureDebugError(error, source); void win.navigator.clipboard.writeText(text).then(() => setCopied(true), e => captureDebugError(e, "debug.copy")); }}>{t(copied ? "reply.copied" : "debug.copyError")}</button>
  </div>;
}
