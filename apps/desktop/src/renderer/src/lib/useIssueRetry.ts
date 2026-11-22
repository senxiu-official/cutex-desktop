// While a read's issue says it retries (lib/transientError.ts), call `reload` after 1, 2, 5, 10, then every
// 30 s; a read that works (issue null) starts the backoff over. Stops on unmount. Returns 重新加载's handler.
import { useEffect, useRef } from "react";
import { retryDelay, type ReadIssue } from "./transientError";

export function useIssueRetry(issue: ReadIssue | null, reload: () => void): () => void {
  const failures = useRef(0);
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    if (!issue) {
      failures.current = 0;
      return;
    }
    if (!issue.retrying) return;
    const timer = setTimeout(() => latest.current(), retryDelay(failures.current++));
    return () => clearTimeout(timer);
  }, [issue]);
  return () => {
    failures.current = 0;
    latest.current();
  };
}
