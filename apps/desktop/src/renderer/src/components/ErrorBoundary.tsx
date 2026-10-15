import { Component, type ErrorInfo, type ReactNode } from "react";
import { bridge } from "../bridge";
import { translate } from "../i18n";

/**
 * A render error replaces only this subtree with a recoverable message (React unmounts the whole
 * root otherwise, which left a blank window). `resetKey` changing (another agent / page) retries.
 */
export class ErrorBoundary extends Component<{ resetKey?: string; children: ReactNode }, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { error: Error | null; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Caught errors never reach window "error": log them like an uncaught one.
    const stack = [error.stack, info.componentStack].filter(Boolean).join("\n");
    void bridge.shell?.logError({ kind: "error", message: error.message, stack }).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <CrashNotice error={this.state.error} onRetry={() => this.setState({ error: null })} />;
  }
}

// No useI18n: the fallback must render even when the i18n context is what failed (e.g. a hot-reloaded
// i18n module with a new context object), or the crash screen itself throws and the window freezes.
function CrashNotice({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const t = translate;
  return (
    <div className="flex h-full flex-1 items-center justify-center bg-background p-6">
      <div className="max-w-lg space-y-3 text-sm">
        <p className="font-medium text-foreground">{t("crash.title")}</p>
        <p className="text-muted">{t("crash.hint")}</p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-danger">{error.message}</pre>
        <div className="flex gap-2">
          <button onClick={onRetry} className="rounded border border-border px-3 py-1 hover:bg-surface">
            {t("crash.retry")}
          </button>
          <button onClick={() => window.location.reload()} className="rounded border border-border px-3 py-1 hover:bg-surface">
            {t("crash.reload")}
          </button>
        </div>
      </div>
    </div>
  );
}
