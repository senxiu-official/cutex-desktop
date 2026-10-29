// Settings → 关于 → 性能记录 (#27, docs/design/018-perf-log.md): the switch, the stalls of a period (or 10
// minutes either side of a moment: "it lagged at 22:40"), and the export (copy / save the entries as JSON).
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import type { ReactNode } from "react";
import { Section, Segmented, SettingRow, SettingsGroup, Toggle } from "../../components/settings/Form";
import { clearEntries, perfLogEnabled, readEntries, setPerfLogEnabled, usePerfLogRev, type PerfEntry } from "./recorder";

type Range = "15m" | "1h" | "today" | "all" | "custom";
const AROUND_MS = 10 * 60_000;
/** Rows drawn at most (the export always has every entry of the period). */
const SHOWN = 200;

/** The [from, to] window of a range (epoch ms); `at` = the chosen moment of "custom". */
export function rangeWindow(range: Range, now: number, at: number | null): [number, number] {
  if (range === "15m") return [now - 15 * 60_000, now];
  if (range === "1h") return [now - 3_600_000, now];
  if (range === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return [d.getTime(), now];
  }
  if (range === "custom" && at !== null) return [at - AROUND_MS, at + AROUND_MS];
  return [0, Number.POSITIVE_INFINITY];
}

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
/** `<input type="datetime-local">` value of a moment (local time), and back. */
const localInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function exportJson(entries: PerfEntry[]): string {
  return JSON.stringify({ kind: "cutex-desktop.perf-log", version: 1, exportedAt: new Date().toISOString(), userAgent: navigator.userAgent, entries: entries.map(({ id: _id, ...e }) => ({ ...e, time: new Date(e.at).toISOString() })) }, null, 2);
}

function save(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  const d = new Date();
  a.href = url;
  a.download = `cutex-perf-log-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Action({ children, onClick, disabled }: { children: ReactNode; onClick(): void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="h-7 rounded-md border border-border px-2.5 text-xs text-foreground hover:bg-hover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

function EntryRow({ e }: { e: PerfEntry }) {
  const { t } = useI18n();
  const s = e.screen;
  const screen = s
    ? [
        s.view === "conversation" ? s.agents.join(" · ") || "—" : s.view,
        s.workspaces > 1 ? t("perf-log.workspaces", { n: s.workspaces }) : null,
        s.tools.length ? s.tools.join(", ") : null,
        s.desktop ? t("perf-log.desktop") : null,
        s.turns !== null ? t("perf-log.rows", { turns: s.turns, rows: s.rows ?? 0 }) : null,
        t("perf-log.dom", { n: s.dom }),
        s.window,
        s.material,
        s.hidden ? t("perf-log.hiddenWindow") : null,
      ].filter(Boolean)
    : [];
  return (
    <details className="group border-b border-border/60 py-1.5 text-xs last:border-b-0" data-perf-entry="">
      <summary className="flex cursor-pointer list-none items-baseline gap-3">
        <span className="shrink-0 font-mono text-muted tabular-nums">{clock(e.at)}</span>
        <span className={`w-16 shrink-0 text-right font-medium tabular-nums ${e.ms >= 300 ? "text-danger" : e.ms >= 200 ? "text-warn-text" : ""}`}>{e.ms} ms</span>
        <span className="min-w-0 flex-1 truncate text-muted">{e.action ? `${e.action.type} · ${e.action.target}` : t("perf-log.noAction")}</span>
        <span className="hidden min-w-0 max-w-[40%] shrink truncate font-mono text-subtle sm:block">{e.scripts[0]?.what ?? ""}</span>
      </summary>
      <div className="mt-1.5 space-y-1 pl-2 text-muted">
        {e.frames > 1 && <div>{t("perf-log.frames", { n: e.frames, total: e.totalMs })}</div>}
        <div>{t("perf-log.layout", { ms: e.layoutMs })}</div>
        <div>{e.action ? t("perf-log.action", { ago: e.action.agoMs, what: `${e.action.type} · ${e.action.target}` }) : t("perf-log.noAction")}</div>
        {screen.length > 0 && (
          <div>
            {t("perf-log.screen")}: {screen.join(" · ")}
          </div>
        )}
        <div>{t("perf-log.code")}:</div>
        {e.scripts.length ? (
          <ul className="space-y-0.5 pl-3 font-mono text-caption/[inherit]">
            {e.scripts.map((x, i) => (
              <li key={i} className="break-all">
                {x.ms} ms{x.layoutMs ? ` (layout ${x.layoutMs})` : ""} · {x.what}
                {x.src ? ` · ${x.src}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <div className="pl-3 text-subtle">{t("perf-log.noCode")}</div>
        )}
      </div>
    </details>
  );
}

export function PerfLogSection() {
  const { t } = useI18n();
  const rev = usePerfLogRev();
  const on = perfLogEnabled();
  const [entries, setEntries] = useState<PerfEntry[]>([]);
  const [range, setRange] = useState<Range>("1h");
  const [at, setAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    void readEntries().then((list) => live && (setEntries(list), setNow(Date.now())), () => {});
    return () => {
      live = false;
    };
  }, [rev, range, at]);
  const [from, to] = rangeWindow(range, now, at);
  const shown = useMemo(() => entries.filter((e) => e.at >= from && e.at <= to), [entries, from, to]);
  const max = shown.reduce((m, e) => Math.max(m, e.ms), 0);
  return (
    <Section title={t("perf-log.section")}>
      <SettingRow agents="none" source="local" label={t("perf-log.enabled")} hint={t("perf-log.enabled.hint")}>
        <Toggle checked={on} onChange={setPerfLogEnabled} label={t("perf-log.enabled")} />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("perf-log.range")} hint={range === "custom" ? t("perf-log.around.hint") : undefined}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Segmented
            value={range}
            label={t("perf-log.range")}
            options={(["15m", "1h", "today", "all", "custom"] as const).map((r) => ({ value: r, label: t(`perf-log.range.${r}`) }))}
            onChange={(r) => {
              setRange(r);
              if (r === "custom" && at === null) setAt(Date.now());
            }}
          />
          {range === "custom" && (
            <input
              type="datetime-local"
              aria-label={t("perf-log.around")}
              title={t("perf-log.around")}
              value={at === null ? "" : localInput(at)}
              onChange={(e) => setAt(e.target.value ? new Date(e.target.value).getTime() : null)}
              className="h-7 rounded-md border border-border bg-surface px-2 text-xs"
            />
          )}
        </div>
      </SettingRow>
      <SettingsGroup readOnly agents="none" source="local">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted">
        <span className="flex-1">{!on && !shown.length ? t("perf-log.off") : shown.length ? t("perf-log.count", { n: shown.length, max }) : t("perf-log.empty")}</span>
        <Action disabled={!shown.length} onClick={() => void navigator.clipboard.writeText(exportJson(shown)).catch(() => {})}>
          {t("perf-log.copy")}
        </Action>
        <Action disabled={!shown.length} onClick={() => save(exportJson(shown))}>
          {t("perf-log.save")}
        </Action>
        <Action disabled={!entries.length} onClick={() => void clearEntries()}>
          {t("perf-log.clear")}
        </Action>
      </div>
      {shown.length > 0 && (
        <div className="max-h-[28rem] overflow-y-auto px-4 pb-2" data-perf-list="">
          {shown
            .slice(-SHOWN)
            .reverse()
            .map((e) => (
              <EntryRow key={`${e.at}-${e.id ?? "open"}`} e={e} />
            ))}
        </div>
      )}
      </SettingsGroup>
    </Section>
  );
}
