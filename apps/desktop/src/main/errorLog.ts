// Desktop error log: failed IPC calls (with the cutex error code / details that Electron's
// "Error invoking remote method" wrapper drops) and renderer crashes, one JSON object per line in
// userData/logs/errors.jsonl (rotated to errors.1.jsonl at 2 MB). Settings → 通用 opens the folder.
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { CutexApiError } from "@cutex-desktop/cutex-client";

const MAX_BYTES = 2 * 1024 * 1024;
const REPEAT_WINDOW_MS = 60_000;
const recent = new Map<string, number>();
const MAX_PENDING_DIAGNOSTICS = 128;
let pendingDiagnostics = 0;
let diagnosticWrites: Promise<void> = Promise.resolve();

/** Performance reports must not wait for filesystem I/O on the Electron main thread.
 * Bound both the disk log and the in-memory queue; reports are best effort under pressure.
 */
function appendDiagnostic(dir: string, line: string): void {
  if (pendingDiagnostics >= MAX_PENDING_DIAGNOSTICS) return;
  pendingDiagnostics++;
  diagnosticWrites = diagnosticWrites.then(async () => {
    try {
      await mkdir(dir, { recursive: true });
      const file = join(dir, "errors.jsonl");
      try {
        if ((await stat(file)).size > MAX_BYTES) await rename(file, join(dir, "errors.1.jsonl"));
      } catch {
        // no file yet; a synchronous error logger may also have just rotated it
      }
      await appendFile(file, line);
    } catch {
      // Logging is best effort; a failed append must not poison subsequent writes.
    } finally {
      pendingDiagnostics--;
    }
  });
}

export function logDir(): string {
  return join(app.getPath("userData"), "logs");
}

/**
 * Append one record; identical (source, method, host, session, message) repeats within a minute are
 * skipped. Host and session are part of the key: the same error for another agent is a new fact.
 */
export function logError(record: { source: string; method?: string; message: string; [key: string]: unknown }): void {
  const key = `${record.source}|${record.method ?? ""}|${String(record.hostId ?? "")}|${String(record.sessionId ?? "")}|${record.message}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - REPEAT_WINDOW_MS) return;
  recent.set(key, now);
  if (recent.size > 500) recent.clear();
  try {
    const dir = logDir();
    if (record.source === "send-latency" || (record.source === "renderer" && record.kind === "reported")) {
      appendDiagnostic(dir, JSON.stringify({ time: new Date().toISOString(), version: app.getVersion(), ...record }) + "\n");
      return;
    }
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "errors.jsonl");
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, "errors.1.jsonl"));
    } catch {
      // no file yet
    }
    appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), version: app.getVersion(), ...record }) + "\n");
  } catch {
    // logging is best effort
  }
}

/** The fields worth keeping from a thrown value (CutexApiError keeps code / status / details). */
export function errorFields(error: unknown): { name: string; message: string; code?: string; status?: number; details?: unknown; stack?: string } {
  if (error instanceof CutexApiError) return { name: error.name, message: error.message, code: error.code, status: error.status, details: clip(error.details) };
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack?.split("\n").slice(0, 6).join("\n") };
  return { name: typeof error, message: String(error) };
}

function clip(value: unknown): unknown {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : value;
}
