// A JSON object / array artifact (acceptance records, manifests) as a readable record: keys as labels,
// nested objects as indented sections, scalar arrays inline, long strings wrapped. The 原文 toggle
// in View.tsx shows the JSON itself.
import type { ReactNode } from "react";
import { isJsonScalar, jsonKeyLabel, type JsonValue } from "./model";

const MAX_DEPTH = 8;

function Scalar({ value }: { value: string | number | boolean | null }) {
  if (value === null) return <span className="text-subtle">—</span>;
  if (typeof value === "boolean") return <span className={`font-mono text-[11px] ${value ? "text-ok-text" : "text-danger"}`}>{String(value)}</span>;
  if (typeof value === "number") return <span className="font-mono text-[11px] tabular-nums">{value}</span>;
  return <span className="whitespace-pre-wrap break-words">{value}</span>;
}

function Value({ value, depth }: { value: JsonValue; depth: number }): ReactNode {
  if (isJsonScalar(value)) return <Scalar value={value} />;
  if (depth >= MAX_DEPTH) return <span className="font-mono text-[11px] break-all whitespace-pre-wrap text-subtle">{JSON.stringify(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-subtle">[]</span>;
    if (value.every(isJsonScalar))
      return (
        <span className="break-words">
          {value.map((v, i) => (
            <span key={i}>
              {i > 0 && <span className="text-subtle">, </span>}
              <Scalar value={v} />
            </span>
          ))}
        </span>
      );
    return (
      <ol className="flex flex-col gap-1.5">
        {value.map((v, i) => (
          <li key={i} className="flex min-w-0 gap-1.5">
            <span className="shrink-0 pt-px font-mono text-[10px] text-subtle tabular-nums">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              <Value value={v} depth={depth + 1} />
            </div>
          </li>
        ))}
      </ol>
    );
  }
  return <Fields value={value} depth={depth} />;
}

function Fields({ value, depth }: { value: { [key: string]: JsonValue }; depth: number }) {
  const entries = Object.entries(value);
  if (entries.length === 0) return <span className="text-subtle">{"{}"}</span>;
  return (
    <dl className="grid min-w-0 grid-cols-[minmax(5rem,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1">
      {entries.map(([key, v]) =>
        isJsonScalar(v) || (Array.isArray(v) && v.every(isJsonScalar)) ? (
          <div key={key} className="contents">
            <dt className="max-w-[14rem] truncate pt-px text-[11px] text-subtle" title={key}>
              {jsonKeyLabel(key)}
            </dt>
            <dd className="min-w-0 text-xs text-foreground">
              <Value value={v} depth={depth + 1} />
            </dd>
          </div>
        ) : (
          <div key={key} className="col-span-2 mt-1 min-w-0">
            <div className="mb-1 text-[11px] font-medium text-muted" title={key}>
              {jsonKeyLabel(key)}
            </div>
            <div className="min-w-0 border-l border-border pl-2.5 text-xs">
              <Value value={v} depth={depth + 1} />
            </div>
          </div>
        ),
      )}
    </dl>
  );
}

export function JsonRecord({ value }: { value: JsonValue[] | { [key: string]: JsonValue } }) {
  return (
    <div className="px-3 py-2 text-xs leading-relaxed" data-json-record>
      <Value value={value} depth={0} />
    </div>
  );
}
