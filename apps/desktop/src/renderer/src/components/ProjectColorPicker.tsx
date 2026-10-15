// Project colour swatches (projects page, new-agent「新项目…」).
import { PROJECT_PALETTE } from "../lib/projectCreate";
import { projectColor } from "../lib/sidebar";

export function ProjectColorPicker({ value, onChange }: { value: string; onChange(c: string): void }) {
  return (
    <span className="flex gap-1.5">
      {PROJECT_PALETTE.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c} aria-pressed={value === c} className={`h-5 w-5 rounded-full ${value === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface" : ""}`} style={{ background: projectColor(c) }} />
      ))}
    </span>
  );
}
