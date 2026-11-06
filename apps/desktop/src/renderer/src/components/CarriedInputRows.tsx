import { Fragment, useMemo, type ReactNode } from "react";
import type { InputRecord } from "@cutex-desktop/protocol";
import type { TimelineEntry } from "../lib/timeline";

type ReceivedEntry = Extract<TimelineEntry, { kind: "received" }>;

/**
 * Inputs an owner message carried (057) show as ordinary 来自 rows right after it, no card (owner 2026-11-05).
 * A native event can coalesce several inputs: its row shows once, with each input's status under it.
 * A record without a native entry still shows from its preview.
 */
export function CarriedInputRows({ records, received, renderReceived, renderRecord }: {
  records: readonly InputRecord[]; received: ReadonlyMap<string, TimelineEntry>;
  renderReceived: (entry: ReceivedEntry, records: readonly InputRecord[]) => ReactNode;
  renderRecord: (record: InputRecord) => ReactNode;
}) {
  const groups = useMemo(() => {
    const grouped = new Map<string, { entry?: ReceivedEntry; records: InputRecord[] }>();
    for (const record of records) {
      const native = received.get(record.timelineItemId ?? record.inputId);
      const entry = native?.kind === "received" ? native : undefined;
      const key = entry ? `native:${entry.id}` : `input:${record.inputId}`;
      let group = grouped.get(key);
      if (!group) grouped.set(key, group = { entry, records: [] });
      group.records.push(record);
    }
    return [...grouped];
  }, [records, received]);
  return <>{groups.map(([key, group]) => <Fragment key={key}>
    {group.entry ? <div data-carried-native-id={group.entry.id}>{renderReceived(group.entry, group.records)}</div> : renderRecord(group.records[0]!)}
  </Fragment>)}</>;
}
