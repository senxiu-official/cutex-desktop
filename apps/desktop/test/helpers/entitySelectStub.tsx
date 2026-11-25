// components/EntitySelect as a native <select> for tests of a form around it (the picker itself is covered by
// test/entityIconsRest.test.tsx; a stand-in hides its Escape handling, so keep one real-picker test per dialog, e.g.
// test/forkProfileRealPicker.test.tsx): `vi.mock("../src/renderer/src/components/EntitySelect", () => import("./helpers/entitySelectStub"))`.
// It keeps the value, the options (with disabled) and the accessible name, so the form's own logic stays testable.
import type { EntitySelectOption } from "../../src/renderer/src/lib/entityIcon";

export function EntitySelect({ value, options, onChange, label, disabled, autoFocus, testId }: { value: string; options: EntitySelectOption[]; onChange(value: string, trigger: HTMLElement): void; label?: string; disabled?: boolean; autoFocus?: boolean; testId?: string }) {
  return (
    <select aria-label={label} data-testid={testId} value={value} disabled={disabled} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value, e.target)}>
      {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  );
}
