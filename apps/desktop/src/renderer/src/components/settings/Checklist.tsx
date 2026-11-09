// A checkbox grid of projects or agents (the grant editor, inviting someone).
import type { GrantChoice } from "../../lib/userGrants";
import { Checkbox } from "./Form";

export function Checklist({ choices, chosen, disabled, onToggle, label }: { choices: GrantChoice[]; chosen: readonly string[]; disabled?: boolean; onToggle(id: string, on: boolean): void; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid max-h-44 grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-3 gap-y-1 overflow-y-auto pr-1">
      {choices.map((c) => (
        <label key={c.id} className={`flex min-w-0 items-center gap-1.5 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`} title={c.id}>
          <Checkbox disabled={disabled} checked={chosen.includes(c.id)} onChange={(on) => onToggle(c.id, on)} />
          <span className="truncate">{c.name}</span>
        </label>
      ))}
    </div>
  );
}
