// stdout / stderr whose reader is gone (dual-screen run 2026-10-28): started with its output piped to a process that
// has exited, the next console write fails with EPIPE. Node reports that as an 'error' event on the stream; with no
// listener it is an uncaught exception, which Electron shows as the modal "A JavaScript error occurred in the main
// process" dialog — again for every later write, so quitting (which logs) never finished. Each stream gets a listener:
// a failed write mutes that stream (its later writes are dropped, their callbacks still called) and nothing is thrown.
// Logging is best effort; the app's own records go to userData/logs (main/errorLog.ts), not to stdio.

/** The part of a stdio stream the guard uses (process.stdout / process.stderr; a fake in tests). */
export interface GuardedStream {
  on(event: "error", listener: (error: Error) => void): unknown;
  write: (...args: never[]) => boolean;
}

/** Marks a guarded stream (a registry symbol: a reloaded copy of this module sees it too). */
const GUARDED = Symbol.for("cutex-desktop.stdioGuard");

/** Never let a stdio write error reach the process: listen for it and drop the stream's later writes. */
export function guardStdio(streams: readonly GuardedStream[]): void {
  for (const stream of streams) {
    if (!stream || (stream as { [GUARDED]?: true })[GUARDED]) continue;
    (stream as { [GUARDED]?: true })[GUARDED] = true;
    let muted = false;
    const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    stream.write = ((...args: unknown[]) => {
      if (muted) {
        // write(chunk, [encoding], [callback]): the callback still runs, as after a successful write.
        const done = args.find((a, i) => i > 0 && typeof a === "function") as (() => void) | undefined;
        if (done) queueMicrotask(done);
        return true;
      }
      try {
        return write(...args);
      } catch {
        // A synchronous failure (a destroyed stream on some platforms): the same as the 'error' event.
        muted = true;
        return true;
      }
    }) as GuardedStream["write"];
    // Any write error, not only EPIPE (ECONNRESET, a destroyed stream): the console has nowhere else to report it, and
    // a dialog loop is worse. A reader that is gone does not come back, so the stream stays muted.
    stream.on("error", () => {
      muted = true;
    });
  }
}
