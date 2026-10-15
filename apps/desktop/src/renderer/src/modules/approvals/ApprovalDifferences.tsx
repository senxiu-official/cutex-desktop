import { useI18n, type MessageKey } from "../../i18n";
import { approvalDifferences, type ApprovalDifferenceValue } from "../../lib/approvals";

export function ApprovalDifferences({ value }: { value: unknown }) {
  const { t } = useI18n();
  if (value === undefined || value === null) return null;
  const rows = approvalDifferences(value);
  if (!rows) return (
    <details className="mt-2 text-xs" data-testid="approval-differences-json">
      <summary className="cursor-pointer text-subtle">{t("approvals.differences.raw")}</summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2/60 p-3">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
  if (rows.length === 0) return null;
  const text = (field: string, v: ApprovalDifferenceValue): string => {
    if (v === null) return t("approvals.differences.unset");
    if (Array.isArray(v)) return v.length ? v.map(item => text(field, item)).join(", ") : t("approvals.differences.empty");
    if (typeof v === "boolean") return t(v ? "approvals.differences.yes" : "approvals.differences.no");
    if (field === "sandbox" && ["read-only", "workspace-write", "danger-full-access"].includes(String(v))) return t(`launch.sandbox.${v}` as MessageKey);
    if (field === "managedServices" && v === "unrestricted") return t("approvals.differences.unrestricted");
    if (field === "managedServices" && v === "owner approval") return t("approvals.differences.ownerApproval");
    if (field === "reach" && v === "host") return t("approvals.differences.host");
    return String(v);
  };
  return (
    <div className="mt-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs" data-testid="approval-differences">
      <div className="mb-1 text-subtle">{t("approvals.differences.title")}</div>
      <ul className="space-y-1">
        {rows.map((row, i) => {
          const key = `approvals.field.${row.field}` as MessageKey;
          const label = t(key) === key ? row.field : t(key);
          return <li key={i} className="break-words">{t("approvals.differences.row", { field: label, before: text(row.field, row.requester), after: text(row.field, row.target) })}</li>;
        })}
      </ul>
    </div>
  );
}
